import { DEFAULT_EXCHANGE_RATE, detectColumns, getMissingColumns, scoreDetection, toGrossCostKrw } from './schema';
import type { NormalizedReportRow, ReportColumnKey, ReportParseResult, ReportRawRow, SheetDetection } from './reportTypes';
import { validateReportRows } from './validate';

type Matrix = unknown[][];

export async function parseReportFile(file: File, exchangeRate = DEFAULT_EXCHANGE_RATE): Promise<ReportParseResult> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellNF: false, cellText: false });
  const candidates: { detection: SheetDetection; rows: ReportRawRow[]; headers: string[] }[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, raw: false }) as Matrix;
    const candidate = detectSheet(sheetName, matrix);
    if (candidate) candidates.push(candidate);
  }

  const best = candidates.sort((a, b) => b.detection.score - a.detection.score)[0];
  if (!best) {
    throw new Error('읽을 수 있는 데이터 표를 찾지 못했습니다. 헤더 행과 데이터 행이 있는 파일인지 확인해주세요.');
  }

  const rows = normalizeRows(best.rows, best.detection, exchangeRate);
  const issues = validateReportRows(rows, best.detection);
  return {
    fileName: file.name,
    sheet: best.detection,
    detections: Object.values(best.detection.columns).filter(Boolean),
    rows,
    preview: rows.slice(0, 12),
    issues,
    exchangeRate,
    generatedAt: Date.now()
  };
}

function detectSheet(sheetName: string, matrix: Matrix) {
  let best: { headerRowIndex: number; headers: string[]; detection: SheetDetection } | null = null;
  const maxHeaderScan = Math.min(matrix.length, 12);
  for (let rowIndex = 0; rowIndex < maxHeaderScan; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const headers = row.map((value, index) => String(value || '').trim() || `__blank_${index + 1}`);
    const columns = detectColumns(headers);
    const rowCount = Math.max(matrix.length - rowIndex - 1, 0);
    const missing = getMissingColumns(columns);
    const detection: SheetDetection = {
      sheetName,
      headerRowIndex: rowIndex,
      rowCount,
      score: scoreDetection(columns, rowCount),
      columns,
      ...missing
    };
    if (!best || detection.score > best.detection.score) best = { headerRowIndex: rowIndex, headers, detection };
  }

  if (!best || best.detection.score < 20) return null;
  const rows = matrix
    .slice(best.headerRowIndex + 1)
    .filter(row => row.some(value => value !== null && value !== undefined && String(value).trim() !== ''))
    .map(row => toObject(best.headers, row));

  return { detection: { ...best.detection, rowCount: rows.length }, rows, headers: best.headers };
}

function toObject(headers: string[], row: unknown[]): ReportRawRow {
  return headers.reduce<ReportRawRow>((acc, header, index) => {
    acc[header] = row[index] ?? null;
    return acc;
  }, {});
}

function normalizeRows(rows: ReportRawRow[], detection: SheetDetection, exchangeRate: number): NormalizedReportRow[] {
  return rows
    .map((row, index) => normalizeRow(row, index + detection.headerRowIndex + 2, detection, exchangeRate))
    .filter((row): row is NormalizedReportRow => Boolean(row?.date || row?.campaignName || row?.promotion));
}

