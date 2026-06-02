import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';

export type DigestRecipientRow =
  Database['public']['Tables']['activity_digest_recipients']['Row'];

export interface DigestRecipient extends DigestRecipientRow {
  // Joined from profiles (PostgREST can't embed because user_id references
  // auth.users, not public.profiles - see list_charity_members migration note).
  email: string | null;
  full_name: string | null;
}

export interface UserOption {
  id: string;
  email: string | null;
  full_name: string | null;
}

// All users, for the recipient picker. Super admins can read every profile
// under RLS ("read own profile or super admin").
export function useAllUsers() {
  return useQuery({
    queryKey: ['all-users'],
    queryFn: async (): Promise<UserOption[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .order('email');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useDigestRecipients() {
  return useQuery({
    queryKey: ['digest-recipients'],
    queryFn: async (): Promise<DigestRecipient[]> => {
      const { data, error } = await supabase
        .from('activity_digest_recipients')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = data ?? [];
      const ids = Array.from(new Set(rows.map((r) => r.user_id)));
      const profileById = new Map<string, { email: string | null; full_name: string | null }>();
      if (ids.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', ids);
        for (const p of profiles ?? []) {
          profileById.set(p.id, { email: p.email, full_name: p.full_name });
        }
      }
      return rows.map((r) => ({
        ...r,
        email: profileById.get(r.user_id)?.email ?? null,
        full_name: profileById.get(r.user_id)?.full_name ?? null,
      }));
    },
  });
}

export interface UpsertRecipientInput {
  id?: string;
  user_id: string;
  send_daily: boolean;
  send_weekly: boolean;
  scope: 'all' | 'specific';
  charity_ids: string[];
  enabled: boolean;
}

export function useUpsertRecipient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertRecipientInput) => {
      const payload = {
        user_id: input.user_id,
        send_daily: input.send_daily,
        send_weekly: input.send_weekly,
        scope: input.scope,
        charity_ids: input.scope === 'specific' ? input.charity_ids : [],
        enabled: input.enabled,
      };
      if (input.id) {
        const { error } = await supabase
          .from('activity_digest_recipients')
          .update(payload)
          .eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('activity_digest_recipients')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['digest-recipients'] }),
  });
}

export function useDeleteRecipient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('activity_digest_recipients')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['digest-recipients'] }),
  });
}
