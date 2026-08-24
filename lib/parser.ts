import type { AdPlatform, ParsedRow } from './types';

export type ParseReport = {
  /** 어느 매체 export로 인식했는지. 대시보드 섹션 분리에 그대로 쓰인다. */
  platform: AdPlatform;
  rows: ParsedRow[];
  detected: Record<string, string>;
  warnings: string[];
  preview: ParsedRow[];
};

type Row = Record<string, unknown>;
type Matrix = unknown[][];
type Workbook = { SheetNames: string[]; Sheets: Record<string, unknown> };
type XlsxModule = typeof import('xlsx');

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

/** X 광고 관리자 export 헤더. 보고서 탭의 X 파서와 같은 열을 읽는다. */
const X_ALIASES = {
  date: ['timeperiod', 'date', 'day', '날짜', '일자'],
  campaign: ['campaignname', 'campaign'],
  adset: ['adgroupname', 'adgroup'],
  ad: ['adname'],
  impression: ['impressions'],
  reach: ['reach'],
  spend: ['spend'],
  click: ['linkclicks'],
  likes: ['likes'],
  replies: ['replies'],
  reposts: ['reposts'],
  follows: ['follows'],
  profileVisits: ['profilevisits'],
  ctr: ['ctr'],
  cpm: ['cpm'],
  cpc: ['costperlinkclick', 'cpc'],
  cpe: ['costperengagement'],
  engagements: ['engagements']
} as const;

/**
 * YouTube(Google Ads) 광고 보고서 헤더.
 * TrueView 평균 CPV / 평균 CPM / 노출수 / 상호작용 수 / 상호작용 발생률 / 평균 비용 / 비용 을 읽는다.
 */
const YOUTUBE_ALIASES = {
  date: ['일', '날짜', 'day', 'date'],
  campaign: ['캠페인', '캠페인이름', 'campaign'],
  adset: ['광고그룹', '광고그룹이름', 'adgroup'],
  ad: ['광고이름', 'adname'],
  cpv: ['trueview평균cpv', '평균cpv', 'avgcpv'],
  cpm: ['평균cpm', 'avgcpm', 'averagecpm'],
  impression: ['노출수', 'impressions', 'impr'],
  // 캠페인 목표에 따라 '상호작용 수'로 내려오기도, '클릭수'로 내려오기도 한다.
  click: ['상호작용수', '클릭수', 'interactions', 'clicks'],
  ctr: ['상호작용발생률', '클릭률ctr', '클릭률', 'interactionrate', 'ctr'],
  cpc: ['평균비용', '평균cpc', 'avgcpc', 'averagecpc', 'avgcost', 'averagecost'],
  spend: ['비용', 'cost'],
  status: ['광고상태', 'adstate', 'adstatus']
} as const;

type XKey = keyof typeof X_ALIASES;
type YoutubeKey = keyof typeof YOUTUBE_ALIASES;

const HEADER_SCAN_ROWS = 12;

export async function parseAdFile(file: File): Promise<ParseReport> {
  const XLSX = await import('xlsx');
  const workbook = await readWorkbook(file, XLSX);

  const x = parseXWorkbook(workbook, XLSX);
  if (x) return x;

  const youtube = parseYoutubeWorkbook(workbook, XLSX);
  if (youtube) return youtube;

  return parseMetaWorkbook(workbook, XLSX);
}

/** 예전 이름. Meta 전용이 아니라 매체를 자동 인식한다. */
export const parseMetaFile = parseAdFile;

/* ------------------------------------------------------------------ 파일 읽기 */

async function readWorkbook(file: File, XLSX: XlsxModule): Promise<Workbook> {
  const buffer = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    return XLSX.read(decodeText(buffer), { type: 'string', cellDates: true }) as unknown as Workbook;
  }
  return XLSX.read(buffer, { type: 'array', cellDates: true }) as unknown as Workbook;
}

/** Google Ads CSV는 UTF-16LE + 탭 구분으로 내려오므로 BOM을 보고 디코딩을 고른다. */
function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function sheetMatrix(workbook: Workbook, XLSX: XlsxModule, sheetName: string): Matrix {
  const sheet = workbook.Sheets[sheetName] as Parameters<XlsxModule['utils']['sheet_to_json']>[0];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false }) as Matrix;
}

/* ------------------------------------------------------------------ 헤더 매칭 */

function compactHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-/\\()[\]{}:.,%₩$]/g, '')
    .trim();
}

/** 별칭은 앞에 적힌 것이 우선한다. (예: Ad Group name 이 Ad Group ID 보다 먼저 잡히도록) */
function detectColumns<K extends string>(headers: unknown[], aliases: Record<K, readonly string[]>): Partial<Record<K, number>> {
  const normalized = headers.map(header => compactHeader(header));
  const columns: Partial<Record<K, number>> = {};
  const used = new Set<number>();
  for (const [key, list] of Object.entries(aliases) as [K, readonly string[]][]) {
    for (const alias of list) {
      const index = normalized.findIndex((header, i) => header === alias && !used.has(i));
      if (index === -1) continue;
      columns[key] = index;
      used.add(index);
      break;
    }
  }
  return columns;
}

