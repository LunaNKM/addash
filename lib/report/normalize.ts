import { DEFAULT_EXCHANGE_RATE, DEFAULT_GROSS_RATE, detectColumns, getMissingColumns, scoreDetection } from './schema';
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
    throw new Error('No readable table was found. Check that the file has a header row and data rows.');
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
  const costKrw = explicitCostKrw || (costJpy ? costJpy * exchangeRate : 0);
  const grossCostKrw = parseNumber(value('grossCostKrw')) || (costKrw ? costKrw * DEFAULT_GROSS_RATE : 0);
  const salesJpy = parseNumber(value('salesJpy'));
  const explicitSalesKrw = parseNumber(value('salesKrw'));
  const salesKrw = explicitSalesKrw || (salesJpy ? salesJpy * exchangeRate : 0);
  const impressions = parseNumber(value('impressions'));
  const clicks = parseNumber(value('clicks'));
  const conversions = parseNumber(value('conversions'));
  const addToCart = parseNumber(value('addToCart'));

  if (!date && !impressions && !clicks && !costKrw && !salesKrw) return null;

  return {
    sourceRowNumber,
    date,
    brand: clean(value('brand')),
    media: clean(value('media')),
    promotion: clean(value('promotion')) || 'Uncategorized',
    campaignName: clean(value('campaignName')) || 'Uncategorized Campaign',
    adgroupName: clean(value('adgroupName')) || 'Uncategorized Group',
    adName: clean(value('adName')) || 'Unnamed Creative',
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
    cpc: safeDivide(costKrw, clicks),
    cvr: safeDivide(conversions, clicks),
    cpa: safeDivide(costKrw, conversions),
    cartCpa: safeDivide(costKrw, addToCart),
    roas: safeDivide(salesKrw, costKrw),
    raw: row
  };
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
