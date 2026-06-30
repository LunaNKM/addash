'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, completeRedirectLogin, firebaseAuthErrorMessage, logout, signInWithGoogleSafe } from '@/lib/firebase';
import { buildReportView, filterRowsByPeriod } from '@/lib/report/aggregate';
import { DEFAULT_EXCHANGE_RATE } from '@/lib/report/schema';
import { loadReportFromXlsx, reportSources } from '@/lib/report/sources';
import {
  createBrand,
  emptyKpi,
  findBrandByShareToken,
  getKpi,
  getReportFile,
  isAdminEmail,
  listBrandsForAdmin,
  listReportFiles,
  listTabs,
  saveKpi,
  saveReportFile,
  updateBrand
} from '@/lib/store';
import { applyBrandColor, randomBrandColor } from '@/lib/brandColor';
import { errorMessage } from '@/lib/dashUtils';
import type { Brand, DashboardTab, Kpi, ReportFileDoc } from '@/lib/types';
import { Empty } from '../components/Empty';
import { SettingsModal, type SettingsMode } from '../components/SettingsModal';
import type {
  NormalizedReportRow,
  ReportComparisonMetric,
  ReportParseResult,
  ReportSummary,
  ReportView
} from '@/lib/report/reportTypes';

type PromotionTab = 'always' | 'owned' | 'megawari' | 'megapo' | 'market' | 'hybrid';
type ReportTab = 'total' | 'daily' | 'campaigns' | 'creatives' | 'summary' | PromotionTab;

const promotionTabs: { id: PromotionTab; label: string }[] = [
  { id: 'always', label: '상시' },
  { id: 'owned', label: '자사몰' },
  { id: 'megawari', label: '메가와리' },
  { id: 'megapo', label: '메가포' },
  { id: 'market', label: '마켓' },
  { id: 'hybrid', label: '자사몰(하이브리드)' }
];

const tabs: { id: ReportTab; label: string }[] = [
  { id: 'total', label: '전체 성과' },
  { id: 'daily', label: '일자별' },
  { id: 'campaigns', label: '캠페인별' },
  { id: 'creatives', label: '소재별' },
  ...promotionTabs,
  { id: 'summary', label: '요약' }
];

