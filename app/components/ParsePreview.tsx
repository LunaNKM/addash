import { emptyKpi } from '@/lib/store';
import { totalStat } from '@/lib/aggregation';
import type { ParseReport } from '@/lib/parser';
import { KpiGrid } from './KpiGrid';
import { SimpleTable } from './SimpleTable';

export function ParsePreview({ report, file, onCancel, onConfirm }: {
  report: ParseReport;
  file: File | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const total = totalStat(report.rows);
  return (
    <div className="modal">
      <div className="modal-card wide">
        <h3>업로드 전 검증</h3>
        <p className="muted">{file?.name}</p>
        <div className="detected">
          {Object.entries(report.detected).map(([key, value]) => <span key={key}>{key} <b>{value}</b></span>)}
        </div>
        {report.warnings.map(warning => <p className="warn" key={warning}>{warning}</p>)}
        <KpiGrid total={total} kpi={emptyKpi} />
        <SimpleTable rows={report.preview} columns={['date', 'campaignAdsetAd', 'spend', 'impression', 'click', 'landingPageView', 'ctr', 'cpm', 'cpc', 'roas']} />
        <div className="modal-actions">
          <button className="btn outline" onClick={onCancel}>취소</button>
          <button className="btn brand" onClick={onConfirm}>저장</button>
        </div>
      </div>
    </div>
  );
}