function normalizeRow(
  row: ReportRawRow,
  sourceRowNumber: number,
  detection: SheetDetection,
  exchangeRate: number
): NormalizedReportRow | null {
  const value = (key: ReportColumnKey) => {
    const column = detection.columns[key];
    if (!column) return null;
    return row[column.header];
  };

  const date = parseDate(value('date'));
  const costJpy = parseNumber(value('costJpy'));
  const explicitCostKrw = parseNumber(value('costKrw'));
  const costKrw = detection.columns.costKrw ? explicitCostKrw : costJpy ? costJpy * exchangeRate : 0;
  const grossCostKrw = costKrw ? toGrossCostKrw(costKrw, date) : parseNumber(value('grossCostKrw'));
  const salesJpy = parseNumber(value('salesJpy'));
  const explicitSalesKrw = parseNumber(value('salesKrw'));
  const salesKrw = detection.columns.salesKrw ? explicitSalesKrw : salesJpy ? salesJpy * exchangeRate : 0;
  const impressions = parseNumber(value('impressions'));
  const clicks = parseNumber(value('clicks'));
  const conversions = parseNumber(value('conversions'));
  const addToCart = parseNumber(value('addToCart'));

  if (!date && !impressions && !clicks && !costKrw && !salesKrw) return null;

  const campaignName = clean(value('campaignName')) || '미분류 캠페인';
  const adgroupName = clean(value('adgroupName')) || '미분류 광고그룹';
  const adName = clean(value('adName')) || '이름 없는 소재';
  const identity = `${campaignName} ${adgroupName} ${adName}`;

  return {
    sourceRowNumber,
    date,
    brand: clean(value('brand')),
    media: resolveMedia(clean(value('media')), identity),
    promotion: clean(value('promotion')) || inferPromotion(identity) || '미분류',
    campaignName,
    adgroupName,
    adName,
    impressions,
    clicks,
    conversions,
    costJpy,
    costKrw,
    grossCostKrw,
    salesJpy,
    salesKrw,
    addToCart,
    registration: parseNumber(value('registration')),
    lead: parseNumber(value('lead')),
    order: parseNumber(value('order')),
    ctr: safeDivide(clicks, impressions),
    cpm: safeDivide(costKrw * 1000, impressions),
    cpc: safeDivide(costKrw, clicks),
    cvr: safeDivide(conversions, clicks),
    cpa: safeDivide(costKrw, conversions),
    cartCpa: safeDivide(costKrw, addToCart),
    roas: safeDivide(salesKrw, costKrw),
    raw: row
  };
}

/**
 * SingleOne에서 직접 받은 RAW는 media 열이 S-META까지 전부 "meta"로 내려온다.
 * 실제 구분은 캠페인·광고세트·광고 이름에 들어 있는 S-META / S-TIKTOK 같은 토큰에 있으므로 거기서 다시 읽는다.
 * (x, s-line처럼 이미 구분된 매체 값은 그대로 둔다)
 */
const META_MEDIA_VALUES = new Set(['', 'meta', 's-meta', 'facebook', 'fb']);
// 이름은 언더바로 이어 붙기 때문에(2608_Easydew_S-META_ATC) \b 대신 앞뒤 구분자를 직접 본다.
const SINGLEONE_MEDIA_PATTERN = /(^|[^a-z0-9])s[-_ ]?(meta|tiktok|line)([^a-z0-9]|$)/i;

function resolveMedia(media: string, identity: string): string {
  const key = media.trim().toLowerCase();
  if (!META_MEDIA_VALUES.has(key)) return media.trim();
  const matched = identity.match(SINGLEONE_MEDIA_PATTERN);
  if (matched) return `s-${matched[2].toLowerCase()}`;
  // 이름에 단서가 없으면 원래 media 값을 그대로 둔다. (이미 s-meta로 내려온 예전 RAW는 그대로 유지)
  return media.trim();
}

/** 캠페인 분류(promotion) 열이 없는 RAW는 이름에서 프로모션을 유추한다. 앞에 적힌 것이 우선한다. */
const PROMOTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /mega[-_ ]?wari|메가와리/i, label: '메가와리' },
  { pattern: /mega[-_ ]?po|메가포/i, label: '메가포' },
  { pattern: /always[-_ ]?on|상시|(^|[^a-z0-9])bau([^a-z0-9]|$)/i, label: '상시' }
];

function inferPromotion(identity: string): string {
  return PROMOTION_PATTERNS.find(item => item.pattern.test(identity))?.label || '';
}

export function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value)
    .replace(/,/g, '')
    .replace(/[₩¥￥%]/g, '')
    .trim();
  if (!cleaned || cleaned === '-' || cleaned.startsWith('=')) return 0;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

export function parseDate(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toIsoDate(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return toIsoDate(new Date(excelEpoch + value * 86400000));
  }
  const text = String(value).trim();
  const matched = text.match(/(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (matched) {
    return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : toIsoDate(parsed);
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clean(value: unknown): string {
  const text = String(value ?? '').trim();
  return text === 'null' || text === 'undefined' ? '' : text;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}
