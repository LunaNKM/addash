import { parseDate, parseNumber } from './normalize';
import { detectColumns } from './schema';
import type { NormalizedReportRow, ReportColumnKey, ReportParseResult, ReportRawRow, SheetDetection } from './reportTypes';

type Matrix = unknown[][];

export type RegistrationSourceRow = {
  sourceRowNumber: number;
  date: string;
  media: string;
  campaignName: string;
  adgroupName: string;
  adName: string;
  registration: number;
};

export type RegistrationParseResult = {
  fileName: string;
  sheet: SheetDetection;
  rows: RegistrationSourceRow[];
};

export type RegistrationMergeStats = {
  sourceRows: number;
  keyedRows: number;
  matchedRows: number;
  matchedKeys: number;
  unmatchedKeys: number;
  appliedTotal: number;
};

export async function parseRegistrationFile(file: File): Promise<RegistrationParseResult> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellNF: false, cellText: false });
  const candidates: { detection: SheetDetection; rows: ReportRawRow[]; headers: string[] }[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, raw: false }) as Matrix;
    const candidate = detectRegistrationSheet(sheetName, matrix);
    if (candidate) candidates.push(candidate);
  }

  const best = candidates.sort((a, b) => b.detection.score - a.detection.score)[0];
  if (!best) {
    throw new Error('Registration 컬럼이 있는 RAW_SingleOne 시트를 찾지 못했습니다.');
  }

  const rows = normalizeRegistrationRows(best.rows, best.detection);
  if (!rows.length) {
    throw new Error('회원가입수로 적용할 수 있는 행을 찾지 못했습니다.');
  }

  return {
    fileName: file.name,
    sheet: best.detection,
    rows
  };
}

export function mergeRegistrationIntoReport(
  report: ReportParseResult,
  registration: RegistrationParseResult
): { result: ReportParseResult; stats: RegistrationMergeStats } {
  const registrationByKey = new Map<string, number>();
  for (const row of registration.rows) {
    const key = registrationRowKey(row);
    if (!key) continue;
    registrationByKey.set(key, (registrationByKey.get(key) || 0) + row.registration);
  }

  const matchedKeys = new Set<string>();
  let matchedRows = 0;
  let appliedTotal = 0;
  const rows = report.rows.map(row => {
    const key = reportRowKey(row);
    if (!key || !registrationByKey.has(key)) return row;
    const registrationValue = registrationByKey.get(key) || 0;
    matchedRows += 1;
    matchedKeys.add(key);
    appliedTotal += registrationValue;
    return { ...row, registration: registrationValue };
  });

  const stats: RegistrationMergeStats = {
    sourceRows: registration.rows.length,
    keyedRows: registrationByKey.size,
    matchedRows,
    matchedKeys: matchedKeys.size,
    unmatchedKeys: Math.max(registrationByKey.size - matchedKeys.size, 0),
    appliedTotal
  };

  return {
    result: {
      ...report,
      rows,
      preview: rows.slice(0, 12),
      generatedAt: Date.now()
    },
    stats
  };
}

function detectRegistrationSheet(sheetName: string, matrix: Matrix) {
  let best: { headerRowIndex: number; headers: string[]; detection: SheetDetection } | null = null;
  const maxHeaderScan = Math.min(matrix.length, 12);
  for (let rowIndex = 0; rowIndex < maxHeaderScan; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const headers = row.map((value, index) => String(value || '').trim() || `__blank_${index + 1}`);
    const columns = detectColumns(headers);
    if (!columns.registration) continue;

    const rowCount = Math.max(matrix.length - rowIndex - 1, 0);
    const detection: SheetDetection = {
      sheetName,
      headerRowIndex: rowIndex,
      rowCount,
      score: registrationSheetScore(sheetName, columns, rowCount),
      columns,
      missingRequired: ['date', 'campaignName', 'adgroupName', 'adName', 'registration'].filter(key => !columns[key as ReportColumnKey]) as ReportColumnKey[],
      missingRecommended: []
    };
    if (!best || detection.score > best.detection.score) best = { headerRowIndex: rowIndex, headers, detection };
  }

  if (!best || best.detection.score < 30) return null;
  const rows = matrix
    .slice(best.headerRowIndex + 1)
    .filter(row => row.some(value => value !== null && value !== undefined && String(value).trim() !== ''))
    .map(row => toObject(best.headers, row));

  return { detection: { ...best.detection, rowCount: rows.length }, rows, headers: best.headers };
}

function registrationSheetScore(sheetName: string, columns: SheetDetection['columns'], rowCount: number): number {
  const normalizedSheetName = normalizeSheetName(sheetName);
  const hasRawSingleOne = normalizedSheetName.includes('raw singleone') || normalizedSheetName.includes('raw single one');
  const columnScore =
    (columns.registration ? 30 : 0) +
    (columns.date ? 10 : 0) +
    (columns.media ? 4 : 0) +
    (columns.campaignName ? 8 : 0) +
    (columns.adgroupName ? 8 : 0) +
    (columns.adName ? 8 : 0);
  return columnScore + Math.min(rowCount / 100, 10) + (hasRawSingleOne ? 20 : 0);
}

function toObject(headers: string[], row: unknown[]): ReportRawRow {
  return headers.reduce<ReportRawRow>((acc, header, index) => {
    acc[header] = row[index] ?? null;
    return acc;
  }, {});
}

function normalizeRegistrationRows(rows: ReportRawRow[], detection: SheetDetection): RegistrationSourceRow[] {
  return rows
    .map((row, index) => {
      const value = (key: ReportColumnKey) => {
        const column = detection.columns[key];
        if (!column) return null;
        return row[column.header];
      };

      const normalized: RegistrationSourceRow = {
        sourceRowNumber: index + detection.headerRowIndex + 2,
        date: parseDate(value('date')),
        media: clean(value('media')),
        campaignName: clean(value('campaignName')),
        adgroupName: clean(value('adgroupName')),
        adName: clean(value('adName')),
        registration: parseNumber(value('registration'))
      };

      return registrationRowKey(normalized) ? normalized : null;
    })
    .filter((row): row is RegistrationSourceRow => Boolean(row));
}

function reportRowKey(row: NormalizedReportRow): string {
  return keyFor(row.date, row.media, row.campaignName, row.adgroupName, row.adName);
}

function registrationRowKey(row: RegistrationSourceRow): string {
  return keyFor(row.date, row.media, row.campaignName, row.adgroupName, row.adName);
}

function keyFor(date: string, media: string, campaignName: string, adgroupName: string, adName: string): string {
  const parts = [date, media, campaignName, adgroupName, adName].map(normalizeText);
  if (!parts[0] || !parts[2] || !parts[3] || !parts[4]) return '';
  return parts.join('|');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeSheetName(value: unknown): string {
  return normalizeText(value).replace(/[_-]+/g, ' ');
}

function clean(value: unknown): string {
  const text = String(value ?? '').trim();
  return text === 'null' || text === 'undefined' ? '' : text;
}
