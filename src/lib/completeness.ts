// Mirror of private.compute_completeness in
// supabase/migrations/20260525000000_customer_contacts.sql.
// If you change one, change the other.
//
// Each of the 10 fields below contributes 10 points to a customer's
// completeness_score. The score itself is computed server-side and read off
// the row; this module exists so the UI can describe *which* fields are
// missing without re-querying. The visible percentage is always trusted from
// customers.completeness_score; we only derive the labels here.
import type { CustomerContactRow, CustomerRow } from '@/state/customers';

export type CompletenessFieldKey =
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'website'
  | 'address_line1'
  | 'city'
  | 'state'
  | 'postal_code'
  | 'preferred_contact_method';

export type CompletenessField = {
  key: CompletenessFieldKey;
  label: string;
  source: 'customer' | 'primary_contact';
  domId: string;
};

export const COMPLETENESS_FIELDS: CompletenessField[] = [
  { key: 'first_name', label: 'Primary contact: first name', source: 'primary_contact', domId: 'field-first_name' },
  { key: 'last_name', label: 'Primary contact: last name', source: 'primary_contact', domId: 'field-last_name' },
  { key: 'email', label: 'Primary contact: email', source: 'primary_contact', domId: 'field-email' },
  { key: 'phone', label: 'Primary contact: phone', source: 'primary_contact', domId: 'field-phone' },
  { key: 'website', label: 'Website', source: 'customer', domId: 'field-website' },
  { key: 'address_line1', label: 'Address line 1', source: 'customer', domId: 'field-address_line1' },
  { key: 'city', label: 'City', source: 'customer', domId: 'field-city' },
  { key: 'state', label: 'State', source: 'customer', domId: 'field-state' },
  { key: 'postal_code', label: 'Postal code', source: 'customer', domId: 'field-postal_code' },
  { key: 'preferred_contact_method', label: 'Preferred contact method', source: 'customer', domId: 'field-preferred_contact_method' },
];

export function isFilled(value: unknown, key: CompletenessFieldKey): boolean {
  if (value == null) return false;
  // preferred_contact_method is an enum/select column; SQL only checks NOT NULL.
  if (key === 'preferred_contact_method') return true;
  return typeof value === 'string' && value.trim().length > 0;
}

export function getMissingFields(
  customer: CustomerRow,
  primary: CustomerContactRow | null | undefined,
): CompletenessField[] {
  return COMPLETENESS_FIELDS.filter((f) => {
    const raw =
      f.source === 'primary_contact'
        ? (primary?.[f.key as keyof CustomerContactRow] as unknown)
        : (customer[f.key as keyof CustomerRow] as unknown);
    return !isFilled(raw, f.key);
  });
}
