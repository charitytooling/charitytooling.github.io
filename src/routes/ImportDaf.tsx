import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveCharity } from '@/state/activeCharity';
import { supabase } from '@/lib/supabase';
import {
  CustomerFieldInput,
  FIELDS,
  FILING_FIELDS,
} from '@/routes/Update';
import type { CustomerRow } from '@/state/customers';
import type { Database } from '@/lib/database.types';

// Use the bare customers row type for drafts/payloads we hand to Supabase.
// CustomerRow has the embedded `customer_contacts` array which Supabase's
// .update()/.insert() reject as an unknown column.
type CustomerBase = Database['public']['Tables']['customers']['Row'];

type ContactDraft = Partial<
  Pick<
    Database['public']['Tables']['customer_contacts']['Row'],
    'first_name' | 'last_name' | 'email' | 'phone' | 'note'
  >
>;

// Payload shape: ?d=<encoded JSON array of nonprofit rows> from an upstream sender.
type DafRow = {
  ein: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  revenue: number | null;
  income: number | null;
  assets: number | null;
  tax_period: string | null;
};

type RowStatus = 'idle' | 'saving' | 'saved' | 'error';
type SavedKind = 'imported' | 'replaced';
type ExistingMap = Map<string, { id: string }>;

export function ImportDafPage() {
  const [params] = useSearchParams();
  const { activeCharityId } = useActiveCharity();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const raw = params.get('d');
  const parsed = useMemo<{ rows: DafRow[] | null; error: string | null }>(() => {
    if (!raw) return { rows: null, error: 'No data in the link. Open this page from the upstream import link.' };
    try {
      const decoded = JSON.parse(raw);
      if (!Array.isArray(decoded)) throw new Error('Expected an array of rows.');
      const rows: DafRow[] = [];
      for (const r of decoded) {
        if (!r || typeof r.ein !== 'string' || typeof r.name !== 'string') {
          throw new Error('Row missing required fields (ein, name).');
        }
        rows.push({
          ein: r.ein,
          name: r.name,
          street: nullable(r.street),
          city: nullable(r.city),
          state: nullable(r.state),
          zip: nullable(r.zip),
          revenue: numberOrNull(r.revenue),
          income: numberOrNull(r.income),
          assets: numberOrNull(r.assets),
          tax_period: nullable(r.tax_period),
        });
      }
      return { rows, error: null };
    } catch (e) {
      return { rows: null, error: e instanceof Error ? e.message : 'Could not decode the payload.' };
    }
  }, [raw]);

  const rows = parsed.rows ?? [];
  const rowByEin = useMemo(() => new Map(rows.map((r) => [r.ein, r])), [rows]);
  const einsKey = rows.map((r) => r.ein).join(',');

  const existingQuery = useQuery({
    queryKey: ['customers_by_ein', activeCharityId, einsKey],
    enabled: !!activeCharityId && rows.length > 0,
    queryFn: async (): Promise<ExistingMap> => {
      const eins = rows.map((r) => r.ein);
      const { data, error } = await supabase
        .from('customers')
        .select('id, ein')
        .eq('charity_id', activeCharityId!)
        .in('ein', eins);
      if (error) throw error;
      const m: ExistingMap = new Map();
      for (const r of data ?? []) {
        if (r && typeof r.ein === 'string') m.set(r.ein, { id: r.id });
      }
      return m;
    },
  });
  const existing: ExistingMap = existingQuery.data ?? new Map();

  // Per-row local state. Keyed by EIN so we can resolve to/from rowByEin.
  const [drafts, setDrafts] = useState<Record<string, Partial<CustomerBase>>>({});
  const [contactDrafts, setContactDrafts] = useState<Record<string, ContactDraft>>({});
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [savedAs, setSavedAs] = useState<Record<string, SavedKind>>({});
  const [savedId, setSavedId] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  // Seed drafts (and reset every other map) when the parsed payload or the
  // active charity changes. `einsKey` covers payload changes; activeCharityId
  // re-seeds so the prefilled charity_id stays correct.
  useEffect(() => {
    if (!activeCharityId || rows.length === 0) return;
    const initial: Record<string, Partial<CustomerBase>> = {};
    for (const r of rows) initial[r.ein] = toInsert(r, activeCharityId);
    setDrafts(initial);
    setContactDrafts({});
    setStatus({});
    setSavedAs({});
    setSavedId({});
    setErrors({});
    setExcluded(new Set());
    // einsKey is the stable identity of the payload.
  }, [einsKey, activeCharityId]); // eslint-disable-line react-hooks/exhaustive-deps

  function setRowField(ein: string) {
    return (key: keyof CustomerRow, value: CustomerRow[keyof CustomerRow]) => {
      setDrafts((d) => ({ ...d, [ein]: { ...(d[ein] ?? {}), [key]: value } }));
    };
  }

  function setContactField(ein: string) {
    return (key: keyof ContactDraft, value: string | null) => {
      setContactDrafts((d) => ({
        ...d,
        [ein]: { ...(d[ein] ?? {}), [key]: value },
      }));
    };
  }

  function toggleExcluded(ein: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(ein)) next.delete(ein);
      else next.add(ein);
      return next;
    });
  }

  async function saveRow(ein: string): Promise<boolean> {
    const row = rowByEin.get(ein);
    if (!row || !activeCharityId) return false;
    if (status[ein] === 'saved' || excluded.has(ein)) return true;

    const draft = drafts[ein] ?? {};
    const payload = {
      ...toInsert(row, activeCharityId),
      ...draft,
    };
    const dup = existing.get(ein);
    if (dup) {
      const label = (payload.display_name as string | null) || row.name;
      if (!confirm(`Overwrite ${label} with these values?`)) return false;
    }

    const contactDraft = contactDrafts[ein] ?? {};
    const hasContactInput = (Object.values(contactDraft) as (string | null | undefined)[]).some(
      (v) => v != null && String(v).trim() !== '',
    );

    setStatus((s) => ({ ...s, [ein]: 'saving' }));
    setErrors((e) => ({ ...e, [ein]: null }));
    try {
      let customerId: string;
      if (dup) {
        const { error } = await supabase
          .from('customers')
          .update(payload)
          .eq('id', dup.id);
        if (error) throw error;
        customerId = dup.id;
        setSavedId((m) => ({ ...m, [ein]: dup.id }));
        setSavedAs((m) => ({ ...m, [ein]: 'replaced' }));
      } else {
        const { data, error } = await supabase
          .from('customers')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        customerId = data!.id;
        setSavedId((m) => ({ ...m, [ein]: data!.id }));
        setSavedAs((m) => ({ ...m, [ein]: 'imported' }));
      }

      // Primary contact upsert.
      // - New customer + any contact field filled in: insert.
      // - Replacing duplicate: try updating the existing primary, and if
      //   there isn't one yet, fall back to insert.
      if (hasContactInput) {
        if (dup) {
          const upd = await supabase
            .from('customer_contacts')
            .update(contactDraft)
            .eq('customer_id', customerId)
            .eq('is_primary', true)
            .select('id');
          if (upd.error) throw upd.error;
          if (!upd.data || upd.data.length === 0) {
            const ins = await supabase.from('customer_contacts').insert({
              ...contactDraft,
              customer_id: customerId,
              charity_id: activeCharityId,
              is_primary: true,
            });
            if (ins.error) throw ins.error;
          }
        } else {
          const ins = await supabase.from('customer_contacts').insert({
            ...contactDraft,
            customer_id: customerId,
            charity_id: activeCharityId,
            is_primary: true,
          });
          if (ins.error) throw ins.error;
        }
      }

      setStatus((s) => ({ ...s, [ein]: 'saved' }));
      qc.invalidateQueries({ queryKey: ['customers', activeCharityId] });
      qc.invalidateQueries({ queryKey: ['customers_by_ein', activeCharityId] });
      qc.invalidateQueries({ queryKey: ['customer', customerId] });
      return true;
    } catch (err) {
      setStatus((s) => ({ ...s, [ein]: 'error' }));
      setErrors((e) => ({
        ...e,
        [ein]: err instanceof Error ? err.message : 'Save failed.',
      }));
      return false;
    }
  }

  async function saveAllRemaining() {
    for (const r of rows) {
      if (excluded.has(r.ein)) continue;
      if (status[r.ein] === 'saved') continue;
      const ok = await saveRow(r.ein);
      if (!ok) break;
    }
  }

  if (parsed.error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-3">
        <h1 className="text-xl font-semibold">Import from DAF Tooling</h1>
        <p className="text-sm text-red-600">{parsed.error}</p>
        <Link to="/ledger" className="text-accent text-sm">Back to Ledger</Link>
      </div>
    );
  }

  if (!activeCharityId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold">Import from DAF Tooling</h1>
        <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">Pick a charity in the top bar to import into.</p>
      </div>
    );
  }

  const total = rows.length;
  const savedCount = rows.filter((r) => status[r.ein] === 'saved').length;
  const excludedCount = excluded.size;
  const remainingCount = rows.filter(
    (r) => status[r.ein] !== 'saved' && !excluded.has(r.ein),
  ).length;
  const importedCount = rows.filter((r) => savedAs[r.ein] === 'imported').length;
  const replacedCount = rows.filter((r) => savedAs[r.ein] === 'replaced').length;
  const allDone = total > 0 && savedCount + excludedCount === total;
  const isMulti = total > 1;
  const isLoadingExisting = existingQuery.isLoading;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Import from DAF Tooling</h1>
        <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
          {total} org{total === 1 ? '' : 's'} to import &mdash; review and edit, then save.
        </p>
      </div>

      {isMulti && !allDone && (
        <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/95 dark:bg-ink-900/95 backdrop-blur border-b border-ink-100 dark:border-ink-800">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {savedCount} of {total} saved
              {excludedCount > 0 ? ` \u00b7 ${excludedCount} skipped` : ''}
            </p>
            <div className="flex gap-2">
              <Link to="/ledger" className="btn-ghost text-sm">Cancel</Link>
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={remainingCount === 0 || isLoadingExisting}
                onClick={saveAllRemaining}
              >
                Save all remaining ({remainingCount})
              </button>
            </div>
          </div>
        </div>
      )}

      {allDone && (
        <section className="card border-2 border-accent/30 bg-accent/5">
          <h2 className="font-semibold">Done</h2>
          <p className="text-sm text-ink-600 dark:text-ink-300 mt-1">
            Imported {importedCount} &middot; Replaced {replacedCount} &middot; Skipped {excludedCount}.
          </p>
          <button
            type="button"
            className="btn-primary mt-3"
            onClick={() => navigate('/ledger')}
          >
            Back to Ledger
          </button>
        </section>
      )}

      {isLoadingExisting ? (
        <div className="card text-sm text-ink-500 dark:text-ink-400">Checking for duplicates...</div>
      ) : (
        rows.map((row) => (
          <ImportRowCard
            key={row.ein}
            row={row}
            draft={drafts[row.ein] ?? {}}
            contactDraft={contactDrafts[row.ein] ?? {}}
            existingId={existing.get(row.ein)?.id ?? null}
            status={status[row.ein] ?? 'idle'}
            savedKind={savedAs[row.ein] ?? null}
            savedId={savedId[row.ein] ?? existing.get(row.ein)?.id ?? null}
            errorMsg={errors[row.ein] ?? null}
            excluded={excluded.has(row.ein)}
            onChangeField={setRowField(row.ein)}
            onChangeContactField={setContactField(row.ein)}
            onToggleExcluded={() => toggleExcluded(row.ein)}
            onSave={() => saveRow(row.ein)}
          />
        ))
      )}

      {!isMulti && !allDone && (
        <div className="flex justify-end">
          <Link to="/ledger" className="btn-ghost">Cancel</Link>
        </div>
      )}
    </div>
  );
}