export default function ReportLabPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [dashboardTab, setDashboardTab] = useState<DashboardTab | null>(null);
  const [dashboardTabs, setDashboardTabs] = useState<DashboardTab[]>([]);
  const [kpi, setKpi] = useState<Kpi>(emptyKpi);
  const [reportFiles, setReportFiles] = useState<ReportFileDoc[]>([]);
  const [selectedReportFileId, setSelectedReportFileId] = useState('');
  const [settings, setSettings] = useState<SettingsMode>('none');
  const [result, setResult] = useState<ReportParseResult | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>('total');
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [adgroupFilter, setAdgroupFilter] = useState('');
  const [adFilter, setAdFilter] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    applyBrandColor(brand?.color || null);
  }, [brand?.color]);

  const resetReportState = useCallback(() => {
    setResult(null);
    setReportFiles([]);
    setSelectedReportFileId('');
    setPeriodStart('');
    setPeriodEnd('');
    setCampaignFilter('');
    setAdgroupFilter('');
    setAdFilter('');
  }, []);

  const applyReportResult = useCallback((nextResult: ReportParseResult | null) => {
    setResult(nextResult);
    setActiveTab('total');
    setCampaignFilter('');
    setAdgroupFilter('');
    setAdFilter('');
    if (!nextResult) {
      setPeriodStart('');
      setPeriodEnd('');
      return;
    }
    const range = recentSevenDayRange(nextResult.rows);
    setPeriodStart(range.start);
    setPeriodEnd(range.end);
  }, []);

  const loadBrandContext = useCallback(async (target: Brand | null) => {
    setBrand(target);
    if (!target) {
      setDashboardTabs([]);
      setDashboardTab(null);
      setKpi(emptyKpi);
      resetReportState();
      return;
    }

    const loadedTabs = await listTabs(target.id);
    const nextTab = loadedTabs[0] || null;
    setDashboardTabs(loadedTabs);
    setDashboardTab(nextTab);
    if (!nextTab) {
      setKpi(emptyKpi);
      resetReportState();
      return;
    }

    const [loadedKpi, loadedReportFiles] = await Promise.all([
      getKpi(target.id, nextTab.id),
      listReportFiles(target.id, nextTab.id)
    ]);
    setKpi(loadedKpi);
    setReportFiles(loadedReportFiles);
    const firstFile = loadedReportFiles[0] || null;
    setSelectedReportFileId(firstFile?.id || '');
    if (firstFile) {
      const loadedFile = await getReportFile(target.id, nextTab.id, firstFile.id);
      applyReportResult(loadedFile?.result || null);
    } else {
      applyReportResult(null);
    }
  }, [applyReportResult, resetReportState]);

  const selectBrand = useCallback(async (brandId: string) => {
    const target = brands.find(item => item.id === brandId) || null;
    try {
      await loadBrandContext(target);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [brands, loadBrandContext]);

  const reloadReportFiles = useCallback(async () => {
    if (!brand || !dashboardTab) return;
    const loadedReportFiles = await listReportFiles(brand.id, dashboardTab.id);
    setReportFiles(loadedReportFiles);
    const selected = loadedReportFiles.find(file => file.id === selectedReportFileId) || loadedReportFiles[0] || null;
    setSelectedReportFileId(selected?.id || '');
    if (selected) {
      const loadedFile = await getReportFile(brand.id, dashboardTab.id, selected.id);
      applyReportResult(loadedFile?.result || null);
    } else {
      applyReportResult(null);
    }
  }, [applyReportResult, brand, dashboardTab, selectedReportFileId]);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    (async () => {
      try {
        await completeRedirectLogin();
      } catch (err) {
        setAuthError(firebaseAuthErrorMessage(err));
      }

      unsub = onAuthStateChanged(auth, async current => {
        try {
          setUser(current);
          const admin = current ? await isAdminEmail(current.email) : false;
          setIsAdmin(admin);
          const shareToken = new URL(window.location.href).searchParams.get('share');

          if (admin) {
            const list = await listBrandsForAdmin();
            setBrands(list);
            await loadBrandContext(list[0] || null);
          } else if (shareToken) {
            const found = await findBrandByShareToken(shareToken);
            setBrands(found ? [found] : []);
            await loadBrandContext(found);
          } else {
            await loadBrandContext(null);
          }
        } catch (err) {
          setAuthError(firebaseAuthErrorMessage(err));
        } finally {
          setLoading(false);
        }
      });
    })();

    return () => unsub?.();
  }, [loadBrandContext]);

  const dates = useMemo(() => {
    const list = result?.rows.map(row => row.date).filter(Boolean).sort() || [];
    return { min: list[0] || '', max: list[list.length - 1] || '' };
  }, [result]);

  const activePromotion = useMemo(() => promotionTabs.find(tab => tab.id === activeTab), [activeTab]);

  const periodRows = useMemo(() => {
    if (!result) return [];
    return filterRowsByPeriod(result.rows, periodStart || dates.min, periodEnd || dates.max);
  }, [dates.max, dates.min, periodEnd, periodStart, result]);

  const optionRows = useMemo(() => {
    if (!activePromotion) return periodRows;
    return periodRows.filter(row => matchesPromotionTab(row, activePromotion.id));
  }, [activePromotion, periodRows]);

  const campaignOptions = useMemo(() => uniqueLabels(optionRows, row => row.campaignName), [optionRows]);
  const adgroupOptions = useMemo(() => {
    return uniqueLabels(optionRows.filter(row => matchesValue(row.campaignName, campaignFilter)), row => row.adgroupName);
  }, [campaignFilter, optionRows]);
  const adOptions = useMemo(() => {
    return uniqueLabels(
      optionRows.filter(row => matchesValue(row.campaignName, campaignFilter) && matchesValue(row.adgroupName, adgroupFilter)),
      row => row.adName
    );
  }, [adgroupFilter, campaignFilter, optionRows]);

  useEffect(() => {
    if (campaignFilter && !campaignOptions.includes(campaignFilter)) {
      setCampaignFilter('');
      setAdgroupFilter('');
      setAdFilter('');
      return;
    }
    if (adgroupFilter && !adgroupOptions.includes(adgroupFilter)) {
      setAdgroupFilter('');
      setAdFilter('');
      return;
    }
    if (adFilter && !adOptions.includes(adFilter)) {
      setAdFilter('');
    }
  }, [adFilter, adOptions, adgroupFilter, adgroupOptions, campaignFilter, campaignOptions]);

  const filteredRows = useMemo(() => {
    if (!result) return [];
    return result.rows.filter(row => {
      if (activePromotion && !matchesPromotionTab(row, activePromotion.id)) return false;
      if (!matchesValue(row.campaignName, campaignFilter)) return false;
      if (!matchesValue(row.adgroupName, adgroupFilter)) return false;
      if (!matchesValue(row.adName, adFilter)) return false;
      return true;
    });
  }, [activePromotion, adFilter, adgroupFilter, campaignFilter, result]);

  const reportView = useMemo(() => {
    if (!result) return null;
    return buildReportView(filteredRows, periodStart || dates.min, periodEnd || dates.max);
  }, [dates.max, dates.min, filteredRows, periodEnd, periodStart, result]);

  async function handleFile(file: File) {
    if (!brand || !dashboardTab || !isAdmin) {
      setError('파일 저장을 위해서는 관리자 로그인과 브랜드 선택이 필요합니다.');
      return;
    }
    setBusy('RAW 데이터를 읽는 중입니다...');
    setError('');
    try {
      const parsed = await loadReportFromXlsx(file, exchangeRate);
      const detectedDates = parsed.rows.map(row => row.date).filter(Boolean).sort();
      const savedId = await saveReportFile(brand.id, dashboardTab.id, {
        filename: file.name,
        fileSize: file.size,
        dateStart: detectedDates[0] || '',
        dateEnd: detectedDates[detectedDates.length - 1] || '',
        rowCount: parsed.rows.length,
        exchangeRate,
        result: parsed,
        createdAt: Date.now()
      });
      const loadedReportFiles = await listReportFiles(brand.id, dashboardTab.id);
      setReportFiles(loadedReportFiles);
      setSelectedReportFileId(savedId);
      applyReportResult(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function saveKpiFlow(next: Kpi) {
    if (!brand || !dashboardTab) return;
    await saveKpi(brand.id, dashboardTab.id, next);
    setKpi(next);
    setSettings('none');
  }

  async function addBrandFlow() {
    const name = prompt('새 브랜드 이름을 입력하세요.');
    if (!name) return;
    try {
      const created = await createBrand(name, randomBrandColor());
      const list = await listBrandsForAdmin();
      setBrands(list);
      await loadBrandContext(created);
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function updateBrandFlow(brandId: string, patch: { name?: string; color?: string; metaAdAccountId?: string }) {
    try {
      await updateBrand(brandId, patch);
      const list = await listBrandsForAdmin();
      setBrands(list);
      const updated = list.find(item => item.id === brandId);
      if (updated && brand?.id === brandId) setBrand(updated);
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  if (loading) return <Empty message="보고서 데이터를 불러오는 중입니다." />;

  return (
    <div>
      <header className="header">
        <div className="header-left">
          <Link className="header-logo" href="/">GFU<span>Dash</span></Link>
          {isAdmin && (
            <select className="header-select" value={brand?.id || ''} onChange={event => selectBrand(event.target.value)}>
              <option value="">브랜드 선택</option>
              {brands.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
          {!isAdmin && brand && <span className="badge">{brand.name}</span>}
        </div>
        <div className="header-actions">
          {!user
            ? <button className="btn outline" onClick={async () => {
                setAuthError('');
                try { await signInWithGoogleSafe(); }
                catch (err) { setAuthError(firebaseAuthErrorMessage(err)); }
              }}>Google 로그인</button>
            : <button className="btn ghost" onClick={logout}>로그아웃</button>}
          <Link className="btn ghost" href="/">대시보드</Link>
          {isAdmin && brand && <button className="btn ghost" onClick={() => setSettings('brand')}>설정</button>}
          {brand && <button className="btn ghost" onClick={() => navigator.clipboard.writeText(`${location.origin}/report-lab?share=${brand.shareToken}`).then(() => alert('공유 링크를 복사했습니다.'))}>공유</button>}
          {isAdmin && brand && dashboardTab && (
            <label className="btn brand">
              RAW 업로드
              <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => event.target.files?.[0] && handleFile(event.target.files[0])} />
            </label>
          )}
        </div>
      </header>

      {!brand ? (
        <Empty
          message={isAdmin ? '브랜드를 선택하거나 새 브랜드를 추가해주세요.' : '공유 링크로 접속하거나 관리자 로그인을 해주세요.'}
          action={isAdmin ? <button className="btn brand" onClick={addBrandFlow}>브랜드 추가</button> : null}
        />
      ) : (
      <main>
        <div className="sub-header">
          <div className="sub-header-title">
            <div className="sub-header-eyebrow">캠페인 보고서 생성</div>
            <b>{brand.name}</b>
            <small>{result ? `${result.rows.length.toLocaleString()}행 · ${reportView?.currentPeriod.label}` : '현재는 XLSX 업로드 방식으로 생성합니다.'}</small>
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

          {reportFiles.length > 0 && (
            <div className="file-chips report-file-chips">
              {reportFiles.map(file => (
                <button
                  key={file.id}
                  className={`chip ${selectedReportFileId === file.id ? 'active' : ''}`}
                  onClick={() => {
                    if (!brand || !dashboardTab) return;
                    setSelectedReportFileId(file.id);
                    setBusy('저장된 RAW 파일을 불러오는 중입니다...');
                    getReportFile(brand.id, dashboardTab.id, file.id)
                      .then(loadedFile => applyReportResult(loadedFile?.result || null))
                      .catch(err => setError(errorMessage(err)))
                      .finally(() => setBusy(''));
                  }}
                  title={`${file.dateStart || '-'} ~ ${file.dateEnd || '-'} · ${file.rowCount.toLocaleString()}행`}
                >
                  {file.filename}
                </button>
              ))}
            </div>
          )}

          {result && (
            <div className="filter-bar report-dimension-controls">
              <span className="filter-label">캠페인</span>
              <select
                value={campaignFilter}
                onChange={event => {
                  setCampaignFilter(event.target.value);
                  setAdgroupFilter('');
                  setAdFilter('');
                }}
              >
                <option value="">전체</option>
                {campaignOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
              <span className="filter-label">광고세트</span>
              <select
                value={adgroupFilter}
                onChange={event => {
                  setAdgroupFilter(event.target.value);
                  setAdFilter('');
                }}
              >
                <option value="">전체</option>
                {adgroupOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
              <span className="filter-label">소재</span>
              <select value={adFilter} onChange={event => setAdFilter(event.target.value)}>
                <option value="">전체</option>
                {adOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
              {(campaignFilter || adgroupFilter || adFilter) && (
                <button
                  className="btn ghost compact"
                  onClick={() => {
                    setCampaignFilter('');
                    setAdgroupFilter('');
                    setAdFilter('');
                  }}
                >
                  초기화
                </button>
              )}
              <span className="muted">{reportView?.currentRows.length.toLocaleString()}개 행 반영</span>
            </div>
          )}

          {error && <div className="warn">{error}</div>}

          {!result || !reportView ? (
            <EmptyUpload onFile={handleFile} busy={busy} exchangeRate={exchangeRate} canUpload={Boolean(isAdmin && brand && dashboardTab)} />
          ) : (
            <>
              {activeTab === 'total' && <TotalPerformance result={result} view={reportView} allRows={filteredRows} kpi={kpi} />}
              {activeTab === 'daily' && <DailyReport view={reportView} kpi={kpi} />}
              {activeTab === 'campaigns' && <CampaignReport view={reportView} kpi={kpi} />}
              {activeTab === 'creatives' && <CreativeReport view={reportView} kpi={kpi} />}
              {activePromotion && <PromotionDetailReport title={activePromotion.label} view={reportView} allRows={filteredRows} />}
              {activeTab === 'summary' && <SummaryReport view={reportView} kpi={kpi} />}
            </>
          )}
        </div>
      </main>
      )}

      {busy && <div className="busy">{busy}</div>}
      {authError && (
        <div className="modal">
          <div className="modal-card" style={{ maxWidth: 480 }}>
            <h3>로그인 오류</h3>
            <p style={{ whiteSpace: 'pre-wrap', color: 'var(--c-warn)', lineHeight: 1.6 }}>{authError}</p>
            <div className="modal-actions">
              <button className="btn brand" onClick={() => setAuthError('')}>확인</button>
            </div>
          </div>
        </div>
      )}
      {settings !== 'none' && brand && (
        <SettingsModal
          mode={settings}
          setMode={setSettings}
          brand={brand}
          tab={dashboardTab}
          brands={brands}
          tabs={dashboardTabs}
          kpi={kpi}
          saveKpi={saveKpiFlow}
          reload={reloadReportFiles}
          addBrand={addBrandFlow}
          refreshBrands={async () => setBrands(await listBrandsForAdmin())}
          onUpdateBrand={updateBrandFlow}
          sharePath="/report-lab"
        />
      )}
    </div>
  );
}

function EmptyUpload({ onFile, busy, exchangeRate, canUpload }: { onFile: (file: File) => void; busy: string; exchangeRate: number; canUpload: boolean }) {
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
        {canUpload ? (
          <label className="btn brand">
            {busy || 'RAW 파일 선택'}
            <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => event.target.files?.[0] && onFile(event.target.files[0])} />
          </label>
        ) : (
          <span className="muted">관리자 로그인 후 브랜드를 선택하면 RAW 파일을 저장할 수 있습니다.</span>
        )}
      </div>
    </section>
  );
}

function TotalPerformance({ result, view, allRows, kpi }: { result: ReportParseResult; view: ReportView; allRows: NormalizedReportRow[]; kpi: Kpi }) {
  const comparisonLabel = formatComparisonLabel(view);
  const latestDate = latestReportDate(allRows) || view.currentPeriod.end;
  const weekly = buildRecentWeeklySummaries(allRows, latestDate);
  const yearlyDaily = buildYearDailyGroups(allRows, latestDate);

  return (
    <>
      <section className="section">
        <div className="section-head">
          <PeriodBadge label={comparisonLabel} />
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
      <SummaryCards total={view.current.total} kpi={kpi} />
      <DailyToplineChart rows={view.current.byDaily} comparisonLabel={comparisonLabel} />
      <ComparisonTable rows={view.comparison} comparisonLabel={comparisonLabel} />
      <SummaryTable title="프로모션별 성과" rows={view.current.byPromotion} previousRows={view.previous.byPromotion} limit={30} showComparisonRows comparisonLabel={comparisonLabel} />
      <RecentWeeklyPerformanceTable data={weekly} />
      <YearDailyPerformanceTable data={yearlyDaily} />
    </>
  );
}

function DailyReport({ view, kpi }: { view: ReportView; kpi: Kpi }) {
  return (
    <>
      <SummaryCards total={view.current.total} kpi={kpi} />
      <DailyToplineChart rows={view.current.byDaily} />
      <SummaryTable title="일자별 핵심 성과" rows={view.current.byDaily} previousRows={view.previous.byDaily} limit={120} sortByLabel />
      <SummaryTable title="일자별 캠페인 성과" rows={view.current.byCampaign} previousRows={view.previous.byCampaign} limit={80} />
    </>
  );
}

function CampaignReport({ view, kpi }: { view: ReportView; kpi: Kpi }) {
  return (
    <>
      <SummaryCards total={view.current.total} kpi={kpi} />
      <SummaryTable title="캠페인 성과" rows={view.current.byCampaign} previousRows={view.previous.byCampaign} limit={100} showComparisonRows />
      <SummaryTable title="광고그룹 성과" rows={view.current.byAdgroup} previousRows={view.previous.byAdgroup} limit={100} showComparisonRows />
    </>
  );
}

function CreativeReport({ view, kpi }: { view: ReportView; kpi: Kpi }) {
  return (
    <>
      <SummaryCards total={view.current.total} kpi={kpi} />
      <SummaryTable title="소재 성과" rows={view.current.byCreative} previousRows={view.previous.byCreative} limit={140} showComparisonRows />
    </>
  );
}

function PromotionDetailReport({ title, view, allRows }: { title: string; view: ReportView; allRows: NormalizedReportRow[] }) {
  const latestDate = latestReportDate(allRows) || view.currentPeriod.end;
  const dailyData = buildYearDailyGroups(allRows, latestDate);
  const overallRows = buildPromotionPerformanceRows(allRows, latestDate, [{ label: '전체 성과', test: () => true }]);
  const mediaRows = buildPromotionPerformanceRows(allRows, latestDate, [
    { label: '싱글원(S-META)', test: row => isSingleOneMeta(row) },
    { label: '메타', test: row => isMetaMedia(row) && !isSingleOneMeta(row) }
  ], '기타');
  const objectiveRows = buildPromotionPerformanceRows(allRows, latestDate, [
    { label: 'Purchase', test: row => matchesAnyReportText(row, ['purchase', 'conversion']) },
    { label: 'Click', test: row => matchesAnyReportText(row, ['click']) },
    { label: 'Traffic', test: row => matchesAnyReportText(row, ['traffic']) }
  ], '기타');
  const campaignRows = buildCampaignPerformanceRows(allRows, latestDate);

  return (
    <>
      <section className="section">
        <div className="section-head">
          <b>{title} 성과</b>
          <span className="muted">최신 {latestDate || '-'}</span>
        </div>
        <div className="report-contract-grid">
          <ContractItem label="전체 행" value={allRows.length.toLocaleString()} ok={allRows.length > 0} />
          <ContractItem label="캠페인" value={view.current.byCampaign.length.toLocaleString()} ok={view.current.byCampaign.length > 0} />
          <ContractItem label="광고세트" value={view.current.byAdgroup.length.toLocaleString()} ok={view.current.byAdgroup.length > 0} />
          <ContractItem label="소재" value={view.current.byCreative.length.toLocaleString()} ok={view.current.byCreative.length > 0} />
          <ContractItem label="일자" value={dailyData.groups.reduce((sum, group) => sum + group.days.length, 0).toLocaleString()} ok={Boolean(latestDate)} />
        </div>
      </section>
      <DailyToplineChart rows={view.current.byDaily} />
      <PromotionPerformanceSection title="전체 성과" rows={overallRows} />
      <PromotionPerformanceSection title="미디어별 성과" rows={mediaRows} />
      <PromotionPerformanceSection title="목적별 성과" rows={objectiveRows} />
      <PromotionPerformanceSection title="캠페인별 성과" rows={campaignRows} />
      <YearDailyPerformanceTable data={dailyData} />
    </>
  );
}

function SummaryReport({ view, kpi }: { view: ReportView; kpi: Kpi }) {
  return (
    <>
      <SummaryCards total={view.current.total} kpi={kpi} />
      <SummaryTable title="주차별 예산 요약" rows={view.current.byWeek} previousRows={view.previous.byWeek} limit={36} showComparisonRows sortByLabel />
      <SummaryTable title="프로모션별 채널 요약" rows={view.current.byPromotion} previousRows={view.previous.byPromotion} limit={50} showComparisonRows />
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

function SummaryCards({ total, kpi }: { total: ReportSummary; kpi: Kpi }) {
  const cards = [
    { label: '광고비', value: formatCurrency(total.spend), current: total.spend, goal: kpi.spendGoal, goalValue: formatCurrency(kpi.spendGoal) },
    { label: '매출', value: formatCurrency(total.sales) },
    { label: 'ROAS', value: total.roas.toFixed(2), current: total.roas, goal: kpi.roasGoal, goalValue: kpi.roasGoal.toLocaleString() },
    { label: 'CTR', value: formatPercent(total.ctr), current: total.ctr, goal: kpi.ctrGoal, goalValue: formatPercent(kpi.ctrGoal) },
    { label: 'CVR', value: formatPercent(total.cvr) },
    { label: 'CPA', value: formatCurrency(total.cpa) }
  ];
  return (
    <div className="report-stat-grid">
      {cards.map(card => {
        const goal = Number(card.goal || 0);
        const current = Number(card.current || 0);
        const pct = goal > 0 ? (current / goal) * 100 : 0;
        const cappedPct = Math.min(Math.max(pct, 0), 100);
        return (
        <div className="report-stat-card" key={card.label}>
          <small>{card.label}</small>
          <b>{card.value}</b>
          {goal > 0 && (
            <div className="report-stat-goal">
              <div className="goal">
                <i style={{ width: `${cappedPct}%`, background: pct >= 100 ? 'var(--c-success)' : 'linear-gradient(90deg, var(--brand-400), var(--brand))' }} />
              </div>
              <em>{pct.toFixed(0)}% 달성 · 목표 {card.goalValue}</em>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

function DailyToplineChart({ rows, comparisonLabel }: { rows: ReportSummary[]; comparisonLabel?: string }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; row: ReportSummary } | null>(null);
  const sorted = [...rows].filter(row => row.key !== '날짜 없음').sort((a, b) => a.label.localeCompare(b.label));
  if (!sorted.length) {
    return (
      <section className="section report-chart-section">
        <div className="report-band-title"><span>Daily Topline</span><PeriodBadge label={comparisonLabel || ''} /></div>
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
  const rateValues = sorted
    .flatMap(row => [row.cvr, row.roas])
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const rawRateMax = Math.max(0.01, ...rateValues);
  const p90Rate = percentile(rateValues, 0.9);
  const p75Rate = percentile(rateValues, 0.75);
  const robustRateMax = Math.max(0.01, p90Rate * 1.35, p75Rate * 2);
  const rateMax = rawRateMax > robustRateMax * 1.5 ? robustRateMax : rawRateMax;
  const slot = chartWidth / Math.max(sorted.length, 1);
  const barWidth = Math.min(22, Math.max(7, slot * 0.36));
  const yMoney = (value: number) => top + chartHeight - (value / moneyMax) * chartHeight;
  const yRate = (value: number) => top + chartHeight - (Math.min(value, rateMax) / rateMax) * chartHeight;
  const xCenter = (index: number) => left + slot * index + slot / 2;
  const linePath = (key: 'cvr' | 'roas') => sorted
    .map((row, index) => `${index === 0 ? 'M' : 'L'} ${xCenter(index)} ${yRate(row[key])}`)
    .join(' ');
  const dateTickEvery = Math.max(1, Math.ceil(sorted.length / 14));

  return (
    <section className="section report-chart-section">
      <div className="report-band-title"><span>Daily Topline</span><PeriodBadge label={comparisonLabel || ''} /></div>
      <div className="report-chart-wrap" onMouseLeave={() => setTooltip(null)}>
        {tooltip && (
          <div className="report-chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            <b>{tooltip.row.label}</b>
            <span>광고비 {formatCurrency(tooltip.row.spend)}</span>
            <span>매출 {formatCurrency(tooltip.row.sales)}</span>
            <span>클릭 {formatInteger(tooltip.row.clicks)} / 전환 {formatInteger(tooltip.row.conversions)}</span>
            <span>CVR {formatPercent(tooltip.row.cvr)} / ROAS {formatPercent(tooltip.row.roas)}</span>
          </div>
        )}
        <svg className="report-topline-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="일자별 광고비, 매출, CVR, ROAS 추이">
          {[0, 0.25, 0.5, 0.75, 1].map(rate => {
            const y = top + chartHeight - chartHeight * rate;
            const money = moneyMax * rate;
            const pct = rateMax * rate;
            return (
              <g key={rate}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--chart-grid-strong)" strokeWidth="1" />
                <text x={left - 8} y={y + 4} textAnchor="end" className="report-chart-axis">{compactCurrency(money)}</text>
                <text x={width - right + 8} y={y + 4} textAnchor="start" className="report-chart-axis">{rate === 1 && rawRateMax > rateMax ? `>${formatPercent(pct)}` : formatPercent(pct)}</text>
              </g>
            );
          })}

          {sorted.map((row, index) => {
            const x = xCenter(index);
            const spendHeight = top + chartHeight - yMoney(row.spend);
            const salesHeight = top + chartHeight - yMoney(row.sales);
            return (
              <g key={row.key}>
                <rect x={x - barWidth} y={yMoney(row.spend)} width={barWidth} height={Math.max(0, spendHeight)} rx="2" fill="var(--chart-1)" />
                <rect x={x} y={yMoney(row.sales)} width={barWidth} height={Math.max(0, salesHeight)} rx="2" fill="var(--chart-3)" />
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
              <rect
                x={left + slot * index}
                y={top}
                width={slot}
                height={chartHeight}
                fill="transparent"
                onMouseEnter={event => setTooltip({ x: event.clientX, y: event.clientY, row })}
                onMouseMove={event => setTooltip({ x: event.clientX, y: event.clientY, row })}
              />
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

function ComparisonTable({ rows, comparisonLabel }: { rows: ReportComparisonMetric[]; comparisonLabel?: string }) {
  return (
    <section className="section">
      <div className="section-head">
        <PeriodBadge label={comparisonLabel || ''} />
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
                <td className={trendClass(row.delta)}>{formatReportValue(row.key, row.delta)}</td>
                <td className={trendClass(row.deltaRate)}>{formatSignedPercent(row.deltaRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type RecentWeeklyData = {
  rows: ReportSummary[];
  total: ReportSummary;
  start: string;
  end: string;
};

type YearDailyGroup = {
  key: string;
  label: string;
  isCurrentMonth: boolean;
  total: ReportSummary;
  days: ReportSummary[];
};

type YearDailyData = {
  year: number;
  latestDate: string;
  total: ReportSummary;
  groups: YearDailyGroup[];
};

type PromotionPerformanceCategory = {
  label: string;
  test: (row: NormalizedReportRow) => boolean;
};

type PromotionPerformanceRow = {
  label: string;
  total: ReportSummary;
  recent: ReportSummary;
  previous: ReportSummary;
  recentStart: string;
  recentEnd: string;
};

function PromotionPerformanceSection({ title, rows }: { title: string; rows: PromotionPerformanceRow[] }) {
  const first = rows[0];
  return (
    <section className="section">
      <div className="section-head">
        <b>{title}</b>
        <span className="muted">최근 1주일 {first ? `${first.recentStart} ~ ${first.recentEnd}` : '-'}</span>
      </div>
      <div className="table-wrap sticky-detail">
        <table className="promotion-performance-table">
          <thead>
            <tr>
              <th rowSpan={2}>구분</th>
              <th colSpan={4}>전체 기간 총합</th>
              <th colSpan={4}>최근 1주일 총합</th>
              <th colSpan={4}>PoP Diff</th>
            </tr>
            <tr>
              <PromotionCompactHeaders />
              <PromotionCompactHeaders />
              <PromotionCompactHeaders />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.label} className={index === 0 && row.label === '전체 성과' ? 'report-total-row' : ''}>
                <td>{row.label}</td>
                <PromotionCompactCells row={row.total} />
                <PromotionCompactCells row={row.recent} />
                <PromotionDiffCells current={row.recent} previous={row.previous} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PromotionCompactHeaders() {
  return (
    <>
      <th>광고비</th>
      <th>매출</th>
      <th>전환</th>
      <th>ROAS</th>
    </>
  );
}

function PromotionCompactCells({ row }: { row: ReportSummary }) {
  return (
    <>
      <td>{formatCurrency(row.spend)}</td>
      <td>{formatCurrency(row.sales)}</td>
      <td>{formatInteger(row.conversions)}</td>
      <td>{row.roas.toFixed(2)}</td>
    </>
  );
}

function PromotionDiffCells({ current, previous }: { current: ReportSummary; previous: ReportSummary }) {
  return (
    <>
      <PromotionDiffCell current={current.spend} previous={previous.spend} />
      <PromotionDiffCell current={current.sales} previous={previous.sales} />
      <PromotionDiffCell current={current.conversions} previous={previous.conversions} />
      <PromotionDiffCell current={current.roas} previous={previous.roas} />
    </>
  );
}

function PromotionDiffCell({ current, previous }: { current: number; previous: number }) {
  if (!previous) return <td className="muted">-</td>;
  const rate = (current - previous) / previous;
  const arrow = rate >= 0 ? '▲' : '▼';
  return <td className={trendClass(rate)}>{arrow}{Math.abs(rate * 100).toFixed(2)}%</td>;
}

function RecentWeeklyPerformanceTable({ data, comparisonLabel }: { data: RecentWeeklyData; comparisonLabel?: string }) {
  return (
    <section className="section">
      <div className="section-head">
        <b>주차별 성과</b>
        <PeriodBadge label={comparisonLabel || ''} />
        <span className="muted">최근 3개월 · {data.start || '-'} ~ {data.end || '-'}</span>
      </div>
      <div className="table-wrap sticky-detail">
        <table>
          <thead>
            <tr>
              <th>주차</th>
              <MetricHeaders />
            </tr>
          </thead>
          <tbody>
            <tr className="report-total-row">
              <td>TOTAL</td>
              <MetricCells row={data.total} />
            </tr>
            {data.rows.map(row => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <MetricCells row={row} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function YearDailyPerformanceTable({ data, comparisonLabel }: { data: YearDailyData; comparisonLabel?: string }) {
  const defaultOpen = useMemo(() => new Set(data.groups.filter(group => group.isCurrentMonth).map(group => group.key)), [data.groups]);
  const [openMonths, setOpenMonths] = useState(defaultOpen);

  useEffect(() => {
    setOpenMonths(defaultOpen);
  }, [defaultOpen]);

  function toggleMonth(key: string) {
    setOpenMonths(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="section">
      <div className="section-head">
        <b>일별 성과</b>
        <PeriodBadge label={comparisonLabel || ''} />
        <span className="muted">{data.year || '-'}년 전체 · 최신 {data.latestDate || '-'}</span>
      </div>
      <div className="table-wrap sticky-detail">
        <table>
          <thead>
            <tr>
              <th>일자</th>
              <MetricHeaders />
            </tr>
          </thead>
          <tbody>
            <tr className="report-total-row">
              <td>{data.year || '-'} TOTAL</td>
              <MetricCells row={data.total} />
            </tr>
            {data.groups.map(group => {
              const isOpen = openMonths.has(group.key);
              return (
                <React.Fragment key={group.key}>
                  <tr className="report-month-row">
                    <td>
                      <button type="button" className="report-month-toggle" onClick={() => toggleMonth(group.key)}>
                        <span>{isOpen ? '접기' : '펼치기'}</span>
                        <b>{group.label} TOTAL</b>
                      </button>
                    </td>
                    <MetricCells row={group.total} />
                  </tr>
                  {isOpen && group.days.map(day => (
                    <tr key={day.key}>
                      <td>{day.label}</td>
                      <MetricCells row={day} />
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricHeaders() {
  return (
    <>
      <th>광고비</th>
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
    </>
  );
}

function MetricCells({ row }: { row: ReportSummary }) {
  return (
    <>
      <td>{formatCurrency(row.spend)}</td>
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
    </>
  );
}

function SummaryTable({
  title,
  rows,
  previousRows = [],
  limit,
  sortByLabel = false,
  showComparisonRows = false,
  comparisonLabel
}: {
  title: string;
  rows: ReportSummary[];
  previousRows?: ReportSummary[];
  limit: number;
  sortByLabel?: boolean;
  showComparisonRows?: boolean;
  comparisonLabel?: string;
}) {
  const previousByKey = new Map(previousRows.map(row => [row.key, row]));
  const displayRows = [...rows].sort((a, b) => sortByLabel ? a.label.localeCompare(b.label) : b.spend - a.spend || a.label.localeCompare(b.label));
  return (
    <section className="section">
      <div className="section-head">
        <PeriodBadge label={comparisonLabel || ''} />
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

function PeriodBadge({ label }: { label: string }) {
  if (!label) return null;
  return <span className="report-period-badge">{label}</span>;
}

function formatComparisonLabel(view: ReportView): string {
  return `${view.currentPeriod.label} 대비 ${view.previousPeriod.label}`;
}

function latestReportDate(rows: NormalizedReportRow[]): string {
  const dates = rows.map(row => row.date).filter(Boolean).sort();
  return dates[dates.length - 1] || '';
}

function recentSevenDayRange(rows: NormalizedReportRow[]): { start: string; end: string } {
  const dates = rows.map(row => row.date).filter(Boolean).sort();
  const min = dates[0] || '';
  const end = dates[dates.length - 1] || '';
  if (!end) return { start: '', end: '' };
  const recentStart = toIsoDate(addDays(parseIsoDate(end), -6));
  return { start: min && recentStart < min ? min : recentStart, end };
}

function buildRecentWeeklySummaries(rows: NormalizedReportRow[], latestDate: string): RecentWeeklyData {
  if (!latestDate) {
    return { rows: [], total: summarizeReportRows('TOTAL', 'TOTAL', []), start: '', end: '' };
  }
  const latest = parseIsoDate(latestDate);
  const start = new Date(latest.getFullYear(), latest.getMonth() - 2, 1);
  const startIso = toIsoDate(start);
  const scopedRows = rows.filter(row => row.date >= startIso && row.date <= latestDate);
  const grouped = new Map<string, NormalizedReportRow[]>();

  for (const row of scopedRows) {
    const week = monthWeekLabel(row.date);
    const list = grouped.get(week.key) || [];
    list.push(row);
    grouped.set(week.key, list);
  }

  return {
    rows: [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, list]) => summarizeReportRows(key, monthWeekLabel(list[0]?.date || '').label || key, list)),
    total: summarizeReportRows('TOTAL', 'TOTAL', scopedRows),
    start: startIso,
    end: latestDate
  };
}

function buildYearDailyGroups(rows: NormalizedReportRow[], latestDate: string): YearDailyData {
  if (!latestDate) {
    return { year: 0, latestDate: '', total: summarizeReportRows('TOTAL', 'TOTAL', []), groups: [] };
  }
  const latest = parseIsoDate(latestDate);
  const year = latest.getFullYear();
  const yearStart = `${year}-01-01`;
  const rowsInYear = rows.filter(row => row.date >= yearStart && row.date <= latestDate);
  const rowsByDate = new Map<string, NormalizedReportRow[]>();

  for (const row of rowsInYear) {
    const list = rowsByDate.get(row.date) || [];
    list.push(row);
    rowsByDate.set(row.date, list);
  }

  const groups: YearDailyGroup[] = [];
  for (let month = 0; month <= latest.getMonth(); month += 1) {
    const monthStart = new Date(year, month, 1);
    const monthEnd = month === latest.getMonth() ? latest : new Date(year, month + 1, 0);
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    const days: ReportSummary[] = [];

    for (const date = new Date(monthStart); date <= monthEnd; date.setDate(date.getDate() + 1)) {
      const iso = toIsoDate(date);
      days.push(summarizeReportRows(iso, iso, rowsByDate.get(iso) || []));
    }

    groups.push({
      key,
      label: `${month + 1}월`,
      isCurrentMonth: month === latest.getMonth(),
      total: summarizeReportRows(`${key}-TOTAL`, `${month + 1}월 TOTAL`, rowsInYear.filter(row => row.date.startsWith(key))),
      days
    });
  }

  return {
    year,
    latestDate,
    total: summarizeReportRows('YEAR-TOTAL', `${year} TOTAL`, rowsInYear),
    groups
  };
}

function buildPromotionPerformanceRows(
  rows: NormalizedReportRow[],
  latestDate: string,
  categories: PromotionPerformanceCategory[],
  fallbackLabel?: string
): PromotionPerformanceRow[] {
  const recentEnd = latestDate || latestReportDate(rows);
  const recentEndDate = recentEnd ? parseIsoDate(recentEnd) : null;
  const recentStart = recentEndDate ? toIsoDate(addDays(recentEndDate, -6)) : '';
  const previousEnd = recentEndDate ? toIsoDate(addDays(parseIsoDate(recentStart), -1)) : '';
  const previousStart = previousEnd ? toIsoDate(addDays(parseIsoDate(previousEnd), -6)) : '';
  const buckets = new Map<string, NormalizedReportRow[]>();

  for (const category of categories) buckets.set(category.label, []);
  if (fallbackLabel) buckets.set(fallbackLabel, []);

  for (const row of rows) {
    const category = categories.find(item => item.test(row));
    const label = category?.label || fallbackLabel;
    if (!label) continue;
    const list = buckets.get(label) || [];
    list.push(row);
    buckets.set(label, list);
  }

  return [...buckets.entries()]
    .filter(([label, list]) => label !== fallbackLabel || list.length > 0)
    .map(([label, list]) => ({
      label,
      total: summarizeReportRows(`${label}-total`, label, list),
      recent: summarizeReportRows(`${label}-recent`, label, filterRowsByPeriod(list, recentStart, recentEnd)),
      previous: summarizeReportRows(`${label}-previous`, label, filterRowsByPeriod(list, previousStart, previousEnd)),
      recentStart,
      recentEnd
    }));
}

function buildCampaignPerformanceRows(rows: NormalizedReportRow[], latestDate: string): PromotionPerformanceRow[] {
  const groups = new Map<string, NormalizedReportRow[]>();
  for (const row of rows) {
    const label = inferCampaignGroupLabel(row);
    const list = groups.get(label) || [];
    list.push(row);
    groups.set(label, list);
  }

  const sorted = [...groups.entries()].sort(([, aRows], [, bRows]) => {
    const a = summarizeReportRows('a', 'a', aRows);
    const b = summarizeReportRows('b', 'b', bRows);
    return b.spend - a.spend || b.rows - a.rows;
  });

  const top = sorted.slice(0, 12);
  const rest = sorted.slice(12).flatMap(([, list]) => list);
  if (rest.length) top.push(['기타', rest]);

  return top.map(([label, list]) => buildPromotionPerformanceRow(label, list, latestDate));
}

function buildPromotionPerformanceRow(label: string, rows: NormalizedReportRow[], latestDate: string): PromotionPerformanceRow {
  const recentEnd = latestDate || latestReportDate(rows);
  const recentEndDate = recentEnd ? parseIsoDate(recentEnd) : null;
  const recentStart = recentEndDate ? toIsoDate(addDays(recentEndDate, -6)) : '';
  const previousEnd = recentEndDate ? toIsoDate(addDays(parseIsoDate(recentStart), -1)) : '';
  const previousStart = previousEnd ? toIsoDate(addDays(parseIsoDate(previousEnd), -6)) : '';
  return {
    label,
    total: summarizeReportRows(`${label}-total`, label, rows),
    recent: summarizeReportRows(`${label}-recent`, label, filterRowsByPeriod(rows, recentStart, recentEnd)),
    previous: summarizeReportRows(`${label}-previous`, label, filterRowsByPeriod(rows, previousStart, previousEnd)),
    recentStart,
    recentEnd
  };
}

function inferCampaignGroupLabel(row: NormalizedReportRow): string {
  const fullText = normalizeSearchText(`${row.campaignName} ${row.adgroupName} ${row.adName}`);
  const campaignText = normalizeSearchText(row.campaignName);
  const alias = campaignAliasLabel(fullText);
  if (alias) return alias;

  const campaignProduct = pickCampaignProductToken(campaignText);
  if (campaignProduct) return humanizeCampaignToken(campaignProduct);

  const fallbackProduct = pickCampaignProductToken(fullText);
  return fallbackProduct ? humanizeCampaignToken(fallbackProduct) : '기타';
}

function pickCampaignProductToken(text: string): string {
  const tokens = text
    .split(/[^a-z0-9가-힣]+/)
    .map(token => token.trim())
    .filter(Boolean)
    .filter(token => !isCampaignNoiseToken(token));

  return tokens.find(token => /[a-z가-힣]/.test(token)) || '';
}

function campaignAliasLabel(text: string): string {
  const aliases: { label: string; keys: string[] }[] = [
    { label: 'PDRN세럼', keys: ['pdrnserum', 'pdrn serum', 'pdrn'] },
    { label: '배리어 크림', keys: ['barriercream', 'barrier cream', 'barrier', '배리어'] },
    { label: '블루드롭', keys: ['bluedrop', 'blue drop', '블루드롭'] },
    { label: '젤리팩클렌저', keys: ['jellypack', 'jelly pack', 'cleanser', '젤리팩', '클렌저'] },
    { label: '비타민', keys: ['vitamin', '비타민'] },
    { label: 'EGF/PDRN', keys: ['pdrnegf', 'egf'] },
    { label: '마린', keys: ['마린', 'marine'] },
    { label: '클리어런스', keys: ['clearance', '클리어런스'] }
  ];
  return aliases.find(alias => alias.keys.some(key => text.includes(normalizeSearchText(key))))?.label || '';
}

function isCampaignNoiseToken(token: string): boolean {
  if (/^\d+$/.test(token)) return true;
  if (/^\d{4}$/.test(token)) return true;
  if (/^\d{2,4}$/.test(token)) return true;
  if (/^\d{2,4}f(l\d+)?$/.test(token)) return true;
  return [
    'dk', 'bw', 'jp', 'jpn', 'qoo10', 'q10', 'meta', 's', 'tiktok', 'spark', 'ads',
    'purchase', 'traffic', 'conversion', 'catalog', 'lead', 'registration', 'atc',
    'asc', 'line', 'cg', 'non', 'wish', 'amazon', 'market', 'megawari', 'megawri',
    'megapo', '4q', 'img', 'video', 'vid', 'category', 'click', 'rt', 'set',
    'interest', 'ig', 'l1', 'l2', 'l3', '2064f', '2065f', '2065fl6'
  ].includes(token);
}

function humanizeCampaignToken(token: string): string {
  return token
    .replace(/cream/g, ' cream')
    .replace(/serum/g, ' serum')
    .replace(/drop/g, ' drop')
    .replace(/cleanser/g, ' cleanser')
    .replace(/pdrn/g, 'PDRN')
    .replace(/egf/g, 'EGF')
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim();
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function reportSearchText(row: NormalizedReportRow): string {
  return normalizeSearchText(`${row.media} ${row.promotion} ${row.campaignName} ${row.adgroupName} ${row.adName}`);
}

function matchesAnyReportText(row: NormalizedReportRow, keywords: string[]): boolean {
  const text = reportSearchText(row);
  return keywords.some(keyword => text.includes(normalizeSearchText(keyword)));
}

function isSingleOneMeta(row: NormalizedReportRow): boolean {
  const text = reportSearchText(row);
  return text.includes('s meta') || text.includes('singleone') || text.includes('single one') || text.includes('싱글원');
}

function isMetaMedia(row: NormalizedReportRow): boolean {
  return reportSearchText(row).includes('meta');
}

function monthWeekLabel(value: string): { key: string; label: string } {
  if (!value) return { key: 'date-missing', label: '일자 없음' };
  const date = parseIsoDate(value);
  const month = date.getMonth() + 1;
  const week = Math.ceil(date.getDate() / 7);
  return {
    key: `${date.getFullYear()}-${String(month).padStart(2, '0')}-W${String(week).padStart(2, '0')}`,
    label: `${month}월 ${week}주차`
  };
}

function summarizeReportRows(key: string, label: string, rows: NormalizedReportRow[]): ReportSummary {
  const summary = rows.reduce(
    (acc, row) => {
      acc.spend += row.costKrw;
      acc.grossSpend += row.grossCostKrw;
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      acc.conversions += row.conversions;
      acc.sales += row.salesKrw;
      acc.addToCart += row.addToCart;
      acc.registration += row.registration;
      acc.lead += row.lead;
      acc.order += row.order;
      return acc;
    },
    {
      key,
      label,
      rows: rows.length,
      spend: 0,
      grossSpend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      sales: 0,
      addToCart: 0,
      registration: 0,
      lead: 0,
      order: 0
    }
  );

  return {
    ...summary,
    spend: roundNumber(summary.spend),
    grossSpend: roundNumber(summary.grossSpend),
    sales: roundNumber(summary.sales),
    ctr: safeRatio(summary.clicks, summary.impressions),
    cpc: safeRatio(summary.spend, summary.clicks),
    cvr: safeRatio(summary.conversions, summary.clicks),
    cpa: safeRatio(summary.spend, summary.conversions),
    cartCpa: safeRatio(summary.spend, summary.addToCart),
    roas: safeRatio(summary.sales, summary.spend)
  };
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

function roundNumber(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function matchesValue(value: string, selected: string): boolean {
  return !selected || value === selected;
}

function uniqueLabels(rows: NormalizedReportRow[], pick: (row: NormalizedReportRow) => string): string[] {
  return [...new Set(rows.map(row => pick(row)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}

function matchesPromotionTab(row: NormalizedReportRow, tab: PromotionTab): boolean {
  const promotionText = normalizeSearchText(row.promotion);
  const fullText = normalizeSearchText(`${row.promotion} ${row.campaignName} ${row.adgroupName} ${row.adName}`);
  const text = hasConcretePromotionText(promotionText) ? promotionText : fullText;
  const isHybrid = fullText.includes('하이브리드') || fullText.includes('hybrid');
  if (tab === 'hybrid') return isHybrid;
  if (isHybrid) return false;
  if (tab === 'owned') return text.includes('자사몰');
  if (tab === 'megawari') return text.includes('메가와리') || text.includes('megawari') || text.includes('mega wari');
  if (tab === 'megapo') return text.includes('메가포') || text.includes('megapo') || text.includes('mega po');
  if (tab === 'market') return isMarketText(text);
  return text.includes('상시') || text.includes('always') || text.includes('evergreen') || !hasEventPromotionText(text);
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').trim();
}

function hasConcretePromotionText(text: string): boolean {
  return Boolean(text) && !text.includes('미분류') && !text.includes('unclassified');
}

function isMarketText(text: string): boolean {
  return ['마켓', 'market', '큐텐', 'qoo10', 'q10', '라쿠텐', 'rakuten', '아마존', 'amazon'].some(keyword => text.includes(keyword));
}

function hasEventPromotionText(text: string): boolean {
  return [
    '자사몰',
    '하이브리드',
    'hybrid',
    '메가와리',
    'megawari',
    'mega wari',
    '메가포',
    'megapo',
    'mega po'
  ].some(keyword => text.includes(keyword)) || isMarketText(text);
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

function percentile(values: number[], rate: number): number {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * rate)));
  return values[index];
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

function trendClass(value: number): string {
  return Number(value) >= 0 ? 'diff-up' : 'diff-down';
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
  const trendArrow = rate >= 0 ? '▲' : '▼';
  return <td className={trendClass(rate)}>{trendArrow}{Math.abs(rate * 100).toFixed(2)}%</td>;
  const good = inverse ? rate <= 0 : rate >= 0;
  const arrow = rate >= 0 ? '▲' : '▼';
  return <td className={good ? 'diff-up' : 'diff-down'}>{arrow}{Math.abs(rate * 100).toFixed(2)}%</td>;
}

function trim(value: string, max = 32): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
