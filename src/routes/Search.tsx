import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useActiveCharity } from '@/state/activeCharity';
import { compactMoney } from '@/lib/format';
import {
  DEFAULT_FILTERS,
  NTEE_MAJOR_LABELS,
  ORG_TYPES,
  PRESETS,
  REVENUE_TIERS,
  STATUS_LABELS,
  SUBSECTION_LABELS,
  US_STATES,
  assetRevenueTier,
  nteeMajorLabel,
  type OrgType,
  type Preset,
  type SearchFilters,
} from '@/lib/bmfLookups';
import {
  bmfOrgToLedgerInput,
  useAddOrgToLedger,
  useLedgerEinSet,
  useOrgSearch,
  type BmfOrg,
  type SortKey,
  type SortState,
} from '@/state/orgs';
import { OrgDetailModal } from './search/OrgDetailModal';

const SORT_OPTIONS: { label: string; key: SortKey; dir: 'asc' | 'desc' }[] = [
  { label: 'Revenue (high → low)', key: 'revenue', dir: 'desc' },
  { label: 'Assets (high → low)', key: 'assets', dir: 'desc' },
  { label: 'Name (A → Z)', key: 'name', dir: 'asc' },
  { label: 'Recently recognized', key: 'ruling', dir: 'desc' },
];

function countActive(f: SearchFilters): number {
  let n = 0;
  if (f.states.length) n++;
  if (f.ntee_majors.length) n++;
  if (f.ntee_prefixes.length) n++;
  if (f.org_type) n++;
  if (f.min_revenue > 0) n++;
  if (f.daf_only) n++;
  if (f.subsections.length !== 1 || f.subsections[0] !== '03') n++;
  if (f.statuses.length !== 1 || f.statuses[0] !== '01') n++;
  return n;
}

