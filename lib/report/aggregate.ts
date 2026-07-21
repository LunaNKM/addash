import type {
  NormalizedReportRow,
  ReportAggregation,
  ReportComparisonMetric,
  ReportPeriod,
  ReportSummary,
  ReportView
} from './reportTypes';
import { creativeLabelFromKey, makeCreativeKey } from './creativeKey';

type Bucket = Omit<ReportSummary, 'ctr' | 'cpm' | 'cpc' | 'cvr' | 'cpa' | 'cartCpa' | 'roas'>;

export function buildReportAggregation(rows: NormalizedReportRow[]): ReportAggregation {
  return {
    total: summarize('total', '전체', rows),
    byMonth: groupRows(rows, row => row.date.slice(0, 7) || '날짜 없음'),
    byWeek: groupRows(rows, row => weekLabel(row.date), weekDisplayLabel),
    byPromotion: groupRows(rows, row => row.promotion || '미분류'),
    byCampaign: groupRows(rows, row => row.campaignName || '미분류 캠페인'),
    byAdgroup: groupRows(rows, row => row.adgroupName || '미분류 광고그룹'),
    byDaily: groupRows(rows, row => row.date || '날짜 없음'),
    byCreative: groupRows(rows, makeCreativeKey, (key, list) => list[0]?.adName || creativeLabelFromKey(key))
  };
}

export function buildReportView(
  rows: NormalizedReportRow[],
  start: string,
  end: string,
  comparisonStart?: string,
  comparisonEnd?: string
): ReportView {
  const dates = rows.map(row => row.date).filter(Boolean).sort();
  const currentStart = start || dates[0] || '';
  const currentEnd = end || dates[dates.length - 1] || '';
  const defaultPrevious = previousMatchingPeriod(currentStart, currentEnd);
  const previousPeriod = (comparisonStart || comparisonEnd)
    ? buildPeriod(comparisonStart || defaultPrevious.start, comparisonEnd || defaultPrevious.end)
    : defaultPrevious;
  const currentRows = filterRowsByPeriod(rows, currentStart, currentEnd);
  const previousRows = filterRowsByPeriod(rows, previousPeriod.start, previousPeriod.end);
  const current = buildReportAggregation(currentRows);
  const previous = buildReportAggregation(previousRows);

  return {
    currentPeriod: { start: currentStart, end: currentEnd, label: formatPeriodLabel(currentStart, currentEnd) },
    previousPeriod,
    currentRows,
    previousRows,
    current,
    previous,
    comparison: buildComparison(current.total, previous.total)
  };
}

export function filterRowsByPeriod(rows: NormalizedReportRow[], start: string, end: string): NormalizedReportRow[] {
  return rows.filter(row => {
    if (!row.date) return false;
    if (start && row.date < start) return false;
    if (end && row.date > end) return false;
    return true;
  });
}

function groupRows(
  rows: NormalizedReportRow[],
  keyFor: (row: NormalizedReportRow) => string,
  labelFor?: (key: string, rows: NormalizedReportRow[]) => string
): ReportSummary[] {
  const grouped = new Map<string, NormalizedReportRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }
  return [...grouped.entries()]
    .map(([key, list]) => summarize(key, labelFor ? labelFor(key, list) : key, list))
    .sort((a, b) => b.spend - a.spend || a.key.localeCompare(b.key));
}

function buildComparison(current: ReportSummary, previous: ReportSummary): ReportComparisonMetric[] {
  const metrics: { key: ReportComparisonMetric['key']; label: string }[] = [
    { key: 'spend', label: '광고비' },
    { key: 'sales', label: '매출' },
    { key: 'impressions', label: '노출' },
    { key: 'clicks', label: '클릭' },
    { key: 'conversions', label: '전환' },
    { key: 'addToCart', label: '장바구니' },
    { key: 'ctr', label: 'CTR' },
    { key: 'cpm', label: 'CPM' },
    { key: 'cvr', label: 'CVR' },
    { key: 'cpa', label: 'CPA' },
    { key: 'roas', label: 'ROAS' }
  ];

  return metrics.map(metric => {
    const currentValue = Number(current[metric.key] || 0);
    const previousValue = Number(previous[metric.key] || 0);
    const delta = currentValue - previousValue;
    return {
      ...metric,
      current: currentValue,
      previous: previousValue,
      delta,
      deltaRate: previousValue ? delta / previousValue : 0
    };
  });
}

function buildPeriod(start: string, end: string): ReportPeriod {
  return { start, end, label: formatPeriodLabel(start, end) };
}

export function previousMatchingPeriod(start: string, end: string): ReportPeriod {
  if (!start || !end) return { start: '', end: '', label: '이전 기간' };
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { start: '', end: '', label: '이전 기간' };
  }
  const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
  const prevEnd = new Date(startDate.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  const previousStart = toIsoDate(prevStart);
  const previousEnd = toIsoDate(prevEnd);
  return { start: previousStart, end: previousEnd, label: formatPeriodLabel(previousStart, previousEnd) };
}

function formatPeriodLabel(start: string, end: string): string {
  if (!start && !end) return '기간 없음';
  if (start === end) return start;
  return `${start} ~ ${end}`;
}

function weekLabel(value: string): string {
  if (!value) return '날짜 없음';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '날짜 없음';
  const month = date.getMonth() + 1;
  const week = Math.ceil(date.getDate() / 7);
  const year = date.getFullYear();
  return `${year}-${String(month).padStart(2, '0')}-W${String(week).padStart(2, '0')}`;
}

function weekDisplayLabel(key: string): string {
  const match = key.match(/^(\d{4})-(\d{2})-W(\d{2})$/);
  if (!match) return key;
  const month = parseInt(match[2], 10);
  const week = parseInt(match[3], 10);
  return `${month}월 ${week}주차`;
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function summarize(key: string, label: string, rows: NormalizedReportRow[]): ReportSummary {
  const bucket: Bucket = {
    key,
    label,
    rows: rows.length,
    spend: 0,
    grossSpend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    sales: 0,
    addToCart: 0,
    registration: 0,
    lead: 0,
    order: 0
  };

  for (const row of rows) {
    bucket.spend += row.costKrw;
    bucket.grossSpend += row.grossCostKrw;
    bucket.impressions += row.impressions;
    bucket.clicks += row.clicks;
    bucket.conversions += row.conversions;
    bucket.sales += row.salesKrw;
    bucket.addToCart += row.addToCart;
    bucket.registration += row.registration;
    bucket.lead += row.lead;
    bucket.order += row.order;
  }

  return {
    ...bucket,
    spend: round(bucket.spend),
    grossSpend: round(bucket.grossSpend),
    sales: round(bucket.sales),
    ctr: ratio(bucket.clicks, bucket.impressions),
    cpm: ratio(bucket.spend * 1000, bucket.impressions),
    cpc: ratio(bucket.spend, bucket.clicks),
    cvr: ratio(bucket.conversions, bucket.clicks),
    cpa: ratio(bucket.spend, bucket.conversions),
    cartCpa: ratio(bucket.spend, bucket.addToCart),
    roas: ratio(bucket.sales, bucket.spend)
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

function round(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}
