// activity-digest
//
// Two entry points share this handler:
//   * pg_cron (service_role JWT, no body action) - hourly. For each enabled
//     recipient it checks whether it's 8am locally (and Monday for weekly) in
//     the reference timezone, then sends. Idempotent per recipient/period via
//     the unique index on activity_digest_log(recipient_user_id, period_key).
//   * "Send test now" (super-admin user JWT, body { test: true, recipient_id })
//     - sends immediately regardless of schedule.
//
// Metrics: people contacted / added / archived and time spent in the app, per
// user with totals, across trailing windows (24h/3d/7d/2w/30d). Scope is all
// charities or a specific subset per recipient. See _shared/activity_report.ts
// for the metric definitions and rendering.

import { handleOptions, json } from '../_shared/cors.ts';
import { CHARITYTOOLING_FOOTER_HTML } from '../_shared/footer.ts';
import { requireSuperAdmin, serviceClient, userClient } from '../_shared/supabase.ts';
import {
  computeMetrics,
  renderDigestHtml,
  type DatedBy,
  type RawData,
  type SessionRow,
} from '../_shared/activity_report.ts';

const DAY_MS = 86_400_000;
const DEFAULT_TZ = 'America/Chicago';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

interface Recipient {
  id: string;
  user_id: string;
  send_daily: boolean;
  send_weekly: boolean;
  scope: 'all' | 'specific';
  charity_ids: string[];
  enabled: boolean;
}

type Svc = ReturnType<typeof serviceClient>;

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, { status: 405 }, origin);
  }

  if (!Deno.env.get('RESEND_API_KEY')) {
    return json({ error: 'resend-not-configured' }, { status: 500 }, origin);
  }

  const body = (await req.json().catch(() => ({}))) as { test?: boolean; recipient_id?: string };
  const svc = serviceClient();

  try {
    // -- Test path: a super admin sends one recipient's digest immediately. ----
    if (body.test) {
      await requireSuperAdmin(userClient(req));
      if (!body.recipient_id) {
        return json({ error: 'missing recipient_id' }, { status: 400 }, origin);
      }
      const { data: rec } = await svc
        .from('activity_digest_recipients')
        .select('*')
        .eq('id', body.recipient_id)
        .maybeSingle();
      if (!rec) return json({ error: 'recipient-not-found' }, { status: 404 }, origin);
      const frequency = (rec as Recipient).send_daily ? 'daily' : 'weekly';
      const periodKey = `test-${new Date().toISOString()}`;
      const result = await sendDigest(svc, rec as Recipient, frequency, periodKey);
      return json({ ok: true, ...result }, {}, origin);
    }

    // -- Cron path: must be a service_role token. ------------------------------
    if (decodeRole(req.headers.get('Authorization')) !== 'service_role') {
      return json({ error: 'forbidden' }, { status: 403 }, origin);
    }

    const { data: recipients } = await svc
      .from('activity_digest_recipients')
      .select('*')
      .eq('enabled', true);

    const charityTz = await loadCharityTz(svc);
    const now = new Date();
    let sent = 0;

    for (const rec of (recipients ?? []) as Recipient[]) {
      const tz = resolveTz(rec, charityTz);
      const { hour, isMonday, ymd } = localClock(now, tz);
      if (hour !== 8) continue;

      if (rec.send_daily) {
        const r = await sendDigest(svc, rec, 'daily', `${ymd}-daily`);
        if (!r.skipped) sent += 1;
      }
      if (rec.send_weekly && isMonday) {
        const r = await sendDigest(svc, rec, 'weekly', `${ymd}-weekly`);
        if (!r.skipped) sent += 1;
      }
    }

    return json({ ok: true, sent }, {}, origin);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }, origin);
  }
});

