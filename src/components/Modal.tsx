import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  title: string;
  children: ReactNode;
  onClose: () => void;
};

export function Modal({ title, children, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Freeze the page behind the modal while it is open. We lock both <html>
  // and <body> overflow so that wheel/touch events on the backdrop have no
  // scrollable ancestor to consume them, and we save+restore the previous
  // values so unrelated callers (e.g. layouts that intentionally lock body
  // scroll for other reasons) aren't disturbed when the modal closes.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, []);

  // Render to document.body so the modal escapes any ancestor with
  // `transform` (which would otherwise capture `position: fixed` and shrink
  // the backdrop to that ancestor's box) or with `opacity-*` (which would
  // multiply into the panel and let background text bleed through). The
  // ledger virtualizer is the proximate offender on both counts -- its
  // virtual rows use `transform: translateY(...)` and archived/deleting
  // rows additionally apply `opacity-60`/`opacity-40`.
  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-ink-900/40 px-3 overscroll-contain"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain rounded-2xl bg-white dark:bg-ink-900 p-4 shadow-xl safe-bottom"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-500 dark:text-ink-400 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
