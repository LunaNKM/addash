import { formatMetric, metricLabels } from '@/lib/format';
import type { Kpi, MetricKey, StatRow } from '@/lib/types';
import { metricValue } from '@/lib/dashUtils';

const goalMap: Record<MetricKey, keyof Kpi> = {
  spend: 'spendGoal', impression: 'impressionGoal', click: 'clickGoal',
  landingPageView: 'landingPageViewGoal', ctr: 'ctrGoal', cpm: 'cpmGoal', cpc: 'cpcGoal', roas: 'roasGoal'
};
const metricIcons: Record<MetricKey, string> = {
  spend: '₩', impression: '👁', click: '↗', landingPageView: '📄', ctr: '%', cpm: '📊', cpc: '🖱', roas: '×'
};
const topRow: MetricKey[] = ['spend', 'impression', 'click', 'landingPageView', 'ctr'];
const bottomRow: MetricKey[] = ['cpm', 'cpc', 'roas'];

function KpiCard({ metricKey, index, total, kpi }: { metricKey: MetricKey; index: number; total: StatRow; kpi: Kpi }) {
  const value = metricValue(total, metricKey);
  const goal = Number(kpi[goalMap[metricKey]] || 0);
  const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
  return (
    <div className="kpi-card">
      <div className="kpi-card-header">
        <small>{metricLabels[metricKey]}</small>
        <span className="kpi-icon">{metricIcons[metricKey]}</span>
      </div>
      <b>{formatMetric(metricKey, value)}</b>
      {goal > 0 && (
        <>
          <div className="goal">
            <i style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--c-success)' : pct >= 70 ? 'var(--brand)' : 'var(--c-warn)' }} />
          </div>
          <em style={{ color: pct >= 100 ? 'var(--c-success)' : pct >= 70 ? 'var(--c-ink-2)' : 'var(--c-warn)' }}>
            {pct >= 100 ? '✓ ' : ''}{(value / goal * 100).toFixed(0)}% 달성
          </em>
        </>
      )}
      <div className="kpi-bar-track">
        <div className="kpi-bar-fill" style={{
          width: goal > 0 ? `${Math.min(pct, 100)}%` : '40%',
          background: `var(--chart-${(index % 8) + 1}, var(--brand))`,
          opacity: goal > 0 ? 1 : 0.25
        }} />
      </div>
    </div>
  );
}

export function KpiGrid({ total, kpi }: { total: StatRow; kpi: Kpi }) {
  return (
    <div className="kpi-grid-wrap">
      <div className="kpi-grid kpi-grid-top">
        {topRow.map((key, i) => <KpiCard key={key} metricKey={key} index={i} total={total} kpi={kpi} />)}
      </div>
      <div className="kpi-grid kpi-grid-bottom">
        {bottomRow.map((key, i) => <KpiCard key={key} metricKey={key} index={i + 5} total={total} kpi={kpi} />)}
      </div>
    </div>
  );
}
