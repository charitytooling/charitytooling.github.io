import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { compactMoney } from '@/lib/format';
import { nteeMajorLabel } from '@/lib/bmfLookups';
import { useDafMetrics } from '@/state/orgs';
import { BubbleChart, HistogramStrip } from './metrics/charts';
import { MetricDetailModal } from './metrics/MetricDetailModal';
import {
  ASSET_TIERS,
  applyMetricFilters,
  avgGrantClass,
  computeMetricStats,
  DEFAULT_METRIC_FILTERS,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtRatio,
  netFlowClass,
  payoutClass,
  velocityClass,
  type MetricFilters,
} from './metrics/metricBands';

type SortKey = 'name' | 'year' | 'eoy_assets' | 'accounts' | 'grants' | 'payout_pct' | 'avg_grant' | 'net_flow' | 'velocity';
const TABLE_CAP = 250;

export function MetricsPage() {
  const { data: all, isLoading, isError, error } = useDafMetrics();
  const [filters, setFilters] = useState<MetricFilters>(DEFAULT_METRIC_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>('eoy_assets');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [drill, setDrill] = useState<string | null>(null);

  const rows = all ?? [];
  const options = useMemo(() => {
    const types = new Set<string>();
    const states = new Set<string>();
    const majors = new Set<string>();
    for (const r of rows) {
      if (r.type) types.add(r.type);
      if (r.state) states.add(r.state);
      if (r.ntee_major) majors.add(r.ntee_major);
    }
    return {
      types: [...types].sort(),
      states: [...states].sort(),
      majors: [...majors].sort(),
    };
  }, [rows]);

  const filtered = useMemo(() => applyMetricFilters(rows, filters), [rows, filters]);
  const stats = useMemo(() => computeMetricStats(filtered), [filtered]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return dir * av.localeCompare(String(bv));
      return dir * ((av as number) - (bv as number));
    });
  }, [filtered, sortKey, sortDir]);

  const visible = sorted.slice(0, TABLE_CAP);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir(k === 'name' ? 'asc' : 'desc');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 pt-3 text-sm">
        <Link to="/search" className="text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100">
          Charities
        </Link>
        <span className="font-semibold text-accent">DAF Metrics</span>
      </div>

      <div className="sticky top-0 z-10 border-b border-ink-100 bg-ink-50/90 px-4 pb-2 pt-2 backdrop-blur dark:border-ink-800 dark:bg-ink-950/90">
        <div className="mx-auto flex max-w-5xl items-center gap-2">
          <input
            type="search"
            placeholder="Search sponsor name or EIN…"
            className="field flex-1"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          />
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-600 dark:text-ink-300">
            <input
              type="checkbox"
              checked={filters.latestOnly}
              onChange={(e) => setFilters((f) => ({ ...f, latestOnly: e.target.checked }))}
            />
            Latest yr
          </label>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="btn shrink-0 bg-ink-100 px-3 py-3 text-sm text-ink-700 dark:bg-ink-800 dark:text-ink-200"
          >
            Filters
          </button>
        </div>
        {showFilters && (
          <div className="mx-auto mt-2 max-w-5xl space-y-2 rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
            <ChipRow label="Type" values={options.types} selected={filters.types} onToggle={(v) => setFilters((f) => ({ ...f, types: toggle(f.types, v) }))} />
            <ChipRow label="State" values={options.states} selected={filters.states} onToggle={(v) => setFilters((f) => ({ ...f, states: toggle(f.states, v) }))} scroll />
            <ChipRow
              label="Category"
              values={options.majors}
              selected={filters.nteeMajors}
              onToggle={(v) => setFilters((f) => ({ ...f, nteeMajors: toggle(f.nteeMajors, v) }))}
              labelFor={(m) => `${m} · ${nteeMajorLabel(m)}`}
            />
            <ChipRow
              label="Asset tier"
              values={ASSET_TIERS.map((t) => t.id)}
              selected={filters.assetTiers}
              onToggle={(v) => setFilters((f) => ({ ...f, assetTiers: toggle(f.assetTiers, v) }))}
              labelFor={(id) => ASSET_TIERS.find((t) => t.id === id)?.label ?? id}
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto max-w-5xl space-y-4">
          {isError ? (
            <p className="text-sm text-red-600">{(error as Error)?.message ?? 'Failed to load metrics.'}</p>
          ) : isLoading ? (
            <p className="text-sm text-ink-500 dark:text-ink-400">Loading DAF metrics…</p>
          ) : (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Stat label="Sponsors" value={stats.sponsors.toLocaleString()} />
                <Stat label="EOY assets" value={compactMoney(stats.totalAssets)} />
                <Stat label="Wtd payout" value={fmtPct(stats.weightedPayout)} />
                <Stat label="Wtd avg grant" value={fmtMoney(stats.weightedAvgGrant)} />
                <Stat label="Net flow" value={fmtMoney(stats.totalNetFlow)} />
                <Stat label="Wtd velocity" value={fmtRatio(stats.weightedVelocity)} />
              </div>

              {/* Charts */}
              <div className="card">
                <div className="mb-1 text-sm font-semibold">Payout % vs. Velocity</div>
                <p className="mb-2 text-xs text-ink-500 dark:text-ink-400">
                  Each bubble is a sponsor. Area = EOY assets; color = net-flow sign (orange accumulating, blue drawing
                  down). Tap a bubble for detail.
                </p>
                <BubbleChart rows={filtered} onSelect={setDrill} />
              </div>
              <div className="card">
                <div className="mb-2 text-sm font-semibold">Distributions</div>
                <HistogramStrip rows={filtered} />
              </div>

              {/* Table */}
              <div className="card overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs tabular-nums">
                  <thead className="text-ink-500 dark:text-ink-400">
                    <tr>
                      <Th onClick={() => toggleSort('name')} active={sortKey === 'name'} dir={sortDir} align="left">Sponsor</Th>
                      <Th onClick={() => toggleSort('year')} active={sortKey === 'year'} dir={sortDir}>Yr</Th>
                      <th className="px-1 py-1 text-left font-medium">St</th>
                      <Th onClick={() => toggleSort('eoy_assets')} active={sortKey === 'eoy_assets'} dir={sortDir}>EOY Assets</Th>
                      <Th onClick={() => toggleSort('accounts')} active={sortKey === 'accounts'} dir={sortDir}>Accts</Th>
                      <Th onClick={() => toggleSort('grants')} active={sortKey === 'grants'} dir={sortDir}>Grants</Th>
                      <Th onClick={() => toggleSort('payout_pct')} active={sortKey === 'payout_pct'} dir={sortDir}>Payout</Th>
                      <Th onClick={() => toggleSort('avg_grant')} active={sortKey === 'avg_grant'} dir={sortDir}>Avg Grant</Th>
                      <Th onClick={() => toggleSort('net_flow')} active={sortKey === 'net_flow'} dir={sortDir}>Net Flow</Th>
                      <Th onClick={() => toggleSort('velocity')} active={sortKey === 'velocity'} dir={sortDir}>Vel.</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr
                        key={`${r.ein}-${r.year}`}
                        onClick={() => setDrill(r.ein)}
                        className="cursor-pointer border-t border-ink-100 hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800/40"
                      >
                        <td className="max-w-[220px] truncate py-1 pr-2 font-medium" title={r.name ?? r.ein}>
                          {r.name ?? r.ein}
                        </td>
                        <td className="px-1 text-right">{r.year}</td>
                        <td className="px-1">{r.state ?? ''}</td>
                        <td className="px-1 text-right">{fmtMoney(r.eoy_assets)}</td>
                        <td className="px-1 text-right">{fmtInt(r.accounts)}</td>
                        <td className="px-1 text-right">{fmtMoney(r.grants)}</td>
                        <td className={`px-1 text-right ${payoutClass(r.payout_pct)}`}>
                          {fmtPct(r.payout_pct)}
                          {r.payout_approx ? '*' : ''}
                        </td>
                        <td className={`px-1 text-right ${avgGrantClass(r.avg_grant)}`}>{fmtMoney(r.avg_grant)}</td>
                        <td className={`px-1 text-right ${netFlowClass(r.net_flow)}`}>{fmtMoney(r.net_flow)}</td>
                        <td className={`px-1 text-right ${velocityClass(r.velocity)}`}>{fmtRatio(r.velocity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] text-ink-400 dark:text-ink-500">
                  Showing {visible.length.toLocaleString()} of {sorted.length.toLocaleString()} rows
                  {sorted.length > TABLE_CAP ? ' (refine filters or search to see more). ' : '. '}
                  Stat cards and charts reflect all {filtered.length.toLocaleString()} filtered rows. * payout uses EOY
                  assets only.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {drill && <MetricDetailModal ein={drill} rows={rows} onClose={() => setDrill(null)} />}
    </div>
  );
}

function toggle(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-2 text-center dark:border-ink-800 dark:bg-ink-900">
      <div className="text-[10px] uppercase tracking-wide text-ink-400 dark:text-ink-500">{label}</div>
      <div className="truncate text-sm font-semibold tabular-nums" title={value}>
        {value}
      </div>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  align = 'right',
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: 'asc' | 'desc';
  align?: 'left' | 'right';
}) {
  return (
    <th
      onClick={onClick}
      className={[
        'cursor-pointer select-none px-1 py-1 font-medium',
        align === 'left' ? 'text-left' : 'text-right',
        active ? 'text-accent' : '',
      ].join(' ')}
    >
      {children}
      {active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

function ChipRow({
  label,
  values,
  selected,
  onToggle,
  labelFor,
  scroll,
}: {
  label: string;
  values: string[];
  selected: string[];
  onToggle: (v: string) => void;
  labelFor?: (v: string) => string;
  scroll?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-500 dark:text-ink-400">{label}</div>
      <div className={['flex flex-wrap gap-1', scroll ? 'max-h-24 overflow-y-auto' : ''].join(' ')}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onToggle(v)}
            className={[
              'rounded-full px-2.5 py-1 text-xs',
              selected.includes(v)
                ? 'bg-accent text-white'
                : 'bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700',
            ].join(' ')}
          >
            {labelFor ? labelFor(v) : v}
          </button>
        ))}
      </div>
    </div>
  );
}
