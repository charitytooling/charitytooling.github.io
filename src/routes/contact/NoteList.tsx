import { useState } from 'react';
import { useDeleteNote, useUpdateNote, type NoteRow } from '@/state/notes';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function NoteList({
  notes,
  loading,
  userId,
  isAdmin,
  customerId,
}: {
  notes: NoteRow[];
  loading: boolean;
  userId: string | null;
  isAdmin: boolean;
  customerId: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (loading) return <div className="text-ink-400 dark:text-ink-500 text-sm">Loading...</div>;
  if (notes.length === 0) return <p className="text-sm text-ink-500 dark:text-ink-400">No notes yet.</p>;

  return (
    <ul className="divide-y divide-ink-100 dark:divide-ink-800">
      {notes.map((n) => {
        // Show the email local-part (william@clickplumbing.com -> "william")
        // when the author is known. Pre-trigger / cross-charity authors
        // resolve to null and render no chip rather than a placeholder, so
        // the row layout stays clean.
        const localPart = n.author?.email ? n.author.email.split('@')[0] : null;

        // Mirror server RLS in the UI gates so the buttons match what the
        // server will actually allow. canEdit: author within 24h. canDelete:
        // canEdit OR charity admin (super admin is folded into isAdmin).
        // Recomputed each render -- if you cross the 24h boundary while
        // staring at the page, the button stays until next render and an
        // attempted UPDATE/DELETE will be denied by RLS, surfacing as an
        // error.
        const isAuthor = !!userId && n.created_by === userId;
        const withinWindow = Date.now() - new Date(n.created_at).getTime() < TWENTY_FOUR_HOURS_MS;
        const canEdit = isAuthor && withinWindow;
        const canDelete = canEdit || isAdmin;
        const isEditing = editingId === n.id;

        return (
          <li key={n.id} className="py-3">
            <div className="flex items-center justify-between text-xs text-ink-500 dark:text-ink-400 mb-1">
              <div className="flex items-center gap-2">
                <span className="font-medium uppercase tracking-wide">{n.kind}</span>
                {localPart && (
                  <span className="rounded-full bg-ink-100 dark:bg-ink-800 px-2 py-0.5 text-[11px] normal-case">
                    {localPart}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span>{new Date(n.created_at).toLocaleString()}</span>
                {!isEditing && canEdit && (
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => setEditingId(n.id)}
                  >
                    Edit
                  </button>
                )}
                {!isEditing && canDelete && (
                  <DeleteButton noteId={n.id} customerId={customerId} />
                )}
              </div>
            </div>
            {isEditing ? (
              <NoteEditor
                noteId={n.id}
                customerId={customerId}
                initialBody={n.body}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{n.body}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NoteEditor({
  noteId,
  customerId,
  initialBody,
  onDone,
}: {
  noteId: string;
  customerId: string;
  initialBody: string;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(initialBody);
  const update = useUpdateNote();

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === initialBody.trim()) {
      onDone();
      return;
    }
    try {
      await update.mutateAsync({ id: noteId, customer_id: customerId, body: trimmed });
      onDone();
    } catch (err) {
      // RLS denial is the most likely failure here (clock drift across the
      // 24h boundary). Surface the message inline so the rep sees why the
      // save bounced rather than silently swallowing it.
      const msg = err instanceof Error ? err.message : 'Could not save note';
      alert(msg);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        className="field"
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg bg-accent text-white px-3 py-1.5 text-sm font-medium hover:bg-accent-hover disabled:bg-ink-200 disabled:text-ink-500 disabled:cursor-not-allowed dark:disabled:bg-ink-800"
          onClick={save}
          disabled={update.isPending}
        >
          {update.isPending ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          className="rounded-lg bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 px-3 py-1.5 text-sm font-medium hover:bg-ink-200 dark:hover:bg-ink-700 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onDone}
          disabled={update.isPending}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DeleteButton({ noteId, customerId }: { noteId: string; customerId: string }) {
  const del = useDeleteNote();

  async function handleClick() {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    try {
      await del.mutateAsync({ id: noteId, customer_id: customerId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not delete note';
      alert(msg);
    }
  }

  return (
    <button
      type="button"
      className="text-red-600 hover:underline disabled:opacity-50"
      onClick={handleClick}
      disabled={del.isPending}
    >
      {del.isPending ? 'Deleting...' : 'Delete'}
    </button>
  );
}
