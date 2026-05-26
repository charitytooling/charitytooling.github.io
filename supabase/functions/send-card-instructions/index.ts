// send-card-instructions
//
// Body: {
//   charity_id: string,
//   customer_id: string,
//   contact_id?: string,
//   amount_cents: number,
//   mode: 'invoice' | 'subscription',
//   rep_message_md?: string,
//   description?: string,           // optional invoice description override
//   currency?: string,              // defaults to 'usd'
//   interval?: 'month' | 'year' | 'week',  // subscription mode only
// }
//
// Auth: caller must be a member of `charity_id`.
//
// Action:
//   - mode='invoice': creates a finalized Stripe invoice on the charity's
//     connected account WITHOUT calling sendInvoice -- so Stripe never
//     emails the donor. We capture the hosted_invoice_url and send our own
//     CharityTooling-branded email containing {{donate_url}}.
//   - mode='subscription': creates a Stripe Checkout session in
//     subscription mode and sends our email pointing the donor at the
//     hosted Checkout URL.
//
// In both cases we honor the per-charity `card_subject_template`,
// `card_body_template_md`, and `card_data_block` columns. When all three
// are null we still send the email (with a sensible canonical default)
// because by definition a caller invoking this function has opted out of
// the Stripe-managed email path -- see the gating logic in
// src/routes/contact/DonationModal.tsx CardHelpForm.
//
// Parity with sister functions: writes email_log, inserts a synthetic
// notes row (kind=email), and bumps customers.last_contacted_at.

import Stripe from 'npm:stripe@16.12.0';
import { handleOptions, json } from '../_shared/cors.ts';
import {
  assembleEmail,
  escapeHtml,
  markdownToEmailHtml,
  renderDataBlock,
  type DataBlockConfig,
} from '../_shared/payment_email.ts';
import { requireCharityMember, userClient } from '../_shared/supabase.ts';

