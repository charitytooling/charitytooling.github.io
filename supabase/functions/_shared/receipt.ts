// Shared receipt issuance pipeline used by `send-receipt` and `stripe-webhook`.
//
// Given an authenticated Supabase client and the donation parameters, this:
//   1. Allocates a receipt number via the `allocate_receipt_number` RPC
//      (service-role callers bypass the membership check).
//   2. Inserts or updates the donations row.
//   3. Renders the PDF, uploads it to Supabase Storage, sends via Resend, and
//      stamps `receipt_storage_path` / `receipt_sent_at`.
//
// The function returns `{ donation_id, receipt_number }` on success.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { renderReceiptPdf } from './pdf.ts';
import {
  assembleEmail,
  renderDataBlock,
  type DataBlockConfig,
} from './payment_email.ts';

const BUCKET = 'receipts';

export interface IssueReceiptArgs {
  client: SupabaseClient;
  charity_id: string;
  customer_id: string;
  amount_cents: number;
  currency?: string;
  method: 'check' | 'cash' | 'card' | 'ach' | 'stock' | 'other';
  received_date: string;
  reference?: string;
  notes?: string;
  donation_id?: string;
  created_by?: string | null;
  stripe_payment_intent_id?: string;
}

export interface IssueReceiptResult {
  donation_id: string;
  receipt_number: string;
}

