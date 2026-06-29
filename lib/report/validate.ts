import type { DataQualityIssue, NormalizedReportRow, SheetDetection } from './reportTypes';

export function validateReportRows(rows: NormalizedReportRow[], detection: SheetDetection): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  if (!rows.length) {
    issues.push({ level: 'error', code: 'NO_ROWS', message: 'No usable data rows were found.' });
    return issues;
  }

  for (const key of detection.missingRequired) {
    issues.push({ level: 'error', code: `MISSING_${key.toUpperCase()}`, message: `Required column "${key}" was not detected.` });
  }

  for (const key of detection.missingRecommended) {
    issues.push({
      level: 'warning',
      code: `MISSING_${key.toUpperCase()}`,
      message: `Recommended column "${key}" was not detected. Related metrics will be limited.`
    });
  }

  addCountIssue(issues, 'warning', 'EMPTY_DATE', 'Rows without a valid date were skipped or may not appear in daily views.', rows, row => !row.date);
  addCountIssue(issues, 'warning', 'MISSING_GROUP', 'Rows without promotion and campaign values were grouped as Uncategorized.', rows, row => !row.promotion && !row.campaignName);
  addCountIssue(issues, 'warning', 'NEGATIVE_SPEND', 'Rows with negative spend were found.', rows, row => row.costKrw < 0);
  addCountIssue(issues, 'warning', 'NEGATIVE_SALES', 'Rows with negative sales were found.', rows, row => row.salesKrw < 0);
  addCountIssue(issues, 'warning', 'CLICKS_WITHOUT_IMPRESSIONS', 'Rows have clicks but zero impressions.', rows, row => row.clicks > 0 && row.impressions === 0);
  addCountIssue(issues, 'info', 'SPEND_WITHOUT_SALES', 'Rows have spend but no sales. This may be normal for traffic or awareness campaigns.', rows, row => row.costKrw > 0 && row.salesKrw === 0);

  const dates = rows.map(row => row.date).filter(Boolean).sort();
  if (dates.length) {
    issues.unshift({
      level: 'info',
      code: 'DATE_RANGE',
      message: `Detected period: ${dates[0]} to ${dates[dates.length - 1]}.`,
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
