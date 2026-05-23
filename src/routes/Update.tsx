import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useActiveCharity } from '@/state/activeCharity';
import {
  displayName,
  primaryContact,
  sortedContacts,
  useCustomer,
  useUpdateCustomer,
  type CustomerContactRow,
  type CustomerRow,
} from '@/state/customers';
import {
  useCreateContact,
  useDeleteContact,
  useSetPrimaryContact,
  useUpdateContact,
} from '@/state/contacts';

export function UpdatePage() {
  const { activeCharityId } = useActiveCharity();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const explicitId = params.get('id') ?? null;

  // Find next incomplete customer when no id is provided.
  const nextQuery = useQuery({
    queryKey: ['next-incomplete', activeCharityId],
    enabled: !!activeCharityId && !explicitId,
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

  const activeId = explicitId ?? nextQuery.data?.id ?? null;
  const customer = useCustomer(activeId ?? undefined);

  function nextCustomer() {
    setParams({});
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

export type FieldDef = {
  key: keyof CustomerRow;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'select' | 'money';
  placeholder?: string;
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
  { key: 'filing_income', label: 'Last income', type: 'money' },
  { key: 'filing_assets', label: 'Last assets', type: 'money' },
];

export const MONEY_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

type CustomerFieldValue = CustomerRow[keyof CustomerRow];

export function CustomerFieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldDef;
  value: CustomerFieldValue | null;
  onChange: (key: keyof CustomerRow, value: CustomerFieldValue) => void;
  disabled?: boolean;
}) {
  if (field.type === 'select' && field.key === 'preferred_contact_method') {
    return (
      <div>
        <label className="label">{field.label}</label>
        <select
          className="field"
          disabled={disabled}
          value={(value as string | null) ?? ''}
          onChange={(e) =>
            onChange(
              'preferred_contact_method',
              (e.target.value || null) as CustomerRow['preferred_contact_method'],
            )
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
    const raw = value as number | null;
    return (
      <div>
        <label className="label">{field.label}</label>
        <input
          className="field"
          inputMode="numeric"
          type="number"
          min={0}
          step={1}
          disabled={disabled}
          placeholder={field.placeholder}
          value={raw ?? ''}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange(field.key, (v === '' ? null : Number(v)) as CustomerFieldValue);
          }}
        />
        {raw != null && Number.isFinite(raw) && (
          <p className="text-xs text-ink-400 dark:text-ink-500 mt-1">{MONEY_FMT.format(raw)}</p>
        )}
      </div>
    );
  }
  return (
    <div>
      <label className="label">{field.label}</label>
      <input
        className="field"
        type={field.type ?? 'text'}
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
  const [draft, setDraft] = useState<Partial<CustomerRow>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<number | null>(null);

  // Reset draft when we move to a new customer.
  useEffect(() => {
    setDraft({});
    setStatus('idle');
  }, [customer.id]);

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

  const primary = primaryContact(customer);
  const queryName = encodeURIComponent(
    displayName(customer) + (primary?.email ? ` ${primary.email.split('@')[1]}` : ''),
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
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold truncate">{displayName(customer)}</h1>
          <span className="text-xs font-medium text-ink-500 dark:text-ink-400">{customer.completeness_score}% complete</span>
        </div>
        <div className="mt-1 h-1.5 bg-ink-100 dark:bg-ink-800 rounded-full overflow-hidden">
          <div className="h-full bg-accent" style={{ width: `${customer.completeness_score}%` }} />
        </div>
        <div className="flex gap-2 mt-3 text-xs">
          <ResearchLink label="LinkedIn" href={`https://www.linkedin.com/search/results/people/?keywords=${queryName}`} />
          <ResearchLink label="Google" href={`https://www.google.com/search?q=${queryName}`} />
          <ResearchLink label="Facebook" href={`https://www.facebook.com/search/people/?q=${queryName}`} />
        </div>
      </header>

      <section className="card space-y-3">
        {FIELDS.map((f) => renderField(f))}
      </section>

      <ContactsSection customer={customer} />

      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Public filing fields</h2>
          <p className="text-xs text-ink-500 dark:text-ink-400">
            Most recent IRS Form 990 figures, in whole US dollars.
          </p>
        </div>
        {FILING_FIELDS.map((f) => renderField(f))}
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
    </div>
  );
}

function ResearchLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="px-3 py-1.5 rounded-full bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 font-medium"
    >
      Search {label}
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
            One person on file per row. The primary contact powers the Call button and the default
            email recipient.
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

      {contacts.length === 0 && (
        <p className="text-sm text-ink-500 dark:text-ink-400">No contacts yet. Add one to get started.</p>
      )}

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
          <label className="label">First name</label>
          <input
            className="field"
            value={val('first_name')}
            onChange={(e) => setField('first_name', e.target.value || null)}
          />
        </div>
        <div>
          <label className="label">Last name</label>
          <input
            className="field"
            value={val('last_name')}
            onChange={(e) => setField('last_name', e.target.value || null)}
          />
        </div>
      </div>

      <div>
        <label className="label">Email</label>
        <input
          className="field"
          type="email"
          value={val('email')}
          onChange={(e) => setField('email', e.target.value || null)}
        />
      </div>

      <div>
        <label className="label">Phone</label>
        <input
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
