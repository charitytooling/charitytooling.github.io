import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { displayName, useArchiveCustomer, type CustomerRow } from '@/state/customers';
import { useCreateNote } from '@/state/notes';

const KINDS: { value: 'call' | 'email' | 'meeting' | 'research' | 'other'; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'research', label: 'Research' },
  { value: 'other', label: 'Other' },
];

// Combo flow: leave a note explaining why this customer is being archived,
// then archive them, then hand control back to the parent so it can advance
// the contact queue. Note creation runs first so we never end up with a
// silently-archived customer; if the archive step fails after the note
// saved, the note remains in History and the user can retry archive from
// the Update page or come back here.
export function ArchiveWithNoteModal({
  customer,
  onClose,
  onArchived,
}: {
  customer: CustomerRow;
  onClose: () => void;
  onArchived: () => void;
}) {
  const [kind, setKind] = useState<'call' | 'email' | 'meeting' | 'research' | 'other'>('other');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useCreateNote();
  const archive = useArchiveCustomer(customer.id);
  const busy = create.isPending || archive.isPending;
  const canSubmit = body.trim().length > 0 && !busy;

  async function onSubmit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);

    try {
      await create.mutateAsync({
        charity_id: customer.charity_id,
        customer_id: customer.id,
        kind,
        body: trimmed,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not save note: ${err.message}`
          : 'Could not save note.',
      );
      return;
    }

    try {
      await archive.mutateAsync();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Note saved, but archive failed: ${err.message}. The note is in History; retry from the Update page if needed.`
          : 'Note saved, but archive failed. Retry from the Update page if needed.',
      );
      return;
    }

    onArchived();
  }

  // Lock close while busy so the user can't dismiss mid-mutation. Modal
  // already wires Escape and backdrop click to onClose, so this gating
  // wraps that single callback.
  function safeClose() {
    if (busy) return;
    onClose();
  }

  return (
    <Modal title="Archive & leave note" onClose={safeClose}>
      <div className="space-y-3">
        <p className="text-sm text-ink-700 dark:text-ink-200">
          Archive <span className="font-medium">{displayName(customer)}</span> and leave a note
          explaining why.
        </p>

        <div className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              disabled={busy}
              className={[
                'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap',
                kind === k.value
                  ? 'bg-accent text-white'
                  : 'bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200',
                busy ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="archive-note-body">
            Note
          </label>
          <textarea
            id="archive-note-body"
            className="field"
            rows={4}
            placeholder="Why is this customer being archived?"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={safeClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            {busy ? 'Archiving...' : 'Archive & leave note'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
