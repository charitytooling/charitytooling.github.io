// Static IRS BMF code -> label maps, lifted from daftooling's bootstrap.json
// lookups. Small and effectively constant, so they ship in the bundle rather
// than living in the database. Used by the Search filters and detail modal.

export const NTEE_MAJOR_LABELS: Record<string, string> = {
  A: 'Arts, Culture & Humanities',
  B: 'Education',
  C: 'Environment',
  D: 'Animal-Related',
  E: 'Health Care',
  F: 'Mental Health & Crisis Intervention',
  G: 'Diseases, Disorders & Medical Disciplines',
  H: 'Medical Research',
  I: 'Crime & Legal-Related',
  J: 'Employment',
  K: 'Food, Agriculture & Nutrition',
  L: 'Housing & Shelter',
  M: 'Public Safety, Disaster Preparedness & Relief',
  N: 'Recreation & Sports',
  O: 'Youth Development',
  P: 'Human Services',
  Q: 'International, Foreign Affairs & National Security',
  R: 'Civil Rights, Social Action & Advocacy',
  S: 'Community Improvement & Capacity Building',
  T: 'Philanthropy, Voluntarism & Grantmaking Foundations',
  U: 'Science & Technology',
  V: 'Social Science',
  W: 'Public & Societal Benefit',
  X: 'Religion-Related',
  Y: 'Mutual & Membership Benefit',
  Z: 'Unknown',
};

export const SUBSECTION_LABELS: Record<string, string> = {
  '02': '501(c)(2) Title-Holding Corp',
  '03': '501(c)(3) Charitable',
  '04': '501(c)(4) Social Welfare',
  '05': '501(c)(5) Labor / Agricultural',
  '06': '501(c)(6) Business League',
  '07': '501(c)(7) Social Club',
  '08': '501(c)(8) Fraternal Beneficiary',
  '09': '501(c)(9) VEBA',
  '10': '501(c)(10) Domestic Fraternal',
  '11': '501(c)(11) Teachers Retirement',
  '12': '501(c)(12) Benevolent Life',
  '13': '501(c)(13) Cemetery Company',
  '14': '501(c)(14) State-Chartered Credit Union',
  '15': '501(c)(15) Mutual Insurance',
  '16': '501(c)(16) Cooperative',
  '17': '501(c)(17) Supp. Unemployment Trust',
  '18': '501(c)(18) Employee Pension Trust',
  '19': '501(c)(19) Veterans Org',
  '20': '501(c)(20) Group Legal Services',
  '21': '501(c)(21) Black Lung Trust',
  '22': '501(c)(22) Multi-Employer Pension',
  '23': '501(c)(23) Pre-1880 Veterans Assoc',
  '24': '501(c)(24) ERISA Trust',
  '25': '501(c)(25) Real Property Title-Holding',
  '26': '501(c)(26) High-Risk Health Coverage',
  '27': '501(c)(27) State Workers Comp',
  '28': '501(c)(28) Natl Railroad Retirement',
  '40': 'Religious & Apostolic Assoc',
  '50': 'Cooperative Hospital Service',
  '60': 'Cooperative Service Org',
  '70': 'Child Care Org',
  '71': 'Charitable Risk Pool',
  '81': 'State-Sponsored Tuition Program',
  '92': '4947(a)(2) Trust',
};

export const FOUNDATION_LABELS: Record<string, string> = {
  '00': 'Not 501(c)(3)',
  '02': 'Private operating foundation (excise tax exempt)',
  '03': 'Private operating foundation',
  '04': 'Private non-operating foundation',
  '09': 'Suspense',
  '10': 'Church 170(b)(1)(A)(i)',
  '11': 'School 170(b)(1)(A)(ii)',
  '12': 'Hospital / medical research 170(b)(1)(A)(iii)',
  '13': 'Org supporting college 170(b)(1)(A)(iv)',
  '14': 'Governmental unit 170(b)(1)(A)(v)',
  '15': 'Publicly supported 170(b)(1)(A)(vi)',
  '16': 'Publicly supported 509(a)(2)',
  '17': 'Public safety testing 509(a)(4)',
  '18': 'Supporting org 509(a)(3)',
  '21': '509(a)(3) Type I',
  '22': '509(a)(3) Type II',
  '23': '509(a)(3) Type III - functionally integrated',
  '24': '509(a)(3) Type III - not functionally integrated',
};

export const STATUS_LABELS: Record<string, string> = {
  '01': 'Active (Unconditional Exemption)',
  '02': 'Active (Conditional Exemption)',
  '12': '4947(a)(2) Trust',
  '25': 'Terminated',
  '36': 'Subordinate',
  '70': 'Application Denied',
  '71': 'Application Withdrawn',
  '97': 'Revocation of Exemption',
  '99': 'Revoked',
};

export const US_STATES: string[] = [
  'AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL','IN',
  'KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ',
  'NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA','VT','WA',
  'WI','WV','WY',
];

export type OrgType = '' | 'public_charity' | 'private_foundation';

export const ORG_TYPES: { label: string; value: OrgType }[] = [
  { label: 'Any', value: '' },
  { label: 'Public charity', value: 'public_charity' },
  { label: 'Private foundation', value: 'private_foundation' },
];

