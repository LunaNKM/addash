'use client';

import { useState } from 'react';
import { metricLabels } from '@/lib/format';
import type { MetricKey, StatRow } from '@/lib/types';
import { metricKeys, sortOptions, sortRows } from '@/lib/dashUtils';
import { LineChart } from './LineChart';
import { SimpleTable } from './SimpleTable';

export function DailyTrendSection({ rows, activeMetrics, setActiveMetrics, dailySort, setDailySort, openDaily, setOpenDaily }: {
  rows: StatRow[];
  activeMetrics: MetricKey[];
  setActiveMetrics: (v: MetricKey[]) => void;
  dailySort: string;
  setDailySort: (v: string) => void;
  openDaily: boolean;
  setOpenDaily: (v: boolean) => void;
}) {
  const sorted = sortRows(rows, dailySort);
  const [animKey, setAnimKey] = useState<Record<string, number>>({});

  const handleToggle = (key: MetricKey) => {
    setAnimKey(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
    setActiveMetrics(activeMetrics.includes(key)
      ? activeMetrics.filter(item => item !== key)
      : [...activeMetrics, key]);
  };

  return (
    <section className="section">
      <div className="section-head">
        <b>일별 추세</b>
        <select value={dailySort} onChange={event => setDailySort(event.target.value)}>
          {sortOptions(['date', 'spend', 'impression', 'ctr']).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="metric-toggles">
        {metricKeys.map(key => {
          const isActive = activeMetrics.includes(key);
          return (
            <button
              key={key}
              className={isActive ? 'active' : ''}
              data-anim-key={animKey[key] ?? 0}
              onClick={() => handleToggle(key)}
              style={{
                animationName: (animKey[key] ?? 0) > 0 ? (isActive ? 'toggle-activate' : 'deselect-shrink') : 'none',
                animationDuration: '280ms',
                animationTimingFunction: 'cubic-bezier(0.34,1.56,0.64,1)',
                animationFillMode: 'both',
              }}
            >
              {metricLabels[key]}
            </button>
          );
        })}
      </div>
      <LineChart rows={rows} groupKey="date" metrics={activeMetrics} />
      <button className="collapse" onClick={() => setOpenDaily(!openDaily)}>{openDaily ? '일별 데이터 접기' : '일별 데이터 펼치기'}</button>
      {openDaily && <SimpleTable rows={sorted} columns={['date', 'spend', 'impression', 'click', 'landingPageView', 'ctr', 'cpm', 'cpc', 'roas']} withDiff />}
    </section>
  );
}
