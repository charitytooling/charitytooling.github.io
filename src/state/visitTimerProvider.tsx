import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useActiveCharity } from '@/state/activeCharity';
import { useStickyCustomer } from '@/state/stickyCustomer';

const MIN_VISIT_SECONDS = 3;

interface VisitTimerCtx {
  activeCustomerId: string | null;
  seconds: number;
}

const Ctx = createContext<VisitTimerCtx>({
  activeCustomerId: null,
  seconds: 0,
});

// Single source of truth for the per-customer visit timer.
// activeCustomerId follows the route (Contact/:id or Update?id|sticky), so
// going Contact->Update for the same person keeps the same visit running.
// The internal effect's dep array is [activeCustomerId, charityId, userId],
// so an A->A transition across a route change does NOT re-run the effect
// (and therefore does NOT split the visit).
export function VisitTimerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const { activeCharityId } = useActiveCharity();
  const sticky = useStickyCustomer();
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const qc = useQueryClient();

  const activeCustomerId = useMemo<string | null>(() => {
    const m = pathname.match(/^\/contact\/([^/]+)$/);
    if (m) return m[1];
    if (pathname === '/update') return search.get('id') ?? sticky;
    return null;
  }, [pathname, search, sticky]);

  const [seconds, setSeconds] = useState(0);
  const segmentStart = useRef<number | null>(null);
  const accumulated = useRef(0);
  const initialStart = useRef<string>(new Date().toISOString());

  useEffect(() => {
    if (!activeCustomerId || !activeCharityId) {
      setSeconds(0);
      return;
    }

    setSeconds(0);
    accumulated.current = 0;
    initialStart.current = new Date().toISOString();
    segmentStart.current =
      typeof document === 'undefined' || document.visibilityState !== 'hidden'
        ? Date.now()
        : null;

    let interval: number | null = null;

    const tick = () => {
      const live = segmentStart.current
        ? Math.floor((Date.now() - segmentStart.current) / 1000)
        : 0;
      setSeconds(accumulated.current + live);
    };

    const startTicking = () => {
      tick();
      interval = window.setInterval(tick, 1000);
    };

    const stopTicking = () => {
      if (interval != null) window.clearInterval(interval);
      interval = null;
    };

    const persistVisit = () => {
      if (!user?.id) return;
      const total =
        accumulated.current +
        (segmentStart.current
          ? Math.floor((Date.now() - segmentStart.current) / 1000)
          : 0);
      if (total < MIN_VISIT_SECONDS) return;
      // Promise is allowed to outlive the effect cleanup (which can't be
      // async). On success, invalidate ['my_activity'] so MePage refetches
      // even if it queried before the row landed; on failure, log the
      // Supabase error instead of swallowing it.
      supabase
        .from('customer_visits')
        .insert({
          customer_id: activeCustomerId,
          charity_id: activeCharityId,
          user_id: user.id,
          started_at: initialStart.current,
          ended_at: new Date().toISOString(),
          duration_seconds: total,
        })
        .then(({ error }) => {
          if (error) {
            console.error('[visit] persist failed', error);
            return;
          }
          qc.invalidateQueries({ queryKey: ['my_activity'] });
        });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (segmentStart.current) {
          accumulated.current += Math.floor(
            (Date.now() - segmentStart.current) / 1000,
          );
          segmentStart.current = null;
          stopTicking();
          // Best-effort flush in case the tab is being closed; if the user
          // returns we'll write a fresher row on real unmount/customer-change.
          persistVisit();
        }
      } else if (!segmentStart.current) {
        segmentStart.current = Date.now();
        startTicking();
      }
    };

    if (segmentStart.current) startTicking();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopTicking();
      document.removeEventListener('visibilitychange', onVisibility);
      persistVisit();
    };
  }, [activeCustomerId, activeCharityId, user?.id]);

  return (
    <Ctx.Provider value={{ activeCustomerId, seconds }}>{children}</Ctx.Provider>
  );
}

export function useVisitTimerState() {
  return useContext(Ctx);
}
