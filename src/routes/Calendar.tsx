import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useActiveCharity } from '@/state/activeCharity';
import { displayName } from '@/state/customers';
import {
  useFollowUpsInRange,
  useUpdateFollowUp,
  type CalendarFollowUp,
  type FollowUpRow,
} from '@/state/notes';

type FilterMode = 'open' | 'done' | 'all';

const FILTER_LABELS: { id: FilterMode; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
];

export function CalendarPage() {
  const { activeCharityId } = useActiveCharity();
  const [showOverdue, setShowOverdue] = useState(true);
  const [filter, setFilter] = useState<FilterMode>('open');

  const today = useMemo(() => startOfDay(new Date()), []);
  const fromYmd = toYmd(showOverdue ? addDays(today, -30) : today);
  const toYmdEnd = toYmd(addDays(today, 90));

  const statuses: FollowUpRow['status'][] =
    filter === 'open'
      ? ['open', 'snoozed']
      : filter === 'done'
        ? ['done']
        : ['open', 'snoozed', 'done'];

  const q = useFollowUpsInRange({
    charityId: activeCharityId,
    fromYmd,
    toYmd: toYmdEnd,
    statuses,
  });

  const buckets = useMemo(() => groupByDay(q.data ?? []), [q.data]);

  if (!activeCharityId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <p className="mt-2 text-ink-500 text-sm">Pick or create a charity to see follow-ups.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
      <header className="card space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Calendar</h1>
          <span className="text-xs text-ink-500">
            {q.data?.length ?? 0} follow-up{(q.data?.length ?? 0) === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_LABELS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={[
                'rounded-full px-3 py-1.5 text-xs font-medium border',
                filter === f.id
                  ? 'bg-accent text-white border-accent'
                  : 'bg-white text-ink-700 border-ink-200 hover:bg-ink-50',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={showOverdue}
              onChange={(e) => setShowOverdue(e.target.checked)}
              className="h-4 w-4"
            />
            Show overdue
          </label>
        </div>
      </header>

      {q.isLoading && <div className="text-ink-400 text-sm">Loading...</div>}

      {q.error && (
        <div className="card text-red-600 text-sm">
          {(q.error as Error).message ?? 'Failed to load follow-ups.'}
        </div>
      )}

      {!q.isLoading && !q.error && buckets.length === 0 && (
        <div className="card text-sm text-ink-500">
          No follow-ups in this window. Open a customer from the{' '}
          <Link to="/ledger" className="text-accent">Ledger</Link> to add one.
        </div>
      )}

      <div className="space-y-4">
        {buckets.map((bucket) => (
          <DaySection key={bucket.ymd} ymd={bucket.ymd} items={bucket.items} today={today} />
        ))}
      </div>
    </div>
  );
}

function DaySection({
  ymd,
  items,
  today,
}: {
  ymd: string;
  items: CalendarFollowUp[];
  today: Date;
}) {
  const date = parseYmd(ymd);
  const dayLabel = formatDayLabel(date, today);
  const isPast = date.getTime() < today.getTime();
  const isToday = ymd === toYmd(today);

  return (
    <section className="card !p-0 overflow-hidden">
      <header
        className={[
          'flex items-baseline justify-between px-4 py-2 border-b border-ink-100 bg-ink-50',
          isToday ? 'text-accent' : isPast ? 'text-red-600' : 'text-ink-800',
        ].join(' ')}
      >
        <h2 className="font-semibold text-sm">{dayLabel}</h2>
        <span className="text-xs text-ink-500">
          {items.length} item{items.length === 1 ? '' : 's'}
        </span>
      </header>
      <ul className="divide-y divide-ink-100">
        {items.map((item) => (
          <FollowUpRowItem key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function FollowUpRowItem({ item }: { item: CalendarFollowUp }) {
  const update = useUpdateFollowUp();
  const name = displayName(item.customer);
  const isDone = item.status === 'done';

  return (
    <li className="flex items-center justify-between gap-2 px-4 py-3">
      <div className="min-w-0">
        <Link
          to={`/contact/${item.customer.id}`}
          className="block text-sm font-medium truncate hover:text-accent"
        >
          {name}
        </Link>
        <div className="text-xs text-ink-500 truncate">
          {item.reason ?? 'Follow up'}
          {item.status === 'snoozed' && ' - snoozed'}
          {isDone && ' - done'}
        </div>
      </div>
      {!isDone && (
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            className="text-xs bg-white border border-ink-200 rounded-md px-2 py-1"
            onClick={() =>
              update.mutate({
                id: item.id,
                status: 'snoozed',
                due_date: toYmd(addDays(parseYmd(item.due_date), 7)),
              })
            }
            disabled={update.isPending}
          >
            +7d
          </button>
          <button
            type="button"
            className="text-xs bg-accent text-white rounded-md px-2 py-1"
            onClick={() => update.mutate({ id: item.id, status: 'done' })}
            disabled={update.isPending}
          >
            Done
          </button>
        </div>
      )}
      {isDone && (
        <button
          type="button"
          className="text-xs bg-white border border-ink-200 rounded-md px-2 py-1 shrink-0"
          onClick={() => update.mutate({ id: item.id, status: 'open' })}
          disabled={update.isPending}
        >
          Reopen
        </button>
      )}
    </li>
  );
}

type DayBucket = { ymd: string; items: CalendarFollowUp[] };

function groupByDay(rows: CalendarFollowUp[]): DayBucket[] {
  const map = new Map<string, CalendarFollowUp[]>();
  for (const r of rows) {
    const list = map.get(r.due_date) ?? [];
    list.push(r);
    map.set(r.due_date, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([ymd, items]) => ({ ymd, items }));
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(ymd: string): Date {
  // Parse as local-date midnight to avoid UTC-shift surprises on the agenda.
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatDayLabel(date: Date, today: Date): string {
  const ymd = toYmd(date);
  if (ymd === toYmd(today)) return 'Today';
  if (ymd === toYmd(addDays(today, 1))) return 'Tomorrow';
  if (ymd === toYmd(addDays(today, -1))) return 'Yesterday';
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}
