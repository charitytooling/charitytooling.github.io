// Pure aggregation + HTML rendering for the activity digest.
//
// index.ts fetches the raw rows (service_role, last 30 days, scoped to the
// recipient's charities) and hands them here. Keeping the math and markup in
// pure functions makes the windowing logic easy to reason about and the Edge
// Function handler lean.
//
// Metric definitions (confirmed with product):
//   contacted  - per user: count of contact actions (emails sent + call/email/
//                meeting notes). Totals row: DISTINCT people contacted
//                (customers whose last_contacted_at falls in the window), so the
//                totals row intentionally does not equal the column sum.
//   added      - customers created (created_by / created_at).
//   archived   - customers archived (archived_by / archived_at).
//   time       - active foreground seconds in the app (app_sessions). App-wide
//                per user, not split by charity.

export const WINDOWS = [
  { key: '1d', days: 1, label: '24h' },
  { key: '3d', days: 3, label: '3d' },
  { key: '7d', days: 7, label: '7d' },
  { key: '14d', days: 14, label: '2w' },
  { key: '30d', days: 30, label: '30d' },
] as const;

const DAY_MS = 86_400_000;

export interface DatedBy {
  by: string | null;
  at: string;
}

export interface SessionRow {
  user: string;
  at: string;
  seconds: number;
}

export interface RawData {
  // user_id -> display label (full name or email). Defines the row universe.
  users: Map<string, string>;
  added: DatedBy[];
  archived: DatedBy[];
  // Per-user "contacted" events: notes (call/email/meeting) + sent emails.
  events: DatedBy[];
  // One row per distinct customer with a last_contacted_at in range; used for
  // the distinct-people totals.
  contactedCustomers: { at: string }[];
  sessions: SessionRow[];
  nowMs: number;
}

export type MetricKey = 'contacted' | 'added' | 'archived' | 'time';

export interface MetricTable {
  metric: MetricKey;
  title: string;
  // values[windowIndex] aligned to WINDOWS. Seconds for the time metric.
  rows: Array<{ userId: string; name: string; values: number[] }>;
  totals: number[];
}

// Number of windows a record (or the implied "now - at") falls inside. Windows
// are nested, so a record at age D contributes to every window whose span >= D.
function windowHits(atIso: string, nowMs: number): boolean[] {
  const ageMs = nowMs - new Date(atIso).getTime();
  return WINDOWS.map((w) => ageMs >= 0 && ageMs <= w.days * DAY_MS);
}

function emptyWindows(): number[] {
  return WINDOWS.map(() => 0);
}

// Tally a list of {by, at} into a per-user-per-window map, skipping rows with a
// null actor (e.g. system-generated). Returns the per-user map plus the column
// totals (sum across users).
function tallyByUser(
  rows: DatedBy[],
  users: Map<string, string>,
  nowMs: number,
): { perUser: Map<string, number[]>; totals: number[] } {
  const perUser = new Map<string, number[]>();
  const totals = emptyWindows();
  for (const r of rows) {
    if (!r.by || !users.has(r.by)) continue;
    const hits = windowHits(r.at, nowMs);
    let cur = perUser.get(r.by);
    if (!cur) {
      cur = emptyWindows();
      perUser.set(r.by, cur);
    }
    hits.forEach((hit, i) => {
      if (hit) {
        cur![i] += 1;
        totals[i] += 1;
      }
    });
  }
  return { perUser, totals };
}

