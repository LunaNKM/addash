import type { ParsedRow, StatRow } from './types';

/** 매체 전용 지표 중 단순 합산되는 것들. */
const EXTRA_SUM_KEYS = ['reach', 'likes', 'replies', 'reposts', 'follows', 'engagements', 'profileVisits'] as const;
type ExtraSumKey = typeof EXTRA_SUM_KEYS[number];

type Bucket = {
  key: string;
  date?: string;
  campaignName?: string;
  adsetName?: string;
  adName?: string;
  spend: number;
  impression: number;
  click: number;
  landingPageView: number;
  ctrWeighted: number;
  ctrWeight: number;
  cpmWeighted: number;
  cpmWeight: number;
  cpcWeighted: number;
  cpcWeight: number;
  roasWeighted: number;
  roasWeight: number;
  cpvWeighted: number;
  cpvWeight: number;
} & Record<ExtraSumKey, number>;

function add(bucket: Bucket, row: ParsedRow) {
  bucket.spend += row.spend;
  bucket.impression += row.impression;
  bucket.click += row.click;
  bucket.landingPageView += row.landingPageView;
  if (row.ctrWeight > 0) { bucket.ctrWeighted += row.ctr * row.ctrWeight; bucket.ctrWeight += row.ctrWeight; }
  if (row.cpmWeight > 0) { bucket.cpmWeighted += row.cpm * row.cpmWeight; bucket.cpmWeight += row.cpmWeight; }
  if (row.cpcWeight > 0) { bucket.cpcWeighted += row.cpc * row.cpcWeight; bucket.cpcWeight += row.cpcWeight; }
  if (row.roasWeight > 0) { bucket.roasWeighted += row.roas * row.roasWeight; bucket.roasWeight += row.roasWeight; }
  const cpvWeight = Number(row.cpvWeight ?? (Number(row.cpv || 0) > 0 ? row.impression : 0));
  if (cpvWeight > 0) { bucket.cpvWeighted += Number(row.cpv || 0) * cpvWeight; bucket.cpvWeight += cpvWeight; }
  for (const key of EXTRA_SUM_KEYS) bucket[key] += Number(row[key] || 0);
}

/** 0인 매체 전용 지표는 필드를 만들지 않는다. Meta 파일 문서를 예전과 동일하게 유지하기 위함. */
function extraFields(b: Bucket): Partial<StatRow> {
  const out: Partial<StatRow> = {};
  for (const key of EXTRA_SUM_KEYS) {
    if (b[key]) out[key] = round2(b[key]);
  }
  if (b.cpvWeight > 0) out.cpv = round2(b.cpvWeighted / b.cpvWeight);
  return out;
}

function cleanText(value?: string) { return value || undefined; }

function finalize(b: Bucket): StatRow {
  return {
    key: b.key,
    ...(cleanText(b.date) ? { date: b.date } : {}),
    ...(cleanText(b.campaignName) ? { campaignName: b.campaignName } : {}),
    ...(cleanText(b.adsetName) ? { adsetName: b.adsetName } : {}),
    ...(cleanText(b.adName) ? { adName: b.adName } : {}),
    spend: round2(b.spend),
    impression: Math.round(b.impression),
    click: round2(b.click),
    landingPageView: round2(b.landingPageView),
    ctr: round4(b.ctrWeight ? b.ctrWeighted / b.ctrWeight : (b.impression ? (b.click / b.impression) * 100 : 0)),
    cpm: round2(b.cpmWeight ? b.cpmWeighted / b.cpmWeight : (b.impression ? (b.spend / b.impression) * 1000 : 0)),
    cpc: round2(b.cpcWeight ? b.cpcWeighted / b.cpcWeight : (b.click ? b.spend / b.click : 0)),
    roas: round4(b.roasWeight ? b.roasWeighted / b.roasWeight : 0),
    ...extraFields(b)
  };
}

export function aggregateRows(rows: ParsedRow[], getKey: (row: ParsedRow) => Partial<Bucket> & { key: string }): StatRow[] {
  const map = new Map<string, Bucket>();
  for (const row of rows) {
    const base = getKey(row);
    let bucket = map.get(base.key);
    if (!bucket) {
      bucket = {
        key: base.key,
        date: base.date,
        campaignName: base.campaignName,
        adsetName: base.adsetName,
        adName: base.adName,
        spend: 0,
        impression: 0,
        click: 0,
        landingPageView: 0,
        ctrWeighted: 0,
        ctrWeight: 0,
        cpmWeighted: 0,
        cpmWeight: 0,
        cpcWeighted: 0,
        cpcWeight: 0,
        roasWeighted: 0,
        roasWeight: 0,
        cpvWeighted: 0,
        cpvWeight: 0,
        reach: 0,
        likes: 0,
        replies: 0,
        reposts: 0,
        follows: 0,
        engagements: 0,
        profileVisits: 0
      };
      map.set(base.key, bucket);
    }
    add(bucket, row);
  }
  return [...map.values()].map(finalize);
}

