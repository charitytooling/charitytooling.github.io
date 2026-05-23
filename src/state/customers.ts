import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';

export type CustomerRow = Database['public']['Tables']['customers']['Row'];

export function useCustomers(charityId: string | null) {
  return useQuery({
    queryKey: ['customers', charityId],
    enabled: !!charityId,
    queryFn: async (): Promise<CustomerRow[]> => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('charity_id', charityId!)
        .order('display_name', { ascending: true, nullsFirst: false })
        .order('last_name', { ascending: true, nullsFirst: false })
        .limit(10000);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCustomer(customerId: string | undefined) {
  return useQuery({
    queryKey: ['customer', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateCustomer(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<CustomerRow>) => {
      const { error } = await supabase.from('customers').update(patch).eq('id', customerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', customerId] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Database['public']['Tables']['customers']['Insert']) => {
      const { data, error } = await supabase.from('customers').insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export function displayName(c: Pick<CustomerRow, 'first_name' | 'last_name' | 'display_name' | 'email'>): string {
  if (c.display_name && c.display_name.trim()) return c.display_name;
  const joined = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
  if (joined) return joined;
  return c.email ?? '(no name)';
}