export async function issueReceipt(args: IssueReceiptArgs): Promise<IssueReceiptResult> {
  const supabase = args.client;

  const [charityRes, customerRes, primaryRes] = await Promise.all([
    supabase.from('charities').select('*').eq('id', args.charity_id).maybeSingle(),
    supabase.from('customers').select('*').eq('id', args.customer_id).maybeSingle(),
    supabase
      .from('customer_contacts')
      .select('first_name, last_name, email, phone')
      .eq('customer_id', args.customer_id)
      .eq('is_primary', true)
      .maybeSingle(),
  ]);
  if (charityRes.error) throw charityRes.error;
  if (customerRes.error) throw customerRes.error;
  if (primaryRes.error) throw primaryRes.error;
  if (!charityRes.data) throw new Error('charity-not-found');
  if (!customerRes.data) throw new Error('customer-not-found');
  const charity = charityRes.data;
  const customer = customerRes.data;
  const primaryContact = primaryRes.data;
  const donorEmail = primaryContact?.email ?? null;
  if (!donorEmail) throw new Error('customer-missing-primary-email');

  const { data: receiptNumber, error: rnErr } = await supabase.rpc('allocate_receipt_number', {
    c_id: args.charity_id,
  });
  if (rnErr) throw rnErr;

  let donationId = args.donation_id;
  if (donationId) {
    const { error } = await supabase
      .from('donations')
      .update({
        amount_cents: args.amount_cents,
        currency: args.currency ?? 'usd',
        method: args.method,
        received_date: args.received_date,
        reference: args.reference ?? null,
        notes: args.notes ?? null,
        receipt_number: receiptNumber,
        stripe_payment_intent_id: args.stripe_payment_intent_id ?? null,
      })
      .eq('id', donationId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from('donations')
      .insert({
        charity_id: args.charity_id,
        customer_id: args.customer_id,
        amount_cents: args.amount_cents,
        currency: args.currency ?? 'usd',
        method: args.method,
        received_date: args.received_date,
        reference: args.reference ?? null,
        notes: args.notes ?? null,
        receipt_number: receiptNumber,
        stripe_payment_intent_id: args.stripe_payment_intent_id ?? null,
        created_by: args.created_by ?? null,
      })
      .select('id')
      .single();
    if (error) throw error;
    donationId = data.id;
  }

  // Pass the primary contact alongside the customer so the PDF can render
  // the donor's name + email without reading dropped columns off customers.
  const customerForPdf = {
    ...(customer as Record<string, unknown>),
    first_name: primaryContact?.first_name ?? null,
    last_name: primaryContact?.last_name ?? null,
    email: donorEmail,
    phone: primaryContact?.phone ?? null,
  };

  const pdf = await renderReceiptPdf({
    charity: charity as Record<string, unknown>,
    customer: customerForPdf,
    donation: {
      receipt_number: receiptNumber as string,
      amount_cents: args.amount_cents,
      method: args.method,
      received_date: args.received_date,
      reference: args.reference,
    },
  });

  const path = `${args.charity_id}/${donationId}.pdf`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, pdf, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (upErr) throw upErr;

  const sentSubject = await sendResendReceipt({
    fromName: (charity.resend_from_name as string) ?? (charity.name as string),
    fromEmail: (charity.resend_from_email as string) ?? Deno.env.get('RESEND_DEFAULT_FROM') ?? 'receipts@charitytooling.com',
    toEmail: donorEmail,
    charity,
    pdf,
    receiptNumber: receiptNumber as string,
    amountCents: args.amount_cents,
    contactFirstName: primaryContact?.first_name ?? null,
    contactLastName: primaryContact?.last_name ?? null,
    customerDisplayName: (customer as { display_name?: string | null }).display_name ?? null,
  });

  await supabase.from('email_log').insert({
    charity_id: args.charity_id,
    customer_id: args.customer_id,
    subject: sentSubject,
    to_email: donorEmail,
    status: 'sent',
    sent_by: args.created_by ?? null,
  });

  await supabase
    .from('donations')
    .update({
      receipt_storage_path: path,
      receipt_sent_at: new Date().toISOString(),
    })
    .eq('id', donationId);

  return { donation_id: donationId!, receipt_number: receiptNumber as string };
}

async function sendResendReceipt(args: {
  fromName: string;
  fromEmail: string;
  toEmail: string | null;
  charity: Record<string, unknown>;
  pdf: Uint8Array;
  receiptNumber: string;
  amountCents: number;
  contactFirstName: string | null;
  contactLastName: string | null;
  customerDisplayName: string | null;
}): Promise<string> {
  if (!args.toEmail) throw new Error('customer-missing-email');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) throw new Error('resend-not-configured');

  const charityName = args.charity.name as string;
  const formattedAmount = (args.amountCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  // Receipts are routed through the "cash" template slot in admin -- the
  // only template that contains receipt-aware variables. When cash columns
  // are null we fall back to the canonical inline string used for years.
  const subjectTemplate = (args.charity.cash_subject_template as string | null) ?? null;
  const bodyTemplate = (args.charity.cash_body_template_md as string | null) ?? null;
  const dataBlockConfig = (args.charity.cash_data_block as DataBlockConfig | null) ?? null;

  const dataBlockHtml = renderDataBlock({
    method: 'cash',
    charity: args.charity,
    config: dataBlockConfig,
    cashExtra: { receipt_number: args.receiptNumber, amount: formattedAmount },
  });

  const fallbackSubject = `Donation receipt #${args.receiptNumber} from ${charityName}`;
  const fallbackBodyHtml = `
    <p>Thank you for your contribution to <strong>${charityName}</strong>.</p>
    <p>Your receipt #${args.receiptNumber} for ${formattedAmount} is attached.</p>
    <p>${(args.charity.receipt_disclaimer as string) ?? ''}</p>
  `;

  const { subject, html } = assembleEmail({
    subjectTemplate,
    bodyTemplateMd: bodyTemplate,
    fallbackSubject,
    fallbackBodyHtml,
    vars: {
      charity_name: charityName,
      ein: (args.charity.ein as string | null) ?? '',
      customer_display_name: args.customerDisplayName ?? '',
      contact_first_name: args.contactFirstName ?? '',
      contact_last_name: args.contactLastName ?? '',
      rep_message: '',
      data_block: dataBlockHtml,
      receipt_number: args.receiptNumber,
      amount: formattedAmount,
    },
  });

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: `${args.fromName} <${args.fromEmail}>`,
      to: args.toEmail,
      subject,
      html,
      attachments: [
        {
          filename: `receipt-${args.receiptNumber}.pdf`,
          content: btoa(String.fromCharCode(...args.pdf)),
        },
      ],
    }),
  });
  if (!r.ok) {
    const payload = await r.text();
    throw new Error(`resend-failed: ${payload}`);
  }
  return subject;
}
