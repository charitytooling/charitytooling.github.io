import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { supabase } from '@/lib/supabase';

export interface CharitySummary {
  id: string;
  name: string;
  default_tz: string;
  role: 'admin' | 'rep' | 'super_admin';
}

export function useMyCharities() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['charities', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<CharitySummary[]> => {
      // Super-admin sees every charity; members see only the ones they belong to.
      // RLS filters charities automatically, and charity_members joins reveal role.
      const { data: charities, error: chError } = await supabase
        .from('charities')
        .select('id, name, default_tz')
        .order('name');
      if (chError) throw chError;

      const { data: memberships } = await supabase
        .from('charity_members')
        .select('charity_id, role')
        .eq('user_id', user!.id);

      const roleByCharity = new Map<string, 'admin' | 'rep'>(
        (memberships ?? []).map((m) => [m.charity_id, m.role]),
      );

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_super_admin')
        .eq('id', user!.id)
        .maybeSingle();

      const isSuper = profile?.is_super_admin === true;

      return (charities ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        default_tz: c.default_tz,
        role: roleByCharity.get(c.id) ?? (isSuper ? 'super_admin' : 'rep'),
      }));
    },
  });
}

export interface CharityMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: 'admin' | 'rep';
}

// Accepted members of a charity, for admin pickers. Backed by the
// list_charity_members SECURITY DEFINER RPC, which only returns rows when the
// caller is an admin of the charity or a super admin (empty otherwise, no
// error) -- so this is safe to call from any context. See
// 20260525020000_member_status.sql.
export function useCharityMembers(charityId: string | null | undefined) {
  return useQuery({
    queryKey: ['charity_members_named', charityId],
    enabled: !!charityId,
    queryFn: async (): Promise<CharityMember[]> => {
      const { data, error } = await supabase.rpc('list_charity_members', {
        c_id: charityId!,
      });
      if (error) throw error;
      return (data ?? [])
        .filter((m) => m.accepted_at !== null)
        .map((m) => ({
          user_id: m.user_id,
          full_name: m.full_name,
          email: m.email,
          role: m.role,
        }));
    },
    staleTime: 60_000,
  });
}
