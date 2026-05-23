import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useActiveCharity } from '@/state/activeCharity';
import { displayName, useCustomers, type CustomerRow } from '@/state/customers';
import { AddCustomerModal } from './ledger/AddCustomerModal';
import { CsvImportModal } from './ledger/CsvImportModal';

export function LedgerPage() {
  const { activeCharityId } = useActiveCharity();
  const { data: customers, isLoading } = useCustomers(activeCharityId);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const filtered = useMemo(() => {
    if (!customers) return [];
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const haystack = [
        c.display_name,
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        c.website,
        ...(c.tags ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [customers, search]);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 6,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-ink-50/90 backdrop-blur px-4 pt-4 pb-2 border-b border-ink-100">
        <div className="mx-auto max-w-3xl flex items-center gap-2">
          <input
            type="search"
            inputMode="search"
            placeholder="Search by name, email, phone..."
            className="field flex-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="mx-auto max-w-3xl flex items-center justify-between mt-2 text-xs text-ink-500">
          <span>
            {isLoading
              ? 'Loading...'
              : `${filtered.length.toLocaleString()} of ${(customers?.length ?? 0).toLocaleString()}`}
          </span>
          <div className="flex gap-3">
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
          <div className="mx-auto max-w-3xl text-ink-500 text-sm mt-6">
            Pick or create a charity from the top bar to view its ledger.
          </div>
        ) : filtered.length === 0 && !isLoading ? (
          <div className="mx-auto max-w-3xl text-ink-500 text-sm mt-6">
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
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <CustomerRowItem customer={c} />
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
    </div>
  );
}

function CustomerRowItem({ customer }: { customer: CustomerRow }) {
  return (
    <Link
      to={`/contact/${customer.id}`}
      className="block py-3 border-b border-ink-100 active:bg-ink-100/60"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{displayName(customer)}</div>
          <div className="text-xs text-ink-500 truncate">
            {[customer.email, customer.phone].filter(Boolean).join(' - ')}
          </div>
        </div>
        <div className="text-xs text-ink-400 shrink-0">
          {customer.completeness_score}%
        </div>
      </div>
    </Link>
  );
}
