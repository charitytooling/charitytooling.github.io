// Research deep-link builders used by the Update page chip strip.
//
// Each provider builder is a pure function over CustomerRow. Where a provider
// needs a field the customer might not have (EIN, full address, state), the
// builder returns null so the caller can omit the chip rather than render a
// broken link. Builders that fall back to a name search return string.
//
// Keeping this module React-free makes it trivial to reuse on the Contact /
// CharityDetail pages later and keeps Update.tsx scannable.

import { displayName, primaryContact } from '@/state/customers';

// Minimal structural shape the research builders read. CustomerRow satisfies it,
// and the Search page builds one from a BmfOrg — so both the Update page and the
// Search org-detail modal render from the same RESEARCH_PROVIDERS list below.
export type ResearchSubject = {
  display_name: string | null;
  ein: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  customer_contacts?: Array<{
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    is_primary: boolean;
  }>;
};

// -----------------------------------------------------------------------------
// EIN helpers
// -----------------------------------------------------------------------------

// Strip non-digits and pad to 9 chars. Handles user-entered values like
// "12-3456789" as well as our DAF-imported 9-char zero-padded EINs. Returns
// null when the customer has no EIN or the value has no digits at all.
function einDigits(ein: string | null | undefined): string | null {
  if (!ein) return null;
  const digits = ein.replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(9, '0').slice(-9);
}

// IRS-style "dd-ddddddd". Used by the IRS Tax Exempt Org Search form, which
// won't auto-insert the dash for you.
function einFormatted(ein: string | null | undefined): string | null {
  const d = einDigits(ein);
  if (!d) return null;
  return `${d.slice(0, 2)}-${d.slice(2)}`;
}

// -----------------------------------------------------------------------------
// Query helpers
// -----------------------------------------------------------------------------

// Just the org name, encoded. Used by org-level searches (LinkedIn Company,
// Google News, etc.) where appending a contact-email domain would only add
// noise.
function orgQuery(c: ResearchSubject): string {
  return encodeURIComponent(displayName(c));
}

// Org name + primary contact's email domain, encoded. Used by people-focused
// searches where the domain helps disambiguate (e.g. finding a person at
// "@example.org" via LinkedIn People). Mirrors the original Update.tsx
// behavior so the existing LinkedIn / Google / Facebook chips keep working
// the same way.
function peopleQuery(c: ResearchSubject): string {
  const primary = primaryContact(c);
  const domain = primary?.email ? primary.email.split('@')[1] : '';
  const base = displayName(c) + (domain ? ` ${domain}` : '');
  return encodeURIComponent(base);
}

// Comma-joined "street, city, state postal_code", with empty parts dropped.
// Returns null only when EVERY address field is empty.
function fullAddress(c: ResearchSubject): string | null {
  const street = c.address_line1?.trim();
  const city = c.city?.trim();
  const state = c.state?.trim();
  const postal = c.postal_code?.trim();
  // "MA 02110" - state + zip render better as one token than as two
  // comma-separated parts.
  const stateZip = [state, postal].filter(Boolean).join(' ');
  const parts = [street, city, stateZip].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return parts.join(', ');
}

// -----------------------------------------------------------------------------
// Provider URL builders
// -----------------------------------------------------------------------------

// ---- EIN-required (null when EIN missing) ----

export function propublicaUrl(c: ResearchSubject): string | null {
  const d = einDigits(c.ein);
  if (!d) return null;
  return `https://projects.propublica.org/nonprofits/organizations/${d}`;
}

export function irsTeosUrl(c: ResearchSubject): string | null {
  const f = einFormatted(c.ein);
  if (!f) return null;
  return `https://apps.irs.gov/app/eos/allSearch?ein1=${encodeURIComponent(f)}&dispatchMethod=searchAll`;
}

// ---- EIN-preferred, name fallback (always string) ----

function einOrName(c: ResearchSubject): string {
  return encodeURIComponent(einDigits(c.ein) ?? displayName(c));
}

export function candidUrl(c: ResearchSubject): string {
  return `https://www.guidestar.org/search?q=${einOrName(c)}`;
}

export function causeIqUrl(c: ResearchSubject): string {
  return `https://www.causeiq.com/search/?q=${einOrName(c)}`;
}

export function charityNavigatorUrl(c: ResearchSubject): string {
  return `https://www.charitynavigator.org/search?q=${einOrName(c)}`;
}

// ---- Address-required ----

export function googleMapsUrl(c: ResearchSubject): string | null {
  const addr = fullAddress(c);
  if (!addr) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}

// ---- State-required (Bizapedia indexes by state) ----

export function bizapediaUrl(c: ResearchSubject): string | null {
  const state = c.state?.trim();
  if (!state) return null;
  const q = encodeURIComponent(`${displayName(c)} ${state}`);
  return `https://www.bizapedia.com/search/?q=${q}`;
}

// ---- Name-only (always string) ----

export function linkedInCompanyUrl(c: ResearchSubject): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${orgQuery(c)}`;
}

export function googleNewsUrl(c: ResearchSubject): string {
  return `https://news.google.com/search?q=${orgQuery(c)}`;
}

export function xUrl(c: ResearchSubject): string {
  return `https://x.com/search?q=${orgQuery(c)}`;
}

export function youtubeUrl(c: ResearchSubject): string {
  return `https://www.youtube.com/results?search_query=${orgQuery(c)}`;
}

// ---- Pre-existing three (lifted out of Update.tsx) ----

export function linkedInPeopleUrl(c: ResearchSubject): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${peopleQuery(c)}`;
}

export function googleUrl(c: ResearchSubject): string {
  return `https://www.google.com/search?q=${peopleQuery(c)}`;
}

export function facebookUrl(c: ResearchSubject): string {
  return `https://www.facebook.com/search/people/?q=${peopleQuery(c)}`;
}

// -----------------------------------------------------------------------------
// The single, ordered provider list. Add / remove / reorder here and every
// place that renders <ResearchChips> (the Update page and the Search org-detail
// modal) updates together.
// -----------------------------------------------------------------------------

export type ResearchProvider = { label: string; build: (c: ResearchSubject) => string | null };

export const RESEARCH_PROVIDERS: ResearchProvider[] = [
  { label: 'ProPublica', build: propublicaUrl },
  { label: 'IRS TEOS', build: irsTeosUrl },
  { label: 'Candid', build: candidUrl },
  { label: 'Cause IQ', build: causeIqUrl },
  { label: 'Charity Navigator', build: charityNavigatorUrl },
  { label: 'Maps', build: googleMapsUrl },
  { label: 'Bizapedia', build: bizapediaUrl },
  { label: 'LinkedIn (Co)', build: linkedInCompanyUrl },
  { label: 'LinkedIn', build: linkedInPeopleUrl },
  { label: 'Google', build: googleUrl },
  { label: 'Google News', build: googleNewsUrl },
  { label: 'Facebook', build: facebookUrl },
  { label: 'X', build: xUrl },
  { label: 'YouTube', build: youtubeUrl },
];
