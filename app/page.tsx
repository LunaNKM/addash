'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, completeRedirectLogin, logout, signInWithGoogleSafe, userEmail } from '@/lib/firebase';
import {
  addAdmin,
  createBrand,
  createTab,
  deleteBrand,
  deleteFile,
  deleteTab,
  emptyKpi,
  findBrandByShareToken,
  getKpi,
  isAdminEmail,
  listAdmins,
  listBrandsForAdmin,
  listFiles,
  listInsights,
  listTabs,
  removeAdmin,
  renameTab,
  saveFile,
  saveInsight,
  saveKpi,
  updateBrand
} from '@/lib/store';
import { parseMetaFile, type ParseReport } from '@/lib/parser';
import { buildFileStats, emptyStat, mergeStats, totalStat } from '@/lib/aggregation';
import { colorForIndex, formatDateWithDay, formatMetric, metricLabels } from '@/lib/format';
import { applyBrandColor, BRAND_PRESETS, randomBrandColor } from '@/lib/brandColor';
import type { Brand, DashboardTab, FileDoc, InsightDoc, Kpi, MetricKey, ParsedRow, StatRow } from '@/lib/types';

const metricKeys: MetricKey[] = ['spend', 'impression', 'click', 'landingPageView', 'ctr', 'cpm', 'cpc', 'roas'];
const defaultVisibleMetrics: MetricKey[] = ['spend', 'impression', 'ctr'];
type SortOrder = 'asc' | 'desc';
type SettingsMode = 'none' | 'brand' | 'tab' | 'kpi' | 'admin' | 'file';

