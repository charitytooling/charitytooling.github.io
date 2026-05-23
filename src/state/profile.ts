import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { supabase } from '@/lib/supabase';

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url, is_super_admin')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
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
