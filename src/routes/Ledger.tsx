import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useActiveCharity } from '@/state/activeCharity';
import {
  displayName,
  primaryContact,
  useCustomers,
  useDeleteCustomer,
  type CustomerRow,
} from '@/state/customers';
import { useIsSuperAdmin } from '@/state/profile';
import {
  useArchiveNotes,
  useOpenFollowUpsByCustomer,
  type ArchiveNote,
} from '@/state/notes';
import { useLongPress } from '@/lib/useLongPress';
import { compactMoney } from '@/lib/format';
import { assetRevenueTier } from '@/lib/bmfLookups';
import { Modal } from '@/components/Modal';
import { AddCustomerModal } from './ledger/AddCustomerModal';
import { CsvImportModal } from './ledger/CsvImportModal';

type LedgerFilters = {
  tags: string[];
  states: string[];
  contact: 'all' | 'never' | 'contacted';
  openFollowUp: boolean;
};

export function LedgerPage() {
  const { activeCharityId } = useActiveCharity();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<LedgerFilters>({
    tags: [],
    states: [],
    contact: 'all',
    openFollowUp: false,
  });
  const isSuper = useIsSuperAdmin();
  const [pendingDelete, setPendingDelete] = useState<CustomerRow | null>(null);
  // useMutation regenerates the closure on each render, so passing the pending
  // id (or an empty sentinel when nothing is queued) keeps the hook order
  // stable while still targeting the right customer when fired.
  const del = useDeleteCustomer(pendingDelete?.id ?? '');
  const { data: customers, isLoading } = useCustomers(activeCharityId, {
    includeArchived: showArchived,
  });
  const { data: followUpDue } = useOpenFollowUpsByCustomer(activeCharityId);

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await del.mutateAsync();
      setPendingDelete(null);
    } catch {
      // Surface the error in-modal via del.error; keep the modal open so the
      // user can retry or cancel.
    }
  }

  function closeDeleteModal() {
    if (del.isPending) return;
    setPendingDelete(null);
    del.reset();
  }

  // Filter options are built from the loaded set, so only tags/states actually
  // present show up as chips.
  const tagOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of customers ?? []) for (const t of c.tags ?? []) s.add(t);
    return [...s].sort();
  }, [customers]);
  const stateOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of customers ?? []) if (c.state) s.add(c.state);
    return [...s].sort();
  }, [customers]);

  const activeFilterCount =
    filters.tags.length +
    filters.states.length +
    (filters.contact !== 'all' ? 1 : 0) +
    (filters.openFollowUp ? 1 : 0);

  const filtered = useMemo(() => {
    let list = customers ?? [];
    // "Viewing archived" is an archived-only view, not active + archived.
    if (showArchived) list = list.filter((c) => c.archived_at != null);
    if (filters.tags.length) {
      list = list.filter((c) => (c.tags ?? []).some((t) => filters.tags.includes(t)));
    }
    if (filters.states.length) {
      list = list.filter((c) => c.state != null && filters.states.includes(c.state));
    }
    if (filters.contact === 'never') list = list.filter((c) => c.last_contacted_at == null);
    else if (filters.contact === 'contacted') list = list.filter((c) => c.last_contacted_at != null);
    if (filters.openFollowUp) list = list.filter((c) => followUpDue?.has(c.id) ?? false);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => {
        const contactParts: (string | null | undefined)[] = [];
        for (const cc of c.customer_contacts ?? []) {
          contactParts.push(cc.first_name, cc.last_name, cc.email, cc.phone, cc.note);
        }
        const haystack = [c.display_name, c.website, ...(c.tags ?? []), ...contactParts]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    return list;
  }, [customers, search, filters, followUpDue, showArchived]);

  function toggleArr(key: 'tags' | 'states', value: string) {
    setFilters((f) => {
      const has = f[key].includes(value);
      return { ...f, [key]: has ? f[key].filter((x) => x !== value) : [...f[key], value] };
    });
  }
  function clearFilters() {
    setFilters({ tags: [], states: [], contact: 'all', openFollowUp: false });
  }

  // Archived customers carry an "archive note" — the comment left when they were
  // archived. Fetch those for the archived view so each row can show it below.
  const archived = useMemo(
    () =>
      showArchived
        ? (customers ?? [])
            .filter((c) => c.archived_at != null)
            .map((c) => ({ id: c.id, archived_at: c.archived_at }))
        : [],
    [customers, showArchived],
  );
  const { data: archiveNotes } = useArchiveNotes(activeCharityId, archived);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 6,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-ink-50/90 dark:bg-ink-950/90 backdrop-blur px-4 pt-4 pb-2 border-b border-ink-100 dark:border-ink-800">
        <div className="mx-auto max-w-3xl flex items-center gap-2">
          <input
            type="search"
            inputMode="search"
            placeholder="Search by name, email, phone..."
            className="field flex-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            disabled={!activeCharityId}
            className={[
              'btn shrink-0 px-3 py-3 text-sm',
              activeFilterCount > 0 || showFilters
                ? 'bg-accent/10 text-accent'
                : 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
            ].join(' ')}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>
        {showFilters && (
          <div className="mx-auto mt-2 max-w-3xl space-y-3 rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
            {tagOptions.length > 0 && (
              <FilterGroup label="Tags">
                <div className="flex flex-wrap gap-1">
                  {tagOptions.map((t) => (
                    <Chip key={t} active={filters.tags.includes(t)} onClick={() => toggleArr('tags', t)}>
                      {t}
                    </Chip>
                  ))}
                </div>
              </FilterGroup>
            )}
            {stateOptions.length > 0 && (
              <FilterGroup label="State">
                <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                  {stateOptions.map((s) => (
                    <Chip key={s} active={filters.states.includes(s)} onClick={() => toggleArr('states', s)}>
                      {s}
                    </Chip>
                  ))}
                </div>
              </FilterGroup>
            )}
            <FilterGroup label="Contact">
              <Segmented
                options={[
                  { label: 'All', value: 'all' },
                  { label: 'Never contacted', value: 'never' },
                  { label: 'Contacted', value: 'contacted' },
                ]}
                value={filters.contact}
                onChange={(v) => setFilters((f) => ({ ...f, contact: v as LedgerFilters['contact'] }))}
              />
            </FilterGroup>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.openFollowUp}
                onChange={(e) => setFilters((f) => ({ ...f, openFollowUp: e.target.checked }))}
              />
              Has an open follow-up
            </label>
            {activeFilterCount > 0 && (
              <button type="button" className="text-xs font-medium text-accent" onClick={clearFilters}>
                Clear all filters
              </button>
            )}
          </div>
        )}
        <div className="mx-auto max-w-3xl flex items-center justify-between mt-2 text-xs text-ink-500 dark:text-ink-400">
          <span>
            {isLoading
              ? 'Loading...'
              : `${filtered.length.toLocaleString()} of ${(showArchived ? archived.length : customers?.length ?? 0).toLocaleString()}`}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              disabled={!activeCharityId}
              aria-pressed={showArchived}
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                showArchived
                  ? 'bg-accent text-white shadow-sm'
                  : 'border border-ink-300 text-ink-700 hover:bg-ink-100 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-800',
                !activeCharityId ? 'cursor-not-allowed opacity-50' : '',
              ].join(' ')}
            >
              <ArchiveIcon className="h-3.5 w-3.5" />
              {showArchived ? `Viewing archived (${archived.length})` : 'Show archived'}
            </button>
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="text-accent hover:underline"
              disabled={!activeCharityId}
            >
              Import CSV
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="text-accent hover:underline"
              disabled={!activeCharityId}
            >
              + Add
            </button>
          </div>
        </div>
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto px-4 py-2">
        {!activeCharityId ? (
          <div className="mx-auto max-w-3xl text-ink-500 dark:text-ink-400 text-sm mt-6">
            Pick or create a charity from the top bar to view its ledger.
          </div>
        ) : filtered.length === 0 && !isLoading ? (
          <div className="mx-auto max-w-3xl text-ink-500 dark:text-ink-400 text-sm mt-6">
            No customers match. Try a different search, or use the Add / Import buttons above.
          </div>
        ) : (
          <div
            className="mx-auto max-w-3xl relative"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const c = filtered[vi.index];
              return (
                <div
                  key={c.id}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <CustomerRowItem
                    customer={c}
                    archiveNote={archiveNotes?.get(c.id)}
                    followUpDueMs={followUpDue?.get(c.id)}
                    archivedView={showArchived}
                    canDelete={isSuper}
                    isDeleting={del.isPending && pendingDelete?.id === c.id}
                    onRequestDelete={setPendingDelete}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAdd && activeCharityId && (
        <AddCustomerModal charityId={activeCharityId} onClose={() => setShowAdd(false)} />
      )}
      {showImport && activeCharityId && (
        <CsvImportModal charityId={activeCharityId} onClose={() => setShowImport(false)} />
      )}
      {pendingDelete && (
        <Modal title="Permanently delete customer" onClose={closeDeleteModal}>
          <div className="space-y-3">
            <p className="text-sm text-ink-700 dark:text-ink-200">
              Permanently delete{' '}
              <span className="font-semibold">{displayName(pendingDelete)}</span>? This cannot be
              undone. All notes, follow-ups, and donations for this customer will also be deleted.
            </p>
            {del.error && (
              <p className="text-red-600 text-sm">{(del.error as Error).message}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                className="btn-ghost flex-1"
                onClick={closeDeleteModal}
                disabled={del.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn flex-1 bg-red-600 text-white hover:bg-red-700 disabled:bg-ink-200 disabled:text-ink-500 disabled:cursor-not-allowed dark:disabled:bg-ink-800"
                onClick={() => void confirmDelete()}
                disabled={del.isPending}
              >
                {del.isPending ? 'Deleting...' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CustomerRowItem({
  customer,
  archiveNote,
  followUpDueMs,
  archivedView,
  canDelete,
  isDeleting,
  onRequestDelete,
}: {
  customer: CustomerRow;
  archiveNote?: ArchiveNote;
  followUpDueMs?: number;
  archivedView?: boolean;
  canDelete: boolean;
  isDeleting: boolean;
  onRequestDelete: (customer: CustomerRow) => void;
}) {
  const isArchived = customer.archived_at != null;
  const primary = primaryContact(customer);
  const tier = assetRevenueTier(customer.filing_revenue, customer.filing_assets);
  const due = followUpDueMs != null ? dueInfo(followUpDueMs) : null;

  const longPress = useLongPress({
    enabled: canDelete && !isDeleting,
    onLongPress: () => onRequestDelete(customer),
  });

  return (
    <div
      className={[
        'border-b border-ink-100 dark:border-ink-800',
        isDeleting ? 'opacity-40 pointer-events-none' : '',
      ].join(' ')}
    >
      <div
        {...longPress}
        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        className={[
          'flex items-center justify-between gap-3 py-3',
          isArchived && !archivedView ? 'opacity-60' : '',
        ].join(' ')}
      >
        <Link
          to={`/contact/${customer.id}`}
          className="min-w-0 flex-1 active:bg-ink-100/60 dark:active:bg-ink-800/60 -my-3 py-3"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium truncate">{displayName(customer)}</span>
            {isArchived && !archivedView && (
              <span className="shrink-0 text-[10px] uppercase tracking-wide bg-ink-100 dark:bg-ink-800 text-ink-500 dark:text-ink-400 px-2 py-0.5 rounded-full">
                Archived
              </span>
            )}
          </div>
          <div className="text-xs text-ink-500 dark:text-ink-400 truncate">
            {[primary?.email, primary?.phone].filter(Boolean).join(' - ')}
          </div>
        </Link>
        <div className="shrink-0 text-right leading-tight">
          <div className="text-sm font-semibold tabular-nums">
            {customer.filing_revenue != null ? compactMoney(customer.filing_revenue) : '—'}
          </div>
          {tier && <div className={`text-[10px] font-medium ${tier.textClass}`}>{tier.caption}</div>}
          {due ? (
            <div className={`text-[11px] font-medium ${due.cls}`}>{due.label}</div>
          ) : (
            <div className="text-[11px] text-ink-400 dark:text-ink-500">
              {lastContactLabel(customer.last_contacted_at)}
            </div>
          )}
        </div>
      </div>
      {isArchived && archiveNote && (
        <div className="mb-3 rounded-md bg-ink-100/70 px-2.5 py-1.5 text-xs text-ink-600 dark:bg-ink-800/50 dark:text-ink-300">
          <span className="font-medium text-ink-500 dark:text-ink-400">
            Archive note
            {archiveNote.authorEmail ? ` · ${archiveNote.authorEmail.split('@')[0]}` : ''}:
          </span>{' '}
          <span className="whitespace-pre-wrap break-words">{archiveNote.body}</span>
        </div>
      )}
    </div>
  );
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-500 dark:text-ink-400">{label}</div>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full px-2.5 py-1 text-xs',
        active
          ? 'bg-accent text-white'
          : 'bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={[
            'rounded-lg px-2.5 py-1 text-xs',
            value === o.value
              ? 'bg-accent text-white'
              : 'bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Relative "last contacted" label, e.g. "Never" / "Today" / "5d ago" / "3w ago".
function lastContactLabel(iso: string | null): string {
  if (!iso) return 'Never';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return 'Today';
  if (d < 7) return `${d}d ago`;
  if (d < 31) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

// Earliest open follow-up due, colored by urgency.
function dueInfo(dueMs: number): { label: string; cls: string } {
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const days = Math.round((dueMs - startToday.getTime()) / 86_400_000);
  if (days < 0) return { label: 'Overdue', cls: 'text-red-600 dark:text-red-400' };
  if (days === 0) return { label: 'Due today', cls: 'text-amber-600 dark:text-amber-400' };
  if (days < 7) return { label: `Due ${days}d`, cls: 'text-amber-600 dark:text-amber-400' };
  if (days < 31) return { label: `Due ${Math.floor(days / 7)}w`, cls: 'text-accent' };
  return { label: `Due ${Math.floor(days / 30)}mo`, cls: 'text-ink-500 dark:text-ink-400' };
}