export function SearchPage() {
  const { activeCharityId } = useActiveCharity();
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [qInput, setQInput] = useState('');
  const [sortIdx, setSortIdx] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<BmfOrg | null>(null);

  // Debounce the free-text box into the filter state (which drives the query).
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput })), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const sort: SortState = useMemo(
    () => ({ key: SORT_OPTIONS[sortIdx].key, dir: SORT_OPTIONS[sortIdx].dir }),
    [sortIdx],
  );

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useOrgSearch(filters, sort);

  const rows = useMemo(() => data?.pages.flatMap((p) => p.rows) ?? [], [data]);
  const stats = data?.pages[0]?.stats;
  const total = data?.pages[0]?.total ?? 0;

  const { data: ledgerEins } = useLedgerEinSet(activeCharityId);
  const addToLedger = useAddOrgToLedger(activeCharityId);
  const [optimisticAdded, setOptimisticAdded] = useState<Set<string>>(() => new Set());
  const isInLedger = (ein: string) => !!ledgerEins?.has(ein) || optimisticAdded.has(ein);

  const [showHint, setShowHint] = useState(() => {
    try {
      return localStorage.getItem('search.swipeHintDismissed') !== '1';
    } catch {
      return true;
    }
  });
  function dismissHint() {
    setShowHint(false);
    try {
      localStorage.setItem('search.swipeHintDismissed', '1');
    } catch {
      // private mode / storage disabled — fine, the hint just reappears next load
    }
  }

  // Swipe-right (or the modal button) adds an org with no confirmation. Mark it
  // added locally for instant feedback; roll back only if the write fails.
  function addOrgToLedger(org: BmfOrg) {
    if (!activeCharityId || isInLedger(org.ein)) return;
    dismissHint();
    setOptimisticAdded((prev) => new Set(prev).add(org.ein));
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);
    addToLedger.mutate(
      { org: bmfOrgToLedgerInput(org) },
      {
        onError: () =>
          setOptimisticAdded((prev) => {
            const next = new Set(prev);
            next.delete(org.ein);
            return next;
          }),
      },
    );
  }

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 66,
    overscan: 8,
  });

  // Infinite scroll: pull the next page when the last virtual row comes into view.
  const virtualItems = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (last && last.index >= rows.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [virtualItems, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const activeCount = countActive(filters);

  function applyPreset(p: Preset) {
    setFilters((f) => ({
      ...f,
      ntee_majors: p.ntee_majors ?? [],
      ntee_prefixes: p.ntee_prefixes ?? [],
      org_type: p.org_type ?? f.org_type,
      min_revenue: p.min_revenue ?? f.min_revenue,
    }));
  }

  function resetFilters() {
    setFilters({ ...DEFAULT_FILTERS, q: qInput });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sub-nav */}
      <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-4 pt-3 text-sm">
        <span className="font-semibold text-accent">Charities</span>
        <Link to="/metrics" className="text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100">
          DAF Metrics
        </Link>
      </div>

      {/* Sticky search + controls */}
      <div className="sticky top-0 z-10 border-b border-ink-100 bg-ink-50/90 px-4 pb-2 pt-2 backdrop-blur dark:border-ink-800 dark:bg-ink-950/90">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <input
            type="search"
            inputMode="search"
            placeholder="Search name, city, or EIN…"
            className="field flex-1"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={[
              'btn shrink-0 px-3 py-3 text-sm',
              activeCount > 0 || showFilters
                ? 'bg-accent/10 text-accent'
                : 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
            ].join(' ')}
          >
            Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          </button>
        </div>

        <div className="mx-auto mt-2 flex max-w-3xl items-center justify-between gap-2 text-xs text-ink-500 dark:text-ink-400">
          <span>
            {isLoading
              ? 'Searching…'
              : `${rows.length.toLocaleString()} of ${total.toLocaleString()} shown`}
          </span>
          <select
            className="bg-transparent text-xs text-ink-600 dark:text-ink-300"
            value={sortIdx}
            onChange={(e) => setSortIdx(Number(e.target.value))}
          >
            {SORT_OPTIONS.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {showFilters && (
          <FilterPanel
            filters={filters}
            setFilters={setFilters}
            applyPreset={applyPreset}
            resetFilters={resetFilters}
            activeCount={activeCount}
          />
        )}
      </div>

      {/* Scroll area: stats + results */}
      <div ref={parentRef} className="flex-1 overflow-y-auto px-4 py-2">
        <div className="mx-auto max-w-3xl">
          {stats && <StatCards stats={stats} />}

          {showHint && activeCharityId && rows.length > 0 && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              <span>Tip: swipe a row right to add it to your ledger →</span>
              <button
                type="button"
                onClick={dismissHint}
                aria-label="Dismiss tip"
                className="shrink-0 rounded px-1 text-emerald-700/70 hover:text-emerald-900 dark:text-emerald-300/70 dark:hover:text-emerald-100"
              >
                ×
              </button>
            </div>
          )}

          {isError ? (
            <p className="mt-6 text-sm text-red-600">{(error as Error)?.message ?? 'Search failed.'}</p>
          ) : rows.length === 0 && !isLoading ? (
            <p className="mt-6 text-sm text-ink-500 dark:text-ink-400">
              No organizations match these filters.
            </p>
          ) : (
            <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
              {virtualItems.map((vi) => {
                const org = rows[vi.index];
                return (
                  <div
                    key={org.ein}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    <OrgRow
                      org={org}
                      inLedger={isInLedger(org.ein)}
                      canAdd={!!activeCharityId}
                      onOpen={() => setSelected(org)}
                      onAdd={() => addOrgToLedger(org)}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {isFetchingNextPage && (
            <p className="py-4 text-center text-xs text-ink-500 dark:text-ink-400">Loading more…</p>
          )}
        </div>
      </div>

      {selected && (
        <OrgDetailModal
          org={selected}
          charityId={activeCharityId}
          inLedger={isInLedger(selected.ein)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function StatCards({
  stats,
}: {
  stats: {
    count: number;
    total_revenue: number;
    total_assets: number;
    public_charities: number;
    private_foundations: number;
    daf_sponsor_count: number;
  };
}) {
  const cards: { label: string; value: string }[] = [
    { label: 'Orgs matching', value: stats.count.toLocaleString() },
    { label: 'Public charities', value: stats.public_charities.toLocaleString() },
    { label: 'Private foundations', value: stats.private_foundations.toLocaleString() },
    { label: 'Total revenue', value: compactMoney(stats.total_revenue) },
    { label: 'Total assets', value: compactMoney(stats.total_assets) },
    { label: 'DAF sponsors', value: stats.daf_sponsor_count.toLocaleString() },
  ];
  return (
    <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-ink-100 bg-white p-2 text-center dark:border-ink-800 dark:bg-ink-900">
          <div className="truncate text-sm font-semibold tabular-nums" title={c.value}>
            {c.value}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-ink-400 dark:text-ink-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function OrgRow({
  org,
  inLedger,
  canAdd,
  onOpen,
  onAdd,
}: {
  org: BmfOrg;
  inLedger: boolean;
  canAdd: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(org.name)}`;
  const tier = assetRevenueTier(org.revenue, org.assets);
  const SWIPE_MAX = 130;
  const SWIPE_THRESHOLD = 76;
  const canSwipe = canAdd && !inLedger;

  // Driven by direct DOM writes (no React re-render per move) so the row tracks
  // the finger/cursor 1:1 with zero latency.
  const rowRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const gesture = useRef({
    x: 0,
    y: 0,
    dir: 'none' as 'none' | 'h' | 'v',
    dx: 0,
    id: -1,
    active: false,
    armed: false,
  });
  const suppressClick = useRef(false);

  function paint(dx: number) {
    if (rowRef.current) rowRef.current.style.transform = dx ? `translateX(${dx}px)` : '';
    if (revealRef.current) revealRef.current.style.width = `${dx}px`;
  }

  // Pointer events cover mouse (desktop drag), touch, and pen with one path.
  function onPointerDown(e: React.PointerEvent) {
    if (!canSwipe || e.button !== 0) return;
    const g = gesture.current;
    g.x = e.clientX;
    g.y = e.clientY;
    g.dir = 'none';
    g.dx = 0;
    g.id = e.pointerId;
    g.active = true;
    g.armed = false;
    if (rowRef.current) rowRef.current.style.transition = 'none';
  }
  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g.active || e.pointerId !== g.id) return;
    const ddx = e.clientX - g.x;
    const ddy = e.clientY - g.y;
    if (g.dir === 'none') {
      // Tiny dead-zone so the row starts tracking your finger almost instantly.
      if (Math.abs(ddx) < 4 && Math.abs(ddy) < 4) return;
      g.dir = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
      if (g.dir === 'h') {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // best-effort
        }
      }
    }
    if (g.dir === 'h') {
      const clamped = Math.max(0, Math.min(ddx, SWIPE_MAX));
      g.dx = clamped;
      paint(clamped);
      const nowArmed = clamped >= SWIPE_THRESHOLD;
      if (nowArmed !== g.armed) {
        g.armed = nowArmed;
        if (labelRef.current) labelRef.current.textContent = nowArmed ? '＋ Release to add' : '＋ Add to ledger';
        if (nowArmed && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
      }
    }
  }
  function endGesture(e: React.PointerEvent, allowCommit: boolean) {
    const g = gesture.current;
    if (!g.active || e.pointerId !== g.id) return;
    const commit = allowCommit && g.dir === 'h' && g.dx >= SWIPE_THRESHOLD;
    if (g.dir === 'h') suppressClick.current = true;
    g.active = false;
    g.armed = false;
    if (rowRef.current) rowRef.current.style.transition = 'transform 0.16s ease-out';
    paint(0);
    if (labelRef.current) labelRef.current.textContent = '＋ Add to ledger';
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // best-effort
    }
    if (commit) onAdd();
  }
  // A horizontal swipe shouldn't also fire the row's open-modal tap.
  function handleClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onOpen();
  }

  return (
    <div className="relative overflow-hidden border-b border-ink-100 dark:border-ink-800">
      {canSwipe && (
        <div
          ref={revealRef}
          className="absolute inset-y-0 left-0 z-0 flex w-0 items-center overflow-hidden bg-emerald-600 pl-4 text-xs font-semibold text-white"
        >
          <span ref={labelRef} className="whitespace-nowrap">＋ Add to ledger</span>
        </div>
      )}
      <div
        ref={rowRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endGesture(e, true)}
        onPointerCancel={(e) => endGesture(e, false)}
        style={{ touchAction: 'pan-y' }}
        className={[
          'relative z-10 flex w-full select-none items-center gap-2 border-l-4',
          inLedger
            ? 'border-l-emerald-500 bg-emerald-100/60 dark:border-l-emerald-500 dark:bg-emerald-950/40'
            : 'border-l-transparent bg-ink-50 dark:bg-ink-950',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={handleClick}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 text-left active:bg-ink-100/60 dark:active:bg-ink-800/60"
        >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{org.name}</span>
            {org.is_daf_sponsor && (
              <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                DAF
              </span>
            )}
          </div>
          <div className="truncate text-xs text-ink-500 dark:text-ink-400">
            {[org.city, org.state].filter(Boolean).join(', ')}
            {org.ntee_major ? ` · ${nteeMajorLabel(org.ntee_major)}` : ''} · EIN {org.ein}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums">
            {org.revenue != null ? compactMoney(org.revenue) : '—'}
          </div>
          {inLedger ? (
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
              ✓ In ledger
            </span>
          ) : tier ? (
            <div
              className={`whitespace-nowrap text-[11px] font-medium leading-tight ${tier.textClass}`}
              title={`Assets ÷ Revenue${tier.ratio != null ? ` = ${tier.detail}` : ' — assets only, no revenue reported'}`}
            >
              {tier.caption}
            </div>
          ) : null}
        </div>
      </button>
      <a
        href={googleUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`Search Google for "${org.name}"`}
        aria-label={`Search Google for ${org.name}`}
        className="shrink-0 rounded-lg bg-ink-100 px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700"
      >
        Google&nbsp;↗
      </a>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Filter panel
// -----------------------------------------------------------------------------

function FilterPanel({
  filters,
  setFilters,
  applyPreset,
  resetFilters,
  activeCount,
}: {
  filters: SearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
  applyPreset: (p: Preset) => void;
  resetFilters: () => void;
  activeCount: number;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const toggleIn = (key: 'states' | 'ntee_majors' | 'subsections' | 'statuses', v: string) =>
    setFilters((f) => {
      const has = f[key].includes(v);
      return { ...f, [key]: has ? f[key].filter((x) => x !== v) : [...f[key], v] };
    });

  return (
    <div className="mx-auto mt-2 max-w-3xl space-y-3 rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
      {/* Presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <Chip key={p.key} active={false} onClick={() => applyPreset(p)}>
            {p.label}
          </Chip>
        ))}
      </div>

      {/* Org type */}
      <Field label="Type">
        <Segmented
          options={ORG_TYPES}
          value={filters.org_type}
          onChange={(v) => setFilters((f) => ({ ...f, org_type: v as OrgType }))}
        />
      </Field>

      {/* Min revenue */}
      <Field label="Min revenue">
        <Segmented
          options={REVENUE_TIERS.map((t) => ({ label: t.label, value: String(t.value) }))}
          value={String(filters.min_revenue)}
          onChange={(v) => setFilters((f) => ({ ...f, min_revenue: Number(v) }))}
        />
      </Field>

      {/* DAF only */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={filters.daf_only}
          onChange={(e) => setFilters((f) => ({ ...f, daf_only: e.target.checked }))}
        />
        DAF sponsors only
      </label>

      {/* State */}
      <Field label="State">
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {US_STATES.map((s) => (
            <Chip key={s} active={filters.states.includes(s)} onClick={() => toggleIn('states', s)}>
              {s}
            </Chip>
          ))}
        </div>
      </Field>

      {/* NTEE category */}
      <Field label="Category (NTEE)">
        <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          {Object.keys(NTEE_MAJOR_LABELS).map((m) => (
            <Chip
              key={m}
              active={filters.ntee_majors.includes(m)}
              onClick={() => toggleIn('ntee_majors', m)}
              title={NTEE_MAJOR_LABELS[m]}
            >
              {m}
            </Chip>
          ))}
        </div>
      </Field>

      {/* Advanced */}
      <button
        type="button"
        className="text-xs text-ink-500 dark:text-ink-400"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? '− Advanced' : '+ Advanced (subsection, status)'}
      </button>
      {showAdvanced && (
        <div className="space-y-3">
          <Field label="501(c) subsection">
            <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
              {Object.keys(SUBSECTION_LABELS).map((s) => (
                <Chip key={s} active={filters.subsections.includes(s)} onClick={() => toggleIn('subsections', s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Status">
            <div className="flex flex-wrap gap-1">
              {Object.keys(STATUS_LABELS).map((s) => (
                <Chip key={s} active={filters.statuses.includes(s)} onClick={() => toggleIn('statuses', s)} title={STATUS_LABELS[s]}>
                  {s}
                </Chip>
              ))}
            </div>
          </Field>
        </div>
      )}

      {activeCount > 0 && (
        <button type="button" className="text-xs font-medium text-accent" onClick={resetFilters}>
          Clear all filters
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-500 dark:text-ink-400">{label}</div>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'rounded-full px-2.5 py-1 text-xs',
        active
          ? 'bg-accent text-white'
          : 'bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={[
            'rounded-lg px-2.5 py-1 text-xs',
            value === o.value
              ? 'bg-accent text-white'
              : 'bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
