import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useActiveCharity } from '@/state/activeCharity';
import {
  displayName,
  primaryContact,
  sortedContacts,
  useArchiveCustomer,
  useCustomer,
  useUpdateCustomer,
  type CustomerContactRow,
  type CustomerRow,
} from '@/state/customers';
import { CompletenessDisclosure } from '@/components/CompletenessDisclosure';
import {
  bizapediaUrl,
  candidUrl,
  causeIqUrl,
  charityNavigatorUrl,
  facebookUrl,
  googleMapsUrl,
  googleNewsUrl,
  googleUrl,
  irsTeosUrl,
  linkedInCompanyUrl,
  linkedInPeopleUrl,
  propublicaUrl,
  xUrl,
  youtubeUrl,
} from '@/lib/researchLinks';
import {
  useCreateContact,
  useDeleteContact,
  useSetPrimaryContact,
  useUpdateContact,
} from '@/state/contacts';
import {
  CUSTOM_FIELD_KINDS,
  useAllCustomFieldDefs,
  useArchiveFieldDef,
  useCreateFieldDef,
  useCustomFieldDefs,
  useCustomerFieldValues,
  useRestoreFieldDef,
  useUpdateFieldDef,
  useUpsertFieldValue,
  type CustomerFieldDefRow,
  type CustomerFieldKind,
} from '@/state/customFields';
import { useSetStickyCustomer, useStickyCustomer } from '@/state/stickyCustomer';
import { compactMoney, formatWholeUSD } from '@/lib/format';
import { VisitStopwatch } from '@/components/VisitStopwatch';

