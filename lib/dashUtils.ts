import { totalStat } from './aggregation';
import { formatCount, formatDateWithDay, formatMetric, formatWon, metricLabels } from './format';
import type { Kpi, MetricKey, ParsedRow, StatRow } from './types';

export type SortOrder = 'asc' | 'desc';
export type TableRow = StatRow | ParsedRow;
export type DashboardBundle = {
  dailyStats: StatRow[];
  campaignDailyStats: StatRow[];
  adsetDailyStats: StatRow[];
  detailStats: StatRow[];
  creativeStats: StatRow[];
  total: StatRow;
};
export type FilteredBundle = DashboardBundle;

export const metricKeys: MetricKey[] = ['spend', 'impression', 'click', 'landingPageView', 'ctr', 'linkCtr', 'cpm', 'cpc', 'roas'];

export function applyFilters(data: DashboardBundle, start: string, end: string, campaign: string, adset: string, ad = ''): FilteredBundle {
  const byDate = (row: StatRow) => (!start || !row.date || row.date >= start) && (!end || !row.date || row.date <= end);
  const full = (row: StatRow) => byDate(row) && (!campaign || row.campaignName === campaign) && (!adset || row.adsetName === adset);
  const dailyStats = data.dailyStats.filter(byDate);
  const campaignDailyStats = data.campaignDailyStats.filter(full);
  const adsetDailyStats = data.adsetDailyStats.filter(full);
  const detailStats = data.detailStats.filter(full);
  const creativeStats = data.creativeStats.filter(row =>
    (!campaign || row.campaignName === campaign)
    && (!adset || row.adsetName === adset)
    && (!ad || row.adName === ad)
  );
  // 소재 단위 합계는 일자별 집계에 없으므로, 광고를 고른 경우에만 소재 집계에서 합친다.
  const base = ad ? creativeStats : (detailStats.length ? detailStats : dailyStats);
  return { dailyStats, campaignDailyStats, adsetDailyStats, detailStats, creativeStats, total: totalStat(base) };
}

export function metricValue(row: StatRow | undefined, key: MetricKey): number {
  if (!row) return 0;
  // 링크클릭 CTR·CPC는 원본 열(CTR(전체)·CPC 가중평균) 대신 링크클릭 수로 다시 계산한다.
  if (key === 'linkCtr') return row.impression ? (Number(row.click || 0) / row.impression) * 100 : 0;
  if (key === 'cpc') return row.click ? row.spend / Number(row.click) : 0;
  return Number(row[key] ?? 0);
}

export function sortRows(rows: StatRow[], sort: string): StatRow[] {
  const arr = [...rows];
  const asc = sort.endsWith('Asc');
  const key = sort.replace('Asc', '').replace('Desc', '') as MetricKey | 'date';
  return arr.sort((a, b) => {
    const av = key === 'date' ? String(a.date || '') : metricValue(a, key as MetricKey);
    const bv = key === 'date' ? String(b.date || '') : metricValue(b, key as MetricKey);
    if (av === bv) return 0;
    return asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });
}