function ImportRowCard({
  row,
  draft,
  contactDraft,
  existingId,
  status,
  savedKind,
  savedId,
  errorMsg,
  excluded,
  onChangeField,
  onChangeContactField,
  onToggleExcluded,
  onSave,
}: {
  row: DafRow;
  draft: Partial<CustomerRow>;
  contactDraft: ContactDraft;
  existingId: string | null;
  status: RowStatus;
  savedKind: SavedKind | null;
  savedId: string | null;
  errorMsg: string | null;
  excluded: boolean;
  onChangeField: (key: keyof CustomerRow, value: CustomerRow[keyof CustomerRow]) => void;
  onChangeContactField: (key: keyof ContactDraft, value: string | null) => void;
  onToggleExcluded: () => void;
  onSave: () => void;
}) {
  const isDup = !!existingId;
  const title = (draft.display_name as string | null) || row.name;

  if (excluded) {
    return (
      <section className="card flex items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate text-ink-500 dark:text-ink-400 line-through">{title}</p>
          <p className="text-xs text-ink-400 dark:text-ink-500">Skipped &middot; EIN {row.ein}</p>
        </div>
        <button type="button" className="btn-ghost text-sm" onClick={onToggleExcluded}>
          Restore
        </button>
      </section>
    );
  }

  const pill = (() => {
    if (status === 'saved' && savedKind === 'imported') {
      return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap">Imported</span>;
    }
    if (status === 'saved' && savedKind === 'replaced') {
      return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap">Replaced</span>;
    }
    if (status === 'error') {
      return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">Error</span>;
    }
    if (isDup) {
      return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">Duplicate &mdash; will replace</span>;
    }
    return <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent whitespace-nowrap">New</span>;
  })();

  const isSaved = status === 'saved';
  const isSaving = status === 'saving';
  const disableInputs = isSaved || isSaving;

  return (
    <section className="card space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold truncate">{title}</h2>
          <p className="text-xs text-ink-500 dark:text-ink-400">EIN {row.ein}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pill}
          {!isSaved && (
            <button
              type="button"
              className="btn-ghost text-xs"
              aria-label="Skip this row"
              title="Skip this row"
              onClick={onToggleExcluded}
            >
              Skip
            </button>
          )}
        </div>
      </header>

      <div className="space-y-3">
        {FIELDS.map((f) => (
          <CustomerFieldInput
            key={f.key as string}
            field={f}
            value={fieldValue(draft, f.key)}
            onChange={onChangeField}
            disabled={disableInputs}
          />
        ))}
      </div>

      <div className="pt-2 border-t border-ink-100 dark:border-ink-800 space-y-3">
        <div>
          <h3 className="font-semibold text-sm">Public filing fields</h3>
          <p className="text-xs text-ink-500 dark:text-ink-400">Most recent IRS Form 990 figures, in whole US dollars.</p>
        </div>
        {FILING_FIELDS.map((f) => (
          <CustomerFieldInput
            key={f.key as string}
            field={f}
            value={fieldValue(draft, f.key)}
            onChange={onChangeField}
            disabled={disableInputs}
          />
        ))}
      </div>

      <ContactExpander
        contactDraft={contactDraft}
        onChange={onChangeContactField}
        disabled={disableInputs}
        isDup={isDup}
      />

      {errorMsg && (
        <p className="text-sm text-red-600">{errorMsg}</p>
      )}

      <div className="flex items-center justify-between gap-2 pt-2">
        <p className="text-xs text-ink-500 dark:text-ink-400">
          {isSaving && 'Saving...'}
          {isSaved && (savedKind === 'replaced' ? 'Replaced.' : 'Imported.')}
          {status === 'error' && <span className="text-red-600">Save failed &mdash; try again.</span>}
          {status === 'idle' && '\u00a0'}
        </p>
        {isSaved ? (
          savedId ? (
            <Link to={`/update?id=${savedId}`} className="btn-ghost text-sm">
              Edit in Update
            </Link>
          ) : null
        ) : (
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={isSaving}
            onClick={onSave}
          >
            {isDup ? 'Replace' : 'Import'}
          </button>
        )}
      </div>
    </section>
  );
}

