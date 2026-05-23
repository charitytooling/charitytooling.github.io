// cron-digest
//
// Invoked hourly by pg_cron. For each charity, computes the local hour/day in
// the charity's `default_tz` and dispatches push digests when appropriate.
//
//   8am local, every day  -> follow-ups due today (per-user opt-in)
//   8am local, Monday     -> update queue weekly digest (per-user opt-in)
//
// Auth: must be called with a service-role bearer token. We additionally check
// the calling JWT role to keep this endpoint locked to internal use.

import webpush from 'npm:web-push@3.6.7';
import { serviceClient } from '../_shared/supabase.ts';

interface PushBody {
  title: string;
  body: string;
  url?: string;
}

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@charitytooling.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method-not-allowed', { status: 405 });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return new Response('vapid-not-configured', { status: 500 });

  // The Supabase platform verifies the JWT signature (verify_jwt = true in
  // config.toml). We additionally require role = service_role so that no
  // user-scoped JWT can hit the digest fan-out. Reading the role claim from
  // an already-verified JWT only requires decoding the payload segment.
  const auth = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const parts = auth.split('.');
  if (parts.length !== 3) return new Response('forbidden', { status: 403 });
  try {
    const padded = parts[1] + '==='.slice((parts[1].length + 3) % 4);
    const payload = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload?.role !== 'service_role') return new Response('forbidden', { status: 403 });
  } catch {
    return new Response('forbidden', { status: 403 });
  }

  const service = serviceClient();
  const { data: charities } = await service.from('charities').select('id, name, default_tz');
  if (!charities) return new Response('ok-no-charities', { status: 200 });

  const todayUtc = new Date();
  let totalSent = 0;

  for (const c of charities) {
    const { hour, isMonday, ymd } = localClock(todayUtc, c.default_tz);
    if (hour !== 8) continue;

    // followups due today
    const followupCount = await countFollowUpsDueOnDate(service, c.id, ymd);
    if (followupCount > 0) {
      totalSent += await fanOutToCharity(service, c.id, 'followups_due', {
        title: `${followupCount} follow-up${followupCount === 1 ? '' : 's'} due today`,
        body: `${c.name}: tap to start your day.`,
        url: '/#/calendar',
      });
    }

    // weekly update queue (Monday only)
    if (isMonday) {
      const incomplete = await countIncomplete(service, c.id);
      if (incomplete >= 10) {
        totalSent += await fanOutToCharity(service, c.id, 'update_queue_weekly', {
          title: `${incomplete} contacts need updates`,
          body: `${c.name}: a weekly nudge to refresh your ledger.`,
          url: '/#/update',
        });
      }
    }
  }

  return Response.json({ ok: true, sent: totalSent });
});

function localClock(d: Date, tz: string): { hour: number; isMonday: boolean; ymd: string } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(d).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const isMonday = parts.weekday === 'Mon';
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  return { hour, isMonday, ymd };
}

async function countFollowUpsDueOnDate(service: ReturnType<typeof serviceClient>, charityId: string, ymd: string) {
  const { count } = await service
    .from('follow_ups')
    .select('id', { head: true, count: 'exact' })
    .eq('charity_id', charityId)
    .eq('status', 'open')
    .lte('due_date', ymd);
  return count ?? 0;
}

async function countIncomplete(service: ReturnType<typeof serviceClient>, charityId: string) {
  const { count } = await service
    .from('customers')
    .select('id', { head: true, count: 'exact' })
    .eq('charity_id', charityId)
    .lt('completeness_score', 100);
  return count ?? 0;
}

async function fanOutToCharity(
  service: ReturnType<typeof serviceClient>,
  charityId: string,
  prefKey: 'followups_due' | 'update_queue_weekly' | 'new_donation' | 'invited_to_charity',
  payload: PushBody,
): Promise<number> {
  const { data: members } = await service
    .from('charity_members')
    .select('user_id')
    .eq('charity_id', charityId);
  if (!members?.length) return 0;

  const userIds = members.map((m) => m.user_id);
  const { data: prefs } = await service
    .from('notification_preferences')
    .select(`user_id, ${prefKey}`)
    .in('user_id', userIds);
  const eligible = (prefs ?? [])
    .filter((p) => (p as Record<string, unknown>)[prefKey])
    .map((p) => p.user_id);
  if (!eligible.length) return 0;

  const { data: subs } = await service
    .from('push_subscriptions')
    .select('*')
    .in('user_id', eligible);

  const serialized = JSON.stringify(payload);
  let sent = 0;
  const expired: string[] = [];

  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          serialized,
        );
        sent += 1;
      } catch (err) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 404 || e.statusCode === 410) expired.push(s.endpoint);
      }
    }),
  );

  if (expired.length) {
    await service.from('push_subscriptions').delete().in('endpoint', expired);
  }
  return sent;
}
