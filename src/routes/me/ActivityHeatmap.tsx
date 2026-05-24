import { useMemo, useState } from 'react';
import type { PerDayStats } from '@/state/myActivity';
import { todayYmdInTz, ymdInTz } from '@/state/myActivity';

const DAY_ROWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Props {
  perDay: Map<string, PerDayStats>;
  tzName: string;
  // Number of days to render (matches the page's range; capped for "all").
  windowDays: number;
}

interface Cell {
  ymd: string;
  inWindow: boolean;
  stats: PerDayStats;
  total: number;
}

// Builds a 7-row x N-column grid ending today. Columns are weeks (Mon-Sun).
// We left-pad with empty cells so the first column starts on a Monday.
function buildGrid(opts: {
  perDay: Map<string, PerDayStats>;
  tzName: string;
  windowDays: number;
}): { columns: Cell[][]; total: number; max: number } {
  const todayYmd = todayYmdInTz(opts.tzName);
  const [ty, tm, td] = todayYmd.split('-').map(Number);
  const today = new Date(Date.UTC(ty, tm - 1, td));
  // JS getUTCDay: Sun=0..Sat=6. We want Mon=0..Sun=6.
  const todayCol = (today.getUTCDay() + 6) % 7;

  const days: Cell[] = [];
  for (let i = opts.windowDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const ymd = ymdInTz(d, opts.tzName);
    const stats = opts.perDay.get(ymd) ?? {
      visits: 0,
      notes: 0,
      emails: 0,
      minutes: 0,
    };
    const total = stats.visits + stats.notes + stats.emails;
    days.push({ ymd, inWindow: true, stats, total });
  }

  // Pad the head so the first day aligns to its weekday row.
  const firstCol = (todayCol - ((opts.windowDays - 1) % 7) + 7) % 7;
  const padHead = firstCol;
  // Pad the tail so the grid ends on a full Sunday column.
  const padTail = 6 - todayCol;

  const padCell = (): Cell => ({
    ymd: '',
    inWindow: false,
    stats: { visits: 0, notes: 0, emails: 0, minutes: 0 },
    total: 0,
  });

  const flat: Cell[] = [
    ...Array.from({ length: padHead }, padCell),
    ...days,
    ...Array.from({ length: padTail }, padCell),
  ];

  const columns: Cell[][] = [];
  for (let i = 0; i < flat.length; i += 7) columns.push(flat.slice(i, i + 7));

  let total = 0;
  let max = 0;
  for (const d of days) {
    total += d.total;
    if (d.total > max) max = d.total;
  }

  return { columns, total, max };
}

function intensityClass(value: number, max: number): string {
  if (max === 0 || value === 0) {
    return 'bg-ink-100 dark:bg-ink-800';
  }
  const r = value / max;
  if (r < 0.25) return 'bg-accent/20';
  if (r < 0.5) return 'bg-accent/40';
  if (r < 0.75) return 'bg-accent/60';
  return 'bg-accent';
}

export function ActivityHeatmap({ perDay, tzName, windowDays }: Props) {
  const { columns, total, max } = useMemo(
    () => buildGrid({ perDay, tzName, windowDays }),
    [perDay, tzName, windowDays],
  );
  const [hover, setHover] = useState<Cell | null>(null);

  const sparkline = useMemo(() => {
    const points: { ymd: string; minutes: number }[] = [];
    for (const col of columns) {
      for (const cell of col) {
        if (cell.inWindow) points.push({ ymd: cell.ymd, minutes: cell.stats.minutes });
      }
    }
    return points;
  }, [columns]);

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Activity</h2>
        <span className="text-xs text-ink-500 dark:text-ink-400">
          {total} event{total === 1 ? '' : 's'} in window
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="flex items-start gap-1">
          <div className="flex flex-col gap-[3px] pr-1 pt-[2px]">
            {DAY_ROWS.map((d, i) => (
              <span
                key={d}
                className="text-[10px] leading-[12px] text-ink-400 dark:text-ink-500 w-6"
              >
                {i % 2 === 0 ? d : ''}
              </span>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {columns.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[3px]">
                {col.map((cell, ri) => (
                  <button
                    key={ri}
                    type="button"
                    aria-label={
                      cell.inWindow
                        ? `${cell.ymd}: ${cell.stats.visits} visits, ${cell.stats.notes} notes, ${cell.stats.emails} emails`
                        : 'No data'
                    }
                    disabled={!cell.inWindow}
                    onMouseEnter={() => setHover(cell.inWindow ? cell : null)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(cell.inWindow ? cell : null)}
                    onBlur={() => setHover(null)}
                    className={[
                      'h-3 w-3 rounded-sm transition-colors',
                      cell.inWindow
                        ? intensityClass(cell.total, max)
                        : 'bg-transparent',
                      cell.inWindow ? 'cursor-default' : '',
                    ].join(' ')}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-ink-500 dark:text-ink-400">
        <span>
          {hover
            ? `${hover.ymd} - ${hover.stats.visits} visits, ${hover.stats.notes} notes, ${hover.stats.emails} emails (${Math.round(hover.stats.minutes)}m)`
            : 'Each cell is one day; brighter means more activity'}
        </span>
        <div className="flex items-center gap-1" aria-hidden="true">
          <span>Less</span>
          <span className="h-3 w-3 rounded-sm bg-ink-100 dark:bg-ink-800" />
          <span className="h-3 w-3 rounded-sm bg-accent/20" />
          <span className="h-3 w-3 rounded-sm bg-accent/40" />
          <span className="h-3 w-3 rounded-sm bg-accent/60" />
          <span className="h-3 w-3 rounded-sm bg-accent" />
          <span>More</span>
        </div>
      </div>

      <Sparkline points={sparkline} />
    </section>
  );
}

function Sparkline({ points }: { points: { ymd: string; minutes: number }[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.minutes), 1);
  const w = 600;
  const h = 36;
  const stepX = w / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = (i * stepX).toFixed(2);
      const y = (h - (p.minutes / max) * h).toFixed(2);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <div className="pt-1">
      <div className="text-[10px] text-ink-500 dark:text-ink-400 mb-1">
        Minutes per day
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full h-9 text-accent"
        aria-hidden="true"
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    </div>
  );
}
