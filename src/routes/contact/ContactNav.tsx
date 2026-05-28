import { Link } from 'react-router-dom';
import { useContactQueue } from '@/state/queue';
import { contactSortShortLabel, useProfile } from '@/state/profile';
import { VisitStopwatch } from '@/components/VisitStopwatch';

// Footer that sits at the bottom of /contact/:id. Visually mirrors the
// equivalent block at the bottom of /update: a full-width primary "Next"
// affordance, the active queue ordering as a muted caption, and the
// VisitStopwatch below. Both pages now read the same
// profiles.contact_queue_sort preference, so the caption's label and the
// chosen Next target stay in sync between tabs.
export function ContactNav({
  currentId,
  charityId,
}: {
  currentId: string;
  charityId: string;
}) {
  const queue = useContactQueue(charityId);
  const profile = useProfile();
  const sort = profile.data?.contact_queue_sort ?? 'stalest_first';

  if (queue.length === 0) return null;

  const idx = queue.findIndex((c) => c.id === currentId);
  // idx === -1 means the current customer isn't in the actionable queue
  // (e.g. they opened a fully-complete customer via search or sticky).
  // Treat Next as "jump into the queue at position 0".
  const nextId =
    idx === -1
      ? queue[0].id
      : idx < queue.length - 1
        ? queue[idx + 1].id
        : null;

  return (
    <nav aria-label="Contact navigation" className="space-y-3">
      {nextId ? (
        <Link
          to={`/contact/${nextId}`}
          className="btn-primary w-full text-center"
        >
          Next
        </Link>
      ) : (
        <span
          className="btn-primary w-full text-center opacity-40 cursor-not-allowed select-none"
          aria-disabled="true"
        >
          Next
        </span>
      )}
      <p className="text-xs text-ink-500 dark:text-ink-400 text-center">
        Order: {contactSortShortLabel(sort)}.{' '}
        <Link to="/settings" className="underline hover:text-accent">
          Change
        </Link>
      </p>
      <div className="flex justify-center pt-1">
        <VisitStopwatch />
      </div>
    </nav>
  );
}
