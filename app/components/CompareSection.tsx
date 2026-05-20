import { metricLabels } from '@/lib/format';
import type { MetricKey, StatRow } from '@/lib/types';
import { metricKeys } from '@/lib/dashUtils';
import { LineChart } from './LineChart';

export function CompareSection({ title, rows, groupKey, metric, setMetric }: {
  title: string;
  rows: StatRow[];
  groupKey: keyof StatRow;
  metric: MetricKey;
  setMetric: (v: MetricKey) => void;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <b>{title}</b>
        <select value={metric} onChange={event => setMetric(event.target.value as MetricKey)}>
          {metricKeys.map(key => <option key={key} value={key}>{metricLabels[key]}</option>)}
        </select>
      </div>
      <LineChart rows={rows} groupKey={groupKey} metric={metric} />
    </section>
  );
}
