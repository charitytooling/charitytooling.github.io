-- Allow note authors to edit their own notes within 24 hours of creation.
--
-- Today, the only RLS policy on public.notes ("members rw notes" in the init
-- migration line 606) grants `for all` to any charity member, so any rep can
-- edit or delete any note in their charity at any time. We tighten this so:
--
--   * UPDATE  -> only the author, only within 24h. Body is the only mutable
--                column (enforced by the trigger below). After 24h the row
--                is immutable audit history.
--   * DELETE  -> author within 24h, OR charity admin / super admin any
--                time (admin override is for scrubbing inappropriate
--                content). Outside both, DELETE is denied -- nobody can
--                clean up someone else's old notes.
--   * SELECT  -> unchanged: any charity member can read every note in
--                their charity.
--   * INSERT  -> unchanged effective behavior, but `created_by` must
--                either be NULL (the existing notes_set_created_by trigger
--                fills it from auth.uid()) or already equal auth.uid().
--                Prevents a member from masquerading as a colleague.

-- Body is the only mutable column on UPDATE. Block changes to kind /
-- customer_id / charity_id / created_by / created_at so a misbehaving
-- client can't move a note to a different customer, restamp authorship,
-- or re-classify it after the fact (which would skew last_contacted_at /
-- contact-tracking semantics tied to kind).
create or replace function public.notes_block_immutable_fields()
returns trigger language plpgsql as $$
begin
  if new.kind <> old.kind then
    raise exception 'notes.kind is immutable after creation';
  end if;
  if new.customer_id <> old.customer_id then
    raise exception 'notes.customer_id is immutable';
  end if;
  if new.charity_id <> old.charity_id then
    raise exception 'notes.charity_id is immutable';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'notes.created_by is immutable';
  end if;
  if new.created_at <> old.created_at then
    raise exception 'notes.created_at is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists notes_block_immutable_fields on public.notes;
create trigger notes_block_immutable_fields
  before update on public.notes
  for each row execute function public.notes_block_immutable_fields();

-- Replace the all-permissive "members rw notes" policy with split
-- per-action policies so we can scope UPDATE / DELETE without losing
-- SELECT / INSERT.
drop policy if exists "members rw notes" on public.notes;

create policy "members read notes"
  on public.notes for select
  using (private.is_member_of(charity_id));

create policy "members insert notes"
  on public.notes for insert
  with check (
    private.is_member_of(charity_id)
    and (created_by is null or created_by = (select auth.uid()))
  );

-- UPDATE: author + within 24h. The body-only rule is enforced by the
-- trigger above, so the policy just needs to gate who/when. WITH CHECK
-- mirrors USING so a transition that pushes the row out of policy is
-- still rejected (defense in depth -- the immutable-fields trigger
-- already prevents created_at being mutated).
create policy "author edits own note within 24h"
  on public.notes for update
  using (
    created_by = (select auth.uid())
    and created_at > now() - interval '24 hours'
  )
  with check (
    created_by = (select auth.uid())
    and created_at > now() - interval '24 hours'
  );

-- DELETE: author within 24h, OR charity admin / super admin any time.
-- private.is_admin_of(charity_id) (init migration line 108-121) already
-- ORs in super-admin and per-charity admin role.
create policy "delete own within 24h or admin anytime"
  on public.notes for delete
  using (
    (
      created_by = (select auth.uid())
      and created_at > now() - interval '24 hours'
    )
    or private.is_admin_of(charity_id)
  );
