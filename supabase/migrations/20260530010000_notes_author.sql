-- Surface the note author next to each note on the contact page.
--
-- Today, src/state/notes.ts useCreateNote inserts notes without setting
-- created_by, so every existing notes row has created_by = NULL. From here
-- on, a before-insert trigger stamps auth.uid() so the column is reliably
-- populated, and a new additive RLS policy lets charity members read the
-- profile rows of their co-members so the UI can join the author's email
-- and render its local-part as a chip.
--
-- Existing "read own profile or super admin" policy
-- (supabase/migrations/20260523000000_advisor_fixes.sql) stays in place;
-- permissive policies OR together, so self-read is unaffected.

-- Auto-stamp notes.created_by from auth.uid() when the caller didn't set
-- it. Edge functions that already pass created_by: caller.id (e.g.
-- send-payment-instructions, send-card-instructions) are unaffected
-- because the trigger only fires when created_by is null.
create or replace function public.notes_set_created_by()
returns trigger language plpgsql as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists notes_set_created_by on public.notes;
create trigger notes_set_created_by
  before insert on public.notes
  for each row execute function public.notes_set_created_by();

-- Let charity members read profile rows of other members in any shared
-- charity, so NoteList can show "william" next to a note authored by
-- william@clickplumbing.com. Scoped via charity_members so a member of
-- charity X cannot see profiles of members of an unrelated charity Y.
drop policy if exists "members read profiles of co-members" on public.profiles;
create policy "members read profiles of co-members"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.charity_members me
      join public.charity_members peer on peer.charity_id = me.charity_id
      where me.user_id = (select auth.uid())
        and peer.user_id = profiles.id
    )
  );
