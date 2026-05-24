// stripe-connect
//
// Five operations multiplexed by `?action=`:
//
//   POST ?action=start         -> { charity_id }
//      Returns the Stripe Connect OAuth URL to redirect the admin to.
//
//   POST ?action=callback      -> { charity_id, code }
//      Exchanges the OAuth code for a connected account ID, stores it on
//      the charity, and refreshes `stripe_charges_enabled`.
//
//   POST ?action=checkout      -> { charity_id, customer_id, amount_cents?, currency? }
//      Creates a Stripe Checkout Session on the charity's connected account
//      and returns the hosted URL. If `amount_cents` is omitted, the donor
//      picks the amount on Stripe's page (uses `custom_unit_amount`).
//
//   POST ?action=invoice       -> { charity_id, customer_id, amount_cents, currency?, description? }
//      Creates a Stripe Invoice on the connected account, finalizes it, and
//      returns the hosted invoice URL. The rep can paste / forward the link
//      separately, or `?send=1` to have Stripe email the donor directly.
//
//   POST ?action=subscription_checkout
//      -> { charity_id, customer_id, amount_cents, currency?, interval? }
//      Returns a Stripe Checkout URL configured for a recurring subscription
//      at the chosen interval (defaults to monthly).

import Stripe from 'npm:stripe@16.12.0';
import { handleOptions, json } from '../_shared/cors.ts';
import {
  requireCharityAdmin,
  requireCharityMember,
  userClient,
} from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, { status: 405 }, origin);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY');
  const STRIPE_CLIENT_ID = Deno.env.get('STRIPE_CLIENT_ID');
  if (!STRIPE_SECRET) return json({ error: 'stripe-not-configured' }, { status: 500 }, origin);
  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: '2024-06-20' });

  try {
    const body = (await req.json()) as {
      charity_id?: string;
      code?: string;
      customer_id?: string;
      amount_cents?: number;
      currency?: string;
      description?: string;
      interval?: 'month' | 'year' | 'week';
      send?: boolean;
    };
    if (!body.charity_id) return json({ error: 'missing-charity-id' }, { status: 400 }, origin);

    const supabase = userClient(req);

    if (action === 'start') {
      if (!STRIPE_CLIENT_ID) return json({ error: 'stripe-client-id-not-set' }, { status: 500 }, origin);
      await requireCharityAdmin(supabase, body.charity_id);
      const state = body.charity_id;
      const redirectUri = `${origin ?? 'https://charitytooling.com'}/#/charities/${body.charity_id}/stripe/callback`;
      const oauthUrl = new URL('https://connect.stripe.com/oauth/v2/authorize');
      oauthUrl.searchParams.set('response_type', 'code');
      oauthUrl.searchParams.set('client_id', STRIPE_CLIENT_ID);
      oauthUrl.searchParams.set('scope', 'read_write');
      oauthUrl.searchParams.set('state', state);
      oauthUrl.searchParams.set('redirect_uri', redirectUri);
      return json({ url: oauthUrl.toString() }, {}, origin);
    }

    if (action === 'callback') {
      await requireCharityAdmin(supabase, body.charity_id);
      if (!body.code) return json({ error: 'missing-code' }, { status: 400 }, origin);
      const tokenRes = await stripe.oauth.token({
        grant_type: 'authorization_code',
        code: body.code,
      });
      const accountId = tokenRes.stripe_user_id;
      if (!accountId) return json({ error: 'stripe-no-account' }, { status: 502 }, origin);

      const account = await stripe.accounts.retrieve(accountId);

      const { error } = await supabase
        .from('charities')
        .update({
          stripe_account_id: accountId,
          stripe_charges_enabled: account.charges_enabled === true,
        })
        .eq('id', body.charity_id);
      if (error) return json({ error: error.message }, { status: 500 }, origin);

      return json({ ok: true, account_id: accountId, charges_enabled: account.charges_enabled }, {}, origin);
    }

    if (action === 'checkout') {
      await requireCharityMember(supabase, body.charity_id);
      if (!body.customer_id) return json({ error: 'missing-customer-id' }, { status: 400 }, origin);

      const { data: charity } = await supabase
        .from('charities')
        .select('id, name, stripe_account_id, stripe_charges_enabled')
        .eq('id', body.charity_id)
        .maybeSingle();
      if (!charity) return json({ error: 'charity-not-found' }, { status: 404 }, origin);
      if (!charity.stripe_account_id || !charity.stripe_charges_enabled) {
        return json({ error: 'stripe-not-connected' }, { status: 400 }, origin);
      }

      const successUrl = `${origin ?? 'https://charitytooling.com'}/#/contact/${body.customer_id}?donation=success`;
      const cancelUrl = `${origin ?? 'https://charitytooling.com'}/#/contact/${body.customer_id}?donation=cancel`;
      const currency = (body.currency ?? 'usd').toLowerCase();

      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: [
            body.amount_cents
              ? {
                  quantity: 1,
                  price_data: {
                    currency,
                    unit_amount: body.amount_cents,
                    product_data: { name: `Donation to ${charity.name}` },
                  },
                }
              : {
                  quantity: 1,
                  price_data: {
                    currency,
                    unit_amount_decimal: undefined,
                    custom_unit_amount: { enabled: true, minimum: 100 },
                    product_data: { name: `Donation to ${charity.name}` },
                  } as unknown as Stripe.Checkout.SessionCreateParams.LineItem.PriceData,
                },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            charity_id: body.charity_id,
            customer_id: body.customer_id,
          },
        },
        { stripeAccount: charity.stripe_account_id },
      );

      return json({ url: session.url }, {}, origin);
    }

    if (action === 'invoice') {
      await requireCharityMember(supabase, body.charity_id);
      if (!body.customer_id) return json({ error: 'missing-customer-id' }, { status: 400 }, origin);
      if (!body.amount_cents || body.amount_cents <= 0) {
        return json({ error: 'missing-amount' }, { status: 400 }, origin);
      }

      const { data: charity } = await supabase
        .from('charities')
        .select('id, name, stripe_account_id, stripe_charges_enabled')
        .eq('id', body.charity_id)
        .maybeSingle();
      if (!charity) return json({ error: 'charity-not-found' }, { status: 404 }, origin);
      if (!charity.stripe_account_id || !charity.stripe_charges_enabled) {
        return json({ error: 'stripe-not-connected' }, { status: 400 }, origin);
      }

      const { data: contact } = await supabase
        .from('customer_contacts')
        .select('email, first_name, last_name')
        .eq('customer_id', body.customer_id)
        .eq('is_primary', true)
        .maybeSingle();
      if (!contact?.email) {
        return json({ error: 'customer-missing-email' }, { status: 400 }, origin);
      }
      const donorName = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || undefined;
      const currency = (body.currency ?? 'usd').toLowerCase();
      const stripeAccount = { stripeAccount: charity.stripe_account_id };

      // Create (or fetch) a Stripe Customer on the connected account so the
      // invoice has a recipient. Per-invoice creation is fine for v1; if
      // donor de-dup becomes important we can stash the returned id on a
      // dedicated mapping table later.
      const stripeCustomer = await stripe.customers.create(
        {
          email: contact.email,
          name: donorName,
          metadata: {
            charity_id: body.charity_id,
            customer_id: body.customer_id,
          },
        },
        stripeAccount,
      );

      const invoice = await stripe.invoices.create(
        {
          customer: stripeCustomer.id,
          collection_method: 'send_invoice',
          days_until_due: 30,
          description: body.description ?? `Donation to ${charity.name}`,
          metadata: {
            charity_id: body.charity_id,
            customer_id: body.customer_id,
          },
        },
        stripeAccount,
      );

      await stripe.invoiceItems.create(
        {
          customer: stripeCustomer.id,
          invoice: invoice.id,
          amount: body.amount_cents,
          currency,
          description: body.description ?? `Donation to ${charity.name}`,
        },
        stripeAccount,
      );

      const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {}, stripeAccount);
      let hostedUrl = finalized.hosted_invoice_url ?? null;

      if (body.send) {
        const sent = await stripe.invoices.sendInvoice(finalized.id, {}, stripeAccount);
        hostedUrl = sent.hosted_invoice_url ?? hostedUrl;
      }

      return json(
        {
          ok: true,
          url: hostedUrl,
          invoice_id: finalized.id,
          stripe_customer_id: stripeCustomer.id,
        },
        {},
        origin,
      );
    }

    if (action === 'subscription_checkout') {
      await requireCharityMember(supabase, body.charity_id);
      if (!body.customer_id) return json({ error: 'missing-customer-id' }, { status: 400 }, origin);
      if (!body.amount_cents || body.amount_cents <= 0) {
        return json({ error: 'missing-amount' }, { status: 400 }, origin);
      }

      const { data: charity } = await supabase
        .from('charities')
        .select('id, name, stripe_account_id, stripe_charges_enabled')
        .eq('id', body.charity_id)
        .maybeSingle();
      if (!charity) return json({ error: 'charity-not-found' }, { status: 404 }, origin);
      if (!charity.stripe_account_id || !charity.stripe_charges_enabled) {
        return json({ error: 'stripe-not-connected' }, { status: 400 }, origin);
      }

      const successUrl = `${origin ?? 'https://charitytooling.com'}/#/contact/${body.customer_id}?donation=success`;
      const cancelUrl = `${origin ?? 'https://charitytooling.com'}/#/contact/${body.customer_id}?donation=cancel`;
      const currency = (body.currency ?? 'usd').toLowerCase();
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
                product_data: { name: `Recurring donation to ${charity.name}` },
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
            metadata: {
              charity_id: body.charity_id,
              customer_id: body.customer_id,
            },
          },
        },
        { stripeAccount: charity.stripe_account_id },
      );

      return json({ url: session.url }, {}, origin);
    }

    return json({ error: 'unknown-action' }, { status: 400 }, origin);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }, origin);
  }
});
