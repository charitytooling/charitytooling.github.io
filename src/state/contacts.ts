import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import type { Database } from '@/lib/database.types';

export type ContactRow = Database['public']['Tables']['customer_contacts']['Row'];
export type ContactInsert = Database['public']['Tables']['customer_contacts']['Insert'];
export type ContactUpdate = Database['public']['Tables']['customer_contacts']['Update'];

function invalidate(qc: ReturnType<typeof useQueryClient>, customerId: string) {
  qc.invalidateQueries({ queryKey: ['customer', customerId] });
  qc.invalidateQueries({ queryKey: ['customers'] });
  qc.invalidateQueries({ queryKey: ['contacts', customerId] });
}

export function useContacts(customerId: string | undefined) {
  return useQuery({
    queryKey: ['contacts', customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<ContactRow[]> => {
      const { data, error } = await supabase
        .from('customer_contacts')
        .select('*')
        .eq('customer_id', customerId!)
        .order('is_primary', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: ContactInsert): Promise<ContactRow> => {
      const payload = { created_by: user?.id ?? null, ...input };
      const { data, error } = await supabase
        .from('customer_contacts')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as ContactRow;
    },
    onSuccess: (row) => invalidate(qc, row.customer_id),
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; customer_id: string; patch: ContactUpdate }) => {
      const { error } = await supabase
        .from('customer_contacts')
        .update(args.patch)
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => invalidate(qc, vars.customer_id),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; customer_id: string }) => {
      const { error } = await supabase
        .from('customer_contacts')
        .delete()
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => invalidate(qc, vars.customer_id),
  });
}

/**
 * Swap which contact is primary for a customer. Two sequential awaits so we
 * don't trip the partial unique index `(customer_id) where is_primary`.
 * Concurrent collisions are rejected cleanly by Postgres and surface to the
 * caller.
 */
export function useSetPrimaryContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; customer_id: string }) => {
      const clear = await supabase
        .from('customer_contacts')
        .update({ is_primary: false })
        .eq('customer_id', args.customer_id)
        .eq('is_primary', true);
      if (clear.error) throw clear.error;
      const set = await supabase
        .from('customer_contacts')
        .update({ is_primary: true })
        .eq('id', args.id);
      if (set.error) throw set.error;
    },
    onSuccess: (_data, vars) => invalidate(qc, vars.customer_id),
  });
}
