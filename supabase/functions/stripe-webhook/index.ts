// stripe-webhook
//
// Public endpoint (verify_jwt = false in config.toml). Verifies Stripe signature,
// idempotently records payment_intent.succeeded events as donations, and
// auto-issues the PDF receipt via Resend.

import Stripe from 'npm:stripe@16.12.0';
import { serviceClient } from '../_shared/supabase.ts';
import { issueReceipt } from '../_shared/receipt.ts';

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method-not-allowed', { status: 405 });
  }
  if (!STRIPE_SECRET || !STRIPE_WEBHOOK_SECRET) {
    return new Response('stripe-not-configured', { status: 500 });
  }

  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: '2024-06-20' });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('missing-signature', { status: 400 });
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`invalid-signature: ${err instanceof Error ? err.message : err}`, { status: 400 });
  }

  const service = serviceClient();

  // Idempotency: stripe_events table guards against duplicate delivery.
  const { error: idemErr } = await service.from('stripe_events').insert({
    id: event.id,
    type: event.type,
    payload: event as unknown as Record<string, unknown>,
  });
  if (idemErr) {
    if (idemErr.code === '23505') {
      return new Response('ok-duplicate', { status: 200 });
    }
    return new Response(idemErr.message, { status: 500 });
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const charityId = pi.metadata?.charity_id;
    const customerId = pi.metadata?.customer_id;
    if (!charityId || !customerId) return new Response('ok-missing-metadata', { status: 200 });

    // De-dupe by payment_intent_id in case the row already exists.
    const { data: existing } = await service
      .from('donations')
      .select('id')
      .eq('stripe_payment_intent_id', pi.id)
      .maybeSingle();

    try {
      await issueReceipt({
        client: service,
        charity_id: charityId,
        customer_id: customerId,
        amount_cents: pi.amount_received,
        currency: pi.currency,
        method: 'card',
        received_date: new Date().toISOString().slice(0, 10),
        reference: pi.id,
        donation_id: existing?.id,
        stripe_payment_intent_id: pi.id,
      });
    } catch (err) {
      return new Response(`receipt-failed: ${err instanceof Error ? err.message : err}`, {
        status: 500,
      });
    }
  }

  return new Response('ok', { status: 200 });
});
