import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import type { Database } from '@/lib/database.types';

export type FaqRow = Database['public']['Tables']['faq_entries']['Row'];

export function useFaqEntries(charityId: string | null | undefined) {
  return useQuery({
    queryKey: ['faq', charityId],
    enabled: !!charityId,
    queryFn: async (): Promise<FaqRow[]> => {
      const { data, error } = await supabase
        .from('faq_entries')
        .select('*')
        .eq('charity_id', charityId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateFaqEntry() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { charity_id: string; question: string; answer: string }) => {
      const { data, error } = await supabase
        .from('faq_entries')
        .insert({
          charity_id: input.charity_id,
          question: input.question,
          answer: input.answer,
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as FaqRow;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['faq', row.charity_id] });
    },
  });
}

export function useUpdateFaqEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      charity_id: string;
      patch: Partial<Pick<FaqRow, 'question' | 'answer'>>;
    }) => {
      const { error } = await supabase.from('faq_entries').update(args.patch).eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['faq', vars.charity_id] });
    },
  });
}

export function useDeleteFaqEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; charity_id: string }) => {
      const { error } = await supabase.from('faq_entries').delete().eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['faq', vars.charity_id] });
    },
  });
}
