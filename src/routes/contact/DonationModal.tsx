import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { supabase } from '@/lib/supabase';
import { edgeFunctions } from '@/lib/edgeFunctions';
import { isGateOpen } from '@/lib/donationGate';
import {
  formishFromCharity,
  renderAchPreview,
  renderCheckPreview,
} from '@/lib/donationEmailPreview';
import {
  displayName,
  primaryContact,
  sortedContacts,
  type CustomerRow,
} from '@/state/customers';
import type { DonationRow } from '@/state/donations';
import type { Database } from '@/lib/database.types';

type CharityRow = Database['public']['Tables']['charities']['Row'];
type Method = 'check' | 'cash' | 'card' | 'ach' | 'stock' | 'other';
type Intent = 'record' | 'help';

const METHODS: { value: Method; label: string }[] = [
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
  // Editing an existing donation always means "record"; the help flows are
  // strictly outbound from the charity to the donor and have no edit path.
  const [intent, setIntent] = useState<Intent>('record');
  const [method, setMethod] = useState<Method | null>(existing?.method ?? null);

  const charity = useQuery({
    queryKey: ['charity-payment-config', customer.charity_id],
    queryFn: async (): Promise<CharityRow | null> => {
      const { data, error } = await supabase
        .from('charities')
        .select('*')
        .eq('id', customer.charity_id)
        .maybeSingle();
      if (error) throw error;
      return data as CharityRow | null;
    },
  });

  const helpAvailable = useMemo(() => buildHelpAvailability(charity.data), [charity.data]);

  const title = existing
    ? `Edit donation #${existing.receipt_number ?? ''}`
    : `Donation from ${displayName(customer)}`;

  if (method === null) {
    return (
      <Modal title={title} onClose={onClose}>
        <div className="space-y-4">
          {!existing && (
            <IntentToggle intent={intent} onChange={setIntent} />
          )}
          <p className="text-sm text-ink-600 dark:text-ink-300">
            {intent === 'record'
              ? 'How was the donation made?'
              : 'How would you like to help the donor send a gift?'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => {
              const disabled = intent === 'help' && !helpAvailable[m.value].enabled;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => !disabled && setMethod(m.value)}
                  disabled={disabled}
                  className="btn-ghost py-4 text-base flex flex-col items-center gap-1"
                >
                  <span>{m.label}</span>
                  {intent === 'help' && (
                    <span className="text-[11px] font-normal text-ink-500 dark:text-ink-400">
                      {helpAvailable[m.value].hint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="pt-2">
            <button type="button" className="btn-ghost w-full" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // Stage 2: route to the right form by (intent, method).
  const back = () => setMethod(null);

  if (intent === 'help' && (method === 'check' || method === 'ach')) {
    return (
      <SendInstructionsForm
        customer={customer}
        charity={charity.data}
        method={method}
        title={title}
        onBack={back}
        onClose={onClose}
      />
    );
  }

  if (intent === 'help' && method === 'card') {
    return (
      <CardHelpForm
        customer={customer}
        charity={charity.data}
        title={title}
        onBack={back}
        onClose={onClose}
      />
    );
  }

  // record-* (and help-cash, which intentionally re-uses the record path with
  // received_date=today so the rep produces an IRS-ready receipt on the spot).
  return (
    <RecordForm
      customer={customer}
      method={method}
      existing={existing}
      title={title}
      onBack={existing ? undefined : back}
      onClose={onClose}
    />
  );
}

// -----------------------------------------------------------------------------
// Stage 1 helpers
// -----------------------------------------------------------------------------

function IntentToggle({ intent, onChange }: { intent: Intent; onChange: (i: Intent) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-ink-100 dark:bg-ink-800 text-sm">
      <button
        type="button"
        onClick={() => onChange('record')}
        className={[
          'rounded-lg py-2 font-medium transition-colors',
          intent === 'record'
            ? 'bg-white dark:bg-ink-900 text-ink-900 dark:text-ink-50 shadow-sm'
            : 'text-ink-500 dark:text-ink-400',
        ].join(' ')}
      >
        Record received
      </button>
      <button
        type="button"
        onClick={() => onChange('help')}
        className={[
          'rounded-lg py-2 font-medium transition-colors',
          intent === 'help'
            ? 'bg-white dark:bg-ink-900 text-ink-900 dark:text-ink-50 shadow-sm'
            : 'text-ink-500 dark:text-ink-400',
        ].join(' ')}
      >
        Help donor send
      </button>
    </div>
  );
}

interface MethodAvailability {
  enabled: boolean;
  hint: string;
}

function buildHelpAvailability(charity: CharityRow | null | undefined): Record<Method, MethodAvailability> {
  // Gate predicates live in src/lib/donationGate.ts so the admin
  // DonationInstructionsCard banner can never disagree with what the
  // contact page actually enables.
  const checkConfigured = isGateOpen('check', charity);
  const achConfigured = isGateOpen('ach', charity);
  const cardConfigured = isGateOpen('card', charity);
  return {
    check: {
      enabled: checkConfigured,
      hint: checkConfigured ? 'Email instructions' : 'Set up in Admin',
    },
    cash: {
      enabled: true,
      hint: 'Record + email receipt',
    },
    card: {
      enabled: cardConfigured,
      hint: cardConfigured ? 'Stripe invoice or recurring' : 'Connect Stripe',
    },
    ach: {
      enabled: achConfigured,
      hint: achConfigured ? 'Email bank details' : 'Set up in Admin',
    },
    stock: { enabled: false, hint: 'Coming soon' },
    // "Other" mirrors Cash: anything in-kind whose fair market value the rep
    // wants to record on the spot (gift cards, goods, services, etc.). Routes
    // to the same RecordForm so the donor walks away with an IRS-ready PDF.
    other: { enabled: true, hint: 'Record fair market value' },
  };
}

// -----------------------------------------------------------------------------
// Record form (existing flow, lifted into its own component so the modal can
// route between sub-flows). Behaviour and copy match the prior implementation
// 1:1; the only addition is the optional `onBack` prop and date pre-fill for
// the help-cash entry point.
// -----------------------------------------------------------------------------

function RecordForm({
  customer,
  method,
  existing,
  title,
  onBack,
  onClose,
}: {
  customer: CustomerRow;
  method: Method;
  existing?: DonationRow;
  title: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(existing ? (existing.amount_cents / 100).toFixed(2) : '');
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

  const methodLabel = METHODS.find((m) => m.value === method)?.label ?? method;

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-ink-100 dark:border-ink-800 pb-3">
          <div>
            <div className="text-xs text-ink-500 dark:text-ink-400">Method</div>
            <div className="text-sm font-medium">{methodLabel}</div>
          </div>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="text-accent text-sm"
              disabled={send.isPending}
            >
              Change
            </button>
          )}
        </div>
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
          <label className="label">Reference (check # / wire id)</label>
          <input className="field" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="field" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {send.error && <p className="text-red-600 text-sm">{(send.error as Error).message}</p>}
        <p className="text-xs text-ink-500 dark:text-ink-400">
          {existing
            ? 'Saving updates the donation, allocates a new receipt #, and re-sends the PDF.'
            : 'Saving issues receipt #YYMMDDHHMM and emails the donor a PDF acknowledgment via Resend.'}
        </p>
        <div className="flex gap-2 pt-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose} disabled={send.isPending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={!amount || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? 'Sending...' : existing ? 'Save & resend' : 'Save & send receipt'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Help: Check / ACH instructions email
// -----------------------------------------------------------------------------

function SendInstructionsForm({
  customer,
  charity,
  method,
  title,
  onBack,
  onClose,
}: {
  customer: CustomerRow;
  charity: CharityRow | null | undefined;
  method: 'check' | 'ach';
  title: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const emailContacts = useMemo(
    () => sortedContacts(customer).filter((c) => !!c.email?.trim()),
    [customer],
  );
  const primary = primaryContact(customer);
  const [contactId, setContactId] = useState<string>(() => {
    if (primary?.email) return primary.id;
    return emailContacts[0]?.id ?? '';
  });
  const chosen = emailContacts.find((c) => c.id === contactId) ?? primary ?? emailContacts[0] ?? null;
  const [repMessage, setRepMessage] = useState('');

  // Live email preview. Mirrors what supabase/functions/send-payment-instructions
  // will render at send time. The shared helpers in @/lib/donationEmailPreview
  // are byte-faithful with the server, so what the rep sees here is what the
  // donor receives -- including the live personal note as they type.
  const preview = useMemo(() => {
    if (!charity) return null;
    const ctx = {
      contactFirstName: chosen?.first_name ?? null,
      contactLastName: chosen?.last_name ?? null,
      customerDisplayName: customer.display_name ?? null,
      repMessageMd: repMessage,
    };
    const formish = formishFromCharity(charity);
    return method === 'check'
      ? renderCheckPreview(charity, formish, ctx)
      : renderAchPreview(charity, formish, ctx);
  }, [charity, chosen?.first_name, chosen?.last_name, customer.display_name, repMessage, method]);

  const send = useMutation({
    mutationFn: async () =>
      edgeFunctions.sendPaymentInstructions({
        charity_id: customer.charity_id,
        customer_id: customer.id,
        contact_id: chosen?.id,
        method,
        rep_message_md: repMessage.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', customer.id] });
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      onClose();
    },
  });

  const methodLabel = method === 'check' ? 'Check instructions' : 'ACH / wire details';

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-ink-100 dark:border-ink-800 pb-3">
          <div>
            <div className="text-xs text-ink-500 dark:text-ink-400">Send</div>
            <div className="text-sm font-medium">{methodLabel}</div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="text-accent text-sm"
            disabled={send.isPending}
          >
            Change
          </button>
        </div>

        <div>
          <label className="label">To</label>
          {emailContacts.length > 1 ? (
            <select
              className="field"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              {emailContacts.map((c) => {
                const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
                return (
                  <option key={c.id} value={c.id}>
                    {name ? `${name} <${c.email}>` : c.email}
                    {c.is_primary ? ' (primary)' : ''}
                  </option>
                );
              })}
            </select>
          ) : (
            <input className="field" value={chosen?.email ?? ''} disabled />
          )}
        </div>

        <div>
          <label className="label">Personal note (optional, prepended above the canonical block)</label>
          <textarea
            className="field"
            rows={4}
            value={repMessage}
            onChange={(e) => setRepMessage(e.target.value)}
            placeholder={
              method === 'check'
                ? 'e.g. Thanks again for our chat -- here is everything you need to send a check.'
                : 'e.g. As discussed, here are the bank details for an ACH or wire.'
            }
          />
        </div>

        {preview && (
          <div>
            <div className="label">Preview</div>
            <EmailPreview subject={preview.subject} html={preview.html} />
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
              This is exactly what {chosen?.first_name?.trim() || 'the donor'} will receive. The
              {method === 'check' ? ' payable-to and mail-to address' : ' bank routing and account details'} come from
              this charity's Donation instructions in Admin. Sent via Resend; logged to the donor's History.
            </p>
          </div>
        )}

        {!preview && (
          <p className="text-xs text-ink-500 dark:text-ink-400">
            The {method === 'check' ? 'payable-to and mail-to address' : 'bank routing and account details'} are pulled
            from this charity's Donation instructions in Admin and are appended automatically. Sent via Resend; logged to
            the donor's History.
          </p>
        )}

        {!chosen?.email && (
          <p className="text-amber-600 text-sm">
            This contact has no email on file. Pick another contact or add an email address.
          </p>
        )}
        {send.error && <p className="text-red-600 text-sm">{(send.error as Error).message}</p>}

        <div className="flex gap-2 pt-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose} disabled={send.isPending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={!chosen?.email || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? 'Sending...' : 'Send instructions'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Help: Card. Hosted Stripe Invoice (one-time) or Subscription Checkout
// (recurring monthly). Virtual Terminal (rep types card) is a Phase 2 feature.
// -----------------------------------------------------------------------------

function CardHelpForm({
  customer,
  charity,
  title,
  onBack,
  onClose,
}: {
  customer: CustomerRow;
  charity: CharityRow | null | undefined;
  title: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const recurringEnabled = charity?.card_recurring_enabled === true;
  const [mode, setMode] = useState<'invoice' | 'subscription'>('invoice');
  const defaultDollars = charity?.card_default_amount_cents
    ? (charity.card_default_amount_cents / 100).toFixed(0)
    : '';
  const [amount, setAmount] = useState(defaultDollars);
  const [sentInvoice, setSentInvoice] = useState<{ url: string | null } | null>(null);

  // Pre-fill the amount whenever the charity config arrives after the form
  // mounts. The user-typed value wins once they edit it.
  useEffect(() => {
    if (defaultDollars && !amount) setAmount(defaultDollars);
  }, [defaultDollars, amount]);

  // When the charity has configured a card email template, we route invoice
  // sends through send-card-instructions so donors get our branded email
  // (with admin-controlled subject + body + data block). Otherwise we keep
  // the legacy path where Stripe sends its own hosted-invoice email -- this
  // keeps the rollout opt-in and avoids surprising existing charities.
  const cardTemplateConfigured =
    !!charity?.card_subject_template?.trim() ||
    !!charity?.card_body_template_md?.trim() ||
    !!charity?.card_data_block;

  const submit = useMutation({
    mutationFn: async () => {
      const amountCents = Math.round(parseFloat(amount) * 100);
      if (!amountCents || Number.isNaN(amountCents) || amountCents < 100) {
        throw new Error('Enter an amount of at least $1.00');
      }
      if (mode === 'invoice') {
        if (cardTemplateConfigured) {
          return edgeFunctions.sendCardInstructions({
            charity_id: customer.charity_id,
            customer_id: customer.id,
            amount_cents: amountCents,
            mode: 'invoice',
          });
        }
        return edgeFunctions.stripeInvoice({
          charity_id: customer.charity_id,
          customer_id: customer.id,
          amount_cents: amountCents,
          send: true,
        });
      }
      return edgeFunctions.stripeSubscriptionCheckout({
        charity_id: customer.charity_id,
        customer_id: customer.id,
        amount_cents: amountCents,
        interval: 'month',
      });
    },
    onSuccess: (res) => {
      if (mode === 'invoice') {
        // Both paths return a payable URL on different field names. The
        // legacy Stripe-only path returns `{ url }`; the new templated
        // path returns `{ donate_url }`.
        const url =
          (res as { url?: string | null; donate_url?: string }).donate_url ??
          (res as { url?: string | null }).url ??
          null;
        setSentInvoice({ url });
      } else {
        const { url } = res as { url: string };
        if (url) window.open(url, '_blank', 'noopener');
        onClose();
      }
    },
  });

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-ink-100 dark:border-ink-800 pb-3">
          <div>
            <div className="text-xs text-ink-500 dark:text-ink-400">Card</div>
            <div className="text-sm font-medium">
              {mode === 'invoice' ? 'Stripe invoice (one-time)' : 'Recurring (monthly)'}
            </div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="text-accent text-sm"
            disabled={submit.isPending}
          >
            Change
          </button>
        </div>

        {sentInvoice ? (
          <div className="space-y-3">
            <p className="text-sm">
              {cardTemplateConfigured
                ? 'A CharityTooling-branded email with the secure payment link has been sent to the donor.'
                : 'Stripe has emailed the donor a hosted payment link. They can pay by card directly there.'}
            </p>
            {sentInvoice.url && (
              <a
                href={sentInvoice.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost w-full"
              >
                Open hosted invoice
              </a>
            )}
            <button type="button" className="btn-primary w-full" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            {recurringEnabled && (
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-ink-100 dark:bg-ink-800 text-sm">
                <button
                  type="button"
                  onClick={() => setMode('invoice')}
                  className={[
                    'rounded-lg py-2 font-medium transition-colors',
                    mode === 'invoice'
                      ? 'bg-white dark:bg-ink-900 text-ink-900 dark:text-ink-50 shadow-sm'
                      : 'text-ink-500 dark:text-ink-400',
                  ].join(' ')}
                >
                  One-time
                </button>
                <button
                  type="button"
                  onClick={() => setMode('subscription')}
                  className={[
                    'rounded-lg py-2 font-medium transition-colors',
                    mode === 'subscription'
                      ? 'bg-white dark:bg-ink-900 text-ink-900 dark:text-ink-50 shadow-sm'
                      : 'text-ink-500 dark:text-ink-400',
                  ].join(' ')}
                >
                  Recurring monthly
                </button>
              </div>
            )}

            <div>
              <label className="label">Amount (USD)</label>
              <input
                type="number"
                inputMode="decimal"
                step="1"
                min="1"
                className="field"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>

            <p className="text-xs text-ink-500 dark:text-ink-400">
              {mode === 'invoice'
                ? cardTemplateConfigured
                  ? "We'll email the donor a CharityTooling-branded message with the secure Stripe payment link. Paid amounts and receipts will appear under Donations automatically once the donor pays."
                  : 'Stripe will email the donor a hosted invoice link. Paid amounts and receipts will appear under Donations automatically once the donor pays.'
                : 'Opens Stripe Checkout in a new tab so the donor can confirm their card. The subscription bills monthly until cancelled.'}
            </p>

            {submit.error && <p className="text-red-600 text-sm">{(submit.error as Error).message}</p>}

            <div className="flex gap-2 pt-2">
              <button type="button" className="btn-ghost flex-1" onClick={onClose} disabled={submit.isPending}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={!amount || submit.isPending}
                onClick={() => submit.mutate()}
              >
                {submit.isPending
                  ? 'Working...'
                  : mode === 'invoice'
                  ? 'Send invoice'
                  : 'Open checkout'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// EmailPreview: live-updating subject + HTML body panel used inside the
// "Help donor send" sub-flow. The body container scrolls independently and
// uses overscroll-contain so swiping inside the preview doesn't bleed
// through to the modal scroll lock that the parent Modal applies.
// -----------------------------------------------------------------------------

function EmailPreview({ subject, html }: { subject: string; html: string }) {
  return (
    <div className="rounded-xl border border-ink-100 dark:border-ink-800 overflow-hidden">
      <div className="px-3 py-2 border-b border-ink-100 dark:border-ink-800 bg-ink-50 dark:bg-ink-900">
        <div className="text-xs text-ink-500 dark:text-ink-400">Subject</div>
        <div className="text-sm font-medium truncate">{subject}</div>
      </div>
      <div
        className="p-3 max-h-72 overflow-y-auto overscroll-contain prose prose-sm dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
