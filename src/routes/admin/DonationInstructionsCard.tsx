import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { supabase } from '@/lib/supabase';
import { edgeFunctions } from '@/lib/edgeFunctions';
import type { Database } from '@/lib/database.types';

type CharityRow = Database['public']['Tables']['charities']['Row'];
type Tab = 'check' | 'cash' | 'card' | 'ach';

const TABS: { id: Tab; label: string }[] = [
  { id: 'check', label: 'Check' },
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'ach', label: 'ACH / Wire' },
];

// All fields the form may write. Listed once here so we can build the
// react-hook-form defaults without typing every property explicitly.
type FormValues = Pick<
  CharityRow,
  | 'check_payable_to'
  | 'check_mail_to_line1'
  | 'check_mail_to_line2'
  | 'check_mail_to_city'
  | 'check_mail_to_state'
  | 'check_mail_to_postal_code'
  | 'check_memo_default'
  | 'check_instructions_md'
  | 'ach_bank_name'
  | 'ach_account_name'
  | 'ach_account_type'
  | 'ach_routing_number'
  | 'ach_account_number'
  | 'wire_swift_bic'
  | 'wire_intermediary_md'
  | 'ach_instructions_md'
  | 'card_default_amount_cents'
  | 'card_recurring_enabled'
>;

