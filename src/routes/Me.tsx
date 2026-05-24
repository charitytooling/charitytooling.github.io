import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useActiveCharity } from '@/state/activeCharity';
import { useMyCharities } from '@/state/charities';
import { useMyActivity, type ActivityRange } from '@/state/myActivity';
import { formatStopwatch } from '@/state/visitTimer';
import { ActivityHeatmap } from './me/ActivityHeatmap';
import { TopCustomers } from './me/TopCustomers';
import { RecentFeed } from './me/RecentFeed';

const RANGES: { id: ActivityRange; label: string; days: number }[] = [
  { id: '7d', label: '7d', days: 7 },
  { id: '30d', label: '30d', days: 30 },
  { id: '90d', label: '90d', days: 90 },
  { id: 'all', label: 'All time', days: 365 },
];

export function MePage() {
  const { user } = useAuth();
  const { activeCharityId } = useActiveCharity();
  const { data: charities } = useMyCharities();
  const [range, setRange] = useState<ActivityRange>('30d');

  const tzName =
    charities?.find((c) => c.id === activeCharityId)?.default_tz ?? 'UTC';

  const activity = useMyActivity({
    charityId: activeCharityId,
    userId: user?.id ?? null,
    range,
    tzName,
  });

  const windowDays = useMemo(
    () => RANGES.find((r) => r.id === range)?.days ?? 30,
    [range],
  );

  if (!activeCharityId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold">My activity</h1>
        <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
          No charity selected. An admin must invite you, or you can create one
          from the Admin tab.
        </p>
      </div>
    );
  }

  const hasAnything =
    activity.totalSeconds > 0 ||
    activity.noteCount > 0 ||
    activity.emailCount > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
      <header className="card space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">My activity</h1>
          <span className="text-xs text-ink-500 dark:text-ink-400">
            {tzName}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              aria-pressed={range === r.id}
              className={[
                'rounded-full px-3 py-1.5 text-xs font-medium border',
                range === r.id
                  ? 'bg-accent text-white border-accent'
                  : 'bg-white dark:bg-ink-900 text-ink-700 dark:text-ink-200 border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-900',
              ].join(' ')}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total time" value={formatStopwatch(activity.totalSeconds)} loading={activity.isLoading} />
        <KpiCard label="Active days" value={String(activity.activeDays)} loading={activity.isLoading} />
        <KpiCard label="Notes" value={String(activity.noteCount)} loading={activity.isLoading} />
        <KpiCard label="Calls" value={String(activity.callCount)} loading={activity.isLoading} />
      </section>

      {!activity.isLoading && !hasAnything ? (
        <section className="card text-center py-8">
          <h2 className="text-sm font-semibold">No activity yet</h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Once you start working contacts, your activity shows up here.
          </p>
          <Link
            to="/contact"
            className="mt-3 inline-flex btn-primary text-sm py-2 px-4"
          >
            Open a contact
          </Link>
        </section>
      ) : (
        <>
          <ActivityHeatmap
            perDay={activity.perDay}
            tzName={tzName}
            windowDays={windowDays}
          />
          <TopCustomers rows={activity.perCustomer} />
          <RecentFeed events={activity.recentEvents} tzName={tzName} />
        </>
      )}

      {activity.error && (
        <div className="card text-sm text-red-600 dark:text-red-400">
          Couldn't load activity: {activity.error.message}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="card py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-ink-500">
        {label}
      </div>
      {loading ? (
        <div className="mt-1 h-6 w-16 rounded bg-ink-100 dark:bg-ink-800 animate-pulse" />
      ) : (
        <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      )}
    </div>
  );
}
