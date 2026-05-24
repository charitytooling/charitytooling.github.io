// Shared currency formatters. Both views below use US dollars and whole-dollar
// units; if a non-USD currency is ever needed, take an optional `currency`
// arg here rather than re-instantiating Intl.NumberFormat at the call sites.

const MONEY_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const MONEY_COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

/** Whole-dollar with thousands separators and a leading `$`, e.g. `$93,250,000,000`. */
export function formatWholeUSD(value: number): string {
  return MONEY_FMT.format(value);
}

/** Compact with a lowercase suffix, e.g. `$93.3b`, `$4.5m`, `$1.2k`. */
export function compactMoney(value: number): string {
  return MONEY_COMPACT.format(value).replace(/[KMBT]$/, (s) => s.toLowerCase());
}
