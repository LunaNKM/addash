import type { ParsedRow } from './types';

export type ParseReport = {
  rows: ParsedRow[];
  detected: Record<string, string>;
  warnings: string[];
  preview: ParsedRow[];
};

type Row = Record<string, unknown>;

type MatchResult = { key: string; value: unknown } | null;

const exactSets = {
  date: ['일','날짜','date','day','reporting starts','보고 시작','보고시작'],
  campaign: ['캠페인 이름','캠페인명','campaign name'],
  adset: ['광고 세트 이름','광고세트 이름','광고세트명','ad set name','adset name'],
  ad: ['광고 이름','광고명','ad name','ad name / creative'],
  spend: ['지출 금액 (KRW)','지출금액','광고비','금액 소비','amount spent','amount spent (krw)'],
  impression: ['노출','노출수','impressions'],
  click: ['고유 링크 클릭','링크 클릭수','링크 클릭','link clicks','unique link clicks'],
  landing: ['랜딩 페이지 조회','랜딩페이지 조회','landing page views','landing page view','omni landing page view'],
  resultType: ['결과 유형','결과 표시 도구','result type','result indicator'],
  result: ['결과','results','result'],
  ctr: ['CTR(전체)','ctr all','CTR','ctr','CTR(링크 클릭률)','링크 클릭률','link ctr'],
  cpm: ['CPM(1,000회 노출당 비용) (KRW)','CPM(1,000회 노출당 비용)','cpm cost per 1,000 impressions','cpm'],
  cpc: ['CPC(링크 클릭당 비용)','CPC(링크 클릭당 비용) (KRW)','CPC(전체)','CPC(전체) (KRW)','cost per link click','cpc all','cpc'],
  roas: ['ROAS','구매 ROAS','purchase roas','website purchase roas']
};

export async function parseMetaFile(file: File): Promise<ParseReport> {
  const XLSX = await import('xlsx');
  const isCsv = file.name.toLowerCase().endsWith('.csv');
  const data = await readFile(file, isCsv);
  const wb = XLSX.read(data, { type: isCsv ? 'string' : 'binary', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: false });
  const detected: Record<string, string> = {};
  const parsed = rawRows.map(row => parseRow(row, detected)).filter((r): r is ParsedRow => Boolean(r?.date));
  const warnings: string[] = [];
  if (!parsed.length) warnings.push('날짜가 감지된 행이 없습니다. Meta Ads Manager 원본 export인지 확인하세요.');
  if (!detected.ctr) warnings.push('CTR 컬럼을 찾지 못했습니다. CTR은 링크클릭/노출 기준으로 보정될 수 있습니다.');
  if (!detected.cpc) warnings.push('CPC 컬럼을 찾지 못했습니다. CPC는 클릭 수가 있을 때만 계산됩니다.');
  if (!detected.landing && !(detected.resultType && detected.result)) warnings.push('LP 조회 컬럼을 찾지 못했습니다. 결과 유형/결과 조합도 확인합니다.');
  return { rows: parsed, detected, warnings, preview: parsed.slice(0, 10) };
}

