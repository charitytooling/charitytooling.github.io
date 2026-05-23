import type { NoteRow } from '@/state/notes';

export function NoteList({ notes, loading }: { notes: NoteRow[]; loading: boolean }) {
  if (loading) return <div className="text-ink-400 text-sm">Loading...</div>;
  if (notes.length === 0) return <p className="text-sm text-ink-500">No notes yet.</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {notes.map((n) => (
        <li key={n.id} className="py-3">
          <div className="flex items-center justify-between text-xs text-ink-500 mb-1">
            <span className="font-medium uppercase tracking-wide">{n.kind}</span>
            <span>{new Date(n.created_at).toLocaleString()}</span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{n.body}</p>
        </li>
      ))}
    </ul>
  );
}