// Builds and sends one recipient's digest. Reserves the period first (unique
// index) so a duplicate hourly fire is a no-op; on send failure the reserved
// log row is stamped 'failed' rather than left dangling.
async function sendDigest(
  svc: Svc,
  rec: Recipient,
  frequency: 'daily' | 'weekly',
  periodKey: string,
): Promise<{ skipped: boolean; resend_id?: string | null }> {
  const { data: profile } = await svc
    .from('profiles')
    .select('email')
    .eq('id', rec.user_id)
    .maybeSingle();
  const toEmail = profile?.email;
  if (!toEmail) return { skipped: true };

  // Reserve the period. A unique-violation (23505) means it already went out.
  const reserve = await svc
    .from('activity_digest_log')
    .insert({
      recipient_user_id: rec.user_id,
      to_email: toEmail,
      frequency,
      period_key: periodKey,
      status: 'sending',
    })
    .select('id')
    .maybeSingle();
  if (reserve.error) {
    if ((reserve.error as { code?: string }).code === '23505') return { skipped: true };
    throw reserve.error;
  }
  const logId = reserve.data!.id;

  try {
    const charityTz = await loadCharityTz(svc);
    const scopeIds =
      rec.scope === 'all' ? Array.from(charityTz.keys()) : rec.charity_ids ?? [];
    const tz = resolveTz(rec, charityTz);

    const data = await gatherData(svc, scopeIds);
    const tables = computeMetrics(data);

    const scopeLabel =
      rec.scope === 'all'
        ? 'all charities'
        : scopeIds.map((id) => charityTz.get(id)?.name ?? id).join(', ') || 'no charities';
    const generatedAtLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      dateStyle: 'medium',
    }).format(new Date());

    const html =
      renderDigestHtml({
        tables,
        scopeLabel,
        frequency,
        generatedAtLabel,
        appWideTimeNote: rec.scope === 'specific',
      }) + CHARITYTOOLING_FOOTER_HTML;

    const from = `CharityTooling <${Deno.env.get('RESEND_DEFAULT_FROM') ?? 'no-reply@charitytooling.com'}>`;
    const subject = `${frequency === 'daily' ? 'Daily' : 'Weekly'} activity digest`;

    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: toEmail, subject, html }),
    });
    const payload = await r.json().catch(() => ({}));
    if (!r.ok) {
      await svc
        .from('activity_digest_log')
        .update({ status: 'failed', detail: payload })
        .eq('id', logId);
      throw new Error(`resend-failed: ${JSON.stringify(payload)}`);
    }

    await svc
      .from('activity_digest_log')
      .update({ status: 'sent', resend_id: payload.id ?? null })
      .eq('id', logId);
    return { skipped: false, resend_id: payload.id ?? null };
  } catch (err) {
    await svc
      .from('activity_digest_log')
      .update({ status: 'failed', detail: { error: String(err) } })
      .eq('id', logId);
    throw err;
  }
}

