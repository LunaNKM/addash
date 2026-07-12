'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, completeRedirectLogin, firebaseAuthErrorMessage, logout, signInWithGoogleSafe } from '@/lib/firebase';
import { buildReportView, filterRowsByPeriod, previousMatchingPeriod } from '@/lib/report/aggregate';
import { DEFAULT_EXCHANGE_RATE } from '@/lib/report/schema';
import { loadReportFromXlsx } from '@/lib/report/sources';
import {
  createBrand,
  emptyKpi,
  findBrandByShareToken,
  getKpi,
  getReportComment,
  getReportFile,
  isAdminEmail,
  listBrandsForAdmin,
  listReportFiles,
  listTabs,
  saveKpi,
  saveReportComment,
  saveReportFile,
  updateBrand
} from '@/lib/store';
import { applyBrandColor, randomBrandColor } from '@/lib/brandColor';
import { errorMessage } from '@/lib/dashUtils';
import type { Brand, DashboardTab, Kpi, ReportCommentDoc, ReportFileDoc } from '@/lib/types';
import { Empty } from '../components/Empty';
import { SettingsModal, type SettingsMode } from '../components/SettingsModal';
import type {
  NormalizedReportRow,
  ReportComparisonMetric,
  ReportParseResult,
  ReportSummary,
  ReportView
} from '@/lib/report/reportTypes';

type MarketplaceTab = 'qoo10' | 'owned';
type PromotionSubTab = 'always' | 'megawari' | 'megapo' | 'hybrid';
type ReportTab = 'total' | 'campaigns' | 'creatives' | MarketplaceTab;

const marketplaceTabs: { id: MarketplaceTab; label: string }[] = [
  { id: 'qoo10', label: 'Qoo10' },
  { id: 'owned', label: '자사몰' }
];

const marketplaceSubTabs: Record<MarketplaceTab, { id: PromotionSubTab; label: string }[]> = {
  qoo10: [
    { id: 'always', label: '상시' },
    { id: 'megawari', label: '메가와리' },
    { id: 'megapo', label: '메가포' }
  ],
  owned: [
    { id: 'always', label: '상시' },
    { id: 'hybrid', label: '하이브리드' }
  ]
};

const tabs: { id: ReportTab; label: string }[] = [
  { id: 'total', label: '전체 성과' },
  { id: 'campaigns', label: '캠페인별' },
  { id: 'creatives', label: '소재별' },
  ...marketplaceTabs
];

const FIXED_REPORT_COMMENT = 'Google Sheet로 전달 예정';

