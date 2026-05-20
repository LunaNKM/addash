import { emptyStat } from '@/lib/aggregation';
import type { MetricKey } from '@/lib/types';
import { asStatRow, cell, diffTitle, labelForColumn, metricKeys, tableRowKey, type TableRow } from '@/lib/dashUtils';

export function SimpleTable({ rows, columns, withDiff = false }: { rows: TableRow[]; columns: string[]; withDiff?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map(column => <th key={column}>{labelForColumn(column)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const current = asStatRow(row) ?? emptyStat(tableRowKey(row, rowIndex));
            const previous = asStatRow(rows[rowIndex - 1]);
            return (
              <tr key={tableRowKey(row, rowIndex)}>
                {columns.map(column => (
                  <td key={column} title={withDiff && metricKeys.includes(column as MetricKey) ? diffTitle(previous, current, column as MetricKey) : undefined}>
                    {cell(row, column)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
