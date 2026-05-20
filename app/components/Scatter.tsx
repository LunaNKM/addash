'use client';

import { useState } from 'react';
import { colorForIndex, formatMetric } from '@/lib/format';
import type { StatRow } from '@/lib/types';

export function Scatter({ rows }: { rows: StatRow[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const list = rows.slice().sort((a, b) => b.spend - a.spend).slice(0, 80);

  const rawMaxX = Math.max(1, ...list.map(row => row.cpc));
  const rawMaxY = Math.max(1, ...list.map(row => row.ctr));
  const maxX = rawMaxX * 1.25;
  const maxY = rawMaxY * 1.25;
  const maxSpend = Math.max(1, ...list.map(row => row.spend));
  const left = 58, right = 20, top = 20, bottom = 40, width = 500, height = 280;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const xAt = (value: number) => left + (value / maxX) * chartWidth;
  const yAt = (value: number) => top + chartHeight - (value / maxY) * chartHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const midX = xAt(maxX * 0.5);
  const midY = yAt(maxY * 0.5);

  return (
    <section className="section">
      <div className="section-head">
        <b>소재 포지셔닝</b>
        <span className="muted">X = CPC · Y = CTR · 크기 = 광고비</span>
      </div>
      <div style={{ position: 'relative' }} onMouseLeave={() => setTooltip(null)}>
        {tooltip && (
          <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            {tooltip.lines.map((line, i) => <div key={i} style={{ opacity: i === 0 ? 1 : 0.75, fontWeight: i === 0 ? 600 : 400 }}>{line}</div>)}
          </div>
        )}
        <svg className="scatter" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="소재 포지셔닝 차트">
          <defs>
            <clipPath id="scatter-clip">
              <rect x={left} y={top} width={chartWidth} height={chartHeight} />
            </clipPath>
            <linearGradient id="quad-tl" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="quad-tr" x1="1" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="quad-bl" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#6366F1" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#6366F1" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="quad-br" x1="1" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#EF4444" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#EF4444" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          <g clipPath="url(#scatter-clip)">
            <rect x={left} y={top} width={midX - left} height={midY - top} fill="url(#quad-tl)" />
            <rect x={midX} y={top} width={left + chartWidth - midX} height={midY - top} fill="url(#quad-tr)" />
            <rect x={left} y={midY} width={midX - left} height={top + chartHeight - midY} fill="url(#quad-bl)" />
            <rect x={midX} y={midY} width={left + chartWidth - midX} height={top + chartHeight - midY} fill="url(#quad-br)" />
          </g>

          {ticks.map(rate => {
            const yValue = Math.round(maxY * rate * 100) / 100;
            const y = yAt(yValue);
            const xValue = Math.round(maxX * rate);
            const x = xAt(xValue);
            return (
              <g key={rate}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth={1} strokeDasharray="4 4" shapeRendering="crispEdges" />
                <text x={left - 8} y={y + 4} textAnchor="end" className="chart-tick">{formatMetric('ctr', yValue)}</text>
                <line x1={x} x2={x} y1={top} y2={top + chartHeight} stroke="var(--chart-grid)" strokeWidth={1} strokeDasharray="4 4" shapeRendering="crispEdges" />
                <text x={x} y={height - 8} textAnchor="middle" className="chart-tick">{formatMetric('cpc', xValue)}</text>
              </g>
            );
          })}

          <line x1={midX} x2={midX} y1={top} y2={top + chartHeight} stroke="var(--chart-axis)" strokeWidth={1} strokeDasharray="6 3" opacity={0.5} />
          <line x1={left} x2={left + chartWidth} y1={midY} y2={midY} stroke="var(--chart-axis)" strokeWidth={1} strokeDasharray="6 3" opacity={0.5} />

          <text x={left + 6} y={top + 14} style={{ fontSize: 8, fill: '#10B981', fontFamily: 'var(--font-body)', fontWeight: 700, opacity: 0.7 }}>저CPC · 고CTR</text>
          <text x={midX + 4} y={top + 14} style={{ fontSize: 8, fill: '#F59E0B', fontFamily: 'var(--font-body)', fontWeight: 700, opacity: 0.7 }}>고CPC · 고CTR</text>
          <text x={left + 6} y={top + chartHeight - 6} style={{ fontSize: 8, fill: '#6366F1', fontFamily: 'var(--font-body)', fontWeight: 700, opacity: 0.7 }}>저CPC · 저CTR</text>
          <text x={midX + 4} y={top + chartHeight - 6} style={{ fontSize: 8, fill: '#EF4444', fontFamily: 'var(--font-body)', fontWeight: 700, opacity: 0.7 }}>고CPC · 저CTR</text>

          <line x1={left} x2={left} y1={top} y2={top + chartHeight} stroke="var(--chart-axis)" strokeWidth={1} shapeRendering="crispEdges" />
          <line x1={left} x2={width - right} y1={top + chartHeight} y2={top + chartHeight} stroke="var(--chart-axis)" strokeWidth={1} shapeRendering="crispEdges" />

          {list.map((row, index) => {
            const r = 4 + (row.spend / maxSpend) * 10;
            const cx = xAt(row.cpc);
            const cy = yAt(row.ctr);
            const tooltipLines = [
              row.adName || row.key,
              `CPC: ${formatMetric('cpc', row.cpc)}  CTR: ${formatMetric('ctr', row.ctr)}`,
              `광고비: ${formatMetric('spend', row.spend)}`
            ];
            return (
              <g key={row.key} clipPath="url(#scatter-clip)" style={{ transition: 'opacity 180ms cubic-bezier(0.2,0,0,1)' }}>
                {row.spend / maxSpend > 0.5 && (
                  <circle cx={cx} cy={cy} r={r + 4} fill={colorForIndex(index)} fillOpacity={0.12}
                    style={{ transition: 'r 200ms cubic-bezier(0.34,1.56,0.64,1)' }} />
                )}
                <circle
                  cx={cx} cy={cy} r={r}
                  fill={colorForIndex(index)}
                  fillOpacity={0.82}
                  stroke="var(--c-bg-elevated)"
                  strokeWidth={1.5}
                  className="scatter-bubble"
                  style={{ cursor: 'pointer', transition: 'r 200ms cubic-bezier(0.34,1.56,0.64,1), fill-opacity 180ms ease, filter 180ms ease' }}
                  onMouseEnter={e => setTooltip({ x: e.clientX + 14, y: e.clientY - 10, lines: tooltipLines })}
                  onMouseMove={e => setTooltip(prev => prev ? { ...prev, x: e.clientX + 14, y: e.clientY - 10 } : null)}
                  onMouseLeave={() => setTooltip(null)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
