import type { ParsedRow, StatRow } from './types';

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
};

function add(bucket: Bucket, row: ParsedRow) {
  bucket.spend += row.spend;
  bucket.impression += row.impression;
  bucket.click += row.click;
  bucket.landingPageView += row.landingPageView;
  if (row.ctrWeight > 0) { bucket.ctrWeighted += row.ctr * row.ctrWeight; bucket.ctrWeight += row.ctrWeight; }
  if (row.cpmWeight > 0) { bucket.cpmWeighted += row.cpm * row.cpmWeight; bucket.cpmWeight += row.cpmWeight; }
  if (row.cpcWeight > 0) { bucket.cpcWeighted += row.cpc * row.cpcWeight; bucket.cpcWeight += row.cpcWeight; }
  if (row.roasWeight > 0) { bucket.roasWeighted += row.roas * row.roasWeight; bucket.roasWeight += row.roasWeight; }
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
    roas: round4(b.roasWeight ? b.roasWeighted / b.roasWeight : 0)
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
        roasWeight: 0
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
    ctrWeight: Number(('ctrWeight' in r ? r.ctrWeight : 0) || r.impression || 0),
    cpmWeight: Number(('cpmWeight' in r ? r.cpmWeight : 0) || r.impression || 0),
    cpcWeight: Number(('cpcWeight' in r ? r.cpcWeight : 0) || r.click || 0),
    roasWeight: Number(('roasWeight' in r ? r.roasWeight : 0) || r.spend || 0)
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
    roasWeight: r.spend
  })) as ParsedRow[];
  return aggregateRows(parsed, getKey as unknown as (row: ParsedRow) => Partial<Bucket> & { key: string });
}

export function emptyStat(key = 'empty'): StatRow {
  return { key, spend: 0, impression: 0, click: 0, landingPageView: 0, ctr: 0, cpm: 0, cpc: 0, roas: 0 };
}

function round2(n: number) { return Math.round((Number(n) || 0) * 100) / 100; }
function round4(n: number) { return Math.round((Number(n) || 0) * 10000) / 10000; }