const tabAccents: Record<ReportTab, string> = {
  total: '#E5484D',
  campaigns: '#E5484D',
  creatives: '#E5484D',
  qoo10: '#2F6FED',
  owned: '#8E4EC6'
};

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
  const [reportComment, setReportComment] = useState<ReportCommentDoc | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentEditing, setCommentEditing] = useState(false);
  const [commentBusy, setCommentBusy] = useState('');
  const [settings, setSettings] = useState<SettingsMode>('none');
  const [result, setResult] = useState<ReportParseResult | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>('total');
  const [activeSubTab, setActiveSubTab] = useState<PromotionSubTab>('always');
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [comparisonStart, setComparisonStart] = useState('');
  const [comparisonEnd, setComparisonEnd] = useState('');
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
    setReportComment(null);
    setCommentDraft('');
    setCommentEditing(false);
    setPeriodStart('');
    setPeriodEnd('');
    setComparisonStart('');
    setComparisonEnd('');
    setCampaignFilter('');
    setAdgroupFilter('');
    setAdFilter('');
  }, []);

  const applyReportResult = useCallback((nextResult: ReportParseResult | null, createdAt?: number) => {
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
    const range = fileInputDayRange(createdAt);
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
      const [loadedFile, loadedComment] = await Promise.all([
        getReportFile(target.id, nextTab.id, firstFile.id),
        getReportComment(target.id, nextTab.id, firstFile.id)
      ]);
      applyReportResult(loadedFile?.result || null, loadedFile?.createdAt || firstFile.createdAt);
      setReportComment(loadedComment);
      setCommentDraft(loadedComment?.text || '');
      setCommentEditing(false);
    } else {
      applyReportResult(null);
      setReportComment(null);
      setCommentDraft('');
      setCommentEditing(false);
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
      const [loadedFile, loadedComment] = await Promise.all([
        getReportFile(brand.id, dashboardTab.id, selected.id),
        getReportComment(brand.id, dashboardTab.id, selected.id)
      ]);
      applyReportResult(loadedFile?.result || null, loadedFile?.createdAt || selected.createdAt);
      setReportComment(loadedComment);
      setCommentDraft(loadedComment?.text || '');
      setCommentEditing(false);
    } else {
      applyReportResult(null);
      setReportComment(null);
      setCommentDraft('');
      setCommentEditing(false);
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

  const activeMarketplace = useMemo(() => marketplaceTabs.find(tab => tab.id === activeTab), [activeTab]);
  const activeSubTabs = activeMarketplace ? marketplaceSubTabs[activeMarketplace.id] : [];
  const activeSubTabLabel = activeSubTabs.find(tab => tab.id === activeSubTab)?.label || '';
  const activeMarketplaceTitle = activeMarketplace ? `${activeMarketplace.label} ${activeSubTabLabel}`.trim() : '';

  useEffect(() => {
    if (!activeMarketplace || activeSubTabs.some(tab => tab.id === activeSubTab)) return;
    setActiveSubTab(activeSubTabs[0]?.id || 'always');
  }, [activeMarketplace, activeSubTab, activeSubTabs]);

  const periodRows = useMemo(() => {
    if (!result) return [];
    return filterRowsByPeriod(result.rows, periodStart || dates.min, periodEnd || dates.max).filter(row => !isExcludedAmazonRow(row));
  }, [dates.max, dates.min, periodEnd, periodStart, result]);

  const optionRows = useMemo(() => {
    if (!activeMarketplace) return periodRows;
    return periodRows.filter(row => matchesMarketplaceTab(row, activeMarketplace.id) && matchesPromotionSubTab(row, activeMarketplace.id, activeSubTab));
  }, [activeMarketplace, activeSubTab, periodRows]);

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
    return periodRows.filter(row => {
      if (activeMarketplace && (!matchesMarketplaceTab(row, activeMarketplace.id) || !matchesPromotionSubTab(row, activeMarketplace.id, activeSubTab))) return false;
      if (!matchesValue(row.campaignName, campaignFilter)) return false;
      if (!matchesValue(row.adgroupName, adgroupFilter)) return false;
      if (!matchesValue(row.adName, adFilter)) return false;
      return true;
    });
  }, [activeMarketplace, activeSubTab, adFilter, adgroupFilter, campaignFilter, periodRows]);

  const defaultComparison = useMemo(
    () => previousMatchingPeriod(periodStart || dates.min, periodEnd || dates.max),
    [dates.max, dates.min, periodEnd, periodStart]
  );

  const reportView = useMemo(() => {
    if (!result) return null;
    return buildReportView(
      filteredRows,
      periodStart || dates.min,
      periodEnd || dates.max,
      comparisonStart,
      comparisonEnd
    );
  }, [comparisonEnd, comparisonStart, dates.max, dates.min, filteredRows, periodEnd, periodStart, result]);

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
      const createdAt = Date.now();
      const savedId = await saveReportFile(brand.id, dashboardTab.id, {
        filename: file.name,
        fileSize: file.size,
        dateStart: detectedDates[0] || '',
        dateEnd: detectedDates[detectedDates.length - 1] || '',
        rowCount: parsed.rows.length,
        exchangeRate,
        result: parsed,
        createdAt
      });
      const loadedReportFiles = await listReportFiles(brand.id, dashboardTab.id);
      setReportFiles(loadedReportFiles);
      setSelectedReportFileId(savedId);
      setReportComment(null);
      setCommentDraft('');
      setCommentEditing(false);
      applyReportResult(parsed, createdAt);
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

  async function saveReportCommentFlow(text: string) {
    if (!brand || !dashboardTab || !selectedReportFileId) return;
    const nextText = text.trim();
    if (!nextText) {
      alert('Comment 내용을 입력해주세요.');
      return;
    }
    setCommentBusy('Comment 저장 중입니다...');
    try {
      await saveReportComment(brand.id, dashboardTab.id, selectedReportFileId, {
        text: nextText,
        periodStart,
        periodEnd
      });
      const saved = await getReportComment(brand.id, dashboardTab.id, selectedReportFileId);
      setReportComment(saved);
      setCommentDraft(saved?.text || nextText);
      setCommentEditing(false);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setCommentBusy('');
    }
  }

  async function generateReportComment() {
    if (!brand || !dashboardTab || !selectedReportFileId) return;
    setCommentBusy('Comment 저장 중입니다...');
    setError('');
    try {
      await saveReportCommentFlow(FIXED_REPORT_COMMENT);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setCommentBusy('');
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
        {isAdmin && (
          <div className="header-actions">
            {!user
              ? <button className="btn outline" onClick={async () => {
                  setAuthError('');
                  try { await signInWithGoogleSafe(); }
                  catch (err) { setAuthError(firebaseAuthErrorMessage(err)); }
                }}>Google 로그인</button>
              : <button className="btn ghost" onClick={logout}>로그아웃</button>}
            <Link className="btn ghost" href="/">대시보드</Link>
            {brand && <button className="btn ghost" onClick={() => setSettings('brand')}>설정</button>}
            {brand && <button className="btn ghost" onClick={() => navigator.clipboard.writeText(`${location.origin}/report-lab?share=${brand.shareToken}`).then(() => alert('공유 링크를 복사했습니다.'))}>공유</button>}
            {brand && dashboardTab && (
              <label className="btn brand">
                RAW 업로드
                <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => event.target.files?.[0] && handleFile(event.target.files[0])} />
              </label>
            )}
          </div>
        )}
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
          <div className="period-group">
            <div className="period">
              <span>대상 기간</span>
              <input type="date" value={periodStart} onChange={event => setPeriodStart(event.target.value)} />
              <span>~</span>
              <input type="date" value={periodEnd} onChange={event => setPeriodEnd(event.target.value)} />
            </div>
            <div className="period">
              <span>비교 기간</span>
              <input
                type="date"
                value={comparisonStart || defaultComparison.start}
                max={dates.max}
                onChange={event => setComparisonStart(event.target.value)}
              />
              <span>~</span>
              <input
                type="date"
                value={comparisonEnd || defaultComparison.end}
                max={dates.max}
                onChange={event => setComparisonEnd(event.target.value)}
              />
              {(comparisonStart || comparisonEnd) && (
                <button
                  type="button"
                  className="period-reset"
                  title="비교 기간을 기본값으로 되돌립니다"
                  onClick={() => {
                    setComparisonStart('');
                    setComparisonEnd('');
                  }}
                >
                  ↺
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="tabbar">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              style={{ '--tab-accent': tabAccents[tab.id] } as React.CSSProperties}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === 'qoo10' || tab.id === 'owned') setActiveSubTab('always');
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeMarketplace && (
          <div className="tabbar report-subtabbar">
            {activeSubTabs.map(tab => (
              <button
                key={tab.id}
                className={activeSubTab === tab.id ? 'active' : ''}
                style={{ '--tab-accent': tabAccents[activeMarketplace.id] } as React.CSSProperties}
                onClick={() => setActiveSubTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="content">
          <div className="filter-bar report-lab-controls">
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
                    Promise.all([
                      getReportFile(brand.id, dashboardTab.id, file.id),
                      getReportComment(brand.id, dashboardTab.id, file.id)
                    ])
                      .then(([loadedFile, loadedComment]) => {
                        applyReportResult(loadedFile?.result || null, loadedFile?.createdAt || file.createdAt);
                        setReportComment(loadedComment);
                        setCommentDraft(loadedComment?.text || '');
                        setCommentEditing(false);
                      })
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
              {activeTab === 'total' && (
                <TotalPerformance
                  view={reportView}
                  allRows={filteredRows}
                  kpi={kpi}
                  comment={reportComment}
                  commentDraft={commentDraft}
                  setCommentDraft={setCommentDraft}
                  editing={commentEditing}
                  setEditing={setCommentEditing}
                  isAdmin={isAdmin}
                  busy={commentBusy}
                  onGenerate={generateReportComment}
                  onSave={saveReportCommentFlow}
                />
              )}
              {activeTab === 'campaigns' && <CampaignReport view={reportView} kpi={kpi} />}
              {activeTab === 'creatives' && <CreativeReport view={reportView} kpi={kpi} />}
              {activeMarketplace && <PromotionDetailReport title={activeMarketplaceTitle} view={reportView} allRows={filteredRows} />}
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

function TotalPerformance({
  view,
  allRows,
  kpi,
  comment,
  commentDraft,
  setCommentDraft,
  editing,
  setEditing,
  isAdmin,
  busy,
  onGenerate,
  onSave
}: {
  view: ReportView;
  allRows: NormalizedReportRow[];
  kpi: Kpi;
  comment: ReportCommentDoc | null;
  commentDraft: string;
  setCommentDraft: (value: string) => void;
  editing: boolean;
  setEditing: (value: boolean) => void;
  isAdmin: boolean;
  busy: string;
  onGenerate: () => void;
  onSave: (text: string) => void;
}) {
  const comparisonLabel = formatComparisonLabel(view);
  const latestDate = latestReportDate(allRows) || view.currentPeriod.end;
  const weekly = buildRecentWeeklySummaries(allRows, latestDate);
  const yearlyDaily = buildYearDailyGroups(allRows, latestDate);

  return (
    <>
      <SummaryCards total={view.current.total} kpi={kpi} />
      <ReportCommentSection
        comment={comment}
        draft={commentDraft}
        setDraft={setCommentDraft}
        editing={editing}
        setEditing={setEditing}
        isAdmin={isAdmin}
        busy={busy}
        onGenerate={onGenerate}
        onSave={onSave}
      />
      <DailyToplineChart rows={view.current.byDaily} comparisonLabel={comparisonLabel} />
      <ComparisonTable rows={view.comparison} comparisonLabel={comparisonLabel} />
      <SummaryTable title="프로모션별 성과" rows={view.current.byPromotion} previousRows={view.previous.byPromotion} limit={30} showComparisonRows comparisonLabel={comparisonLabel} />
      <RecentWeeklyPerformanceTable data={weekly} />
      <YearDailyPerformanceTable data={yearlyDaily} />
    </>
  );
}

function DailyPerformanceDetails({ view }: { view: ReportView }) {
  return (
    <>
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
      <DailyPerformanceDetails view={view} />
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
  const overallRows = buildPromotionPerformanceRows(allRows, view.currentRows, view.previousRows, view.currentPeriod.start, view.currentPeriod.end, [{ label: '전체 성과', test: () => true }]);
  const mediaRows = buildPromotionPerformanceRows(allRows, view.currentRows, view.previousRows, view.currentPeriod.start, view.currentPeriod.end, [
    { label: '싱글원(S-META)', test: row => isSingleOneMeta(row) },
    { label: '메타', test: row => isMetaMedia(row) && !isSingleOneMeta(row) }
  ], '기타');
  const objectiveRows = buildPromotionPerformanceRows(allRows, view.currentRows, view.previousRows, view.currentPeriod.start, view.currentPeriod.end, [
    { label: 'Purchase', test: row => matchesAnyReportText(row, ['purchase', 'conversion']) },
    { label: 'Click', test: row => matchesAnyReportText(row, ['click']) },
    { label: 'Traffic', test: row => matchesAnyReportText(row, ['traffic']) }
  ], '기타');
  const campaignRows = buildCampaignPerformanceRows(allRows, view.currentRows, view.previousRows, view.currentPeriod.start, view.currentPeriod.end);

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
    { label: '매출', value: formatCurrency(total.sales), current: total.sales, goal: kpi.salesGoal, goalValue: formatCurrency(kpi.salesGoal) },
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

function ReportCommentSection({
  comment,
  draft,
  setDraft,
  editing,
  setEditing,
  isAdmin,
  busy,
  onGenerate,
  onSave
}: {
  comment: ReportCommentDoc | null;
  draft: string;
  setDraft: (value: string) => void;
  editing: boolean;
  setEditing: (value: boolean) => void;
  isAdmin: boolean;
  busy: string;
  onGenerate: () => void;
  onSave: (text: string) => void;
}) {
  if (!isAdmin && !comment?.text) return null;

  return (
    <section className="section report-comment-section">
      <div className="section-head">
        <b>Comment</b>
        {isAdmin && (
          <div className="report-comment-actions">
            <button className="btn outline" disabled={Boolean(busy)} onClick={onGenerate}>
              {busy || 'Comment 생성'}
            </button>
            {comment?.text && !editing && (
              <button className="btn ghost" disabled={Boolean(busy)} onClick={() => {
                setDraft(comment.text);
                setEditing(true);
              }}>
                수정
              </button>
            )}
          </div>
        )}
      </div>
      {editing ? (
        <div className="report-comment-editor">
          <textarea value={draft} onChange={event => setDraft(event.target.value)} />
          <div className="modal-actions">
            <button className="btn outline" disabled={Boolean(busy)} onClick={() => {
              setDraft(comment?.text || '');
              setEditing(false);
            }}>
              취소
            </button>
            <button className="btn brand" disabled={Boolean(busy)} onClick={() => onSave(draft)}>
              저장
            </button>
          </div>
        </div>
      ) : (
        <div className="report-comment-box">
          {comment?.text
            ? <ReportCommentContent text={comment.text} />
            : <span className="muted">Comment를 생성하면 공유 링크에서도 이 영역에 표시됩니다.</span>}
        </div>
      )}
    </section>
  );
}

function ReportCommentContent({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return (
    <div className="report-comment-content">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        const isHead = trimmed === '현 상황' || trimmed === 'NEXT';
        const labelMatch = /^\[(.+)\]$/.exec(trimmed);
        const isAction = /^\d+\)/.test(trimmed);
        const isBullet = trimmed.startsWith('- ') || trimmed === '-';
        let cls = 'report-comment-line';
        if (isHead) cls += ' is-head';
        else if (labelMatch) cls += ' is-label';
        else if (isAction) cls += ' is-action';
        else if (isBullet) cls += ' is-bullet';
        const content = labelMatch ? labelMatch[1] : (line || ' ');
        return (
          <div key={index} className={cls}>
            {content}
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
    .map(row => row.roas)
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
  const linePath = (key: 'roas') => sorted
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
            <span>ROAS {formatPercent(tooltip.row.roas)}</span>
          </div>
        )}
        <svg className="report-topline-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="일자별 광고비, 매출, ROAS 추이">
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
                  <text x={x} y={height - 18} textAnchor="middle" className="report-chart-date">
                    {row.label}
                  </text>
                )}
              </g>
            );
          })}

          <path d={linePath('roas')} fill="none" stroke="var(--c-danger)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {sorted.map((row, index) => (
            <g key={`${row.key}-points`}>
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
          <span><i className="line" style={{ background: 'var(--c-danger)' }} />ROAS</span>
        </div>
      </div>
    </section>
  );
}

function ComparisonTable({ rows, comparisonLabel }: { rows: ReportComparisonMetric[]; comparisonLabel?: string }) {
  const metric = (key: ReportComparisonMetric['key']) => rows.find(row => row.key === key);
  const summary = (prefix: string): ReportSummary => ({
    key: prefix,
    label: prefix,
    rows: 0,
    spend: metric('spend')?.[prefix as 'current' | 'previous'] || 0,
    grossSpend: 0,
    impressions: metric('impressions')?.[prefix as 'current' | 'previous'] || 0,
    clicks: metric('clicks')?.[prefix as 'current' | 'previous'] || 0,
    conversions: metric('conversions')?.[prefix as 'current' | 'previous'] || 0,
    sales: metric('sales')?.[prefix as 'current' | 'previous'] || 0,
    addToCart: metric('addToCart')?.[prefix as 'current' | 'previous'] || 0,
    registration: 0,
    lead: 0,
    order: 0,
    ctr: metric('ctr')?.[prefix as 'current' | 'previous'] || 0,
    cpc: safeRatio(metric('spend')?.[prefix as 'current' | 'previous'] || 0, metric('clicks')?.[prefix as 'current' | 'previous'] || 0),
    cvr: metric('cvr')?.[prefix as 'current' | 'previous'] || 0,
    cpa: metric('cpa')?.[prefix as 'current' | 'previous'] || 0,
    cartCpa: 0,
    roas: metric('roas')?.[prefix as 'current' | 'previous'] || 0
  });
  const current = summary('current');
  const previous = summary('previous');

  return (
    <section className="section">
      <div className="section-head">
        <b>기간 비교</b>
        <PeriodBadge label={comparisonLabel || ''} />
        <span className="muted">선택 기간과 직전 동일 길이 기간을 비교합니다.</span>
      </div>
      <div className="table-wrap sticky-detail">
        <table className="promotion-performance-table">
          <thead>
            <tr>
              <th rowSpan={2}>구분</th>
              <th colSpan={6}>선택 기간</th>
              <th colSpan={6}>이전 기간</th>
              <th colSpan={6}>PoP Diff</th>
            </tr>
            <tr>
              <PromotionCompactHeaders extended />
              <PromotionCompactHeaders extended />
              <PromotionCompactHeaders extended />
            </tr>
          </thead>
          <tbody>
            <tr className="report-total-row">
              <td>전체 성과</td>
              <PromotionCompactCells row={current} extended />
              <PromotionCompactCells row={previous} extended />
              <PromotionDiffCells current={current} previous={previous} />
            </tr>
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
  target: ReportSummary;
  previous: ReportSummary;
  targetStart: string;
  targetEnd: string;
};

function PromotionPerformanceSection({ title, rows }: { title: string; rows: PromotionPerformanceRow[] }) {
  const first = rows[0];
  return (
    <section className="section">
      <div className="section-head">
        <b>{title}</b>
        <span className="muted">대상 기간 {first ? formatPromotionPeriodLabel(first.targetStart, first.targetEnd) : '-'}</span>
      </div>
      <div className="table-wrap sticky-detail">
        <table className="promotion-performance-table">
          <thead>
            <tr>
              <th rowSpan={2}>구분</th>
              <th colSpan={4}>전체 기간 총합</th>
              <th colSpan={6}>대상 기간 총합</th>
              <th colSpan={6}>PoP Diff</th>
            </tr>
            <tr>
              <PromotionCompactHeaders />
              <PromotionCompactHeaders extended />
              <PromotionCompactHeaders extended />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.label} className={index === 0 && row.label === '전체 성과' ? 'report-total-row' : ''}>
                <td>{row.label}</td>
                <PromotionCompactCells row={row.total} />
                <PromotionCompactCells row={row.target} extended />
                <PromotionDiffCells current={row.target} previous={row.previous} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PromotionCompactHeaders({ extended = false }: { extended?: boolean }) {
  return (
    <>
      <th>광고비</th>
      <th>매출</th>
      <th>전환</th>
      <th>ROAS</th>
      {extended && (
        <>
          <th>CTR</th>
          <th>CPC</th>
        </>
      )}
    </>
  );
}

function PromotionCompactCells({ row, extended = false }: { row: ReportSummary; extended?: boolean }) {
  return (
    <>
      <td>{formatCurrency(row.spend)}</td>
      <td>{formatCurrency(row.sales)}</td>
      <td>{formatInteger(row.conversions)}</td>
      <td>{row.roas.toFixed(2)}</td>
      {extended && (
        <>
          <td>{formatPercent(row.ctr)}</td>
          <td>{formatCurrency(row.cpc)}</td>
        </>
      )}
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
      <PromotionDiffCell current={current.ctr} previous={previous.ctr} />
      <PromotionDiffCell current={current.cpc} previous={previous.cpc} />
    </>
  );
}

function PromotionDiffCell({ current, previous }: { current: number; previous: number }) {
  if (!previous) return <td className="muted">-</td>;
  const rate = (current - previous) / previous;
  const arrow = rate >= 0 ? '▲' : '▼';
  return <td className={trendClass(rate)}>{arrow}{Math.abs(rate * 100).toFixed(2)}%</td>;
}

function formatPromotionPeriodLabel(start: string, end: string): string {
  if (!start && !end) return '-';
  if (start === end) return start;
  return `${start || '-'} ~ ${end || '-'}`;
}

function RecentWeeklyPerformanceTable({ data, comparisonLabel }: { data: RecentWeeklyData; comparisonLabel?: string }) {
  return (
    <section className="section">
      <div className="section-head">
        <b>주차별 성과</b>
        <PeriodBadge label={comparisonLabel || ''} />
        <span className="muted">최근 3개월 · 전월까지 · {data.start || '-'} ~ {data.end || '-'}</span>
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
  const displayRows = [...rows].sort((a, b) => sortByLabel ? a.key.localeCompare(b.key) : b.spend - a.spend || a.label.localeCompare(b.label));
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

function fileInputDayRange(createdAt?: number): { start: string; end: string } {
  const inputDate = createdAt ? new Date(createdAt) : new Date();
  const end = toIsoDate(inputDate);
  const start = toIsoDate(addDays(inputDate, -1));
  return { start, end };
}

function buildRecentWeeklySummaries(rows: NormalizedReportRow[], latestDate: string): RecentWeeklyData {
  if (!latestDate) {
    return { rows: [], total: summarizeReportRows('TOTAL', 'TOTAL', []), start: '', end: '' };
  }
  const latest = parseIsoDate(latestDate);
  const start = new Date(latest.getFullYear(), latest.getMonth() - 3, 1);
  const end = new Date(latest.getFullYear(), latest.getMonth(), 0);
  const startIso = toIsoDate(start);
  const endIso = toIsoDate(end);
  const scopedRows = rows.filter(row => row.date >= startIso && row.date <= endIso);
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
    end: endIso
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
  targetRows: NormalizedReportRow[],
  previousRows: NormalizedReportRow[],
  targetStart: string,
  targetEnd: string,
  categories: PromotionPerformanceCategory[],
  fallbackLabel?: string
): PromotionPerformanceRow[] {
  const labels = categories.map(category => category.label);
  if (fallbackLabel) labels.push(fallbackLabel);
  const bucketRows = (sourceRows: NormalizedReportRow[]) => {
    const buckets = new Map(labels.map(label => [label, [] as NormalizedReportRow[]]));
    for (const row of sourceRows) {
      const label = promotionPerformanceLabel(row, categories, fallbackLabel);
      if (!label) continue;
      const list = buckets.get(label) || [];
      list.push(row);
      buckets.set(label, list);
    }
    return buckets;
  };
  const totalBuckets = bucketRows(rows);
  const targetBuckets = bucketRows(targetRows);
  const previousBuckets = bucketRows(previousRows);

  return [...totalBuckets.entries()]
    .filter(([label, list]) => label !== fallbackLabel || list.length > 0 || (targetBuckets.get(label)?.length || 0) > 0)
    .map(([label, list]) => ({
      label,
      total: summarizeReportRows(`${label}-total`, label, list),
      target: summarizeReportRows(`${label}-target`, label, targetBuckets.get(label) || []),
      previous: summarizeReportRows(`${label}-previous`, label, previousBuckets.get(label) || []),
      targetStart,
      targetEnd
    }));
}

function promotionPerformanceLabel(
  row: NormalizedReportRow,
  categories: PromotionPerformanceCategory[],
  fallbackLabel?: string
): string | undefined {
  const category = categories.find(item => item.test(row));
  return category?.label || fallbackLabel;
}

function buildCampaignPerformanceRows(
  rows: NormalizedReportRow[],
  targetRows: NormalizedReportRow[],
  previousRows: NormalizedReportRow[],
  targetStart: string,
  targetEnd: string
): PromotionPerformanceRow[] {
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

  return top.map(([label, list]) => buildPromotionPerformanceRow(label, list, targetRows, previousRows, targetStart, targetEnd));
}

function buildPromotionPerformanceRow(
  label: string,
  rows: NormalizedReportRow[],
  targetRows: NormalizedReportRow[],
  previousRows: NormalizedReportRow[],
  targetStart: string,
  targetEnd: string
): PromotionPerformanceRow {
  const labels = new Set(rows.map(row => inferCampaignGroupLabel(row)));
  const targetGroupRows = targetRows.filter(row => labels.has(inferCampaignGroupLabel(row)));
  const previousGroupRows = previousRows.filter(row => labels.has(inferCampaignGroupLabel(row)));
  return {
    label,
    total: summarizeReportRows(`${label}-total`, label, rows),
    target: summarizeReportRows(`${label}-target`, label, targetGroupRows),
    previous: summarizeReportRows(`${label}-previous`, label, previousGroupRows),
    targetStart,
    targetEnd
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

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').trim();
}

function adIdentityText(row: NormalizedReportRow): string {
  return normalizeSearchText(`${row.campaignName} ${row.adgroupName} ${row.adName}`);
}

function adIdentityRawText(row: NormalizedReportRow): string {
  return `${row.campaignName} ${row.adgroupName} ${row.adName}`.toLowerCase();
}

function isExcludedAmazonRow(row: NormalizedReportRow): boolean {
  return adIdentityText(row).includes('amazon');
}

function isQoo10Row(row: NormalizedReportRow): boolean {
  const text = adIdentityText(row);
  const rawText = adIdentityRawText(row);
  return text.includes('qoo10') || rawText.includes('s-');
}

function matchesMarketplaceTab(row: NormalizedReportRow, tab: MarketplaceTab): boolean {
  const text = adIdentityText(row);
  if (tab === 'qoo10') return isQoo10Row(row);
  if (tab === 'owned') return !isQoo10Row(row) && text.includes('wish');
  return false;
}

function matchesPromotionSubTab(row: NormalizedReportRow, marketplace: MarketplaceTab, tab: PromotionSubTab): boolean {
  const text = adIdentityText(row);
  const promotionText = normalizeSearchText(row.promotion);

  if (marketplace === 'owned') {
    const isHybrid = text.includes('hybrid');
    if (tab === 'hybrid') return isHybrid;
    if (tab === 'always') return !isHybrid;
    return false;
  }

  const isMegawari = promotionText.includes('메가와리') || promotionText.includes('megawari') || promotionText.includes('mega wari');
  const isMegapo = promotionText.includes('메가포') || promotionText.includes('megapo') || promotionText.includes('mega po');
  if (tab === 'megawari') return isMegawari && !isMegapo;
  if (tab === 'megapo') return isMegapo && !isMegawari;
  if (tab === 'always') return !isMegawari && !isMegapo;
  return false;
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

function trendClass(value: number): string {
  return Number(value) >= 0 ? 'diff-up' : 'diff-down';
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