export function UpdatePage() {
  const { activeCharityId } = useActiveCharity();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sticky = useStickyCustomer();
  const setSticky = useSetStickyCustomer();

  const explicitId = params.get('id') ?? null;

  // Find next incomplete customer when no id is provided and no sticky exists.
  const nextQuery = useQuery({
    queryKey: ['next-incomplete', activeCharityId],
    enabled: !!activeCharityId && !explicitId && !sticky,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id')
        .eq('charity_id', activeCharityId!)
        .is('archived_at', null)
        .lt('completeness_score', 100)
        .order('completeness_score', { ascending: true })
        .order('updated_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const activeId = explicitId ?? sticky ?? nextQuery.data?.id ?? null;
  const customer = useCustomer(activeId ?? undefined);

  useEffect(() => {
    if (activeId) setSticky(activeId);
  }, [activeId, setSticky]);

  // If we landed on a customer purely via sticky and they turn out to be
  // archived or gone (deleted), drop the sticky so next-incomplete kicks in on
  // the next render instead of looping on a dead id.
  useEffect(() => {
    if (explicitId) return;
    if (customer.data?.archived_at || customer.error) {
      setSticky(null);
    }
  }, [explicitId, customer.data?.archived_at, customer.error, setSticky]);

  function nextCustomer() {
    setParams({});
    setSticky(null);
    qc.invalidateQueries({ queryKey: ['next-incomplete', activeCharityId] });
  }

  if (!activeCharityId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-xl font-semibold">Update queue</h1>
        <p className="mt-2 text-ink-500 dark:text-ink-400 text-sm">Pick or create a charity to start updating.</p>
      </div>
    );
  }

  if (!activeId && nextQuery.isLoading) {
    return <div className="mx-auto max-w-2xl px-4 py-6 text-ink-400 dark:text-ink-500">Loading...</div>;
  }

  if (!activeId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
        <h1 className="text-xl font-semibold">All caught up</h1>
        <p className="text-ink-500 dark:text-ink-400 text-sm">Every customer has a 100% completeness score.</p>
        <button type="button" className="btn-primary w-full" onClick={() => navigate('/ledger')}>
          Go to Ledger
        </button>
      </div>
    );
  }

  if (customer.isLoading || !customer.data) {
    return <div className="mx-auto max-w-2xl px-4 py-6 text-ink-400 dark:text-ink-500">Loading...</div>;
  }

  return <UpdateForm customer={customer.data} onNext={nextCustomer} />;
}

// `K` defaults to `keyof CustomerRow` so existing call sites (FIELDS,
// FILING_FIELDS, ImportDaf) keep their tight typing. Custom-field consumers
// pass `K = string` so the same component can drive dynamic per-charity
// definitions (see ./customFields).
export type FieldDef<K extends string = keyof CustomerRow & string> = {
  key: K;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'select' | 'money' | 'number';
  placeholder?: string;
  // Money fields only. Default false (e.g. revenue, assets cannot go below 0).
  // Net income on a 990 can legitimately be negative, so the input strips a
  // single leading `-` before parsing only when this flag is on.
  allowNegative?: boolean;
};

export const FIELDS: FieldDef[] = [
  { key: 'display_name', label: 'Display name' },
  { key: 'website', label: 'Website', type: 'url' },
  { key: 'address_line1', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postal_code', label: 'ZIP' },
  { key: 'preferred_contact_method', label: 'Preferred contact', type: 'select' },
];

export const FILING_FIELDS: FieldDef[] = [
  { key: 'ein', label: 'EIN', placeholder: 'XX-XXXXXXX' },
  { key: 'filing_tax_period', label: 'Tax period', placeholder: 'e.g. 202312' },
  { key: 'filing_revenue', label: 'Last revenue', type: 'money' },
  { key: 'filing_income', label: 'Last income', type: 'money', allowNegative: true },
  { key: 'filing_assets', label: 'Last assets', type: 'money' },
];

type CustomerFieldValue = CustomerRow[keyof CustomerRow];

// Money input that shows `$93,250,000,000` inside the field as the user types
// (with caret-safe comma insertion) and the abbreviated `93.3b` form just
// below. Stored value remains a plain whole-dollar number so the parent's
// autosave continues to work unchanged.
function MoneyField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  allowNegative,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  allowNegative?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [display, setDisplay] = useState<string>(value != null ? formatWholeUSD(value) : '');

  // Reseed the displayed string when the underlying value changes from
  // outside the input (e.g. the Update queue advances to a new customer).
  useEffect(() => {
    setDisplay((prev) => {
      const fresh = value != null ? formatWholeUSD(value) : '';
      return prev === fresh ? prev : fresh;
    });
  }, [value]);

  function parse(raw: string): number | null {
    let digits = raw.replace(/[^\d-]/g, '');
    let negative = false;
    if (allowNegative && digits.startsWith('-')) negative = true;
    digits = digits.replace(/-/g, '');
    if (digits === '') return null;
    const n = Number(digits);
    if (!Number.isFinite(n)) return null;
    return negative ? -n : n;
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const raw = el.value;
    const caret = el.selectionStart ?? raw.length;

    // Count the "anchor" characters (digits + an optional leading sign) to
    // the left of the caret in the raw input. We restore the caret by
    // walking the formatted string until the same count is reached.
    const leftSlice = raw.slice(0, caret);
    const digitsLeft = (leftSlice.match(/\d/g) ?? []).length;
    const signLeft = allowNegative && leftSlice.includes('-') ? 1 : 0;
    const anchorsLeft = digitsLeft + signLeft;

    const num = parse(raw);
    const formatted = num == null ? '' : formatWholeUSD(num);

    setDisplay(formatted);
    onChange(num);

    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      let i = 0;
      let count = 0;
      while (i < formatted.length && count < anchorsLeft) {
        if (/[\d-]/.test(formatted[i])) count++;
        i++;
      }
      try {
        node.setSelectionRange(i, i);
      } catch {
        // setSelectionRange throws on inputs that don't support text selection
        // (some mobile browsers in number-keyboard mode). Safe to ignore.
      }
    });
  }

  const num = value != null && Number.isFinite(value) ? value : null;

  return (
    <div>
      <label className="label">{label}</label>
      <input
        ref={inputRef}
        className="field"
        type="text"
        inputMode={allowNegative ? 'text' : 'numeric'}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={display}
        onChange={handleChange}
      />
      {num != null && (
        <p className="text-xs text-ink-400 dark:text-ink-500 mt-1">{compactMoney(num)}</p>
      )}
    </div>
  );
}

