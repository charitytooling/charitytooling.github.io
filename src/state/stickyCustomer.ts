import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveCharity } from './activeCharity';

// Per-charity "sticky" customer id: whatever customer the user has open on
// Update or Contact "follows" them when they tap the other tab. Backed by
// localStorage for refresh-safety and mirrored into the React Query cache so
// long-lived components (notably BottomNav) re-render when it changes without
// having to remount.

function storageKey(charityId: string) {
  return `ct.stickyCustomer:${charityId}`;
}

function readFromStorage(charityId: string): string | null {
  try {
    return localStorage.getItem(storageKey(charityId));
  } catch {
    return null;
  }
}

function writeToStorage(charityId: string, id: string | null) {
  try {
    if (id) localStorage.setItem(storageKey(charityId), id);
    else localStorage.removeItem(storageKey(charityId));
  } catch {
    /* ignore */
  }
}

export function useStickyCustomer(): string | null {
  const { activeCharityId } = useActiveCharity();
  const { data } = useQuery({
    queryKey: ['stickyCustomer', activeCharityId],
    enabled: !!activeCharityId,
    queryFn: () => readFromStorage(activeCharityId!),
    initialData: activeCharityId ? readFromStorage(activeCharityId) : null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? null;
}

export function useSetStickyCustomer(): (id: string | null) => void {
  const qc = useQueryClient();
  const { activeCharityId } = useActiveCharity();
  return useCallback(
    (id: string | null) => {
      if (!activeCharityId) return;
      writeToStorage(activeCharityId, id);
      qc.setQueryData(['stickyCustomer', activeCharityId], id);
    },
    [qc, activeCharityId],
  );
}
