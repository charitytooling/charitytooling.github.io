-- Per-user preference for how the Contact page's Prev/Next queue is ordered.
-- Read by useContactQueue() in src/state/queue.ts; written by ContactSortPicker
-- in src/routes/Settings.tsx. RLS is already covered by the existing
-- "update own profile" policy on public.profiles.

alter table public.profiles
  add column if not exists contact_queue_sort text not null default 'stalest_first'
  check (contact_queue_sort in (
    'stalest_first',
    'followup_due_soonest',
    'name_az',
    'newest_added',
    'random'
  ));
