// Single source of truth for "which charity columns must be populated for
// each gated donation method to light up on the contact page". Consumed by
// both the contact-page modal (to enable/disable the method buttons) and
// the admin Donation instructions card (to surface a status banner +
// required-field markers). Keep this list aligned with the server
// validators in supabase/functions/send-payment-instructions/index.ts --
// validateCheckConfig / validateAchConfig must accept exactly the same
// rows.
//
// Cash, Stock, and Other are intentionally absent: Cash + Other have no
// gate (always enabled in the modal), Stock is hard-coded "Coming soon".

import type { Database } from '@/lib/database.types';

type CharityRow = Database['public']['Tables']['charities']['Row'];

export type GatedMethod = 'check' | 'ach' | 'card';

export interface GateFieldSpec {
  key: keyof CharityRow;
  label: string;
}

const SPECS: Record<GatedMethod, GateFieldSpec[]> = {
  check: [
    { key: 'check_payable_to', label: 'Make checks payable to' },
    { key: 'check_mail_to_line1', label: 'Mail to (street / PO Box)' },
  ],
  ach: [
    { key: 'ach_bank_name', label: 'Bank name' },
    { key: 'ach_routing_number', label: 'Routing (ABA)' },
    { key: 'ach_account_number', label: 'Account #' },
  ],
  card: [
    // The card gate is on Stripe Connect onboarding state, not on a
    // typeable text field, so the admin UI surfaces the banner only --
    // the existing CardStripeStatus panel drives the action.
    { key: 'stripe_account_id', label: 'Stripe Connect account' },
    { key: 'stripe_charges_enabled', label: 'Stripe charges enabled' },
  ],
};

export function gateFields(method: GatedMethod): GateFieldSpec[] {
  return SPECS[method];
}

// Treat empty strings as missing so an admin who blanks a field clearly
// flips the gate closed. Booleans (stripe_charges_enabled) are missing
// when falsy; nulls are missing for any column type.
function isFieldMissing(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (typeof value === 'boolean') return value === false;
  return false;
}

export function missingForGate(
  method: GatedMethod,
  charity: Partial<CharityRow> | null | undefined,
): GateFieldSpec[] {
  if (!charity) return SPECS[method];
  return SPECS[method].filter((f) => isFieldMissing(charity[f.key]));
}

export function isGateOpen(
  method: GatedMethod,
  charity: Partial<CharityRow> | null | undefined,
): boolean {
  return missingForGate(method, charity).length === 0;
}

export function methodLabel(method: GatedMethod): string {
  switch (method) {
    case 'check':
      return 'Check';
    case 'ach':
      return 'ACH / Wire';
    case 'card':
      return 'Card';
  }
}