interface Body {
  charity_id: string;
  customer_id: string;
  contact_id?: string;
  amount_cents: number;
  mode: 'invoice' | 'subscription';
  rep_message_md?: string;
  description?: string;
  currency?: string;
  interval?: 'month' | 'year' | 'week';
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, { status: 405 }, origin);
  }

  const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY');
  if (!STRIPE_SECRET) return json({ error: 'stripe-not-configured' }, { status: 500 }, origin);
  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: '2024-06-20' });

  try {
    const body = (await req.json()) as Partial<Body>;
    if (!body.charity_id || !body.customer_id || !body.mode) {
      return json({ error: 'missing-fields' }, { status: 400 }, origin);
    }
    if (body.mode !== 'invoice' && body.mode !== 'subscription') {
      return json({ error: 'unsupported-mode' }, { status: 400 }, origin);
    }
    if (!body.amount_cents || body.amount_cents <= 0) {
      return json({ error: 'missing-amount' }, { status: 400 }, origin);
    }

    const supabase = userClient(req);
    const caller = await requireCharityMember(supabase, body.charity_id);

    const { data: charity, error: chErr } = await supabase
      .from('charities')
      .select('*')
      .eq('id', body.charity_id)
      .maybeSingle();
    if (chErr) return json({ error: chErr.message }, { status: 500 }, origin);
    if (!charity) return json({ error: 'charity-not-found' }, { status: 404 }, origin);
    if (!charity.stripe_account_id || !charity.stripe_charges_enabled) {
      return json({ error: 'stripe-not-connected' }, { status: 400 }, origin);
    }

    const { data: customer, error: cuErr } = await supabase
      .from('customers')
      .select('id, display_name')
      .eq('id', body.customer_id)
      .maybeSingle();
    if (cuErr) return json({ error: cuErr.message }, { status: 500 }, origin);
    if (!customer) return json({ error: 'customer-not-found' }, { status: 404 }, origin);

    let contact: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null = null;
    if (body.contact_id) {
      const r = await supabase
        .from('customer_contacts')
        .select('id, first_name, last_name, email')
        .eq('id', body.contact_id)
        .eq('customer_id', body.customer_id)
        .maybeSingle();
      if (r.error) return json({ error: r.error.message }, { status: 500 }, origin);
      contact = r.data;
    } else {
      const r = await supabase
        .from('customer_contacts')
        .select('id, first_name, last_name, email')
        .eq('customer_id', body.customer_id)
        .eq('is_primary', true)
        .maybeSingle();
      if (r.error) return json({ error: r.error.message }, { status: 500 }, origin);
      contact = r.data;
    }
    if (!contact?.email) {
      return json({ error: 'customer-missing-email' }, { status: 400 }, origin);
    }
    const toEmail = contact.email;
    const donorName = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || undefined;
    const currency = (body.currency ?? 'usd').toLowerCase();
    const stripeAccount = { stripeAccount: charity.stripe_account_id as string };

    let donateUrl: string;
    let stripeRef: { kind: 'invoice' | 'session'; id: string } | null = null;

    if (body.mode === 'invoice') {
      const stripeCustomer = await stripe.customers.create(
        {
          email: contact.email,
          name: donorName,
          metadata: { charity_id: body.charity_id, customer_id: body.customer_id },
        },
        stripeAccount,
      );
      const invoice = await stripe.invoices.create(
        {
          customer: stripeCustomer.id,
          collection_method: 'send_invoice',
          days_until_due: 30,
          // auto_advance:false guarantees Stripe never advances the invoice
          // through their own send pipeline; we own the email.
          auto_advance: false,
          description: body.description ?? `Donation to ${charity.name as string}`,
          metadata: { charity_id: body.charity_id, customer_id: body.customer_id },
        },
        stripeAccount,
      );
      await stripe.invoiceItems.create(
        {
          customer: stripeCustomer.id,
          invoice: invoice.id,
          amount: body.amount_cents,
          currency,
          description: body.description ?? `Donation to ${charity.name as string}`,
        },
        stripeAccount,
      );
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {}, stripeAccount);
      if (!finalized.hosted_invoice_url) {
        return json({ error: 'stripe-no-hosted-url' }, { status: 502 }, origin);
      }
      donateUrl = finalized.hosted_invoice_url;
      stripeRef = { kind: 'invoice', id: finalized.id };
    } else {
      const successUrl = `${origin ?? 'https://charitytooling.com'}/#/contact/${body.customer_id}?donation=success`;
      const cancelUrl = `${origin ?? 'https://charitytooling.com'}/#/contact/${body.customer_id}?donation=cancel`;
      const interval = body.interval ?? 'month';
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          payment_method_types: ['card'],
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: body.amount_cents,
                recurring: { interval },
                product_data: { name: `Recurring donation to ${charity.name as string}` },
              },
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            charity_id: body.charity_id,
            customer_id: body.customer_id,
            recurring: 'true',
          },
          subscription_data: {
            metadata: { charity_id: body.charity_id, customer_id: body.customer_id },
          },
        },
        stripeAccount,
      );
      if (!session.url) {
        return json({ error: 'stripe-no-checkout-url' }, { status: 502 }, origin);
      }
      donateUrl = session.url;
      stripeRef = { kind: 'session', id: session.id };
    }

    const formattedAmount = (body.amount_cents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });

    const subjectTemplate = (charity.card_subject_template as string | null) ?? null;
    const bodyTemplate = (charity.card_body_template_md as string | null) ?? null;
    const dataBlockConfig = (charity.card_data_block as DataBlockConfig | null) ?? null;

    const dataBlockHtml = renderDataBlock({
      method: 'card',
      charity: charity as Record<string, unknown>,
      config: dataBlockConfig,
      cardExtra: { donate_url: donateUrl, amount: formattedAmount },
    });

    const greetingName = contact.first_name?.trim() || contact.last_name?.trim() || '';
    const greetingHtml = greetingName ? `<p>Hi ${escapeHtml(greetingName)},</p>` : '';
    const repMessageHtml = body.rep_message_md?.trim()
      ? `<div style="margin:0 0 16px">${markdownToEmailHtml(body.rep_message_md.trim())}</div>`
      : '';

    const fallbackSubject =
      body.mode === 'invoice'
        ? `How to donate by card to ${charity.name as string}`
        : `Set up a recurring gift to ${charity.name as string}`;
    const fallbackBodyHtml = `
      ${greetingHtml}
      ${repMessageHtml}
      <p>Thank you for considering a gift to <strong>${escapeHtml(charity.name as string)}</strong>. Click the secure link below to ${body.mode === 'invoice' ? `donate ${formattedAmount}` : 'set up a recurring gift'}:</p>
      <p><a href="${escapeHtml(donateUrl)}">${escapeHtml(donateUrl)}</a></p>
      ${dataBlockHtml}
      ${charity.ein ? `<p style="font-size:13px;color:#64748b">EIN: ${escapeHtml(charity.ein as string)}</p>` : ''}
    `;

    const { subject, html } = assembleEmail({
      subjectTemplate,
      bodyTemplateMd: bodyTemplate,
      fallbackSubject,
      fallbackBodyHtml,
      vars: {
        charity_name: charity.name as string,
        ein: (charity.ein as string | null) ?? '',
        customer_display_name: (customer.display_name as string | null) ?? '',
        contact_first_name: contact.first_name ?? '',
        contact_last_name: contact.last_name ?? '',
        rep_message: repMessageHtml,
        data_block: dataBlockHtml,
        donate_url: donateUrl,
        amount: formattedAmount,
      },
    });

    const fromAddr = (charity.resend_from_email as string | null)
      ?? Deno.env.get('RESEND_DEFAULT_FROM')
      ?? 'no-reply@charitytooling.com';
    const fromName = (charity.resend_from_name as string | null) ?? (charity.name as string);

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json({ error: 'resend-not-configured' }, { status: 500 }, origin);

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <${fromAddr}>`,
        to: toEmail,
        subject,
        html,
      }),
    });
    const payload = await r.json();
    if (!r.ok) {
      return json({ error: 'resend-failed', detail: payload }, { status: 502 }, origin);
    }

    await supabase.from('email_log').insert({
      charity_id: body.charity_id,
      customer_id: body.customer_id,
      subject,
      body_html: html,
      to_email: toEmail,
      resend_id: payload.id ?? null,
      status: 'sent',
      sent_by: caller.id,
    });

    await supabase.from('notes').insert({
      charity_id: body.charity_id,
      customer_id: body.customer_id,
      kind: 'email',
      body: body.mode === 'invoice'
        ? 'Payment instructions sent: card (invoice link)'
        : 'Payment instructions sent: card (recurring checkout)',
      created_by: caller.id,
    });

    await supabase
      .from('customers')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', body.customer_id);

    return json(
      {
        ok: true,
        resend_id: payload.id ?? null,
        donate_url: donateUrl,
        stripe_ref: stripeRef,
      },
      {},
      origin,
    );
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }, origin);
  }
});
