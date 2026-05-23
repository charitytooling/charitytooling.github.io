import { useState } from 'react';
import { useCreateNote } from '@/state/notes';

const KINDS: { value: 'call' | 'email' | 'meeting' | 'research' | 'other'; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'research', label: 'Research' },
  { value: 'other', label: 'Other' },
];

export function NoteForm({ customerId, charityId }: { customerId: string; charityId: string }) {
  const [kind, setKind] = useState<'call' | 'email' | 'meeting' | 'research' | 'other'>('call');
  const [body, setBody] = useState('');
  const create = useCreateNote();

  async function submit() {
    if (!body.trim()) return;
    await create.mutateAsync({
      charity_id: charityId,
      customer_id: customerId,
      kind,
      body: body.trim(),
    });
    setBody('');
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            className={[
              'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap',
              kind === k.value ? 'bg-accent text-white' : 'bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200',
            ].join(' ')}
          >
            {k.label}
          </button>
        ))}
      </div>
      <textarea
        className="field"
        rows={3}
        placeholder="What happened?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {create.error && <p className="text-red-600 text-sm">{(create.error as Error).message}</p>}
      <button
        type="button"
        className="btn-primary w-full"
        disabled={create.isPending || !body.trim()}
        onClick={submit}
      >
        {create.isPending ? 'Saving...' : 'Save note'}
      </button>
    </div>
  );
}
