'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, completeRedirectLogin, firebaseAuthErrorMessage, logout, signInWithGoogleSafe } from '@/lib/firebase';
import { buildReportView, filterRowsByPeriod, previousMatchingPeriod } from '@/lib/report/aggregate';
import { mergeRegistrationIntoReport, parseRegistrationFile, type RegistrationMergeStats } from '@/lib/report/registration';
import { DEFAULT_EXCHANGE_RATE, toGrossCostKrw } from '@/lib/report/schema';
import { loadReportFromXlsx } from '@/lib/report/sources';
import {
  createBrand,
  emptyKpi,
  findBrandByShareToken,
  getKpi,
  getReportComment,
  getReportFile,
  getSingleOneCollectorSettings,
  isAdminEmail,
  listCreativeAssets,
  listBrandsForAdmin,
  listReportFiles,
  listTabs,
  saveKpi,
  saveSingleOneCollectorSettings,
  saveReportComment,
  saveReportFile,
  updateReportFileResult,
  updateBrand
} from '@/lib/store';
import { applyBrandColor, randomBrandColor } from '@/lib/brandColor';
import { errorMessage } from '@/lib/dashUtils';
import type { Brand, CreativeAssetDoc, DashboardTab, Kpi, ReportCommentDoc, ReportFileDoc, SingleOneCollectorSettings } from '@/lib/types';
import { Empty } from '../components/Empty';
import { MetaFilterModal } from '../components/MetaFilterModal';
import { SettingsModal, type SettingsMode } from '../components/SettingsModal';
import type {
  NormalizedReportRow,
  ReportComparisonMetric,
  ReportParseResult,
  ReportSummary,
  ReportView
} from '@/lib/report/reportTypes';

type MarketplaceTab = 'qoo10' | 'owned';
type PromotionSubTab = 'total' | 'always' | 'megawari' | 'megapo' | 'market' | 'live' | 'hybrid';
type ReportTab = 'total' | 'campaigns' | 'creatives' | MarketplaceTab;
type ReportSourceType = 'xlsx' | 'meta';

const marketplaceTabs: { id: MarketplaceTab; label: string }[] = [
  { id: 'qoo10', label: 'Qoo10' },
  { id: 'owned', label: '자사몰' }
];

