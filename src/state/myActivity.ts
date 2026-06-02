import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCharityMembers } from '@/state/charities';
import { displayName } from '@/state/customers';
import type { Database } from '@/lib/database.types';

export type ActivityRange = '7d' | '30d' | '90d' | 'all';

type NoteKind = Database['public']['Tables']['notes']['Row']['kind'];

// `actor` is the display name of who logged the event. It is only populated
// in the super-admin "All users" view (where it disambiguates whose work an
// entry is); single-user views leave it null since the actor is implied.
export type RecentEvent =
  | {
      source: 'note';
      id: string;
      at: string;
      kind: NoteKind;
      body: string;
      customer: { id: string; name: string } | null;
      actor: string | null;
    }
  | {
      source: 'email';
      id: string;
      at: string;
      subject: string;
      toEmail: string;
      customer: { id: string; name: string } | null;
      actor: string | null;
    };

export interface PerDayStats {
  visits: number;
  notes: number;
  emails: number;
  minutes: number;
}

export interface PerCustomerStats {
  customerId: string;
  name: string;
  totalSeconds: number;
  visitCount: number;
  lastVisitAt: string;
}

export interface MyActivityResult {
  totalSeconds: number;
  activeDays: number;
  noteCount: number;
  callCount: number;
  emailCount: number;
  perDay: Map<string, PerDayStats>;
  perCustomer: PerCustomerStats[];
  recentEvents: RecentEvent[];
  isLoading: boolean;
  error: Error | null;
}

const RANGE_DAYS: Record<Exclude<ActivityRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

// Stable ISO start-of-window for the given range. For 'all' returns null
// (consumers omit the filter). For day ranges we anchor to the local day's
// start in the charity's tz so the boundary lines up with calendar days.
export function rangeStartIso(range: ActivityRange, tzName: string): string | null {
  if (range === 'all') return null;
  const days = RANGE_DAYS[range];
  // Build "today at 00:00 in tzName" by reading the current date parts in
  // tzName, then constructing a UTC moment that, when interpreted in that
  // tz, is local midnight. We approximate by constructing a Date from the
  // formatted YYYY-MM-DD parts and stepping back N-1 days; this is good
  // enough for window boundaries (off-by-tz minutes do not affect the
  // dashboard semantics).
  const [y, m, d] = todayYmdInTz(tzName).split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString();
}

export function todayYmdInTz(tzName: string): string {
  return ymdInTz(new Date(), tzName);
}