export function CustomerFieldInput<K extends string = keyof CustomerRow & string>({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldDef<K>;
  value: CustomerFieldValue | null;
  onChange: (key: K, value: CustomerFieldValue) => void;
  disabled?: boolean;
}) {
  // `select` is currently only used by the hardcoded `preferred_contact_method`
  // field. Custom fields don't surface `select` in v1.
  if (field.type === 'select') {
    return (
      <div>
        <label className="label" htmlFor={`field-${field.key}`}>{field.label}</label>
        <select
          id={`field-${field.key}`}
          className="field"
          disabled={disabled}
          value={(value as string | null) ?? ''}
          onChange={(e) =>
            onChange(field.key, (e.target.value || null) as CustomerFieldValue)
          }
        >
          <option value="">(none)</option>
          <option value="email">Email</option>
          <option value="phone">Phone</option>
          <option value="mail">Mail</option>
        </select>
      </div>
    );
  }
  if (field.type === 'money') {
    return (
      <MoneyField
        label={field.label}
        value={value as number | null}
        placeholder={field.placeholder}
        disabled={disabled}
        allowNegative={field.allowNegative}
        onChange={(n) => onChange(field.key, n as CustomerFieldValue)}
      />
    );
  }
  return (
    <div>
      <label className="label" htmlFor={`field-${field.key}`}>{field.label}</label>
      <input
        id={`field-${field.key}`}
        className="field"
        type={field.type ?? 'text'}
        inputMode={field.type === 'number' ? 'numeric' : undefined}
        disabled={disabled}
        placeholder={field.placeholder}
        value={(value as string | null) ?? ''}
        onChange={(e) => onChange(field.key, e.target.value as CustomerFieldValue)}
      />
    </div>
  );
}

