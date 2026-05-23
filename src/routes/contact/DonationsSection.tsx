import { useState } from 'react';
import {
  formatCents,
  useDeleteDonation,
  useDonations,
  useReceiptUrl,
  type DonationRow,
} from '@/state/donations';
import { DonationModal } from './DonationModal';
import type { CustomerRow } from '@/state/customers';

export function DonationsSection({ customer }: { customer: CustomerRow }) {
  const donations = useDonations(customer.id);
  const [editing, setEditing] = useState<DonationRow | null>(null);
  const delMut = useDeleteDonation();
  const signed = useReceiptUrl();

  const rows = donations.data ?? [];
  if (donations.isLoading) {
    return (
      <section className="card">
        <h2 className="font-semibold">Donations</h2>
        <p className="text-ink-400 dark:text-ink-500 text-sm mt-2">Loading...</p>
      </section>
    );
  }
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, r) => sum + r.amount_cents, 0);

  async function openReceipt(path: string) {
    try {
      const url = await signed.mutateAsync(path);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Donations</h2>
        <span className="text-sm text-ink-500 dark:text-ink-400">{formatCents(total)} total</span>
      </div>
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">
        {rows.map((d) => (
          <li key={d.id} className="py-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium">{formatCents(d.amount_cents, d.currency)}</div>
              <div className="text-xs text-ink-500 dark:text-ink-400 truncate">
                {d.received_date} - {d.method}
                {d.receipt_number && ` - #${d.receipt_number}`}
                {d.edited_at && ' - edited'}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {d.receipt_storage_path && (
                <button
                  type="button"
                  className="text-xs text-accent"
                  onClick={() => openReceipt(d.receipt_storage_path!)}
                  disabled={signed.isPending}
                >
                  PDF
                </button>
              )}
              <button type="button" className="text-xs text-ink-600 dark:text-ink-300" onClick={() => setEditing(d)}>
                Edit
              </button>
              <button
                type="button"
                className="text-xs text-red-600"
                onClick={() => {
                  if (confirm('Delete this donation? The audit log keeps a record.')) delMut.mutate(d.id);
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <DonationModal
          customer={customer}
          existing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
