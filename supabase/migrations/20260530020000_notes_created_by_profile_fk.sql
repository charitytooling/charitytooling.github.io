-- Fix Note History "save succeeds, list looks empty" bug.
--
-- src/state/notes.ts useNotes embeds the author profile via:
--   .select('*, author:profiles!notes_created_by_fkey(id, email)')
-- That hint tells PostgREST to follow the FK named `notes_created_by_fkey`
-- to embed a row from `public.profiles`. The constraint exists, but it
-- references `auth.users(id)` (see 20260522000000_init.sql line 193), not
-- `public.profiles(id)`. Result: PostgREST returns PGRST200 "Could not
-- find a relationship", useNotes throws, src/routes/Contact.tsx swallows
-- the error with `notes.data ?? []`, and the History card looks empty
-- even though the INSERT succeeded.
--
-- Add a parallel FK from notes.created_by to profiles(id) so PostgREST
-- has a real relationship to embed through. This is additive: the
-- existing `notes_created_by_fkey` -> auth.users(id) stays in place. Both
-- FKs target the same UUIDs at runtime because profiles.id is a 1:1
-- reference to auth.users.id (init migration line 28), so every value
-- valid for one is valid for the other -- and existing rows
-- (created_by IS NULL or = a real user id) all satisfy the new FK.
--
-- on delete set null lets a future user/profile deletion cascade cleanly:
--   1. delete auth.users row
--   2. profiles.id ON DELETE CASCADE deletes the profile
--   3. this new FK ON DELETE SET NULL nulls notes.created_by
--   4. existing notes_created_by_fkey -> auth.users now sees NULL and
--      no longer blocks the parent deletion.
alter table public.notes
  add constraint notes_created_by_profile_fkey
  foreign key (created_by)
  references public.profiles(id)
  on delete set null;
