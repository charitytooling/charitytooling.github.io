import { useEffect, useRef } from 'react';

/**
 * Long-press gesture handler for both touch and mouse. Returns event handlers
 * to spread onto any element (typically a Link or button-like surface).
 *
 * Behaviour:
 *   - Starts a one-shot timer on touchstart / mousedown.
 *   - Cancels on touchend / touchmove / touchcancel / mouseup / mouseleave so
 *     that taps, scrolls, and drags don't fire the long-press.
 *   - When the timer elapses, invokes `onLongPress` and sets an internal
 *     "fired" flag. The next click event is then preventDefault()'d so a
 *     wrapping <Link> doesn't navigate after the long-press completes.
 *   - onContextMenu is suppressed while enabled so iOS Safari does not show
 *     its native "Copy link / Open in new tab" sheet on a held link.
 */
export function useLongPress(opts: {
  onLongPress: () => void;
  ms?: number;
  enabled?: boolean;
}) {
  const { onLongPress, ms = 500, enabled = true } = opts;
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  // Keep the callback fresh without re-creating handlers on every render.
  const cbRef = useRef(onLongPress);
  cbRef.current = onLongPress;

  // Belt-and-suspenders: clear any in-flight timer if the component unmounts
  // mid-press (e.g. the row scrolls out of the virtualizer window).
  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  function start() {
    if (!enabled) return;
    firedRef.current = false;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      timerRef.current = null;
      cbRef.current();
    }, ms);
  }

  function cancel() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onTouchCancel: cancel,
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      if (enabled) e.preventDefault();
    },
    onClick: (e: React.MouseEvent) => {
      if (firedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        firedRef.current = false;
      }
    },
  };
}