function UpdateForm({ customer, onNext }: { customer: CustomerRow; onNext: () => void }) {
  const update = useUpdateCustomer(customer.id);
  const archive = useArchiveCustomer(customer.id);
  const [draft, setDraft] = useState<Partial<CustomerRow>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<number | null>(null);
  const [params, setParams] = useSearchParams();

  async function onArchive() {
    if (!confirm(`Archive ${displayName(customer)}? Hidden from the ledger but kept for audit; restore from Ledger later.`)) return;
    try {
      await archive.mutateAsync();
      onNext();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  // Reset draft when we move to a new customer.
  useEffect(() => {
    setDraft({});
    setStatus('idle');
  }, [customer.id]);

  // Cross-route deep-link target from the ledger completeness modal:
  // /contact/<id>?focus=field-<key>. Scroll the matching input into view and
  // focus it. Depends on `customer` so the effect re-runs after
  // `ContactsSection` seeds a missing primary contact and the customer query
  // updates with the new id="field-first_name" inputs. The param is only
  // cleared once we actually find and act on the element, so transient races
  // (DOM not yet mounted) just wait for the next render.
  useEffect(() => {
    const target = params.get('focus');
    if (!target) return;
    const el = document.getElementById(target);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      if (typeof (el as HTMLElement).focus === 'function') {
        (el as HTMLElement).focus({ preventScroll: true });
      }
    }, 250);
    const next = new URLSearchParams(params);
    next.delete('focus');
    setParams(next, { replace: true });
  }, [params, setParams, customer]);

  function setField<K extends keyof CustomerRow>(key: K, value: CustomerRow[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setStatus('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await update.mutateAsync({ [key]: value } as Partial<CustomerRow>);
        setStatus('saved');
      } catch {
        setStatus('error');
      }
    }, 600);
  }

  const currentValue = useMemo(
    () => (key: keyof CustomerRow) => (key in draft ? (draft[key] as unknown) : customer[key]),
    [draft, customer],
  );

  function renderField(f: FieldDef) {
    return (
      <CustomerFieldInput
        key={f.key as string}
        field={f}
        value={currentValue(f.key) as CustomerFieldValue | null}
        onChange={(key, value) => setField(key, value as never)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 space-y-4">
      <header className="card">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold truncate">{displayName(customer)}</h1>
          <div className="flex items-center gap-3 shrink-0">
            <CompletenessDisclosure
              customer={customer}
              primary={primaryContact(customer)}
              variant="inline"
            />
            {!customer.archived_at && (
              <button
                type="button"
                onClick={onArchive}
                disabled={archive.isPending}
                className="text-xs text-ink-500 dark:text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
              >
                Archive
              </button>
            )}
          </div>
        </div>
        <div className="mt-1 h-1.5 bg-ink-100 dark:bg-ink-800 rounded-full overflow-hidden">
          <div className="h-full bg-accent" style={{ width: `${customer.completeness_score}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">
          <ResearchLink label="ProPublica" href={propublicaUrl(customer)} />
          <ResearchLink label="IRS TEOS" href={irsTeosUrl(customer)} />
          <ResearchLink label="Candid" href={candidUrl(customer)} />
          <ResearchLink label="Cause IQ" href={causeIqUrl(customer)} />
          <ResearchLink label="Charity Navigator" href={charityNavigatorUrl(customer)} />
          <ResearchLink label="Maps" href={googleMapsUrl(customer)} />
          <ResearchLink label="Bizapedia" href={bizapediaUrl(customer)} />
          <ResearchLink label="LinkedIn (Co)" href={linkedInCompanyUrl(customer)} />
          <ResearchLink label="LinkedIn" href={linkedInPeopleUrl(customer)} />
          <ResearchLink label="Google" href={googleUrl(customer)} />
          <ResearchLink label="Google News" href={googleNewsUrl(customer)} />
          <ResearchLink label="Facebook" href={facebookUrl(customer)} />
          <ResearchLink label="X" href={xUrl(customer)} />
          <ResearchLink label="YouTube" href={youtubeUrl(customer)} />
        </div>
      </header>

      <section className="card space-y-3">
        {FIELDS.map((f) => renderField(f))}
      </section>

      <CustomFieldsSection customer={customer} />

      <ContactsSection customer={customer} />

      <section className="card">
        <details>
          <summary className="cursor-pointer select-none font-semibold">
            Public filing fields
          </summary>
          <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
            Most recent IRS Form 990 figures, in whole US dollars.
          </p>
          <div className="space-y-3 mt-3">
            {FILING_FIELDS.map((f) => renderField(f))}
          </div>
        </details>
      </section>

      <p className="text-xs text-ink-500 dark:text-ink-400 px-1">
        {status === 'saving' && 'Saving...'}
        {status === 'saved' && 'Saved'}
        {status === 'error' && <span className="text-red-600">Save failed - try again.</span>}
        {status === 'idle' && '\u00a0'}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-ghost" onClick={onNext}>
          Skip
        </button>
        <button type="button" className="btn-primary" onClick={onNext}>
          Save & next
        </button>
      </div>

      <div className="flex justify-center pt-1">
        <VisitStopwatch />
      </div>
    </div>
  );
}

function ResearchLink({ label, href }: { label: string; href: string | null }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="px-3 py-1.5 rounded-full bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 font-medium"
    >
      {label}
    </a>
  );
}

// -----------------------------------------------------------------------------
// Contacts section (person contacts, 1..N)
// -----------------------------------------------------------------------------

export function ContactsSection({ customer }: { customer: CustomerRow }) {
  const contacts = sortedContacts(customer);
  const create = useCreateContact();
  const [addError, setAddError] = useState<string | null>(null);

  // Auto-ensure a primary contact exists so the editor (and the
  // `id="field-first_name"` etc. inputs the completeness disclosure scrolls
  // to) are always mounted. Guarded by a ref so StrictMode double-mount,
  // in-flight mutations, and stable customer ids don't double-fire.
  const ensuredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!customer.id) return;
    if (contacts.length > 0) return;
    if (ensuredForRef.current === customer.id) return;
    if (create.isPending) return;
    ensuredForRef.current = customer.id;
    create.mutate({
      customer_id: customer.id,
      charity_id: customer.charity_id,
      is_primary: true,
      sort_order: 0,
    });
  }, [customer.id, customer.charity_id, contacts.length, create]);

  async function onAdd() {
    setAddError(null);
    try {
      await create.mutateAsync({
        customer_id: customer.id,
        charity_id: customer.charity_id,
        // First contact a customer ever gets becomes primary by default.
        is_primary: contacts.length === 0,
        sort_order: contacts.length,
      });
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">People ({contacts.length})</h2>
          <p className="text-xs text-ink-500 dark:text-ink-400">
            Primary contact powers the Call button and the default email recipient.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost text-sm"
          onClick={onAdd}
          disabled={create.isPending}
        >
          {create.isPending ? 'Adding...' : '+ Add contact'}
        </button>
      </div>

      <div className="space-y-3">
        {contacts.map((c) => (
          <ContactEditor key={c.id} contact={c} />
        ))}
      </div>

      {addError && <p className="text-sm text-red-600">{addError}</p>}
    </section>
  );
}

type ContactField = 'first_name' | 'last_name' | 'email' | 'phone' | 'note';

function ContactEditor({ contact }: { contact: CustomerContactRow }) {
  const update = useUpdateContact();
  const del = useDeleteContact();
  const setPrimary = useSetPrimaryContact();

  const [draft, setDraft] = useState<Partial<CustomerContactRow>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    // Drop the local draft when the underlying row changes (e.g. after the
    // 600ms autosave round-trip returns the updated row from the cache).
    setDraft({});
    setStatus('idle');
  }, [contact.id, contact.updated_at]);

  function setField(key: ContactField, value: string | null) {
    setDraft((d) => ({ ...d, [key]: value }));
    setStatus('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await update.mutateAsync({
          id: contact.id,
          customer_id: contact.customer_id,
          patch: { [key]: value } as Partial<CustomerContactRow>,
        });
        setStatus('saved');
      } catch {
        setStatus('error');
      }
    }, 600);
  }

  function val(key: ContactField): string {
    if (key in draft) return ((draft as Record<string, string | null>)[key] ?? '') as string;
    return (contact[key] as string | null) ?? '';
  }

  async function onMakePrimary() {
    if (contact.is_primary) return;
    try {
      await setPrimary.mutateAsync({ id: contact.id, customer_id: contact.customer_id });
    } catch (err) {
      console.error('set-primary failed', err);
    }
  }

  async function onDelete() {
    const ok = window.confirm('Delete this contact?');
    if (!ok) return;
    try {
      await del.mutateAsync({ id: contact.id, customer_id: contact.customer_id });
    } catch (err) {
      console.error('delete-contact failed', err);
    }
  }

  return (
    <div className="border border-ink-100 dark:border-ink-800 rounded-lg p-3 space-y-2 bg-ink-50 dark:bg-ink-950/30">
      <div className="flex items-center gap-2">
        {contact.is_primary ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
            Primary
          </span>
        ) : (
          <button
            type="button"
            className="text-xs underline text-ink-500 dark:text-ink-400 hover:text-accent"
            onClick={onMakePrimary}
            disabled={setPrimary.isPending}
          >
            Make primary
          </button>
        )}
        <span className="text-xs text-ink-400 dark:text-ink-500 ml-auto">
          {status === 'saving' && 'Saving...'}
          {status === 'saved' && 'Saved'}
          {status === 'error' && <span className="text-red-600">Save failed</span>}
        </span>
        <button
          type="button"
          className="text-xs text-ink-500 dark:text-ink-400 hover:text-red-600 disabled:opacity-50"
          onClick={onDelete}
          disabled={del.isPending}
          title="Delete contact"
        >
          Delete
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor={contact.is_primary ? 'field-first_name' : undefined}>First name</label>
          <input
            id={contact.is_primary ? 'field-first_name' : undefined}
            className="field"
            value={val('first_name')}
            onChange={(e) => setField('first_name', e.target.value || null)}
          />
        </div>
        <div>
          <label className="label" htmlFor={contact.is_primary ? 'field-last_name' : undefined}>Last name</label>
          <input
            id={contact.is_primary ? 'field-last_name' : undefined}
            className="field"
            value={val('last_name')}
            onChange={(e) => setField('last_name', e.target.value || null)}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor={contact.is_primary ? 'field-email' : undefined}>Email</label>
        <input
          id={contact.is_primary ? 'field-email' : undefined}
          className="field"
          type="email"
          value={val('email')}
          onChange={(e) => setField('email', e.target.value || null)}
        />
      </div>

      <div>
        <label className="label" htmlFor={contact.is_primary ? 'field-phone' : undefined}>Phone</label>
        <input
          id={contact.is_primary ? 'field-phone' : undefined}
          className="field"
          type="tel"
          value={val('phone')}
          onChange={(e) => setField('phone', e.target.value || null)}
        />
      </div>

      <div>
        <label className="label">Note</label>
        <textarea
          className="field h-16"
          value={val('note')}
          onChange={(e) => setField('note', e.target.value || null)}
          placeholder="e.g. prefers email after 5pm; spouse is Pat"
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Custom fields section (charity-wide field defs + per-customer values)
// -----------------------------------------------------------------------------

function defKindToFieldType(kind: CustomerFieldKind): FieldDef['type'] {
  // 'text' maps to undefined so CustomerFieldInput uses its default <input>.
  if (kind === 'text') return undefined;
  return kind;
}

function kindLabel(kind: CustomerFieldKind): string {
  switch (kind) {
    case 'text':
      return 'Text';
    case 'url':
      return 'URL';
    case 'email':
      return 'Email';
    case 'tel':
      return 'Phone';
    case 'number':
      return 'Number';
    case 'money':
      return 'Money';
  }
}

// Storage in customer_field_values.value is always text. MoneyField wants a
// number, so money fields are parsed/stringified at the section boundary.
function valueForInput(kind: CustomerFieldKind, raw: string | null): CustomerFieldValue | null {
  if (raw == null || raw === '') return null;
  if (kind === 'money') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return raw;
}

function valueForStorage(kind: CustomerFieldKind, next: CustomerFieldValue): string | null {
  if (next == null || next === '') return null;
  if (kind === 'money') {
    return Number.isFinite(next as number) ? String(next) : null;
  }
  return String(next);
}

function CustomFieldsSection({ customer }: { customer: CustomerRow }) {
  const defsQuery = useCustomFieldDefs(customer.charity_id);
  const valuesQuery = useCustomerFieldValues(customer.id);
  const upsertValue = useUpsertFieldValue();
  const createDef = useCreateFieldDef();

  // Per-def local draft so the input doesn't lag while the 600ms debounce ticks.
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timers = useRef<Record<string, number>>({});

  // Inline + Add field composer
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState<CustomerFieldKind>('text');
  const [addError, setAddError] = useState<string | null>(null);

  // Reset when switching customers.
  useEffect(() => {
    setDraft({});
    setStatus('idle');
    for (const id of Object.values(timers.current)) window.clearTimeout(id);
    timers.current = {};
  }, [customer.id]);

  // Cancel any pending writes when the section unmounts.
  useEffect(() => {
    return () => {
      for (const id of Object.values(timers.current)) window.clearTimeout(id);
      timers.current = {};
    };
  }, []);

  function getStoredValue(defId: string): string | null {
    if (defId in draft) return draft[defId];
    return valuesQuery.data?.[defId]?.value ?? null;
  }

  function scheduleSave(defId: string, nextStored: string | null) {
    setDraft((d) => ({ ...d, [defId]: nextStored }));
    setStatus('saving');
    const existing = timers.current[defId];
    if (existing) window.clearTimeout(existing);
    timers.current[defId] = window.setTimeout(async () => {
      try {
        await upsertValue.mutateAsync({
          customer_id: customer.id,
          field_def_id: defId,
          value: nextStored,
        });
        setStatus('saved');
      } catch {
        setStatus('error');
      }
    }, 600);
  }

  async function onAddDef() {
    const label = newLabel.trim();
    if (!label) return;
    setAddError(null);
    try {
      await createDef.mutateAsync({
        charity_id: customer.charity_id,
        label,
        kind: newKind,
        sort_order: defsQuery.data?.length ?? 0,
      });
      setNewLabel('');
      setNewKind('text');
      setAdding(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    }
  }

  const defs = defsQuery.data ?? [];

  return (
    <section className="card">
      <details>
        <summary className="cursor-pointer select-none font-semibold">
          Custom fields ({defs.length})
        </summary>
        <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
          Charity-wide. Any member can add a field; every other member sees it on every customer.
        </p>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={() => {
              setAdding((v) => !v);
              setAddError(null);
            }}
          >
            {adding ? 'Cancel' : '+ Add field'}
          </button>
        </div>

        {defs.length === 0 && !adding && (
          <p className="text-sm text-ink-500 dark:text-ink-400 mt-2">
            No custom fields yet. Click "+ Add field" to create one.
          </p>
        )}

        <div className="space-y-3 mt-3">
          {defs.map((def) => (
            <CustomerFieldInput<string>
              key={def.id}
              field={{
                key: def.id,
                label: def.label,
                type: defKindToFieldType(def.kind),
              }}
              value={valueForInput(def.kind, getStoredValue(def.id))}
              onChange={(_key, next) => scheduleSave(def.id, valueForStorage(def.kind, next))}
            />
          ))}
        </div>

        {adding && (
          <div className="space-y-2 pt-2 mt-3 border-t border-ink-100 dark:border-ink-800">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="label">Field name</label>
                <input
                  className="field"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Twitter handle"
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Kind</label>
                <select
                  className="field"
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as CustomerFieldKind)}
                >
                  {CUSTOM_FIELD_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              {addError && <p className="text-sm text-red-600 mr-auto">{addError}</p>}
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={onAddDef}
                disabled={createDef.isPending || !newLabel.trim()}
              >
                {createDef.isPending ? 'Adding...' : 'Add field'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-3">
          <ManageCustomFields charityId={customer.charity_id} hasDefs={defs.length > 0} />
        </div>

        <p className="text-xs text-ink-500 dark:text-ink-400 px-1 mt-3">
          {status === 'saving' && 'Saving...'}
          {status === 'saved' && 'Saved'}
          {status === 'error' && <span className="text-red-600">Save failed - try again.</span>}
          {status === 'idle' && '\u00a0'}
        </p>
      </details>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Manage custom fields (rename, archive, restore)
// -----------------------------------------------------------------------------

function ManageCustomFields({
  charityId,
  hasDefs,
}: {
  charityId: string;
  hasDefs: boolean;
}) {
  const allDefs = useAllCustomFieldDefs(charityId);
  const updateDef = useUpdateFieldDef();
  const archiveDef = useArchiveFieldDef();
  const restoreDef = useRestoreFieldDef();

  // Defer fetching the full (including archived) list until the user opens
  // the manager. allDefs is enabled by charityId; React Query will skip the
  // network until something subscribes via a render with `<details open>`.
  if (!hasDefs && (allDefs.data?.length ?? 0) === 0) return null;

  const rows = allDefs.data ?? [];

  return (
    <details className="pt-2 border-t border-ink-100 dark:border-ink-800">
      <summary className="cursor-pointer select-none text-sm font-medium text-ink-700 dark:text-ink-200">
        Manage fields
      </summary>
      <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
        Rename or archive existing fields. Archived fields hide from the form but their values are
        kept and restored if you unarchive.
      </p>
      <div className="space-y-2 mt-3">
        {rows.length === 0 && (
          <p className="text-sm text-ink-500 dark:text-ink-400">No fields yet.</p>
        )}
        {rows.map((def) => (
          <ManageCustomFieldRow
            key={def.id}
            def={def}
            onRename={(label) =>
              updateDef.mutate({ id: def.id, charity_id: def.charity_id, patch: { label } })
            }
            onArchive={() => archiveDef.mutate({ id: def.id, charity_id: def.charity_id })}
            onRestore={() => restoreDef.mutate({ id: def.id, charity_id: def.charity_id })}
            busy={updateDef.isPending || archiveDef.isPending || restoreDef.isPending}
          />
        ))}
      </div>
    </details>
  );
}

function ManageCustomFieldRow({
  def,
  onRename,
  onArchive,
  onRestore,
  busy,
}: {
  def: CustomerFieldDefRow;
  onRename: (label: string) => void;
  onArchive: () => void;
  onRestore: () => void;
  busy: boolean;
}) {
  const [label, setLabel] = useState(def.label);
  const renameTimer = useRef<number | null>(null);

  useEffect(() => {
    setLabel(def.label);
  }, [def.id, def.label]);

  function onChangeLabel(next: string) {
    setLabel(next);
    if (renameTimer.current) window.clearTimeout(renameTimer.current);
    renameTimer.current = window.setTimeout(() => {
      const trimmed = next.trim();
      if (trimmed && trimmed !== def.label) onRename(trimmed);
    }, 600);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        className="field flex-1"
        value={label}
        onChange={(e) => onChangeLabel(e.target.value)}
        disabled={busy || !!def.archived_at}
      />
      <span className="text-xs text-ink-500 dark:text-ink-400 w-14 shrink-0">
        {kindLabel(def.kind)}
      </span>
      {def.archived_at ? (
        <button
          type="button"
          className="text-xs text-ink-500 dark:text-ink-400 hover:text-accent shrink-0"
          onClick={onRestore}
          disabled={busy}
          title="Restore field"
        >
          Restore
        </button>
      ) : (
        <button
          type="button"
          className="text-xs text-ink-500 dark:text-ink-400 hover:text-red-600 shrink-0"
          onClick={() => {
            if (window.confirm(`Archive "${def.label}"? Values are kept and can be restored.`)) {
              onArchive();
            }
          }}
          disabled={busy}
          title="Archive field"
        >
          Archive
        </button>
      )}
    </div>
  );
}
