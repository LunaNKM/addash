'use client';

import React, { useRef, useState } from 'react';
import { colorForIndex, formatMetric, metricLabels } from '@/lib/format';
import { metricKeys, metricValue, topBy, type SortOrder } from '@/lib/dashUtils';
import type { MetricKey, StatRow } from '@/lib/types';

export function Donut({ rows, metric, setMetric, order, setOrder }: {
  rows: StatRow[];
  metric: MetricKey;
  setMetric: (v: MetricKey) => void;
  order: SortOrder;
  setOrder: (v: SortOrder) => void;
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const grouped = topBy(rows, metric, 50, 'adsetName', order).filter(row => metricValue(row, metric) > 0);
  const totalVal = grouped.reduce((sum, row) => sum + metricValue(row, metric), 0) || 1;

  const CX = 90, CY = 90, R = 68, SW = 16;
  let accAngle = -Math.PI / 2;
  let accFraction = 0;

  const arcs = grouped.map((row, index) => {
    const raw = metricValue(row, metric);
    const frac = raw / totalVal;
    const angle = frac * 2 * Math.PI;
    const startAngle = accAngle;
    const endAngle = accAngle + angle;
    const startFraction = accFraction;
    const endFraction = accFraction + frac;
    accAngle = endAngle;
    accFraction = endFraction;
    const gap = grouped.length > 1 ? 0.02 : 0;
    const sa = startAngle + gap;
    const ea = endAngle - gap;
    const validArc = ea > sa + 0.01;
    const x1 = CX + R * Math.cos(sa);
    const y1 = CY + R * Math.sin(sa);
    const x2 = CX + R * Math.cos(ea);
    const y2 = CY + R * Math.sin(ea);
    const largeArc = ea - sa > Math.PI ? 1 : 0;
    return { row, index, color: colorForIndex(index), x1, y1, x2, y2, largeArc, frac, raw, validArc, startFraction, endFraction };
  });

  const hovered = hoverKey ? (arcs.find(a => a.row.key === hoverKey) ?? null) : null;

  function tooltipLinesFor(arc: (typeof arcs)[number]) {
    return [
      String(arc.row.adsetName || arc.row.key),
      `${metricLabels[metric]}: ${formatMetric(metric, arc.raw)}`,
      `비중: ${(arc.frac * 100).toFixed(1)}%`
    ];
  }

  function arcFromPointer(event: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || !arcs.length) return null;
    const rect = svg.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) / rect.width) * 180;
    const sy = ((event.clientY - rect.top) / rect.height) * 180;
    const dx = sx - CX;
    const dy = sy - CY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < R - SW * 1.6 || dist > R + SW * 1.6) return null;
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    const fraction = angle / (Math.PI * 2);
    return arcs.find(arc => fraction >= arc.startFraction && fraction <= arc.endFraction) || arcs[arcs.length - 1] || null;
  }

  return (
    <section className="section">
      <div className="section-head">
        <b>광고세트 비중</b>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)}>
            {metricKeys.map(key => <option key={key} value={key}>{metricLabels[key]}</option>)}
          </select>
          <select value={order} onChange={e => setOrder(e.target.value as SortOrder)}>
            <option value="desc">높은 순</option>
            <option value="asc">낮은 순</option>
          </select>
        </div>
      </div>
      <div className="donut-wrap">
        <div className="donut-chart-box">
          {tooltip && (
            <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
              {tooltip.lines.map((line, i) => (
                <div key={i} style={{ fontWeight: i === 0 ? 600 : 400, opacity: i === 0 ? 1 : 0.78 }}>{line}</div>
              ))}
            </div>
          )}
          <svg
            ref={svgRef}
            viewBox="0 0 180 180"
            className="donut-svg"
            onMouseMove={event => {
              const arc = arcFromPointer(event);
              if (!arc) { setHoverKey(null); setTooltip(null); return; }
              setHoverKey(arc.row.key);
              setTooltip({ x: event.clientX + 14, y: event.clientY - 10, lines: tooltipLinesFor(arc) });
            }}
            onMouseLeave={() => { setHoverKey(null); setTooltip(null); }}
          >
            <defs>
              <filter id="donut-hover-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--c-bg-sunken)" strokeWidth={SW} />
            {arcs.map(arc => {
              if (!arc.validArc) return null;
              const isDim = hoverKey && hoverKey !== arc.row.key;
              const isHov = hoverKey === arc.row.key;
              return (
                <path
                  key={arc.row.key}
                  className="donut-slice"
                  d={`M ${arc.x1} ${arc.y1} A ${R} ${R} 0 ${arc.largeArc} 1 ${arc.x2} ${arc.y2}`}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={isHov ? SW + 5 : SW}
                  strokeLinecap="round"
                  opacity={isDim ? 0.16 : 1}
                  style={{
                    transition: 'stroke-width 200ms cubic-bezier(0.34,1.56,0.64,1), opacity 200ms cubic-bezier(0.2,0,0,1)',
                    pointerEvents: 'none',
                  }}
                  filter={isHov ? 'url(#donut-hover-glow)' : undefined}
                />
              );
            })}
            <text x={CX} y={CY - 6} textAnchor="middle"
              style={{ fontSize: 8, fill: 'var(--c-ink-3)', fontFamily: 'var(--font-body)', fontWeight: 600, letterSpacing: '0.06em' }}>
              {metricLabels[metric]}
            </text>
            <text x={CX} y={CY + 12} textAnchor="middle"
              style={{ fontSize: 14, fill: 'var(--c-ink)', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {hovered ? formatMetric(metric, hovered.raw) : formatMetric(metric, totalVal)}
            </text>
            {hovered && (
              <text x={CX} y={CY + 28} textAnchor="middle"
                style={{ fontSize: 10, fill: 'var(--brand)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {(hovered.frac * 100).toFixed(1)}%
              </text>
            )}
          </svg>
        </div>
        <div className="donut-legend">
          {grouped.map((row, index) => {
            const raw = metricValue(row, metric);
            const pct = raw / totalVal * 100;
            const isDim = hoverKey && hoverKey !== row.key;
            const arc = arcs.find(a => a.row.key === row.key);
            return (
              <div key={row.key} className={`donut-legend-row${isDim ? ' dim' : ''}`}
                onMouseEnter={event => {
                  setHoverKey(row.key);
                  if (arc) setTooltip({ x: event.clientX + 14, y: event.clientY - 10, lines: tooltipLinesFor(arc) });
                }}
                onMouseMove={event => setTooltip(prev => prev ? { ...prev, x: event.clientX + 14, y: event.clientY - 10 } : prev)}
                onMouseLeave={() => { setHoverKey(null); setTooltip(null); }}>
                <span className="donut-legend-dot" style={{ background: colorForIndex(index) }} />
                <span className="donut-legend-name">{row.adsetName || row.key}</span>
                <b className="donut-legend-val">{formatMetric(metric, raw)}</b>
                <span className="donut-legend-pct">{pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
