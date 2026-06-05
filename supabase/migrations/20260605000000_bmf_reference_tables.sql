-- CharityTooling - IRS BMF + DAF reference tables for the in-app Search feature.
--
-- Unlike every other domain table, these three carry NO charity_id: they are
-- global, PUBLIC IRS reference data (the same ~697k rows for every charity).
-- Access is therefore plain authenticated-read RLS, NOT private.is_member_of().
-- Only the service-role ETL (scripts/load-bmf.mjs) writes to them.
--
-- No FK from daf_* to bmf_orgs: only ~98.6% of DAF sponsors (1,571 of 1,594)
-- appear in the BMF extract, so a FK would reject the ~23 unmatched sponsors.
-- The daf_metrics view left-joins bmf_orgs to tolerate the gap.

-- =============================================================================
-- Extensions
-- =============================================================================

create extension if not exists pg_trgm;

-- =============================================================================
-- bmf_orgs  (~697k rows; IRS Exempt Organizations Business Master File extract)
-- =============================================================================

create table public.bmf_orgs (
  ein             text primary key,
  name            text not null,
  city            text,
  state           text,
  zip             text,
  subsection      text,            -- 501(c) subsection, e.g. '03'
  foundation_code text,            -- '02'/'03'/'04' => private foundation
  status          text,            -- e.g. '01' (active)
  ntee            text,            -- full NTEE code, e.g. 'P40'
  ntee_major      text,            -- NTEE major letter, e.g. 'P'
  ruling          text,            -- IRS ruling date 'YYYYMM'
  revenue         bigint,          -- frequently null in the source
  assets          bigint,
  income          bigint,
  street          text,
  in_care_of      text,
  deductibility   text,
  tax_period      text,            -- 'YYYYMM'
  is_daf_sponsor  boolean not null default false,
  -- STORED generated columns: indexable, and keep the org_type stat counts cheap.
  -- Mirrors daftooling exactly: a null foundation_code counts as public charity.
  org_type text generated always as (
    case
      when subsection = '03'
       and (foundation_code is null or foundation_code not in ('02','03','04'))
        then 'public_charity'
      when subsection = '03'
       and foundation_code in ('02','03','04')
        then 'private_foundation'
      else null
    end
  ) stored,
  search_text text generated always as (
    lower(coalesce(name,'') || ' ' || coalesce(city,'') || ' ' || coalesce(ein,''))
  ) stored
);
alter table public.bmf_orgs enable row level security;

-- Free-text substring search over name + city + ein (the static page's needle match).
create index bmf_search_trgm on public.bmf_orgs using gin (search_text gin_trgm_ops);
-- Keyset sort indexes: numeric sorts treat null as 0; ein is the unique tiebreak.
create index bmf_rev_keyset    on public.bmf_orgs (coalesce(revenue,0) desc, ein desc);
create index bmf_assets_keyset on public.bmf_orgs (coalesce(assets,0)  desc, ein desc);
create index bmf_name_ein on public.bmf_orgs (name, ein);
create index bmf_ruling   on public.bmf_orgs (ruling, name);
-- Facet / equality filters (state is the one selective facet).
create index bmf_state            on public.bmf_orgs (state);
create index bmf_state_ntee_major on public.bmf_orgs (state, ntee_major);
create index bmf_ntee_pattern     on public.bmf_orgs (ntee text_pattern_ops); -- LIKE 'P60%'
create index bmf_subsection on public.bmf_orgs (subsection);
create index bmf_status     on public.bmf_orgs (status);
create index bmf_daf_only
  on public.bmf_orgs (coalesce(revenue,0) desc, ein desc)
  where is_daf_sponsor;

-- =============================================================================
-- daf_orgs  (~1.6k DAF sponsors; type/subtype metadata)
-- =============================================================================

create table public.daf_orgs (
  ein     text primary key,        -- no FK: see header note (98.6% BMF match)
  type    text,
  subtype text
);
alter table public.daf_orgs enable row level security;

-- =============================================================================
-- daf_history  (~9.5k sponsor-year rows; NPT 2025 DAF report figures)
-- =============================================================================

create table public.daf_history (
  ein               text not null, -- no FK: see header note
  year              smallint not null,
  fiscal_year_end   smallint,
  end_of_tax_period date,
  operating_status  text,
  vetted_status     text,
  accounts          integer,
  contributions     numeric,
  grants            numeric,
  assets            numeric,        -- end-of-year DAF assets
  primary key (ein, year)
);
alter table public.daf_history enable row level security;
create index daf_history_ein_year on public.daf_history (ein, year);

-- =============================================================================
-- RLS: global authenticated-read. No write policies => only the service_role
-- key (which bypasses RLS) can load/refresh these tables.
-- =============================================================================

create policy "bmf read for signed-in"
  on public.bmf_orgs for select to authenticated using (true);
create policy "daf_orgs read for signed-in"
  on public.daf_orgs for select to authenticated using (true);
create policy "daf_history read for signed-in"
  on public.daf_history for select to authenticated using (true);