export function totalStat(rows: ParsedRow[] | StatRow[], key = 'total'): StatRow {
  const converted = rows.map((r) => ({
    date: 'date' in r ? r.date || '' : '',
    campaignName: 'campaignName' in r ? r.campaignName || '' : '',
    adsetName: 'adsetName' in r ? r.adsetName || '' : '',
    adName: 'adName' in r ? r.adName || '' : '',
    spend: Number(r.spend || 0),
    impression: Number(r.impression || 0),
    click: Number(r.click || 0),
    landingPageView: Number(r.landingPageView || 0),
    ctr: Number(r.ctr || 0),
    cpm: Number(r.cpm || 0),
    cpc: Number(r.cpc || 0),
    roas: Number(r.roas || 0),
    // 파싱 단계에서 가중치를 0으로 정한 행(예: YouTube CPC)은 그 뜻을 지켜 다시 계산하게 둔다.
    ctrWeight: 'ctrWeight' in r ? Number(r.ctrWeight || 0) : Number(r.impression || 0),
    cpmWeight: 'cpmWeight' in r ? Number(r.cpmWeight || 0) : Number(r.impression || 0),
    cpcWeight: 'cpcWeight' in r ? Number(r.cpcWeight || 0) : Number(r.click || 0),
    roasWeight: 'roasWeight' in r ? Number(r.roasWeight || 0) : Number(r.spend || 0),
    cpv: Number(r.cpv || 0),
    cpvWeight: Number(('cpvWeight' in r ? r.cpvWeight : 0) || (Number(r.cpv || 0) > 0 ? r.impression : 0) || 0),
    reach: Number(r.reach || 0),
    likes: Number(r.likes || 0),
    replies: Number(r.replies || 0),
    reposts: Number(r.reposts || 0),
    follows: Number(r.follows || 0),
    engagements: Number(r.engagements || 0),
    profileVisits: Number(r.profileVisits || 0)
  })) as ParsedRow[];
  return aggregateRows(converted, () => ({ key }))[0] || emptyStat(key);
}

export function buildFileStats(rows: ParsedRow[]) {
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  const total = totalStat(rows);
  const dailyStats = aggregateRows(rows, r => ({ key: r.date, date: r.date })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const campaignDailyStats = aggregateRows(rows, r => ({ key: `${r.date}|||${r.campaignName}`, date: r.date, campaignName: r.campaignName }));
  const adsetDailyStats = aggregateRows(rows, r => ({ key: `${r.date}|||${r.campaignName}|||${r.adsetName}`, date: r.date, campaignName: r.campaignName, adsetName: r.adsetName }));
  const detailStats = aggregateRows(rows, r => ({ key: `${r.date}|||${r.campaignName}|||${r.adsetName}`, date: r.date, campaignName: r.campaignName, adsetName: r.adsetName })).filter(r => r.spend > 0);
  const creativeStats = aggregateRows(rows, r => ({ key: `${r.campaignName}|||${r.adsetName}|||${r.adName}`, campaignName: r.campaignName, adsetName: r.adsetName, adName: r.adName }));
  return {
    dateStart: dates[0] || '',
    dateEnd: dates[dates.length - 1] || '',
    rowCount: rows.length,
    total,
    dailyStats,
    campaignDailyStats,
    adsetDailyStats,
    detailStats,
    creativeStats
  };
}

export function mergeStats(files: { dailyStats: StatRow[]; campaignDailyStats: StatRow[]; adsetDailyStats: StatRow[]; detailStats: StatRow[]; creativeStats: StatRow[]; total: StatRow }[]) {
  return {
    dailyStats: aggregateStats(files.flatMap(f => f.dailyStats), r => ({ key: r.date || '', date: r.date })),
    campaignDailyStats: aggregateStats(files.flatMap(f => f.campaignDailyStats), r => ({ key: `${r.date}|||${r.campaignName}`, date: r.date, campaignName: r.campaignName })),
    adsetDailyStats: aggregateStats(files.flatMap(f => f.adsetDailyStats), r => ({ key: `${r.date}|||${r.campaignName}|||${r.adsetName}`, date: r.date, campaignName: r.campaignName, adsetName: r.adsetName })),
    detailStats: aggregateStats(files.flatMap(f => f.detailStats), r => ({ key: `${r.date}|||${r.campaignName}|||${r.adsetName}`, date: r.date, campaignName: r.campaignName, adsetName: r.adsetName })).filter(r => r.spend > 0),
    creativeStats: aggregateStats(files.flatMap(f => f.creativeStats), r => ({ key: `${r.campaignName}|||${r.adsetName}|||${r.adName}`, campaignName: r.campaignName, adsetName: r.adsetName, adName: r.adName })),
    total: totalStat(files.map(f => f.total))
  };
}

function aggregateStats(rows: StatRow[], getKey: (row: StatRow) => Partial<Bucket> & { key: string }): StatRow[] {
  const parsed = rows.map(r => ({
    date: r.date || '',
    campaignName: r.campaignName || '',
    adsetName: r.adsetName || '',
    adName: r.adName || '',
    spend: r.spend,
    impression: r.impression,
    click: r.click,
    landingPageView: r.landingPageView,
    ctr: r.ctr,
    cpm: r.cpm,
    cpc: r.cpc,
    roas: r.roas,
    ctrWeight: r.impression,
    cpmWeight: r.impression,
    cpcWeight: r.click,
    roasWeight: r.spend,
    cpv: Number(r.cpv || 0),
    cpvWeight: Number(r.cpv || 0) > 0 ? r.impression : 0,
    reach: Number(r.reach || 0),
    likes: Number(r.likes || 0),
    replies: Number(r.replies || 0),
    reposts: Number(r.reposts || 0),
    follows: Number(r.follows || 0),
    engagements: Number(r.engagements || 0),
    profileVisits: Number(r.profileVisits || 0)
  })) as ParsedRow[];
  return aggregateRows(parsed, getKey as unknown as (row: ParsedRow) => Partial<Bucket> & { key: string });
}

export function emptyStat(key = 'empty'): StatRow {
  return { key, spend: 0, impression: 0, click: 0, landingPageView: 0, ctr: 0, cpm: 0, cpc: 0, roas: 0 };
}

function round2(n: number) { return Math.round((Number(n) || 0) * 100) / 100; }
function round4(n: number) { return Math.round((Number(n) || 0) * 10000) / 10000; }
