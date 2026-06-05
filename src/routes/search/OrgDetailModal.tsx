import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { supabase } from '@/lib/supabase';
import { compactMoney, formatWholeUSD } from '@/lib/format';
import {
  assetRevenueTier,
  foundationLabel,
  formatRuling,
  nteeMajorLabel,
  statusLabel,
  subsectionLabel,
} from '@/lib/bmfLookups';
import {
  bmfOrgToLedgerInput,
  useAddOrgToLedger,
  type BmfOrg,
} from '@/state/orgs';
import type { ContactDraft } from '@/lib/customerHelpers';
import type { Database } from '@/lib/database.types';
import { ResearchChips } from '@/components/ResearchChips';
import type { ResearchSubject } from '@/lib/researchLinks';

type DafHistRow = Database['public']['Tables']['daf_history']['Row'];

export function OrgDetailModal({
  org,
  charityId,
  inLedger,
  onClose,
}: {
  org: BmfOrg;
  charityId: string | null;
  inLedger: boolean;
  onClose: () => void;
}) {
  const add = useAddOrgToLedger(charityId);
  const [showContact, setShowContact] = useState(false);
  const [contact, setContact] = useState<ContactDraft>({});
  const isIn = inLedger || add.isSuccess;

  const { data: history } = useQuery({
    queryKey: ['daf_history', org.ein],
    enabled: !!org.is_daf_sponsor,
    queryFn: async (): Promise<DafHistRow[]> => {
      const { data, error } = await supabase
        .from('daf_history')
        .select('*')
        .eq('ein', org.ein)
        .order('year', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const researchSubject: ResearchSubject = {
    display_name: org.name,
    ein: org.ein,
    address_line1: org.street,
    city: org.city,
    state: org.state,
    postal_code: org.zip,
    customer_contacts: [],
  };
  const ratioTier = assetRevenueTier(org.revenue, org.assets);
  const setField = (k: keyof ContactDraft, v: string) =>
    setContact((c) => ({ ...c, [k]: v || null }));

  return (
    <Modal title={org.name} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <Badge>{subsectionLabel(org.subsection)}</Badge>
          {org.org_type && (
            <Badge>
              {org.org_type === 'public_charity' ? 'Public charity' : 'Private foundation'}
            </Badge>
          )}
          {org.is_daf_sponsor && <Badge tone="accent">DAF sponsor</Badge>}
          <Badge>EIN {org.ein}</Badge>
        </div>

        <Section title="Financials (most recent filing)">
          <Row label="Revenue" value={org.revenue != null ? formatWholeUSD(org.revenue) : '—'} />
          <Row label="Income" value={org.income != null ? formatWholeUSD(org.income) : '—'} />
          <Row label="Assets" value={org.assets != null ? formatWholeUSD(org.assets) : '—'} />
          <Row
            label="Assets ÷ Revenue"
            value={ratioTier ? ratioTier.detail : '—'}
            valueClass={ratioTier?.textClass}
          />
          <Row label="Tax period" value={org.tax_period ?? '—'} />
        </Section>

        <Section title="Classification">
          <Row label="Subsection" value={subsectionLabel(org.subsection)} />
          <Row label="Foundation" value={foundationLabel(org.foundation_code)} />
          <Row label="Status" value={statusLabel(org.status)} />
          <Row
            label="NTEE"
            value={`${org.ntee ?? '—'}${org.ntee_major ? ` · ${nteeMajorLabel(org.ntee_major)}` : ''}`}
          />
          <Row label="IRS ruling" value={formatRuling(org.ruling)} />
        </Section>

        <Section title="Address">
          <Row label="Street" value={org.street ?? '—'} />
          <Row label="City / State" value={[org.city, org.state].filter(Boolean).join(', ') || '—'} />
          <Row label="ZIP" value={org.zip ?? '—'} />
          {org.in_care_of && <Row label="In care of" value={org.in_care_of} />}
        </Section>

        {org.is_daf_sponsor && history && history.length > 0 && (
          <Section title="DAF history">
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs tabular-nums">
                <thead className="text-ink-500 dark:text-ink-400">
                  <tr>
                    <th className="text-left font-medium py-1">Year</th>
                    <th className="text-right font-medium">Accts</th>
                    <th className="text-right font-medium">Grants</th>
                    <th className="text-right font-medium">Assets</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.year} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-1">{h.year}</td>
                      <td className="text-right">{h.accounts?.toLocaleString() ?? '—'}</td>
                      <td className="text-right">{h.grants != null ? compactMoney(h.grants) : '—'}</td>
                      <td className="text-right">{h.assets != null ? compactMoney(h.assets) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        <Section title="Research">
          <div className="flex flex-wrap gap-2 text-xs">
            <ResearchChips subject={researchSubject} />
          </div>
        </Section>

        <div className="pt-2 border-t border-ink-100 dark:border-ink-800">
          {isIn ? (
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              ✓ In this charity&apos;s ledger
            </p>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                className="text-xs text-ink-500 dark:text-ink-400"
                onClick={() => setShowContact((v) => !v)}
              >
                {showContact ? '− Hide contact fields' : '+ Add a primary contact (optional)'}
              </button>
              {showContact && (
                <div className="grid grid-cols-2 gap-2">
                  <input className="field" placeholder="First name" value={contact.first_name ?? ''} onChange={(e) => setField('first_name', e.target.value)} />
                  <input className="field" placeholder="Last name" value={contact.last_name ?? ''} onChange={(e) => setField('last_name', e.target.value)} />
                  <input className="field col-span-2" type="email" placeholder="Email" value={contact.email ?? ''} onChange={(e) => setField('email', e.target.value)} />
                  <input className="field col-span-2" type="tel" placeholder="Phone" value={contact.phone ?? ''} onChange={(e) => setField('phone', e.target.value)} />
                </div>
              )}
              {add.error && <p className="text-sm text-red-600">{(add.error as Error).message}</p>}
              <button
                type="button"
                className="btn w-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500 dark:disabled:bg-ink-800"
                disabled={!charityId || add.isPending}
                onClick={() =>
                  add.mutate({
                    org: bmfOrgToLedgerInput(org),
                    contact: showContact ? contact : undefined,
                  })
                }
              >
                {add.isPending ? 'Adding…' : 'Add to ledger'}
              </button>
              {!charityId && (
                <p className="text-xs text-ink-500 dark:text-ink-400">
                  Pick a charity in the top bar first.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-500 dark:text-ink-400">{label}</span>
      <span className={`text-right ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone?: 'accent' }) {
  return (
    <span
      className={[
        'rounded-full px-2 py-0.5 text-[11px]',
        tone === 'accent'
          ? 'bg-accent/10 text-accent'
          : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
      ].join(' ')}
    >
      {children}
    </span>
  );
}
