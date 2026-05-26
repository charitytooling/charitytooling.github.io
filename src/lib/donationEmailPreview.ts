// Shared donation-email preview helpers.
//
// Two call sites need to render the exact email a donor will receive:
//   - src/routes/admin/DonationInstructionsCard.tsx -- the admin "Preview
//     email" panel that shows what an admin's in-flight template edits look
//     like before they save.
//   - src/routes/contact/DonationModal.tsx -- the live preview inside the
//     "Help donor send" sub-flow that updates as the rep types a personal
//     note and switches between contacts.
//
// Both routes call the same helpers below so the previews stay in lock-step
// with each other and with the server. The actual byte-faithful mirror of
// the Edge Functions email assembler lives in src/lib/emailTemplate.ts; this
// module is the thin layer above it that resolves charity overrides, the
// donor greeting, and the rep-authored personal note. If you change the
// server side (supabase/functions/_shared/payment_email.ts or
// supabase/functions/send-payment-instructions/index.ts) update this file
// or the previews will drift from reality.
//
// `blockToRows` and `rowsToBlock` also live here because the admin form's
// save path needs the same jsonb<->row conversion the previews use.

import {
  assembleEmail,
  escapeHtml,
  markdownToEmailHtml,
  renderDataBlock,
  type DataBlockConfig,
  type DataBlockRow,
} from '@/lib/emailTemplate';
import type { Database } from '@/lib/database.types';

type CharityRow = Database['public']['Tables']['charities']['Row'];

// ---------------------------------------------------------------------------
// Form-shaped input. The admin tab passes its full react-hook-form
// `FormValues` (structurally a subtype of this); the modal builds a slim
// version straight from the saved charity row via `formishFromCharity`.
// ---------------------------------------------------------------------------

export interface PreviewFormish {
  check_payable_to?: string | null;
  check_mail_to_line1?: string | null;
  check_mail_to_line2?: string | null;
  check_mail_to_city?: string | null;
  check_mail_to_state?: string | null;
  check_mail_to_postal_code?: string | null;
  check_memo_default?: string | null;
  check_instructions_md?: string | null;
  check_subject_template?: string | null;
  check_body_template_md?: string | null;
  ach_bank_name?: string | null;
  ach_account_name?: string | null;
  ach_account_type?: string | null;
  ach_routing_number?: string | null;
  ach_account_number?: string | null;
  wire_swift_bic?: string | null;
  wire_intermediary_md?: string | null;
  ach_instructions_md?: string | null;
  ach_subject_template?: string | null;
  ach_body_template_md?: string | null;
  cash_subject_template?: string | null;
  cash_body_template_md?: string | null;
  card_subject_template?: string | null;
  card_body_template_md?: string | null;
  card_default_amount_cents?: number | null;
  // jsonb-as-array form for the data-block UI. The admin form populates
  // these from useFieldArray; the modal builds them by parsing the saved
  // jsonb on the charity row.
  check_data_block_rows?: DataBlockRow[];
  cash_data_block_rows?: DataBlockRow[];
  card_data_block_rows?: DataBlockRow[];
  ach_data_block_rows?: DataBlockRow[];
}

// ---------------------------------------------------------------------------
// Per-render context. Only supplied by the contact-page modal -- the admin
// tab passes no ctx so the historical "Hi Sample," + empty rep-message
// preview is preserved bit-for-bit.
// ---------------------------------------------------------------------------

export interface PreviewContext {
  // First/last name of the donor contact the email goes to. Mirrors what
  // supabase/functions/send-payment-instructions/index.ts does: greet by
  // first_name, fall back to last_name, otherwise omit the greeting.
  contactFirstName?: string | null;
  contactLastName?: string | null;
  // The customer's display_name the server passes to assembleEmail vars.
  // Used wherever an admin template references {{customer_display_name}}.
  customerDisplayName?: string | null;
  // Raw markdown the rep typed in the personal-note textarea. Wrapped the
  // same way the server wraps it (see `repMessageHtml` below) so
  // {{rep_message}} substitutions and the fallback-body order match what
  // donors actually receive.
  repMessageMd?: string | null;
}

