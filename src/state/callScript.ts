import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import type { Database } from '@/lib/database.types';

export type CallScriptItemRow = Database['public']['Tables']['call_script_items']['Row'];
export type CallScriptTickRow = Database['public']['Tables']['call_script_ticks']['Row'];

export function useCallScriptItems(charityId: string | null | undefined) {
  return useQuery({
    queryKey: ['call_script', charityId],
    enabled: !!charityId,
    queryFn: async (): Promise<CallScriptItemRow[]> => {
      const { data, error } = await supabase
        .from('call_script_items')
        .select('*')
        .eq('charity_id', charityId!)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateCallScriptItem() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { charity_id: string; body: string; sort_order?: number }) => {
      const { data, error } = await supabase
        .from('call_script_items')
        .insert({
          charity_id: input.charity_id,
          body: input.body,
          sort_order: input.sort_order ?? 0,
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as CallScriptItemRow;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['call_script', row.charity_id] });
    },
  });
}

export function useUpdateCallScriptItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      charity_id: string;
      patch: Partial<Pick<CallScriptItemRow, 'body' | 'sort_order'>>;
    }) => {
      const { error } = await supabase
        .from('call_script_items')
        .update(args.patch)
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['call_script', vars.charity_id] });
    },
  });
}

export function useDeleteCallScriptItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; charity_id: string }) => {
      const { error } = await supabase.from('call_script_items').delete().eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['call_script', vars.charity_id] });
    },
  });
}

export function useCallScriptTicks(customerId: string | null | undefined) {
  return useQuery({
    queryKey: ['call_script_ticks', customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<CallScriptTickRow[]> => {
      const { data, error } = await supabase
        .from('call_script_ticks')
        .select('*')
        .eq('customer_id', customerId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Toggle a tick. If `currentlyTicked` is true we delete, otherwise we insert.
 * The DB trigger fills in charity_id and ticked_by, so callers only need
 * { customer_id, item_id, currentlyTicked }.
 */
export function useToggleCallScriptTick() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      customer_id: string;
      item_id: string;
      currentlyTicked: boolean;
    }) => {
      if (args.currentlyTicked) {
        const { error } = await supabase
          .from('call_script_ticks')
          .delete()
          .eq('customer_id', args.customer_id)
          .eq('item_id', args.item_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('call_script_ticks')
          .insert({ customer_id: args.customer_id, item_id: args.item_id });
        if (error) throw error;
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['call_script_ticks', vars.customer_id] });
    },
  });
}
