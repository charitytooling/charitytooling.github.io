-- CharityTooling - Search/Metrics query layer over the BMF + DAF reference tables.
--
-- search_bmf(): one round-trip returning a keyset page of orgs + the 6 stat-card
-- aggregates over the full filtered set. Filters mirror daftooling's /charities/
-- runQuery() exactly. daf_metrics: per-sponsor-year metrics view reproducing
-- /metrics/ computeMetrics(). The Metrics page fetches the whole view (~9.5k rows)
-- and aggregates client-side, so no separate stats RPC is needed.

-- daf_orgs carries the per-EIN display/filter attributes the metrics page needs
-- for the ~23 sponsors not present in bmf_orgs (98.6% match).
alter table public.daf_orgs
  add column if not exists name       text,
  add column if not exists state      text,
  add column if not exists ntee_major text;

-- =============================================================================
-- search_bmf
-- =============================================================================
create or replace function public.search_bmf(
  _states        text[]  default null,
  _ntee_majors   text[]  default null,
  _ntee_prefixes text[]  default null,
  _subsections   text[]  default array['03'],
  _statuses      text[]  default array['01'],
  _foundations   text[]  default null,
  _min_revenue   bigint  default 0,
  _org_type      text    default null,
  _daf_only      boolean default false,
  _q             text    default null,
  _sort_key      text    default 'revenue',
  _sort_dir      text    default 'desc',
  _limit         int     default 50,
  _after_sortval text    default null,
  _after_ein     text    default null
)
returns table (total bigint, stats jsonb, rows jsonb)
language plpgsql
stable
security invoker
set search_path = public
as $func$
declare
  _order   text := case when lower(coalesce(_sort_dir,'desc')) = 'asc' then 'asc' else 'desc' end;
  _cmp     text := case when lower(coalesce(_sort_dir,'desc')) = 'asc' then '>' else '<' end;
  _is_num  boolean := _sort_key in ('revenue','assets');
  _sortexpr text;
  _keyset  text;
  _orderby text;
  _sql     text;
begin
  perform set_config('statement_timeout', '25000', true);

  _sortexpr := case _sort_key
    when 'assets' then 'coalesce(assets,0)'
    when 'name'   then 'name'
    when 'ein'    then 'ein'
    when 'ruling' then $q$coalesce(ruling,'')$q$
    else 'coalesce(revenue,0)'
  end;
  _orderby := _sortexpr || ' ' || _order || ', ein ' || _order;

  -- Keyset cursor. Every branch references $12 and $13 so the EXECUTE USING
  -- parameter count always matches (13 placeholders).
  if _after_ein is null then
    _keyset := '($12 is null or $13 is null or true)';
  elsif _sort_key = 'ein' then
    _keyset := '(ein ' || _cmp || ' $13 and ($12 is null or $12 is not null))';
  elsif _is_num then
    _keyset := '((' || _sortexpr || ', ein) ' || _cmp || ' ($12::bigint, $13))';
  else
    _keyset := '((' || _sortexpr || ', ein) ' || _cmp || ' ($12, $13))';
  end if;

  _sql :=
    $q$
    with f as (
      select ein, name, city, state, zip, subsection, foundation_code, status,
             ntee, ntee_major, ruling, revenue, assets, income, street, in_care_of,
             deductibility, tax_period, is_daf_sponsor, org_type
      from public.bmf_orgs
      where ($1 is null or cardinality($1) = 0 or state = any($1))
        and ($2 is null or cardinality($2) = 0 or ntee_major = any($2))
        and ($4 is null or cardinality($4) = 0 or subsection = any($4))
        and ($5 is null or cardinality($5) = 0 or status = any($5))
        and ($6 is null or cardinality($6) = 0 or foundation_code = any($6))
        and (coalesce($7,0) = 0 or coalesce(revenue,0) >= $7)
        and ($8 is null or org_type = $8)
        and ($9 is not true or is_daf_sponsor)
        and ($3 is null or cardinality($3) = 0
             or ntee like any (select p || '%' from unnest($3) p))
        and ($10 is null or $10 = '' or search_text like '%' || lower($10) || '%')
    ),
    s as (
      select count(*)::bigint as total,
             coalesce(sum(revenue),0)::bigint as total_revenue,
             coalesce(sum(assets),0)::bigint as total_assets,
             count(*) filter (where org_type = 'public_charity')::bigint as public_charities,
             count(*) filter (where org_type = 'private_foundation')::bigint as private_foundations,
             count(*) filter (where is_daf_sponsor)::bigint as daf_sponsor_count
      from f
    ),
    p as (
      select * from f
      where $q$ || _keyset || $q$
      order by $q$ || _orderby || $q$
      limit $11
    )
    select
      s.total,
      jsonb_build_object(
        'count', s.total,
        'total_revenue', s.total_revenue,
        'total_assets', s.total_assets,
        'public_charities', s.public_charities,
        'private_foundations', s.private_foundations,
        'daf_sponsor_count', s.daf_sponsor_count
      ),
      coalesce((select jsonb_agg(to_jsonb(p) order by $q$ || _orderby || $q$) from p), '[]'::jsonb)
    from s;
    $q$;

  return query execute _sql
    using _states, _ntee_majors, _ntee_prefixes, _subsections, _statuses,
          _foundations, _min_revenue, _org_type, _daf_only, _q,
          _limit, _after_sortval, _after_ein;
