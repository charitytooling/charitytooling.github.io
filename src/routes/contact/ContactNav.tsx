import { Link } from 'react-router-dom';
import { displayName } from '@/state/customers';
import { useContactQueue } from '@/state/queue';

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

  const prevLabel = prevId ? displayName(queue[idx - 1]) : null;
  const nextLabel = nextId
    ? displayName(inQueue ? queue[idx + 1] : queue[0])
    : null;

  return (
    <nav
      className="card flex items-center justify-between gap-2"
      aria-label="Contact navigation"
    >
      <NavButton dir="prev" to={prevId} label={prevLabel} />
      <div className="text-xs text-ink-500 text-center min-w-[5rem]">
        {inQueue ? `${idx + 1} of ${queue.length}` : `${queue.length} to do`}
      </div>
      <NavButton dir="next" to={nextId} label={nextLabel} />
    </nav>
  );
}

function NavButton({
  dir,
  to,
  label,
}: {
  dir: 'prev' | 'next';
  to: string | null;
  label: string | null;
}) {
  const inner = (
    <span className="flex items-center gap-2">
      {dir === 'prev' && <ArrowLeftIcon className="h-4 w-4 shrink-0" />}
      <span className="flex flex-col items-start min-w-0">
        <span className="text-xs leading-none text-ink-500">
          {dir === 'prev' ? 'Previous' : 'Next'}
        </span>
        <span className="text-sm font-medium truncate max-w-[8rem]">
          {label ?? '—'}
        </span>
      </span>
      {dir === 'next' && <ArrowRightIcon className="h-4 w-4 shrink-0" />}
    </span>
  );

  if (!to) {
    return (
      <span
        className="btn-ghost opacity-40 cursor-not-allowed select-none"
        aria-disabled="true"
      >
        {inner}
      </span>
    );
  }
  return (
    <Link to={`/contact/${to}`} className="btn-ghost">
      {inner}
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
