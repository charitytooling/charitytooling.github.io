import { useMemo } from 'react';
import { displayName, useCustomers, type CustomerRow } from './customers';
import { useCustomerIdsWithOpenFollowUps, useOpenFollowUpsByCustomer } from './notes';
import { useProfile, type ContactQueueSort } from './profile';

// One queue definition shared by ContactNav (Prev/Next) and the bare /contact
// landing redirect. The user's saved sort preference (profiles.contact_queue_sort)
// chooses the comparator; the filter narrows to customers worth working through.
export function useContactQueue(charityId: string | null) {
  const customers = useCustomers(charityId);
  const followUpIds = useCustomerIdsWithOpenFollowUps(charityId);
  const dueByCustomer = useOpenFollowUpsByCustomer(charityId);
  const profile = useProfile();
  const sort: ContactQueueSort = profile.data?.contact_queue_sort ?? 'stalest_first';

  // Locked per [charityId, sort] so the random ordering stays stable while the
  // user clicks Next/Prev within a session, but reshuffles on reload or when
  // they change the preference.
  const seed = useMemo(() => Math.random(), [charityId, sort]);

  return useMemo<CustomerRow[]>(() => {
    const all = customers.data ?? [];
    const followSet = followUpIds.data ?? new Set<string>();
    const due = dueByCustomer.data ?? new Map<string, number>();

    // 'followup_due_soonest' narrows to customers that actually have a due date
    // (otherwise the sort key is undefined for half the list). Every other sort
    // keeps the original "incomplete OR has open follow-up" actionable filter.
    const base =
      sort === 'followup_due_soonest'
        ? all.filter((c) => followSet.has(c.id))
        : all.filter((c) => (c.completeness_score ?? 0) < 100 || followSet.has(c.id));

    return [...base].sort(getComparator(sort, due, seed));
  }, [customers.data, followUpIds.data, dueByCustomer.data, sort, seed]);
}

function getComparator(
  sort: ContactQueueSort,
  due: Map<string, number>,
  seed: number,
): (a: CustomerRow, b: CustomerRow) => number {
  switch (sort) {
    case 'followup_due_soonest':
      return byFollowUpDueAsc(due);
    case 'name_az':
      return byNameAsc;
    case 'newest_added':
      return byCreatedDesc;
    case 'random':
      return byRandom(seed);
    case 'stalest_first':
    default:
      return byLastContactedAsc;
  }
}

function byLastContactedAsc(a: CustomerRow, b: CustomerRow): number {
  const aT = a.last_contacted_at ? new Date(a.last_contacted_at).getTime() : -Infinity;
  const bT = b.last_contacted_at ? new Date(b.last_contacted_at).getTime() : -Infinity;
  if (aT !== bT) return aT - bT;
  return displayName(a).localeCompare(displayName(b));
}

function byFollowUpDueAsc(due: Map<string, number>) {
  return (a: CustomerRow, b: CustomerRow): number => {
    const aT = due.get(a.id) ?? Infinity;
    const bT = due.get(b.id) ?? Infinity;
    if (aT !== bT) return aT - bT;
    return displayName(a).localeCompare(displayName(b));
  };
}

function byNameAsc(a: CustomerRow, b: CustomerRow): number {
  return displayName(a).localeCompare(displayName(b));
}

function byCreatedDesc(a: CustomerRow, b: CustomerRow): number {
  const aT = new Date(a.created_at).getTime();
  const bT = new Date(b.created_at).getTime();
  if (aT !== bT) return bT - aT;
  return displayName(a).localeCompare(displayName(b));
}

function byRandom(seed: number) {
  return (a: CustomerRow, b: CustomerRow): number => {
    const aH = stableHash(a.id, seed);
    const bH = stableHash(b.id, seed);
    if (aH !== bH) return aH - bH;
    return a.id.localeCompare(b.id);
  };
}

// FNV-1a 32-bit hash mixed with the per-session seed. Deterministic for a
// given (id, seed) pair so the sort comparator is stable across re-renders.
function stableHash(s: string, seed: number): number {
  let h = (2166136261 ^ Math.floor(seed * 0xffffffff)) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
