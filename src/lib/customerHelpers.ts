import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';

type CustomerBase = Database['public']['Tables']['customers']['Row'];
type CustomerInsert = Database['public']['Tables']['customers']['Insert'];

export type ContactDraft = Partial<
  Pick<
    Database['public']['Tables']['customer_contacts']['Row'],
    'first_name' | 'last_name' | 'email' | 'phone' | 'note'
  >
>;

// An org as it arrives from the DAF import link or the in-app Search results.
export type LedgerOrgInput = {
  ein: string;
  name: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  revenue?: number | null;
  income?: number | null;
  assets?: number | null;
  tax_period?: string | null;
};

// Map a BMF/DAF org onto the customers columns. Single source of truth shared
// by ImportDaf (the cross-site link flow) and Search (in-app add-to-ledger).
export function orgToCustomerInsert(o: LedgerOrgInput, charityId: string): CustomerInsert {
  return {
    charity_id: charityId,
    ein: o.ein,
    display_name: o.name,
    address_line1: o.street ?? null,
    city: o.city ?? null,
    state: o.state ?? null,
    postal_code: o.zip ?? null,
    filing_revenue: o.revenue ?? null,
    filing_income: o.income ?? null,
    filing_assets: o.assets ?? null,
    filing_tax_period: o.tax_period ?? null,
  };
}

export function contactHasInput(c: ContactDraft): boolean {
  return (Object.values(c) as (string | null | undefined)[]).some(
    (v) => v != null && String(v).trim() !== '',
  );
}

// Resolve an existing customer for this charity by EIN (the partial unique
// index customers_charity_ein_uniq guarantees at most one).
export async function findCustomerIdByEin(
  charityId: string,
  ein: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .eq('charity_id', charityId)
    .eq('ein', ein)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

// Update the existing primary contact, or insert one if none exists yet.
export async function upsertPrimaryContact(
  customerId: string,
  charityId: string,
  contact: ContactDraft,
): Promise<void> {
  const upd = await supabase
    .from('customer_contacts')
    .update(contact)
    .eq('customer_id', customerId)
    .eq('is_primary', true)
    .select('id');
  if (upd.error) throw upd.error;
  if (!upd.data || upd.data.length === 0) {
    const ins = await supabase.from('customer_contacts').insert({
      ...contact,
      customer_id: customerId,
      charity_id: charityId,
      is_primary: true,
    });
    if (ins.error) throw ins.error;
  }
}

export type SaveResult = { customerId: string; wasCreated: boolean };

// Upsert a customer (keyed by charity_id + ein) from a payload, optionally
// writing a primary contact. The caller may pass a pre-resolved existingId to
// skip the lookup (ImportDaf already batches the existence check). Returns
// whether a new row was created so callers can label imported vs. replaced.
export async function upsertCustomerWithContact(
  charityId: string,
  payload: Partial<CustomerBase> & { ein?: string | null },
  contact?: ContactDraft,
  opts: { existingId?: string | null } = {},
): Promise<SaveResult> {
  let existingId = opts.existingId ?? null;
  if (existingId == null && payload.ein) {
    existingId = await findCustomerIdByEin(charityId, payload.ein);
  }

  let customerId: string;
  let wasCreated = false;
  if (existingId) {
    const { error } = await supabase.from('customers').update(payload).eq('id', existingId);
    if (error) throw error;
    customerId = existingId;
  } else {
    const { data, error } = await supabase
      .from('customers')
      .insert({ ...payload, charity_id: charityId })
      .select('id')
      .single();
    if (error) throw error;
    customerId = data!.id;
    wasCreated = true;
  }

  if (contact && contactHasInput(contact)) {
    await upsertPrimaryContact(customerId, charityId, contact);
  }
  return { customerId, wasCreated };
}
