import { useState } from 'react';
import { useCreateFollowUp, useUpdateFollowUp, type FollowUpRow } from '@/state/notes';

export function FollowUpList({
  customerId,
  charityId,
  followUps,
  showNew,
  onShowNewChange,
}: {
  customerId: string;
  charityId: string;
  followUps: FollowUpRow[];
  // Controlled by the parent so an outside button (e.g. the "+ Follow-up"
  // shortcut next to the Log a note header) can deep-link straight into the
  // new-follow-up form.
  showNew: boolean;
  onShowNewChange: (next: boolean) => void;
}) {
  const open = followUps.filter((f) => f.status === 'open');
  const snoozed = followUps.filter((f) => f.status === 'snoozed');
  const done = followUps.filter((f) => f.status === 'done').slice(0, 3);

  const create = useCreateFollowUp();
  const update = useUpdateFollowUp();

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Follow-ups</h2>
        <button type="button" onClick={() => onShowNewChange(!showNew)} className="text-accent text-sm">
          {showNew ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showNew && (
        <NewFollowUpForm
          onSubmit={async (input) => {
            await create.mutateAsync({
              customer_id: customerId,
              charity_id: charityId,
              ...input,
            });
            onShowNewChange(false);
          }}
        />
      )}

      {[...open, ...snoozed].length === 0 && !showNew && (
        <p className="text-sm text-ink-500 dark:text-ink-400">No open follow-ups.</p>
      )}

      <ul className="space-y-2">
        {[...open, ...snoozed].map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2 bg-ink-50 dark:bg-ink-950 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{f.reason ?? 'Follow up'}</div>
              <div className="text-xs text-ink-500 dark:text-ink-400">
                Due {new Date(f.due_date).toLocaleDateString()}
                {f.status === 'snoozed' && ' - snoozed'}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                type="button"
                className="text-xs bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 rounded-md px-2 py-1"
                onClick={() => update.mutate({ id: f.id, status: 'snoozed', due_date: addDays(f.due_date, 7) })}
              >
                +7d
              </button>
              <button
                type="button"
                className="text-xs bg-accent text-white rounded-md px-2 py-1"
                onClick={() => update.mutate({ id: f.id, status: 'done' })}
              >
                Done
              </button>
            </div>
          </li>
        ))}
      </ul>

      {done.length > 0 && (
        <details className="text-xs">
          <summary className="text-ink-500 dark:text-ink-400 cursor-pointer">Recently completed ({done.length})</summary>
          <ul className="mt-2 space-y-1">
            {done.map((f) => (
              <li key={f.id} className="text-ink-500 dark:text-ink-400">
                {f.reason ?? 'Follow up'} - {new Date(f.due_date).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function NewFollowUpForm({ onSubmit }: { onSubmit: (input: { due_date: string; reason: string | null }) => Promise<void> }) {
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [reason, setReason] = useState('');
  return (
    <div className="flex flex-col gap-2 bg-ink-50 dark:bg-ink-950 p-3 rounded-lg">
      <input
        type="text"
        className="field"
        placeholder="Reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <input
        type="date"
        className="field"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
      />
      <button
        type="button"
        className="btn-primary"
        onClick={() => onSubmit({ due_date: dueDate, reason: reason || null })}
      >
        Save
      </button>
    </div>
  );
}
