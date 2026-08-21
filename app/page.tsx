'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, completeRedirectLogin, firebaseAuthErrorMessage, logout, signInWithGoogleSafe, userEmail } from '@/lib/firebase';
import {
  addAdmin, createBrand, createTab, deleteBrand, deleteFile, deleteTab, emptyKpi,
  findBrandByShareToken, getKpi, isAdminEmail, listAdmins, listBrandsForAdmin,
  listFiles, listInsights, listTabs, removeAdmin, renameTab, saveFile, saveInsight, saveNoteHistory,
  saveKpi, updateBrand
} from '@/lib/store';
import { parseAdFile, type ParseReport } from '@/lib/parser';
import { buildFileStats, mergeStats, totalStat } from '@/lib/aggregation';
import { applyBrandColor, randomBrandColor } from '@/lib/brandColor';
import { AD_PLATFORMS, AD_PLATFORM_LABELS, type AdPlatform, type Brand, type BrandPatch, type DashboardTab, type FileDoc, type InsightDoc, type Kpi, type MetricKey } from '@/lib/types';
import {
  applyFilters, countUnique, errorMessage, toggleSet,
  type DashboardBundle, type SortOrder
} from '@/lib/dashUtils';
import { AnimatedChip } from './components/AnimatedChip';
import { Empty } from './components/Empty';
import { KpiGrid } from './components/KpiGrid';
import { InsightSection } from './components/InsightSection';
import { DailyTrendSection } from './components/DailyTrendSection';
import { DailyDetailSection } from './components/DailyDetailSection';
import { CompareSection } from './components/CompareSection';
import { AdsetCompare } from './components/AdsetCompare';
import { Donut } from './components/Donut';
import { Scatter } from './components/Scatter';
import { CampaignTable } from './components/CampaignTable';
import { ParsePreview } from './components/ParsePreview';
import { SettingsModal, type SettingsMode } from './components/SettingsModal';
import { MetaFilterModal } from './components/MetaFilterModal';
import { PlatformSections, type PlatformBundle } from './components/PlatformSections';

const defaultVisibleMetrics: MetricKey[] = ['spend', 'impression', 'ctr'];

/** 표 머리글에 쓸 지표 열 이름만 추린다. (캠페인·광고그룹 같은 이름 열은 뺀다) */
const SOURCE_LABEL_KEYS = ['spend', 'impression', 'click', 'ctr', 'cpm', 'cpc', 'cpv', 'reach', 'landing'];

