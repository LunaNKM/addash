import { emptyKpi } from '@/lib/store';
import { totalStat } from '@/lib/aggregation';
import type { ParseReport } from '@/lib/parser';
import { AD_PLATFORM_LABELS, type AdPlatform } from '@/lib/types';
import { KpiGrid } from './KpiGrid';
import { SimpleTable } from './SimpleTable';

/** 매체마다 의미 있는 열만 미리보기에 보여준다. */
const previewColumns: Record<AdPlatform, string[]> = {
  meta: ['date', 'campaignAdsetAd', 'spend', 'impression', 'click', 'landingPageView', 'ctr', 'linkCtr', 'cpm', 'cpc', 'roas'],
  x: ['date', 'campaignAdsetAd', 'spend', 'impression', 'engagements', 'profileVisits', 'reach', 'click', 'likes', 'replies', 'reposts', 'follows', 'cpm'],
  youtube: ['date', 'campaignAdsetAd', 'spend', 'impression', 'click', 'ctr', 'cpc', 'cpm', 'cpv']
};

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
        <p className="muted">
          <span className="badge">{AD_PLATFORM_LABELS[report.platform]}</span> {file?.name} · {report.rows.length.toLocaleString()}행
        </p>
        <div className="detected">
          {Object.entries(report.detected).map(([key, value]) => <span key={key}>{key} <b>{value}</b></span>)}
        </div>
        {report.warnings.map(warning => <p className="warn" key={warning}>{warning}</p>)}
        <KpiGrid total={total} kpi={emptyKpi} />
        <SimpleTable rows={report.preview} columns={previewColumns[report.platform]} />
        <div className="modal-actions">
          <button className="btn outline" onClick={onCancel}>취소</button>
          <button className="btn brand" onClick={onConfirm}>저장</button>
        </div>
      </div>
    </div>
  );
}
