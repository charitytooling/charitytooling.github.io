-- Public filing fields populated from IRS Form 990 (typically via the
-- daftooling.com import flow). Whole US dollars; no CHECK constraints since
-- net income can be negative on real returns.

alter table public.customers
  add column if not exists filing_revenue    bigint,
  add column if not exists filing_income     bigint,
  add column if not exists filing_assets     bigint,
  add column if not exists filing_tax_period text;
