// The live timer logic moved to src/state/visitTimerProvider.tsx so that it
// can persist across route changes (Contact <-> Update for the same customer
// is one continuous visit). This module now only exports the formatting
// helper, which is consumed by VisitStopwatchBar plus the My-activity
// dashboard sections.

export function formatStopwatch(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}
