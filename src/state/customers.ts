import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import type { Database } from '@/lib/database.types';

type CustomerBase = Database['public']['Tables']['customers']['Row'];
export type CustomerContactRow = Database['public']['Tables']['customer_contacts']['Row'];

// The select used by useCustomers / useCustomer pulls customer_contacts in
// the same query. Each CustomerRow therefore carries its contacts inline,
// which keeps the Ledger row preview, search haystack, and Contact header
// rendering a single fetch instead of N+1.
export type CustomerRow = CustomerBase & {
  customer_contacts: CustomerContactRow[];
};

const CUSTOMER_SELECT = '*, customer_contacts(*)';

export function useCustomers(
  charityId: string | null,
  opts: { includeArchived?: boolean } = {},
) {
  return useQuery({
    queryKey: ['customers', charityId, opts.includeArchived ? 'all' : 'active'],
    enabled: !!charityId,
    queryFn: async (): Promise<CustomerRow[]> => {
      let q = supabase.from('customers').select(CUSTOMER_SELECT).eq('charity_id', charityId!);
      if (!opts.includeArchived) q = q.is('archived_at', null);
      const { data, error } = await q
        .order('display_name', { ascending: true, nullsFirst: false })
        .limit(10000);
      if (error) throw error;
      return (data ?? []).map(normalizeCustomer);
    },
  });
}

export function useCustomer(customerId: string | undefined) {
  return useQuery({
    queryKey: ['customer', customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<CustomerRow> => {
      const { data, error } = await supabase
        .from('customers')
        .select(CUSTOMER_SELECT)
        .eq('id', customerId!)
        .single();
      if (error) throw error;
      return normalizeCustomer(data);
    },
  });
}

export function useUpdateCustomer(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<CustomerBase>) => {
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
      const { data, error } = await supabase
        .from('customers')
        .insert(input)
        .select(CUSTOMER_SELECT)
        .single();
      if (error) throw error;
      return normalizeCustomer(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

function invalidateAfterCustomerWrite(qc: ReturnType<typeof useQueryClient>, customerId: string) {
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'customers' });
  qc.invalidateQueries({ queryKey: ['customer', customerId] });
  qc.invalidateQueries({ queryKey: ['next-incomplete'] });
  qc.invalidateQueries({ queryKey: ['customer_ids_with_open_followups'] });
  qc.invalidateQueries({ queryKey: ['follow_ups_due_by_customer'] });
}

export function useArchiveCustomer(customerId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('customers')
        .update({ archived_at: new Date().toISOString(), archived_by: user?.id ?? null })
        .eq('id', customerId);
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterCustomerWrite(qc, customerId),
  });
}

export function useRestoreCustomer(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('customers')
        .update({ archived_at: null, archived_by: null })
        .eq('id', customerId);
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterCustomerWrite(qc, customerId),
  });
}

// Hard delete. RLS only permits this when the caller is a super admin;
// non-super callers get a postgres error that surfaces to the UI.
export function useDeleteCustomer(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('customers').delete().eq('id', customerId);
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterCustomerWrite(qc, customerId),
  });
}

// -----------------------------------------------------------------------------
// Contact helpers (kept here so the rest of the app can stay schema-agnostic)
// -----------------------------------------------------------------------------

// Structural shape: anything with the four fields displayName needs. Lets
// the Calendar (which fetches a narrower select) reuse displayName without
// having to widen its column list.
type DisplayContactShape = Pick<CustomerContactRow, 'first_name' | 'last_name' | 'email' | 'is_primary'>;

export function primaryContact<T extends DisplayContactShape>(
  c: { customer_contacts?: T[] } | null | undefined,
): T | null {
  if (!c?.customer_contacts) return null;
  return c.customer_contacts.find((x) => x.is_primary) ?? null;
}

/**
 * Stable ordering for the Contact + Update People sections: primary first,
 * then by sort_order, then by created_at.
 */
export function sortedContacts(c: Pick<CustomerRow, 'customer_contacts'> | null | undefined): CustomerContactRow[] {
  const list = c?.customer_contacts ?? [];
  return [...list].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.created_at.localeCompare(b.created_at);
  });
}

export function displayName(
  c:
    | ({ display_name: string | null } & { customer_contacts?: DisplayContactShape[] })
    | null
    | undefined,
): string {
  if (!c) return '(no name)';
  if (c.display_name && c.display_name.trim()) return c.display_name;
  const primary = primaryContact(c);
  if (primary) {
    const joined = `${primary.first_name ?? ''} ${primary.last_name ?? ''}`.trim();
    if (joined) return joined;
    if (primary.email && primary.email.trim()) return primary.email;
  }
  return '(no name)';
}

// Supabase returns the embedded relation as `customer_contacts: [...]`. The
// nested-select returns rows in arbitrary order; ensure the array is at
// least an array so downstream helpers can rely on .find / .map / .filter.
//
// The input is typed as `unknown` because supabase-js's nested-select type
// inference produces a `SelectQueryError` for `customer_contacts` until
// relationship metadata is declared on the generated `Database` types.
// The runtime shape is the same either way, so we cast on the way out.
function normalizeCustomer(row: unknown): CustomerRow {
  const r = row as CustomerBase & { customer_contacts?: CustomerContactRow[] | null };
  return {
    ...r,
    customer_contacts: r.customer_contacts ?? [],
  } as CustomerRow;
}
