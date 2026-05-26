import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import {
  COMPLETENESS_FIELDS,
  getMissingFields,
  type CompletenessField,
} from '@/lib/completeness';
import type { CustomerContactRow, CustomerRow } from '@/state/customers';

type Variant = 'inline' | 'popover' | 'modal';

type Props = {
  customer: CustomerRow;
  primary: CustomerContactRow | null | undefined;
  variant: Variant;
  // Required when variant === 'modal'. Used to build deep links of the form
  // /contact/<id>?focus=field-... so HashRouter can hand off to the Update page.
  customerId?: string;
};

export function CompletenessDisclosure({ customer, primary, variant, customerId }: Props) {
  const score = customer.completeness_score;
  const missing = getMissingFields(customer, primary);
  const isComplete = score >= 100 || missing.length === 0;
  const hasPrimary = !!primary;

  if (isComplete) {
    return <CompleteLabel score={score} variant={variant} />;
  }

  if (variant === 'inline') {
    return (
      <InlineDisclosure score={score} missing={missing} hasPrimary={hasPrimary} />
    );
  }
  if (variant === 'modal') {
    return (
      <ModalDisclosure
        score={score}
        missing={missing}
        hasPrimary={hasPrimary}
        customerId={customerId}
      />
    );
  }
  return (
    <PopoverDisclosure score={score} missing={missing} hasPrimary={hasPrimary} />
  );
}

function CompleteLabel({ score, variant }: { score: number; variant: Variant }) {
  if (variant === 'inline') {
    return (
      <span className="text-xs font-medium text-ink-500 dark:text-ink-400">
        {score}% complete
      </span>
    );
  }
  // Both 'popover' and 'modal' use the compact ledger-row chip style.
  return (
    <span className="text-xs text-ink-400 dark:text-ink-500 shrink-0">{score}%</span>
  );
}

function InlineDisclosure({
  score,
  missing,
  hasPrimary,
}: {
  score: number;
  missing: CompletenessField[];
  hasPrimary: boolean;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex flex-col items-end">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 dark:text-ink-400 hover:text-ink-800 dark:hover:text-ink-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
      >
        <span>{score}% complete</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Missing fields"
          className="absolute right-0 top-full mt-2 z-20 w-64 card text-left shadow-lg"
        >
          <MissingList
            missing={missing}
            hasPrimary={hasPrimary}
            interactive
            onItemClick={() => setOpen(false)}
          />
        </div>
      )}
    </span>
  );
}

function PopoverDisclosure({
  score,
  missing,
  hasPrimary,
}: {
  score: number;
  missing: CompletenessField[];
  hasPrimary: boolean;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: globalThis.MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => !v);
  }

  return (
    <span ref={wrapRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1 text-xs text-ink-500 dark:text-ink-400 hover:text-ink-800 dark:hover:text-ink-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 -mx-1"
      >
        <span>{score}%</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Missing fields"
          className="absolute right-0 top-full mt-2 z-30 w-64 card text-left shadow-lg"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MissingList missing={missing} hasPrimary={hasPrimary} interactive={false} />
        </div>
      )}
    </span>
  );
}

function ModalDisclosure({
  score,
  missing,
  hasPrimary,
  customerId,
}: {
  score: number;
  missing: CompletenessField[];
  hasPrimary: boolean;
  customerId?: string;
}) {
  const [open, setOpen] = useState(false);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    // Stop propagation so the row's surrounding click targets (e.g. the
    // <Link> sibling) don't react to opening the modal.
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  }

  return (
    <span className="inline-flex shrink-0">
      <button
        type="button"
        onClick={handleClick}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-ink-500 dark:text-ink-400 hover:text-ink-800 dark:hover:text-ink-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 -mx-1"
      >
        <span>{score}%</span>
        <Chevron open={open} />
      </button>
      {open && (
        <Modal title={`${score}% complete`} onClose={() => setOpen(false)}>
          <MissingList
            missing={missing}
            hasPrimary={hasPrimary}
            interactive
            customerId={customerId}
            onItemClick={() => setOpen(false)}
          />
        </Modal>
      )}
    </span>
  );
}

function MissingList({
  missing,
  hasPrimary,
  interactive,
  customerId,
  onItemClick,
}: {
  missing: CompletenessField[];
  hasPrimary: boolean;
  interactive: boolean;
  // When set, each missing field renders as a router <Link> to
  // /update?id=<customerId>&focus=<domId>. Used by the modal variant in
  // the ledger to hand off across routes to the editable form, where the
  // `?focus=` effect in UpdateForm scrolls and focuses the matching input.
  // When unset (e.g. the inline variant on the Update page itself), falls
  // back to an in-page anchor link.
  customerId?: string;
  onItemClick?: () => void;
}) {
  const filledCount = COMPLETENESS_FIELDS.length - missing.length;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-ink-700 dark:text-ink-200">
        Missing fields
      </p>
      <p className="text-xs text-ink-500 dark:text-ink-400">
        {filledCount} of {COMPLETENESS_FIELDS.length} complete. Each field is worth 10%.
      </p>
      {!hasPrimary && (
        <p className="text-xs text-ink-500 dark:text-ink-400">
          This customer has no primary contact yet.
        </p>
      )}
      <ul className="space-y-1">
        {missing.map((f) => {
          const updateHref =
            interactive && customerId
              ? `/update?${new URLSearchParams({ id: customerId, focus: f.domId }).toString()}`
              : null;
          return (
            <li key={f.key} className="text-sm">
              {updateHref ? (
                <Link
                  to={updateHref}
                  onClick={onItemClick}
                  className="block text-accent hover:text-accent-hover hover:underline underline-offset-2"
                >
                  {f.label}
                </Link>
              ) : interactive ? (
                <a
                  href={`#${f.domId}`}
                  onClick={(e) => handleAnchorClick(e, f.domId, onItemClick)}
                  className="block text-accent hover:text-accent-hover hover:underline underline-offset-2"
                >
                  {f.label}
                </a>
              ) : (
                <span className="block text-ink-700 dark:text-ink-200">{f.label}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function handleAnchorClick(
  e: MouseEvent<HTMLAnchorElement>,
  domId: string,
  onAfter?: () => void,
) {
  // Always prevent default first. The href is `#field-...` and a stray hash
  // change here would land in HashRouter's catch-all and bounce signed-in
  // users to /ledger.
  e.preventDefault();
  const el = document.getElementById(domId);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Defer focus so it fires after the smooth scroll begins; helps mobile
  // keyboards behave consistently.
  window.setTimeout(() => {
    if (typeof (el as HTMLElement).focus === 'function') {
      (el as HTMLElement).focus({ preventScroll: true });
    }
  }, 250);
  onAfter?.();
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['h-3 w-3 transition-transform', open ? 'rotate-180' : ''].join(' ')}
      aria-hidden="true"
    >
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}