export const REVENUE_TIERS: { label: string; value: number }[] = [
  { label: 'Any', value: 0 },
  { label: '$100K+', value: 100_000 },
  { label: '$1M+', value: 1_000_000 },
  { label: '$10M+', value: 10_000_000 },
  { label: '$100M+', value: 100_000_000 },
];

// Curated quick-filters, mirroring daftooling's PRESETS.
export type Preset = {
  key: string;
  label: string;
  ntee_majors?: string[];
  ntee_prefixes?: string[];
  org_type?: OrgType;
  min_revenue?: number;
};

export const PRESETS: Preset[] = [
  { key: 'hs_all', label: 'All Human Services (P)', ntee_majors: ['P'] },
  { key: 'hs_food', label: 'Food security & basic needs', ntee_prefixes: ['P60', 'K30', 'K34', 'K36', 'L40', 'L41'] },
  { key: 'hs_family', label: 'Family services & youth', ntee_prefixes: ['P40', 'P42', 'P43', 'P44', 'O20', 'O30', 'O50'] },
  { key: 'hs_senior', label: 'Senior & disability services', ntee_prefixes: ['P81', 'P82', 'P85', 'P86', 'E70'] },
  { key: 'cf', label: 'Community foundations (T2)', ntee_prefixes: ['T2'] },
  { key: 'pf', label: 'Private foundations only', org_type: 'private_foundation' },
  { key: 'high_rev', label: 'Revenue $10M+', min_revenue: 10_000_000 },
];

// The filter state shared by the Search UI and the search_bmf RPC call.
export type SearchFilters = {
  q: string;
  states: string[];
  ntee_majors: string[];
  ntee_prefixes: string[];
  subsections: string[];
  statuses: string[];
  foundations: string[];
  min_revenue: number;
  org_type: OrgType;
  daf_only: boolean;
};

// Defaults match daftooling's runQuery: 501(c)(3) + active only.
export const DEFAULT_FILTERS: SearchFilters = {
  q: '',
  states: [],
  ntee_majors: [],
  ntee_prefixes: [],
  subsections: ['03'],
  statuses: ['01'],
  foundations: [],
  min_revenue: 0,
  org_type: '',
  daf_only: false,
};

export const subsectionLabel = (code: string | null | undefined): string =>
  (code && SUBSECTION_LABELS[code]) || code || '—';
export const foundationLabel = (code: string | null | undefined): string =>
  (code && FOUNDATION_LABELS[code]) || code || '—';
export const statusLabel = (code: string | null | undefined): string =>
  (code && STATUS_LABELS[code]) || code || '—';
export const nteeMajorLabel = (major: string | null | undefined): string =>
  (major && NTEE_MAJOR_LABELS[major]) || '';

// IRS ruling date is stored as 'YYYYMM'; show the year (daftooling's fmtRuling).
export const formatRuling = (v: string | null | undefined): string =>
  !v || v === '000000' || v.length < 4 ? '—' : v.slice(0, 4);

// -----------------------------------------------------------------------------
// Assets ÷ Revenue "financial character" — shown on Search rows + detail modal.
// Communicates whether an org is asset-heavy (grant-maker / endowed) or runs
// hand-to-mouth (operating). Deliberately avoids green (the in-ledger signal)
// and red (too alarming for a neutral metric).
// -----------------------------------------------------------------------------

export type RatioTier = {
  ratio: number | null; // assets / revenue; null when revenue is missing/zero
  caption: string; // compact row caption, e.g. "5.7× reserve-rich"
  detail: string; // modal value, e.g. "5.7× · reserve-rich"
  textClass: string; // tailwind text color
};

function fmtRatioX(r: number): string {
  if (r >= 100) return `${Math.round(r)}×`;
  if (r >= 10) return `${r.toFixed(0)}×`;
  return `${r.toFixed(1)}×`;
}

export function assetRevenueTier(
  revenue: number | null | undefined,
  assets: number | null | undefined,
): RatioTier | null {
  const a = typeof assets === 'number' && assets > 0 ? assets : 0;
  const r = typeof revenue === 'number' && revenue > 0 ? revenue : 0;
  if (a === 0 && r === 0) return null; // nothing reported

  if (a > 0 && r === 0) {
    return {
      ratio: null,
      caption: 'assets-only',
      detail: 'assets-only (no revenue)',
      textClass: 'text-slate-500 dark:text-slate-400',
    };
  }
  if (a === 0 && r > 0) {
    return { ratio: 0, caption: '0× lean', detail: '0× · lean', textClass: 'text-amber-600 dark:text-amber-400' };
  }

  const ratio = a / r;
  const x = fmtRatioX(ratio);
  let label: string;
  let textClass: string;
  if (ratio >= 5) {
    label = 'endowed';
    textClass = 'text-violet-600 dark:text-violet-400';
  } else if (ratio >= 1.5) {
    label = 'reserve-rich';
    textClass = 'text-sky-600 dark:text-sky-400';
  } else if (ratio >= 0.5) {
    label = 'balanced';
    textClass = 'text-ink-500 dark:text-ink-400';
  } else {
    label = 'lean';
    textClass = 'text-amber-600 dark:text-amber-400';
  }
  return { ratio, caption: `${x} ${label}`, detail: `${x} · ${label}`, textClass };
}
