import { parseReportFile } from './normalize';
import type { ReportParseResult, ReportSourceDescriptor } from './reportTypes';

export const reportSources: ReportSourceDescriptor[] = [
  { kind: 'xlsx-upload', label: 'XLSX Upload', status: 'available' },
  { kind: 'meta-api', label: 'Meta API', status: 'planned' }
];

export async function loadReportFromXlsx(file: File, exchangeRate: number): Promise<ReportParseResult> {
  return parseReportFile(file, exchangeRate);
}

export async function loadReportFromMeta(): Promise<ReportParseResult> {
  throw new Error('Meta API source is planned. Use XLSX upload for now.');
}
