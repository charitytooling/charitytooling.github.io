import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { supabase } from '@/lib/supabase';

export type ContactQueueSort =
  | 'stalest_first'
  | 'followup_due_soonest'
  | 'name_az'
  | 'newest_added'
  | 'random';

// Slim caption used under the Update tab's Next button. Settings keeps its own
// longer descriptive labels in CONTACT_SORT_OPTIONS.
export function contactSortShortLabel(sort: ContactQueueSort): string {
  switch (sort) {
    case 'stalest_first':
      return 'Last contacted, oldest first';
    case 'followup_due_soonest':
      return 'Open follow-up due soonest';
    case 'name_az':
      return 'Name A-Z';
    case 'newest_added':
      return 'Newest added';
    case 'random':
      return 'Random';
  }
}

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

// True iff the caller is super admin OR a charity admin of the specific
// charity. Mirrors private.is_admin_of(charity_id) on the server, used by
// UI gates that need to match the same RLS predicate (e.g. the Delete
// button on notes outside the 24h author window).
export function useIsCharityAdmin(charityId: string | null | undefined): boolean {
  const isSuper = useIsSuperAdmin();
  const { data } = useMyMemberships();
  if (isSuper) return true;
  if (!charityId) return false;
  return (data ?? []).some((m) => m.charity_id === charityId && m.role === 'admin');
}
