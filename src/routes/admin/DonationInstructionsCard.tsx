import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray, Controller, type Control } from 'react-hook-form';
import { supabase } from '@/lib/supabase';
import { edgeFunctions } from '@/lib/edgeFunctions';
import {
  isGateOpen,
  methodLabel,
  missingForGate,
  type GatedMethod,
} from '@/lib/donationGate';
import {
  canonicalRowsFor,
  type DataBlockRow,
  type DonationMethod,
} from '@/lib/emailTemplate';
import {
  blockToRows,
  renderAchPreview,
  renderCardPreview,
  renderCashPreview,
  renderCheckPreview,
  rowsToBlock,
} from '@/lib/donationEmailPreview';
import type { Database } from '@/lib/database.types';

type CharityRow = Database['public']['Tables']['charities']['Row'];
type Tab = 'check' | 'cash' | 'card' | 'ach';

const TABS: { id: Tab; label: string }[] = [
  { id: 'check', label: 'Check' },
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'ach', label: 'ACH / Wire' },
];

// Variables admins can reference inside subject + body templates. Surfaced
// as a hint under each Markdown textarea so people don't have to dig
// through docs. The list is per-method because cash exposes
// {{receipt_number}} / {{amount}} and card exposes {{donate_url}}.
const TEMPLATE_VARS: Record<Tab, string[]> = {
  check: [
    '{{charity_name}}',
    '{{ein}}',
    '{{customer_display_name}}',
    '{{contact_first_name}}',
    '{{contact_last_name}}',
    '{{rep_message}}',
    '{{data_block}}',
    '{{footer}}',
  ],
  ach: [
    '{{charity_name}}',
    '{{ein}}',
    '{{customer_display_name}}',
    '{{contact_first_name}}',
    '{{contact_last_name}}',
    '{{rep_message}}',
    '{{data_block}}',
    '{{footer}}',
  ],
  cash: [
    '{{charity_name}}',
    '{{ein}}',
    '{{customer_display_name}}',
    '{{contact_first_name}}',
    '{{contact_last_name}}',
    '{{receipt_number}}',
    '{{amount}}',
    '{{data_block}}',
    '{{footer}}',
  ],
  card: [
    '{{charity_name}}',
    '{{ein}}',
    '{{customer_display_name}}',
    '{{contact_first_name}}',
    '{{contact_last_name}}',
    '{{rep_message}}',
    '{{donate_url}}',
    '{{amount}}',
    '{{data_block}}',
    '{{footer}}',
  ],
};

// FormValues is the shape react-hook-form manages. Includes both the
// existing payment-method fields and the new per-method template columns.
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
  | 'check_subject_template'
  | 'check_body_template_md'
  | 'ach_bank_name'
  | 'ach_account_name'
  | 'ach_account_type'
  | 'ach_routing_number'
  | 'ach_account_number'
  | 'wire_swift_bic'
  | 'wire_intermediary_md'
  | 'ach_instructions_md'
  | 'ach_subject_template'
  | 'ach_body_template_md'
  | 'cash_subject_template'
  | 'cash_body_template_md'
  | 'card_subject_template'
  | 'card_body_template_md'
  | 'card_default_amount_cents'
  | 'card_recurring_enabled'