// PostgREST caps each response at max_rows (1000, see config.toml). Page through
// with .range() so a busy 30-day window is never silently truncated.
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// Pulls the last 30 days of activity for the scoped charities and shapes it for
// computeMetrics. Each query is date-bounded and paginated.
async function gatherData(svc: Svc, scopeIds: string[]): Promise<RawData> {
  const nowMs = Date.now();
  const from30 = new Date(nowMs - 30 * DAY_MS).toISOString();

  if (scopeIds.length === 0) {
    return {
      users: new Map(),
      added: [],
      archived: [],
      events: [],
      contactedCustomers: [],
      sessions: [],
      nowMs,
    };
  }

  // User universe: members of the scoped charities.
  const members = await fetchAll<{ user_id: string }>((f, t) =>
    svc.from('charity_members').select('user_id').in('charity_id', scopeIds).range(f, t),
  );
  const userIds = Array.from(new Set(members.map((m) => m.user_id)));
  const users = new Map<string, string>();
  if (userIds.length) {
    const profiles = await fetchAll<{ id: string; email: string | null; full_name: string | null }>(
      (f, t) => svc.from('profiles').select('id, email, full_name').in('id', userIds).range(f, t),
    );
    for (const p of profiles) {
      users.set(p.id, p.full_name?.trim() || p.email || p.id);
    }
  }

  const [addedRows, archivedRows, contactedRows, noteRows, emailRows, sessionRows] =
    await Promise.all([
      fetchAll<{ created_by: string | null; created_at: string }>((f, t) =>
        svc
          .from('customers')
          .select('created_by, created_at')
          .in('charity_id', scopeIds)
          .gte('created_at', from30)
          .range(f, t),
      ),
      fetchAll<{ archived_by: string | null; archived_at: string }>((f, t) =>
        svc
          .from('customers')
          .select('archived_by, archived_at')
          .in('charity_id', scopeIds)
          .not('archived_at', 'is', null)
          .gte('archived_at', from30)
          .range(f, t),
      ),
      fetchAll<{ last_contacted_at: string }>((f, t) =>
        svc
          .from('customers')
          .select('last_contacted_at')
          .in('charity_id', scopeIds)
          .not('last_contacted_at', 'is', null)
          .gte('last_contacted_at', from30)
          .range(f, t),
      ),
      fetchAll<{ created_by: string | null; created_at: string }>((f, t) =>
        svc
          .from('notes')
          .select('created_by, created_at, kind')
          .in('charity_id', scopeIds)
          .in('kind', ['call', 'email', 'meeting'])
          .gte('created_at', from30)
          .range(f, t),
      ),
      fetchAll<{ sent_by: string | null; sent_at: string }>((f, t) =>
        svc
          .from('email_log')
          .select('sent_by, sent_at')
          .in('charity_id', scopeIds)
          .gte('sent_at', from30)
          .range(f, t),
      ),
      userIds.length
        ? fetchAll<{ user_id: string; duration_seconds: number; started_at: string }>((f, t) =>
            svc
              .from('app_sessions')
              .select('user_id, duration_seconds, started_at')
              .in('user_id', userIds)
              .gte('started_at', from30)
              .range(f, t),
          )
        : Promise.resolve([]),
    ]);

  const added: DatedBy[] = addedRows.map((r) => ({ by: r.created_by, at: r.created_at }));
  const archived: DatedBy[] = archivedRows.map((r) => ({ by: r.archived_by, at: r.archived_at }));
  const events: DatedBy[] = [
    ...noteRows.map((r) => ({ by: r.created_by, at: r.created_at })),
    ...emailRows.map((r) => ({ by: r.sent_by, at: r.sent_at })),
  ];
  const contactedCustomers = contactedRows.map((r) => ({ at: r.last_contacted_at }));
  const sessions: SessionRow[] = sessionRows.map((r) => ({
    user: r.user_id,
    at: r.started_at,
    seconds: r.duration_seconds,
  }));

  return { users, added, archived, events, contactedCustomers, sessions, nowMs };
}

// charity_id -> { name, tz } for every charity, used for scope labels and tz.
async function loadCharityTz(svc: Svc): Promise<Map<string, { name: string; tz: string }>> {
  const { data } = await svc.from('charities').select('id, name, default_tz');
  const map = new Map<string, { name: string; tz: string }>();
  for (const c of data ?? []) {
    map.set(c.id, { name: c.name, tz: c.default_tz ?? DEFAULT_TZ });
  }
  return map;
}

// Single specific charity -> use its timezone; otherwise a fixed reference tz.
function resolveTz(rec: Recipient, charityTz: Map<string, { name: string; tz: string }>): string {
  if (rec.scope === 'specific' && rec.charity_ids?.length === 1) {
    return charityTz.get(rec.charity_ids[0])?.tz ?? DEFAULT_TZ;
  }
  return DEFAULT_TZ;
}

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

// Decode the role claim from an already-verified JWT (platform verifies the
// signature when verify_jwt = true). Mirrors cron-digest.
function decodeRole(authHeader: string | null): string | null {
  const token = authHeader?.replace('Bearer ', '') ?? '';
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1] + '==='.slice((parts[1].length + 3) % 4);
    const payload = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role ?? null;
  } catch {
    return null;
  }
}