function parseRow(row: Row, detected: Record<string, string>): ParsedRow | null {
  const dateMatch = find(row, exactSets.date);
  const date = parseDate(dateMatch?.value);
  if (!date) return null;
  if (dateMatch) detected.date ||= dateMatch.key;

  const adMatch = find(row, exactSets.ad);
  const adName = cleanText(adMatch?.value) || '알 수 없음';
  if (adMatch) detected.ad ||= adMatch.key;
  const inferred = inferNames(adName);

  const campaignMatch = find(row, exactSets.campaign);
  const adsetMatch = find(row, exactSets.adset);
  if (campaignMatch) detected.campaign ||= campaignMatch.key;
  if (adsetMatch) detected.adset ||= adsetMatch.key;

  const spendMatch = find(row, exactSets.spend);
  const impressionMatch = find(row, exactSets.impression);
  const ctrMatch = find(row, exactSets.ctr, { excludeNormIncludes: ['cpc', 'costper'] });
  const cpmMatch = find(row, exactSets.cpm);
  const cpcMatch = find(row, exactSets.cpc, { excludeNormIncludes: ['ctr'] });
  const clickMatch = find(row, exactSets.click, { excludeNormIncludes: ['cpc', 'ctr', 'costper', 'rate', '비용', '률'] });
  const landingMatch = find(row, exactSets.landing, { excludeNormIncludes: ['cost', '비용', '당비용'] });
  const resultTypeMatch = find(row, exactSets.resultType);
  const resultMatch = find(row, exactSets.result);
  const roasMatch = find(row, exactSets.roas);

  if (spendMatch) detected.spend ||= spendMatch.key;
  if (impressionMatch) detected.impression ||= impressionMatch.key;
  if (ctrMatch) detected.ctr ||= ctrMatch.key;
  if (cpmMatch) detected.cpm ||= cpmMatch.key;
  if (cpcMatch) detected.cpc ||= cpcMatch.key;
  if (clickMatch) detected.click ||= clickMatch.key;
  if (landingMatch) detected.landing ||= landingMatch.key;
  if (resultTypeMatch) detected.resultType ||= resultTypeMatch.key;
  if (resultMatch) detected.result ||= resultMatch.key;

  const spend = parseNumber(spendMatch?.value);
  const impression = parseNumber(impressionMatch?.value);
  const cpc = parseNumber(cpcMatch?.value);
  const cpm = parseNumber(cpmMatch?.value);
  const ctr = parseNumber(ctrMatch?.value);
  let click = parseNumber(clickMatch?.value);
  if (!click && cpc > 0 && spend > 0) click = spend / cpc;

  const resultType = cleanText(resultTypeMatch?.value).toLowerCase();
  const resultValue = parseNumber(resultMatch?.value);
  let landing = parseNumber(landingMatch?.value);
  if (!landing && resultValue > 0 && isLandingResult(resultType)) landing = resultValue;

  return {
    date,
    campaignName: cleanText(campaignMatch?.value) || inferred.campaignName || '미분류 캠페인',
    adsetName: cleanText(adsetMatch?.value) || inferred.adsetName || '미분류 광고세트',
    adName,
    spend,
    impression,
    click,
    landingPageView: landing,
    ctr,
    cpm,
    cpc,
    roas: parseNumber(roasMatch?.value),
    ctrWeight: ctr > 0 ? impression : 0,
    cpmWeight: cpm > 0 ? impression : 0,
    cpcWeight: cpc > 0 ? Math.max(click, 1) : 0,
    roasWeight: parseNumber(roasMatch?.value) > 0 ? Math.max(spend, 1) : 0,
    raw: row
  };
}

function find(row: Row, keys: string[], opts: { excludeNormIncludes?: string[] } = {}): MatchResult {
  const entries = Object.entries(row).map(([key, value]) => ({ key, norm: normalizeKey(key), value }));
  const excludes = opts.excludeNormIncludes || [];
  for (const wanted of keys) {
    const norm = normalizeKey(wanted);
    const hit = entries.find(e => e.norm === norm && !excludes.some(ex => e.norm.includes(normalizeKey(ex))) && hasValue(e.value));
    if (hit) return { key: hit.key, value: hit.value };
  }
  for (const wanted of keys) {
    const norm = normalizeKey(wanted);
    if (norm.length < 3) continue;
    const hit = entries.find(e => (e.norm.includes(norm) || norm.includes(e.norm)) && !excludes.some(ex => e.norm.includes(normalizeKey(ex))) && hasValue(e.value));
    if (hit) return { key: hit.key, value: hit.value };
  }
  return null;
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function normalizeKey(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_\-\/()\[\]{}:.,%₩$]/g, '')
    .replace(/전체/g, 'all')
    .replace(/링크클릭/g, 'linkclick')
    .replace(/랜딩페이지조회/g, 'landingpageview');
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const str = String(value).replace(/,/g, '').replace(/[₩$%]/g, '').trim();
  if (!str || str === '-') return 0;
  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value: unknown): string {
  if (!value) return '';
  const s = String(value).trim();
  const m1 = s.match(/(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return '';
}

function isLandingResult(type: string): boolean {
  const t = type.toLowerCase().replace(/\s/g, '');
  return t.includes('landing') || t.includes('랜딩페이지조회') || t.includes('omni_landing_page_view');
}

function inferNames(adName: string): { campaignName?: string; adsetName?: string } {
  const parts = adName.split('_').filter(Boolean);
  if (parts.length >= 2) {
    return { campaignName: parts[1], adsetName: parts.slice(0, 2).join('_') };
  }
  return {};
}

function readFile(file: File, asText: boolean): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    asText ? reader.readAsText(file, 'UTF-8') : reader.readAsBinaryString(file);
  });
}