interface RenderResult {
  subject: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Data-block jsonb <-> useFieldArray rows conversion. Lives here because
// both the preview helpers (this file) and the admin save path
// (DonationInstructionsCard.tsx) need it.
// ---------------------------------------------------------------------------

export function blockToRows(value: unknown): DataBlockRow[] {
  if (!value || typeof value !== 'object') return [];
  const v = value as { rows?: unknown };
  if (!Array.isArray(v.rows)) return [];
  return v.rows.filter((r): r is DataBlockRow => {
    if (!r || typeof r !== 'object') return false;
    const obj = r as Record<string, unknown>;
    if (obj.custom === true) {
      return typeof obj.label === 'string' && typeof obj.value === 'string';
    }
    return typeof obj.key === 'string';
  });
}

export function rowsToBlock(rows: DataBlockRow[] | undefined): DataBlockConfig | null {
  if (!rows) return null;
  const filtered = rows.filter((r) => {
    if ('custom' in r && r.custom) return r.label?.trim() && r.value?.trim();
    return true;
  });
  if (filtered.length === 0) return null;
  return { rows: filtered };
}

// Build a `PreviewFormish` straight from a saved charity row, for callers
// (the contact-page modal) that have no admin form to overlay on top.
export function formishFromCharity(charity: CharityRow): PreviewFormish {
  return {
    check_payable_to: charity.check_payable_to,
    check_mail_to_line1: charity.check_mail_to_line1,
    check_mail_to_line2: charity.check_mail_to_line2,
    check_mail_to_city: charity.check_mail_to_city,
    check_mail_to_state: charity.check_mail_to_state,
    check_mail_to_postal_code: charity.check_mail_to_postal_code,
    check_memo_default: charity.check_memo_default,
    check_instructions_md: charity.check_instructions_md,
    check_subject_template: charity.check_subject_template,
    check_body_template_md: charity.check_body_template_md,
    ach_bank_name: charity.ach_bank_name,
    ach_account_name: charity.ach_account_name,
    ach_account_type: charity.ach_account_type,
    ach_routing_number: charity.ach_routing_number,
    ach_account_number: charity.ach_account_number,
    wire_swift_bic: charity.wire_swift_bic,
    wire_intermediary_md: charity.wire_intermediary_md,
    ach_instructions_md: charity.ach_instructions_md,
    ach_subject_template: charity.ach_subject_template,
    ach_body_template_md: charity.ach_body_template_md,
    cash_subject_template: charity.cash_subject_template,
    cash_body_template_md: charity.cash_body_template_md,
    card_subject_template: charity.card_subject_template,
    card_body_template_md: charity.card_body_template_md,
    card_default_amount_cents: charity.card_default_amount_cents,
    check_data_block_rows: blockToRows(charity.check_data_block),
    cash_data_block_rows: blockToRows(charity.cash_data_block),
    card_data_block_rows: blockToRows(charity.card_data_block),
    ach_data_block_rows: blockToRows(charity.ach_data_block),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildCharityForPreview(charity: CharityRow, v: PreviewFormish): Record<string, unknown> {
  // Merge unsaved form values onto the live charity row so the preview
  // reflects edits the admin hasn't saved yet. For the modal the form-ish
  // is built from the saved row, so this collapses to a no-op merge.
  return {
    ...charity,
    check_payable_to: v.check_payable_to ?? charity.check_payable_to,
    check_mail_to_line1: v.check_mail_to_line1 ?? charity.check_mail_to_line1,
    check_mail_to_line2: v.check_mail_to_line2 ?? charity.check_mail_to_line2,
    check_mail_to_city: v.check_mail_to_city ?? charity.check_mail_to_city,
    check_mail_to_state: v.check_mail_to_state ?? charity.check_mail_to_state,
    check_mail_to_postal_code: v.check_mail_to_postal_code ?? charity.check_mail_to_postal_code,
    check_memo_default: v.check_memo_default ?? charity.check_memo_default,
    check_instructions_md: v.check_instructions_md ?? charity.check_instructions_md,
    ach_bank_name: v.ach_bank_name ?? charity.ach_bank_name,
    ach_account_name: v.ach_account_name ?? charity.ach_account_name,
    ach_account_type: v.ach_account_type ?? charity.ach_account_type,
    ach_routing_number: v.ach_routing_number ?? charity.ach_routing_number,
    ach_account_number: v.ach_account_number ?? charity.ach_account_number,
    wire_swift_bic: v.wire_swift_bic ?? charity.wire_swift_bic,
    wire_intermediary_md: v.wire_intermediary_md ?? charity.wire_intermediary_md,
    ach_instructions_md: v.ach_instructions_md ?? charity.ach_instructions_md,
  };
}

function commonVars(charity: CharityRow, ctx: PreviewContext | undefined): Record<string, string> {
  // The admin tab passes no ctx; preserve the historical sample names so
  // existing previews are unchanged.
  if (!ctx) {
    return {
      charity_name: charity.name,
      ein: charity.ein ?? '',
      customer_display_name: 'Sample Donor',
      contact_first_name: 'Sample',
      contact_last_name: 'Donor',
    };
  }
  const first = ctx.contactFirstName?.trim() ?? '';
  const last = ctx.contactLastName?.trim() ?? '';
  const display = ctx.customerDisplayName?.trim()
    ?? `${first} ${last}`.trim();
  return {
    charity_name: charity.name,
    ein: charity.ein ?? '',
    customer_display_name: display,
    contact_first_name: first,
    contact_last_name: last,
  };
}

function greetingHtml(ctx: PreviewContext | undefined): string {
  // Admin (no ctx): keep the historical "Hi Sample," sample greeting.
  if (!ctx) return '<p>Hi Sample,</p>';
  // Modal: mirror the server -- first name wins, fall back to last name,
  // otherwise omit the greeting line entirely.
  const first = ctx.contactFirstName?.trim();
  const last = ctx.contactLastName?.trim();
  const name = first || last || '';
  if (!name) return '';
  return `<p>Hi ${escapeHtml(name)},</p>`;
}

function repMessageHtml(ctx: PreviewContext | undefined): string {
  const md = ctx?.repMessageMd?.trim();
  if (!md) return '';
  // Identical wrapper to supabase/functions/send-payment-instructions:
  //   `<div style="margin:0 0 16px">${markdownToEmailHtml(...)}</div>`
  return `<div style="margin:0 0 16px">${markdownToEmailHtml(md)}</div>`;
}

// ---------------------------------------------------------------------------
// The four per-method renderers. Signatures match the prior local helpers in
// DonationInstructionsCard.tsx with one added optional `ctx` argument.
// ---------------------------------------------------------------------------

export function renderCheckPreview(
  charity: CharityRow,
  v: PreviewFormish,
  ctx?: PreviewContext,
): RenderResult {
  const charityForPreview = buildCharityForPreview(charity, v);
  const dataBlockHtml = renderDataBlock({
    method: 'check',
    charity: charityForPreview,
    config: rowsToBlock(v.check_data_block_rows),
  });
  const introMd = v.check_instructions_md ?? charity.check_instructions_md;
  const introHtml = introMd?.trim()
    ? markdownToEmailHtml(introMd.trim())
    : `<p>Thank you for considering a gift to <strong>${escapeHtml(charity.name)}</strong>. Here is how to send a contribution by check:</p>`;
  const repHtml = repMessageHtml(ctx);
  const fallbackBodyHtml = `
    ${greetingHtml(ctx)}
    ${repHtml}
    ${introHtml}
    ${dataBlockHtml}
    ${charity.ein ? `<p style="font-size:13px;color:#64748b">EIN: ${escapeHtml(charity.ein)}</p>` : ''}
  `;
  return assembleEmail({
    subjectTemplate: v.check_subject_template ?? null,
    bodyTemplateMd: v.check_body_template_md ?? null,
    fallbackSubject: `How to donate by check to ${charity.name}`,
    fallbackBodyHtml,
    vars: {
      ...commonVars(charity, ctx),
      rep_message: repHtml,
      data_block: dataBlockHtml,
    },
  });
}

export function renderAchPreview(
  charity: CharityRow,
  v: PreviewFormish,
  ctx?: PreviewContext,
): RenderResult {
  const charityForPreview = buildCharityForPreview(charity, v);
  const dataBlockHtml = renderDataBlock({
    method: 'ach',
    charity: charityForPreview,
    config: rowsToBlock(v.ach_data_block_rows),
  });
  const introMd = v.ach_instructions_md ?? charity.ach_instructions_md;
  const introHtml = introMd?.trim()
    ? markdownToEmailHtml(introMd.trim())
    : `<p>Thank you for considering a gift to <strong>${escapeHtml(charity.name)}</strong>. Here are the bank details for an ACH or wire transfer:</p>`;
  const intermediaryMd = v.wire_intermediary_md ?? charity.wire_intermediary_md;
  const intermediary = intermediaryMd?.trim()
    ? `<div style="margin-top:16px"><div style="color:#64748b;font-size:13px;margin-bottom:4px">Intermediary / wire instructions</div>${markdownToEmailHtml(intermediaryMd.trim())}</div>`
    : '';
  const repHtml = repMessageHtml(ctx);
  const fallbackBodyHtml = `
    ${greetingHtml(ctx)}
    ${repHtml}
    ${introHtml}
    ${dataBlockHtml}
    ${intermediary}
    ${charity.ein ? `<p style="font-size:13px;color:#64748b">EIN: ${escapeHtml(charity.ein)}</p>` : ''}
  `;
  return assembleEmail({
    subjectTemplate: v.ach_subject_template ?? null,
    bodyTemplateMd: v.ach_body_template_md ?? null,
    fallbackSubject: `How to donate by ACH or wire to ${charity.name}`,
    fallbackBodyHtml,
    vars: {
      ...commonVars(charity, ctx),
      rep_message: repHtml,
      data_block: dataBlockHtml,
    },
  });
}

export function renderCashPreview(
  charity: CharityRow,
  v: PreviewFormish,
  ctx?: PreviewContext,
): RenderResult {
  const sampleAmountCents = 2500;
  const amountStr = (sampleAmountCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  const sampleReceiptNo = '0001';
  const charityForPreview = buildCharityForPreview(charity, v);
  const dataBlockHtml = renderDataBlock({
    method: 'cash',
    charity: charityForPreview,
    config: rowsToBlock(v.cash_data_block_rows),
    cashExtra: { receipt_number: sampleReceiptNo, amount: amountStr },
  });
  const disclaimer = charity.receipt_disclaimer?.trim() ?? '';
  const fallbackBodyHtml = `
    <p style="font-size:12px;color:#64748b;margin:0 0 12px">
      Sample preview - the real receipt number and amount are filled in when the rep records the gift.
    </p>
    <p>Thank you for your contribution to <strong>${escapeHtml(charity.name)}</strong>.</p>
    <p>Your receipt #${sampleReceiptNo} for ${amountStr} is attached.</p>
    ${disclaimer ? `<p>${escapeHtml(disclaimer)}</p>` : ''}
    ${dataBlockHtml ? `<p style="font-size:12px;color:#64748b;margin:8px 0 0">An IRS-compliant receipt PDF will be attached to the real email.</p>` : ''}
  `;
  return assembleEmail({
    subjectTemplate: v.cash_subject_template ?? null,
    bodyTemplateMd: v.cash_body_template_md ?? null,
    fallbackSubject: `Donation receipt #${sampleReceiptNo} from ${charity.name}`,
    fallbackBodyHtml,
    vars: {
      ...commonVars(charity, ctx),
      rep_message: '',
      data_block: dataBlockHtml,
      receipt_number: sampleReceiptNo,
      amount: amountStr,
    },
  });
}

export function renderCardPreview(
  charity: CharityRow,
  v: PreviewFormish,
  ctx?: PreviewContext,
): RenderResult {
  const sampleAmountCents = v.card_default_amount_cents ?? 5000;
  const amountStr = (sampleAmountCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  const sampleDonateUrl = 'https://invoice.stripe.com/i/sample_invoice_link';
  const charityForPreview = buildCharityForPreview(charity, v);
  const dataBlockHtml = renderDataBlock({
    method: 'card',
    charity: charityForPreview,
    config: rowsToBlock(v.card_data_block_rows),
    cardExtra: { donate_url: sampleDonateUrl, amount: amountStr },
  });
  const repHtml = repMessageHtml(ctx);
  const fallbackBodyHtml = `
    ${greetingHtml(ctx)}
    ${repHtml}
    <p>Thank you for considering a gift to <strong>${escapeHtml(charity.name)}</strong>. Click the secure link below to donate ${amountStr}:</p>
    <p><a href="${escapeHtml(sampleDonateUrl)}">${escapeHtml(sampleDonateUrl)}</a></p>
    ${dataBlockHtml}
    ${charity.ein ? `<p style="font-size:13px;color:#64748b">EIN: ${escapeHtml(charity.ein)}</p>` : ''}
  `;
  return assembleEmail({
    subjectTemplate: v.card_subject_template ?? null,
    bodyTemplateMd: v.card_body_template_md ?? null,
    fallbackSubject: `How to donate by card to ${charity.name}`,
    fallbackBodyHtml,
    vars: {
      ...commonVars(charity, ctx),
      rep_message: repHtml,
      data_block: dataBlockHtml,
      donate_url: sampleDonateUrl,
      amount: amountStr,
    },
  });
}
