'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { buildReportView } from '@/lib/report/aggregate';
import { DEFAULT_EXCHANGE_RATE } from '@/lib/report/schema';
import { loadReportFromXlsx, reportSources } from '@/lib/report/sources';
import type { DataQualityIssue, ReportComparisonMetric, ReportParseResult, ReportSummary, ReportView } from '@/lib/report/reportTypes';

type ReportTab = 'total' | 'daily' | 'campaigns' | 'creatives' | 'summary' | 'diagnostics';

const tabs: { id: ReportTab; label: string }[] = [
  { id: 'total', label: 'Total Performance' },
  { id: 'daily', label: 'Daily' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'creatives', label: 'Creatives' },
  { id: 'summary', label: 'Summary' },
  { id: 'diagnostics', label: 'Diagnostics' }
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
    setBusy('Reading raw data...');
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
          <span className="badge">Report Lab</span>
        </div>
        <div className="header-actions">
          <Link className="btn ghost" href="/">Dashboard</Link>
          <label className="btn brand">
            Upload RAW
            <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => event.target.files?.[0] && handleFile(event.target.files[0])} />
          </label>
        </div>
      </header>

      <main>
        <div className="sub-header">
          <div className="sub-header-title">
            <div className="sub-header-eyebrow">Campaign Report Builder</div>
            <b>JP campaign weekly and daily report</b>
            <small>{result ? `${result.fileName} · ${result.rows.length.toLocaleString()} rows · ${reportView?.currentPeriod.label}` : 'XLSX upload source is active.'}</small>
          </div>
          <div className="period">
            <span>Period</span>
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
            <span className="filter-label">Source</span>
            <div className="report-source-tabs">
              {reportSources.map(source => (
                <button key={source.kind} className={source.status === 'available' ? 'active' : ''} disabled={source.status !== 'available'}>
                  {source.label}
                </button>
              ))}
            </div>
            <span className="filter-label">Exchange</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={exchangeRate}
              onChange={event => setExchangeRate(Number(event.target.value) || DEFAULT_EXCHANGE_RATE)}
            />
            <span className="muted">JPY to KRW. Re-upload applies the new rate.</span>
            {result && (
              <>
                <span className="filter-label">Sheet</span>
                <span className="badge">{result.sheet.sheetName}</span>
                <span className="filter-label">Rows</span>
                <span className="badge">{reportView?.currentRows.length.toLocaleString()} selected</span>
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
          <b>RAW input harness</b>
          <span className="muted">Current exchange rate: {exchangeRate.toFixed(2)}</span>
        </div>
        <p>
          XLSX raw data source is ready. The Meta API source will feed the same normalized report model later.
        </p>
        <label className="btn brand">
          {busy || 'Choose RAW file'}
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
          <b>Report Status</b>
          <span className="muted">{view.currentPeriod.label} vs {view.previousPeriod.label}</span>
        </div>
        <div className="report-contract-grid">
          <ContractItem label="Sheet selected" value={result.sheet.sheetName} ok />
          <ContractItem label="Required columns" value={result.sheet.missingRequired.length ? `${result.sheet.missingRequired.length} missing` : 'Ready'} ok={!result.sheet.missingRequired.length} />
          <ContractItem label="Normalized rows" value={result.rows.length.toLocaleString()} ok={result.rows.length > 0} />
          <ContractItem label="Selected rows" value={view.currentRows.length.toLocaleString()} ok={view.currentRows.length > 0} />
          <ContractItem label="Warnings" value={String(result.issues.filter(issue => issue.level === 'warning').length)} ok={!result.issues.some(issue => issue.level === 'error')} />
        </div>
      </section>
      <SummaryCards total={view.current.total} />
      <ComparisonTable rows={view.comparison} />
      <SummaryTable title="Performance by Promotion" rows={view.current.byPromotion} previousRows={view.previous.byPromotion} limit={30} />
      <SummaryTable title="Performance by Month" rows={view.current.byMonth} previousRows={view.previous.byMonth} limit={24} />
    </>
  );
}