function cellAt(row: unknown[], index: number | undefined): unknown {
  return index === undefined ? null : row[index] ?? null;
}

/* ------------------------------------------------------------------ X 파서 */

function parseXWorkbook(workbook: Workbook, XLSX: XlsxModule): ParseReport | null {
  for (const sheetName of workbook.SheetNames) {
    const matrix = sheetMatrix(workbook, XLSX, sheetName);
    const scan = Math.min(matrix.length, HEADER_SCAN_ROWS);
    for (let headerRow = 0; headerRow < scan; headerRow += 1) {
      const columns = detectColumns<XKey>(matrix[headerRow] || [], X_ALIASES);
      if (columns.date === undefined || columns.impression === undefined || columns.spend === undefined) continue;

      const headers = matrix[headerRow] || [];
      const detected: Record<string, string> = {};
      for (const [key, index] of Object.entries(columns) as [XKey, number][]) {
        detected[key] = String(headers[index] ?? '');
      }

      const rows = matrix
        .slice(headerRow + 1)
        .map(row => toXRow(row || [], columns))
        .filter((row): row is ParsedRow => Boolean(row));
      if (!rows.length) continue;

      const warnings: string[] = [];
      if (columns.reach === undefined) warnings.push('Reach 열을 찾지 못해 도달·평균 빈도는 0으로 표시됩니다.');
      if (columns.cpe === undefined && columns.engagements === undefined) {
        warnings.push('Cost per engagement 열이 없어 인게이지먼트·CPE를 계산할 수 없습니다.');
      }
      return { platform: 'x', rows, detected, warnings, preview: rows.slice(0, 10) };
    }
  }
  return null;
}

function toXRow(row: unknown[], columns: Partial<Record<XKey, number>>): ParsedRow | null {
  const date = parseDate(cellAt(row, columns.date));
  if (!date) return null;

  const spend = parseNumber(cellAt(row, columns.spend));
  const impression = parseNumber(cellAt(row, columns.impression));
  const click = parseNumber(cellAt(row, columns.click));
  const ctr = parseNumber(cellAt(row, columns.ctr));
  const cpm = parseNumber(cellAt(row, columns.cpm));
  const cpc = parseNumber(cellAt(row, columns.cpc));
  const cpe = parseNumber(cellAt(row, columns.cpe));
  const engagementsColumn = parseNumber(cellAt(row, columns.engagements));
  // export에 인게이지먼트 수 열이 없으면 광고비 ÷ CPE로 역산한다. (보고서 탭 X 파서와 동일)
  const engagements = engagementsColumn || (cpe > 0 ? Math.round(spend / cpe) : 0);

  // export에 있는 층만 채운다. (광고그룹만 있는 파일에서 캠페인·광고 이름을 지어내지 않는다)
  const campaignName = cleanText(cellAt(row, columns.campaign));
  const adName = cleanText(cellAt(row, columns.ad));
  const adsetName = cleanText(cellAt(row, columns.adset)) || (campaignName || adName ? '' : 'X 광고');

  return {
    date,
    campaignName,
    adsetName,
    adName,
    spend,
    impression,
    click,
    landingPageView: 0,
    ctr,
    cpm,
    cpc,
    roas: 0,
    reach: parseNumber(cellAt(row, columns.reach)),
    likes: parseNumber(cellAt(row, columns.likes)),
    replies: parseNumber(cellAt(row, columns.replies)),
    reposts: parseNumber(cellAt(row, columns.reposts)),
    follows: parseNumber(cellAt(row, columns.follows)),
    profileVisits: parseNumber(cellAt(row, columns.profileVisits)),
    engagements,
    ctrWeight: columns.ctr !== undefined ? impression : 0,
    cpmWeight: columns.cpm !== undefined ? impression : 0,
    cpcWeight: columns.cpc !== undefined && click > 0 ? click : 0,
    roasWeight: 0
  };
}

/* ------------------------------------------------------------------ YouTube 파서 */

function parseYoutubeWorkbook(workbook: Workbook, XLSX: XlsxModule): ParseReport | null {
  for (const sheetName of workbook.SheetNames) {
    const matrix = sheetMatrix(workbook, XLSX, sheetName);
    const scan = Math.min(matrix.length, HEADER_SCAN_ROWS);
    for (let headerRow = 0; headerRow < scan; headerRow += 1) {
      const columns = detectColumns<YoutubeKey>(matrix[headerRow] || [], YOUTUBE_ALIASES);
      const looksLikeYoutube =
        columns.impression !== undefined &&
        columns.spend !== undefined &&
        (columns.click !== undefined || columns.cpv !== undefined);
      if (!looksLikeYoutube) continue;

      const headers = matrix[headerRow] || [];
      const detected: Record<string, string> = {};
      for (const [key, index] of Object.entries(columns) as [YoutubeKey, number][]) {
        detected[key] = String(headers[index] ?? '');
      }

      const rows = matrix
        .slice(headerRow + 1)
        .map(row => toYoutubeRow(row || [], columns))
        .filter((row): row is ParsedRow => Boolean(row));
      if (!rows.length) continue;

      const warnings: string[] = [];
      if (columns.date === undefined) {
        warnings.push('날짜(일) 열이 없어 기간 전체 합계 한 줄로 저장됩니다. 일자별로 보려면 보고서에 "일" 세그먼트를 추가해 내려받으세요.');
      }
      if (columns.cpv === undefined) warnings.push('TrueView 평균 CPV 열을 찾지 못했습니다.');
      return { platform: 'youtube', rows, detected, warnings, preview: rows.slice(0, 10) };
    }
  }
  return null;
}