const marketplaceSubTabs: Record<MarketplaceTab, { id: PromotionSubTab; label: string }[]> = {
  qoo10: [
    { id: 'total', label: '전체 성과' },
    { id: 'always', label: '상시' },
    { id: 'megawari', label: '메가와리' },
    { id: 'megapo', label: '메가포' },
    { id: 'market', label: '마켓' },
    { id: 'live', label: 'LIVE' }
  ],
  owned: [
    { id: 'total', label: '전체 성과' },
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
  const [selectedXlsxReportFileId, setSelectedXlsxReportFileId] = useState('');
  const [selectedMetaReportFileId, setSelectedMetaReportFileId] = useState('');
  const [reportComment, setReportComment] = useState<ReportCommentDoc | null>(null);
  const [creativeAssets, setCreativeAssets] = useState<Record<string, CreativeAssetDoc>>({});
  const [commentDraft, setCommentDraft] = useState('');
  const [commentEditing, setCommentEditing] = useState(false);
  const [commentBusy, setCommentBusy] = useState('');
  const [metaImportOpen, setMetaImportOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsMode>('none');
  const [collectorOpen, setCollectorOpen] = useState(false);
  const [collectorSettings, setCollectorSettings] = useState<SingleOneCollectorSettings | null>(null);
  const [xlsxResult, setXlsxResult] = useState<ReportParseResult | null>(null);
  const [metaResult, setMetaResult] = useState<ReportParseResult | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>('total');
  const [activeSubTab, setActiveSubTab] = useState<PromotionSubTab>('always');
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [comparisonStart, setComparisonStart] = useState('');
  const [comparisonEnd, setComparisonEnd] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [adgroupFilter, setAdgroupFilter] = useState('');
  const [adFilter, setAdFilter] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    applyBrandColor(brand?.color || null);
  }, [brand?.color]);

  const resetReportState = useCallback(() => {
    setXlsxResult(null);
    setMetaResult(null);
    setReportFiles([]);
    setSelectedXlsxReportFileId('');
    setSelectedMetaReportFileId('');
    setReportComment(null);
    setCreativeAssets({});
    setCommentDraft('');
    setCommentEditing(false);
    setPeriodStart('');
    setPeriodEnd('');
    setComparisonStart('');
    setComparisonEnd('');
    setCampaignFilter('');
    setAdgroupFilter('');
    setAdFilter('');
    setNotice('');
  }, []);

  const applyReportResult = useCallback((
    nextResult: ReportParseResult | null,
    createdAt: number | undefined,
    source: ReportSourceType,
    options: { activate?: boolean; updatePeriod?: boolean } = {}
  ) => {
    const grossResult = nextResult ? applyGrossSpendRule(nextResult) : null;
    const scopedResult = source === 'xlsx' && grossResult
      ? filterReportResultRows(grossResult, isSingleOneUploadRow, 'SingleOne Upload')
      : grossResult;

    if (source === 'meta') setMetaResult(scopedResult);
    else setXlsxResult(scopedResult);

    const activate = options.activate ?? true;
    const updatePeriod = options.updatePeriod ?? true;
    if (activate) setActiveTab('total');
    setCampaignFilter('');
    setAdgroupFilter('');
    setAdFilter('');
    if (!updatePeriod) return;
    if (!scopedResult) {
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

    const [loadedKpi, loadedReportFiles, loadedCreativeAssets] = await Promise.all([
      getKpi(target.id, nextTab.id),
      listReportFiles(target.id, nextTab.id),
      listCreativeAssets(target.id, nextTab.id)
    ]);
    setKpi(loadedKpi);
    setReportFiles(loadedReportFiles);
    setCreativeAssets(indexCreativeAssets(loadedCreativeAssets));

    const firstXlsx = loadedReportFiles.find(file => !isMetaReportFile(file)) || null;
    const firstMeta = loadedReportFiles.find(file => isMetaReportFile(file)) || null;
    setSelectedXlsxReportFileId(firstXlsx?.id || '');
    setSelectedMetaReportFileId(firstMeta?.id || '');

    const [loadedXlsx, loadedMeta, loadedComment] = await Promise.all([
      firstXlsx ? getReportFile(target.id, nextTab.id, firstXlsx.id) : Promise.resolve(null),
      firstMeta ? getReportFile(target.id, nextTab.id, firstMeta.id) : Promise.resolve(null),
      firstXlsx ? getReportComment(target.id, nextTab.id, firstXlsx.id) : firstMeta ? getReportComment(target.id, nextTab.id, firstMeta.id) : Promise.resolve(null)
    ]);

    if (loadedXlsx) {
      applyReportResult(loadedXlsx.result, loadedXlsx.createdAt || firstXlsx?.createdAt, 'xlsx', { activate: true, updatePeriod: true });
    } else {
      setXlsxResult(null);
    }

    if (loadedMeta) {
      applyReportResult(loadedMeta.result, loadedMeta.createdAt || firstMeta?.createdAt, 'meta', {
        activate: !loadedXlsx,
        updatePeriod: !loadedXlsx
      });
    } else {
      setMetaResult(null);
    }

    if (!loadedXlsx && !loadedMeta) {
      applyReportResult(null, undefined, 'xlsx');
    }
    setReportComment(loadedComment);
    setCommentDraft(loadedComment?.text || '');
    setCommentEditing(false);
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
    const [loadedReportFiles, loadedCreativeAssets] = await Promise.all([
      listReportFiles(brand.id, dashboardTab.id),
      listCreativeAssets(brand.id, dashboardTab.id)
    ]);
    setReportFiles(loadedReportFiles);
    setCreativeAssets(indexCreativeAssets(loadedCreativeAssets));
    const selectedXlsx = loadedReportFiles.find(file => file.id === selectedXlsxReportFileId && !isMetaReportFile(file))
      || loadedReportFiles.find(file => !isMetaReportFile(file))
      || null;
    const selectedMeta = loadedReportFiles.find(file => file.id === selectedMetaReportFileId && isMetaReportFile(file))
      || loadedReportFiles.find(file => isMetaReportFile(file))
      || null;
    const currentFile = selectedXlsx || selectedMeta;

    setSelectedXlsxReportFileId(selectedXlsx?.id || '');
    setSelectedMetaReportFileId(selectedMeta?.id || '');

    const [loadedXlsx, loadedMeta, loadedComment] = await Promise.all([
      selectedXlsx ? getReportFile(brand.id, dashboardTab.id, selectedXlsx.id) : Promise.resolve(null),
      selectedMeta ? getReportFile(brand.id, dashboardTab.id, selectedMeta.id) : Promise.resolve(null),
      currentFile ? getReportComment(brand.id, dashboardTab.id, currentFile.id) : Promise.resolve(null)
    ]);

    if (loadedXlsx) applyReportResult(loadedXlsx.result, loadedXlsx.createdAt || selectedXlsx?.createdAt, 'xlsx', { activate: false, updatePeriod: Boolean(selectedXlsx) });
    else setXlsxResult(null);
    if (loadedMeta) applyReportResult(loadedMeta.result, loadedMeta.createdAt || selectedMeta?.createdAt, 'meta', { activate: false, updatePeriod: !selectedXlsx });
    else setMetaResult(null);

    if (!loadedXlsx && !loadedMeta) applyReportResult(null, undefined, 'xlsx');
    setReportComment(loadedComment);
    setCommentDraft(loadedComment?.text || '');
    setCommentEditing(false);
  }, [activeTab, applyReportResult, brand, dashboardTab, selectedMetaReportFileId, selectedXlsxReportFileId]);

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

  const result = useMemo(() => combineReportResults(xlsxResult, metaResult), [metaResult, xlsxResult]);
  const selectedReportFileId = selectedXlsxReportFileId || selectedMetaReportFileId;

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
    setActiveSubTab(activeSubTabs[0]?.id || 'total');
  }, [activeMarketplace, activeSubTab, activeSubTabs]);

  const periodRows = useMemo(() => {
    if (!result) return [];
    return filterRowsByPeriod(result.rows.filter(row => !isExcludedAmazonRow(row)), periodStart || dates.min, periodEnd || dates.max);
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
    if (!result) return [];
    return result.rows.filter(row => {
      if (isExcludedAmazonRow(row)) return false;
      if (activeMarketplace && (!matchesMarketplaceTab(row, activeMarketplace.id) || !matchesPromotionSubTab(row, activeMarketplace.id, activeSubTab))) return false;
      if (!matchesValue(row.campaignName, campaignFilter)) return false;
      if (!matchesValue(row.adgroupName, adgroupFilter)) return false;
      if (!matchesValue(row.adName, adFilter)) return false;
      return true;
    });
  }, [activeMarketplace, activeSubTab, adFilter, adgroupFilter, campaignFilter, result]);

  const marketplaceRows = useMemo(() => {
    if (!result || !activeMarketplace) return [];
    return result.rows.filter(row => {
      if (isExcludedAmazonRow(row)) return false;
      if (!matchesMarketplaceTab(row, activeMarketplace.id)) return false;
      if (!matchesValue(row.campaignName, campaignFilter)) return false;
      if (!matchesValue(row.adgroupName, adgroupFilter)) return false;
      if (!matchesValue(row.adName, adFilter)) return false;
      return true;
    });
  }, [activeMarketplace, adFilter, adgroupFilter, campaignFilter, result]);

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
    setNotice('');
    try {
      const parsed = filterReportResultRows(
        await loadReportFromXlsx(file, exchangeRate),
        isSingleOneUploadRow,
        'SingleOne Upload'
      );
      if (!parsed.rows.length) {
        throw new Error('업로드 파일에서 media가 s-로 시작하는 SingleOne 행을 찾지 못했습니다.');
      }
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
      setSelectedXlsxReportFileId(savedId);
      setReportComment(null);
      setCommentDraft('');
      setCommentEditing(false);
      applyReportResult(parsed, createdAt, 'xlsx');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function handleRegistrationFile(file: File) {
    if (!brand || !dashboardTab || !isAdmin) {
      setError('회원가입수 적용을 위해서는 관리자 로그인과 브랜드 선택이 필요합니다.');
      return;
    }
    if (!selectedXlsxReportFileId || !xlsxResult) {
      setError('먼저 회원가입수를 적용할 XLSX RAW 파일을 선택해주세요.');
      return;
    }

    setBusy('회원가입수 데이터를 읽는 중입니다...');
    setError('');
    setNotice('');
    try {
      const registration = await parseRegistrationFile(file);
      const merged = mergeRegistrationIntoReport(xlsxResult, registration);
      if (!merged.stats.matchedRows) {
        throw new Error(`회원가입수 파일의 행이 현재 RAW와 매칭되지 않았습니다. 날짜와 캠페인/광고그룹/소재명이 같은 파일인지 확인해주세요. (${registration.sheet.sheetName})`);
      }

      await updateReportFileResult(brand.id, dashboardTab.id, selectedXlsxReportFileId, merged.result);
      const loadedReportFiles = await listReportFiles(brand.id, dashboardTab.id);
      setReportFiles(loadedReportFiles);
      applyReportResult(merged.result, undefined, 'xlsx', { activate: false, updatePeriod: false });
      setNotice(formatRegistrationMergeNotice(merged.stats, registration.sheet.sheetName));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function fetchReportFromMeta(adsetIds: string[], dateStart: string, dateEnd: string) {
    if (!brand || !dashboardTab || !user || !isAdmin) return;
    setMetaImportOpen(false);
    setBusy('Meta API에서 성과와 소재 이미지를 가져오는 중입니다...');
    setError('');
    setNotice('');
    try {
      const token = await user.getIdToken(true);
      const resp = await fetch('/api/report-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          brandId: brand.id,
          tabId: dashboardTab.id,
          adAccountId: brand.metaAdAccountId,
          dateStart,
          dateEnd,
          adsetIds,
          exchangeRate
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Meta API 가져오기에 실패했습니다.');

      const [loadedReportFiles, loadedCreativeAssets] = await Promise.all([
        listReportFiles(brand.id, dashboardTab.id),
        listCreativeAssets(brand.id, dashboardTab.id)
      ]);
      const saved = loadedReportFiles.find(file => file.id === data.fileId) || loadedReportFiles.find(file => isMetaReportFile(file)) || null;
      setReportFiles(loadedReportFiles);
      setCreativeAssets(indexCreativeAssets(loadedCreativeAssets));
      setSelectedMetaReportFileId(saved?.id || '');
      setReportComment(null);
      setCommentDraft('');
      setCommentEditing(false);

      if (saved) {
        const loadedFile = await getReportFile(brand.id, dashboardTab.id, saved.id);
        applyReportResult(loadedFile?.result || null, loadedFile?.createdAt || saved.createdAt, 'meta');
      }
      setActiveTab('total');
      setActiveSubTab('total');
      const imageStats = data.creativeImages || {};
      const imageSummary = Number(imageStats.total || 0)
        ? ` · 소재 이미지 ${Number(imageStats.saved || 0).toLocaleString()}개 저장 · 기존 ${Number(imageStats.skippedExisting || 0).toLocaleString()}개 건너뜀${Number(imageStats.failed || 0) ? ` · ${Number(imageStats.failed).toLocaleString()}개 실패` : ''}`
        : '';
      const imageError = data.creativeImageError ? ` · 이미지 오류: ${data.creativeImageError}` : '';
      setNotice(`Meta API 데이터 적용 완료: ${Number(data.rowCount || 0).toLocaleString()}행 · ${data.dateStart || '-'} ~ ${data.dateEnd || '-'}${imageSummary}${imageError}`);
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

  async function openCollectorSettings() {
    if (!brand || !dashboardTab) return;
    try {
      const settings = await getSingleOneCollectorSettings(brand.id, dashboardTab.id);
      setCollectorSettings(settings);
      setCollectorOpen(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function regenerateCollectorToken() {
    if (!brand || !dashboardTab) return;
    const next: SingleOneCollectorSettings = {
      token: makeCollectorToken(),
      updatedAt: Date.now()
    };
    await saveSingleOneCollectorSettings(brand.id, dashboardTab.id, next);
    setCollectorSettings(next);
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
            {brand && dashboardTab && <button className="btn ghost" onClick={openCollectorSettings}>싱글원 수집기</button>}
            {brand && <button className="btn ghost" onClick={() => navigator.clipboard.writeText(`${location.origin}/report-lab?share=${brand.shareToken}`).then(() => alert('공유 링크를 복사했습니다.'))}>공유</button>}
            {brand && dashboardTab && (
              <label className="btn brand">
                RAW 업로드
                <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => event.target.files?.[0] && handleFile(event.target.files[0])} />
              </label>
            )}
            {brand && dashboardTab && user && (
              <button className="btn outline" onClick={() => setMetaImportOpen(true)}>
                Meta API 가져오기
              </button>
            )}
            {brand && dashboardTab && xlsxResult && selectedXlsxReportFileId && (
              <label className="btn outline">
                회원가입수 업로드
                <input
                  hidden
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) handleRegistrationFile(file);
                    event.currentTarget.value = '';
                  }}
                />
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
            <small>{result ? `${result.rows.length.toLocaleString()}행 · ${reportView?.currentPeriod.label}` : 'SingleOne RAW 업로드와 Meta API 가져오기로 생성합니다.'}</small>
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
                if (tab.id === 'qoo10' || tab.id === 'owned') setActiveSubTab('total');
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
                  className={`chip ${file.id === selectedXlsxReportFileId || file.id === selectedMetaReportFileId ? 'active' : ''}`}
                  onClick={() => {
                    if (!brand || !dashboardTab) return;
                    const source: ReportSourceType = isMetaReportFile(file) ? 'meta' : 'xlsx';
                    if (source === 'meta') setSelectedMetaReportFileId(file.id);
                    else setSelectedXlsxReportFileId(file.id);
                    setBusy('저장된 RAW 파일을 불러오는 중입니다...');
                    Promise.all([
                      getReportFile(brand.id, dashboardTab.id, file.id),
                      getReportComment(brand.id, dashboardTab.id, file.id)
                    ])
                      .then(([loadedFile, loadedComment]) => {
                        applyReportResult(loadedFile?.result || null, loadedFile?.createdAt || file.createdAt, source);
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
          {notice && <div className="notice">{notice}</div>}

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
              {activeTab === 'creatives' && <CreativeReport view={reportView} kpi={kpi} creativeAssets={creativeAssets} />}
              {activeMarketplace && (
                <PromotionDetailReport
                  title={activeMarketplaceTitle}
                  view={reportView}
                  allRows={filteredRows}
                  marketplace={activeMarketplace.id}
                  marketplaceRows={marketplaceRows}
                  activeSubTab={activeSubTab}
                />
              )}
            </>
          )}
        </div>
      </main>
      )}

      {busy && <div className="busy">{busy}</div>}
      {metaImportOpen && brand && user && (
        <MetaFilterModal
          brand={brand}
          user={user}
          apiPath="/api/report-meta"
          onClose={() => setMetaImportOpen(false)}
          onImport={fetchReportFromMeta}
        />
      )}
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
      {collectorOpen && brand && dashboardTab && (
        <CollectorSettingsModal
          brand={brand}
          tab={dashboardTab}
          user={user}
          settings={collectorSettings}
          onClose={() => setCollectorOpen(false)}
          onRegenerate={regenerateCollectorToken}
        />
      )}
    </div>
  );
}

function CollectorSettingsModal({
  brand,
  tab,
  user,
  settings,
  onClose,
  onRegenerate
}: {
  brand: Brand;
  tab: DashboardTab;
  user: User | null;
  settings: SingleOneCollectorSettings | null;
  onClose: () => void;
  onRegenerate: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const config = {
    appName: 'GFU DASH',
    baseUrl,
    brandId: brand.id,
    tabId: tab.id,
    collectorToken: settings?.token || '',
    authToken,
    media: 's-meta'
  };
  const configText = JSON.stringify(config, null, 2);

  useEffect(() => {
    user?.getIdToken(true).then(setAuthToken).catch(() => setAuthToken(''));
  }, [user]);

  async function runRegenerate() {
    if (settings?.token && !confirm('기존 수집기 토큰을 재발급하면 이전 확장 프로그램 설정은 더 이상 사용할 수 없습니다. 계속할까요?')) return;
    setBusy(true);
    try {
      await onRegenerate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal">
      <div className="modal-card collector-modal">
        <h3>GFU DASH 싱글원 수집기</h3>
        <span className="muted">{brand.name} · {tab.name}</span>

        <div className="collector-config-grid">
          <label>
            Add-on URL
            <input readOnly value={baseUrl} />
          </label>
          <label>
            brandId
            <input readOnly value={brand.id} />
          </label>
          <label>
            tabId
            <input readOnly value={tab.id} />
          </label>
          <label>
            collectorToken
            <input readOnly value={settings?.token || '토큰을 생성해주세요'} />
          </label>
          <label>
            authToken
            <input readOnly value={authToken ? 'Firebase 관리자 인증 토큰 포함됨' : '로그인 토큰을 가져오지 못했습니다'} />
          </label>
        </div>

        <textarea className="collector-config-text" readOnly value={configText} />

        <div className="modal-actions">
          <button className="btn outline" onClick={onClose}>닫기</button>
          <button
            className="btn outline"
            disabled={!authToken && !settings?.token}
            onClick={() => navigator.clipboard.writeText(configText).then(() => alert('수집기 설정을 복사했습니다.'))}
          >
            설정 복사
          </button>
          <button className="btn outline" onClick={() => user?.getIdToken(true).then(setAuthToken)}>
            인증 토큰 새로고침
          </button>
          <button className="btn brand" disabled={busy} onClick={runRegenerate}>
            {settings?.token ? '토큰 재발급' : '토큰 생성'}
          </button>
        </div>
      </div>
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
          XLSX RAW 파일을 업로드하면 media가 s-로 시작하는 SingleOne 행만 보고서 데이터로 변환합니다.
          Meta 데이터는 Meta API 가져오기 결과와 함께 반영됩니다.
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

function CreativeReport({ view, kpi, creativeAssets }: { view: ReportView; kpi: Kpi; creativeAssets: Record<string, CreativeAssetDoc> }) {
  const creativeRows = view.current.byCreative.filter(hasReportPerformance);
  return (
    <>
      <SummaryCards total={view.current.total} kpi={kpi} />
      <SummaryTable
        title="소재 성과"
        rows={creativeRows}
        previousRows={view.previous.byCreative}
        limit={140}
        showComparisonRows
        creativeAssets={creativeAssets}
      />
    </>
  );
}

function PromotionDetailReport({
  title,
  view,
  allRows,
  marketplace,
  marketplaceRows,
  activeSubTab
}: {
  title: string;
  view: ReportView;
  allRows: NormalizedReportRow[];
  marketplace: MarketplaceTab;
  marketplaceRows: NormalizedReportRow[];
  activeSubTab: PromotionSubTab;
}) {
  const latestDate = latestReportDate(allRows) || view.currentPeriod.end;
  const dailyData = buildYearDailyGroups(allRows, latestDate);
  const historicalTitle = historicalSubTabTitle(activeSubTab);
  const historicalRows = marketplace === 'qoo10' && historicalTitle ? buildHistoricalSubTabRows(marketplaceRows, activeSubTab) : [];
  const overallRows = buildPromotionPerformanceRows(allRows, view.currentRows, view.previousRows, view.currentPeriod.start, view.currentPeriod.end, view.previousPeriod.start, view.previousPeriod.end, [{ label: '전체 성과', test: () => true }]);
  const objectiveRows = buildPromotionPerformanceRows(allRows, view.currentRows, view.previousRows, view.currentPeriod.start, view.currentPeriod.end, view.previousPeriod.start, view.previousPeriod.end, [
    { label: 'ATC(장바구니)', test: row => matchesAnyReportText(row, ['atc', 'add to cart', 'addtocart']) },
    { label: 'Purchase', test: row => matchesAnyReportText(row, ['purchase', 'conversion']) },
    { label: 'Traffic', test: row => matchesAnyReportText(row, ['traffic', 'click']) }
  ], '기타');
  const campaignRows = buildCampaignPerformanceRows(allRows, view.currentRows, view.previousRows, view.currentPeriod.start, view.currentPeriod.end, view.previousPeriod.start, view.previousPeriod.end);

  return (
    <>
      <section className="section">
        <div className="section-head">
          <b>{title} 성과</b>
          <span className="muted">최신 {latestDate || '-'}</span>
        </div>
        <PromotionKpiCards total={view.current.total} showRegistration={marketplace === 'owned'} />
      </section>
      <DailyToplineChart rows={view.current.byDaily} lineMetric={marketplace === 'owned' ? 'registration' : 'roas'} />
      {historicalRows.length > 0 && historicalTitle && <HistoricalPerformanceTable title={historicalTitle} rows={historicalRows} />}
      <PromotionPerformanceSection title="전체 성과" rows={overallRows} showRegistration={marketplace === 'owned'} />
      <PromotionPerformanceSection title="목적별 성과" rows={objectiveRows} showRegistration={marketplace === 'owned'} />
      <PromotionPerformanceSection title="캠페인별 성과" rows={campaignRows} showRegistration={marketplace === 'owned'} />
      <YearDailyPerformanceTable data={dailyData} showRegistration={marketplace === 'owned'} />
    </>
  );
}

function PromotionKpiCards({ total, showRegistration = false }: { total: ReportSummary; showRegistration?: boolean }) {
  const cards = [
    { label: '광고비', value: formatCurrency(total.spend) },
    { label: '매출', value: formatCurrency(total.sales) },
    { label: 'ROAS', value: total.roas.toFixed(2) },
    { label: 'CTR', value: formatPercent(total.ctr) },
    { label: 'CVR', value: formatPercent(total.cvr) },
    { label: '전환CPA', value: formatCurrency(total.cpa) }
  ];
  if (showRegistration) {
    cards.push(
      { label: '회원가입수', value: formatInteger(total.registration) },
      { label: '회원가입 CPA', value: formatCurrency(safeRatio(total.spend, total.registration)) }
    );
  }

  return (
    <div className="report-stat-grid">
      {cards.map(card => (
        <div className="report-stat-card" key={card.label}>
          <small>{card.label}</small>
          <b>{card.value}</b>
        </div>
      ))}
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
    { label: '전환CPA', value: formatCurrency(total.cpa) }
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

function DailyToplineChart({
  rows,
  comparisonLabel,
  lineMetric = 'roas'
}: {
  rows: ReportSummary[];
  comparisonLabel?: string;
  lineMetric?: 'roas' | 'registration';
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; row: ReportSummary } | null>(null);
  const sorted = [...rows].filter(row => row.key !== '날짜 없음').sort((a, b) => a.label.localeCompare(b.label));
  const lineLabel = lineMetric === 'registration' ? '회원가입수' : 'ROAS';
  const formatLineValue = (value: number) => lineMetric === 'registration' ? formatInteger(value) : formatPercent(value);
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
  const lineValues = sorted
    .map(row => row[lineMetric])
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const rawLineMax = Math.max(1, ...lineValues);
  const p90Line = percentile(lineValues, 0.9);
  const p75Line = percentile(lineValues, 0.75);
  const robustLineMax = Math.max(1, p90Line * 1.35, p75Line * 2);
  const lineMax = rawLineMax > robustLineMax * 1.5 ? robustLineMax : rawLineMax;
  const slot = chartWidth / Math.max(sorted.length, 1);
  const barWidth = Math.min(22, Math.max(7, slot * 0.36));
  const yMoney = (value: number) => top + chartHeight - (value / moneyMax) * chartHeight;
  const yLine = (value: number) => top + chartHeight - (Math.min(value, lineMax) / lineMax) * chartHeight;
  const xCenter = (index: number) => left + slot * index + slot / 2;
  const linePath = sorted
    .map((row, index) => `${index === 0 ? 'M' : 'L'} ${xCenter(index)} ${yLine(row[lineMetric])}`)
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
            <span>{lineLabel} {formatLineValue(tooltip.row[lineMetric])}</span>
          </div>
        )}
        <svg className="report-topline-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`일자별 광고비, 매출, ${lineLabel} 추이`}>
          {[0, 0.25, 0.5, 0.75, 1].map(rate => {
            const y = top + chartHeight - chartHeight * rate;
            const money = moneyMax * rate;
            const lineValue = lineMax * rate;
            return (
              <g key={rate}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--chart-grid-strong)" strokeWidth="1" />
                <text x={left - 8} y={y + 4} textAnchor="end" className="report-chart-axis">{compactCurrency(money)}</text>
                <text x={width - right + 8} y={y + 4} textAnchor="start" className="report-chart-axis">{rate === 1 && rawLineMax > lineMax ? `>${formatLineValue(lineValue)}` : formatLineValue(lineValue)}</text>
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

          <path d={linePath} fill="none" stroke="var(--c-danger)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {sorted.map((row, index) => (
            <g key={`${row.key}-points`}>
              <circle cx={xCenter(index)} cy={yLine(row[lineMetric])} r="3" fill="var(--c-danger)" />
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
          <span><i className="line" style={{ background: 'var(--c-danger)' }} />{lineLabel}</span>
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
  startDate: string;
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
  previousStart: string;
  previousEnd: string;
};

function PromotionPerformanceSection({ title, rows, showRegistration = false }: { title: string; rows: PromotionPerformanceRow[]; showRegistration?: boolean }) {
  const visibleRows = rows.filter(row => hasReportPerformance(row.target));
  const first = visibleRows[0] || rows[0];
  return (
    <section className="section">
      <div className="section-head">
        <b>{title}</b>
        <span className="muted">
          대상 {first ? formatPromotionPeriodLabel(first.targetStart, first.targetEnd) : '-'} 대비 이전 {first ? formatPromotionPeriodLabel(first.previousStart, first.previousEnd) : '-'}
        </span>
      </div>
      <div className="table-wrap sticky-detail">
        <table className="promotion-performance-table promotion-stacked-table">
          <thead>
            <tr>
              <th>그룹</th>
              <PromotionComparisonHeaders showRegistration={showRegistration} />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <React.Fragment key={row.label}>
                <tr className={index === 0 && row.label === '전체 성과' ? 'report-total-row' : ''}>
                  <td>{row.label}</td>
                  <PromotionComparisonCells row={row.total} showRegistration={showRegistration} />
                </tr>
                <tr className="promotion-target-row">
                  <td>대상 기간</td>
                  <PromotionComparisonCells row={row.target} showRegistration={showRegistration} />
                </tr>
                <tr className="promotion-period-row">
                  <td>이전 기간</td>
                  <PromotionComparisonCells row={row.previous} showRegistration={showRegistration} />
                </tr>
                <tr className="promotion-pop-row">
                  <td>PoP Diff</td>
                  <PromotionComparisonDiffCells current={row.target} previous={row.previous} showRegistration={showRegistration} />
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoricalPerformanceTable({ title, rows }: { title: string; rows: ReportSummary[] }) {
  const visibleRows = rows.filter(hasReportPerformance);
  return (
    <section className="section">
      <div className="section-head">
        <b>{title}</b>
        <span className="muted">전체 데이터 기준 월별 효율</span>
      </div>
      <div className="table-wrap sticky-detail">
        <table>
          <thead>
            <tr>
              <th>기간</th>
              <MetricHeaders />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => (
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

function PromotionComparisonHeaders({ showRegistration = false }: { showRegistration?: boolean }) {
  return (
    <>
      <th>광고비</th>
      <th>매출</th>
      <th>노출</th>
      <th>클릭</th>
      <th>전환</th>
      <th>장바구니</th>
      {showRegistration && (
        <>
          <th>회원가입수</th>
          <th>회원가입 CPA</th>
        </>
      )}
      <th>CTR</th>
      <th>CVR</th>
      <th>CPC</th>
      <th>CPA</th>
      <th>ROAS</th>
    </>
  );
}

function PromotionComparisonCells({ row, showRegistration = false }: { row: ReportSummary; showRegistration?: boolean }) {
  return (
    <>
      <td>{formatCurrency(row.spend)}</td>
      <td>{formatCurrency(row.sales)}</td>
      <td>{formatInteger(row.impressions)}</td>
      <td>{formatInteger(row.clicks)}</td>
      <td>{formatInteger(row.conversions)}</td>
      <td>{formatInteger(row.addToCart)}</td>
      {showRegistration && (
        <>
          <td>{formatInteger(row.registration)}</td>
          <td>{formatCurrency(safeRatio(row.spend, row.registration))}</td>
        </>
      )}
      <td>{formatPercent(row.ctr)}</td>
      <td>{formatPercent(row.cvr)}</td>
      <td>{formatCurrency(row.cpc)}</td>
      <td>{formatCurrency(row.cpa)}</td>
      <td>{row.roas.toFixed(2)}</td>
    </>
  );
}

function PromotionComparisonDiffCells({ current, previous, showRegistration = false }: { current: ReportSummary; previous: ReportSummary; showRegistration?: boolean }) {
  return (
    <>
      <PromotionDiffCell current={current.spend} previous={previous.spend} />
      <PromotionDiffCell current={current.sales} previous={previous.sales} />
      <PromotionDiffCell current={current.impressions} previous={previous.impressions} />
      <PromotionDiffCell current={current.clicks} previous={previous.clicks} />
      <PromotionDiffCell current={current.conversions} previous={previous.conversions} />
      <PromotionDiffCell current={current.addToCart} previous={previous.addToCart} />
      {showRegistration && (
        <>
          <PromotionDiffCell current={current.registration} previous={previous.registration} />
          <PromotionDiffCell current={safeRatio(current.spend, current.registration)} previous={safeRatio(previous.spend, previous.registration)} inverse />
        </>
      )}
      <PromotionDiffCell current={current.ctr} previous={previous.ctr} />
      <PromotionDiffCell current={current.cvr} previous={previous.cvr} />
      <PromotionDiffCell current={current.cpc} previous={previous.cpc} />
      <PromotionDiffCell current={current.cpa} previous={previous.cpa} />
      <PromotionDiffCell current={current.roas} previous={previous.roas} />
    </>
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

function PromotionDiffCell({ current, previous, inverse = false }: { current: number; previous: number; inverse?: boolean }) {
  if (!previous) return <td className="muted">-</td>;
  const rate = (current - previous) / previous;
  const arrow = rate >= 0 ? '▲' : '▼';
  const good = inverse ? rate <= 0 : rate >= 0;
  return <td className={good ? 'diff-up' : 'diff-down'}>{arrow}{Math.abs(rate * 100).toFixed(2)}%</td>;
}

function formatPromotionPeriodLabel(start: string, end: string): string {
  if (!start && !end) return '-';
  if (start === end) return start;
  return `${start || '-'} ~ ${end || '-'}`;
}

function RecentWeeklyPerformanceTable({ data, comparisonLabel }: { data: RecentWeeklyData; comparisonLabel?: string }) {
  const visibleRows = data.rows.filter(hasReportPerformance);
  return (
    <section className="section">
      <div className="section-head">
        <b>주차별 성과</b>
        <PeriodBadge label={comparisonLabel || ''} />
        <span className="muted">전월 1주차부터 최신 주차까지 · {data.start || '-'} ~ {data.end || '-'}</span>
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
            {visibleRows.map(row => (
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

function YearDailyPerformanceTable({
  data,
  comparisonLabel,
  showRegistration = false
}: {
  data: YearDailyData;
  comparisonLabel?: string;
  showRegistration?: boolean;
}) {
  const visibleGroups = useMemo(() => data.groups
    .map(group => ({
      ...group,
      days: group.days.filter(hasReportPerformance)
    }))
    .filter(group => hasReportPerformance(group.total) || group.days.length > 0), [data.groups]);
  const defaultOpen = useMemo(() => new Set(visibleGroups.filter(group => group.isCurrentMonth).map(group => group.key)), [visibleGroups]);
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
        <span className="muted">전체 데이터 · {data.startDate || '-'} ~ {data.latestDate || '-'}</span>
      </div>
      <div className="table-wrap sticky-detail">
        <table>
          <thead>
            <tr>
              <th>일자</th>
              <MetricHeaders showRegistration={showRegistration} />
            </tr>
          </thead>
          <tbody>
            <tr className="report-total-row">
              <td>{data.year || '-'} TOTAL</td>
              <MetricCells row={data.total} showRegistration={showRegistration} />
            </tr>
            {visibleGroups.map(group => {
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
                    <MetricCells row={group.total} showRegistration={showRegistration} />
                  </tr>
                  {isOpen && group.days.map(day => (
                    <tr key={day.key}>
                      <td>{day.label}</td>
                      <MetricCells row={day} showRegistration={showRegistration} />
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

function MetricHeaders({ showRegistration = false }: { showRegistration?: boolean }) {
  return (
    <>
      <th>광고비</th>
      <th>매출</th>
      <th>노출</th>
      <th>클릭</th>
      <th>전환</th>
      <th>장바구니</th>
      {showRegistration && (
        <>
          <th>회원가입수</th>
          <th>회원가입 CPA</th>
        </>
      )}
      <th>CTR</th>
      <th>CVR</th>
      <th>CPC</th>
      <th>CPA</th>
      <th>ROAS</th>
    </>
  );
}

function MetricCells({ row, showRegistration = false }: { row: ReportSummary; showRegistration?: boolean }) {
  return (
    <>
      <td>{formatCurrency(row.spend)}</td>
      <td>{formatCurrency(row.sales)}</td>
      <td>{formatInteger(row.impressions)}</td>
      <td>{formatInteger(row.clicks)}</td>
      <td>{formatInteger(row.conversions)}</td>
      <td>{formatInteger(row.addToCart)}</td>
      {showRegistration && (
        <>
          <td>{formatInteger(row.registration)}</td>
          <td>{formatCurrency(safeRatio(row.spend, row.registration))}</td>
        </>
      )}
      <td>{formatPercent(row.ctr)}</td>
      <td>{formatPercent(row.cvr)}</td>
      <td>{formatCurrency(row.cpc)}</td>
      <td>{formatCurrency(row.cpa)}</td>
      <td>{row.roas.toFixed(2)}</td>
    </>
  );
}

function hasReportPerformance(row: ReportSummary): boolean {
  return [
    row.spend,
    row.grossSpend,
    row.sales,
    row.impressions,
    row.clicks,
    row.conversions,
    row.addToCart,
    row.registration,
    row.lead,
    row.order
  ].some(value => Math.abs(Number(value) || 0) > 0);
}

function SummaryTable({
  title,
  rows,
  previousRows = [],
  limit,
  sortByLabel = false,
  showComparisonRows = false,
  comparisonLabel,
  creativeAssets
}: {
  title: string;
  rows: ReportSummary[];
  previousRows?: ReportSummary[];
  limit: number;
  sortByLabel?: boolean;
  showComparisonRows?: boolean;
  comparisonLabel?: string;
  creativeAssets?: Record<string, CreativeAssetDoc>;
}) {
  const [creativePreview, setCreativePreview] = useState<{ src: string; label: string } | null>(null);
  const previousByKey = new Map(previousRows.map(row => [row.key, row]));
  const displayRows = rows
    .filter(hasReportPerformance)
    .sort((a, b) => sortByLabel ? a.key.localeCompare(b.key) : b.spend - a.spend || a.label.localeCompare(b.label));
  return (
    <section className="section">
      <div className="section-head">
        <PeriodBadge label={comparisonLabel || ''} />
        <b>{title}</b>
        <span className="muted">총 {displayRows.length.toLocaleString()}개 그룹 중 {Math.min(displayRows.length, limit).toLocaleString()}개 표시</span>
      </div>
      <div className="table-wrap sticky-detail">
        <table>
          <thead>
            <tr>
              <th>그룹</th>
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
            </tr>
          </thead>
          <tbody>
            {displayRows.slice(0, limit).map(row => {
              const previous = previousByKey.get(row.key);
              const showPrevious = showComparisonRows && previous;
              return (
                <React.Fragment key={row.key}>
                  <tr>
                    <td title={row.label}>
                      {creativeAssets
                        ? (
                          <CreativeGroupCell
                            row={row}
                            asset={creativeAssets[row.key] || creativeAssets[creativeIdentityIndexKey(row.key)]}
                            onPreview={(src, label) => setCreativePreview({ src, label })}
                          />
                        )
                        : trim(row.label, 44)}
                    </td>
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
                  </tr>
                  {showPrevious && (
                    <tr className="report-previous-row">
                      <td>이전 기간</td>
                      <td>{formatCurrency(previous.spend)}</td>
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
      {creativePreview && (
        <CreativeImagePreview
          src={creativePreview.src}
          label={creativePreview.label}
          onClose={() => setCreativePreview(null)}
        />
      )}
    </section>
  );
}

function CreativeGroupCell({
  row,
  asset,
  onPreview
}: {
  row: ReportSummary;
  asset?: CreativeAssetDoc;
  onPreview: (src: string, label: string) => void;
}) {
  const src = asset?.imageData || asset?.sourceImageUrl || '';
  return (
    <div className="creative-performance-cell">
      {src ? (
        <button
          type="button"
          className="creative-thumbnail-button"
          aria-label={`${row.label} 이미지 크게 보기`}
          title="이미지 크게 보기"
          onClick={() => onPreview(src, row.label)}
        >
          <span className="creative-thumbnail-slot">
            <img src={src} alt="" loading="lazy" />
          </span>
        </button>
      ) : <span className="creative-thumbnail-slot empty" />}
      <span>{trim(row.label, 44)}</span>
    </div>
  );
}

function CreativeImagePreview({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      className="creative-preview-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} 이미지 미리보기`}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="creative-preview-panel">
        <button
          type="button"
          className="creative-preview-close"
          aria-label="미리보기 닫기"
          title="닫기"
          autoFocus
          onClick={onClose}
        >
          ×
        </button>
        <div className="creative-preview-image-wrap">
          <img src={src} alt={label} />
        </div>
        <div className="creative-preview-caption" title={label}>{label}</div>
      </div>
    </div>
  );
}

function PeriodBadge({ label }: { label: string }) {
  if (!label) return null;
  return <span className="report-period-badge">{label}</span>;
}

function formatRegistrationMergeNotice(stats: RegistrationMergeStats, sheetName: string): string {
  return [
    `회원가입수 적용 완료: ${formatInteger(stats.appliedTotal)}건`,
    `매칭 행 ${stats.matchedRows.toLocaleString()}개`,
    `미매칭 키 ${stats.unmatchedKeys.toLocaleString()}개`,
    `시트 ${sheetName}`
  ].join(' · ');
}

function isMetaReportFile(file: ReportFileDoc): boolean {
  const sheetName = normalizeSearchText(file.result?.sheet?.sheetName || '');
  const filename = normalizeSearchText(file.filename || file.result?.fileName || '');
  return sheetName === 'meta api' || filename.startsWith('meta api');
}

function indexCreativeAssets(assets: CreativeAssetDoc[]): Record<string, CreativeAssetDoc> {
  return assets.reduce<Record<string, CreativeAssetDoc>>((acc, asset) => {
    if (asset.key) {
      acc[asset.key] = asset;
      acc[creativeIdentityIndexKey(asset.key)] ||= asset;
    }
    return acc;
  }, {});
}

function creativeIdentityIndexKey(key: string): string {
  return `identity|||${key.split('|||').slice(1).join('|||')}`;
}

function makeCollectorToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `gfu_collector_${Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function filterReportResultRows(
  result: ReportParseResult,
  predicate: (row: NormalizedReportRow) => boolean,
  sheetName = result.sheet.sheetName
): ReportParseResult {
  const rows = result.rows.filter(predicate);
  return {
    ...result,
    sheet: {
      ...result.sheet,
      sheetName,
      rowCount: rows.length
    },
    rows,
    preview: rows.slice(0, 12)
  };
}

function applyGrossSpendRule(result: ReportParseResult): ReportParseResult {
  const rows = result.rows.map(row => ({
    ...row,
    grossCostKrw: row.costKrw ? toGrossCostKrw(row.costKrw, row.date) : row.grossCostKrw
  }));
  return {
    ...result,
    rows,
    preview: rows.slice(0, 12)
  };
}

function combineReportResults(singleOneResult: ReportParseResult | null, metaResult: ReportParseResult | null): ReportParseResult | null {
  if (!singleOneResult && !metaResult) return null;
  const base = metaResult || singleOneResult;
  if (!base) return null;

  const rows = [
    ...(metaResult?.rows || []),
    ...(singleOneResult?.rows || [])
  ];
  if (!rows.length) return null;

  const fileName = [
    metaResult?.fileName,
    singleOneResult?.fileName
  ].filter(Boolean).join(' + ');

  return {
    ...base,
    fileName: fileName || base.fileName,
    sheet: {
      ...base.sheet,
      sheetName: metaResult && singleOneResult ? 'Meta API + SingleOne' : base.sheet.sheetName,
      rowCount: rows.length
    },
    detections: singleOneResult?.detections || base.detections,
    rows,
    preview: rows.slice(0, 12),
    issues: [
      ...(metaResult?.issues || []),
      ...(singleOneResult?.issues || [])
    ],
    exchangeRate: metaResult?.exchangeRate || singleOneResult?.exchangeRate || base.exchangeRate,
    generatedAt: Math.max(metaResult?.generatedAt || 0, singleOneResult?.generatedAt || 0, base.generatedAt || 0)
  };
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
  const start = new Date(latest.getFullYear(), latest.getMonth() - 1, 1);
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
    return { year: 0, startDate: '', latestDate: '', total: summarizeReportRows('TOTAL', 'TOTAL', []), groups: [] };
  }
  const sortedDates = rows.map(row => row.date).filter(Boolean).sort();
  const startDate = sortedDates[0] || latestDate;
  const first = parseIsoDate(startDate);
  const latest = parseIsoDate(latestDate);
  const year = latest.getFullYear();
  const rowsInRange = rows.filter(row => row.date >= startDate && row.date <= latestDate);
  const rowsByDate = new Map<string, NormalizedReportRow[]>();

  for (const row of rowsInRange) {
    const list = rowsByDate.get(row.date) || [];
    list.push(row);
    rowsByDate.set(row.date, list);
  }

  const groups: YearDailyGroup[] = [];
  for (const monthDate = new Date(first.getFullYear(), first.getMonth(), 1); monthDate <= latest; monthDate.setMonth(monthDate.getMonth() + 1)) {
    const monthYear = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const monthStart = new Date(monthYear, month, monthYear === first.getFullYear() && month === first.getMonth() ? first.getDate() : 1);
    const monthEnd = monthYear === latest.getFullYear() && month === latest.getMonth() ? latest : new Date(monthYear, month + 1, 0);
    const key = `${monthYear}-${String(month + 1).padStart(2, '0')}`;
    const days: ReportSummary[] = [];

    for (const date = new Date(monthStart); date <= monthEnd; date.setDate(date.getDate() + 1)) {
      const iso = toIsoDate(date);
      days.push(summarizeReportRows(iso, iso, rowsByDate.get(iso) || []));
    }

    groups.push({
      key,
      label: `${monthYear}년 ${month + 1}월`,
      isCurrentMonth: monthYear === latest.getFullYear() && month === latest.getMonth(),
      total: summarizeReportRows(`${key}-TOTAL`, `${monthYear}년 ${month + 1}월 TOTAL`, rowsInRange.filter(row => row.date.startsWith(key))),
      days
    });
  }

  return {
    year,
    startDate,
    latestDate,
    total: summarizeReportRows('ALL-DAYS-TOTAL', '전체 데이터 TOTAL', rowsInRange),
    groups
  };
}

function buildPromotionPerformanceRows(
  rows: NormalizedReportRow[],
  targetRows: NormalizedReportRow[],
  previousRows: NormalizedReportRow[],
  targetStart: string,
  targetEnd: string,
  previousStart: string,
  previousEnd: string,
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
      targetEnd,
      previousStart,
      previousEnd
    }));
}

function buildHistoricalSubTabRows(rows: NormalizedReportRow[], subTab: PromotionSubTab): ReportSummary[] {
  const grouped = new Map<string, NormalizedReportRow[]>();
  for (const row of rows) {
    if (!matchesPromotionSubTab(row, 'qoo10', subTab)) continue;
    const key = row.date.slice(0, 7);
    if (!key) continue;
    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, list]) => {
      const [year, month] = key.split('-');
      return summarizeReportRows(key, `${year}년 ${Number(month)}월`, list);
    });
}

function historicalSubTabTitle(subTab: PromotionSubTab): string {
  if (subTab === 'megawari') return '역대 메가와리 효율';
  if (subTab === 'megapo') return '역대 메가포 효율';
  if (subTab === 'market') return '역대 마켓 효율';
  return '';
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
  targetEnd: string,
  previousStart: string,
  previousEnd: string
): PromotionPerformanceRow[] {
  const groups = new Map<string, NormalizedReportRow[]>();
  for (const row of rows) {
    const label = campaignNameLabel(row);
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

  return top.map(([label, list]) => buildPromotionPerformanceRow(label, list, targetRows, previousRows, targetStart, targetEnd, previousStart, previousEnd));
}

function buildPromotionPerformanceRow(
  label: string,
  rows: NormalizedReportRow[],
  targetRows: NormalizedReportRow[],
  previousRows: NormalizedReportRow[],
  targetStart: string,
  targetEnd: string,
  previousStart: string,
  previousEnd: string
): PromotionPerformanceRow {
  const labels = new Set(rows.map(row => campaignNameLabel(row)));
  const targetGroupRows = targetRows.filter(row => labels.has(campaignNameLabel(row)));
  const previousGroupRows = previousRows.filter(row => labels.has(campaignNameLabel(row)));
  return {
    label,
    total: summarizeReportRows(`${label}-total`, label, rows),
    target: summarizeReportRows(`${label}-target`, label, targetGroupRows),
    previous: summarizeReportRows(`${label}-previous`, label, previousGroupRows),
    targetStart,
    targetEnd,
    previousStart,
    previousEnd
  };
}

function campaignNameLabel(row: NormalizedReportRow): string {
  return row.campaignName || '미분류 캠페인';
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
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function textIncludesAny(value: string, keywords: string[]): boolean {
  const text = normalizeSearchText(value);
  const compactText = text.replace(/\s+/g, '');
  return keywords.some(keyword => {
    const normalized = normalizeSearchText(keyword);
    return text.includes(normalized) || compactText.includes(normalized.replace(/\s+/g, ''));
  });
}

function adIdentityText(row: NormalizedReportRow): string {
  return normalizeSearchText(`${row.campaignName} ${row.adgroupName} ${row.adName}`);
}

function isExcludedAmazonRow(row: NormalizedReportRow): boolean {
  return adIdentityText(row).includes('amazon');
}

function matchesMarketplaceTab(row: NormalizedReportRow, tab: MarketplaceTab): boolean {
  if (tab === 'qoo10') return isQoo10LandingRow(row);
  if (tab === 'owned') return isOwnedLandingRow(row);
  return false;
}

function matchesPromotionSubTab(row: NormalizedReportRow, marketplace: MarketplaceTab, tab: PromotionSubTab): boolean {
  const text = adIdentityText(row);
  const fullText = normalizeSearchText(`${row.promotion} ${row.campaignName} ${row.adgroupName} ${row.adName}`);
  if (tab === 'total') return true;

  if (marketplace === 'owned') {
    const isHybrid = text.includes('hybrid');
    if (tab === 'hybrid') return isHybrid;
    if (tab === 'always') return !isHybrid;
    return false;
  }

  const isMegawari = textIncludesAny(fullText, ['메가와리', 'megawari', 'mega wari']);
  const isMegapo = textIncludesAny(fullText, ['메가포', 'megapo', 'mega po']);
  const isMarket = text.includes('market');
  const isLive = text.includes('live');
  if (tab === 'live') return isLive;
  if (tab === 'market') return !isLive && isMarket;
  if (tab === 'megawari') return !isLive && !isMarket && isMegawari && !isMegapo;
  if (tab === 'megapo') return !isLive && !isMarket && isMegapo && !isMegawari;
  if (tab === 'always') return !isLive && !isMarket && !isMegawari && !isMegapo;
  return false;
}

function isQoo10LandingRow(row: NormalizedReportRow): boolean {
  const text = adLandingText(row);
  return textIncludesAny(text, ['qoo10', 'qoo 10', 'q10', '큐텐']) || (isSingleOneUploadRow(row) && !text.includes('wish'));
}

function isOwnedLandingRow(row: NormalizedReportRow): boolean {
  const text = adLandingText(row);
  return !isQoo10LandingRow(row) && text.includes('wish');
}

function adLandingText(row: NormalizedReportRow): string {
  return adIdentityText(row);
}

function isSingleOneUploadRow(row: NormalizedReportRow): boolean {
  return row.media.trim().toLowerCase().startsWith('s-');
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
