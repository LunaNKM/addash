import type { DataQualityIssue, NormalizedReportRow, SheetDetection } from './reportTypes';

export function validateReportRows(rows: NormalizedReportRow[], detection: SheetDetection): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  if (!rows.length) {
    issues.push({ level: 'error', code: 'NO_ROWS', message: '사용 가능한 데이터 행을 찾지 못했습니다.' });
    return issues;
  }

  for (const key of detection.missingRequired) {
    issues.push({ level: 'error', code: `MISSING_${key.toUpperCase()}`, message: `필수 컬럼 "${key}"을 탐지하지 못했습니다.` });
  }

  for (const key of detection.missingRecommended) {
    issues.push({
      level: 'warning',
      code: `MISSING_${key.toUpperCase()}`,
      message: `권장 컬럼 "${key}"을 탐지하지 못했습니다. 관련 지표는 제한적으로 표시됩니다.`
    });
  }

  addCountIssue(issues, 'warning', 'EMPTY_DATE', '유효한 날짜가 없는 행이 있습니다. 일자별 보기에서 제외될 수 있습니다.', rows, row => !row.date);
  addCountIssue(issues, 'warning', 'MISSING_GROUP', '프로모션과 캠페인 값이 없는 행은 미분류로 묶였습니다.', rows, row => !row.promotion && !row.campaignName);
  addCountIssue(issues, 'warning', 'NEGATIVE_SPEND', '광고비가 음수인 행이 있습니다.', rows, row => row.costKrw < 0);
  addCountIssue(issues, 'warning', 'NEGATIVE_SALES', '매출이 음수인 행이 있습니다.', rows, row => row.salesKrw < 0);
  addCountIssue(issues, 'warning', 'CLICKS_WITHOUT_IMPRESSIONS', '클릭은 있지만 노출이 0인 행이 있습니다.', rows, row => row.clicks > 0 && row.impressions === 0);
  addCountIssue(issues, 'info', 'SPEND_WITHOUT_SALES', '광고비는 있지만 매출이 없는 행이 있습니다. 트래픽/인지 캠페인에서는 정상일 수 있습니다.', rows, row => row.costKrw > 0 && row.salesKrw === 0);

  const dates = rows.map(row => row.date).filter(Boolean).sort();
  if (dates.length) {
    issues.unshift({
      level: 'info',
      code: 'DATE_RANGE',
      message: `탐지된 기간: ${dates[0]} ~ ${dates[dates.length - 1]}.`,
      count: dates.length
    });
  }

  return issues;
}

function addCountIssue(
  issues: DataQualityIssue[],
  level: DataQualityIssue['level'],
  code: string,
  message: string,
  rows: NormalizedReportRow[],
  predicate: (row: NormalizedReportRow) => boolean
) {
  const examples: number[] = [];
  let count = 0;
  for (const row of rows) {
    if (!predicate(row)) continue;
    count += 1;
    if (examples.length < 5) examples.push(row.sourceRowNumber);
  }
  if (count) issues.push({ level, code, message, count, examples });
}
