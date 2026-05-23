-- IRS EIN for customers imported from daftooling.com (or entered manually).
-- Optional; existing rows stay null. The partial unique index makes EIN unique
-- within a charity only when present, so it doubles as the dedup key for the
-- /ledger/import-daf flow without preventing multiple unidentified customers.

alter table public.customers
  add column if not exists ein text;

create unique index if not exists customers_charity_ein_uniq
  on public.customers (charity_id, ein)
  where ein is not null;

create index if not exists customers_ein_idx
  on public.customers (ein)
  where ein is not null;
