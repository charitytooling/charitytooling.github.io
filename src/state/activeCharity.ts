import { useEffect, useState } from 'react';
import { useMyCharities } from './charities';

const STORAGE_KEY = 'ct.activeCharityId';

function readInitial(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useActiveCharity() {
  const { data: charities } = useMyCharities();
  const [activeCharityId, setActiveCharityIdState] = useState<string | null>(readInitial);

  useEffect(() => {
    if (!charities || charities.length === 0) return;
    const valid = activeCharityId && charities.some((c) => c.id === activeCharityId);
    if (!valid) {
      setActiveCharityIdState(charities[0].id);
    }
  }, [charities, activeCharityId]);

  function setActiveCharityId(id: string | null) {
    setActiveCharityIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  return { activeCharityId, setActiveCharityId };
}
