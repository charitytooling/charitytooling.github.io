import { compactMoney } from '@/lib/format';
import type { DafMetricRow } from '@/state/orgs';

export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);
export const fmtRatio = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
export const fmtMoney = (v: number | null | undefined) => (v == null ? '—' : compactMoney(v));
export const fmtInt = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString());

// Color bands lifted from daftooling's metrics page (payoutClass etc.).
export function payoutClass(v: number | null | undefined): string {
  if (v == null) return 'text-ink-400 dark:text-ink-500';
  if (v < 5) return 'text-red-600 dark:text-red-400';
  if (v < 10) return 'text-amber-600 dark:text-amber-400';
  if (v < 20) return '';
  return 'text-emerald-600 dark:text-emerald-400';
}
export function avgGrantClass(v: number | null | undefined): string {
  if (v == null) return 'text-ink-400 dark:text-ink-500';
  if (v < 1000) return 'text-red-600 dark:text-red-400';
  if (v < 5000) return 'text-amber-600 dark:text-amber-400';
  if (v < 25000) return '';
  return 'text-emerald-600 dark:text-emerald-400';
}
export function velocityClass(v: number | null | undefined): string {
  if (v == null) return 'text-ink-400 dark:text-ink-500';
  if (v < 0.1) return 'text-red-600 dark:text-red-400';
  if (v < 0.2) return 'text-amber-600 dark:text-amber-400';
  if (v < 0.6) return '';
  return 'text-emerald-600 dark:text-emerald-400';
}
export function netFlowClass(v: number | null | undefined): string {
  if (v == null || Math.abs(v) < 1e5) return 'text-ink-400 dark:text-ink-500';
  return v > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-sky-600 dark:text-sky-400';
}

export const ASSET_TIERS = [
  { id: 't0', label: '< $10M', min: 0, max: 1e7 },
  { id: 't1', label: '$10M–$100M', min: 1e7, max: 1e8 },
  { id: 't2', label: '$100M–$1B', min: 1e8, max: 1e9 },
  { id: 't3', label: '$1B+', min: 1e9, max: Infinity },
];

export type MetricFilters = {
  q: string;
  latestOnly: boolean;
  types: string[];
  states: string[];
  nteeMajors: string[];
  assetTiers: string[];
};

export const DEFAULT_METRIC_FILTERS: MetricFilters = {
  q: '',
  latestOnly: true,
  types: [],
  states: [],
  nteeMajors: [],
  assetTiers: [],
};

export function applyMetricFilters(rows: DafMetricRow[], f: MetricFilters): DafMetricRow[] {
  const q = f.q.trim().toLowerCase();
  const tiers = ASSET_TIERS.filter((t) => f.assetTiers.includes(t.id));
  return rows.filter((r) => {
    if (f.latestOnly && !r.is_latest) return false;
    if (f.types.length && (!r.type || !f.types.includes(r.type))) return false;
    if (f.states.length && (!r.state || !f.states.includes(r.state))) return false;
    if (f.nteeMajors.length && (!r.ntee_major || !f.nteeMajors.includes(r.ntee_major))) return false;
    if (tiers.length) {
      const a = r.eoy_assets ?? 0;
      if (!tiers.some((t) => a >= t.min && a < t.max)) return false;
    }
    if (q && !`${r.name ?? ''} ${r.ein}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export type MetricStats = {
  sponsors: number;
  totalAssets: number;
  weightedPayout: number | null;
  weightedAvgGrant: number | null;
  totalNetFlow: number;
  weightedVelocity: number | null;
};

// Asset-weighted aggregates: sum numerators / sum denominators, matching the
// metrics page's renderStats (missing prior assets fall back to EOY).
export function computeMetricStats(rows: DafMetricRow[]): MetricStats {
  let sumGrantsP = 0;
  let sumAvgA = 0;
  let sumGrantsAG = 0;
  let sumAccts = 0;
  let totalNetFlow = 0;
  let totalAssets = 0;
  let sumThroughput = 0;
  let sumAssetsVel = 0;
  const eins = new Set<string>();

  for (const r of rows) {
    eins.add(r.ein);
    if (r.eoy_assets != null) totalAssets += r.eoy_assets;
    if (r.net_flow != null) totalNetFlow += r.net_flow;
    if (r.grants != null && r.eoy_assets != null) {
      const prior = r.prior_assets ?? r.eoy_assets;
      sumGrantsP += r.grants;
      sumAvgA += (prior + r.eoy_assets) / 2;
    }
    if (r.grants != null && r.accounts != null && r.accounts > 0) {
      sumGrantsAG += r.grants;
      sumAccts += r.accounts;
    }
    if (r.eoy_assets != null && r.eoy_assets > 0 && (r.contributions != null || r.grants != null)) {
      sumThroughput += (r.contributions ?? 0) + (r.grants ?? 0);
      sumAssetsVel += r.eoy_assets;
    }
  }

  return {
    sponsors: eins.size,
    totalAssets,
    weightedPayout: sumAvgA > 0 ? (100 * sumGrantsP) / sumAvgA : null,
    weightedAvgGrant: sumAccts > 0 ? sumGrantsAG / sumAccts : null,
    totalNetFlow,
    weightedVelocity: sumAssetsVel > 0 ? sumThroughput / sumAssetsVel : null,
  };
}