type DashboardBundle = ReturnType<typeof mergeStats>;
type FilteredBundle = DashboardBundle;
type TableRow = StatRow | ParsedRow;

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
  const pdfRef = useRef<HTMLDivElement | null>(null);
  const tabCacheRef = useRef(new Map<string, { files: FileDoc[]; kpi: Kpi; insights: InsightDoc[] }>());
  const [metaImportOpen, setMetaImportOpen] = useState(false);
  const [metaDateStart, setMetaDateStart] = useState('');
  const [metaDateEnd, setMetaDateEnd] = useState('');

  // ── Inject brand color whenever active brand changes ───────
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
    completeRedirectLogin().catch(() => undefined);
    const unsub = onAuthStateChanged(auth, async current => {
      setUser(current);
      const admin = current ? await isAdminEmail(current.email) : false;
      setIsAdmin(admin);
      const url = new URL(window.location.href);
      const shareToken = url.searchParams.get('share');
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
      setLoading(false);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const merged = useMemo<DashboardBundle>(() => {
    const list = files.filter(file => selectedFileIds.has(file.id));
    return mergeStats(list);
  }, [files, selectedFileIds]);

  const filtered = useMemo<FilteredBundle>(
    () => applyFilters(merged, periodStart, periodEnd, campaignFilter, adsetFilter),
    [merged, periodStart, periodEnd, campaignFilter, adsetFilter]
  );

  const total = useMemo(() => totalStat(filtered.dailyStats.length ? filtered.dailyStats : filtered.detailStats), [filtered]);
  const campaigns = useMemo(() => Array.from(new Set(merged.detailStats.map(row => row.campaignName || '').filter(Boolean))).sort(), [merged]);
  const adsets = useMemo(() => Array.from(new Set(merged.detailStats.map(row => row.adsetName || '').filter(Boolean))).sort(), [merged]);

  useEffect(() => { if (!activeAdsets.size && adsets.length) setActiveAdsets(new Set(adsets.slice(0, 5))); }, [adsets, activeAdsets.size]);

  async function onUploadFile(file: File) {
    setBusy('파일을 분석 중입니다...');
    try {
      const report = await parseMetaFile(file);
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
      const updated = { ...tab, name };
      const loadedTabs = await listTabs(brand.id);
      setTabs(loadedTabs);
      setTab(updated);
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

  async function fetchFromMeta() {
    if (!brand || !tab || !user) return;
    if (!brand.metaAdAccountId) { alert('브랜드 설정에서 Meta Ad Account ID를 먼저 입력해주세요.'); return; }
    if (!metaDateStart || !metaDateEnd) { alert('가져올 기간을 선택해주세요.'); return; }
    setBusy('Meta API에서 데이터를 가져오는 중...');
    setMetaImportOpen(false);
    try {
      const token = await user.getIdToken();
      const resp = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brandId: brand.id, tabId: tab.id, adAccountId: brand.metaAdAccountId, dateStart: metaDateStart, dateEnd: metaDateEnd })
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

  async function generateInsight() {
    if (!brand || !tab || !user) return;
    setBusy('인사이트 생성 중...');
    try {
      const token = await user.getIdToken();
      const resp = await fetch('/api/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          brandName: brand.name,
          tabName: tab.name,
          total,
          adsets: topBy(filtered.adsetDailyStats, 'spend', 20),
          campaigns: topBy(filtered.campaignDailyStats, 'spend', 20),
          daily: filtered.dailyStats
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '인사이트 생성 실패');
      const insight: Omit<InsightDoc, 'id'> = { text: String(data.text || ''), createdAt: Date.now(), fileIds: [...selectedFileIds], periodStart, periodEnd };
      await saveInsight(brand.id, tab.id, insight);
      const loadedInsights = await listInsights(brand.id, tab.id);
      setInsights(loadedInsights);
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
            ? <button className="btn outline" onClick={signInWithGoogleSafe}>Google 로그인</button>
            : <button className="btn ghost" onClick={logout}>로그아웃</button>}
          {isAdmin && <button className="btn ghost" onClick={() => setSettings('brand')}>설정</button>}
          {brand && <button className="btn ghost" onClick={() => navigator.clipboard.writeText(`${location.origin}?share=${brand.shareToken}`).then(() => alert('공유 링크를 복사했습니다.'))}>공유</button>}
          <button className="btn ghost" onClick={exportPdf}>PDF</button>
          {isAdmin && brand && tab && (
            <>
              <button className="btn outline" onClick={() => setMetaImportOpen(true)}>Meta 가져오기</button>
              <label className="btn brand">
                파일 추가
                <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => event.target.files?.[0] && onUploadFile(event.target.files[0])} />
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
              <div className="sub-header-eyebrow">Performance Dashboard</div>
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
                  label={file.filename}
                  active={selectedFileIds.has(file.id)}
                  onClick={() => setSelectedFileIds(toggleSet(selectedFileIds, file.id))}
                />
              ))}
            </div>

            <KpiGrid total={total} kpi={kpi} />
            <InsightSection insights={insights} isAdmin={isAdmin} onGenerate={generateInsight} />
            <DailyTrendSection rows={filtered.dailyStats} activeMetrics={activeMetrics} setActiveMetrics={setActiveMetrics} dailySort={dailySort} setDailySort={setDailySort} openDaily={openDaily} setOpenDaily={setOpenDaily} />
            <DailyDetailSection rows={filtered.detailStats} sort={detailSort} setSort={setDetailSort} open={openDetail} setOpen={setOpenDetail} />
            {countUnique(filtered.campaignDailyStats.map(row => row.campaignName || '')) > 1 && <CompareSection title="캠페인별 비교" rows={filtered.campaignDailyStats} groupKey="campaignName" metric={campaignMetric} setMetric={setCampaignMetric} />}
            <AdsetCompare rows={filtered.adsetDailyStats} metric={adsetMetric} setMetric={setAdsetMetric} allAdsets={adsets} active={activeAdsets} setActive={setActiveAdsets} search={adsetSearch} setSearch={setAdsetSearch} hover={hoverAdset} setHover={setHoverAdset} />
            <div className="two-col">
              <Donut rows={filtered.adsetDailyStats} metric={donutMetric} setMetric={setDonutMetric} order={donutOrder} setOrder={setDonutOrder} />
              <Scatter rows={filtered.creativeStats} />
            </div>
            <CampaignTable rows={filtered.creativeStats} open={openCampaignTable} setOpen={setOpenCampaignTable} sort={campaignTableSort} setSort={setCampaignTableSort} />
          </div>
        </main>
      )}

      {busy && <div className="busy">{busy}</div>}
      {metaImportOpen && (
        <div className="modal">
          <div className="modal-card">
            <h3>Meta API로 데이터 가져오기</h3>
            {brand?.metaAdAccountId
              ? <p className="muted">Ad Account: act_{brand.metaAdAccountId}</p>
              : <p style={{ color: 'var(--c-warn)' }}>브랜드 설정 → Ad Account ID를 먼저 입력해주세요.</p>}
            <div className="kpi-edit" style={{ gap: 12 }}>
              <label>
                시작일
                <input type="date" value={metaDateStart} onChange={e => setMetaDateStart(e.target.value)} />
              </label>
              <label>
                종료일
                <input type="date" value={metaDateEnd} onChange={e => setMetaDateEnd(e.target.value)} />
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn outline" onClick={() => setMetaImportOpen(false)}>취소</button>
              <button className="btn brand" onClick={fetchFromMeta} disabled={!brand?.metaAdAccountId || !metaDateStart || !metaDateEnd}>가져오기</button>
            </div>
          </div>
        </div>
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


function Empty({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <section className="empty">
      <div className="card">
        <div className="icon">📊</div>
        <h1>GFU Dash</h1>
        <p>{message}</p>
        {action}
      </div>
    </section>
  );
}

function KpiGrid({ total, kpi }: { total: StatRow; kpi: Kpi }) {
  const goalMap: Record<MetricKey, keyof Kpi> = { spend: 'spendGoal', impression: 'impressionGoal', click: 'clickGoal', landingPageView: 'landingPageViewGoal', ctr: 'ctrGoal', cpm: 'cpmGoal', cpc: 'cpcGoal', roas: 'roasGoal' };
  const metricIcons: Record<MetricKey, string> = { spend: '₩', impression: '👁', click: '↗', landingPageView: '📄', ctr: '%', cpm: '📊', cpc: '🖱', roas: '×' };
  // 상단 5개, 하단 3개 — ROAS가 혼자 남지 않도록
  const topRow: MetricKey[] = ['spend', 'impression', 'click', 'landingPageView', 'ctr'];
  const bottomRow: MetricKey[] = ['cpm', 'cpc', 'roas'];

  const renderCard = (key: MetricKey, i: number) => {
    const value = metricValue(total, key);
    const goal = Number(kpi[goalMap[key]] || 0);
    const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
    return (
      <div className="kpi-card" key={key}>
        <div className="kpi-card-header">
          <small>{metricLabels[key]}</small>
          <span className="kpi-icon">{metricIcons[key]}</span>
        </div>
        <b>{formatMetric(key, value)}</b>
        {goal > 0 && (
          <>
            <div className="goal">
              <i style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--c-success)' : pct >= 70 ? 'var(--brand)' : 'var(--c-warn)' }} />
            </div>
            <em style={{ color: pct >= 100 ? 'var(--c-success)' : pct >= 70 ? 'var(--c-ink-2)' : 'var(--c-warn)' }}>
              {pct >= 100 ? '✓ ' : ''}{(value / goal * 100).toFixed(0)}% 달성
            </em>
          </>
        )}
        <div className="kpi-bar-track">
          <div className="kpi-bar-fill" style={{
            width: goal > 0 ? `${Math.min(pct, 100)}%` : '40%',
            background: `var(--chart-${(i % 8) + 1}, var(--brand))`,
            opacity: goal > 0 ? 1 : 0.25
          }} />
        </div>
      </div>
    );
  };

  return (
    <div className="kpi-grid-wrap">
      <div className="kpi-grid kpi-grid-top">
        {topRow.map((key, i) => renderCard(key, i))}
      </div>
      <div className="kpi-grid kpi-grid-bottom">
        {bottomRow.map((key, i) => renderCard(key, i + 5))}
      </div>
    </div>
  );
}

function InsightSection({ insights, isAdmin, onGenerate }: { insights: InsightDoc[]; isAdmin: boolean; onGenerate: () => void }) {
  const latest = insights[0];
  return (
    <section className="section">
      <div className="section-head">
        <b>AI 인사이트</b>
        {isAdmin && <button className="btn outline" onClick={onGenerate}>인사이트 생성</button>}
      </div>
      <div className="insight-box">
        {latest
          ? <div className="insight-content">{latest.text.split('\n').map((line, index) => <React.Fragment key={index}>{line}<br /></React.Fragment>)}</div>
          : <span className="muted">관리자가 생성한 인사이트가 여기에 표시됩니다.</span>}
      </div>
    </section>
  );
}

function DailyTrendSection({ rows, activeMetrics, setActiveMetrics, dailySort, setDailySort, openDaily, setOpenDaily }: { rows: StatRow[]; activeMetrics: MetricKey[]; setActiveMetrics: (v: MetricKey[]) => void; dailySort: string; setDailySort: (v: string) => void; openDaily: boolean; setOpenDaily: (v: boolean) => void }) {
  const sorted = sortRows(rows, dailySort);
  const [animKey, setAnimKey] = useState<Record<string, number>>({});

  const handleToggle = (key: MetricKey) => {
    setAnimKey(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
    setActiveMetrics(activeMetrics.includes(key)
      ? activeMetrics.filter(item => item !== key)
      : [...activeMetrics, key]);
  };

  return (
    <section className="section">
      <div className="section-head">
        <b>일별 추세</b>
        <select value={dailySort} onChange={event => setDailySort(event.target.value)}>
          {sortOptions(['date', 'spend', 'impression', 'ctr']).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="metric-toggles">
        {metricKeys.map(key => {
          const isActive = activeMetrics.includes(key);
          return (
            <button
              key={key}
              className={isActive ? 'active' : ''}
              data-anim-key={animKey[key] ?? 0}
              onClick={() => handleToggle(key)}
              style={{
                animationName: (animKey[key] ?? 0) > 0
                  ? (isActive ? 'toggle-activate' : 'deselect-shrink')
                  : 'none',
                animationDuration: '280ms',
                animationTimingFunction: 'cubic-bezier(0.34,1.56,0.64,1)',
                animationFillMode: 'both',
              }}
            >
              {metricLabels[key]}
            </button>
          );
        })}
      </div>
      <LineChart rows={rows} groupKey="date" metrics={activeMetrics} />
      <button className="collapse" onClick={() => setOpenDaily(!openDaily)}>{openDaily ? '일별 데이터 접기' : '일별 데이터 펼치기'}</button>
      {openDaily && <SimpleTable rows={sorted} columns={['date', 'spend', 'impression', 'click', 'landingPageView', 'ctr', 'cpm', 'cpc', 'roas']} withDiff />}
    </section>
  );
}

function DailyDetailSection({ rows, sort, setSort, open, setOpen }: { rows: StatRow[]; sort: string; setSort: (v: string) => void; open: boolean; setOpen: (v: boolean) => void }) {
  const sorted = sortDetailRows(rows, sort);
  const maxCtr = Math.max(0, ...sorted.map(row => row.ctr));
  return (
    <section className="section">
      <div className="section-head">
        <b>일자별 상세 데이터</b>
        <select value={sort} onChange={event => setSort(event.target.value)}>
          {sortOptions(['spend', 'impression', 'ctr', 'cpc']).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <button className="collapse" onClick={() => setOpen(!open)}>{open ? '일자별 상세 데이터 접기' : '일자별 상세 데이터 펼치기'}</button>
      {open && <DetailTable rows={sorted} maxCtr={maxCtr} />}
    </section>
  );
}

function CompareSection({ title, rows, groupKey, metric, setMetric }: { title: string; rows: StatRow[]; groupKey: keyof StatRow; metric: MetricKey; setMetric: (v: MetricKey) => void }) {
  return (
    <section className="section">
      <div className="section-head">
        <b>{title}</b>
        <select value={metric} onChange={event => setMetric(event.target.value as MetricKey)}>
          {metricKeys.map(key => <option key={key} value={key}>{metricLabels[key]}</option>)}
        </select>
      </div>
      <LineChart rows={rows} groupKey={groupKey} metric={metric} />
    </section>
  );
}

function AdsetCompare({ rows, metric, setMetric, allAdsets, active, setActive, search, setSearch, hover, setHover }: { rows: StatRow[]; metric: MetricKey; setMetric: (v: MetricKey) => void; allAdsets: string[]; active: Set<string>; setActive: (v: Set<string>) => void; search: string; setSearch: (v: string) => void; hover: string | null; setHover: (v: string | null) => void }) {
  const shown = allAdsets.filter(name => name.toLowerCase().includes(search.toLowerCase()));
  const selected = allAdsets.filter(name => active.has(name));
  const colorByAdset = useMemo(() => {
    const map: Record<string, string> = {};
    selected.forEach((name, index) => {
      map[name] = colorForIndex(index);
    });
    return map;
  }, [selected.join('\u0000')]);
  const PANEL_HEIGHT = 240;

  return (
    <section className="section">
      <div className="section-head">
        <b>광고세트별 비교</b>
        <select value={metric} onChange={event => setMetric(event.target.value as MetricKey)}>
          {metricKeys.map(key => <option key={key} value={key}>{metricLabels[key]}</option>)}
        </select>
      </div>
      <div className="compare-panels">
        {/* 왼쪽: 선택된 광고세트 범례 */}
        <div className="compare-panel">
          <div className="compare-panel-header">
            <span className="compare-panel-label">선택된 광고세트</span>
            <span className="compare-panel-count">{selected.length}개</span>
          </div>
          <div className="compare-panel-body" style={{ height: PANEL_HEIGHT }}>
            {selected.length ? selected.map((name, index) => (
              <div
                key={name}
                onMouseEnter={() => setHover(name)}
                onMouseLeave={() => setHover(null)}
                className={`compare-legend-row${hover && hover !== name ? ' dim' : ''}`}
              >
                <span className="compare-legend-dot" style={{ background: colorByAdset[name] || colorForIndex(index) }} />
                <span className="compare-legend-name">{name}</span>
              </div>
            )) : <span className="muted" style={{ padding: '10px 0', display: 'block' }}>선택된 광고세트가 없습니다.</span>}
          </div>
        </div>

        {/* 오른쪽: 광고세트 목록 */}
        <div className="compare-panel">
          <div className="compare-panel-header">
            <span className="compare-panel-label">광고세트 목록</span>
            <span style={{ display: 'flex', gap: 4 }}>
              <button className="mini" onClick={() => setActive(new Set(allAdsets))}>전체 선택</button>
              <button className="mini" onClick={() => setActive(new Set())}>전체 해제</button>
            </span>
          </div>
          <div className="compare-panel-body" style={{ height: PANEL_HEIGHT }}>
            <input
              className="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="광고세트 검색"
              style={{ width: '100%', marginBottom: 8 }}
            />
            <div className="compare-check-list">
              {shown.map(name => (
                <label
                  key={name}
                  className={`compare-check-row${hover && hover !== name ? ' dim' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={active.has(name)}
                    onChange={() => setActive(toggleSet(active, name))}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
      <LineChart
        rows={rows.filter(row => row.adsetName && active.has(row.adsetName))}
        groupKey="adsetName"
        metric={metric}
        highlight={hover}
        colorByName={colorByAdset}
        groupOrder={selected}
      />
    </section>
  );
}

function Donut({ rows, metric, setMetric, order, setOrder }: { rows: StatRow[]; metric: MetricKey; setMetric: (v: MetricKey) => void; order: SortOrder; setOrder: (v: SortOrder) => void }) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);

  const grouped = topBy(rows, metric, 50, 'adsetName', order).filter(row => metricValue(row, metric) > 0);
  const totalVal = grouped.reduce((sum, row) => sum + metricValue(row, metric), 0) || 1;

  const CX = 90, CY = 90, R = 68, SW = 16;
  let accAngle = -Math.PI / 2;
  let accFraction = 0;

  const arcs = grouped.map((row, index) => {
    const raw = metricValue(row, metric);
    const frac = raw / totalVal;
    const angle = frac * 2 * Math.PI;
    const startAngle = accAngle;
    const endAngle = accAngle + angle;
    const startFraction = accFraction;
    const endFraction = accFraction + frac;
    accAngle = endAngle;
    accFraction = endFraction;
    const gap = grouped.length > 1 ? 0.02 : 0;
    const sa = startAngle + gap;
    const ea = endAngle - gap;
    const validArc = ea > sa + 0.01;
    const x1 = CX + R * Math.cos(sa);
    const y1 = CY + R * Math.sin(sa);
    const x2 = CX + R * Math.cos(ea);
    const y2 = CY + R * Math.sin(ea);
    const largeArc = ea - sa > Math.PI ? 1 : 0;
    return { row, index, color: colorForIndex(index), x1, y1, x2, y2, largeArc, frac, raw, validArc, startFraction, endFraction };
  });

  const hovered = hoverKey ? (arcs.find(a => a.row.key === hoverKey) ?? null) : null;

  function tooltipLinesFor(arc: (typeof arcs)[number]) {
    return [
      String(arc.row.adsetName || arc.row.key),
      `${metricLabels[metric]}: ${formatMetric(metric, arc.raw)}`,
      `비중: ${(arc.frac * 100).toFixed(1)}%`
    ];
  }

  function arcFromPointer(event: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || !arcs.length) return null;
    const rect = svg.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) / rect.width) * 180;
    const sy = ((event.clientY - rect.top) / rect.height) * 180;
    const dx = sx - CX;
    const dy = sy - CY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Use a wide annulus hit-area so hover never depends on the visible stroke only.
    if (dist < R - SW * 1.6 || dist > R + SW * 1.6) return null;
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    const fraction = angle / (Math.PI * 2);
    return arcs.find(arc => fraction >= arc.startFraction && fraction <= arc.endFraction) || arcs[arcs.length - 1] || null;
  }

  return (
    <section className="section">
      <div className="section-head">
        <b>광고세트 비중</b>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)}>
            {metricKeys.map(key => <option key={key} value={key}>{metricLabels[key]}</option>)}
          </select>
          <select value={order} onChange={e => setOrder(e.target.value as SortOrder)}>
            <option value="desc">높은 순</option>
            <option value="asc">낮은 순</option>
          </select>
        </div>
      </div>
      <div className="donut-wrap">
        <div className="donut-chart-box">
          {tooltip && (
            <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
              {tooltip.lines.map((line, i) => (
                <div key={i} style={{ fontWeight: i === 0 ? 600 : 400, opacity: i === 0 ? 1 : 0.78 }}>{line}</div>
              ))}
            </div>
          )}
          <svg
            ref={svgRef}
            viewBox="0 0 180 180"
            className="donut-svg"
            onMouseMove={event => {
              const arc = arcFromPointer(event);
              if (!arc) {
                setHoverKey(null);
                setTooltip(null);
                return;
              }
              setHoverKey(arc.row.key);
              setTooltip({ x: event.clientX + 14, y: event.clientY - 10, lines: tooltipLinesFor(arc) });
            }}
            onMouseLeave={() => { setHoverKey(null); setTooltip(null); }}
          >
            <defs>
              <filter id="donut-hover-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--c-bg-sunken)" strokeWidth={SW} />
            {arcs.map(arc => {
              if (!arc.validArc) return null;
              const isDim = hoverKey && hoverKey !== arc.row.key;
              const isHov = hoverKey === arc.row.key;
              return (
                <path
                  key={arc.row.key}
                  className="donut-slice"
                  d={`M ${arc.x1} ${arc.y1} A ${R} ${R} 0 ${arc.largeArc} 1 ${arc.x2} ${arc.y2}`}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={isHov ? SW + 5 : SW}
                  strokeLinecap="round"
                  opacity={isDim ? 0.16 : 1}
                  style={{
                    transition:
                      'stroke-width 200ms cubic-bezier(0.34,1.56,0.64,1), ' +
                      'opacity 200ms cubic-bezier(0.2,0,0,1)',
                    pointerEvents: 'none',
                  }}
                  filter={isHov ? 'url(#donut-hover-glow)' : undefined}
                />
              );
            })}
            <text x={CX} y={CY - 6} textAnchor="middle"
              style={{ fontSize: 8, fill: 'var(--c-ink-3)', fontFamily: 'var(--font-body)', fontWeight: 600, letterSpacing: '0.06em' }}>
              {metricLabels[metric]}
            </text>
            <text x={CX} y={CY + 12} textAnchor="middle"
              style={{ fontSize: 14, fill: 'var(--c-ink)', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {hovered ? formatMetric(metric, hovered.raw) : formatMetric(metric, totalVal)}
            </text>
            {hovered && (
              <text x={CX} y={CY + 28} textAnchor="middle"
                style={{ fontSize: 10, fill: 'var(--brand)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {(hovered.frac * 100).toFixed(1)}%
              </text>
            )}
          </svg>
        </div>
        <div className="donut-legend">
          {grouped.map((row, index) => {
            const raw = metricValue(row, metric);
            const pct = raw / totalVal * 100;
            const isDim = hoverKey && hoverKey !== row.key;
            return (
              <div key={row.key} className={`donut-legend-row${isDim ? ' dim' : ''}`}
                onMouseEnter={event => {
                  const arc = arcs.find(a => a.row.key === row.key);
                  setHoverKey(row.key);
                  if (arc) setTooltip({ x: event.clientX + 14, y: event.clientY - 10, lines: tooltipLinesFor(arc) });
                }}
                onMouseMove={event => setTooltip(prev => prev ? { ...prev, x: event.clientX + 14, y: event.clientY - 10 } : prev)}
                onMouseLeave={() => { setHoverKey(null); setTooltip(null); }}>
                <span className="donut-legend-dot" style={{ background: colorForIndex(index) }} />
                <span className="donut-legend-name">{row.adsetName || row.key}</span>
                <b className="donut-legend-val">{formatMetric(metric, raw)}</b>
                <span className="donut-legend-pct">{pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Scatter({ rows }: { rows: StatRow[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const list = rows.slice().sort((a, b) => b.spend - a.spend).slice(0, 80);

  // 데이터 범위에 20% 패딩 추가 → 버블이 극단에 몰리지 않음
  const rawMaxX = Math.max(1, ...list.map(row => row.cpc));
  const rawMaxY = Math.max(1, ...list.map(row => row.ctr));
  const maxX = rawMaxX * 1.25;
  const maxY = rawMaxY * 1.25;
  const maxSpend = Math.max(1, ...list.map(row => row.spend));
  const left = 58;
  const right = 20;
  const top = 20;
  const bottom = 40;
  const width = 500;
  const height = 280;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const xAt = (value: number) => left + (value / maxX) * chartWidth;
  const yAt = (value: number) => top + chartHeight - (value / maxY) * chartHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const midX = xAt(maxX * 0.5);
  const midY = yAt(maxY * 0.5);

  return (
    <section className="section">
      <div className="section-head">
        <b>소재 포지셔닝</b>
        <span className="muted">X = CPC · Y = CTR · 크기 = 광고비</span>
      </div>
      <div style={{ position: 'relative' }} onMouseLeave={() => setTooltip(null)}>
        {tooltip && (
          <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            {tooltip.lines.map((line, i) => <div key={i} style={{ opacity: i === 0 ? 1 : 0.75, fontWeight: i === 0 ? 600 : 400 }}>{line}</div>)}
          </div>
        )}
        <svg className="scatter" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="소재 포지셔닝 차트">
          <defs>
            <clipPath id="scatter-clip">
              <rect x={left} y={top} width={chartWidth} height={chartHeight} />
            </clipPath>
            <linearGradient id="quad-tl" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="quad-tr" x1="1" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="quad-bl" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#6366F1" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#6366F1" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="quad-br" x1="1" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#EF4444" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#EF4444" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          <g clipPath="url(#scatter-clip)">
            <rect x={left} y={top} width={midX - left} height={midY - top} fill="url(#quad-tl)" />
            <rect x={midX} y={top} width={left + chartWidth - midX} height={midY - top} fill="url(#quad-tr)" />
            <rect x={left} y={midY} width={midX - left} height={top + chartHeight - midY} fill="url(#quad-bl)" />
            <rect x={midX} y={midY} width={left + chartWidth - midX} height={top + chartHeight - midY} fill="url(#quad-br)" />
          </g>

          {ticks.map(rate => {
            const yValue = Math.round(maxY * rate * 100) / 100;
            const y = yAt(yValue);
            const xValue = Math.round(maxX * rate);
            const x = xAt(xValue);
            return (
              <g key={rate}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth={1} strokeDasharray="4 4" shapeRendering="crispEdges" />
                <text x={left - 8} y={y + 4} textAnchor="end" className="chart-tick">{formatMetric('ctr', yValue)}</text>
                <line x1={x} x2={x} y1={top} y2={top + chartHeight} stroke="var(--chart-grid)" strokeWidth={1} strokeDasharray="4 4" shapeRendering="crispEdges" />
                <text x={x} y={height - 8} textAnchor="middle" className="chart-tick">{formatMetric('cpc', xValue)}</text>
              </g>
            );
          })}

          <line x1={midX} x2={midX} y1={top} y2={top + chartHeight} stroke="var(--chart-axis)" strokeWidth={1} strokeDasharray="6 3" opacity={0.5} />
          <line x1={left} x2={left + chartWidth} y1={midY} y2={midY} stroke="var(--chart-axis)" strokeWidth={1} strokeDasharray="6 3" opacity={0.5} />

          <text x={left + 6} y={top + 14} style={{ fontSize: 8, fill: '#10B981', fontFamily: 'var(--font-body)', fontWeight: 700, opacity: 0.7 }}>저CPC · 고CTR</text>
          <text x={midX + 4} y={top + 14} style={{ fontSize: 8, fill: '#F59E0B', fontFamily: 'var(--font-body)', fontWeight: 700, opacity: 0.7 }}>고CPC · 고CTR</text>
          <text x={left + 6} y={top + chartHeight - 6} style={{ fontSize: 8, fill: '#6366F1', fontFamily: 'var(--font-body)', fontWeight: 700, opacity: 0.7 }}>저CPC · 저CTR</text>
          <text x={midX + 4} y={top + chartHeight - 6} style={{ fontSize: 8, fill: '#EF4444', fontFamily: 'var(--font-body)', fontWeight: 700, opacity: 0.7 }}>고CPC · 저CTR</text>

          <line x1={left} x2={left} y1={top} y2={top + chartHeight} stroke="var(--chart-axis)" strokeWidth={1} shapeRendering="crispEdges" />
          <line x1={left} x2={width - right} y1={top + chartHeight} y2={top + chartHeight} stroke="var(--chart-axis)" strokeWidth={1} shapeRendering="crispEdges" />

          {list.map((row, index) => {
            const r = 4 + (row.spend / maxSpend) * 10;
            const cx = xAt(row.cpc);
            const cy = yAt(row.ctr);
            const tooltipLines = [
              row.adName || row.key,
              `CPC: ${formatMetric('cpc', row.cpc)}  CTR: ${formatMetric('ctr', row.ctr)}`,
              `광고비: ${formatMetric('spend', row.spend)}`
            ];
            return (
              <g key={row.key} clipPath="url(#scatter-clip)"
                style={{ transition: 'opacity 180ms cubic-bezier(0.2,0,0,1)' }}>
                {row.spend / maxSpend > 0.5 && (
                  <circle cx={cx} cy={cy} r={r + 4} fill={colorForIndex(index)} fillOpacity={0.12}
                    style={{ transition: 'r 200ms cubic-bezier(0.34,1.56,0.64,1)' }} />
                )}
                <circle
                  cx={cx} cy={cy} r={r}
                  fill={colorForIndex(index)}
                  fillOpacity={0.82}
                  stroke="var(--c-bg-elevated)"
                  strokeWidth={1.5}
                  className="scatter-bubble"
                  style={{
                    cursor: 'pointer',
                    transition:
                      'r 200ms cubic-bezier(0.34,1.56,0.64,1), ' +
                      'fill-opacity 180ms ease, ' +
                      'filter 180ms ease',
                  }}
                  onMouseEnter={e => {
                    setTooltip({
                      x: e.clientX + 14,
                      y: e.clientY - 10,
                      lines: tooltipLines
                    });
                  }}
                  onMouseMove={e => {
                    setTooltip(prev => prev ? { ...prev, x: e.clientX + 14, y: e.clientY - 10 } : null);
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function CampaignTable({ rows, open, setOpen, sort, setSort }: { rows: StatRow[]; open: boolean; setOpen: (v: boolean) => void; sort: string; setSort: (v: string) => void }) {
  const sorted = sortRows(rows, sort).slice(0, 300);
  return (
    <section className="section">
      <div className="section-head">
        <b>캠페인별 데이터</b>
        <select value={sort} onChange={event => setSort(event.target.value)}>
          {sortOptions(['spend', 'impression', 'ctr']).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <button className="collapse" onClick={() => setOpen(!open)}>{open ? '캠페인별 데이터 접기' : '캠페인별 데이터 펼치기'}</button>
      {open && <SimpleTable rows={sorted} columns={['campaignAdsetAd', 'spend', 'impression', 'click', 'landingPageView', 'ctr', 'cpm', 'cpc', 'roas']} />}
    </section>
  );
}

function SimpleTable({ rows, columns, withDiff = false }: { rows: TableRow[]; columns: string[]; withDiff?: boolean }) {
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

function DetailTable({ rows, maxCtr }: { rows: StatRow[]; maxCtr: number }) {
  const byDate = new Map<string, StatRow[]>();
  for (const row of rows) {
    const date = row.date || '날짜 없음';
    byDate.set(date, [...(byDate.get(date) || []), row]);
  }
  return (
    <div className="table-wrap sticky-detail">
      <table>
        <thead>
          <tr>
            <th>날짜</th>
            <th>캠페인 / 광고세트</th>
            <th>광고비</th>
            <th>노출</th>
            <th>링크클릭</th>
            <th>LP 조회</th>
            <th>CPM</th>
            <th>CPC</th>
            <th>CTR</th>
            <th>ROAS</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(byDate.entries()).flatMap(([date, dateRows], groupIndex) =>
            dateRows.map((row, index) => (
              <tr key={`${date}-${row.key}`} className={index === 0 && groupIndex > 0 ? 'detail-date-separator' : undefined}>
                {index === 0 && <td className="date-cell" rowSpan={dateRows.length}>{formatDateWithDay(date)}</td>}
                <td className="detail-name-cell">{row.campaignName || ''} / {row.adsetName || ''}</td>
                <td>{formatMetric('spend', row.spend)}</td>
                <td>{formatMetric('impression', row.impression)}</td>
                <td>{formatMetric('click', row.click)}</td>
                <td>{formatMetric('landingPageView', row.landingPageView)}</td>
                <td style={{ background: cpmColor(row.cpm) }} title={`CPM ${formatMetric('cpm', row.cpm)}\n1,000 미만은 낮을수록 진하게 표시됩니다.`}>{formatMetric('cpm', row.cpm)}</td>
                <td>{formatMetric('cpc', row.cpc)}</td>
                <td style={{ background: ctrColor(row.ctr, maxCtr) }} title={`CTR ${formatMetric('ctr', row.ctr)}\n높을수록 진하게 표시됩니다.`}>{formatMetric('ctr', row.ctr)}</td>
                <td>{formatMetric('roas', row.roas)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function cell(row: TableRow, column: string) {
  if (column === 'date') return formatDateWithDay(row.date || '');
  if (column === 'campaignAdsetAd') return `${row.campaignName || ''} / ${row.adsetName || ''} / ${row.adName || ''}`;
  if (metricKeys.includes(column as MetricKey)) return formatMetric(column as MetricKey, metricValue(asStatRow(row), column as MetricKey));
  return String((row as Record<string, unknown>)[column] || '');
}

function tableRowKey(row: TableRow, index: number) {
  if ('key' in row && row.key) return row.key;
  return [row.date, row.campaignName, row.adsetName, row.adName, index].filter(Boolean).join('|') || String(index);
}

function asStatRow(row: TableRow | undefined): StatRow | undefined {
  if (!row) return undefined;
  if ('key' in row && row.key) return row;
  return {
    key: tableRowKey(row, 0),
    date: row.date,
    campaignName: row.campaignName,
    adsetName: row.adsetName,
    adName: row.adName,
    spend: Number(row.spend || 0),
    impression: Number(row.impression || 0),
    click: Number(row.click || 0),
    landingPageView: Number(row.landingPageView || 0),
    ctr: Number(row.ctr || 0),
    cpm: Number(row.cpm || 0),
    cpc: Number(row.cpc || 0),
    roas: Number(row.roas || 0)
  };
}

function labelForColumn(column: string) {
  const map: Record<string, string> = { date: '날짜', campaignAdsetAd: '캠페인 / 광고세트 / 소재' };
  return map[column] || metricLabels[column as MetricKey] || column;
}

function ParsePreview({ report, file, onCancel, onConfirm }: { report: ParseReport; file: File | null; onCancel: () => void; onConfirm: () => void }) {
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

function SettingsModal({ mode, setMode, brand, tab, brands, tabs, kpi, saveKpi: onSaveKpi, reload, addBrand, refreshBrands, onUpdateBrand }: {
  mode: SettingsMode;
  setMode: (v: SettingsMode) => void;
  brand: Brand;
  tab: DashboardTab | null;
  brands: Brand[];
  tabs: DashboardTab[];
  kpi: Kpi;
  saveKpi: (k: Kpi) => Promise<void>;
  reload: () => Promise<void>;
  addBrand: () => Promise<void>;
  refreshBrands: () => Promise<void>;
  onUpdateBrand: (brandId: string, patch: { name?: string; color?: string; metaAdAccountId?: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Kpi>(kpi);
  const [admins, setAdmins] = useState<Array<{ email: string; primary?: boolean }>>([]);
  useEffect(() => { setDraft(kpi); }, [kpi]);
  useEffect(() => { if (mode === 'admin') listAdmins().then(items => setAdmins(items as Array<{ email: string; primary?: boolean }>)); }, [mode]);

  return (
    <div className="modal">
      <div className="modal-card">
        <h3>설정</h3>
        <span className="muted">현재 브랜드 · {brand.name}</span>
        <div className="settings-nav">
          <button className={mode === 'brand' ? 'active' : ''} onClick={() => setMode('brand')}>브랜드</button>
          <button className={mode === 'tab' ? 'active' : ''} onClick={() => setMode('tab')}>탭</button>
          <button className={mode === 'kpi' ? 'active' : ''} onClick={() => setMode('kpi')}>KPI</button>
          <button className={mode === 'admin' ? 'active' : ''} onClick={() => setMode('admin')}>관리자</button>
          <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>파일</button>
        </div>

        {mode === 'brand' && (
          <div>
            <button className="btn brand" onClick={addBrand} style={{ marginBottom: 12 }}>브랜드 추가</button>
            {brands.map(item => (
              <BrandEditorRow
                key={item.id}
                brand={item}
                onCopyShare={() => navigator.clipboard.writeText(`${location.origin}?share=${item.shareToken}`).then(() => alert('공유 링크를 복사했습니다.'))}
                onDelete={async () => {
                  if (prompt(`삭제하려면 ${item.name} 입력`) === item.name) {
                    await deleteBrand(item.id);
                    await refreshBrands();
                  }
                }}
                onUpdate={patch => onUpdateBrand(item.id, patch)}
              />
            ))}
          </div>
        )}

        {mode === 'tab' && (
          <div>{tabs.map(item => <div className="item" key={item.id}><b>{item.name}</b></div>)}</div>
        )}

        {mode === 'kpi' && (
          <div className="kpi-edit">
            {(Object.keys(draft) as Array<keyof Kpi>).map(key => (
              <label key={key}>
                {kpiLabel(key)}
                <input type="number" value={draft[key]} onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })} />
              </label>
            ))}
            <button className="btn brand" onClick={() => onSaveKpi(draft)}>저장</button>
          </div>
        )}

        {mode === 'admin' && (
          <div>
            <button className="btn brand" onClick={async () => {
              const email = prompt('관리자 이메일');
              if (email) {
                await addAdmin(email);
                setAdmins(await listAdmins() as Array<{ email: string; primary?: boolean }>);
              }
            }} style={{ marginBottom: 12 }}>관리자 추가</button>
            {admins.map(item => (
              <div className="item" key={item.email}>
                <b>{item.email}{item.primary && <span className="badge" style={{ marginLeft: 8 }}>Primary</span>}</b>
                {!item.primary && (
                  <button onClick={async () => {
                    await removeAdmin(item.email);
                    setAdmins(await listAdmins() as Array<{ email: string; primary?: boolean }>);
                  }}>삭제</button>
                )}
              </div>
            ))}
          </div>
        )}

        {mode === 'file' && tab && <FileSettings brand={brand} tab={tab} reload={reload} />}

        <div className="modal-actions">
          <button className="btn outline" onClick={() => setMode('none')}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function BrandEditorRow({ brand, onCopyShare, onDelete, onUpdate }: {
  brand: Brand;
  onCopyShare: () => void;
  onDelete: () => Promise<void>;
  onUpdate: (patch: { name?: string; color?: string; metaAdAccountId?: string }) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(brand.name);
  const [color, setColor] = useState(brand.color);
  const [adAccountId, setAdAccountId] = useState(brand.metaAdAccountId || '');
  useEffect(() => { setName(brand.name); setColor(brand.color); setAdAccountId(brand.metaAdAccountId || ''); }, [brand.name, brand.color, brand.metaAdAccountId]);

  const dirty = name !== brand.name || color.toLowerCase() !== brand.color.toLowerCase() || adAccountId !== (brand.metaAdAccountId || '');

  return (
    <div style={{ marginBottom: 10 }}>
      <div className="item">
        <b>
          <span className="item-brand-dot" style={{ background: brand.color }} />
          {brand.name}
        </b>
        <div className="item-actions">
          <button onClick={() => setExpanded(!expanded)}>{expanded ? '접기' : '편집'}</button>
          <button onClick={onCopyShare}>공유</button>
          <button onClick={onDelete}>삭제</button>
        </div>
      </div>

      {expanded && (
        <div className="brand-editor">
          <div className="brand-editor-row">
            <div>
              <label>브랜드명</label>
              <input type="text" value={name} onChange={event => setName(event.target.value)} />
            </div>
            <div>
              <label>Meta Ad Account ID</label>
              <input type="text" value={adAccountId} onChange={event => setAdAccountId(event.target.value)} placeholder="숫자 또는 act_숫자" />
            </div>
            <div>
              <label>브랜드 컬러 (HEX)</label>
              <div className="color-input-group">
                <input
                  type="color"
                  className="color-input-swatch"
                  value={color}
                  onChange={event => setColor(event.target.value)}
                />
                <input
                  type="text"
                  className="color-input-hex"
                  value={color}
                  onChange={event => setColor(event.target.value)}
                  placeholder="#RRGGBB"
                />
              </div>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-ink-3)', marginBottom: 8 }}>
              프리셋
            </label>
            <div className="color-presets">
              {BRAND_PRESETS.map(preset => (
                <button
                  key={preset.hex}
                  type="button"
                  title={preset.name}
                  className={`color-preset ${color.toLowerCase() === preset.hex.toLowerCase() ? 'active' : ''}`}
                  style={{ background: preset.hex }}
                  onClick={() => setColor(preset.hex)}
                />
              ))}
            </div>
          </div>

          <div className="brand-preview-mini">
            <div
              className="brand-preview-mini-bar"
              style={{
                background: `linear-gradient(135deg, ${color} 0%, ${darken(color, 20)} 100%)`
              }}
            />
            <div className="brand-preview-mini-text">서브 헤더 미리보기</div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn outline" onClick={() => { setName(brand.name); setColor(brand.color); }}>되돌리기</button>
            <button
              className="btn brand"
              disabled={!dirty}
              onClick={async () => {
                await onUpdate({
                  ...(name !== brand.name ? { name } : {}),
                  ...(color.toLowerCase() !== brand.color.toLowerCase() ? { color } : {}),
                  ...(adAccountId !== (brand.metaAdAccountId || '') ? { metaAdAccountId: adAccountId } : {})
                });
                setExpanded(false);
              }}
            >
              변경사항 저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Small helper to darken a hex color for the preview bar (no JS dependencies)
function darken(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return hex;
  const r = Math.max(0, parseInt(value.slice(0, 2), 16) - amount);
  const g = Math.max(0, parseInt(value.slice(2, 4), 16) - amount);
  const b = Math.max(0, parseInt(value.slice(4, 6), 16) - amount);
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}

function FileSettings({ brand, tab, reload }: { brand: Brand; tab: DashboardTab; reload: () => Promise<void> }) {
  const [tabFiles, setTabFiles] = useState<FileDoc[]>([]);
  useEffect(() => { listFiles(brand.id, tab.id).then(setTabFiles); }, [brand.id, tab.id]);
  return (
    <div>
      {tabFiles.map(file => (
        <div className="item" key={file.id}>
          <b style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{file.filename}</b>
          <button onClick={async () => {
            if (confirm('삭제할까요?')) {
              await deleteFile(brand.id, tab.id, file.id);
              await reload();
              setTabFiles(await listFiles(brand.id, tab.id));
            }
          }}>삭제</button>
        </div>
      ))}
    </div>
  );
}

function kpiLabel(key: keyof Kpi): string {
  const map: Record<keyof Kpi, string> = {
    spendGoal: '광고비 목표',
    impressionGoal: '노출 목표',
    clickGoal: '클릭 목표',
    landingPageViewGoal: 'LP 조회 목표',
    ctrGoal: 'CTR 목표',
    cpmGoal: 'CPM 목표',
    cpcGoal: 'CPC 목표',
    roasGoal: 'ROAS 목표'
  };
  return map[key];
}

function shortDate(date?: string) {
  if (!date) return '';
  const [, month, day] = String(date).split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : String(date);
}

function LineChart({ rows, groupKey, metrics, metric, highlight, colorByName, groupOrder }: { rows: StatRow[]; groupKey: keyof StatRow | 'date'; metrics?: MetricKey[]; metric?: MetricKey; highlight?: string | null; colorByName?: Record<string, string>; groupOrder?: string[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const dates = Array.from(new Set(rows.map(row => row.date).filter(isString))).sort();
  const groupNames = groupKey === 'date'
    ? []
    : (groupOrder?.length
        ? groupOrder.filter(name => rows.some(row => String(row[groupKey] || '') === name))
        : Array.from(new Set(rows.map(row => String(row[groupKey] || '')).filter(Boolean))));
  const groups = groupKey === 'date'
    ? (metrics || []).map(key => ({ name: metricLabels[key], key, color: colorForIndex(metricKeys.indexOf(key)), data: dates.map(date => metricValue(rows.find(row => row.date === date) || emptyStat(date), key)) }))
    : groupNames.map((groupName, index) => ({ name: groupName, key: groupName, color: colorByName?.[groupName] || colorForIndex(index), data: dates.map(date => metricValue(rows.find(row => row.date === date && String(row[groupKey] || '') === groupName) || emptyStat(date), metric || 'spend')) }));

  const max = Math.max(1, ...groups.flatMap(group => group.data));
  if (!dates.length || !groups.length) return <div className="chart-empty">표시할 데이터가 없습니다.</div>;

  const left = 64;
  const right = 20;
  const top = 20;
  const bottom = 44;
  const width = 800;
  const height = 300;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const xAt = (index: number) => left + (index / Math.max(dates.length - 1, 1)) * chartWidth;
  const yAt = (value: number) => top + chartHeight - (value / max) * chartHeight;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(rate => Math.round(max * rate * 100) / 100);
  const xTickIndexes = dates.length <= 6
    ? dates.map((_, index) => index)
    : Array.from(new Set([0, Math.floor((dates.length - 1) * 0.25), Math.floor((dates.length - 1) * 0.5), Math.floor((dates.length - 1) * 0.75), dates.length - 1]));
  const activeMetric = metric || metrics?.[0] || 'spend';

  function smoothPath(pts: [number, number][]): string {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cp1x = prev[0] + (curr[0] - prev[0]) * 0.45;
      const cp2x = curr[0] - (curr[0] - prev[0]) * 0.45;
      d += ` C ${cp1x},${prev[1]} ${cp2x},${curr[1]} ${curr[0]},${curr[1]}`;
    }
    return d;
  }

  function areaPath(pts: [number, number][], baseY: number): string {
    if (pts.length < 2) return '';
    const line = smoothPath(pts);
    return `${line} L ${pts[pts.length - 1][0]},${baseY} L ${pts[0][0]},${baseY} Z`;
  }

  const baseY = top + chartHeight;

  return (
    <div style={{ position: 'relative' }} onMouseLeave={() => setTooltip(null)}>
      {tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.lines.map((line, i) => <div key={i} style={{ opacity: i === 0 ? 1 : 0.75, fontWeight: i === 0 ? 600 : 400 }}>{line}</div>)}
        </div>
      )}
      <svg className="linechart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="추세 차트">
        <defs>
          {groups.map((group, gi) => (
            <linearGradient key={`grad-${group.key}`} id={`grad-${gi}-${group.key.replace(/[^a-zA-Z0-9]/g, '_')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={group.color} stopOpacity="0.16" />
              <stop offset="85%" stopColor={group.color} stopOpacity="0.02" />
              <stop offset="100%" stopColor={group.color} stopOpacity="0" />
            </linearGradient>
          ))}
          <filter id="glow-line" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id="linechart-clip">
            <rect x={left} y={top} width={chartWidth} height={chartHeight} />
          </clipPath>
        </defs>

        <rect x={left} y={top} width={chartWidth} height={chartHeight} fill="transparent" />

        {yTicks.map((value, i) => {
          const y = yAt(value);
          return (
            <g key={`y-${value}`}>
              <line x1={left} x2={width - right} y1={y} y2={y}
                stroke={i === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
                strokeWidth={1}
                strokeDasharray={i === 0 ? '' : '4 4'}
                shapeRendering="crispEdges" />
              <text x={left - 10} y={y + 4} textAnchor="end" className="chart-tick">
                {formatMetric(activeMetric, value)}
              </text>
            </g>
          );
        })}

        {xTickIndexes.map(index => {
          const x = xAt(index);
          return (
            <g key={`x-${index}`}>
              <line x1={x} x2={x} y1={top} y2={baseY} stroke="var(--chart-grid)" strokeWidth={1} strokeDasharray="4 4" shapeRendering="crispEdges" />
              <text x={x} y={height - 10} textAnchor="middle" className="chart-tick">{shortDate(dates[index])}</text>
            </g>
          );
        })}

        <line x1={left} x2={left} y1={top} y2={baseY} stroke="var(--chart-axis)" strokeWidth={1} shapeRendering="crispEdges" />

        {/* Area fills */}
        {groups.map((group, gi) => {
          const pts: [number, number][] = group.data.map((value, i) => [xAt(i), yAt(value)]);
          const dim = highlight && highlight !== group.name;
          const gradId = `grad-${gi}-${group.key.replace(/[^a-zA-Z0-9]/g, '_')}`;
          return (
            <path
              key={`area-${group.key}`}
              d={areaPath(pts, baseY)}
              fill={`url(#${gradId})`}
              opacity={dim ? 0.03 : 1}
              clipPath="url(#linechart-clip)"
              style={{ transition: 'opacity 220ms cubic-bezier(0.2,0,0,1)' }}
            />
          );
        })}

        {/* Lines + points */}
        {groups.map(group => {
          const pts: [number, number][] = group.data.map((value, i) => [xAt(i), yAt(value)]);
          const dim = highlight && highlight !== group.name;
          return (
            <g
              key={group.key}
              opacity={dim ? 0.14 : 1}
              style={{ transition: 'opacity 220ms cubic-bezier(0.2,0,0,1)' }}
            >
              {!dim && (
                <path
                  d={smoothPath(pts)}
                  fill="none"
                  stroke={group.color}
                  strokeWidth={4}
                  strokeOpacity={0.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#glow-line)"
                />
              )}
              <path
                d={smoothPath(pts)}
                fill="none"
                stroke={group.color}
                strokeWidth={dim ? 1.5 : 2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transition: 'stroke-width 220ms cubic-bezier(0.2,0,0,1)' }}
              />
              {group.data.map((value, index) => {
                const date = dates[index];
                const pointRow = groupKey === 'date'
                  ? rows.find(row => row.date === date)
                  : rows.find(row => row.date === date && String(row[groupKey] || '') === group.name);
                const displayMetric = groupKey === 'date' ? (group.key as MetricKey) : activeMetric;
                const tooltipLines = [
                  `${group.name}  ${formatDateWithDay(date)}`,
                  `${metricLabels[displayMetric]}: ${formatMetric(displayMetric, value)}`,
                  ...(pointRow && displayMetric !== 'spend' ? [`광고비: ${formatMetric('spend', pointRow.spend)}`] : [])
                ];
                return (
                  <g key={`${group.key}-${date}`}>
                    <circle cx={xAt(index)} cy={yAt(value)} r={12} fill="transparent"
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => {
                        setTooltip({ x: e.clientX + 14, y: e.clientY - 10, lines: tooltipLines });
                      }}
                      onMouseMove={e => {
                        setTooltip(prev => prev ? { ...prev, x: e.clientX + 14, y: e.clientY - 10 } : null);
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                    <circle cx={xAt(index)} cy={yAt(value)} r={6} fill={group.color} fillOpacity={0.12} />
                    <circle
                      className="chart-point"
                      cx={xAt(index)} cy={yAt(value)} r={3.5}
                      fill={group.color}
                      stroke="var(--c-bg-elevated)"
                      strokeWidth={2}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function applyFilters(data: DashboardBundle, start: string, end: string, campaign: string, adset: string): FilteredBundle {
  const byDate = (row: StatRow) => (!start || !row.date || row.date >= start) && (!end || !row.date || row.date <= end);
  const full = (row: StatRow) => byDate(row) && (!campaign || row.campaignName === campaign) && (!adset || row.adsetName === adset);
  const dailyStats = data.dailyStats.filter(byDate);
  const campaignDailyStats = data.campaignDailyStats.filter(full);
  const adsetDailyStats = data.adsetDailyStats.filter(full);
  const detailStats = data.detailStats.filter(full);
  const creativeStats = data.creativeStats.filter(row => (!campaign || row.campaignName === campaign) && (!adset || row.adsetName === adset));
  return { dailyStats, campaignDailyStats, adsetDailyStats, detailStats, creativeStats, total: totalStat(detailStats.length ? detailStats : dailyStats) };
}

function sortRows(rows: StatRow[], sort: string) {
  const arr = [...rows];
  const asc = sort.endsWith('Asc');
  const key = sort.replace('Asc', '').replace('Desc', '') as MetricKey | 'date';
  return arr.sort((a, b) => {
    const av = key === 'date' ? String(a.date || '') : metricValue(a, key as MetricKey);
    const bv = key === 'date' ? String(b.date || '') : metricValue(b, key as MetricKey);
    if (av === bv) return 0;
    return asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });
}

function sortDetailRows(rows: StatRow[], sort: string) {
  const groups = new Map<string, StatRow[]>();
  for (const row of rows) {
    const date = row.date || '';
    groups.set(date, [...(groups.get(date) || []), row]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).flatMap(([, group]) => sortRows(group, sort));
}

function topBy(rows: StatRow[], key: MetricKey, limit = 20, groupKey?: keyof StatRow, order: SortOrder = 'desc') {
  const base = groupKey
    ? Array.from(rows.reduce((acc, row) => { const value = String(row[groupKey] || '알 수 없음'); acc.set(value, [...(acc.get(value) || []), row]); return acc; }, new Map<string, StatRow[]>()).entries()).map(([groupName, group]) => ({ ...totalStat(group, groupName), [groupKey]: groupName })) as StatRow[]
    : rows;
  return sortRows(base, `${key}${order === 'desc' ? 'Desc' : 'Asc'}`).slice(0, limit);
}

function metricValue(row: StatRow, key: MetricKey) {
  return Number(row[key] ?? 0);
}
function countUnique(xs: string[]) { return new Set(xs.filter(Boolean)).size; }
function toggleSet<T>(set: Set<T>, value: T) { const next = new Set(set); next.has(value) ? next.delete(value) : next.add(value); return next; }
function isString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function errorMessage(err: unknown) { return err instanceof Error ? err.message : String(err || '요청에 실패했습니다.'); }
function diffTitle(prev: StatRow | undefined, current: StatRow, key: MetricKey) { if (!prev) return '전일 데이터 없음'; const p = metricValue(prev, key); const c = metricValue(current, key); if (!p) return '전일 대비 계산 불가'; const d = ((c - p) / p) * 100; return `전일 대비 ${d >= 0 ? '+' : ''}${d.toFixed(1)}%`; }
function ctrColor(value: number, max: number) { if (!value || !max) return '#fff'; const t = Math.min(value / max, 1); return `rgba(15, 122, 78, ${0.06 + t * 0.35})`; }
function cpmColor(value: number) { if (value >= 1000 || !value) return '#fff'; const t = Math.max(0, Math.min((1000 - value) / 1000, 1)); return `rgba(15, 122, 78, ${0.06 + t * 0.35})`; }
function sortOptions(keys: Array<MetricKey | 'date'>) { const map: Record<string, string> = { date: '날짜', ...metricLabels }; return keys.flatMap(key => key === 'date' ? [{ value: 'dateAsc', label: '날짜 오래된순' }, { value: 'dateDesc', label: '날짜 최신순' }] : [{ value: `${key}Desc`, label: `${map[key]} 높은 순` }, { value: `${key}Asc`, label: `${map[key]} 낮은 순` }]); }

/**
 * AnimatedChip — 선택/해제 시 매번 애니메이션을 재실행하기 위해
 * `active` 변경마다 React key를 bump해서 DOM 노드를 재마운트합니다.
 */
function AnimatedChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const [animToken, setAnimToken] = useState(0);
  const prevActive = useRef(active);

  useEffect(() => {
    if (prevActive.current !== active) {
      setAnimToken(t => t + 1);
      prevActive.current = active;
    }
  }, [active]);

  return (
    <button
      key={animToken}                      // key 변경 → 노드 재마운트 → animation 재실행
      className={active ? 'active' : ''}
      onClick={onClick}
      style={{
        animationName: animToken > 0
          ? (active ? 'chip-activate' : 'deselect-shrink')
          : 'none',
        animationDuration: '300ms',
        animationTimingFunction: 'cubic-bezier(0.34,1.56,0.64,1)',
        animationFillMode: 'both',
      }}
    >
      {label}
    </button>
  );
}
