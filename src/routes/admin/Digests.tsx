import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsSuperAdmin } from '@/state/profile';
import { useMyCharities } from '@/state/charities';
import { edgeFunctions } from '@/lib/edgeFunctions';
import {
  useAllUsers,
  useDeleteRecipient,
  useDigestRecipients,
  useUpsertRecipient,
  type DigestRecipient,
  type UpsertRecipientInput,
} from '@/state/digests';

function recipientName(r: { full_name: string | null; email: string | null }): string {
  return r.full_name?.trim() || r.email || 'Unknown user';
}

export function Digests() {
  const isSuper = useIsSuperAdmin();
  const recipients = useDigestRecipients();
  const [editing, setEditing] = useState<DigestRecipient | 'new' | null>(null);

  if (!isSuper) return <Navigate to="/admin" replace />;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-5">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Activity digests</h1>
          <p className="text-ink-500 dark:text-ink-400 text-sm">
            Email summaries of team activity — contacted, added, archived, and time in app.
          </p>
        </div>
        {editing === null && (
          <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
            + Recipient
          </button>
        )}
      </header>

      {editing !== null && (
        <RecipientEditor
          recipient={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}

      {recipients.isLoading ? (
        <div className="text-ink-400 dark:text-ink-500 text-sm">Loading…</div>
      ) : (recipients.data ?? []).length === 0 ? (
        <div className="card text-sm text-ink-500 dark:text-ink-400">
          No recipients yet. Add one to start sending digests.
        </div>
      ) : (
        <ul className="space-y-2">
          {(recipients.data ?? []).map((r) => (
            <RecipientCard key={r.id} recipient={r} onEdit={() => setEditing(r)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecipientCard({
  recipient,
  onEdit,
}: {
  recipient: DigestRecipient;
  onEdit: () => void;
}) {
  const charities = useMyCharities();
  const del = useDeleteRecipient();
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const freq = [
    recipient.send_daily ? 'Daily' : null,
    recipient.send_weekly ? 'Weekly' : null,
  ].filter(Boolean);

  const scopeLabel =
    recipient.scope === 'all'
      ? 'All charities'
      : (recipient.charity_ids ?? [])
          .map((id) => charities.data?.find((c) => c.id === id)?.name ?? id)
          .join(', ') || 'No charities';

  async function sendTest() {
    setTestState('sending');
    setTestMsg(null);
    try {
      const res = await edgeFunctions.activityDigestTest({ recipient_id: recipient.id });
      setTestState('sent');
      setTestMsg(res.skipped ? 'Skipped (no email on file).' : 'Test sent.');
    } catch (err) {
      setTestState('error');
      setTestMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <li className="card space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{recipientName(recipient)}</div>
          <div className="text-xs text-ink-500 dark:text-ink-400">{recipient.email}</div>
        </div>
        {!recipient.enabled && (
          <span className="text-xs rounded bg-ink-100 dark:bg-ink-800 px-2 py-0.5 text-ink-500 dark:text-ink-400">
            Disabled
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {freq.map((f) => (
          <span key={f} className="text-xs rounded bg-accent/10 text-accent px-2 py-0.5">
            {f}
          </span>
        ))}
        {freq.length === 0 && (
          <span className="text-xs text-ink-400 dark:text-ink-500">No cadence set</span>
        )}
        <span className="text-xs rounded bg-ink-100 dark:bg-ink-800 px-2 py-0.5 text-ink-600 dark:text-ink-300">
          {scopeLabel}
        </span>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button type="button" className="btn-ghost text-sm" onClick={onEdit}>
          Edit
        </button>
        <button
          type="button"
          className="btn-ghost text-sm"
          onClick={sendTest}
          disabled={testState === 'sending'}
        >
          {testState === 'sending' ? 'Sending…' : 'Send test'}
        </button>
        <button
          type="button"
          className="btn-ghost text-sm text-red-600 ml-auto"
          onClick={() => {
            if (confirm(`Remove ${recipientName(recipient)} from digests?`)) del.mutate(recipient.id);
          }}
        >
          Remove
        </button>
      </div>
      {testMsg && (
        <p className={`text-xs ${testState === 'error' ? 'text-red-600' : 'text-ink-500 dark:text-ink-400'}`}>
          {testMsg}
        </p>
      )}
    </li>
  );
}

function RecipientEditor({
  recipient,
  onDone,
}: {
  recipient: DigestRecipient | null;
  onDone: () => void;
}) {
  const users = useAllUsers();
  const charities = useMyCharities();
  const upsert = useUpsertRecipient();

  const [form, setForm] = useState<UpsertRecipientInput>({
    id: recipient?.id,
    user_id: recipient?.user_id ?? '',
    send_daily: recipient?.send_daily ?? false,
    send_weekly: recipient?.send_weekly ?? true,
    scope: recipient?.scope ?? 'all',
    charity_ids: recipient?.charity_ids ?? [],
    enabled: recipient?.enabled ?? true,
  });

  const patch = (p: Partial<UpsertRecipientInput>) => setForm((f) => ({ ...f, ...p }));

  function toggleCharity(id: string) {
    setForm((f) => ({
      ...f,
      charity_ids: f.charity_ids.includes(id)
        ? f.charity_ids.filter((x) => x !== id)
        : [...f.charity_ids, id],
    }));
  }

  const valid =
    !!form.user_id &&
    (form.send_daily || form.send_weekly) &&
    (form.scope === 'all' || form.charity_ids.length > 0);

  async function save() {
    await upsert.mutateAsync(form);
    onDone();
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">{recipient ? 'Edit recipient' : 'New recipient'}</h2>

      <div>
        <label className="label">Recipient</label>
        <select
          className="field"
          value={form.user_id}
          onChange={(e) => patch({ user_id: e.target.value })}
        >
          <option value="">Select a user…</option>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name?.trim() ? `${u.full_name} <${u.email}>` : u.email ?? u.id}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Frequency</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.send_daily}
              onChange={(e) => patch({ send_daily: e.target.checked })}
            />
            Daily (8am)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.send_weekly}
              onChange={(e) => patch({ send_weekly: e.target.checked })}
            />
            Weekly (Mon 8am)
          </label>
        </div>
      </div>

      <div>
        <label className="label">Charities covered</label>
        <div className="flex gap-4 mb-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="scope"
              checked={form.scope === 'all'}
              onChange={() => patch({ scope: 'all' })}
            />
            All charities
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="scope"
              checked={form.scope === 'specific'}
              onChange={() => patch({ scope: 'specific' })}
            />
            Specific
          </label>
        </div>
        {form.scope === 'specific' && (
          <div className="space-y-1.5 border-t border-ink-100 dark:border-ink-800 pt-2">
            {(charities.data ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.charity_ids.includes(c.id)}
                  onChange={() => toggleCharity(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        Enabled
      </label>

      {upsert.error && <p className="text-red-600 text-sm">{(upsert.error as Error).message}</p>}

      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={onDone} disabled={upsert.isPending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={!valid || upsert.isPending}
          onClick={save}
        >
          {upsert.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
