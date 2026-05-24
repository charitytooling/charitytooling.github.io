import { Link } from 'react-router-dom';
import { useContactQueue } from '@/state/queue';
import { VisitStopwatch } from '@/components/VisitStopwatch';

export function ContactNav({
  currentId,
  charityId,
}: {
  currentId: string;
  charityId: string;
}) {
  const queue = useContactQueue(charityId);

  if (queue.length === 0) return null;

  const idx = queue.findIndex((c) => c.id === currentId);
  const inQueue = idx !== -1;
  const prevId = inQueue && idx > 0 ? queue[idx - 1].id : null;
  const nextId = inQueue
    ? idx < queue.length - 1
      ? queue[idx + 1].id
      : null
    : queue[0].id;

  return (
    <nav className="card" aria-label="Contact navigation">
      <div className="flex justify-center mb-2">
        <VisitStopwatch />
      </div>
      <div className="flex items-center justify-between gap-2">
        <NavButton dir="prev" to={prevId} />
        <div className="text-xs text-ink-500 dark:text-ink-400 text-center min-w-[5rem]">
          {inQueue ? `${idx + 1} of ${queue.length}` : `${queue.length} to do`}
        </div>
        <NavButton dir="next" to={nextId} />
      </div>
    </nav>
  );
}

function NavButton({ dir, to }: { dir: 'prev' | 'next'; to: string | null }) {
  const label = dir === 'prev' ? 'Previous customer' : 'Next customer';
  const Icon = dir === 'prev' ? ArrowLeftIcon : ArrowRightIcon;

  if (!to) {
    return (
      <span
        className="btn-ghost opacity-40 cursor-not-allowed select-none px-3"
        aria-label={label}
        aria-disabled="true"
      >
        <Icon className="h-5 w-5" />
      </span>
    );
  }
  return (
    <Link to={`/contact/${to}`} className="btn-ghost px-3" aria-label={label}>
      <Icon className="h-5 w-5" />
    </Link>
  );
}

function ArrowLeftIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M19 12H5M11 5l-7 7 7 7" />
    </svg>
  );
}

function ArrowRightIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}