end;
$func$;

revoke execute on function public.search_bmf(
  text[],text[],text[],text[],text[],text[],bigint,text,boolean,text,text,text,int,text,text
) from public;
grant execute on function public.search_bmf(
  text[],text[],text[],text[],text[],text[],bigint,text,boolean,text,text,text,int,text,text
) to authenticated;

-- =============================================================================
-- daf_metrics  (per-sponsor-year; reproduces /metrics/ computeMetrics)
-- =============================================================================
create or replace view public.daf_metrics
with (security_invoker = true) as
with prior as (
  select h.*,
    (select p.assets
       from public.daf_history p
      where p.ein = h.ein and p.year in (h.year-1, h.year-2, h.year-3)
      order by p.year desc
      limit 1) as prior_assets,
    row_number() over (partition by h.ein order by h.year desc) as rn
  from public.daf_history h
)
select
  pr.ein, pr.year, o.type, o.subtype, o.name, o.state, o.ntee_major,
  pr.fiscal_year_end, pr.end_of_tax_period, pr.operating_status, pr.vetted_status,
  pr.accounts, pr.contributions, pr.grants,
  pr.assets as eoy_assets, pr.prior_assets,
  (pr.rn = 1) as is_latest,
  case
    when pr.grants is not null and pr.prior_assets is not null and pr.assets is not null
         and (pr.prior_assets + pr.assets) > 0
      then round((100 * pr.grants / ((pr.prior_assets + pr.assets) / 2.0))::numeric, 4)
    when pr.grants is not null and pr.assets is not null and pr.assets > 0
      then round((100 * pr.grants / pr.assets)::numeric, 4)
    else null
  end as payout_pct,
  (pr.grants is not null and pr.prior_assets is null
   and pr.assets is not null and pr.assets > 0) as payout_approx,
  case when pr.grants is not null and pr.accounts is not null and pr.accounts > 0
       then pr.grants / pr.accounts end as avg_grant,
  case when pr.contributions is not null or pr.grants is not null
       then coalesce(pr.contributions,0) - coalesce(pr.grants,0) end as net_flow,
  case when pr.assets is not null and pr.assets > 0
            and (pr.contributions is not null or pr.grants is not null)
       then round(((coalesce(pr.contributions,0) + coalesce(pr.grants,0)) / pr.assets)::numeric, 4)
       end as velocity
from prior pr
left join public.daf_orgs o using (ein);

revoke all on public.daf_metrics from anon;
grant select on public.daf_metrics to authenticated;
