import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { supabase } from '@/lib/supabase';

export type ContactQueueSort =
  | 'stalest_first'
  | 'followup_due_soonest'
  | 'name_az'
  | 'newest_added'
  | 'random';

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url, is_super_admin, contact_queue_sort')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateContactSort() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contact_queue_sort: ContactQueueSort) => {
      const { error } = await supabase
        .from('profiles')
        .update({ contact_queue_sort })
        .eq('id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile', user?.id] }),
  });
}

export function useIsSuperAdmin(): boolean {
  const { data } = useProfile();
  return data?.is_super_admin === true;
}

export function useMyMemberships() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['memberships', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('charity_members')
        .select('charity_id, role')
        .eq('user_id', user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useIsAnyCharityAdmin(): boolean {
  const isSuper = useIsSuperAdmin();
  const { data } = useMyMemberships();
  if (isSuper) return true;
  return (data ?? []).some((m) => m.role === 'admin');
}
