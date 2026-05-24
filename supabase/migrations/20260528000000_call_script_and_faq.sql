-- Call script + FAQ for the contact page.
--
-- Adds two per-charity, member-editable shared resources surfaced from the
-- Contact card via dedicated "Call script" and "FAQ" modal buttons:
--
--   * call_script_items   - ordered checklist items (charity-wide).
--   * call_script_ticks   - per-customer completion state for those items.
--                           Shared across reps for the same donor so the
--                           whole team sees what's already been covered.
--   * faq_entries         - charity-wide Q&A library with a GIN search index.
--
-- All three tables follow the same "members rw" RLS shape used by `notes`
-- and `follow_ups`: any member of the charity can read, insert, update, or
-- delete rows. Tick toggles are simple upsert/delete keyed on
-- (customer_id, item_id).

-- =============================================================================
-- call_script_items - per-charity checklist
-- =============================================================================

create table public.call_script_items (
  id          uuid primary key default gen_random_uuid(),
  charity_id  uuid not null references public.charities(id) on delete cascade,
  body        text not null,
  sort_order  int  not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.call_script_items enable row level security;

create index call_script_items_charity_order_idx
  on public.call_script_items (charity_id, sort_order, created_at);

create policy "members read call_script_items"
  on public.call_script_items for select
  using (private.is_member_of(charity_id));

create policy "members insert call_script_items"
  on public.call_script_items for insert
  with check (private.is_member_of(charity_id));

create policy "members update call_script_items"
  on public.call_script_items for update
  using (private.is_member_of(charity_id))
  with check (private.is_member_of(charity_id));

create policy "members delete call_script_items"
  on public.call_script_items for delete
  using (private.is_member_of(charity_id));

create trigger call_script_items_updated_at
  before update on public.call_script_items
  for each row execute function private.set_updated_at();

-- =============================================================================
-- call_script_ticks - per-customer completion state
-- =============================================================================
--
-- (customer_id, item_id) is the natural primary key: a customer either has
-- or doesn't have a tick for a given item. Toggling is `insert ... on
-- conflict do nothing` to check, `delete` to uncheck. charity_id is
-- denormalized for RLS and auto-populated from the parent customer via the
-- BEFORE INSERT trigger below, so client callers only need to send
-- { customer_id, item_id }.

create table public.call_script_ticks (
  customer_id uuid not null references public.customers(id) on delete cascade,
  item_id     uuid not null references public.call_script_items(id) on delete cascade,
  charity_id  uuid not null references public.charities(id) on delete cascade,
  ticked_by   uuid references auth.users(id),
  ticked_at   timestamptz not null default now(),
  primary key (customer_id, item_id)
);

alter table public.call_script_ticks enable row level security;

create index call_script_ticks_item_idx
  on public.call_script_ticks (item_id);

create index call_script_ticks_charity_idx
  on public.call_script_ticks (charity_id);

create policy "members read call_script_ticks"
  on public.call_script_ticks for select
  using (private.is_member_of(charity_id));

create policy "members insert call_script_ticks"
  on public.call_script_ticks for insert
  with check (private.is_member_of(charity_id));

create policy "members delete call_script_ticks"
  on public.call_script_ticks for delete
  using (private.is_member_of(charity_id));

-- Auto-stamp charity_id and ticked_by from the parent customer + caller so
-- the modal can post { customer_id, item_id } without round-tripping the
-- charity through the client. Mirrors the pattern used by
-- private.set_contact_charity_id in 20260525000000_customer_contacts.sql.
create or replace function private.set_call_script_tick_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.charity_id is null then
    select c.charity_id into new.charity_id
    from public.customers c
    where c.id = new.customer_id;
  end if;
  if new.ticked_by is null then
    new.ticked_by := auth.uid();
  end if;
  return new;
end $$;

revoke execute on function private.set_call_script_tick_defaults() from anon, authenticated, public;

create trigger call_script_ticks_set_defaults
  before insert on public.call_script_ticks
  for each row execute function private.set_call_script_tick_defaults();

-- =============================================================================
-- faq_entries - per-charity Q&A
-- =============================================================================

create table public.faq_entries (
  id          uuid primary key default gen_random_uuid(),
  charity_id  uuid not null references public.charities(id) on delete cascade,
  question    text not null,
  answer      text not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.faq_entries enable row level security;

create index faq_entries_charity_idx
  on public.faq_entries (charity_id, created_at desc);

-- Optional server-side haystack for future-proofing; v1 filters client-side
-- since libraries are small.
create index faq_entries_search_idx
  on public.faq_entries using gin (
    to_tsvector('simple', coalesce(question, '') || ' ' || coalesce(answer, ''))
  );

create policy "members read faq_entries"
  on public.faq_entries for select
  using (private.is_member_of(charity_id));

create policy "members insert faq_entries"
  on public.faq_entries for insert
  with check (private.is_member_of(charity_id));

create policy "members update faq_entries"
  on public.faq_entries for update
  using (private.is_member_of(charity_id))
  with check (private.is_member_of(charity_id));

create policy "members delete faq_entries"
  on public.faq_entries for delete
  using (private.is_member_of(charity_id));

create trigger faq_entries_updated_at
  before update on public.faq_entries
  for each row execute function private.set_updated_at();
