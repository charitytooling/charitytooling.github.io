import { useVisitTimerState } from '@/state/visitTimerProvider';
import { formatStopwatch } from '@/state/visitTimer';

// Inline live stopwatch readout. Renders the digits stacked over a small
// "Time On Card" caption. Returns null when there is no active customer
// (e.g. on /ledger), so the consumer doesn't need to guard.
export function VisitStopwatch() {
  const { activeCustomerId, seconds } = useVisitTimerState();
  if (!activeCustomerId) return null;
  return (
    <div
      className="flex flex-col items-center leading-tight"
      aria-label={`Time on card: ${seconds} seconds`}
      title="Time on this card. Counts while you're on Contact or Update for this person. Pauses when the app is in the background."
    >
      <span
        aria-hidden="true"
        className="text-[11px] tabular-nums text-ink-700 dark:text-ink-200"
      >
        {formatStopwatch(seconds)}
      </span>
      <span
        aria-hidden="true"
        className="text-[9px] uppercase tracking-wide text-ink-400 dark:text-ink-500"
      >
        Time On Card
      </span>
    </div>
  );
}
