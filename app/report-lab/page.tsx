'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { buildReportView } from '@/lib/report/aggregate';
import { DEFAULT_EXCHANGE_RATE } from '@/lib/report/schema';
import { loadReportFromXlsx, reportSources } from '@/lib/report/sources';
import type { DataQualityIssue, ReportComparisonMetric, ReportParseResult, ReportSummary, ReportView } from '@/lib/report/reportTypes';

type ReportTab = 'total' | 'daily' | 'campaigns' | 'creatives' | 'summary' | 'diagnostics';

const tabs: { id: ReportTab; label: string }[] = [
  { id: 'total', label: '전체 성과' },
  { id: 'daily', label: '일자별' },
  { id: 'campaigns', label: '캠페인별' },
  { id: 'creatives', label: '소재별' },
  { id: 'summary', label: '요약' },
  { id: 'diagnostics', label: '진단' }
];

export default function ReportLabPage() {
  const [result, setResult] = useState<ReportParseResult | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>('total');
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const dates = useMemo(() => {
    const list = result?.rows.map(row => row.date).filter(Boolean).sort() || [];
    return { min: list[0] || '', max: list[list.length - 1] || '' };
  }, [result]);

  const reportView = useMemo(() => {
    if (!result) return null;
    return buildReportView(result.rows, periodStart || dates.min, periodEnd || dates.max);
  }, [dates.max, dates.min, periodEnd, periodStart, result]);

  async function handleFile(file: File) {
    setBusy('RAW 데이터를 읽는 중입니다...');
    setError('');
    try {
      const parsed = await loadReportFromXlsx(file, exchangeRate);
      setResult(parsed);
      const detectedDates = parsed.rows.map(row => row.date).filter(Boolean).sort();
      setPeriodStart(detectedDates[0] || '');
      setPeriodEnd(detectedDates[detectedDates.length - 1] || '');
      setActiveTab('total');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <header className="header">
        <div className="header-left">
          <Link className="header-logo" href="/">GFU<span>Dash</span></Link>
          <span className="badge">보고서 생성</span>
        </div>
        <div className="header-actions">
          <Link className="btn ghost" href="/">대시보드</Link>
          <label className="btn brand">
            RAW 업로드
            <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => event.target.files?.[0] && handleFile(event.target.files[0])} />
          </label>
        </div>
      </header>

      <main>
        <div className="sub-header">
          <div className="sub-header-title">
            <div className="sub-header-eyebrow">캠페인 보고서 생성</div>
            <b>JP 캠페인 주간/일간 보고서</b>
            <small>{result ? `${result.fileName} · ${result.rows.length.toLocaleString()}행 · ${reportView?.currentPeriod.label}` : '현재는 XLSX 업로드 방식으로 생성합니다.'}</small>
          </div>
          <div className="period">
            <span>기간</span>
            <input type="date" value={periodStart} min={dates.min} max={dates.max} onChange={event => setPeriodStart(event.target.value)} />
            <span>~</span>
            <input type="date" value={periodEnd} min={dates.min} max={dates.max} onChange={event => setPeriodEnd(event.target.value)} />
          </div>
        </div>

        <div className="tabbar">
          {tabs.map(tab => (
            <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="content">
          <div className="filter-bar report-lab-controls">
            <span className="filter-label">데이터 소스</span>
            <div className="report-source-tabs">
              {reportSources.map(source => (
                <button key={source.kind} className={source.status === 'available' ? 'active' : ''} disabled={source.status !== 'available'}>
                  {source.label}
                </button>
              ))}
            </div>
            <span className="filter-label">환율</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={exchangeRate}
              onChange={event => setExchangeRate(Number(event.target.value) || DEFAULT_EXCHANGE_RATE)}
            />
            <span className="muted">JPY → KRW. 변경한 환율은 다시 업로드하면 적용됩니다.</span>
            {result && (
              <>
                <span className="filter-label">시트</span>
                <span className="badge">{result.sheet.sheetName}</span>
                <span className="filter-label">행</span>
                <span className="badge">{reportView?.currentRows.length.toLocaleString()}개 선택</span>
              </>
            )}
          </div>

          {error && <div className="warn">{error}</div>}

          {!result || !reportView ? (
            <EmptyUpload onFile={handleFile} busy={busy} exchangeRate={exchangeRate} />
          ) : (
            <>
              {activeTab === 'total' && <TotalPerformance result={result} view={reportView} />}
              {activeTab === 'daily' && <DailyReport view={reportView} />}
              {activeTab === 'campaigns' && <CampaignReport view={reportView} />}
              {activeTab === 'creatives' && <CreativeReport view={reportView} />}
              {activeTab === 'summary' && <SummaryReport view={reportView} />}
              {activeTab === 'diagnostics' && <Diagnostics result={result} />}
            </>
          )}
        </div>
      </main>

      {busy && <div className="busy">{busy}</div>}
    </div>
  );
}

function EmptyUpload({ onFile, busy, exchangeRate }: { onFile: (file: File) => void; busy: string; exchangeRate: number }) {
  return (
    <section className="section report-empty-state">
      <div>
        <div className="section-head">
          <b>RAW 업로드</b>
          <span className="muted">현재 환율: {exchangeRate.toFixed(2)}</span>
        </div>
        <p>
          XLSX RAW 파일을 업로드하면 컬럼을 자동으로 탐지하고 보고서 출력에 필요한 표준 데이터로 변환합니다.
          추후 Meta API도 같은 보고서 구조에 연결할 예정입니다.
        </p>
        <label className="btn brand">
          {busy || 'RAW 파일 선택'}
          <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => event.target.files?.[0] && onFile(event.target.files[0])} />
        </label>
      </div>
    </section>
  );
}

function TotalPerformance({ result, view }: { result: ReportParseResult; view: ReportView }) {
  return (
    <>
      <section className="section">
        <div className="section-head">
          <b>보고서 상태</b>
          <span className="muted">{view.currentPeriod.label} 대비 {view.previousPeriod.label}</span>
        </div>
        <div className="report-contract-grid">
          <ContractItem label="선택된 시트" value={result.sheet.sheetName} ok />
          <ContractItem label="필수 컬럼" value={result.sheet.missingRequired.length ? `${result.sheet.missingRequired.length}개 누락` : '준비 완료'} ok={!result.sheet.missingRequired.length} />
          <ContractItem label="표준화된 행" value={result.rows.length.toLocaleString()} ok={result.rows.length > 0} />
          <ContractItem label="선택 기간 행" value={view.currentRows.length.toLocaleString()} ok={view.currentRows.length > 0} />
          <ContractItem label="주의 항목" value={String(result.issues.filter(issue => issue.level === 'warning').length)} ok={!result.issues.some(issue => issue.level === 'error')} />
        </div>
      </section>
      <SummaryCards total={view.current.total} />
      <DailyToplineChart rows={view.current.byDaily} />
      <ComparisonTable rows={view.comparison} />
      <SummaryTable title="프로모션별 성과" rows={view.current.byPromotion} previousRows={view.previous.byPromotion} limit={30} showComparisonRows />
      <SummaryTable title="월별 성과" rows={view.current.byMonth} previousRows={view.previous.byMonth} limit={24} showComparisonRows />
    </>
  );
}

function DailyReport({ view }: { view: ReportView }) {
  return (
    <>
      <SummaryCards total={view.current.total} />
      <DailyToplineChart rows={view.current.byDaily} />
      <SummaryTable title="일자별 핵심 성과" rows={view.current.byDaily} previousRows={view.previous.byDaily} limit={120} sortByLabel />
      <SummaryTable title="일자별 캠페인 성과" rows={view.current.byCampaign} previousRows={view.previous.byCampaign} limit={80} />
    </>
  );
}

function CampaignReport({ view }: { view: ReportView }) {
  return (
    <>
      <SummaryCards total={view.current.total} />
      <SummaryTable title="캠페인 성과" rows={view.current.byCampaign} previousRows={view.previous.byCampaign} limit={100} showComparisonRows />
      <SummaryTable title="광고그룹 성과" rows={view.current.byAdgroup} previousRows={view.previous.byAdgroup} limit={100} showComparisonRows />
    </>
  );
}

function CreativeReport({ view }: { view: ReportView }) {
  return (
    <>
      <SummaryCards total={view.current.total} />
      <SummaryTable title="소재 성과" rows={view.current.byCreative} previousRows={view.previous.byCreative} limit={140} showComparisonRows />
    </>
  );
}

function SummaryReport({ view }: { view: ReportView }) {
  return (
    <>
      <SummaryCards total={view.current.total} />
      <SummaryTable title="월별 예산 요약" rows={view.current.byMonth} previousRows={view.previous.byMonth} limit={36} showComparisonRows />
      <SummaryTable title="프로모션별 채널 요약" rows={view.current.byPromotion} previousRows={view.previous.byPromotion} limit={50} showComparisonRows />
    </>
  );
}

function Diagnostics({ result }: { result: ReportParseResult }) {
  return (
    <>
      <ValidationPanel issues={result.issues} />
      <ColumnPanel result={result} />
      <PreviewTable result={result} />
    </>
  );
}

function ContractItem({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={`report-contract-item ${ok ? 'ok' : 'bad'}`}>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

function SummaryCards({ total }: { total: ReportSummary }) {
  const cards = [
    ['광고비', formatCurrency(total.spend)],
    ['매출', formatCurrency(total.sales)],
    ['ROAS', total.roas.toFixed(2)],
    ['CTR', formatPercent(total.ctr)],
    ['CVR', formatPercent(total.cvr)],
    ['CPA', formatCurrency(total.cpa)]
  ];
  return (
    <div className="report-stat-grid">
      {cards.map(([label, value]) => (
        <div className="report-stat-card" key={label}>
          <small>{label}</small>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

function DailyToplineChart({ rows }: { rows: ReportSummary[] }) {
  const sorted = [...rows].filter(row => row.key !== '날짜 없음').sort((a, b) => a.label.localeCompare(b.label));
  if (!sorted.length) {
    return (
      <section className="section report-chart-section">
        <div className="report-band-title">Daily Topline</div>
        <div className="chart-empty">표시할 일자별 데이터가 없습니다.</div>
      </section>
    );
  }

  const width = 1120;
  const height = 340;
  const left = 70;
  const right = 72;
  const top = 34;
  const bottom = 62;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const moneyMax = Math.max(1, ...sorted.flatMap(row => [row.spend, row.sales]));
  const rateMax = Math.max(0.01, ...sorted.flatMap(row => [row.cvr, row.roas]));
  const slot = chartWidth / Math.max(sorted.length, 1);
  const barWidth = Math.min(16, Math.max(5, slot * 0.22));
  const yMoney = (value: number) => top + chartHeight - (value / moneyMax) * chartHeight;
  const yRate = (value: number) => top + chartHeight - (value / rateMax) * chartHeight;
  const xCenter = (index: number) => left + slot * index + slot / 2;
  const linePath = (key: 'cvr' | 'roas') => sorted
    .map((row, index) => `${index === 0 ? 'M' : 'L'} ${xCenter(index)} ${yRate(row[key])}`)
    .join(' ');
  const dateTickEvery = Math.max(1, Math.ceil(sorted.length / 14));

  return (
    <section className="section report-chart-section">
      <div className="report-band-title">Daily Topline</div>
      <div className="report-chart-wrap">
        <svg className="report-topline-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="일자별 광고비, 매출, CVR, ROAS 추이">
          {[0, 0.25, 0.5, 0.75, 1].map(rate => {
            const y = top + chartHeight - chartHeight * rate;
            const money = moneyMax * rate;
            const pct = rateMax * rate;
            return (
              <g key={rate}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--chart-grid-strong)" strokeWidth="1" />
                <text x={left - 8} y={y + 4} textAnchor="end" className="report-chart-axis">{compactCurrency(money)}</text>
                <text x={width - right + 8} y={y + 4} textAnchor="start" className="report-chart-axis">{formatPercent(pct)}</text>
              </g>
            );
          })}

          {sorted.map((row, index) => {
            const x = xCenter(index);
            const spendHeight = top + chartHeight - yMoney(row.spend);
            const salesHeight = top + chartHeight - yMoney(row.sales);
            return (
              <g key={row.key}>
                <rect x={x - barWidth - 2} y={yMoney(row.spend)} width={barWidth} height={Math.max(0, spendHeight)} rx="2" fill="var(--chart-1)" />
                <rect x={x + 2} y={yMoney(row.sales)} width={barWidth} height={Math.max(0, salesHeight)} rx="2" fill="var(--chart-3)" />
                {index % dateTickEvery === 0 && (
                  <text x={x} y={height - 18} textAnchor="end" className="report-chart-date" transform={`rotate(-45 ${x} ${height - 18})`}>
                    {row.label}
                  </text>
                )}
              </g>
            );
          })}

          <path d={linePath('cvr')} fill="none" stroke="var(--c-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={linePath('roas')} fill="none" stroke="var(--c-danger)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {sorted.map((row, index) => (
            <g key={`${row.key}-points`}>
              <circle cx={xCenter(index)} cy={yRate(row.cvr)} r="3" fill="var(--c-success)" />
              <circle cx={xCenter(index)} cy={yRate(row.roas)} r="3" fill="var(--c-danger)" />
            </g>
          ))}
        </svg>
        <div className="report-chart-legend">
          <span><i style={{ background: 'var(--chart-1)' }} />광고비</span>
          <span><i style={{ background: 'var(--chart-3)' }} />매출</span>
          <span><i className="line" style={{ background: 'var(--c-success)' }} />CVR</span>
          <span><i className="line" style={{ background: 'var(--c-danger)' }} />ROAS</span>
        </div>
      </div>
    </section>
  );
}

function ComparisonTable({ rows }: { rows: ReportComparisonMetric[] }) {
  return (
    <section className="section">
      <div className="section-head">
        <b>기간 비교</b>
        <span className="muted">선택 기간과 직전 동일 길이 기간을 비교합니다.</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>지표</th>
              <th>선택 기간</th>
              <th>이전 기간</th>
              <th>차이</th>
              <th>변화율</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td>{formatReportValue(row.key, row.current)}</td>
                <td>{formatReportValue(row.key, row.previous)}</td>
                <td className={row.delta >= 0 ? 'diff-up' : 'diff-down'}>{formatReportValue(row.key, row.delta)}</td>
                <td className={row.delta >= 0 ? 'diff-up' : 'diff-down'}>{formatSignedPercent(row.deltaRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ValidationPanel({ issues }: { issues: DataQualityIssue[] }) {
  return (
    <section className="section">
      <div className="section-head">
        <b>데이터 진단 결과</b>
        <span className="muted">{issues.length.toLocaleString()}개 항목</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>수준</th>
              <th>코드</th>
              <th>내용</th>
              <th>건수</th>
              <th>예시 행</th>
            </tr>
          </thead>
          <tbody>
            {issues.map(issue => (
              <tr key={issue.code}>
                <td><span className={`issue-pill ${issue.level}`}>{formatIssueLevel(issue.level)}</span></td>
                <td>{issue.code}</td>
                <td>{issue.message}</td>
                <td>{issue.count ?? '-'}</td>
                <td>{issue.examples?.join(', ') || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ColumnPanel({ result }: { result: ReportParseResult }) {
  return (
    <section className="section">
      <div className="section-head">
        <b>탐지된 컬럼</b>
        <span className="muted">헤더 행 {result.sheet.headerRowIndex + 1}, 점수 {result.sheet.score.toFixed(1)}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>표준 필드</th>
              <th>탐지된 헤더</th>
              <th>컬럼</th>
              <th>신뢰도</th>
            </tr>
          </thead>
          <tbody>
            {result.detections.map(column => (
              <tr key={column.key}>
                <td>{fieldLabel(column.key)}</td>
                <td>{column.header}</td>
                <td>{column.index + 1}</td>
                <td>{confidenceLabel(column.confidence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PreviewTable({ result }: { result: ReportParseResult }) {
  const rows = result.preview;
  return (
    <section className="section">
      <div className="section-head">
        <b>표준화 RAW 미리보기</b>
        <span className="muted">표준화 후 첫 {rows.length}개 행</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th>프로모션</th>
              <th>캠페인</th>
              <th>소재</th>
              <th>광고비</th>
              <th>매출</th>
              <th>노출</th>
              <th>클릭</th>
              <th>전환</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={`${row.sourceRowNumber}-${row.adName}`}>
                <td>{row.date || '-'}</td>
                <td>{row.promotion}</td>
                <td title={row.campaignName}>{trim(row.campaignName)}</td>
                <td title={row.adName}>{trim(row.adName)}</td>
                <td>{formatCurrency(row.costKrw)}</td>
                <td>{formatCurrency(row.salesKrw)}</td>
                <td>{formatInteger(row.impressions)}</td>
                <td>{formatInteger(row.clicks)}</td>
                <td>{formatInteger(row.conversions)}</td>
                <td>{row.roas.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryTable({
  title,
  rows,
  previousRows = [],
  limit,
  sortByLabel = false,
  showComparisonRows = false
}: {
  title: string;
  rows: ReportSummary[];
  previousRows?: ReportSummary[];
  limit: number;
  sortByLabel?: boolean;
  showComparisonRows?: boolean;
}) {
  const previousByKey = new Map(previousRows.map(row => [row.key, row]));
  const displayRows = [...rows].sort((a, b) => sortByLabel ? a.label.localeCompare(b.label) : b.spend - a.spend || a.label.localeCompare(b.label));
  return (
    <section className="section">
      <div className="section-head">
        <b>{title}</b>
        <span className="muted">총 {rows.length.toLocaleString()}개 그룹 중 {Math.min(rows.length, limit).toLocaleString()}개 표시</span>
      </div>
      <div className="table-wrap sticky-detail">
        <table>
          <thead>
            <tr>
              <th>그룹</th>
              <th>광고비</th>
              <th>광고비 차이</th>
              <th>매출</th>
              <th>노출</th>
              <th>클릭</th>
              <th>전환</th>
              <th>장바구니</th>
              <th>CTR</th>
              <th>CVR</th>
              <th>CPC</th>
              <th>CPA</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.slice(0, limit).map(row => {
              const previous = previousByKey.get(row.key);
              const spendDiff = previous ? row.spend - previous.spend : row.spend;
              const showPrevious = showComparisonRows && previous;
              return (
                <React.Fragment key={row.key}>
                  <tr>
                    <td title={row.label}>{trim(row.label, 44)}</td>
                    <td>{formatCurrency(row.spend)}</td>
                    <td className={spendDiff >= 0 ? 'diff-up' : 'diff-down'}>{formatCurrency(spendDiff)}</td>
                    <td>{formatCurrency(row.sales)}</td>
                    <td>{formatInteger(row.impressions)}</td>
                    <td>{formatInteger(row.clicks)}</td>
                    <td>{formatInteger(row.conversions)}</td>
                    <td>{formatInteger(row.addToCart)}</td>
                    <td>{formatPercent(row.ctr)}</td>
                    <td>{formatPercent(row.cvr)}</td>
                    <td>{formatCurrency(row.cpc)}</td>
                    <td>{formatCurrency(row.cpa)}</td>
                    <td>{row.roas.toFixed(2)}</td>
                  </tr>
                  {showPrevious && (
                    <tr className="report-previous-row">
                      <td>이전 기간</td>
                      <td>{formatCurrency(previous.spend)}</td>
                      <td>-</td>
                      <td>{formatCurrency(previous.sales)}</td>
                      <td>{formatInteger(previous.impressions)}</td>
                      <td>{formatInteger(previous.clicks)}</td>
                      <td>{formatInteger(previous.conversions)}</td>
                      <td>{formatInteger(previous.addToCart)}</td>
                      <td>{formatPercent(previous.ctr)}</td>
                      <td>{formatPercent(previous.cvr)}</td>
                      <td>{formatCurrency(previous.cpc)}</td>
                      <td>{formatCurrency(previous.cpa)}</td>
                      <td>{previous.roas.toFixed(2)}</td>
                    </tr>
                  )}
                  {showPrevious && (
                    <tr className="report-diff-row">
                      <td>증감률</td>
                      <DiffCell current={row.spend} previous={previous.spend} />
                      <td>-</td>
                      <DiffCell current={row.sales} previous={previous.sales} />
                      <DiffCell current={row.impressions} previous={previous.impressions} />
                      <DiffCell current={row.clicks} previous={previous.clicks} />
                      <DiffCell current={row.conversions} previous={previous.conversions} />
                      <DiffCell current={row.addToCart} previous={previous.addToCart} />
                      <DiffCell current={row.ctr} previous={previous.ctr} />
                      <DiffCell current={row.cvr} previous={previous.cvr} />
                      <DiffCell current={row.cpc} previous={previous.cpc} inverse />
                      <DiffCell current={row.cpa} previous={previous.cpa} inverse />
                      <DiffCell current={row.roas} previous={previous.roas} />
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatCurrency(value: number): string {
  return `${Math.round(Number(value) || 0).toLocaleString()}원`;
}

function compactCurrency(value: number): string {
  const safe = Math.round(Number(value) || 0);
  if (Math.abs(safe) >= 100000000) return `${(safe / 100000000).toFixed(1)}억`;
  if (Math.abs(safe) >= 10000) return `${Math.round(safe / 10000).toLocaleString()}만`;
  return safe.toLocaleString();
}

function formatInteger(value: number): string {
  return Math.round(Number(value) || 0).toLocaleString();
}

function formatPercent(value: number): string {
  return `${((Number(value) || 0) * 100).toFixed(2)}%`;
}

function formatSignedPercent(value: number): string {
  const safe = Number(value) || 0;
  return `${safe >= 0 ? '+' : ''}${(safe * 100).toFixed(1)}%`;
}

function formatReportValue(key: ReportComparisonMetric['key'], value: number): string {
  if (key === 'spend' || key === 'sales' || key === 'cpa') return formatCurrency(value);
  if (key === 'ctr' || key === 'cvr') return formatPercent(value);
  if (key === 'roas') return value.toFixed(2);
  return formatInteger(value);
}

function DiffCell({ current, previous, inverse = false }: { current: number; previous: number; inverse?: boolean }) {
  if (!previous) return <td className="muted">-</td>;
  const rate = (current - previous) / previous;
  const good = inverse ? rate <= 0 : rate >= 0;
  const arrow = rate >= 0 ? '▲' : '▼';
  return <td className={good ? 'diff-up' : 'diff-down'}>{arrow}{Math.abs(rate * 100).toFixed(2)}%</td>;
}

function trim(value: string, max = 32): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function formatIssueLevel(level: DataQualityIssue['level']): string {
  if (level === 'error') return '오류';
  if (level === 'warning') return '주의';
  return '정보';
}

function confidenceLabel(confidence: 'exact' | 'alias' | 'fuzzy'): string {
  if (confidence === 'exact') return '정확';
  if (confidence === 'alias') return '별칭';
  return '유사';
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    date: '날짜',
    brand: '브랜드',
    media: '매체',
    promotion: '프로모션',
    campaignName: '캠페인',
    adgroupName: '광고그룹',
    adName: '소재',
    impressions: '노출',
    clicks: '클릭',
    conversions: '전환',
    costJpy: '광고비 JPY',
    costKrw: '광고비 KRW',
    grossCostKrw: '광고비 Gross',
    salesJpy: '매출 JPY',
    salesKrw: '매출 KRW',
    addToCart: '장바구니',
    registration: '회원가입',
    lead: 'Lead',
    order: '주문'
  };
  return labels[key] || key;
}
