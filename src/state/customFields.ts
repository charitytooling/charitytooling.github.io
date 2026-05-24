import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import type { Database } from '@/lib/database.types';

export type CustomerFieldDefRow = Database['public']['Tables']['customer_field_defs']['Row'];
export type CustomerFieldDefInsert = Database['public']['Tables']['customer_field_defs']['Insert'];
export type CustomerFieldDefUpdate = Database['public']['Tables']['customer_field_defs']['Update'];

export type CustomerFieldValueRow = Database['public']['Tables']['customer_field_values']['Row'];

export type CustomerFieldKind = CustomerFieldDefRow['kind'];

export const CUSTOM_FIELD_KINDS: readonly CustomerFieldKind[] = [
  'text',
  'url',
  'email',
  'tel',
  'number',
  'money',
];

// -----------------------------------------------------------------------------
// Definitions (per-charity)
// -----------------------------------------------------------------------------

/**
 * Active (non-archived) field definitions for a charity, ordered the way the
 * Update form should render them.
 */
export function useCustomFieldDefs(charityId: string | null | undefined) {
  return useQuery({
    queryKey: ['custom-field-defs', charityId, 'active'],
    enabled: !!charityId,
    queryFn: async (): Promise<CustomerFieldDefRow[]> => {
      const { data, error } = await supabase
        .from('customer_field_defs')
        .select('*')
        .eq('charity_id', charityId!)
        .is('archived_at', null)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Same as `useCustomFieldDefs` but includes archived rows. Used by the Manage
 * fields UI so admins can see and restore archived defs.
 */
export function useAllCustomFieldDefs(charityId: string | null | undefined) {
  return useQuery({
    queryKey: ['custom-field-defs', charityId, 'all'],
    enabled: !!charityId,
    queryFn: async (): Promise<CustomerFieldDefRow[]> => {
      const { data, error } = await supabase
        .from('customer_field_defs')
        .select('*')
        .eq('charity_id', charityId!)
        .order('archived_at', { ascending: true, nullsFirst: true })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function invalidateDefs(qc: ReturnType<typeof useQueryClient>, charityId: string) {
  qc.invalidateQueries({ queryKey: ['custom-field-defs', charityId, 'active'] });
  qc.invalidateQueries({ queryKey: ['custom-field-defs', charityId, 'all'] });
}

export function useCreateFieldDef() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      charity_id: string;
      label: string;
      kind: CustomerFieldKind;
      sort_order?: number;
    }): Promise<CustomerFieldDefRow> => {
      const { data, error } = await supabase
        .from('customer_field_defs')
        .insert({
          charity_id: input.charity_id,
          label: input.label,
          kind: input.kind,
          sort_order: input.sort_order ?? 0,
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as CustomerFieldDefRow;
    },
    onSuccess: (row) => invalidateDefs(qc, row.charity_id),
  });
}

export function useUpdateFieldDef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      charity_id: string;
      patch: Partial<Pick<CustomerFieldDefRow, 'label' | 'kind' | 'sort_order' | 'archived_at'>>;
    }) => {
      const { error } = await supabase
        .from('customer_field_defs')
        .update(args.patch)
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => invalidateDefs(qc, vars.charity_id),
  });
}

/**
 * Soft-delete: stamps `archived_at`. Existing `customer_field_values` are
 * left in place so the data can be recovered by restoring the def. Hard
 * delete is intentionally omitted from the UI (cascade only fires on a real
 * DELETE which requires a super admin in practice).
 */
export function useArchiveFieldDef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; charity_id: string }) => {
      const { error } = await supabase
        .from('customer_field_defs')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => invalidateDefs(qc, vars.charity_id),
  });
}

export function useRestoreFieldDef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; charity_id: string }) => {
      const { error } = await supabase
        .from('customer_field_defs')
        .update({ archived_at: null })
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => invalidateDefs(qc, vars.charity_id),
  });
}

// -----------------------------------------------------------------------------
// Values (per-customer)
// -----------------------------------------------------------------------------

export type FieldValueLookup = Record<string, CustomerFieldValueRow>;

/**
 * Per-customer values keyed by field_def_id for O(1) lookup. Empty `{}` if
 * the customer has none yet.
 */
export function useCustomerFieldValues(customerId: string | null | undefined) {
  return useQuery({
    queryKey: ['customer-field-values', customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<FieldValueLookup> => {
      const { data, error } = await supabase
        .from('customer_field_values')
        .select('*')
        .eq('customer_id', customerId!);
      if (error) throw error;
      const out: FieldValueLookup = {};
      for (const row of data ?? []) out[row.field_def_id] = row;
      return out;
    },
  });
}

/**
 * Upsert a single value for (customer, def). The DB trigger fills charity_id
 * from the parent customer, so callers only need to send
 * { customer_id, field_def_id, value }.
 */
export function useUpsertFieldValue() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: {
      customer_id: string;
      field_def_id: string;
      value: string | null;
    }) => {
      const { error } = await supabase
        .from('customer_field_values')
        .upsert(
          {
            customer_id: args.customer_id,
            field_def_id: args.field_def_id,
            value: args.value,
            updated_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'customer_id,field_def_id' },
        );
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['customer-field-values', vars.customer_id] });
    },
  });
}
