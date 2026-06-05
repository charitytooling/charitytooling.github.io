import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';
import type { SearchFilters } from '@/lib/bmfLookups';
import {
  orgToCustomerInsert,
  upsertCustomerWithContact,
  type ContactDraft,
  type LedgerOrgInput,
} from '@/lib/customerHelpers';

export type BmfOrg = Database['public']['Tables']['bmf_orgs']['Row'];
export type DafMetricRow = Database['public']['Views']['daf_metrics']['Row'];

export type BmfStats = {
  count: number;
  total_revenue: number;
  total_assets: number;
  public_charities: number;
  private_foundations: number;
  daf_sponsor_count: number;
};

export type SortKey = 'revenue' | 'assets' | 'name' | 'ein' | 'ruling';
export type SortState = { key: SortKey; dir: 'asc' | 'desc' };

const PAGE_SIZE = 50;

// The keyset cursor value for a row, matching search_bmf's sort expression:
// numeric sorts coalesce null -> 0; string sorts use '' for null.
function cursorVal(row: BmfOrg, key: SortKey): string {
  switch (key) {
    case 'assets':
      return String(row.assets ?? 0);
    case 'name':
      return row.name ?? '';
    case 'ein':
      return row.ein;
    case 'ruling':
      return row.ruling ?? '';
    case 'revenue':
    default:
      return String(row.revenue ?? 0);
  }
}

type SearchPage = { total: number; stats: BmfStats; rows: BmfOrg[] };
type Cursor = { sortval: string; ein: string } | null;

// Infinite, keyset-paginated search over bmf_orgs. Each page also returns the
// 6 stat-card aggregates over the full filtered set (identical across pages).
export function useOrgSearch(filters: SearchFilters, sort: SortState) {
  return useInfiniteQuery<SearchPage, Error, { pages: SearchPage[] }, unknown[], Cursor>({
    queryKey: ['bmf_search', filters, sort],
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('search_bmf', {
        _states: filters.states,
        _ntee_majors: filters.ntee_majors,
        _ntee_prefixes: filters.ntee_prefixes,
        _subsections: filters.subsections,
        _statuses: filters.statuses,
        _foundations: filters.foundations,
        _min_revenue: filters.min_revenue,
        _org_type: filters.org_type || null,
        _daf_only: filters.daf_only,
        _q: filters.q || null,
        _sort_key: sort.key,
        _sort_dir: sort.dir,
        _limit: PAGE_SIZE,
        _after_sortval: pageParam?.sortval ?? null,
        _after_ein: pageParam?.ein ?? null,
      });
      if (error) throw error;
      const row = (data as SearchPage[] | null)?.[0];
      return {
        total: row?.total ?? 0,
        stats: (row?.stats as BmfStats) ?? EMPTY_STATS,
        rows: ((row?.rows as BmfOrg[]) ?? []),
      };
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.rows.length < PAGE_SIZE) return undefined;
      const last = lastPage.rows[lastPage.rows.length - 1];
      return { sortval: cursorVal(last, sort.key), ein: last.ein };
    },
    staleTime: 60_000,
  });
}

const EMPTY_STATS: BmfStats = {
  count: 0,
  total_revenue: 0,
  total_assets: 0,
  public_charities: 0,
  private_foundations: 0,
  daf_sponsor_count: 0,
};

// PostgREST may serialize Postgres `numeric` columns as strings; coerce the
// metric fields back to numbers so the charts/aggregates can do arithmetic.
const num = (v: unknown): number | null =>
  v == null ? null : typeof v === 'number' ? v : Number(v);

function coerceMetric(r: DafMetricRow): DafMetricRow {
  return {
    ...r,
    contributions: num(r.contributions),
    grants: num(r.grants),
    eoy_assets: num(r.eoy_assets),
    prior_assets: num(r.prior_assets),
    payout_pct: num(r.payout_pct),
    avg_grant: num(r.avg_grant),
    net_flow: num(r.net_flow),
    velocity: num(r.velocity),
  };
}

// The DAF metrics dataset is small (~8.7k rows); fetch it whole and let the
// Metrics page filter/aggregate client-side, mirroring the static dashboard.
export function useDafMetrics() {
  return useQuery({
    queryKey: ['daf_metrics'],
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<DafMetricRow[]> => {
      const all: DafMetricRow[] = [];
      const CHUNK = 1000;
      for (let from = 0; ; from += CHUNK) {
        const { data, error } = await supabase
          .from('daf_metrics')
          .select('*')
          .order('ein', { ascending: true })
          .order('year', { ascending: true })
          .range(from, from + CHUNK - 1);
        if (error) throw error;
        const batch = (data ?? []) as DafMetricRow[];
        all.push(...batch.map(coerceMetric));
        if (batch.length < CHUNK) break;
      }
      return all;
    },
  });
}

// Which of the given EINs already exist as customers for the active charity.
export function useOrgsInLedger(charityId: string | null, eins: string[]) {
  const key = [...new Set(eins)].sort().join(',');
  return useQuery({
    queryKey: ['orgs_in_ledger', charityId, key],
    enabled: !!charityId && eins.length > 0,
    queryFn: async (): Promise<Set<string>> => {
      const present = new Set<string>();
      const unique = [...new Set(eins)];
      const CHUNK = 200;
      for (let i = 0; i < unique.length; i += CHUNK) {
        const chunk = unique.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from('customers')
          .select('ein')
          .eq('charity_id', charityId!)
          .in('ein', chunk);
        if (error) throw error;
        for (const r of data ?? []) if (r.ein) present.add(r.ein);
      }
      return present;
    },
  });
}

// All EINs already in the active charity's ledger, fetched once (a charity's
// customer count is small). Drives the "In ledger ✓" badges across Search.
export function useLedgerEinSet(charityId: string | null) {
  return useQuery({
    queryKey: ['ledger_ein_set', charityId],
    enabled: !!charityId,
    staleTime: 30_000,
    queryFn: async (): Promise<Set<string>> => {
      const present = new Set<string>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('customers')
          .select('ein')
          .eq('charity_id', charityId!)
          .not('ein', 'is', null)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = data ?? [];
        for (const r of batch) if (r.ein) present.add(r.ein);
        if (batch.length < PAGE) break;
      }
      return present;
    },
  });
}

// Add (or refresh) an org in the active charity's ledger from a Search result.
export function useAddOrgToLedger(charityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { org: LedgerOrgInput; contact?: ContactDraft }) => {
      if (!charityId) throw new Error('No active charity selected.');
      return upsertCustomerWithContact(
        charityId,
        orgToCustomerInsert(input.org, charityId),
        input.contact,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === 'customers' ||
          q.queryKey[0] === 'orgs_in_ledger' ||
          q.queryKey[0] === 'ledger_ein_set',
      });
    },
  });
}

// Map a search-result org row onto the add-to-ledger input shape.
export function bmfOrgToLedgerInput(o: BmfOrg): LedgerOrgInput {
  return {
    ein: o.ein,
    name: o.name,
    street: o.street,
    city: o.city,
    state: o.state,
    zip: o.zip,
    revenue: o.revenue,
    income: o.income,
    assets: o.assets,
    tax_period: o.tax_period,
  };
}
