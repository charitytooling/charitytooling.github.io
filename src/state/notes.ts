import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';

export type NoteRow = Database['public']['Tables']['notes']['Row'];
export type FollowUpRow = Database['public']['Tables']['follow_ups']['Row'];

export function useNotes(customerId: string | undefined) {
  return useQuery({
    queryKey: ['notes', customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<NoteRow[]> => {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('customer_id', customerId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Database['public']['Tables']['notes']['Insert']) => {
      const { data, error } = await supabase.from('notes').insert(input).select().single();
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
  customer: Pick<
    Database['public']['Tables']['customers']['Row'],
    'id' | 'display_name' | 'first_name' | 'last_name' | 'email'
  >;
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
        .select('*, customer:customers!inner(id, display_name, first_name, last_name, email)')
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
