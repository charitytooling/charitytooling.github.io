import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';

export type DonationRow = Database['public']['Tables']['donations']['Row'];

export function useDonations(customerId: string | undefined) {
  return useQuery({
    queryKey: ['donations', customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<DonationRow[]> => {
      const { data, error } = await supabase
        .from('donations')
        .select('*')
        .eq('customer_id', customerId!)
        .order('received_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useDeleteDonation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('donations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['donations'] });
    },
  });
}

export function formatCents(cents: number, currency = 'usd'): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  });
}

export function useReceiptUrl() {
  return useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
