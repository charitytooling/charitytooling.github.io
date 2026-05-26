import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import {
  useCallScriptItems,
  useCallScriptTicks,
  useCreateCallScriptItem,
  useDeleteCallScriptItem,
  useToggleCallScriptTick,
  useUpdateCallScriptItem,
  type CallScriptItemRow,
} from '@/state/callScript';

export function CallScriptModal({
  customerId,
  charityId,
  onClose,
}: {
  customerId: string;
  charityId: string;
  onClose: () => void;
}) {
  const items = useCallScriptItems(charityId);
  const ticks = useCallScriptTicks(customerId);
  const [editing, setEditing] = useState(false);

  const tickedIds = useMemo(
    () => new Set((ticks.data ?? []).map((t) => t.item_id)),
    [ticks.data],
  );
  const tickedAtById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of ticks.data ?? []) map.set(t.item_id, t.ticked_at);
    return map;
  }, [ticks.data]);

  const list = items.data ?? [];
  const total = list.length;
  const done = list.reduce((n, it) => n + (tickedIds.has(it.id) ? 1 : 0), 0);

  return (
    <Modal title="Call script" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-ink-500 dark:text-ink-400">
          <span>
            {editing
              ? `${total} item${total === 1 ? '' : 's'}`
              : total > 0
              ? `${done} of ${total} complete`
              : 'No items yet'}
          </span>
          <button
            type="button"
            className="text-accent text-sm font-medium"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>

        {items.isLoading ? (
          <p className="text-sm text-ink-400 dark:text-ink-500">Loading...</p>
        ) : editing ? (
          <EditList items={list} charityId={charityId} />
        ) : list.length === 0 ? (
          <EmptyState onStart={() => setEditing(true)} />
        ) : (
          <RunList
            items={list}
            tickedIds={tickedIds}
            tickedAtById={tickedAtById}
            customerId={customerId}
          />
        )}

        <div className="pt-2">
          <button type="button" className="btn-ghost w-full" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Run mode
// -----------------------------------------------------------------------------

function RunList({
  items,
  tickedIds,
  tickedAtById,
  customerId,
}: {
  items: CallScriptItemRow[];
  tickedIds: Set<string>;
  tickedAtById: Map<string, string>;
  customerId: string;
}) {
  const toggle = useToggleCallScriptTick();
  return (
    <ul className="divide-y divide-ink-100 dark:divide-ink-800 -mx-4">
      {items.map((item) => {
        const checked = tickedIds.has(item.id);
        const tickedAt = tickedAtById.get(item.id);
        return (
          <li key={item.id} className="px-4 py-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 accent-accent shrink-0"
                checked={checked}
                disabled={toggle.isPending}
                onChange={() =>
                  toggle.mutate({
                    customer_id: customerId,
                    item_id: item.id,
                    currentlyTicked: checked,
                  })
                }
              />
              <div className="min-w-0 flex-1">
                <p
                  className={[
                    'text-sm whitespace-pre-wrap',
                    checked ? 'line-through text-ink-400 dark:text-ink-500' : '',
                  ].join(' ')}
                >
                  {item.body}
                </p>
                {checked && tickedAt && (
                  <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-0.5">
                    Ticked {new Date(tickedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="text-center py-6 space-y-2">
      <p className="text-sm text-ink-500 dark:text-ink-400">
        No call script items yet.
      </p>
      <button type="button" className="text-accent text-sm font-medium" onClick={onStart}>
        Add your first item
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Edit mode
// -----------------------------------------------------------------------------

function EditList({
  items,
  charityId,
}: {
  items: CallScriptItemRow[];
  charityId: string;
}) {
  const create = useCreateCallScriptItem();
  const update = useUpdateCallScriptItem();
  const [adding, setAdding] = useState('');

  // Reorder by swapping sort_order with the adjacent item. Two sequential
  // updates; the list refetches on success and the new order takes effect.
  async function move(index: number, dir: -1 | 1) {
    const a = items[index];
    const b = items[index + dir];
    if (!a || !b) return;
    await update.mutateAsync({
      id: a.id,
      charity_id: charityId,
      patch: { sort_order: b.sort_order },
    });
    await update.mutateAsync({
      id: b.id,
      charity_id: charityId,
      patch: { sort_order: a.sort_order },
    });
  }

  async function submitAdd() {
    const body = adding.trim();
    if (!body) return;
    const maxOrder = items.reduce((m, it) => Math.max(m, it.sort_order), -1);
    await create.mutateAsync({
      charity_id: charityId,
      body,
      sort_order: maxOrder + 10,
    });
    setAdding('');
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-ink-100 dark:divide-ink-800 -mx-4">
        {items.map((item, idx) => (
          <EditRow
            key={item.id}
            item={item}
            charityId={charityId}
            canUp={idx > 0}
            canDown={idx < items.length - 1}
            onUp={() => move(idx, -1)}
            onDown={() => move(idx, 1)}
          />
        ))}
      </ul>
      <div className="flex gap-2 pt-1">
        <input
          className="field flex-1"
          placeholder="New checklist item"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submitAdd();
            }
          }}
        />
        <button
          type="button"
          className="btn-primary px-4 py-3 text-sm"
          disabled={!adding.trim() || create.isPending}
          onClick={() => void submitAdd()}
        >
          Add
        </button>
      </div>
      {create.error && <p className="text-red-600 text-sm">{(create.error as Error).message}</p>}
    </div>
  );
}

function EditRow({
  item,
  charityId,
  canUp,
  canDown,
  onUp,
  onDown,
}: {
  item: CallScriptItemRow;
  charityId: string;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  const update = useUpdateCallScriptItem();
  const del = useDeleteCallScriptItem();
  const [body, setBody] = useState(item.body);

  async function onBlur() {
    const next = body.trim();
    if (!next || next === item.body) {
      setBody(item.body);
      return;
    }
    await update.mutateAsync({
      id: item.id,
      charity_id: charityId,
      patch: { body: next },
    });
  }

  async function onDelete() {
    if (!confirm('Delete this checklist item? Ticks on customers will also be removed.')) return;
    await del.mutateAsync({ id: item.id, charity_id: charityId });
  }

  return (
    <li className="px-4 py-2 flex items-start gap-2">
      <div className="flex flex-col gap-1 pt-1 shrink-0 text-ink-500 dark:text-ink-400">
        <button
          type="button"
          aria-label="Move up"
          className="h-6 w-6 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 disabled:opacity-30 disabled:hover:bg-transparent"
          onClick={onUp}
          disabled={!canUp}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Move down"
          className="h-6 w-6 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 disabled:opacity-30 disabled:hover:bg-transparent"
          onClick={onDown}
          disabled={!canDown}
        >
          ↓
        </button>
      </div>
      <textarea
        className="field min-h-[44px] flex-1 py-2"
        rows={1}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={onBlur}
      />
      <button
        type="button"
        aria-label="Delete"
        className="shrink-0 text-ink-500 dark:text-ink-400 hover:text-red-600 px-2 py-1 text-sm disabled:opacity-50"
        onClick={onDelete}
        disabled={del.isPending}
      >
        Delete
      </button>
    </li>
  );
}
