// send-receipt
//
// Body: {
//   donation_id?: string,                  // edit-resend path
//   charity_id: string,
//   customer_id: string,
//   amount_cents: number,
//   method: 'check'|'cash'|'card'|'ach'|'stock'|'other',
//   received_date: string,                 // YYYY-MM-DD
//   reference?: string,
//   notes?: string,
// }
//
// Auth: caller must be a member of `charity_id`.

import webpush from 'npm:web-push@3.6.7';
import { handleOptions, json } from '../_shared/cors.ts';
import { requireCharityMember, serviceClient, userClient } from '../_shared/supabase.ts';
import { issueReceipt } from '../_shared/receipt.ts';

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@charitytooling.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

interface Body {
  donation_id?: string;
  charity_id: string;
  customer_id: string;
  amount_cents: number;
  method: 'check' | 'cash' | 'card' | 'ach' | 'stock' | 'other';
  received_date: string;
  reference?: string;
  notes?: string;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, { status: 405 }, origin);
  }

  try {
    const body = (await req.json()) as Partial<Body>;
    if (!body.charity_id || !body.customer_id || !body.amount_cents || !body.method || !body.received_date) {
      return json({ error: 'missing-fields' }, { status: 400 }, origin);
    }

    const supabase = userClient(req);
    const caller = await requireCharityMember(supabase, body.charity_id);

    const result = await issueReceipt({
      client: supabase,
      charity_id: body.charity_id,
      customer_id: body.customer_id,
      amount_cents: body.amount_cents,
      method: body.method,
      received_date: body.received_date,
      reference: body.reference,
      notes: body.notes,
      donation_id: body.donation_id,
      created_by: caller.id,
    });

    // Fan out instant push to teammates with `new_donation` enabled.
    if (!body.donation_id) {
      await dispatchTeammateDonationPush({
        charityId: body.charity_id,
        excludeUserId: caller.id,
        title: `New donation: ${(body.amount_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`,
        msg: `Recorded by a teammate.`,
      });
    }

    return json({ ok: true, ...result }, {}, origin);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }, origin);
  }
});

async function dispatchTeammateDonationPush(args: {
  charityId: string;
  excludeUserId: string;
  title: string;
  msg: string;
}) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const svc = serviceClient();
  const { data: members } = await svc
    .from('charity_members')
    .select('user_id')
    .eq('charity_id', args.charityId);
  const userIds = (members ?? []).map((m) => m.user_id).filter((id) => id !== args.excludeUserId);
  if (userIds.length === 0) return;
  const { data: prefs } = await svc
    .from('notification_preferences')
    .select('user_id, new_donation')
    .in('user_id', userIds);
  const eligible = (prefs ?? []).filter((p) => p.new_donation).map((p) => p.user_id);
  if (eligible.length === 0) return;
  const { data: subs } = await svc.from('push_subscriptions').select('*').in('user_id', eligible);
  const payload = JSON.stringify({ title: args.title, body: args.msg, url: '/#/ledger' });
  const expired: string[] = [];
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
      } catch (err) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 404 || e.statusCode === 410) expired.push(s.endpoint);
      }
    }),
  );
  if (expired.length) await svc.from('push_subscriptions').delete().in('endpoint', expired);
}
