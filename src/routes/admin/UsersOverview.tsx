import { useState } from 'react';
import { formatStopwatch } from '@/state/visitTimer';
import type { ActivityRange } from '@/state/myActivity';
import { useUsersOverview, type UserOverviewRow } from '@/state/usersOverview';

const RANGES: { id: ActivityRange; label: string }[] = [
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'all', label: 'All time' },
];

function userName(r: UserOverviewRow): string {
  return r.fullName?.trim() || r.email || 'Unknown user';
}

// Renders as a section so it can be embedded at the bottom of the Admin page.
// Callers gate visibility on super-admin; the RPC also returns no rows for
// non-super callers.
export function UsersOverview() {
  const [range, setRange] = useState<ActivityRange>('30d');
  const { data, isLoading, error } = useUsersOverview(range);

  const rows = data ?? [];

  return (
    <section className="space-y-3">
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
          Users
        </h2>
        <p className="text-ink-500 dark:text-ink-400 text-xs">
          Activity across all charities. Active days are counted in UTC.
        </p>
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
      </div>

      {error && (
        <div className="card text-sm text-red-600 dark:text-red-400">
          Couldn't load users: {error.message}
        </div>
      )}

      {isLoading ? (
        <ul className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="card h-20 animate-pulse bg-ink-50 dark:bg-ink-900" />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="card text-sm text-ink-500 dark:text-ink-400">No users yet.</div>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <ul className="space-y-2 sm:hidden">
            {rows.map((r) => (
              <li key={r.userId} className="card space-y-2">
                <div>
                  <div className="font-semibold">{userName(r)}</div>
                  {r.email && (
                    <div className="text-xs text-ink-500 dark:text-ink-400">{r.email}</div>
                  )}
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="App time" value={formatStopwatch(r.appSeconds)} />
                  <Stat label="Contact time" value={formatStopwatch(r.visitSeconds)} />
                  <Stat label="Active days" value={String(r.activeDays)} />
                  <Stat label="Notes" value={String(r.noteCount)} />
                  <Stat label="Calls" value={String(r.callCount)} />
                </dl>
              </li>
            ))}
          </ul>

          {/* sm and up: table */}
          <div className="card hidden overflow-x-auto p-0 sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800 dark:text-ink-500">
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 text-right font-medium">App time</th>
                  <th className="px-3 py-2 text-right font-medium">Contact time</th>
                  <th className="px-3 py-2 text-right font-medium">Active days</th>
                  <th className="px-3 py-2 text-right font-medium">Notes</th>
                  <th className="px-3 py-2 text-right font-medium">Calls</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.userId}
                    className="border-b border-ink-50 last:border-0 dark:border-ink-900"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{userName(r)}</div>
                      {r.email && r.fullName?.trim() && (
                        <div className="text-xs text-ink-500 dark:text-ink-400">{r.email}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatStopwatch(r.appSeconds)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatStopwatch(r.visitSeconds)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.activeDays}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.noteCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.callCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-ink-500">
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
