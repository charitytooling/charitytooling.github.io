import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';

// SessionTracker records real "time in the app" per user into public.app_sessions,
// feeding the super-admin activity digest. It mirrors the segment/visibility
// bookkeeping of the per-customer visit timer (see visitTimerProvider.tsx) but
// at the app level: one open session row that is extended while the tab is
// visible and flushed on backgrounding/unmount.
//
//   * Only foreground time counts: on visibilitychange -> hidden we accumulate
//     the live segment, flush, and stop; on -> visible we resume.
//   * A heartbeat persists progress every HEARTBEAT_MS so a hard tab kill loses
//     at most that interval (important on iOS, which reaps PWA tabs).
//   * After a long hidden gap or a local-day rollover we close the current row
//     and open a fresh one, so the digest's trailing-window attribution stays
//     clean.
//
// Renders nothing; mount once inside the authenticated Layout.

const HEARTBEAT_MS = 60_000;
const IDLE_GAP_MS = 30 * 60_000;
const MIN_PERSIST_SECONDS = 5;

function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function SessionTracker() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // All mutable bookkeeping lives in refs so the single effect below never has
  // to re-run on tick.
  const sessionId = useRef<string | null>(null);
  const starting = useRef(false);
  const segmentStart = useRef<number | null>(null);
  const accumulated = useRef(0);
  const startedDay = useRef<string>(todayYmd());
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    if (!userId) return;

    let heartbeat: number | null = null;
    let cancelled = false;

    const liveSeconds = () => {
      const total =
        accumulated.current +
        (segmentStart.current ? Math.floor((Date.now() - segmentStart.current) / 1000) : 0);
      return total;
    };

    const startSession = async () => {
      if (starting.current || sessionId.current) return;
      starting.current = true;
      accumulated.current = 0;
      segmentStart.current = Date.now();
      startedDay.current = todayYmd();
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('app_sessions')
        .insert({
          user_id: userId,
          started_at: nowIso,
          last_seen_at: nowIso,
          duration_seconds: 0,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        })
        .select('id')
        .single();
      starting.current = false;
      if (cancelled) return;
      if (error) {
        console.error('[session] start failed', error);
        segmentStart.current = null;
        return;
      }
      sessionId.current = data.id;
    };

    const persist = (ended: boolean) => {
      const id = sessionId.current;
      if (!id) return;
      const total = liveSeconds();
      if (total < MIN_PERSIST_SECONDS && !ended) return;
      const nowIso = new Date().toISOString();
      supabase
        .from('app_sessions')
        .update({
          duration_seconds: total,
          last_seen_at: nowIso,
          ended_at: ended ? nowIso : null,
        })
        .eq('id', id)
        .then(({ error }) => {
          if (error) console.error('[session] persist failed', error);
        });
    };

    const endSession = () => {
      persist(true);
      sessionId.current = null;
      segmentStart.current = null;
      accumulated.current = 0;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (segmentStart.current) {
          accumulated.current += Math.floor((Date.now() - segmentStart.current) / 1000);
          segmentStart.current = null;
        }
        hiddenAt.current = Date.now();
        persist(false);
      } else {
        // Returning to foreground. Start a fresh session if we were gone a long
        // time or the local day rolled over; otherwise resume the current one.
        const gap = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
        hiddenAt.current = null;
        if (gap > IDLE_GAP_MS || todayYmd() !== startedDay.current) {
          endSession();
          void startSession();
        } else if (!segmentStart.current) {
          segmentStart.current = Date.now();
          if (!sessionId.current) void startSession();
        }
      }
    };

    const onPageHide = () => persist(true);

    void startSession();
    heartbeat = window.setInterval(() => persist(false), HEARTBEAT_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      cancelled = true;
      if (heartbeat != null) window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      // Roll the live segment into the accumulated total, then flush a final
      // ended row.
      if (segmentStart.current) {
        accumulated.current += Math.floor((Date.now() - segmentStart.current) / 1000);
        segmentStart.current = null;
      }
      persist(true);
      sessionId.current = null;
    };
  }, [userId]);

  return null;
}
