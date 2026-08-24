import { parseDate, parseNumber } from './normalize';
import { normalizeHeader } from './schema';

/**
 * X(구 트위터) 광고 관리자에서 내려받는 export 파일 전용 파서.
 * SingleOne RAW에는 없는 좋아요·댓글·리포스트·팔로우·인게이지먼트 지표를 담고 있어 별도 소스로 다룬다.
 */
export type XReportRow = {
  date: string;
  adId: string;
  adName: string;
  impressions: number;
  /** export의 Reach 열. 열이 없던 시절에 저장한 파일에는 비어 있을 수 있다. */
  reach: number;
  spend: number;
  linkClicks: number;
  likes: number;
  replies: number;
  reposts: number;
  follows: number;
  /** export의 Profile visits 열. 열을 읽기 전에 저장한 파일에는 비어 있을 수 있다. */
  profileVisits: number;
  /** export에 인게이지먼트 수 열이 없어 광고비 ÷ CPE로 역산한 값. */
  engagements: number;
};

export type XReportParseResult = {
  fileName: string;
  sheetName: string;
  rows: XReportRow[];
  generatedAt: number;
};

export type XReportSummary = {
  key: string;
  label: string;
  impressions: number;
  reach: number;
  spend: number;
  linkClicks: number;
  likes: number;
  replies: number;
  reposts: number;
  follows: number;
  profileVisits: number;
  engagements: number;
  ctr: number;
  cpm: number;
  cpc: number;
  cpe: number;
  /** 인게이지먼트 발생률(ER). 인게이지먼트 ÷ 노출. */
  engagementRate: number;
  /** 노출 ÷ 도달. export의 Average frequency 열과 같은 정의라 합계 행에서도 일관되게 나온다. */
  frequency: number;
};

const X_COLUMN_ALIASES = {
  date: ['time period', 'date', 'day', '날짜', '일자'],
  adId: ['ad id'],
  adName: ['ad name'],
  impressions: ['impressions'],
  reach: ['reach'],
  spend: ['spend'],
  linkClicks: ['link clicks'],
  likes: ['likes'],
  replies: ['replies'],
  reposts: ['reposts'],
  follows: ['follows'],
  profileVisits: ['profile visits'],
  costPerEngagement: ['cost per engagement']
} as const;

type XColumnKey = keyof typeof X_COLUMN_ALIASES;

const X_REQUIRED_COLUMNS: XColumnKey[] = ['date', 'impressions', 'spend'];

function detectXColumns(headers: unknown[]): Partial<Record<XColumnKey, number>> {
  const normalized = headers.map(header => normalizeHeader(header));
  const columns: Partial<Record<XColumnKey, number>> = {};
  const used = new Set<number>();
  for (const [key, aliases] of Object.entries(X_COLUMN_ALIASES) as [XColumnKey, readonly string[]][]) {
    const index = normalized.findIndex(
      (header, headerIndex) => header && !used.has(headerIndex) && aliases.includes(header)
    );
    if (index === -1) continue;
    columns[key] = index;
    used.add(index);
  }
  return columns;
}

function toXReportRow(row: unknown[], columns: Partial<Record<XColumnKey, number>>): XReportRow | null {
  const cell = (key: XColumnKey) => {
    const index = columns[key];
    return index === undefined ? null : row[index] ?? null;
  };

  const date = parseDate(cell('date'));
  if (!date) return null;

  const spend = parseNumber(cell('spend'));
  const costPerEngagement = parseNumber(cell('costPerEngagement'));

  return {
    date,
    adId: String(cell('adId') ?? '').trim(),
    adName: String(cell('adName') ?? '').trim() || '이름 없는 소재',
    impressions: parseNumber(cell('impressions')),
    reach: parseNumber(cell('reach')),
    spend,
    linkClicks: parseNumber(cell('linkClicks')),
    likes: parseNumber(cell('likes')),
    replies: parseNumber(cell('replies')),
    reposts: parseNumber(cell('reposts')),
    follows: parseNumber(cell('follows')),
    profileVisits: parseNumber(cell('profileVisits')),
    engagements: costPerEngagement > 0 ? Math.round(spend / costPerEngagement) : 0
  };
}

export async function parseXReportFile(file: File): Promise<XReportParseResult> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellNF: false, cellText: false });

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: false
    }) as unknown[][];

    const maxHeaderScan = Math.min(matrix.length, 12);
    for (let rowIndex = 0; rowIndex < maxHeaderScan; rowIndex += 1) {
      const columns = detectXColumns(matrix[rowIndex] || []);
      if (X_REQUIRED_COLUMNS.some(key => columns[key] === undefined)) continue;

      const rows = matrix
        .slice(rowIndex + 1)
        .map(row => toXReportRow(row || [], columns))
        .filter((row): row is XReportRow => Boolean(row))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!rows.length) continue;

      return { fileName: file.name, sheetName, rows, generatedAt: Date.now() };
    }
  }

  throw new Error('X RAW 파일에서 Impressions·Spend 열이 있는 표를 찾지 못했습니다.');
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

export function summarizeXReportRows(key: string, label: string, rows: XReportRow[]): XReportSummary {
  const summary = rows.reduce(
    (acc, row) => {
      acc.impressions += row.impressions;
      // Reach 열을 읽기 전에 저장한 X RAW 파일에는 reach가 없어 그대로 더하면 NaN이 된다.
      acc.reach += Number.isFinite(row.reach) ? row.reach : 0;
      acc.spend += row.spend;
      acc.linkClicks += row.linkClicks;
      acc.likes += row.likes;
      acc.replies += row.replies;
      acc.reposts += row.reposts;
      acc.follows += row.follows;
      // Profile visits 열을 읽기 전에 저장한 X RAW 파일에는 값이 없어 그대로 더하면 NaN이 된다.
      acc.profileVisits += Number.isFinite(row.profileVisits) ? row.profileVisits : 0;
      acc.engagements += row.engagements;
      return acc;
    },
    { key, label, impressions: 0, reach: 0, spend: 0, linkClicks: 0, likes: 0, replies: 0, reposts: 0, follows: 0, profileVisits: 0, engagements: 0 }
  );

  return {
    ...summary,
    spend: Math.round(summary.spend * 100) / 100,
    ctr: safeRatio(summary.linkClicks, summary.impressions),
    cpm: safeRatio(summary.spend * 1000, summary.impressions),
    cpc: safeRatio(summary.spend, summary.linkClicks),
    cpe: safeRatio(summary.spend, summary.engagements),
    engagementRate: safeRatio(summary.engagements, summary.impressions),
    frequency: safeRatio(summary.impressions, summary.reach)
  };
}

/** 일자별 요약 + 맨 앞 합계행. */
export function buildXReportDailyRows(rows: XReportRow[]): XReportSummary[] {
  const grouped = new Map<string, XReportRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.date) || [];
    list.push(row);
    grouped.set(row.date, list);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, list]) => summarizeXReportRows(date, date, list));
}
