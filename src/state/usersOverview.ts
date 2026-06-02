import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useIsSuperAdmin } from '@/state/profile';
import { rangeStartIso, type ActivityRange } from '@/state/myActivity';

export interface UserOverviewRow {
  userId: string;
  email: string | null;
  fullName: string | null;
  appSeconds: number;
  visitSeconds: number;
  activeDays: number;
  noteCount: number;
  callCount: number;
}

// Per-user activity rollup across all charities, for the super-admin Users
// table. Backed by the super_admin_user_overview() RPC, which returns no rows
// unless the caller is a super admin - so the query is also enabled-gated on
// useIsSuperAdmin() to avoid a pointless round trip for everyone else.
//
// `range` bounds the window. The boundary is computed in UTC to match the RPC's
// UTC active-days bucketing; 'all' passes no `since`, preserving all-time totals.
export function useUsersOverview(range: ActivityRange) {
  const isSuper = useIsSuperAdmin();
  const since = rangeStartIso(range, 'UTC');
  return useQuery({
    queryKey: ['users-overview', range],
    enabled: isSuper,
    queryFn: async (): Promise<UserOverviewRow[]> => {
      const { data, error } = await supabase.rpc('super_admin_user_overview', {
        since: since ?? undefined,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        userId: r.user_id,
        email: r.email,
        fullName: r.full_name,
        appSeconds: r.app_seconds ?? 0,
        visitSeconds: r.visit_seconds ?? 0,
        activeDays: r.active_days ?? 0,
        noteCount: r.note_count ?? 0,
        callCount: r.call_count ?? 0,
      }));
    },
  });
}