function pickSourceLabels(detected: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    SOURCE_LABEL_KEYS.filter(key => detected[key]).map(key => [key, detected[key]])
  );
}

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [tabs, setTabs] = useState<DashboardTab[]>([]);
  const [tab, setTab] = useState<DashboardTab | null>(null);
  const [files, setFiles] = useState<FileDoc[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [kpi, setKpi] = useState<Kpi>(emptyKpi);
  const [insights, setInsights] = useState<InsightDoc[]>([]);
  // 저장할 때마다 올려서 캘린더 이력을 다시 읽게 한다.
  const [insightHistoryKey, setInsightHistoryKey] = useState(0);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [adsetFilter, setAdsetFilter] = useState('');
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>(defaultVisibleMetrics);
  const [donutMetric, setDonutMetric] = useState<MetricKey>('spend');
  const [donutOrder, setDonutOrder] = useState<SortOrder>('desc');
  const [campaignMetric, setCampaignMetric] = useState<MetricKey>('ctr');
  const [adsetMetric, setAdsetMetric] = useState<MetricKey>('ctr');
  const [adsetSearch, setAdsetSearch] = useState('');
  const [activeAdsets, setActiveAdsets] = useState<Set<string>>(new Set());
  const [hoverAdset, setHoverAdset] = useState<string | null>(null);
  const [dailySort, setDailySort] = useState('dateAsc');
  const [detailSort, setDetailSort] = useState('spendDesc');
  const [campaignTableSort, setCampaignTableSort] = useState('spendDesc');
  const [openDaily, setOpenDaily] = useState(false);
  const [openDetail, setOpenDetail] = useState(false);
  const [openCampaignTable, setOpenCampaignTable] = useState(false);
  const [settings, setSettings] = useState<SettingsMode>('none');
  const [parseReport, setParseReport] = useState<ParseReport | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [authError, setAuthError] = useState('');
  const pdfRef = useRef<HTMLDivElement | null>(null);
  const tabCacheRef = useRef(new Map<string, { files: FileDoc[]; kpi: Kpi; insights: InsightDoc[] }>());
  const [metaImportOpen, setMetaImportOpen] = useState(false);

  useEffect(() => {
    applyBrandColor(brand?.color || null);
  }, [brand?.color]);

  const selectTab = useCallback(async (currentBrand: Brand | null, nextTab: DashboardTab | null, force = false) => {
    if (!currentBrand || !nextTab) {
      setTab(nextTab);
      setFiles([]);
      setSelectedFileIds(new Set());
      setInsights([]);
      setKpi(emptyKpi);
      return;
    }

    setTab(nextTab);
    const cacheKey = `${currentBrand.id}:${nextTab.id}`;
    const cached = !force ? tabCacheRef.current.get(cacheKey) : undefined;
    if (cached) {
      setFiles(cached.files);
      setSelectedFileIds(new Set(cached.files.map(file => file.id)));
      setKpi(cached.kpi);
      setInsights(cached.insights);
      const cachedDates = cached.files.flatMap(file => [file.dateStart, file.dateEnd]).filter(Boolean).sort();
      setPeriodStart(cachedDates[0] || '');
      setPeriodEnd(cachedDates[cachedDates.length - 1] || '');
      setCampaignFilter('');
      setAdsetFilter('');
      setActiveAdsets(new Set());
      return;
    }

    setBusy('탭 데이터를 불러오는 중...');
    try {
      const [loadedFiles, loadedKpi, loadedInsights] = await Promise.all([
        listFiles(currentBrand.id, nextTab.id),
        getKpi(currentBrand.id, nextTab.id),
        listInsights(currentBrand.id, nextTab.id)
      ]);
      tabCacheRef.current.set(cacheKey, { files: loadedFiles, kpi: loadedKpi, insights: loadedInsights });
      setFiles(loadedFiles);
      setSelectedFileIds(new Set(loadedFiles.map(file => file.id)));
      setKpi(loadedKpi);
      setInsights(loadedInsights);
      const dates = loadedFiles.flatMap(file => [file.dateStart, file.dateEnd]).filter(Boolean).sort();
      setPeriodStart(dates[0] || '');
      setPeriodEnd(dates[dates.length - 1] || '');
      setCampaignFilter('');
      setAdsetFilter('');
      setActiveAdsets(new Set());
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy('');
    }
  }, []);

  const selectBrand = useCallback(async (brandId: string) => {
    const target = brands.find(item => item.id === brandId) || null;
    setBrand(target);
    if (!target) {
      setTabs([]);
      await selectTab(null, null);
      return;
    }
    const loadedTabs = await listTabs(target.id);
    setTabs(loadedTabs);
    await selectTab(target, loadedTabs[0] || null);
  }, [brands, selectTab]);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    (async () => {
      // 1) redirect 결과를 먼저 완료 처리.
      //    에러가 있으면 상태에 저장해 UI에 표시한다.
      try {
        await completeRedirectLogin();
      } catch (err) {
        setAuthError(firebaseAuthErrorMessage(err));
      }

      // 2) redirect 처리가 끝난 뒤 구독 → 첫 발동 시 올바른 유저 상태 보장
      unsub = onAuthStateChanged(auth, async current => {
        try {
          setUser(current);
          const admin = current ? await isAdminEmail(current.email) : false;
          setIsAdmin(admin);
          const shareToken = new URL(window.location.href).searchParams.get('share');
          if (admin) {
            const list = await listBrandsForAdmin();
            setBrands(list);
            if (list.length && !brand) {
              setBrand(list[0]);
              const t = await listTabs(list[0].id);
              setTabs(t);
              await selectTab(list[0], t[0] || null);
            }
          } else if (shareToken) {
            const found = await findBrandByShareToken(shareToken);
            if (found) {
              setBrands([found]);
              setBrand(found);
              const t = await listTabs(found.id);
              setTabs(t);
              await selectTab(found, t[0] || null);
            }
          }
        } catch (err) {
          console.error('Auth callback error:', err);
          setAuthError(firebaseAuthErrorMessage(err));
        } finally {
          setLoading(false);
        }
      });
    })();

    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const merged = useMemo<DashboardBundle>(() => {
    const list = files.filter(file => selectedFileIds.has(file.id));
    return mergeStats(list);
  }, [files, selectedFileIds]);

  const filtered = useMemo(
    () => applyFilters(merged, periodStart, periodEnd, campaignFilter, adsetFilter),
    [merged, periodStart, periodEnd, campaignFilter, adsetFilter]
  );

  /** Meta·X·YouTube를 각각 따로 합쳐 매체별 섹션에 넘긴다. 위쪽 지표는 세 매체를 모두 합친 값이다. */
  const platformBundles = useMemo<PlatformBundle[]>(() => {
    const selected = files.filter(file => selectedFileIds.has(file.id));
    return AD_PLATFORMS.flatMap(platform => {
      const list = selected.filter(file => file.platform === platform);
      if (!list.length) return [];
      return [{
        platform,
        files: list,
        data: applyFilters(mergeStats(list), periodStart, periodEnd, campaignFilter, adsetFilter)
      }];
    });
  }, [files, selectedFileIds, periodStart, periodEnd, campaignFilter, adsetFilter]);

  const total = useMemo(() => totalStat(filtered.dailyStats.length ? filtered.dailyStats : filtered.detailStats), [filtered]);
  /** 이 탭에 올라온 매체 목록. Meta·X·YouTube를 섞어 올려도 각각 한 번에 켜고 끌 수 있게 한다. */
  const platformsInTab = useMemo(
    () => AD_PLATFORMS.filter(platform => files.some(file => file.platform === platform)),
    [files]
  );

  function isPlatformSelected(platform: AdPlatform): boolean {
    const list = files.filter(file => file.platform === platform);
    return list.length > 0 && list.every(file => selectedFileIds.has(file.id));
  }

  function togglePlatform(platform: AdPlatform) {
    const list = files.filter(file => file.platform === platform);
    const next = new Set(selectedFileIds);
    const turnOff = isPlatformSelected(platform);
    for (const file of list) turnOff ? next.delete(file.id) : next.add(file.id);
    setSelectedFileIds(next);
  }

  const campaigns = useMemo(() => Array.from(new Set(merged.detailStats.map(row => row.campaignName || '').filter(Boolean))).sort(), [merged]);
  const adsets = useMemo(() => Array.from(new Set(merged.detailStats.map(row => row.adsetName || '').filter(Boolean))).sort(), [merged]);

  useEffect(() => { if (!activeAdsets.size && adsets.length) setActiveAdsets(new Set(adsets.slice(0, 5))); }, [adsets, activeAdsets.size]);

  async function onUploadFile(file: File) {
    setBusy('파일을 분석 중입니다...');
    try {
      const report = await parseAdFile(file);
      setParseReport(report);
      setPendingFile(file);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function confirmUpload() {
    if (!brand || !tab || !parseReport || !pendingFile) return;
    setBusy('업로드 저장 중...');
    try {
      const stats = buildFileStats(parseReport.rows);
      const doc: Omit<FileDoc, 'id'> = {
        platform: parseReport.platform,
        sourceLabels: pickSourceLabels(parseReport.detected),
        filename: pendingFile.name,
        fileSize: pendingFile.size,
        createdAt: Date.now(),
        ...stats
      };
      await saveFile(brand.id, tab.id, doc);
      tabCacheRef.current.delete(`${brand.id}:${tab.id}`);
      await selectTab(brand, tab, true);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setParseReport(null);
      setPendingFile(null);
      setBusy('');
    }
  }

  async function refreshCurrentTab() {
    if (brand && tab) {
      tabCacheRef.current.delete(`${brand.id}:${tab.id}`);
      await selectTab(brand, tab, true);
    }
  }

  async function addBrandFlow() {
    const name = prompt('새 브랜드 이름을 입력하세요.');
    if (!name) return;
    try {
      const created = await createBrand(name, randomBrandColor());
      const list = await listBrandsForAdmin();
      setBrands(list);
      setBrand(created);
      const t = await listTabs(created.id);
      setTabs(t);
      await selectTab(created, t[0] || null);
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function addTabFlow() {
    if (!brand) return;
    const name = prompt('새 탭 이름을 입력하세요.');
    if (!name) return;
    try {
      const created = await createTab(brand.id, name);
      const loadedTabs = await listTabs(brand.id);
      setTabs(loadedTabs);
      await selectTab(brand, created);
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function renameTabFlow() {
    if (!brand || !tab) return;
    const name = prompt('새 탭 이름을 입력하세요.', tab.name);
    if (!name) return;
    try {
      await renameTab(brand.id, tab.id, name);
      const loadedTabs = await listTabs(brand.id);
      setTabs(loadedTabs);
      setTab({ ...tab, name });
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function deleteTabFlow() {
    if (!brand || !tab) return;
    const ok = prompt(`탭과 포함 파일을 삭제하려면 탭 이름 "${tab.name}"을 입력하세요.`);
    if (ok !== tab.name) return;
    try {
      await deleteTab(brand.id, tab.id);
      tabCacheRef.current.delete(`${brand.id}:${tab.id}`);
      const loadedTabs = await listTabs(brand.id);
      setTabs(loadedTabs);
      await selectTab(brand, loadedTabs[0] || null, true);
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function saveKpiFlow(next: Kpi) {
    if (!brand || !tab) return;
    await saveKpi(brand.id, tab.id, next);
    setKpi(next);
    tabCacheRef.current.delete(`${brand.id}:${tab.id}`);
    setSettings('none');
  }

  async function updateBrandFlow(brandId: string, patch: BrandPatch) {
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

  async function fetchFromMeta(adsetIds: string[], dateStart: string, dateEnd: string) {
    if (!brand || !tab || !user) return;
    setMetaImportOpen(false);
    setBusy('Meta API에서 데이터를 가져오는 중...');
    try {
      const token = await user.getIdToken();
      const resp = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brandId: brand.id, tabId: tab.id, adAccountId: brand.metaAdAccountId, dateStart, dateEnd, adsetIds })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Meta 가져오기 실패');
      tabCacheRef.current.delete(`${brand.id}:${tab.id}`);
      await selectTab(brand, tab, true);
      alert(`완료! ${data.rowCount}개 행, ${data.dateStart} ~ ${data.dateEnd}`);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function saveInsightText(text: string) {
    if (!brand || !tab) return;
    setBusy('인사이트 저장 중...');
    try {
      const insight: Omit<InsightDoc, 'id'> = {
        text: text.trim(),
        createdAt: Date.now(),
        fileIds: [...selectedFileIds],
        periodStart,
        periodEnd
      };
      await saveInsight(brand.id, tab.id, insight);
      await saveNoteHistory(brand.id, tab.id, 'insight', {
        text: insight.text,
        periodStart,
        periodEnd
      });
      const loadedInsights = await listInsights(brand.id, tab.id);
      setInsights(loadedInsights);
      setInsightHistoryKey(key => key + 1);
      tabCacheRef.current.delete(`${brand.id}:${tab.id}`);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function exportPdf() {
    if (!pdfRef.current) return;
    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');
    const canvas = await html2canvas(pdfRef.current, { scale: 1.4, backgroundColor: '#FAFAF7' });
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const width = pdf.internal.pageSize.getWidth();
    const height = canvas.height * (width / canvas.width);
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, width, height);
    pdf.save(`${brand?.name || 'gfu-dash'}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  if (loading) return <Empty message="데이터를 불러오는 중입니다." />;

  return (
    <div>
      <header className="header">
        <div className="header-left">
          <div className="header-logo">GFU<span>Dash</span></div>
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
          <a className="btn ghost" href="/report-lab">보고서</a>
          {isAdmin && <button className="btn ghost" onClick={() => setSettings('brand')}>설정</button>}
          {brand && <button className="btn ghost" onClick={() => navigator.clipboard.writeText(`${location.origin}?share=${brand.shareToken}`).then(() => alert('공유 링크를 복사했습니다.'))}>공유</button>}
          <button className="btn ghost" onClick={exportPdf}>PDF</button>
          {isAdmin && brand && tab && (
            <>
              <button className="btn outline" onClick={() => setMetaImportOpen(true)}>Meta 가져오기</button>
              <label className="btn brand">
                파일 추가
                <input hidden type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={event => event.target.files?.[0] && onUploadFile(event.target.files[0])} />
              </label>
            </>
          )}
        </div>
      </header>

      {!brand ? (
        <Empty
          message={isAdmin ? '아직 등록된 브랜드가 없습니다. 첫 브랜드를 추가하고 데이터를 업로드해보세요.' : '공유 링크로 접속하거나 관리자 로그인을 해주세요.'}
          action={isAdmin ? <button className="btn brand" onClick={addBrandFlow}>브랜드 추가</button> : null}
        />
      ) : (
        <main ref={pdfRef}>
          <div className="sub-header">
            <div className="sub-header-title">
              <div className="sub-header-eyebrow">성과 대시보드</div>
              <b>{brand.name}</b>
              <small>{isAdmin ? `관리자 · ${userEmail(user)}` : '클라이언트 보기'}</small>
            </div>
            <div className="period">
              <span>기간</span>
              <input type="date" value={periodStart} onChange={event => setPeriodStart(event.target.value)} />
              <span>~</span>
              <input type="date" value={periodEnd} onChange={event => setPeriodEnd(event.target.value)} />
            </div>
          </div>

          <div className="tabbar">
            {tabs.map(item => (
              <button key={item.id} className={item.id === tab?.id ? 'active' : ''} onClick={() => selectTab(brand, item)}>
                {item.name}
              </button>
            ))}
            {isAdmin && (
              <>
                <button onClick={addTabFlow}>+ 탭</button>
                <button onClick={renameTabFlow}>이름 변경</button>
                <button onClick={deleteTabFlow}>탭 삭제</button>
              </>
            )}
          </div>

          <div className="content">
            <div className="filter-bar">
              <span className="filter-label">파일</span>
              <button className="btn outline" onClick={() => setSelectedFileIds(new Set(files.map(file => file.id)))}>전체</button>
              <button className="btn outline" onClick={() => setSelectedFileIds(new Set())}>해제</button>
              {platformsInTab.length > 1 && (
                <>
                  <span className="filter-label" style={{ marginLeft: 8 }}>매체</span>
                  {platformsInTab.map(platform => (
                    <button
                      key={platform}
                      className={`btn ${isPlatformSelected(platform) ? 'brand' : 'outline'}`}
                      onClick={() => togglePlatform(platform)}
                    >
                      {AD_PLATFORM_LABELS[platform]}
                    </button>
                  ))}
                </>
              )}
              <span className="filter-label" style={{ marginLeft: 8 }}>필터</span>
              <select value={campaignFilter} onChange={event => setCampaignFilter(event.target.value)}>
                <option value="">캠페인 전체</option>
                {campaigns.map(name => <option key={name}>{name}</option>)}
              </select>
              <select value={adsetFilter} onChange={event => setAdsetFilter(event.target.value)}>
                <option value="">광고세트 전체</option>
                {adsets.map(name => <option key={name}>{name}</option>)}
              </select>
            </div>
            <div className="file-chips">
              {files.map(file => (
                <AnimatedChip
                  key={file.id}
                  label={`${AD_PLATFORM_LABELS[file.platform]} · ${file.filename}`}
                  active={selectedFileIds.has(file.id)}
                  onClick={() => setSelectedFileIds(toggleSet(selectedFileIds, file.id))}
                />
              ))}
            </div>

            <KpiGrid total={total} kpi={kpi} />
            <InsightSection insights={insights} isAdmin={isAdmin} busy={busy} brandId={brand.id} tabId={tab.id} historyKey={insightHistoryKey} onSave={saveInsightText} />
            <DailyTrendSection rows={filtered.dailyStats} activeMetrics={activeMetrics} setActiveMetrics={setActiveMetrics} dailySort={dailySort} setDailySort={setDailySort} openDaily={openDaily} setOpenDaily={setOpenDaily} />
            <DailyDetailSection rows={filtered.detailStats} sort={detailSort} setSort={setDetailSort} open={openDetail} setOpen={setOpenDetail} />
            {countUnique(filtered.campaignDailyStats.map(row => row.campaignName || '')) > 1 && <CompareSection title="캠페인별 비교" rows={filtered.campaignDailyStats} groupKey="campaignName" metric={campaignMetric} setMetric={setCampaignMetric} />}
            <AdsetCompare rows={filtered.adsetDailyStats} metric={adsetMetric} setMetric={setAdsetMetric} allAdsets={adsets} active={activeAdsets} setActive={setActiveAdsets} search={adsetSearch} setSearch={setAdsetSearch} hover={hoverAdset} setHover={setHoverAdset} />
            <div className="two-col">
              <Donut rows={filtered.adsetDailyStats} metric={donutMetric} setMetric={setDonutMetric} order={donutOrder} setOrder={setDonutOrder} />
              <Scatter rows={filtered.creativeStats} />
            </div>
            <CampaignTable rows={filtered.creativeStats} open={openCampaignTable} setOpen={setOpenCampaignTable} sort={campaignTableSort} setSort={setCampaignTableSort} />
            <PlatformSections bundles={platformBundles} />
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
      {metaImportOpen && brand && user && (
        <MetaFilterModal
          brand={brand}
          user={user}
          onClose={() => setMetaImportOpen(false)}
          onImport={fetchFromMeta}
        />
      )}
      {parseReport && <ParsePreview report={parseReport} file={pendingFile} onCancel={() => { setParseReport(null); setPendingFile(null); }} onConfirm={confirmUpload} />}
      {settings !== 'none' && brand && (
        <SettingsModal
          mode={settings}
          setMode={setSettings}
          brand={brand}
          tab={tab}
          brands={brands}
          tabs={tabs}
          kpi={kpi}
          saveKpi={saveKpiFlow}
          reload={refreshCurrentTab}
          addBrand={addBrandFlow}
          refreshBrands={async () => setBrands(await listBrandsForAdmin())}
          onUpdateBrand={updateBrandFlow}
        />
      )}
    </div>
  );
}
