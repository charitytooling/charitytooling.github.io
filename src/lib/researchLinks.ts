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
import type { CustomerRow } from '@/state/customers';

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
function orgQuery(c: CustomerRow): string {
  return encodeURIComponent(displayName(c));
}

// Org name + primary contact's email domain, encoded. Used by people-focused
// searches where the domain helps disambiguate (e.g. finding a person at
// "@example.org" via LinkedIn People). Mirrors the original Update.tsx
// behavior so the existing LinkedIn / Google / Facebook chips keep working
// the same way.
function peopleQuery(c: CustomerRow): string {
  const primary = primaryContact(c);
  const domain = primary?.email ? primary.email.split('@')[1] : '';
  const base = displayName(c) + (domain ? ` ${domain}` : '');
  return encodeURIComponent(base);
}

// Comma-joined "street, city, state postal_code", with empty parts dropped.
// Returns null only when EVERY address field is empty.
function fullAddress(c: CustomerRow): string | null {
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

export function propublicaUrl(c: CustomerRow): string | null {
  const d = einDigits(c.ein);
  if (!d) return null;
  return `https://projects.propublica.org/nonprofits/organizations/${d}`;
}

export function irsTeosUrl(c: CustomerRow): string | null {
  const f = einFormatted(c.ein);
  if (!f) return null;
  return `https://apps.irs.gov/app/eos/allSearch?ein1=${encodeURIComponent(f)}&dispatchMethod=searchAll`;
}

// ---- EIN-preferred, name fallback (always string) ----

function einOrName(c: CustomerRow): string {
  return encodeURIComponent(einDigits(c.ein) ?? displayName(c));
}

export function candidUrl(c: CustomerRow): string {
  return `https://www.guidestar.org/search?q=${einOrName(c)}`;
}

export function causeIqUrl(c: CustomerRow): string {
  return `https://www.causeiq.com/search/?q=${einOrName(c)}`;
}

export function charityNavigatorUrl(c: CustomerRow): string {
  return `https://www.charitynavigator.org/search?q=${einOrName(c)}`;
}

// ---- Address-required ----

export function googleMapsUrl(c: CustomerRow): string | null {
  const addr = fullAddress(c);
  if (!addr) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}

// ---- State-required (Bizapedia indexes by state) ----

export function bizapediaUrl(c: CustomerRow): string | null {
  const state = c.state?.trim();
  if (!state) return null;
  const q = encodeURIComponent(`${displayName(c)} ${state}`);
  return `https://www.bizapedia.com/search/?q=${q}`;
}

// ---- Name-only (always string) ----

export function linkedInCompanyUrl(c: CustomerRow): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${orgQuery(c)}`;
}

export function googleNewsUrl(c: CustomerRow): string {
  return `https://news.google.com/search?q=${orgQuery(c)}`;
}

export function xUrl(c: CustomerRow): string {
  return `https://x.com/search?q=${orgQuery(c)}`;
}

export function youtubeUrl(c: CustomerRow): string {
  return `https://www.youtube.com/results?search_query=${orgQuery(c)}`;
}

// ---- Pre-existing three (lifted out of Update.tsx) ----

export function linkedInPeopleUrl(c: CustomerRow): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${peopleQuery(c)}`;
}

export function googleUrl(c: CustomerRow): string {
  return `https://www.google.com/search?q=${peopleQuery(c)}`;
}

export function facebookUrl(c: CustomerRow): string {
  return `https://www.facebook.com/search/people/?q=${peopleQuery(c)}`;
}