export function sortDetailRows(rows: StatRow[], sort: string): StatRow[] {
  const groups = new Map<string, StatRow[]>();
  for (const row of rows) {
    const date = row.date || '';
    groups.set(date, [...(groups.get(date) || []), row]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).flatMap(([, group]) => sortRows(group, sort));
}

export function topBy(rows: StatRow[], key: MetricKey, limit = 20, groupKey?: keyof StatRow, order: SortOrder = 'desc'): StatRow[] {
  const base = groupKey
    ? Array.from(rows.reduce((acc, row) => {
        const value = String(row[groupKey] || '알 수 없음');
        acc.set(value, [...(acc.get(value) || []), row]);
        return acc;
      }, new Map<string, StatRow[]>()).entries()).map(([groupName, group]) => ({ ...totalStat(group, groupName), [groupKey]: groupName })) as StatRow[]
    : rows;
  return sortRows(base, `${key}${order === 'desc' ? 'Desc' : 'Asc'}`).slice(0, limit);
}

export function sortOptions(keys: Array<MetricKey | 'date'>) {
  const map: Record<string, string> = { date: '날짜', ...metricLabels };
  return keys.flatMap(key =>
    key === 'date'
      ? [{ value: 'dateAsc', label: '날짜 오래된순' }, { value: 'dateDesc', label: '날짜 최신순' }]
      : [{ value: `${key}Desc`, label: `${map[key]} 높은 순` }, { value: `${key}Asc`, label: `${map[key]} 낮은 순` }]
  );
}

export function tableRowKey(row: TableRow, index: number): string {
  if ('key' in row && row.key) return row.key;
  return [row.date, row.campaignName, row.adsetName, row.adName, index].filter(Boolean).join('|') || String(index);
}

export function asStatRow(row: TableRow | undefined): StatRow | undefined {
  if (!row) return undefined;
  if ('key' in row && row.key) return row as StatRow;
  return {
    key: tableRowKey(row, 0),
    date: row.date,
    campaignName: row.campaignName,
    adsetName: row.adsetName,
    adName: row.adName,
    spend: Number(row.spend || 0),
    impression: Number(row.impression || 0),
    click: Number(row.click || 0),
    landingPageView: Number(row.landingPageView || 0),
    ctr: Number(row.ctr || 0),
    cpm: Number(row.cpm || 0),
    cpc: Number(row.cpc || 0),
    roas: Number(row.roas || 0),
    ...(row.reach ? { reach: Number(row.reach) } : {}),
    ...(row.likes ? { likes: Number(row.likes) } : {}),
    ...(row.replies ? { replies: Number(row.replies) } : {}),
    ...(row.reposts ? { reposts: Number(row.reposts) } : {}),
    ...(row.follows ? { follows: Number(row.follows) } : {}),
    ...(row.engagements ? { engagements: Number(row.engagements) } : {}),
    ...(row.cpv ? { cpv: Number(row.cpv) } : {})
  };
}

/** 매체 전용 지표(X·YouTube)의 표기명. 보고서 탭 X 표와 같은 명칭을 쓴다. */
const extraLabels: Record<string, string> = {
  reach: '도달',
  likes: '좋아요',
  replies: '댓글',
  reposts: '리포스트',
  follows: '팔로우',
  engagements: 'ENG',
  profileVisits: '프로필방문',
  cpv: 'TrueView 평균 CPV'
};

export function labelForColumn(column: string): string {
  const map: Record<string, string> = { date: '날짜', campaignAdsetAd: '캠페인 / 광고세트 / 소재' };
  return map[column] || metricLabels[column as MetricKey] || extraLabels[column] || column;
}

export function cell(row: TableRow, column: string): string {
  if (column === 'date') return formatDateWithDay(row.date || '');
  if (column === 'campaignAdsetAd') return [row.campaignName, row.adsetName, row.adName].filter(Boolean).join(' / ');
  if (metricKeys.includes(column as MetricKey)) return formatMetric(column as MetricKey, metricValue(asStatRow(row), column as MetricKey));
  if (extraLabels[column]) {
    const value = Number((row as Record<string, unknown>)[column] || 0);
    return column === 'cpv' ? formatWon(value) : formatCount(value);
  }
  return String((row as Record<string, unknown>)[column] || '');
}

export function kpiLabel(key: keyof Kpi): string {
  const map: Record<keyof Kpi, string> = {
    spendGoal: '광고비 목표',
    salesGoal: '매출 목표',
    impressionGoal: '노출 목표',
    clickGoal: '클릭 목표',
    landingPageViewGoal: 'LP 조회 목표',
    ctrGoal: 'CTR 목표',
    cpmGoal: 'CPM 목표',
    cpcGoal: 'CPC 목표',
    roasGoal: 'ROAS 목표'
  };
  return map[key];
}

export function shortDate(date?: string): string {
  if (!date) return '';
  const [, month, day] = String(date).split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : String(date);
}

export function countUnique(xs: string[]): number { return new Set(xs.filter(Boolean)).size; }
export function toggleSet<T>(set: Set<T>, value: T): Set<T> { const next = new Set(set); next.has(value) ? next.delete(value) : next.add(value); return next; }
export function isString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
export function errorMessage(err: unknown): string { return err instanceof Error ? err.message : String(err || '요청에 실패했습니다.'); }

export function diffTitle(prev: StatRow | undefined, current: StatRow, key: MetricKey): string {
  if (!prev) return '전일 데이터 없음';
  const p = metricValue(prev, key);
  const c = metricValue(current, key);
  if (!p) return '전일 대비 계산 불가';
  const d = ((c - p) / p) * 100;
  return `전일 대비 ${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

export function ctrColor(value: number, max: number): string {
  if (!value || !max) return '#fff';
  const t = Math.min(value / max, 1);
  return `rgba(15, 122, 78, ${0.06 + t * 0.35})`;
}

export function cpmColor(value: number): string {
  if (value >= 1000 || !value) return '#fff';
  const t = Math.max(0, Math.min((1000 - value) / 1000, 1));
  return `rgba(15, 122, 78, ${0.06 + t * 0.35})`;
}

export function darken(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return hex;
  const r = Math.max(0, parseInt(value.slice(0, 2), 16) - amount);
  const g = Math.max(0, parseInt(value.slice(2, 4), 16) - amount);
  const b = Math.max(0, parseInt(value.slice(4, 6), 16) - amount);
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}
