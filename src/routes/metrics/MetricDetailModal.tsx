import { useMemo } from 'react';
import { Modal } from '@/components/Modal';
import type { DafMetricRow } from '@/state/orgs';
import {
  avgGrantClass,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtRatio,
  netFlowClass,
  payoutClass,
  velocityClass,
} from './metricBands';

export function MetricDetailModal({
  ein,
  rows,
  onClose,
}: {
  ein: string;
  rows: DafMetricRow[];
  onClose: () => void;
}) {
  const series = useMemo(
    () => rows.filter((r) => r.ein === ein).sort((a, b) => a.year - b.year),
    [rows, ein],
  );
  const head = series[series.length - 1];
  const title = head?.name ?? ein;

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1.5 text-xs text-ink-500 dark:text-ink-400">
          <span>EIN {ein}</span>
          {head?.type && <span>· {head.type}</span>}
          {head?.subtype && <span>· {head.subtype}</span>}
          {head?.state && <span>· {head.state}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-ink-500 dark:text-ink-400">
              <tr className="text-right">
                <th className="py-1 text-left font-medium">Year</th>
                <th className="font-medium">Accts</th>
                <th className="font-medium">Contrib</th>
                <th className="font-medium">Grants</th>
                <th className="font-medium">Assets</th>
                <th className="font-medium">Payout</th>
                <th className="font-medium">Avg&nbsp;Grant</th>
                <th className="font-medium">Net&nbsp;Flow</th>
                <th className="font-medium">Vel.</th>
              </tr>
            </thead>
            <tbody>
              {series.map((r) => (
                <tr key={r.year} className="border-t border-ink-100 text-right dark:border-ink-800">
                  <td className="py-1 text-left">{r.year}</td>
                  <td>{fmtInt(r.accounts)}</td>
                  <td>{fmtMoney(r.contributions)}</td>
                  <td>{fmtMoney(r.grants)}</td>
                  <td>{fmtMoney(r.eoy_assets)}</td>
                  <td className={payoutClass(r.payout_pct)}>
                    {fmtPct(r.payout_pct)}
                    {r.payout_approx ? '*' : ''}
                  </td>
                  <td className={avgGrantClass(r.avg_grant)}>{fmtMoney(r.avg_grant)}</td>
                  <td className={netFlowClass(r.net_flow)}>{fmtMoney(r.net_flow)}</td>
                  <td className={velocityClass(r.velocity)}>{fmtRatio(r.velocity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink-400 dark:text-ink-500">
          * payout uses end-of-year assets only (prior-year assets unavailable).
        </p>
      </div>
    </Modal>
  );
}
