import { useCallback, useEffect, useRef, useState } from 'react';

// Trailing-edge debounce for autosave inputs. Owns the timer, the latest
// pending payload, the four-state status indicator, and an unmount-flush
// safety net. Used by the Update page so a long pause between keystrokes
// settles into a single network write per typing burst, while a snap
// navigation away (Save & next, Skip, route change) still persists the
// last keystrokes the user typed.
//
// Generic over the payload shape so each call site can encode its own
// (key, value) pair, single string, etc. The save function captures the
// up-to-date mutation closure each render via a ref, so the timer and
// flush callbacks always see the freshest reference even though they are
// installed once with `useCallback([])` deps.

export type DebouncedSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseDebouncedSaveResult<T> {
  schedule: (value: T) => void;
  flushSync: () => void;
  status: DebouncedSaveStatus;
  setIdle: () => void;
}

export function useDebouncedSave<T>(
  save: (value: T) => Promise<unknown>,
  ms: number = 1000,
): UseDebouncedSaveResult<T> {
  const [status, setStatus] = useState<DebouncedSaveStatus>('idle');
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<T | null>(null);
  const saveRef = useRef(save);

  // Keep the latest save fn in a ref so timer / flush callbacks always
  // see the freshest closure. The consumer's mutation function (e.g.
  // `update.mutateAsync`) is a new identity on every render but is
  // operationally stable; reading through the ref keeps `schedule` and
  // `flushSync` referentially stable so they don't re-fire effects.
  useEffect(() => {
    saveRef.current = save;
  });

  const flushSync = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending !== null) {
      pendingRef.current = null;
      // Fire-and-forget: by the time flushSync runs from an unmount
      // cleanup the status indicator is gone and there's nothing to
      // surface a result onto. The underlying mutation hook still
      // invalidates query caches on success, so the destination
      // component sees the saved row on its next render.
      void saveRef.current(pending);
    }
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pendingRef.current = value;
      setStatus('saving');
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(async () => {
        timerRef.current = null;
        const v = pendingRef.current;
        pendingRef.current = null;
        if (v === null) return;
        try {
          await saveRef.current(v);
          setStatus('saved');
        } catch {
          setStatus('error');
        }
      }, ms);
    },
    [ms],
  );

  // Flush pending writes on unmount so navigating away or hitting
  // "Save & next" within the debounce window never drops the last
  // keystrokes. flushSync is referentially stable, so this effect runs
  // its cleanup exactly once - on unmount.
  useEffect(() => () => flushSync(), [flushSync]);

  const setIdle = useCallback(() => setStatus('idle'), []);

  return { schedule, flushSync, status, setIdle };
}
