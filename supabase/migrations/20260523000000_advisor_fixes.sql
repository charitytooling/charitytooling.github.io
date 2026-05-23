-- Database advisor fixes.
--
-- 1) Pin `search_path` on two helpers that the linter flagged as having a
--    mutable search_path.
-- 2) Explicitly revoke `execute` on `public.allocate_receipt_number` from
--    the `anon` role (we already revoked from `public`; this makes the
--    advisor warning stop).
-- 3) Rewrite per-row RLS policies on user-scoped tables to use
--    `(select auth.uid())` instead of `auth.uid()` so Postgres can hoist
--    the call out of the row-by-row plan (auth_rls_initplan advisor).

create or replace function private.compute_completeness(c public.customers)
returns smallint
language sql
immutable
set search_path = pg_temp
as $$
  select (
    (case when c.first_name      is not null and length(trim(c.first_name))      > 0 then 1 else 0 end) +
    (case when c.last_name       is not null and length(trim(c.last_name))       > 0 then 1 else 0 end) +
    (case when c.email           is not null and length(trim(c.email))           > 0 then 1 else 0 end) +
    (case when c.phone           is not null and length(trim(c.phone))           > 0 then 1 else 0 end) +
    (case when c.website         is not null and length(trim(c.website))         > 0 then 1 else 0 end) +
    (case when c.address_line1   is not null and length(trim(c.address_line1))   > 0 then 1 else 0 end) +
    (case when c.city            is not null and length(trim(c.city))            > 0 then 1 else 0 end) +
    (case when c.state           is not null and length(trim(c.state))           > 0 then 1 else 0 end) +
    (case when c.postal_code     is not null and length(trim(c.postal_code))     > 0 then 1 else 0 end) +
    (case when c.preferred_contact_method is not null                                 then 1 else 0 end)
  )::smallint * 10;
$$;

create or replace function private.stamp_donation_edit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.edited_at := now();
  new.edited_by := auth.uid();
  return new;
end $$;

revoke execute on function public.allocate_receipt_number(uuid) from anon;

drop policy if exists "read own profile or super admin" on public.profiles;
create policy "read own profile or super admin"
  on public.profiles for select
  using ((select auth.uid()) = id or private.is_super_admin());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions"
  on public.push_subscriptions for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own notification preferences" on public.notification_preferences;
create policy "own notification preferences"
  on public.notification_preferences for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
