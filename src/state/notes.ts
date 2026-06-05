import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';

// NoteRow includes the embedded author profile so NoteList can render the
// email local-part next to each note. The join is notes.created_by ->
// profiles.id via the additive FK `notes_created_by_profile_fkey` in
// 20260530020000_notes_created_by_profile_fk.sql. The original
// `notes_created_by_fkey` references auth.users(id) (init migration), not
// profiles, so PostgREST cannot embed through it -- which is why we hint
// the new constraint name explicitly. Cross-member visibility is granted
// by the "members read profiles of co-members" RLS policy in
// 20260530010000_notes_author.sql.
export type NoteAuthor = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email'>;
export type NoteRow = Database['public']['Tables']['notes']['Row'] & {
  author: NoteAuthor | null;
};
export type FollowUpRow = Database['public']['Tables']['follow_ups']['Row'];

export function useNotes(customerId: string | undefined) {
  return useQuery({
    queryKey: ['notes', customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<NoteRow[]> => {
      const { data, error } = await supabase
        .from('notes')
        .select('*, author:profiles!notes_created_by_profile_fkey(id, email)')
        .eq('customer_id', customerId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as NoteRow[];
    },
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: Database['public']['Tables']['notes']['Insert']) => {
      // Stamp created_by client-side as a belt-and-suspenders alongside
      // the notes_set_created_by trigger. Stamping here populates the
      // returned row so the optimistic UI render has the author available
      // without an extra refetch.
      const payload = {
        ...input,
        created_by: input.created_by ?? user?.id ?? null,
      };
      const { data, error } = await supabase.from('notes').insert(payload).select().single();
      if (error) throw error;
      // Stamp last_contacted_at on the customer for any "contact" kind.
      if (['call', 'email', 'meeting'].includes(input.kind)) {
        await supabase
          .from('customers')
          .update({ last_contacted_at: new Date().toISOString() })
          .eq('id', input.customer_id);
      }
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['notes', vars.customer_id] });
      qc.invalidateQueries({ queryKey: ['customer', vars.customer_id] });
    },
  });
}

// Edit a note's body. Server enforces author + within-24h via the
// "author edits own note within 24h" RLS policy and the
// notes_block_immutable_fields trigger (kind / customer / author /
// timestamps cannot move). We deliberately only send `body` so the client
// can never even attempt to mutate other columns.
export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    // customer_id is part of the variables type so onSuccess can scope
    // the cache invalidation, even though the SQL update only needs id +
    // body. Reading via vars.* avoids destructuring an unused name.
    mutationFn: async (vars: { id: string; customer_id: string; body: string }) => {
      const { error } = await supabase
        .from('notes')
        .update({ body: vars.body })
        .eq('id', vars.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['notes', vars.customer_id] });
    },
  });
}

// Delete a note. Server enforces author-within-24h OR charity admin via
// the "delete own within 24h or admin anytime" RLS policy. The client
// shows the Delete button only when the same predicate is satisfied UI-
// side; if the 24h window slips between render and click, RLS denies and
// the caller surfaces the error.
export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; customer_id: string }) => {
      const { error } = await supabase.from('notes').delete().eq('id', vars.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['notes', vars.customer_id] });
      qc.invalidateQueries({ queryKey: ['customer', vars.customer_id] });
    },
  });
}

export type ArchiveNote = {
  body: string;
  kind: NoteRow['kind'];
  created_at: string;
  authorEmail: string | null;
};

// The "archive comment" isn't a column — the Archive & leave note flow creates
// a note immediately before setting archived_at. So per archived customer we
// take their latest note, but only when it was created around archive time (a
// generous window absorbs client/server clock skew). Customers archived without
// a note get nothing rather than a stale, unrelated note.
export function useArchiveNotes(
  charityId: string | null,
  archived: { id: string; archived_at: string | null }[],
) {
  const ids = archived.map((a) => a.id).sort();
  const archivedAtById = new Map(archived.map((a) => [a.id, a.archived_at] as const));
  return useQuery({
    queryKey: ['archive_notes', charityId, ids.join(',')],
    enabled: !!charityId && ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, ArchiveNote>> => {
      const latest = new Map<string, ArchiveNote>();
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from('notes')
          .select('customer_id, body, kind, created_at, author:profiles!notes_created_by_profile_fkey(id, email)')
          .in('customer_id', chunk)
          .order('created_at', { ascending: false });
        if (error) throw error;
        for (const n of (data ?? []) as unknown as Array<{
          customer_id: string;
          body: string;
          kind: NoteRow['kind'];
          created_at: string;
          author: NoteAuthor | null;
        }>) {
          // Descending order => the first row seen per customer is the latest.
          if (!latest.has(n.customer_id)) {
            latest.set(n.customer_id, {
              body: n.body,
              kind: n.kind,
              created_at: n.created_at,
              authorEmail: n.author?.email ?? null,
            });
          }
        }
      }
      const WINDOW = 10 * 60_000; // 10 minutes around archived_at
      const out = new Map<string, ArchiveNote>();
      for (const [cid, note] of latest) {
        const archivedAt = archivedAtById.get(cid);
        if (!archivedAt) continue;
        const diff = Math.abs(new Date(note.created_at).getTime() - new Date(archivedAt).getTime());
        if (diff <= WINDOW) out.set(cid, note);
      }
      return out;
    },
  });
}

