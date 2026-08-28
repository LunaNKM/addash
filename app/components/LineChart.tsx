'use client';

import { useState } from 'react';
import { colorForIndex, formatDateWithDay, formatMetric, metricLabels } from '@/lib/format';
import { emptyStat } from '@/lib/aggregation';
import { isString, metricValue, shortDate } from '@/lib/dashUtils';
import type { MetricKey, StatRow } from '@/lib/types';

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cp1x = prev[0] + (curr[0] - prev[0]) * 0.45;
    const cp2x = curr[0] - (curr[0] - prev[0]) * 0.45;
    d += ` C ${cp1x},${prev[1]} ${cp2x},${curr[1]} ${curr[0]},${curr[1]}`;
  }
  return d;
}

function areaPath(pts: [number, number][], baseY: number): string {
  if (pts.length < 2) return '';
  const line = smoothPath(pts);
  return `${line} L ${pts[pts.length - 1][0]},${baseY} L ${pts[0][0]},${baseY} Z`;
}

export function LineChart({ rows, groupKey, metrics, metric, highlight, colorByName, groupOrder }: {
  rows: StatRow[];
  groupKey: keyof StatRow | 'date';
  metrics?: MetricKey[];
  metric?: MetricKey;
  highlight?: string | null;
  colorByName?: Record<string, string>;
  groupOrder?: string[];
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const dates = Array.from(new Set(rows.map(row => row.date).filter(isString))).sort();
  const groupNames = groupKey === 'date'
    ? []
    : (groupOrder?.length
        ? groupOrder.filter(name => rows.some(row => String(row[groupKey] || '') === name))
        : Array.from(new Set(rows.map(row => String(row[groupKey] || '')).filter(Boolean))));
  const groups = groupKey === 'date'
    ? (metrics || []).map(key => ({ name: metricLabels[key], key, color: colorForIndex(['spend', 'impression', 'click', 'landingPageView', 'ctr', 'linkCtr', 'cpm', 'cpc', 'roas'].indexOf(key)), data: dates.map(date => metricValue(rows.find(row => row.date === date) || emptyStat(date), key)) }))
    : groupNames.map((groupName, index) => ({ name: groupName, key: groupName, color: colorByName?.[groupName] || colorForIndex(index), data: dates.map(date => metricValue(rows.find(row => row.date === date && String(row[groupKey] || '') === groupName) || emptyStat(date), metric || 'spend')) }));

  const max = Math.max(1, ...groups.flatMap(group => group.data));
  if (!dates.length || !groups.length) return <div className="chart-empty">표시할 데이터가 없습니다.</div>;

  const left = 64, right = 20, top = 20, bottom = 44, width = 800, height = 300;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const xAt = (index: number) => left + (index / Math.max(dates.length - 1, 1)) * chartWidth;
  const yAt = (value: number) => top + chartHeight - (value / max) * chartHeight;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(rate => Math.round(max * rate * 100) / 100);
  const xTickIndexes = dates.length <= 6
    ? dates.map((_, index) => index)
    : Array.from(new Set([0, Math.floor((dates.length - 1) * 0.25), Math.floor((dates.length - 1) * 0.5), Math.floor((dates.length - 1) * 0.75), dates.length - 1]));
  const activeMetric = metric || metrics?.[0] || 'spend';
  const baseY = top + chartHeight;

  return (
    <div style={{ position: 'relative' }} onMouseLeave={() => setTooltip(null)}>
      {tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.lines.map((line, i) => <div key={i} style={{ opacity: i === 0 ? 1 : 0.75, fontWeight: i === 0 ? 600 : 400 }}>{line}</div>)}
        </div>
      )}
      <svg className="linechart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="추세 차트">
        <defs>
          {groups.map((group, gi) => (
            <linearGradient key={`grad-${group.key}`} id={`grad-${gi}-${group.key.replace(/[^a-zA-Z0-9]/g, '_')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={group.color} stopOpacity="0.16" />
              <stop offset="85%" stopColor={group.color} stopOpacity="0.02" />
              <stop offset="100%" stopColor={group.color} stopOpacity="0" />
            </linearGradient>
          ))}
          <filter id="glow-line" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id="linechart-clip">
            <rect x={left} y={top} width={chartWidth} height={chartHeight} />
          </clipPath>
        </defs>

        <rect x={left} y={top} width={chartWidth} height={chartHeight} fill="transparent" />

        {yTicks.map((value, i) => {
          const y = yAt(value);
          return (
            <g key={`y-${value}`}>
              <line x1={left} x2={width - right} y1={y} y2={y}
                stroke={i === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
                strokeWidth={1} strokeDasharray={i === 0 ? '' : '4 4'} shapeRendering="crispEdges" />
              <text x={left - 10} y={y + 4} textAnchor="end" className="chart-tick">
                {formatMetric(activeMetric, value)}
              </text>
            </g>
          );
        })}

        {xTickIndexes.map(index => {
          const x = xAt(index);
          return (
            <g key={`x-${index}`}>
              <line x1={x} x2={x} y1={top} y2={baseY} stroke="var(--chart-grid)" strokeWidth={1} strokeDasharray="4 4" shapeRendering="crispEdges" />
              <text x={x} y={height - 10} textAnchor="middle" className="chart-tick">{shortDate(dates[index])}</text>
            </g>
          );
        })}

        <line x1={left} x2={left} y1={top} y2={baseY} stroke="var(--chart-axis)" strokeWidth={1} shapeRendering="crispEdges" />

        {groups.map((group, gi) => {
          const pts: [number, number][] = group.data.map((value, i) => [xAt(i), yAt(value)]);
          const dim = highlight && highlight !== group.name;
          const gradId = `grad-${gi}-${group.key.replace(/[^a-zA-Z0-9]/g, '_')}`;
          return (
            <path key={`area-${group.key}`} d={areaPath(pts, baseY)} fill={`url(#${gradId})`}
              opacity={dim ? 0.03 : 1} clipPath="url(#linechart-clip)"
              style={{ transition: 'opacity 220ms cubic-bezier(0.2,0,0,1)' }} />
          );
        })}

        {groups.map(group => {
          const pts: [number, number][] = group.data.map((value, i) => [xAt(i), yAt(value)]);
          const dim = highlight && highlight !== group.name;
          return (
            <g key={group.key} opacity={dim ? 0.14 : 1} style={{ transition: 'opacity 220ms cubic-bezier(0.2,0,0,1)' }}>
              {!dim && (
                <path d={smoothPath(pts)} fill="none" stroke={group.color} strokeWidth={4}
                  strokeOpacity={0.2} strokeLinecap="round" strokeLinejoin="round" filter="url(#glow-line)" />
              )}
              <path d={smoothPath(pts)} fill="none" stroke={group.color} strokeWidth={dim ? 1.5 : 2.5}
                strokeLinecap="round" strokeLinejoin="round"
                style={{ transition: 'stroke-width 220ms cubic-bezier(0.2,0,0,1)' }} />
              {group.data.map((value, index) => {
                const date = dates[index];
                const pointRow = groupKey === 'date'
                  ? rows.find(row => row.date === date)
                  : rows.find(row => row.date === date && String(row[groupKey] || '') === group.name);
                const displayMetric = groupKey === 'date' ? (group.key as MetricKey) : activeMetric;
                const tooltipLines = [
                  `${group.name}  ${formatDateWithDay(date)}`,
                  `${metricLabels[displayMetric]}: ${formatMetric(displayMetric, value)}`,
                  ...(pointRow && displayMetric !== 'spend' ? [`광고비: ${formatMetric('spend', pointRow.spend)}`] : [])
                ];
                return (
                  <g key={`${group.key}-${date}`}>
                    <circle cx={xAt(index)} cy={yAt(value)} r={12} fill="transparent"
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => setTooltip({ x: e.clientX + 14, y: e.clientY - 10, lines: tooltipLines })}
                      onMouseMove={e => setTooltip(prev => prev ? { ...prev, x: e.clientX + 14, y: e.clientY - 10 } : null)}
                      onMouseLeave={() => setTooltip(null)} />
                    <circle cx={xAt(index)} cy={yAt(value)} r={6} fill={group.color} fillOpacity={0.12} />
                    <circle className="chart-point" cx={xAt(index)} cy={yAt(value)} r={3.5}
                      fill={group.color} stroke="var(--c-bg-elevated)" strokeWidth={2}
                      style={{ pointerEvents: 'none' }} />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
