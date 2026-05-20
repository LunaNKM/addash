'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, completeRedirectLogin, logout, signInWithGoogleSafe, userEmail } from '@/lib/firebase';
import {
  addAdmin, createBrand, createTab, deleteBrand, deleteFile, deleteTab, emptyKpi,
  findBrandByShareToken, getKpi, isAdminEmail, listAdmins, listBrandsForAdmin,
  listFiles, listInsights, listTabs, removeAdmin, renameTab, saveFile, saveInsight,
  saveKpi, updateBrand
} from '@/lib/store';
import { parseMetaFile, type ParseReport } from '@/lib/parser';
import { buildFileStats, mergeStats, totalStat } from '@/lib/aggregation';
import { applyBrandColor, randomBrandColor } from '@/lib/brandColor';
import type { Brand, DashboardTab, FileDoc, InsightDoc, Kpi, MetricKey } from '@/lib/types';
import {
  applyFilters, countUnique, errorMessage, toggleSet, topBy,
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

const defaultVisibleMetrics: MetricKey[] = ['spend', 'impression', 'ctr'];

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

  const filtered = useMemo(
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
      const doc: Omit<FileDoc, 'id'> = { filename: pendingFile.name, fileSize: pendingFile.size, createdAt: Date.now(), ...stats };
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
          brandName: brand.name, tabName: tab.name, total,
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