export function DonationInstructionsCard({ charity }: { charity: CharityRow }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('check');
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);

  const defaults: FormValues = useMemo(
    () => ({
      check_payable_to: charity.check_payable_to,
      check_mail_to_line1: charity.check_mail_to_line1,
      check_mail_to_line2: charity.check_mail_to_line2,
      check_mail_to_city: charity.check_mail_to_city,
      check_mail_to_state: charity.check_mail_to_state,
      check_mail_to_postal_code: charity.check_mail_to_postal_code,
      check_memo_default: charity.check_memo_default,
      check_instructions_md: charity.check_instructions_md,
      ach_bank_name: charity.ach_bank_name,
      ach_account_name: charity.ach_account_name,
      ach_account_type: charity.ach_account_type,
      ach_routing_number: charity.ach_routing_number,
      ach_account_number: charity.ach_account_number,
      wire_swift_bic: charity.wire_swift_bic,
      wire_intermediary_md: charity.wire_intermediary_md,
      ach_instructions_md: charity.ach_instructions_md,
      card_default_amount_cents: charity.card_default_amount_cents,
      card_recurring_enabled: charity.card_recurring_enabled,
    }),
    [charity],
  );

  const { register, handleSubmit, formState, getValues, watch, reset } = useForm<FormValues>({
    defaultValues: defaults as FormValues,
  });

  const update = useMutation({
    mutationFn: async (values: FormValues) => {
      // Normalise empty strings -> null so Postgres distinguishes "unset"
      // from "blank string" the same way the existing SettingsCard does.
      const cleaned: Partial<CharityRow> = {};
      for (const [k, v] of Object.entries(values) as Array<[keyof FormValues, unknown]>) {
        if (typeof v === 'string') {
          (cleaned as Record<string, unknown>)[k] = v.trim() === '' ? null : v.trim();
        } else if (typeof v === 'number') {
          (cleaned as Record<string, unknown>)[k] = Number.isFinite(v) ? v : null;
        } else {
          (cleaned as Record<string, unknown>)[k] = v;
        }
      }
      const { error } = await supabase
        .from('charities')
        .update(cleaned)
        .eq('id', charity.id);
      if (error) throw error;
    },
    onSuccess: (_data, values) => {
      qc.invalidateQueries({ queryKey: ['charity', charity.id] });
      reset(values);
    },
  });

  function onPreview() {
    const v = getValues();
    if (tab === 'check') {
      setPreview({
        subject: `How to donate by check to ${charity.name}`,
        html: renderCheckPreview(charity, v),
      });
    } else if (tab === 'ach') {
      setPreview({
        subject: `How to donate by ACH or wire to ${charity.name}`,
        html: renderAchPreview(charity, v),
      });
    }
  }

  return (
    <form
      className="card space-y-4"
      onSubmit={handleSubmit((v) => update.mutateAsync(v))}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Donation instructions</h2>
        {formState.isDirty && <span className="text-xs text-amber-600">unsaved</span>}
      </div>
      <p className="text-sm text-ink-500 dark:text-ink-400">
        Configure how donors are guided to send money. The Donation modal on each contact page reuses these details.
      </p>

      <div className="flex gap-1 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setPreview(null);
            }}
            className={[
              'px-3 py-1.5 text-sm rounded-full whitespace-nowrap',
              t.id === tab
                ? 'bg-accent text-white'
                : 'bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'check' && (
        <div className="space-y-3">
          <div>
            <label className="label">Make checks payable to</label>
            <input className="field" placeholder={charity.name} {...register('check_payable_to')} />
          </div>
          <div>
            <label className="label">Mail to (street / PO Box)</label>
            <input className="field" {...register('check_mail_to_line1')} />
          </div>
          <div>
            <label className="label">Mail to (line 2)</label>
            <input className="field" {...register('check_mail_to_line2')} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">City</label>
              <input className="field" {...register('check_mail_to_city')} />
            </div>
            <div>
              <label className="label">State</label>
              <input className="field" {...register('check_mail_to_state')} />
            </div>
            <div>
              <label className="label">ZIP</label>
              <input className="field" {...register('check_mail_to_postal_code')} />
            </div>
          </div>
          <div>
            <label className="label">Suggested memo line</label>
            <input className="field" {...register('check_memo_default')} />
          </div>
          <div>
            <label className="label">Intro / instructions (Markdown, optional)</label>
            <textarea className="field font-mono text-xs" rows={4} {...register('check_instructions_md')} />
          </div>
        </div>
      )}

      {tab === 'cash' && (
        <div className="space-y-2 text-sm text-ink-600 dark:text-ink-300">
          <p>
            Cash gifts use the existing <strong>Record received</strong> flow. When a rep
            picks "Help donor send {'->'} Cash" on the contact page, the modal jumps
            straight to the record form pre-filled with today's date so the donor walks
            away with an IRS-ready PDF receipt.
          </p>
          <p>
            No extra configuration is required here. Receipt formatting is controlled by
            the <em>Receipt signatory</em> and <em>Receipt disclaimer</em> fields in the
            Settings card above.
          </p>
        </div>
      )}

      {tab === 'card' && (
        <div className="space-y-3">
          <CardStripeStatus charity={charity} />
          <div>
            <label className="label">Default suggested amount (USD)</label>
            <input
              type="number"
              inputMode="decimal"
              step="1"
              min="0"
              className="field"
              placeholder="(donor picks)"
              {...register('card_default_amount_cents', {
                setValueAs: (v) => {
                  if (v === '' || v == null) return null;
                  const dollars = typeof v === 'number' ? v : parseFloat(String(v));
                  if (!Number.isFinite(dollars)) return null;
                  // Stored as cents; the input is whole dollars to keep the
                  // admin UI tidy. Donations modal handles conversion.
                  return Math.round(dollars * 100);
                },
                valueAsNumber: false,
              })}
              defaultValue={
                charity.card_default_amount_cents != null
                  ? Math.round(charity.card_default_amount_cents / 100)
                  : ''
              }
            />
            <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
              Leave blank to let the donor pick on Stripe's hosted page.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('card_recurring_enabled')} />
            Allow donors to set up a recurring (monthly) gift via Stripe
          </label>
        </div>
      )}

      {tab === 'ach' && (
        <div className="space-y-3">
          <div>
            <label className="label">Bank name</label>
            <input className="field" {...register('ach_bank_name')} />
          </div>
          <div>
            <label className="label">Account holder (name on the account)</label>
            <input className="field" placeholder={charity.name} {...register('ach_account_name')} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Routing (ABA)</label>
              <input className="field" {...register('ach_routing_number')} />
            </div>
            <div>
              <label className="label">Account #</label>
              <input className="field" {...register('ach_account_number')} />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="field" {...register('ach_account_type')}>
                <option value="">(unset)</option>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">SWIFT / BIC (for wires)</label>
            <input className="field" {...register('wire_swift_bic')} />
          </div>
          <div>
            <label className="label">Intermediary / wire instructions (Markdown, optional)</label>
            <textarea className="field font-mono text-xs" rows={3} {...register('wire_intermediary_md')} />
          </div>
          <div>
            <label className="label">Intro / instructions (Markdown, optional)</label>
            <textarea className="field font-mono text-xs" rows={4} {...register('ach_instructions_md')} />
          </div>
        </div>
      )}

      {(tab === 'check' || tab === 'ach') && (
        <div className="flex gap-2 pt-2 border-t border-ink-100 dark:border-ink-800">
          <button type="button" className="btn-ghost flex-1" onClick={onPreview}>
            Preview email
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={!formState.isDirty || formState.isSubmitting}
          >
            {formState.isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {(tab === 'cash' || tab === 'card') && (
        <div className="flex pt-2 border-t border-ink-100 dark:border-ink-800">
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={!formState.isDirty || formState.isSubmitting}
          >
            {formState.isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {update.error && <p className="text-red-600 text-sm">{(update.error as Error).message}</p>}

      {preview && (
        <PreviewModal
          subject={preview.subject}
          html={preview.html}
          onClose={() => setPreview(null)}
        />
      )}

      {/* Touch `watch` so the form re-renders on field edits; we use it to
          recompute the preview body without a separate state mirror. */}
      <input type="hidden" value={JSON.stringify(watch())} readOnly />
    </form>
  );
}

function CardStripeStatus({ charity }: { charity: CharityRow }) {
  const connect = useMutation({
    mutationFn: () => edgeFunctions.stripeConnect({ action: 'start', charity_id: charity.id }),
  });
  const connected = !!charity.stripe_account_id && charity.stripe_charges_enabled;

  return (
    <div className="rounded-xl bg-ink-50 dark:bg-ink-950 border border-ink-100 dark:border-ink-800 p-3 space-y-2">
      <div className="text-sm font-medium">Stripe connection</div>
      {connected ? (
        <p className="text-sm text-ink-700 dark:text-ink-200">
          Connected to <code className="text-xs">{charity.stripe_account_id}</code>. Card donations are live.
        </p>
      ) : charity.stripe_account_id ? (
        <p className="text-sm text-amber-700">
          Stripe is partially connected (<code className="text-xs">{charity.stripe_account_id}</code>) but charges
          are not enabled yet. Finish onboarding in Stripe.
        </p>
      ) : (
        <p className="text-sm text-ink-700 dark:text-ink-200">
          Connect Stripe to let donors pay by card. The charity owns the Stripe account; CharityTooling never holds funds.
        </p>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={connect.isPending}
        onClick={async () => {
          const res = await connect.mutateAsync();
          if (res.url) window.location.href = res.url;
        }}
      >
        {connect.isPending ? 'Loading...' : connected ? 'Re-connect Stripe' : 'Connect Stripe'}
      </button>
      {connect.error && <p className="text-red-600 text-sm">{(connect.error as Error).message}</p>}
    </div>
  );
}

function PreviewModal({ subject, html, onClose }: { subject: string; html: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-ink-900/40 px-3" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-ink-900 p-4 shadow-xl safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Preview</h3>
          <button type="button" onClick={onClose} className="text-ink-500 dark:text-ink-400 text-xl leading-none">
            ×
          </button>
        </div>
        <div className="text-xs text-ink-500 dark:text-ink-400 mb-2">Subject</div>
        <div className="rounded-xl border border-ink-100 dark:border-ink-800 p-3 mb-3">{subject}</div>
        <div className="text-xs text-ink-500 dark:text-ink-400 mb-2">Body</div>
        <div
          className="rounded-xl border border-ink-100 dark:border-ink-800 p-3 prose prose-sm dark:prose-invert"
          // The HTML here is built locally from the admin's own form values
          // and hard-coded templates. No untrusted input is in scope.
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <div className="pt-3 mt-3 border-t border-ink-100 dark:border-ink-800">
          <button type="button" className="btn-ghost w-full" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Preview rendering. Mirrors the server templates in
// supabase/functions/send-payment-instructions/index.ts so admins see exactly
// what donors will receive. Keep the two in sync.
// -----------------------------------------------------------------------------

function renderCheckPreview(charity: CharityRow, v: FormValues): string {
  const payable = v.check_payable_to?.trim() || charity.name;
  const memo = v.check_memo_default?.trim() ?? '';
  const lines = [
    payable,
    v.check_mail_to_line1,
    v.check_mail_to_line2,
    [v.check_mail_to_city, v.check_mail_to_state]
      .filter((x) => !!x)
      .join(', ') + (v.check_mail_to_postal_code ? ` ${v.check_mail_to_postal_code}` : ''),
  ]
    .map((l) => (typeof l === 'string' ? l.trim() : ''))
    .filter((l) => !!l);
  const intro = v.check_instructions_md?.trim()
    ? simpleMarkdownToHtml(v.check_instructions_md.trim())
    : `<p>Thank you for considering a gift to <strong>${escapeHtml(charity.name)}</strong>. Here is how to send a contribution by check:</p>`;
  return `
    ${intro}
    <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
      <tr><td style="color:#64748b;padding-right:12px;vertical-align:top">Payable to</td><td style="font-weight:600">${escapeHtml(payable)}</td></tr>
      <tr><td style="color:#64748b;padding-right:12px;vertical-align:top">Mail to</td><td>${lines.map(escapeHtml).join('<br/>')}</td></tr>
      ${memo ? `<tr><td style="color:#64748b;padding-right:12px;vertical-align:top">Memo</td><td>${escapeHtml(memo)}</td></tr>` : ''}
    </table>
    ${charity.ein ? `<p style="font-size:12px;color:#64748b">EIN: ${escapeHtml(charity.ein)}</p>` : ''}
  `;
}

function renderAchPreview(charity: CharityRow, v: FormValues): string {
  const intro = v.ach_instructions_md?.trim()
    ? simpleMarkdownToHtml(v.ach_instructions_md.trim())
    : `<p>Thank you for considering a gift to <strong>${escapeHtml(charity.name)}</strong>. Here are the bank details for an ACH or wire transfer:</p>`;
  const rows: Array<[string, string | null | undefined]> = [
    ['Bank', v.ach_bank_name],
    ['Account name', v.ach_account_name],
    ['Account type', v.ach_account_type],
    ['Routing (ABA)', v.ach_routing_number],
    ['Account number', v.ach_account_number],
    ['SWIFT / BIC (wire)', v.wire_swift_bic],
  ];
  const renderedRows = rows
    .filter(([, val]) => !!(val && String(val).trim()))
    .map(
      ([label, val]) =>
        `<tr><td style="color:#64748b;padding-right:12px;vertical-align:top">${escapeHtml(label)}</td><td style="font-family:ui-monospace,Menlo,monospace">${escapeHtml(String(val))}</td></tr>`,
    )
    .join('');
  const intermediary = v.wire_intermediary_md?.trim()
    ? `<div style="margin-top:12px"><div style="color:#64748b;font-size:12px">Intermediary / wire instructions</div>${simpleMarkdownToHtml(v.wire_intermediary_md.trim())}</div>`
    : '';
  return `
    ${intro}
    <table style="border-collapse:collapse;margin:12px 0;font-size:14px">${renderedRows}</table>
    ${intermediary}
    ${charity.ein ? `<p style="font-size:12px;color:#64748b">EIN: ${escapeHtml(charity.ein)}</p>` : ''}
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function simpleMarkdownToHtml(md: string): string {
  return md
    .split(/\n{2,}/)
    .map((b) => {
      let body = escapeHtml(b).replace(/\n/g, '<br/>');
      body = body.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
      body = body.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      body = body.replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>');
      return `<p style="margin:0 0 8px">${body}</p>`;
    })
    .join('\n');
}