> & {
  // Data block configs are stored as jsonb. We model them as arrays in the
  // form so useFieldArray can wire up the row-level UI cleanly. The
  // submission path serialises back to { rows: [...] }.
  check_data_block_rows: DataBlockRow[];
  cash_data_block_rows: DataBlockRow[];
  card_data_block_rows: DataBlockRow[];
  ach_data_block_rows: DataBlockRow[];
};

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
      check_subject_template: charity.check_subject_template,
      check_body_template_md: charity.check_body_template_md,
      ach_bank_name: charity.ach_bank_name,
      ach_account_name: charity.ach_account_name,
      ach_account_type: charity.ach_account_type,
      ach_routing_number: charity.ach_routing_number,
      ach_account_number: charity.ach_account_number,
      wire_swift_bic: charity.wire_swift_bic,
      wire_intermediary_md: charity.wire_intermediary_md,
      ach_instructions_md: charity.ach_instructions_md,
      ach_subject_template: charity.ach_subject_template,
      ach_body_template_md: charity.ach_body_template_md,
      cash_subject_template: charity.cash_subject_template,
      cash_body_template_md: charity.cash_body_template_md,
      card_subject_template: charity.card_subject_template,
      card_body_template_md: charity.card_body_template_md,
      card_default_amount_cents: charity.card_default_amount_cents,
      card_recurring_enabled: charity.card_recurring_enabled,
      check_data_block_rows: blockToRows(charity.check_data_block),
      cash_data_block_rows: blockToRows(charity.cash_data_block),
      card_data_block_rows: blockToRows(charity.card_data_block),
      ach_data_block_rows: blockToRows(charity.ach_data_block),
    }),
    [charity],
  );

  const { register, handleSubmit, formState, getValues, watch, reset, control } =
    useForm<FormValues>({ defaultValues: defaults });

  // Watch the entire form so the gate-status banners update live as the
  // admin types -- they must reflect the current input values, not just
  // the saved DB state. The hidden <input value={JSON.stringify(watch())}>
  // at the bottom of the form remains for re-render parity.
  const watched = watch();

  const update = useMutation({
    mutationFn: async (values: FormValues) => {
      // Normalise empty strings -> null so Postgres distinguishes "unset"
      // from "blank string", and serialise the per-method row arrays back
      // into the jsonb shape stored in `<method>_data_block`.
      const cleaned: Partial<CharityRow> = {};
      const skipKeys = new Set([
        'check_data_block_rows',
        'cash_data_block_rows',
        'card_data_block_rows',
        'ach_data_block_rows',
      ]);
      for (const [k, v] of Object.entries(values) as Array<[string, unknown]>) {
        if (skipKeys.has(k)) continue;
        if (typeof v === 'string') {
          (cleaned as Record<string, unknown>)[k] = v.trim() === '' ? null : v.trim();
        } else if (typeof v === 'number') {
          (cleaned as Record<string, unknown>)[k] = Number.isFinite(v) ? v : null;
        } else {
          (cleaned as Record<string, unknown>)[k] = v;
        }
      }
      // The DataBlockConfig type isn't structurally compatible with the
      // generic Json type Supabase generates (no string-index signature),
      // but the runtime value is plain JSON. Cast through `unknown` so we
      // get type-checking on the rest of `cleaned` without mangling here.
      cleaned.check_data_block = (rowsToBlock(values.check_data_block_rows) ?? null) as unknown as CharityRow['check_data_block'];
      cleaned.cash_data_block = (rowsToBlock(values.cash_data_block_rows) ?? null) as unknown as CharityRow['cash_data_block'];
      cleaned.card_data_block = (rowsToBlock(values.card_data_block_rows) ?? null) as unknown as CharityRow['card_data_block'];
      cleaned.ach_data_block = (rowsToBlock(values.ach_data_block_rows) ?? null) as unknown as CharityRow['ach_data_block'];
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
    if (tab === 'check') setPreview(renderCheckPreview(charity, v));
    else if (tab === 'ach') setPreview(renderAchPreview(charity, v));
    else if (tab === 'cash') setPreview(renderCashPreview(charity, v));
    else if (tab === 'card') setPreview(renderCardPreview(charity, v));
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
          <GateStatusBanner method="check" watched={watched} savedCharity={charity} />
          <GatedField label="Make checks payable to">
            <input className="field" placeholder={charity.name} {...register('check_payable_to')} />
          </GatedField>
          <GatedField label="Mail to (street / PO Box)">
            <input className="field" {...register('check_mail_to_line1')} />
          </GatedField>
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

          <AdvancedEmailSection
            method="check"
            control={control}
            register={register}
            subjectField="check_subject_template"
            bodyField="check_body_template_md"
            rowsField="check_data_block_rows"
            placeholderSubject={`How to donate by check to ${charity.name}`}
            placeholderBody={DEFAULT_CHECK_BODY_PLACEHOLDER}
          />
        </div>
      )}

      {tab === 'cash' && (
        <div className="space-y-3 text-sm text-ink-600 dark:text-ink-300">
          <p>
            Cash gifts use the existing <strong>Record received</strong> flow. When a rep
            picks "Help donor send {'->'} Cash" on the contact page, the modal jumps
            straight to the record form pre-filled with today's date so the donor walks
            away with an IRS-ready PDF receipt.
          </p>
          <p>
            Receipt formatting is controlled by the <em>Receipt signatory</em> and{' '}
            <em>Receipt disclaimer</em> fields in the Settings card above. The Advanced
            email section below overrides the receipt email's subject and body.
          </p>

          <AdvancedEmailSection
            method="cash"
            control={control}
            register={register}
            subjectField="cash_subject_template"
            bodyField="cash_body_template_md"
            rowsField="cash_data_block_rows"
            placeholderSubject={`Donation receipt #0001 from ${charity.name}`}
            placeholderBody={DEFAULT_CASH_BODY_PLACEHOLDER}
          />
        </div>
      )}

      {tab === 'card' && (
        <div className="space-y-3">
          <GateStatusBanner method="card" watched={watched} savedCharity={charity} />
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

          <AdvancedEmailSection
            method="card"
            control={control}
            register={register}
            subjectField="card_subject_template"
            bodyField="card_body_template_md"
            rowsField="card_data_block_rows"
            placeholderSubject={`How to donate by card to ${charity.name}`}
            placeholderBody={DEFAULT_CARD_BODY_PLACEHOLDER}
            // Setting any of the three card template fields opts this
            // charity into the templated card-email path. Surface that
            // explicitly so admins know what they're activating.
            footnote="Setting any field here switches card sends from Stripe's hosted-invoice email to a CharityTooling-branded email containing the secure payment link."
          />
        </div>
      )}

      {tab === 'ach' && (
        <div className="space-y-3">
          <GateStatusBanner method="ach" watched={watched} savedCharity={charity} />
          <GatedField label="Bank name">
            <input className="field" {...register('ach_bank_name')} />
          </GatedField>
          <div>
            <label className="label">Account holder (name on the account)</label>
            <input className="field" placeholder={charity.name} {...register('ach_account_name')} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <GatedField label="Routing (ABA)">
              <input className="field" {...register('ach_routing_number')} />
            </GatedField>
            <GatedField label="Account #">
              <input className="field" {...register('ach_account_number')} />
            </GatedField>
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

          <AdvancedEmailSection
            method="ach"
            control={control}
            register={register}
            subjectField="ach_subject_template"
            bodyField="ach_body_template_md"
            rowsField="ach_data_block_rows"
            placeholderSubject={`How to donate by ACH or wire to ${charity.name}`}
            placeholderBody={DEFAULT_ACH_BODY_PLACEHOLDER}
          />
        </div>
      )}

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

// -----------------------------------------------------------------------------
// Gate-status banner. Tells the admin in plain language whether each gated
// donation method (Check, ACH/Wire, Card) is currently lit up on the
// contact-page Donation modal, and -- when it isn't -- exactly which
// charity columns are missing. The same predicate (isGateOpen) drives the
// modal so the two views can never disagree.
//
// The "watched vs saved" split is what fixes the "I filled it in but it
// is still gray" confusion: while formState.isDirty is true the banner
// flips to amber + "Save to enable", then to green only after the user
// hits Save and the optimistic update lands.
// -----------------------------------------------------------------------------

function GateStatusBanner({
  method,
  watched,
  savedCharity,
}: {
  method: GatedMethod;
  watched: Partial<CharityRow>;
  savedCharity: Partial<CharityRow>;
}) {
  const live = isGateOpen(method, watched);
  const saved = isGateOpen(method, savedCharity);
  const missing = missingForGate(method, watched);
  const label = methodLabel(method);

  // 1. Saved + live both pass -> clearly enabled, green.
  if (live && saved) {
    return (
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-800 dark:text-emerald-200">
        <strong>{label} is enabled</strong> on the contact page Donation modal.
      </div>
    );
  }

  // 2. Live passes but saved does not -> the admin filled the gaps in
  //    the form but hasn't pressed Save yet. Tell them exactly that.
  if (live && !saved) {
    return (
      <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200">
        All required fields are filled. <strong>Save</strong> to enable {label} on the contact page.
      </div>
    );
  }

  // 3. Live fails -> show which columns are blocking the gate. Use the
  //    canonical labels from gateFields() so the banner copy matches the
  //    actual <label>s on each input.
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200 space-y-1">
      <div>
        <strong>{label} is disabled</strong> on the contact page. Missing required fields:
      </div>
      <ul className="list-disc list-inside">
        {missing.map((f) => (
          <li key={String(f.key)}>{f.label}</li>
        ))}
      </ul>
    </div>
  );
}

