import { useDonations } from '@/state/donations';
import { useMyCharities } from '@/state/charities';
import type { CustomerRow } from '@/state/customers';
import { compactMoney } from '@/lib/format';

// Render the IRS tax period (stored as YYYYMM, e.g. "202412") as a phrase that
// reads naturally on the customer overview, e.g. "990 for 2024". Falls back to
// the raw value if it does not start with four digits.
function formatTaxPeriod(raw: string): string {
  const match = raw.match(/^(\d{4})/);
  if (!match) return raw;
  return `990 for ${match[1]}`;
}

export function CompanyOverview({ customer }: { customer: CustomerRow }) {
  const donations = useDonations(customer.id);
  const charities = useMyCharities();

  const addressLines = formatAddressLines(customer);
  const hasAddress = addressLines.length > 0;
  const mapsLinkable = !!customer.address_line1 || !!(customer.city && customer.state);

  const givingCents = (donations.data ?? []).reduce((sum, d) => sum + d.amount_cents, 0);
  const givingValue = donations.isLoading ? '...' : compactMoney(givingCents / 100);
  const charityName = charities.data?.find((c) => c.id === customer.charity_id)?.name;
  const givingLabel = charityName ? `Giving to date for ${charityName}` : 'Giving to date';

  const tags = customer.tags ?? [];
  const preferred = labelPreferred(customer.preferred_contact_method);

  const hasAnyFiling =
    !!customer.ein ||
    customer.filing_revenue != null ||
    customer.filing_income != null ||
    customer.filing_assets != null ||
    !!customer.filing_tax_period;

  return (
    <div className="border-t border-ink-100 dark:border-ink-800 mt-3 pt-3 space-y-3">
      {hasAnyFiling && (
        <div className="text-center">
          {customer.ein && (
            <div className="text-xs text-ink-400 dark:text-ink-500 tabular-nums">
              EIN {customer.ein}
            </div>
          )}
          <div className="text-xs text-ink-500 dark:text-ink-400">
            {customer.filing_tax_period
              ? `From the ${formatTaxPeriod(customer.filing_tax_period)}:`
              : 'From the latest filing:'}
          </div>
          <div className="mt-1 grid grid-cols-3 gap-3">
            <FilingCell label="Revenue" value={customer.filing_revenue} />
            <FilingCell label="Income" value={customer.filing_income} />
            <FilingCell label="Assets" value={customer.filing_assets} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {hasAddress && (
          <Field label="Address">
            {mapsLinkable ? (
              <a
                href={mapsHref(addressLines)}
                target="_blank"
                rel="noreferrer"
                className="hover:text-accent whitespace-pre-line not-italic"
              >
                {addressLines.join('\n')}
              </a>
            ) : (
              <span className="whitespace-pre-line">{addressLines.join('\n')}</span>
            )}
          </Field>
        )}
        <Field label={givingLabel}>{givingValue}</Field>
        {preferred && <Field label="Preferred contact">{preferred}</Field>}
      </div>

      {tags.length > 0 && (
        <div>
          <div className="text-xs text-ink-500 dark:text-ink-400">Tags</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded-full bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 text-xs"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-500 dark:text-ink-400">{label}</div>
      <div className="text-sm text-ink-700 dark:text-ink-200 break-words">{children}</div>
    </div>
  );
}

function FilingCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-ink-700 dark:text-ink-200 tabular-nums">
        {value == null ? '-' : compactMoney(value)}
      </div>
      <div className="text-xs text-ink-500 dark:text-ink-400">{label}</div>
    </div>
  );
}

function formatAddressLines(c: CustomerRow): string[] {
  const lines: string[] = [];
  const street = [c.address_line1, c.address_line2].filter(Boolean).join(', ');
  if (street) lines.push(street);

  const cityStatePostal = [
    [c.city, c.state].filter(Boolean).join(', '),
    c.postal_code,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (cityStatePostal) lines.push(cityStatePostal);

  if (c.country) lines.push(c.country);
  return lines;
}

function mapsHref(addressLines: string[]): string {
  const query = encodeURIComponent(addressLines.join(', '));
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function labelPreferred(value: CustomerRow['preferred_contact_method']): string | null {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
