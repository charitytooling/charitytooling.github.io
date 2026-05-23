-- Soft-delete (archive) support for customers.
--
-- Any charity member may set archived_at to hide a customer from default
-- ledger / queue / update views. Only super admins may hard-delete a row.
-- Restore is a normal update (archived_at = null) and stays available to
-- any member.

alter table public.customers
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id);

-- Fast path for the common "active customers" list and sort.
create index if not exists customers_charity_active_idx
  on public.customers (charity_id, updated_at desc)
  where archived_at is null;

-- Split the existing combined "members rw customers" policy: keep
-- read/insert/update for members, restrict delete to super admin only.
drop policy if exists "members rw customers" on public.customers;

create policy "members read customers"
  on public.customers for select
  using (private.is_member_of(charity_id));

create policy "members insert customers"
  on public.customers for insert
  with check (private.is_member_of(charity_id));

create policy "members update customers"
  on public.customers for update
  using (private.is_member_of(charity_id))
  with check (private.is_member_of(charity_id));

create policy "super admin deletes customers"
  on public.customers for delete
  using (private.is_super_admin());