// Renders a labeled input wrapper that marks the label as required-for-gate
// (red asterisk + helper text under the input). Visual only -- the form
// intentionally still allows partial saves.
function RequiredFieldLabel({
  children,
  hint = 'Required to enable this method on the contact page.',
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="label">
      {children}
      <span className="text-red-600 ml-0.5" aria-hidden>*</span>
      <span className="sr-only"> (required to enable on contact page)</span>
      <span className="block text-[11px] font-normal text-ink-500 dark:text-ink-400 mt-0.5">
        {hint}
      </span>
    </label>
  );
}

// Convenience: full <div><label>...</label><input/></div> wrapper used by
// the gating fields below so we can keep the JSX tidy.
function GatedField({
  label,
  children,
  hint,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <RequiredFieldLabel hint={hint}>{label}</RequiredFieldLabel>
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Advanced email section: subject template, body Markdown template, and a
// structured data-block editor. Lives inside each tab so admins see only
// the controls relevant to the method they are editing.
// -----------------------------------------------------------------------------

const SUBJECT_FIELDS = [
  'check_subject_template',
  'cash_subject_template',
  'card_subject_template',
  'ach_subject_template',
] as const;
type SubjectField = (typeof SUBJECT_FIELDS)[number];

const BODY_FIELDS = [
  'check_body_template_md',
  'cash_body_template_md',
  'card_body_template_md',
  'ach_body_template_md',
] as const;
type BodyField = (typeof BODY_FIELDS)[number];

const ROWS_FIELDS = [
  'check_data_block_rows',
  'cash_data_block_rows',
  'card_data_block_rows',
  'ach_data_block_rows',
] as const;
type RowsField = (typeof ROWS_FIELDS)[number];

function AdvancedEmailSection({
  method,
  control,
  register,
  subjectField,
  bodyField,
  rowsField,
  placeholderSubject,
  placeholderBody,
  footnote,
}: {
  method: DonationMethod;
  control: Control<FormValues>;
  register: ReturnType<typeof useForm<FormValues>>['register'];
  subjectField: SubjectField;
  bodyField: BodyField;
  rowsField: RowsField;
  placeholderSubject: string;
  placeholderBody: string;
  footnote?: string;
}) {
  const { fields, append, remove, move, replace } = useFieldArray<FormValues, RowsField>({
    control,
    name: rowsField,
  });
  const canonical = canonicalRowsFor(method);

  return (
    <details className="rounded-xl border border-ink-100 dark:border-ink-800 p-3">
      <summary className="cursor-pointer select-none text-sm font-medium">
        Advanced email
      </summary>
      <div className="mt-3 space-y-3">
        <div>
          <label className="label">Subject template</label>
          <input
            className="field"
            placeholder={placeholderSubject}
            {...register(subjectField)}
          />
        </div>

        <div>
          <label className="label">Body template (Markdown)</label>
          <textarea
            className="field font-mono text-xs"
            rows={6}
            placeholder={placeholderBody}
            {...register(bodyField)}
          />
          <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
            Available variables:{' '}
            <span className="font-mono">{TEMPLATE_VARS[method].join(' ')}</span>
          </p>
          <p className="text-xs text-ink-500 dark:text-ink-400">
            Leave blank to use the canonical default. The CharityTooling footer is always
            appended unless you place <span className="font-mono">{'{{footer}}'}</span> in
            your template.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Data block</span>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => replace([])}
            >
              Reset to default
            </button>
          </div>

          {fields.length === 0 ? (
            <p className="text-xs text-ink-500 dark:text-ink-400">
              Using canonical rows:{' '}
              <span className="font-mono">{canonical.map((c) => c.label).join(' / ')}</span>
            </p>
          ) : (
            <ul className="space-y-2">
              {fields.map((field, index) => (
                <li
                  key={field.id}
                  className="rounded-lg border border-ink-100 dark:border-ink-800 p-2 space-y-2"
                >
                  <Controller
                    control={control}
                    name={`${rowsField}.${index}`}
                    render={({ field: rowField }) => {
                      const row = rowField.value as DataBlockRow;
                      const isCustom = 'custom' in row && row.custom;
                      return (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2 items-center">
                            <select
                              className="field flex-1"
                              value={isCustom ? '__custom__' : (row as { key: string }).key}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '__custom__') {
                                  rowField.onChange({ custom: true, label: '', value: '' });
                                } else {
                                  rowField.onChange({ key: v });
                                }
                              }}
                            >
                              {canonical.map((c) => (
                                <option key={c.key} value={c.key}>
                                  {c.label} (canonical)
                                </option>
                              ))}
                              <option value="__custom__">Custom row…</option>
                            </select>
                            <button
                              type="button"
                              className="btn-ghost text-xs"
                              onClick={() => move(index, Math.max(0, index - 1))}
                              disabled={index === 0}
                              aria-label="Move up"
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn-ghost text-xs"
                              onClick={() => move(index, Math.min(fields.length - 1, index + 1))}
                              disabled={index === fields.length - 1}
                              aria-label="Move down"
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="btn-ghost text-xs text-red-600"
                              onClick={() => remove(index)}
                              aria-label="Remove row"
                              title="Remove row"
                            >
                              ×
                            </button>
                          </div>

                          {isCustom ? (
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                className="field"
                                placeholder="Label"
                                value={(row as { label: string }).label}
                                onChange={(e) =>
                                  rowField.onChange({
                                    custom: true,
                                    label: e.target.value,
                                    value: (row as { value: string }).value,
                                  })
                                }
                              />
                              <input
                                className="field"
                                placeholder="Value"
                                value={(row as { value: string }).value}
                                onChange={(e) =>
                                  rowField.onChange({
                                    custom: true,
                                    label: (row as { label: string }).label,
                                    value: e.target.value,
                                  })
                                }
                              />
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                className="field"
                                placeholder={
                                  canonical.find((c) => c.key === (row as { key: string }).key)
                                    ?.label ?? 'Label override'
                                }
                                value={(row as { label?: string }).label ?? ''}
                                onChange={(e) =>
                                  rowField.onChange({
                                    key: (row as { key: string }).key,
                                    ...(e.target.value ? { label: e.target.value } : {}),
                                    ...((row as { omit?: boolean }).omit ? { omit: true } : {}),
                                  })
                                }
                              />
                              <label className="inline-flex items-center gap-2 text-xs px-2">
                                <input
                                  type="checkbox"
                                  checked={!!(row as { omit?: boolean }).omit}
                                  onChange={(e) =>
                                    rowField.onChange({
                                      key: (row as { key: string }).key,
                                      ...((row as { label?: string }).label
                                        ? { label: (row as { label: string }).label }
                                        : {}),
                                      ...(e.target.checked ? { omit: true } : {}),
                                    })
                                  }
                                />
                                Omit from email
                              </label>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost text-xs flex-1"
              onClick={() => append({ key: canonical[0]?.key ?? '' } as DataBlockRow)}
            >
              + Add canonical row
            </button>
            <button
              type="button"
              className="btn-ghost text-xs flex-1"
              onClick={() => append({ custom: true, label: '', value: '' } as DataBlockRow)}
            >
              + Add custom row
            </button>
          </div>
        </div>

        {footnote && (
          <p className="text-xs text-ink-500 dark:text-ink-400 italic">{footnote}</p>
        )}
      </div>
    </details>
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
// supabase/functions/send-payment-instructions/index.ts,
// supabase/functions/_shared/receipt.ts, and
// supabase/functions/send-card-instructions/index.ts so admins see exactly
// what donors will receive. Keep the renderers in sync.
// -----------------------------------------------------------------------------

const DEFAULT_CHECK_BODY_PLACEHOLDER = `Hi {{contact_first_name}},

Thank you for considering a gift to **{{charity_name}}**. Here is how to send a contribution by check:

{{data_block}}

EIN: {{ein}}
{{footer}}`;

const DEFAULT_ACH_BODY_PLACEHOLDER = `Hi {{contact_first_name}},

Thank you for considering a gift to **{{charity_name}}**. Here are the bank details for an ACH or wire transfer:

{{data_block}}

EIN: {{ein}}
{{footer}}`;

const DEFAULT_CASH_BODY_PLACEHOLDER = `Thank you for your contribution to **{{charity_name}}**.

Your receipt #{{receipt_number}} for {{amount}} is attached.

{{data_block}}
{{footer}}`;

const DEFAULT_CARD_BODY_PLACEHOLDER = `Hi {{contact_first_name}},

Thank you for considering a gift to **{{charity_name}}**. Click [Give by card]({{donate_url}}) to donate {{amount}}.

{{data_block}}
{{footer}}`;