function fieldValue(draft: Partial<CustomerRow>, key: keyof CustomerRow) {
  return (key in draft ? draft[key] : null) as CustomerRow[keyof CustomerRow] | null;
}

function ContactExpander({
  contactDraft,
  onChange,
  disabled,
  isDup,
}: {
  contactDraft: ContactDraft;
  onChange: (key: keyof ContactDraft, value: string | null) => void;
  disabled?: boolean;
  isDup: boolean;
}) {
  // Open by default whenever the user has typed anything in here already.
  const hasInput = (Object.values(contactDraft) as (string | null | undefined)[]).some(
    (v) => v != null && String(v).trim() !== '',
  );
  const [open, setOpen] = useState(hasInput);

  return (
    <div className="pt-2 border-t border-ink-100 dark:border-ink-800 space-y-3">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div>
          <h3 className="font-semibold text-sm">Primary contact (optional)</h3>
          <p className="text-xs text-ink-500 dark:text-ink-400">
            {isDup
              ? 'Update or add the primary person on file for this org.'
              : 'Add the primary person on file for this org. Save without filling these in to create the org only.'}
          </p>
        </div>
        <span className="text-ink-400 dark:text-ink-500 text-sm">{open ? '\u2212' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">First name</label>
              <input
                className="field"
                value={contactDraft.first_name ?? ''}
                disabled={disabled}
                onChange={(e) => onChange('first_name', e.target.value || null)}
              />
            </div>
            <div>
              <label className="label">Last name</label>
              <input
                className="field"
                value={contactDraft.last_name ?? ''}
                disabled={disabled}
                onChange={(e) => onChange('last_name', e.target.value || null)}
              />
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="field"
              type="email"
              value={contactDraft.email ?? ''}
              disabled={disabled}
              onChange={(e) => onChange('email', e.target.value || null)}
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              className="field"
              type="tel"
              value={contactDraft.phone ?? ''}
              disabled={disabled}
              onChange={(e) => onChange('phone', e.target.value || null)}
            />
          </div>
          <div>
            <label className="label">Note</label>
            <textarea
              className="field h-16"
              value={contactDraft.note ?? ''}
              disabled={disabled}
              onChange={(e) => onChange('note', e.target.value || null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function nullable(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function toInsert(r: DafRow, charityId: string) {
  return {
    charity_id: charityId,
    ein: r.ein,
    display_name: r.name,
    address_line1: r.street,
    city: r.city,
    state: r.state,
    postal_code: r.zip,
    filing_revenue: r.revenue,
    filing_income: r.income,
    filing_assets: r.assets,
    filing_tax_period: r.tax_period,
  };
}
