import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useActiveCharity } from '@/state/activeCharity';
import {
  displayName,
  useCustomer,
  useUpdateCustomer,
  type CustomerRow,
} from '@/state/customers';

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
        <p className="mt-2 text-ink-500 text-sm">Pick or create a charity to start updating.</p>
      </div>
    );
  }

  if (!activeId && nextQuery.isLoading) {
    return <div className="mx-auto max-w-2xl px-4 py-6 text-ink-400">Loading...</div>;
  }

  if (!activeId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
        <h1 className="text-xl font-semibold">All caught up</h1>
        <p className="text-ink-500 text-sm">Every customer has a 100% completeness score.</p>
        <button type="button" className="btn-primary w-full" onClick={() => navigate('/ledger')}>
          Go to Ledger
        </button>
      </div>
    );
  }

  if (customer.isLoading || !customer.data) {
    return <div className="mx-auto max-w-2xl px-4 py-6 text-ink-400">Loading...</div>;
  }

  return <UpdateForm customer={customer.data} onNext={nextCustomer} />;
}

const FIELDS: { key: keyof CustomerRow; label: string; type?: string }[] = [
  { key: 'display_name', label: 'Display name' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'website', label: 'Website', type: 'url' },
  { key: 'address_line1', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postal_code', label: 'ZIP' },
  { key: 'preferred_contact_method', label: 'Preferred contact', type: 'select' },
];

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

  const queryName = encodeURIComponent(
    displayName(customer) + (customer.email ? ` ${customer.email.split('@')[1]}` : ''),
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 space-y-4">
      <header className="card">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold truncate">{displayName(customer)}</h1>
          <span className="text-xs font-medium text-ink-500">{customer.completeness_score}% complete</span>
        </div>
        <div className="mt-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
          <div className="h-full bg-accent" style={{ width: `${customer.completeness_score}%` }} />
        </div>
        <div className="flex gap-2 mt-3 text-xs">
          <ResearchLink label="LinkedIn" href={`https://www.linkedin.com/search/results/people/?keywords=${queryName}`} />
          <ResearchLink label="Google" href={`https://www.google.com/search?q=${queryName}`} />
          <ResearchLink label="Facebook" href={`https://www.facebook.com/search/people/?q=${queryName}`} />
        </div>
      </header>

      <section className="card space-y-3">
        {FIELDS.map((f) => (
          <div key={f.key as string}>
            <label className="label">{f.label}</label>
            {f.type === 'select' && f.key === 'preferred_contact_method' ? (
              <select
                className="field"
                value={(currentValue('preferred_contact_method') as string | null) ?? ''}
                onChange={(e) => setField('preferred_contact_method', (e.target.value || null) as CustomerRow['preferred_contact_method'])}
              >
                <option value="">(none)</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="mail">Mail</option>
              </select>
            ) : (
              <input
                className="field"
                type={f.type ?? 'text'}
                value={(currentValue(f.key) as string | null) ?? ''}
                onChange={(e) => setField(f.key, e.target.value as never)}
              />
            )}
          </div>
        ))}
        <p className="text-xs text-ink-500">
          {status === 'saving' && 'Saving...'}
          {status === 'saved' && 'Saved'}
          {status === 'error' && <span className="text-red-600">Save failed - try again.</span>}
          {status === 'idle' && '\u00a0'}
        </p>
      </section>

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
      className="px-3 py-1.5 rounded-full bg-ink-100 text-ink-700 font-medium"
    >
      Search {label}
    </a>
  );
}
