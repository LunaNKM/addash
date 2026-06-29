import { parseReportFile } from './normalize';
import type { ReportParseResult, ReportSourceDescriptor } from './reportTypes';

export const reportSources: ReportSourceDescriptor[] = [
  { kind: 'xlsx-upload', label: 'XLSX 업로드', status: 'available' },
  { kind: 'meta-api', label: 'Meta API', status: 'planned' }
];

export async function loadReportFromXlsx(file: File, exchangeRate: number): Promise<ReportParseResult> {
  return parseReportFile(file, exchangeRate);
}

export async function loadReportFromMeta(): Promise<ReportParseResult> {
  throw new Error('Meta API 연결은 예정된 기능입니다. 현재는 XLSX 업로드를 사용해주세요.');
}
