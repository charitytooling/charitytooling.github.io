import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PerCustomerStats } from '@/state/myActivity';
import { formatStopwatch } from '@/state/visitTimer';

const INITIAL_LIMIT = 10;
const EXPANDED_LIMIT = 25;

interface Props {
  rows: PerCustomerStats[];
}

export function TopCustomers({ rows }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(
    () => rows.slice(0, expanded ? EXPANDED_LIMIT : INITIAL_LIMIT),
    [rows, expanded],
  );

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Top customers by time</h2>
        <span className="text-xs text-ink-500 dark:text-ink-400">
          {rows.length} contact{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">
          No card visits in this window yet.
        </p>
      ) : (
        <ol className="space-y-1">
          {visible.map((row, i) => (
            <li key={row.customerId}>
              <Link
                to={`/contact/${row.customerId}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink-50 dark:hover:bg-ink-800 -mx-2"
              >
                <span className="w-6 text-right text-xs text-ink-400 dark:text-ink-500 tabular-nums">
                  {i + 1}
                </span>
                <span className="flex-1 truncate text-sm">{row.name}</span>
                <span className="text-xs text-ink-500 dark:text-ink-400 tabular-nums whitespace-nowrap">
                  {row.visitCount} visit{row.visitCount === 1 ? '' : 's'}
                </span>
                <span className="text-sm tabular-nums whitespace-nowrap font-medium">
                  {formatStopwatch(row.totalSeconds)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {rows.length > visible.length && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-accent hover:underline"
        >
          View more
        </button>
      )}
    </section>
  );
}