export function useFollowUps(customerId: string | undefined) {
  return useQuery({
    queryKey: ['follow_ups', customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<FollowUpRow[]> => {
      const { data, error } = await supabase
        .from('follow_ups')
        .select('*')
        .eq('customer_id', customerId!)
        .order('due_date', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type CalendarFollowUp = FollowUpRow & {
  customer: Pick<Database['public']['Tables']['customers']['Row'], 'id' | 'display_name'> & {
    customer_contacts: Pick<
      Database['public']['Tables']['customer_contacts']['Row'],
      'first_name' | 'last_name' | 'email' | 'is_primary' | 'sort_order' | 'created_at'
    >[];
  };
};

export function useFollowUpsInRange(args: {
  charityId: string | null;
  fromYmd: string;
  toYmd: string;
  statuses: FollowUpRow['status'][];
}) {
  return useQuery({
    queryKey: [
      'follow_ups_calendar',
      args.charityId,
      args.fromYmd,
      args.toYmd,
      args.statuses.join(','),
    ],
    enabled: !!args.charityId,
    queryFn: async (): Promise<CalendarFollowUp[]> => {
      const { data, error } = await supabase
        .from('follow_ups')
        .select(
          '*, customer:customers!inner(id, display_name, customer_contacts(first_name, last_name, email, is_primary, sort_order, created_at))',
        )
        .eq('charity_id', args.charityId!)
        .in('status', args.statuses)
        .gte('due_date', args.fromYmd)
        .lte('due_date', args.toYmd)
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CalendarFollowUp[];
    },
  });
}

export function useCustomerIdsWithOpenFollowUps(charityId: string | null) {
  return useQuery({
    queryKey: ['customer_ids_with_open_followups', charityId],
    enabled: !!charityId,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('follow_ups')
        .select('customer_id')
        .eq('charity_id', charityId!)
        .in('status', ['open', 'snoozed']);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.customer_id));
    },
    staleTime: 60_000,
  });
}

// Earliest open/snoozed follow-up due date per customer, in ms since epoch.
// Used by useContactQueue() to power the 'followup_due_soonest' sort.
export function useOpenFollowUpsByCustomer(charityId: string | null) {
  return useQuery({
    queryKey: ['follow_ups_due_by_customer', charityId],
    enabled: !!charityId,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from('follow_ups')
        .select('customer_id, due_date')
        .eq('charity_id', charityId!)
        .in('status', ['open', 'snoozed'])
        .order('due_date', { ascending: true });
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data ?? []) {
        if (!row.due_date) continue;
        const t = new Date(row.due_date).getTime();
        const prev = map.get(row.customer_id);
        if (prev == null || t < prev) map.set(row.customer_id, t);
      }
      return map;
    },
    staleTime: 60_000,
  });
}

export function useNextFollowUpDays(charityId: string | null) {
  return useQuery({
    queryKey: ['next_follow_up', charityId],
    enabled: !!charityId,
    queryFn: async (): Promise<{ dueYmd: string; daysUntil: number } | null> => {
      const todayYmd = toLocalYmd(new Date());
      const { data, error } = await supabase
        .from('follow_ups')
        .select('id, due_date')
        .eq('charity_id', charityId!)
        .in('status', ['open', 'snoozed'])
        .order('due_date', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        dueYmd: data.due_date,
        daysUntil: daysBetweenYmd(todayYmd, data.due_date),
      };
    },
    // Keep the badge fresh when the user reopens the tab the next morning.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
}

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  return Math.round(
    (new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86_400_000,
  );
}

export function useCreateFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Database['public']['Tables']['follow_ups']['Insert']) => {
      const { data, error } = await supabase.from('follow_ups').insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['follow_ups', vars.customer_id] });
      qc.invalidateQueries({ queryKey: ['follow_ups_calendar'] });
      qc.invalidateQueries({ queryKey: ['next_follow_up'] });
      qc.invalidateQueries({ queryKey: ['customer_ids_with_open_followups'] });
      qc.invalidateQueries({ queryKey: ['follow_ups_due_by_customer'] });
    },
  });
}

export function useUpdateFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<FollowUpRow>) => {
      const { data, error } = await supabase
        .from('follow_ups')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['follow_ups', data.customer_id] });
      qc.invalidateQueries({ queryKey: ['follow_ups_calendar'] });
      qc.invalidateQueries({ queryKey: ['next_follow_up'] });
      qc.invalidateQueries({ queryKey: ['customer_ids_with_open_followups'] });
      qc.invalidateQueries({ queryKey: ['follow_ups_due_by_customer'] });
    },
  });
}
