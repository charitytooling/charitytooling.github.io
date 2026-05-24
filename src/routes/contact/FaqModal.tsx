import { useMemo, useState } from 'react';
import { Modal } from '../ledger/AddCustomerModal';
import {
  useCreateFaqEntry,
  useDeleteFaqEntry,
  useFaqEntries,
  useUpdateFaqEntry,
  type FaqRow,
} from '@/state/faq';

export function FaqModal({
  charityId,
  onClose,
}: {
  charityId: string;
  onClose: () => void;
}) {
  const entries = useFaqEntries(charityId);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  const list = entries.data ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (e) =>
        e.question.toLowerCase().includes(needle) || e.answer.toLowerCase().includes(needle),
    );
  }, [list, q]);

  return (
    <Modal title="FAQ" onClose={onClose}>
      <div className="space-y-3">
        <input
          className="field"
          placeholder="Search FAQs..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />

        {entries.isLoading ? (
          <p className="text-sm text-ink-400 dark:text-ink-500">Loading...</p>
        ) : list.length === 0 && !adding ? (
          <EmptyState onAdd={() => setAdding(true)} />
        ) : (
          <>
            {filtered.length === 0 && !adding && (
              <p className="text-sm text-ink-500 dark:text-ink-400">
                No FAQs match "{q.trim()}".
              </p>
            )}
            <ul className="space-y-2">
              {filtered.map((entry) => (
                <FaqCard key={entry.id} entry={entry} charityId={charityId} />
              ))}
            </ul>
          </>
        )}

        {adding ? (
          <AddForm
            charityId={charityId}
            initialQuestion={q.trim()}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              setQ('');
            }}
          />
        ) : (
          <button
            type="button"
            className="btn-ghost w-full"
            onClick={() => setAdding(true)}
          >
            + Add FAQ
          </button>
        )}

        <div className="pt-1">
          <button type="button" className="btn-ghost w-full" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// FAQ card (view + inline edit)
// -----------------------------------------------------------------------------

function FaqCard({ entry, charityId }: { entry: FaqRow; charityId: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-xl border border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-950 p-3">
        <EditForm
          entry={entry}
          charityId={charityId}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900">
      <button
        type="button"
        className="w-full text-left px-3 py-2 flex items-start gap-2"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-ink-400 dark:text-ink-500 mt-0.5 shrink-0">
          {open ? '▾' : '▸'}
        </span>
        <span className="font-medium text-sm flex-1 min-w-0">{entry.question}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pl-8 space-y-2">
          <p className="text-sm whitespace-pre-wrap text-ink-700 dark:text-ink-200">
            {entry.answer}
          </p>
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <DeleteButton id={entry.id} charityId={charityId} />
          </div>
        </div>
      )}
    </li>
  );
}

function DeleteButton({ id, charityId }: { id: string; charityId: string }) {
  const del = useDeleteFaqEntry();
  async function onDelete() {
    if (!confirm('Delete this FAQ?')) return;
    await del.mutateAsync({ id, charity_id: charityId });
  }
  return (
    <button
      type="button"
      className="text-ink-500 dark:text-ink-400 hover:text-red-600 disabled:opacity-50"
      onClick={onDelete}
      disabled={del.isPending}
    >
      Delete
    </button>
  );
}

// -----------------------------------------------------------------------------
// Forms
// -----------------------------------------------------------------------------

function AddForm({
  charityId,
  initialQuestion,
  onCancel,
  onSaved,
}: {
  charityId: string;
  initialQuestion: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const create = useCreateFaqEntry();
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState('');

  async function submit() {
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a) return;
    await create.mutateAsync({ charity_id: charityId, question: q, answer: a });
    onSaved();
  }

  return (
    <div className="rounded-xl border border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-950 p-3 space-y-2">
      <div>
        <label className="label">Question</label>
        <input
          className="field"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          autoFocus
        />
      </div>
      <div>
        <label className="label">Answer</label>
        <textarea
          className="field"
          rows={4}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
      </div>
      {create.error && (
        <p className="text-red-600 text-sm">{(create.error as Error).message}</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="btn-ghost flex-1 py-2 text-sm"
          onClick={onCancel}
          disabled={create.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary flex-1 py-2 text-sm"
          disabled={!question.trim() || !answer.trim() || create.isPending}
          onClick={() => void submit()}
        >
          {create.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function EditForm({
  entry,
  charityId,
  onDone,
}: {
  entry: FaqRow;
  charityId: string;
  onDone: () => void;
}) {
  const update = useUpdateFaqEntry();
  const [question, setQuestion] = useState(entry.question);
  const [answer, setAnswer] = useState(entry.answer);

  async function submit() {
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a) return;
    await update.mutateAsync({
      id: entry.id,
      charity_id: charityId,
      patch: { question: q, answer: a },
    });
    onDone();
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="label">Question</label>
        <input
          className="field"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </div>
      <div>
        <label className="label">Answer</label>
        <textarea
          className="field"
          rows={4}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
      </div>
      {update.error && (
        <p className="text-red-600 text-sm">{(update.error as Error).message}</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="btn-ghost flex-1 py-2 text-sm"
          onClick={onDone}
          disabled={update.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary flex-1 py-2 text-sm"
          disabled={!question.trim() || !answer.trim() || update.isPending}
          onClick={() => void submit()}
        >
          {update.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="text-center py-6 space-y-2">
      <p className="text-sm text-ink-500 dark:text-ink-400">No FAQs yet.</p>
      <button type="button" className="text-accent text-sm font-medium" onClick={onAdd}>
        Add your first FAQ
      </button>
    </div>
  );
}
