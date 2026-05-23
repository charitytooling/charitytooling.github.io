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
    },
  });
}