export function computeMetrics(data: RawData): MetricTable[] {
  const { users, nowMs } = data;
  const orderedUsers = Array.from(users.entries()).sort((a, b) =>
    a[1].localeCompare(b[1]),
  );

  const added = tallyByUser(data.added, users, nowMs);
  const archived = tallyByUser(data.archived, users, nowMs);
  const events = tallyByUser(data.events, users, nowMs);

  // Time: sum durations per user per window.
  const timePerUser = new Map<string, number[]>();
  const timeTotals = emptyWindows();
  for (const s of data.sessions) {
    if (!users.has(s.user)) continue;
    const hits = windowHits(s.at, nowMs);
    let cur = timePerUser.get(s.user);
    if (!cur) {
      cur = emptyWindows();
      timePerUser.set(s.user, cur);
    }
    hits.forEach((hit, i) => {
      if (hit) {
        cur![i] += s.seconds;
        timeTotals[i] += s.seconds;
      }
    });
  }

  // Contacted totals: distinct customers per window (not the column sum).
  const contactedTotals = emptyWindows();
  for (const c of data.contactedCustomers) {
    windowHits(c.at, nowMs).forEach((hit, i) => {
      if (hit) contactedTotals[i] += 1;
    });
  }

  const build = (
    metric: MetricKey,
    title: string,
    perUser: Map<string, number[]>,
    totals: number[],
  ): MetricTable => ({
    metric,
    title,
    rows: orderedUsers.map(([userId, name]) => ({
      userId,
      name,
      values: perUser.get(userId) ?? emptyWindows(),
    })),
    totals,
  });

  return [
    build('contacted', 'People contacted', events.perUser, contactedTotals),
    build('added', 'People added', added.perUser, added.totals),
    build('archived', 'People archived', archived.perUser, archived.totals),
    build('time', 'Time in app', timePerUser, timeTotals),
  ];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSeconds(total: number): string {
  if (!total) return '—';
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return '<1m';
}

function cell(value: number, metric: MetricKey): string {
  if (metric === 'time') return formatSeconds(value);
  return value ? String(value) : '—';
}

function renderTable(t: MetricTable): string {
  const headCells = ['', ...WINDOWS.map((w) => w.label)]
    .map(
      (h, i) =>
        `<th style="padding:6px 10px;text-align:${i === 0 ? 'left' : 'right'};font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0">${escapeHtml(h)}</th>`,
    )
    .join('');

  const bodyRows = t.rows
    .map((r) => {
      const tds = r.values
        .map(
          (v) =>
            `<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums">${cell(v, t.metric)}</td>`,
        )
        .join('');
      return `<tr><td style="padding:6px 10px;text-align:left">${escapeHtml(r.name)}</td>${tds}</tr>`;
    })
    .join('');

  const totalCells = t.totals
    .map(
      (v) =>
        `<td style="padding:6px 10px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${cell(v, t.metric)}</td>`,
    )
    .join('');
  const totalLabel = t.metric === 'contacted' ? 'Distinct people' : 'Total';
  const totalsRow = `<tr style="border-top:2px solid #e2e8f0"><td style="padding:6px 10px;text-align:left;font-weight:600">${totalLabel}</td>${totalCells}</tr>`;

  return `
    <h3 style="margin:24px 0 8px;font-size:15px">${escapeHtml(t.title)}</h3>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;line-height:1.4">
      <thead><tr>${headCells}</tr></thead>
      <tbody>${bodyRows || `<tr><td style="padding:6px 10px;color:#94a3b8" colspan="${WINDOWS.length + 1}">No activity.</td></tr>`}${totalsRow}</tbody>
    </table>`;
}

export interface RenderArgs {
  tables: MetricTable[];
  scopeLabel: string; // "all charities" or "Acme Fund, Beta Trust"
  frequency: 'daily' | 'weekly';
  generatedAtLabel: string; // human date string in the reference tz
  appWideTimeNote: boolean; // true when scope is specific (time is app-wide)
}

export function renderDigestHtml(args: RenderArgs): string {
  const tables = args.tables.map(renderTable).join('');
  const freqWord = args.frequency === 'daily' ? 'Daily' : 'Weekly';
  const timeNote = args.appWideTimeNote
    ? `<p style="margin:8px 0 0;font-size:12px;color:#94a3b8">Time in app is measured across the whole app, not split by charity.</p>`
    : '';
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;max-width:640px;margin:0 auto">
    <h2 style="margin:0 0 4px;font-size:18px">${freqWord} activity digest</h2>
    <p style="margin:0;font-size:13px;color:#64748b">Coverage: ${escapeHtml(args.scopeLabel)} · ${escapeHtml(args.generatedAtLabel)}</p>
    <p style="margin:8px 0 0;font-size:13px;color:#64748b">Each column is a trailing window: 24h, 3 days, 7 days, 2 weeks, 30 days.</p>
    ${tables}
    <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">“People contacted” per user counts contact actions (emails + call/email/meeting notes); the totals row counts distinct people contacted.</p>
    ${timeNote}
  </div>`;
}
