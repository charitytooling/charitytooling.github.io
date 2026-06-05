import { useMemo } from 'react';
import { compactMoney } from '@/lib/format';
import type { DafMetricRow } from '@/state/orgs';

const FLOW_POS = '#ea580c'; // orange-600 (accumulating)
const FLOW_NEG = '#0284c7'; // sky-600 (drawing down)
const FLOW_ZERO = '#94a3b8'; // slate-400
const ACCENT = '#6366f1';

function flowColor(v: number | null | undefined): string {
  if (v == null || Math.abs(v) < 1e5) return FLOW_ZERO;
  return v > 0 ? FLOW_POS : FLOW_NEG;
}

// Payout % (x) vs Velocity (y); bubble area ~ EOY assets; color = net-flow sign.
export function BubbleChart({
  rows,
  onSelect,
}: {
  rows: DafMetricRow[];
  onSelect: (ein: string) => void;
}) {
  const pts = useMemo(
    () => rows.filter((r) => r.payout_pct != null && r.velocity != null && r.eoy_assets != null),
    [rows],
  );
  const W = 600;
  const H = 360;
  const m = { t: 16, r: 16, b: 40, l: 48 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const xMax = 50;
  const yMax = 1.2;
  const maxA = Math.max(1, ...pts.map((p) => p.eoy_assets ?? 0));
  const sx = (v: number) => m.l + (Math.min(v, xMax) / xMax) * pw;
  const sy = (v: number) => m.t + ph - (Math.min(v, yMax) / yMax) * ph;
  const sr = (a: number) => 2 + Math.sqrt(a / maxA) * 18;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + ph} className="stroke-ink-200 dark:stroke-ink-700" />
      <line x1={m.l} y1={m.t + ph} x2={m.l + pw} y2={m.t + ph} className="stroke-ink-200 dark:stroke-ink-700" />
      {[0, 10, 20, 30, 40, 50].map((t) => (
        <text key={t} x={sx(t)} y={H - 14} textAnchor="middle" className="fill-ink-400 text-[10px]">
          {t}%
        </text>
      ))}
      {[0, 0.3, 0.6, 0.9, 1.2].map((t) => (
        <text key={t} x={m.l - 6} y={sy(t) + 3} textAnchor="end" className="fill-ink-400 text-[10px]">
          {t.toFixed(1)}
        </text>
      ))}
      <text x={m.l + pw / 2} y={H - 2} textAnchor="middle" className="fill-ink-500 text-[11px]">
        Payout %
      </text>
      <text
        x={12}
        y={m.t + ph / 2}
        textAnchor="middle"
        className="fill-ink-500 text-[11px]"
        transform={`rotate(-90 12 ${m.t + ph / 2})`}
      >
        Velocity
      </text>
      {pts.map((p) => (
        <circle
          key={p.ein}
          cx={sx(p.payout_pct as number)}
          cy={sy(p.velocity as number)}
          r={sr(p.eoy_assets as number)}
          fill={flowColor(p.net_flow)}
          fillOpacity={0.5}
          stroke={flowColor(p.net_flow)}
          className="cursor-pointer"
          onClick={() => onSelect(p.ein)}
        >
          <title>
            {`${p.name ?? p.ein}\nPayout ${(p.payout_pct as number).toFixed(1)}%  ·  Velocity ${(p.velocity as number).toFixed(2)}\nEOY assets ${compactMoney(p.eoy_assets as number)}  ·  Net flow ${p.net_flow != null ? compactMoney(p.net_flow) : '—'}`}
          </title>
        </circle>
      ))}
    </svg>
  );
}

type Histo = {
  id: string;
  title: string;
  bins: number[];
  pick: (r: DafMetricRow) => number | null;
  diverging?: boolean;
};

const HISTOS: Histo[] = [
  { id: 'payout', title: 'Payout %', bins: [0, 5, 10, 20, 50, Infinity], pick: (r) => r.payout_pct },
  { id: 'avgGrant', title: 'Avg Grant', bins: [0, 1e3, 5e3, 25e3, 100e3, 1e6, Infinity], pick: (r) => r.avg_grant },
  { id: 'netFlow', title: 'Net Flow', bins: [-Infinity, -1e7, -1e6, 0, 1e6, 1e7, Infinity], pick: (r) => r.net_flow, diverging: true },
  { id: 'velocity', title: 'Velocity', bins: [0, 0.1, 0.2, 0.6, 1.0, Infinity], pick: (r) => r.velocity },
  { id: 'assets', title: 'EOY Assets', bins: [0, 1e7, 1e8, 1e9, Infinity], pick: (r) => r.eoy_assets },
];

function binCounts(rows: DafMetricRow[], h: Histo): number[] {
  const counts = new Array(h.bins.length - 1).fill(0);
  for (const r of rows) {
    const v = h.pick(r);
    if (v == null) continue;
    for (let i = 0; i < h.bins.length - 1; i++) {
      if (v >= h.bins[i] && v < h.bins[i + 1]) {
        counts[i]++;
        break;
      }
    }
  }
  return counts;
}

export function HistogramStrip({ rows }: { rows: DafMetricRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {HISTOS.map((h) => {
        const counts = binCounts(rows, h);
        const max = Math.max(1, ...counts);
        const n = counts.length;
        const W = 120;
        const Hh = 56;
        const bw = W / n;
        return (
          <div key={h.id}>
            <div className="mb-1 text-[10px] text-ink-500 dark:text-ink-400">{h.title}</div>
            <svg viewBox={`0 0 ${W} ${Hh}`} className="h-auto w-full">
              {counts.map((c, i) => {
                const bh = (c / max) * (Hh - 2);
                let fill = ACCENT;
                if (h.diverging) {
                  // bins below the 0 boundary draw down (sky); above accumulate (orange)
                  fill = h.bins[i + 1] <= 0 ? FLOW_NEG : h.bins[i] >= 0 ? FLOW_POS : FLOW_ZERO;
                }
                return <rect key={i} x={i * bw + 1} y={Hh - bh} width={bw - 2} height={bh} fill={fill} />;
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
