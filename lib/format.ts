import type { MetricKey } from './types';

export const metricLabels: Record<MetricKey, string> = {
  spend: '광고비',
  impression: '노출',
  click: '링크클릭',
  landingPageView: 'LP 조회',
  ctr: 'CTR',
  cpm: 'CPM',
  cpc: 'CPC',
  roas: 'ROAS'
};

export function formatMetric(key: MetricKey, value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  if (key === 'spend' || key === 'cpm' || key === 'cpc') return '₩' + Math.round(v).toLocaleString();
  if (key === 'ctr') return v.toFixed(2) + '%';
  if (key === 'roas') return v.toFixed(2);
  return Math.round(v).toLocaleString() + '회';
}

/** 대시보드 표에서 쓰는 단순 포매터. formatMetric과 같은 표기(₩, 회, %)를 따른다. */
export function formatCount(value: number): string {
  return Math.round(Number(value) || 0).toLocaleString();
}

export function formatWon(value: number): string {
  return '₩' + Math.round(Number(value) || 0).toLocaleString();
}

/** 이미 퍼센트 단위(57.25 = 57.25%)로 저장된 값을 표기한다. */
export function formatRate(value: number): string {
  return (Number(value) || 0).toFixed(2) + '%';
}

export function formatRatio(value: number, digits = 2): string {
  return (Number(value) || 0).toFixed(digits);
}

export function formatDateWithDay(date: string): string {
  if (!date) return '-';
  const d = new Date(date + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return date;
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd} (${days[d.getDay()]})`;
}

/**
 * Chart palette — World-class data visualization inspired.
 *
 * Figma / Vercel / Linear 스타일의 고채도·고대비 팔레트.
 * 어두운 배경과 밝은 배경 양쪽에서 선명하게 구분되도록 설계되었으며,
 * 색맹 사용자도 구분 가능한 색상 조합을 사용합니다.
 */
const CHART_PALETTE = [
  '#3B82F6', // vivid blue
  '#10B981', // emerald
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#EF4444', // red
  '#06B6D4', // cyan
  '#F97316', // orange
  '#84CC16'  // lime
];

export function colorForIndex(i: number): string {
  return CHART_PALETTE[i % CHART_PALETTE.length];
}

export function pctChange(current: number, prev: number): string {
  if (!prev) return '전일 데이터 없음';
  const pct = ((current - prev) / prev) * 100;
  return `전일 대비 ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}
