// send-push
//
// Body: {
//   user_ids?: string[],          // explicit recipients (super-admin or self only)
//   charity_id?: string,          // fan out to all members of this charity
//   pref_key?: 'followups_due' | 'update_queue_weekly' | 'new_donation' | 'invited_to_charity',
//   title: string,
//   body: string,
//   url?: string,
// }
//
// Auth: caller must be authenticated. Self-targeted pushes are always allowed;
// fan-out to a charity requires admin-of(charity) or super_admin; explicit
// `user_ids` requires super_admin. Cron-style invocations should use the
// service-role key and bypass these checks (Phase 7 hooks pg_cron up via a
// minimal scheduled function that calls this with explicit `user_ids`).

import webpush from 'npm:web-push@3.6.7';
import { handleOptions, json } from '../_shared/cors.ts';
import { requireUser, serviceClient, userClient } from '../_shared/supabase.ts';

const PREF_KEYS = ['followups_due', 'update_queue_weekly', 'new_donation', 'invited_to_charity'] as const;
type PrefKey = (typeof PREF_KEYS)[number];

interface Body {
  user_ids?: string[];
  charity_id?: string;
  pref_key?: PrefKey;
  title: string;
  body: string;
  url?: string;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, { status: 405 }, origin);
  }

  const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY');
  const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY');
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@charitytooling.com';
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ error: 'vapid-not-configured' }, { status: 500 }, origin);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  try {
    const body = (await req.json()) as Partial<Body>;
    if (!body.title || !body.body) {
      return json({ error: 'missing-fields' }, { status: 400 }, origin);
    }

    const supabase = userClient(req);
    const caller = await requireUser(supabase);

    // Resolve recipients.
    let recipients: string[] = [];

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', caller.id)
      .maybeSingle();
    const isSuper = callerProfile?.is_super_admin === true;

    if (body.user_ids?.length) {
      if (!isSuper && (body.user_ids.length !== 1 || body.user_ids[0] !== caller.id)) {
        return json({ error: 'forbidden' }, { status: 403 }, origin);
      }
      recipients = body.user_ids;
    } else if (body.charity_id) {
      const { data: members } = await supabase
        .from('charity_members')
        .select('user_id, role')
        .eq('charity_id', body.charity_id);
      if (!members?.length) return json({ error: 'no-members' }, { status: 404 }, origin);
      const callerIsAdminOfCharity = members.some((m) => m.user_id === caller.id && m.role === 'admin');
      if (!isSuper && !callerIsAdminOfCharity) {
        return json({ error: 'forbidden' }, { status: 403 }, origin);
      }
      recipients = members.map((m) => m.user_id);
    } else {
      recipients = [caller.id];
    }

    // Filter by preference, if requested.
    if (body.pref_key) {
      if (!PREF_KEYS.includes(body.pref_key)) {
        return json({ error: 'invalid-pref-key' }, { status: 400 }, origin);
      }
      const service = serviceClient();
      const { data: prefs } = await service
        .from('notification_preferences')
        .select(`user_id, ${body.pref_key}`)
        .in('user_id', recipients);
      const allow = new Set((prefs ?? []).filter((p) => (p as Record<string, unknown>)[body.pref_key!]).map((p) => p.user_id));
      recipients = recipients.filter((u) => allow.has(u));
    }

    if (recipients.length === 0) {
      return json({ ok: true, delivered: 0, reason: 'no-eligible-recipients' }, {}, origin);
    }

    const service = serviceClient();
    const { data: subs, error: subErr } = await service
      .from('push_subscriptions')
      .select('*')
      .in('user_id', recipients);
    if (subErr) return json({ error: subErr.message }, { status: 500 }, origin);

    const payload = JSON.stringify({
      title: body.title,
      body: body.body,
      url: body.url ?? '/',
    });

    let delivered = 0;
    const expired: string[] = [];
    await Promise.all(
      (subs ?? []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          delivered += 1;
        } catch (err) {
          const e = err as { statusCode?: number; body?: string };
          if (e.statusCode === 404 || e.statusCode === 410) {
            expired.push(s.endpoint);
          }
        }
      }),
    );

    if (expired.length) {
      await service.from('push_subscriptions').delete().in('endpoint', expired);
    }

    return json({ ok: true, delivered, removed: expired.length }, {}, origin);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }, origin);
  }
});