function DailyReport({ view }: { view: ReportView }) {
  return (
    <>
      <SummaryCards total={view.current.total} />
      <SummaryTable title="Daily Topline" rows={view.current.byDaily} previousRows={view.previous.byDaily} limit={120} sortByLabel />
      <SummaryTable title="Daily Campaign Performance" rows={view.current.byCampaign} previousRows={view.previous.byCampaign} limit={80} />
    </>
  );
}

function CampaignReport({ view }: { view: ReportView }) {
  return (
    <>
      <SummaryCards total={view.current.total} />
      <SummaryTable title="Campaign Performance" rows={view.current.byCampaign} previousRows={view.previous.byCampaign} limit={100} />
      <SummaryTable title="Ad Group Performance" rows={view.current.byAdgroup} previousRows={view.previous.byAdgroup} limit={100} />
    </>
  );
}

function CreativeReport({ view }: { view: ReportView }) {
  return (
    <>
      <SummaryCards total={view.current.total} />
      <SummaryTable title="Campaign Image Performance" rows={view.current.byCreative} previousRows={view.previous.byCreative} limit={140} />
    </>
  );
}

function SummaryReport({ view }: { view: ReportView }) {
  return (
    <>
      <SummaryCards total={view.current.total} />
      <SummaryTable title="Budget Summary by Month" rows={view.current.byMonth} previousRows={view.previous.byMonth} limit={36} />
      <SummaryTable title="Channel Summary by Promotion" rows={view.current.byPromotion} previousRows={view.previous.byPromotion} limit={50} />
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
    ['Spend', formatCurrency(total.spend)],
    ['Sales', formatCurrency(total.sales)],
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

function ComparisonTable({ rows }: { rows: ReportComparisonMetric[] }) {
  return (
    <section className="section">
      <div className="section-head">
        <b>Period Comparison</b>
        <span className="muted">Current period against the immediately previous matching period</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Current</th>
              <th>Previous</th>
              <th>Diff</th>
              <th>Change</th>
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
        <b>Validation Results</b>
        <span className="muted">{issues.length.toLocaleString()} checks reported</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Level</th>
              <th>Code</th>
              <th>Message</th>
              <th>Count</th>
              <th>Examples</th>
            </tr>
          </thead>
          <tbody>
            {issues.map(issue => (
              <tr key={issue.code}>
                <td><span className={`issue-pill ${issue.level}`}>{issue.level}</span></td>
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
        <b>Detected Columns</b>
        <span className="muted">Header row {result.sheet.headerRowIndex + 1}, score {result.sheet.score.toFixed(1)}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Standard Field</th>
              <th>Detected Header</th>
              <th>Column</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {result.detections.map(column => (
              <tr key={column.key}>
                <td>{column.key}</td>
                <td>{column.header}</td>
                <td>{column.index + 1}</td>
                <td>{column.confidence}</td>
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
        <b>Normalized RAW Preview</b>
        <span className="muted">First {rows.length} rows after schema normalization</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Promotion</th>
              <th>Campaign</th>
              <th>Creative</th>
              <th>Spend</th>
              <th>Sales</th>
              <th>Imp</th>
              <th>Clicks</th>
              <th>Conv</th>
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
  sortByLabel = false
}: {
  title: string;
  rows: ReportSummary[];
  previousRows?: ReportSummary[];
  limit: number;
  sortByLabel?: boolean;
}) {
  const previousByKey = new Map(previousRows.map(row => [row.key, row]));
  const displayRows = [...rows].sort((a, b) => sortByLabel ? a.label.localeCompare(b.label) : b.spend - a.spend || a.label.localeCompare(b.label));
  return (
    <section className="section">
      <div className="section-head">
        <b>{title}</b>
        <span className="muted">Showing {Math.min(rows.length, limit).toLocaleString()} of {rows.length.toLocaleString()} groups</span>
      </div>
      <div className="table-wrap sticky-detail">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Spend</th>
              <th>Spend Diff</th>
              <th>Sales</th>
              <th>Imp</th>
              <th>Clicks</th>
              <th>Conv</th>
              <th>Add Cart</th>
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
              return (
                <tr key={row.key}>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatCurrency(value: number): string {
  return `KRW ${Math.round(Number(value) || 0).toLocaleString()}`;
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

function trim(value: string, max = 32): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
