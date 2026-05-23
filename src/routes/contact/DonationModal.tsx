import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ledger/AddCustomerModal';
import { edgeFunctions } from '@/lib/edgeFunctions';
import type { CustomerRow } from '@/state/customers';
import { displayName } from '@/state/customers';
import type { DonationRow } from '@/state/donations';

const METHODS: { value: 'check' | 'cash' | 'card' | 'ach' | 'stock' | 'other'; label: string }[] = [
  { value: 'check', label: 'Check' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'ach', label: 'ACH / wire' },
  { value: 'stock', label: 'Stock' },
  { value: 'other', label: 'Other' },
];

export function DonationModal({
  customer,
  existing,
  onClose,
}: {
  customer: CustomerRow;
  existing?: DonationRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(existing ? (existing.amount_cents / 100).toFixed(2) : '');
  const [method, setMethod] = useState<typeof METHODS[number]['value']>(existing?.method ?? 'check');
  const [receivedDate, setReceivedDate] = useState(
    existing?.received_date ?? new Date().toISOString().slice(0, 10),
  );
  const [reference, setReference] = useState(existing?.reference ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const send = useMutation({
    mutationFn: async () => {
      const amountCents = Math.round(parseFloat(amount) * 100);
      if (!amountCents || Number.isNaN(amountCents)) throw new Error('Enter a valid amount');
      return edgeFunctions.sendReceipt({
        donation_id: existing?.id,
        charity_id: customer.charity_id,
        customer_id: customer.id,
        amount_cents: amountCents,
        method,
        received_date: receivedDate,
        reference: reference || undefined,
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['donations', customer.id] });
      qc.invalidateQueries({ queryKey: ['notes', customer.id] });
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      onClose();
    },
  });

  const title = existing
    ? `Edit donation #${existing.receipt_number ?? ''}`
    : `Donation from ${displayName(customer)}`;

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Amount (USD)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              className="field"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Date received</label>
            <input
              type="date"
              className="field"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">Method</label>
          <select className="field" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Reference (check # / wire id)</label>
          <input className="field" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="field" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {send.error && <p className="text-red-600 text-sm">{(send.error as Error).message}</p>}
        <p className="text-xs text-ink-500">
          {existing
            ? 'Saving updates the donation, allocates a new receipt #, and re-sends the PDF.'
            : 'Saving issues receipt #YYMMDDHHMM and emails the donor a PDF acknowledgment via Resend.'}
        </p>
        <div className="flex gap-2 pt-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose} disabled={send.isPending}>
            Cancel
          </button>
          <button type="button" className="btn-primary flex-1" disabled={!amount || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? 'Sending...' : existing ? 'Save & resend' : 'Save & send receipt'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