export function ymdInTz(date: Date, tzName: string): string {
  // en-CA is the easy way to get a YYYY-MM-DD shape from Intl.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzName,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

interface VisitRow {
  customer_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  customer: { id: string; display_name: string | null } | null;
}

interface NoteRowJoined {
  id: string;
  kind: NoteKind;
  body: string;
  created_at: string;
  created_by: string | null;
  customer: { id: string; display_name: string | null } | null;
}

interface EmailRowJoined {
  id: string;
  subject: string;
  to_email: string;
  sent_at: string;
  sent_by: string | null;
  customer: { id: string; display_name: string | null } | null;
}

// userId selects whose activity to load. A real user id filters to that user;
// the 'all' sentinel skips the per-user filter so every member of the charity
// is aggregated (used by the super-admin "All users" view). RLS still scopes
// reads to the charity.
export function useMyActivity(opts: {
  charityId: string | null;
  userId: string | 'all' | null;
  range: ActivityRange;
  tzName: string;
}): MyActivityResult {
  const { charityId, userId, range, tzName } = opts;
  const fromIso = useMemo(() => rangeStartIso(range, tzName), [range, tzName]);
  const enabled = !!charityId && !!userId;
  const userFilter = userId === 'all' ? null : userId;

  // Actor names are only needed (and only resolvable) in the aggregate view.
  // The RPC returns nothing for non-admins, so this is a no-op there.
  const membersQ = useCharityMembers(userId === 'all' ? charityId : null);
  const actorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of membersQ.data ?? []) {
      map.set(m.user_id, m.full_name?.trim() || m.email || m.user_id);
    }
    return map;
  }, [membersQ.data]);

  const visitsQ = useQuery({
    queryKey: ['my_activity', 'visits', charityId, userId, range],
    enabled,
    queryFn: async (): Promise<VisitRow[]> => {
      let q = supabase
        .from('customer_visits')
        .select(
          'customer_id, started_at, ended_at, duration_seconds, customer:customers!inner(id, display_name)',
        )
        .eq('charity_id', charityId!)
        .order('ended_at', { ascending: false });
      if (userFilter) q = q.eq('user_id', userFilter);
      if (fromIso) q = q.gte('ended_at', fromIso);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  const notesQ = useQuery({
    queryKey: ['my_activity', 'notes', charityId, userId, range],
    enabled,
    queryFn: async (): Promise<NoteRowJoined[]> => {
      let q = supabase
        .from('notes')
        .select(
          'id, kind, body, created_at, created_by, customer:customers!inner(id, display_name)',
        )
        .eq('charity_id', charityId!)
        .order('created_at', { ascending: false });
      if (userFilter) q = q.eq('created_by', userFilter);
      if (fromIso) q = q.gte('created_at', fromIso);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as NoteRowJoined[];
    },
  });

  const emailsQ = useQuery({
    queryKey: ['my_activity', 'emails', charityId, userId, range],
    enabled,
    queryFn: async (): Promise<EmailRowJoined[]> => {
      let q = supabase
        .from('email_log')
        .select('id, subject, to_email, sent_at, sent_by, customer:customers(id, display_name)')
        .eq('charity_id', charityId!)
        .order('sent_at', { ascending: false });
      if (userFilter) q = q.eq('sent_by', userFilter);
      if (fromIso) q = q.gte('sent_at', fromIso);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as EmailRowJoined[];
    },
  });

  return useMemo<MyActivityResult>(() => {
    const visits = visitsQ.data ?? [];
    const notes = notesQ.data ?? [];
    const emails = emailsQ.data ?? [];

    const perDay = new Map<string, PerDayStats>();
    const bumpDay = (
      ymd: string,
      patch: Partial<PerDayStats>,
    ) => {
      const cur = perDay.get(ymd) ?? { visits: 0, notes: 0, emails: 0, minutes: 0 };
      perDay.set(ymd, {
        visits: cur.visits + (patch.visits ?? 0),
        notes: cur.notes + (patch.notes ?? 0),
        emails: cur.emails + (patch.emails ?? 0),
        minutes: cur.minutes + (patch.minutes ?? 0),
      });
    };

    let totalSeconds = 0;
    const perCustomerMap = new Map<string, PerCustomerStats>();
    for (const v of visits) {
      totalSeconds += v.duration_seconds;
      const day = ymdInTz(new Date(v.started_at), tzName);
      bumpDay(day, { visits: 1, minutes: v.duration_seconds / 60 });
      const cur = perCustomerMap.get(v.customer_id);
      const name = displayName(v.customer ?? undefined);
      if (cur) {
        cur.totalSeconds += v.duration_seconds;
        cur.visitCount += 1;
        if (v.ended_at > cur.lastVisitAt) cur.lastVisitAt = v.ended_at;
      } else {
        perCustomerMap.set(v.customer_id, {
          customerId: v.customer_id,
          name,
          totalSeconds: v.duration_seconds,
          visitCount: 1,
          lastVisitAt: v.ended_at,
        });
      }
    }

    let callCount = 0;
    for (const n of notes) {
      const day = ymdInTz(new Date(n.created_at), tzName);
      bumpDay(day, { notes: 1 });
      if (n.kind === 'call') callCount += 1;
    }

    for (const e of emails) {
      const day = ymdInTz(new Date(e.sent_at), tzName);
      bumpDay(day, { emails: 1 });
    }

    const perCustomer = Array.from(perCustomerMap.values()).sort(
      (a, b) => b.totalSeconds - a.totalSeconds,
    );

    const actorFor = (id: string | null): string | null =>
      userId === 'all' && id ? actorNames.get(id) ?? null : null;

    const recentEvents: RecentEvent[] = [
      ...notes.map<RecentEvent>((n) => ({
        source: 'note',
        id: n.id,
        at: n.created_at,
        kind: n.kind,
        body: n.body,
        customer: n.customer
          ? { id: n.customer.id, name: displayName(n.customer) }
          : null,
        actor: actorFor(n.created_by),
      })),
      ...emails.map<RecentEvent>((e) => ({
        source: 'email',
        id: e.id,
        at: e.sent_at,
        subject: e.subject,
        toEmail: e.to_email,
        customer: e.customer
          ? { id: e.customer.id, name: displayName(e.customer) }
          : null,
        actor: actorFor(e.sent_by),
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    return {
      totalSeconds,
      activeDays: perDay.size,
      noteCount: notes.length,
      callCount,
      emailCount: emails.length,
      perDay,
      perCustomer,
      recentEvents,
      isLoading: visitsQ.isLoading || notesQ.isLoading || emailsQ.isLoading,
      error: (visitsQ.error ?? notesQ.error ?? emailsQ.error) as Error | null,
    };
  }, [
    visitsQ.data,
    notesQ.data,
    emailsQ.data,
    visitsQ.isLoading,
    notesQ.isLoading,
    emailsQ.isLoading,
    visitsQ.error,
    notesQ.error,
    emailsQ.error,
    tzName,
    userId,
    actorNames,
  ]);
}
