import { formatDateWithDay, formatMetric } from '@/lib/format';
import type { StatRow } from '@/lib/types';
import { cpmColor, ctrColor, metricValue } from '@/lib/dashUtils';

export function DetailTable({ rows, maxCtr }: { rows: StatRow[]; maxCtr: number }) {
  const byDate = new Map<string, StatRow[]>();
  for (const row of rows) {
    const date = row.date || '날짜 없음';
    byDate.set(date, [...(byDate.get(date) || []), row]);
  }
  return (
    <div className="table-wrap sticky-detail">
      <table>
        <thead>
          <tr>
            <th>날짜</th>
            <th>캠페인 / 광고세트</th>
            <th>광고비</th>
            <th>노출</th>
            <th>링크클릭</th>
            <th>LP 조회</th>
            <th>CPM</th>
            <th>CPC</th>
            <th>CTR</th>
            <th>링크클릭 CTR</th>
            <th>ROAS</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(byDate.entries()).flatMap(([date, dateRows], groupIndex) =>
            dateRows.map((row, index) => (
              <tr key={`${date}-${row.key}`} className={index === 0 && groupIndex > 0 ? 'detail-date-separator' : undefined}>
                {index === 0 && <td className="date-cell" rowSpan={dateRows.length}>{formatDateWithDay(date)}</td>}
                <td className="detail-name-cell">{row.campaignName || ''} / {row.adsetName || ''}</td>
                <td>{formatMetric('spend', row.spend)}</td>
                <td>{formatMetric('impression', row.impression)}</td>
                <td>{formatMetric('click', row.click)}</td>
                <td>{formatMetric('landingPageView', row.landingPageView)}</td>
                <td style={{ background: cpmColor(row.cpm) }} title={`CPM ${formatMetric('cpm', row.cpm)}\n1,000 미만은 낮을수록 진하게 표시됩니다.`}>{formatMetric('cpm', row.cpm)}</td>
                <td>{formatMetric('cpc', metricValue(row, 'cpc'))}</td>
                <td style={{ background: ctrColor(row.ctr, maxCtr) }} title={`CTR ${formatMetric('ctr', row.ctr)}\n높을수록 진하게 표시됩니다.`}>{formatMetric('ctr', row.ctr)}</td>
                <td>{formatMetric('linkCtr', metricValue(row, 'linkCtr'))}</td>
                <td>{formatMetric('roas', row.roas)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
