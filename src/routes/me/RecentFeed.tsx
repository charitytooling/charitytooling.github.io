import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecentEvent } from '@/state/myActivity';
import { ymdInTz } from '@/state/myActivity';

type FeedFilter = 'all' | 'call' | 'email' | 'meeting' | 'research' | 'other';

const FILTER_CHIPS: { id: FeedFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'call', label: 'Calls' },
  { id: 'email', label: 'Emails' },
  { id: 'meeting', label: 'Meetings' },
  { id: 'research', label: 'Research' },
  { id: 'other', label: 'Other' },
];

interface Props {
  events: RecentEvent[];
  tzName: string;
}

const PAGE_SIZE = 50;

export function RecentFeed({ events, tzName }: Props) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [shown, setShown] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (filter === 'all') return events;
    if (filter === 'email') {
      // Both real email_log rows and rep-logged kind='email' notes count
      // as "email" so the chip means "anything email-flavored".
      return events.filter(
        (e) => e.source === 'email' || (e.source === 'note' && e.kind === 'email'),
      );
    }
    return events.filter((e) => e.source === 'note' && e.kind === filter);
  }, [events, filter]);

  const visible = filtered.slice(0, shown);

  const buckets = useMemo(() => groupByDay(visible, tzName), [visible, tzName]);

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Recent activity</h2>
        <span className="text-xs text-ink-500 dark:text-ink-400">
          {filtered.length} event{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTER_CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setFilter(c.id);
              setShown(PAGE_SIZE);
            }}
            aria-pressed={filter === c.id}
            className={[
              'rounded-full px-3 py-1 text-xs font-medium border',
              filter === c.id
                ? 'bg-accent text-white border-accent'
                : 'bg-white dark:bg-ink-900 text-ink-700 dark:text-ink-200 border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-900',
            ].join(' ')}
          >
            {c.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">
          No activity logged in this window.
        </p>
      ) : (
        <div className="space-y-3">
          {buckets.map(({ label, items }) => (
            <div key={label} className="space-y-1">
              <h3 className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-ink-500 sticky top-0 bg-white dark:bg-ink-900 py-1 -mx-1 px-1">
                {label}
              </h3>
              <ul className="space-y-1">
                {items.map((e) => (
                  <li key={`${e.source}-${e.id}`}>
                    <FeedRow event={e} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {filtered.length > visible.length && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE_SIZE)}
          className="text-xs text-accent hover:underline"
        >
          Show more
        </button>
      )}
    </section>
  );
}

function FeedRow({ event }: { event: RecentEvent }) {
  const icon = iconFor(event);
  const title =
    event.source === 'email'
      ? event.subject || '(no subject)'
      : truncate(event.body, 90);
  const customer = event.customer;

  return (
    <div className="flex items-start gap-3 rounded-lg px-2 py-2 -mx-2 hover:bg-ink-50 dark:hover:bg-ink-800">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs uppercase tracking-wide text-ink-400 dark:text-ink-500">
            {labelFor(event)}
          </span>
          {customer ? (
            <Link
              to={`/contact/${customer.id}`}
              className="text-sm font-medium hover:underline truncate"
            >
              {customer.name}
            </Link>
          ) : (
            <span className="text-sm text-ink-500 dark:text-ink-400">
              {event.source === 'email' ? event.toEmail : '(no customer)'}
            </span>
          )}
          <span className="ml-auto text-[11px] text-ink-400 dark:text-ink-500 whitespace-nowrap">
            {relative(event.at)}
          </span>
        </div>
        <p className="text-sm text-ink-600 dark:text-ink-300 truncate">{title}</p>
      </div>
    </div>
  );
}

function labelFor(e: RecentEvent): string {
  if (e.source === 'email') return 'Email';
  switch (e.kind) {
    case 'call':
      return 'Call';
    case 'email':
      return 'Email';
    case 'meeting':
      return 'Meeting';
    case 'research':
      return 'Research';
    default:
      return 'Note';
  }
}

function iconFor(e: RecentEvent): string {
  if (e.source === 'email') return '@';
  switch (e.kind) {
    case 'call':
      return 'P';
    case 'email':
      return '@';
    case 'meeting':
      return 'M';
    case 'research':
      return 'R';
    default:
      return 'N';
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '\u2026';
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function groupByDay(
  events: RecentEvent[],
  tzName: string,
): Array<{ label: string; items: RecentEvent[] }> {
  const todayYmd = ymdInTz(new Date(), tzName);
  const yesterdayYmd = ymdInTz(
    new Date(Date.now() - 24 * 60 * 60 * 1000),
    tzName,
  );
  const groups = new Map<string, RecentEvent[]>();
  for (const e of events) {
    const ymd = ymdInTz(new Date(e.at), tzName);
    const arr = groups.get(ymd) ?? [];
    arr.push(e);
    groups.set(ymd, arr);
  }
  return Array.from(groups.entries()).map(([ymd, items]) => ({
    label: ymd === todayYmd ? 'Today' : ymd === yesterdayYmd ? 'Yesterday' : ymd,
    items,
  }));
}