function toYoutubeRow(row: unknown[], columns: Partial<Record<YoutubeKey, number>>): ParsedRow | null {
  const label = cleanText(cellAt(row, columns.status)) || cleanText(row[0]);
  // "전체: 계정", "총계: 캠페인" 같은 Google Ads 요약 행은 중복 합산되므로 제외한다.
  if (/^(전체|총계|합계|total)\s*:/i.test(label)) return null;

  const campaignName = cleanText(cellAt(row, columns.campaign));
  const adsetName = cleanText(cellAt(row, columns.adset));
  const adName = cleanText(cellAt(row, columns.ad));
  const impression = parseNumber(cellAt(row, columns.impression));
  const spend = parseNumber(cellAt(row, columns.spend));
  const click = parseNumber(cellAt(row, columns.click));
  if (!campaignName && !adsetName && !adName && !impression && !spend) return null;

  const ctr = parseNumber(cellAt(row, columns.ctr));
  const cpm = parseNumber(cellAt(row, columns.cpm));
  const cpc = parseNumber(cellAt(row, columns.cpc));
  const cpv = parseNumber(cellAt(row, columns.cpv));

  return {
    date: parseDate(cellAt(row, columns.date)),
    campaignName: campaignName || '미분류 캠페인',
    adsetName: adsetName || '미분류 광고그룹',
    adName: adName || '이름 없는 소재',
    spend,
    impression,
    click,
    landingPageView: 0,
    ctr,
    cpm,
    cpc,
    roas: 0,
    cpv,
    // 값이 0이어도 열이 있으면 가중치를 준다. 0%인 행도 평균을 희석해야 하기 때문이다.
    ctrWeight: columns.ctr !== undefined ? impression : 0,
    cpmWeight: columns.cpm !== undefined ? impression : 0,
    // 클릭 없이 비용만 나간 행(동영상 조회 캠페인)이 많아 CPC는 비용 ÷ 클릭으로 다시 계산한다.
    cpcWeight: 0,
    roasWeight: 0,
    cpvWeight: cpv > 0 ? impression : 0
  };
}

/* ------------------------------------------------------------------ Meta 파서 */

function parseMetaWorkbook(workbook: Workbook, XLSX: XlsxModule): ParseReport {
  const sheet = workbook.Sheets[workbook.SheetNames[0]] as Parameters<XlsxModule['utils']['sheet_to_json']>[0];
  const rawRows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: false });
  const detected: Record<string, string> = {};
  const parsed = rawRows.map(row => parseRow(row, detected)).filter((r): r is ParsedRow => Boolean(r?.date));
  const warnings: string[] = [];
  if (!parsed.length) warnings.push('날짜가 감지된 행이 없습니다. Meta Ads Manager 원본 export인지 확인하세요.');
  if (!detected.ctr) warnings.push('CTR 컬럼을 찾지 못했습니다. CTR은 링크클릭/노출 기준으로 보정될 수 있습니다.');
  if (!detected.cpc) warnings.push('CPC 컬럼을 찾지 못했습니다. CPC는 클릭 수가 있을 때만 계산됩니다.');
  if (!detected.landing && !(detected.resultType && detected.result)) warnings.push('LP 조회 컬럼을 찾지 못했습니다. 결과 유형/결과 조합도 확인합니다.');
  return { platform: 'meta', rows: parsed, detected, warnings, preview: parsed.slice(0, 10) };
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
    // 값이 0이어도 열이 있으면 가중치를 준다. (예전에는 합계 단계에서만 이렇게 보정했다)
    ctrWeight: ctrMatch ? impression : 0,
    cpmWeight: cpmMatch ? impression : 0,
    cpcWeight: cpcMatch && click > 0 ? click : 0,
    roasWeight: roasMatch ? Math.max(spend, 1) : 0,
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

/* ------------------------------------------------------------------ 공용 유틸 */

function cleanText(value: unknown): string {
  const text = String(value ?? '').trim();
  return text === '--' || text === 'null' || text === 'undefined' ? '' : text;
}

function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const str = String(value).replace(/,/g, '').replace(/[₩$%]/g, '').trim();
  if (!str || str === '-' || str === '--') return 0;
  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toIsoDate(value);
  const s = String(value).trim();
  const m1 = s.match(/(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : toIsoDate(d);
}

function toIsoDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
