'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, completeRedirectLogin, firebaseAuthErrorMessage, logout, signInWithGoogleSafe } from '@/lib/firebase';
import { buildReportView, filterRowsByPeriod, previousMatchingPeriod } from '@/lib/report/aggregate';
import { makeCreativeKey } from '@/lib/report/creativeKey';
import { DEFAULT_EXCHANGE_RATE, toGrossCostKrw, type CommissionSetting } from '@/lib/report/schema';
import { loadReportFromXlsx } from '@/lib/report/sources';
import {
  buildXReportDailyRows,
  parseXReportFile,
  summarizeXReportRows,
  type XReportParseResult,
  type XReportRow,
  type XReportSummary
} from '@/lib/report/xReport';
import {
  createBrand,
  emptyKpi,
  findBrandByShareToken,
  getKpi,
  getReportComment,
  getReportFile,
  getSingleOneCollectorSettings,
  getXReportFile,
  isAdminEmail,
  listCreativeAssets,
  listBrandsForAdmin,
  listReportFiles,
  listTabs,
  listXReportFiles,
  saveKpi,
  saveSingleOneCollectorSettings,
  saveNoteHistory,
  saveReportComment,
  saveReportFile,
  saveXReportFile,
  upsertCreativeAssets,
  updateBrand
} from '@/lib/store';
import { applyBrandColor, randomBrandColor } from '@/lib/brandColor';
import { errorMessage } from '@/lib/dashUtils';
import { DAILY_TOPLINE_METRIC_LABELS, type Brand, type BrandPatch, type CreativeAssetDoc, type DailyToplineMetric, type DashboardTab, type Kpi, type ReportCommentDoc, type ReportFileDoc, type ReportTabKey, type SingleOneCollectorSettings, type SpendBasis } from '@/lib/types';
import { Empty } from '../components/Empty';
import {
  DirectCreativeUploadModal,
  ImageImportSourceModal,
  type CreativeUploadTarget,
  type PreparedCreativeUpload
} from '../components/CreativeImageImportModal';
import { MetaCreativeFilterModal, type MetaCreativeSelection } from '../components/MetaCreativeFilterModal';
import { MetaFilterModal } from '../components/MetaFilterModal';
import { SettingsModal, type SettingsMode } from '../components/SettingsModal';
import { NoteHistoryButton } from '../components/NoteHistoryModal';
import { RichText, RichTextEditor } from '../components/RichText';
import type {
  NormalizedReportRow,
  ReportComparisonMetric,
  ReportParseResult,
  ReportSummary,
  ReportView
} from '@/lib/report/reportTypes';

type MarketplaceTab = 'qoo10' | 'owned';
type PromotionSubTab = 'total' | 'always' | 'megawari' | 'megapo' | 'market' | 'live' | 'hybrid';
type ReportTab = ReportTabKey;
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
  const [selectedXlsxReportFileId, setSelectedXlsxReportFileId] = useState('');
  const [selectedMetaReportFileId, setSelectedMetaReportFileId] = useState('');
  const [reportComment, setReportComment] = useState<ReportCommentDoc | null>(null);
  const [creativeAssets, setCreativeAssets] = useState<Record<string, CreativeAssetDoc>>({});
  const [commentEditing, setCommentEditing] = useState(false);
  const [commentBusy, setCommentBusy] = useState('');
  // 저장할 때마다 올려서 캘린더 이력을 다시 읽게 한다.
  const [commentHistoryKey, setCommentHistoryKey] = useState(0);
  const [metaImportOpen, setMetaImportOpen] = useState(false);
  const [imageImportSourceOpen, setImageImportSourceOpen] = useState(false);
  const [metaImageImportOpen, setMetaImageImportOpen] = useState(false);
  const [directImageImportOpen, setDirectImageImportOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsMode>('none');
  const [collectorOpen, setCollectorOpen] = useState(false);
  const [collectorSettings, setCollectorSettings] = useState<SingleOneCollectorSettings | null>(null);
  const [xlsxResult, setXlsxResult] = useState<ReportParseResult | null>(null);
  const [xReportResult, setXReportResult] = useState<XReportParseResult | null>(null);
  const [metaResult, setMetaResult] = useState<ReportParseResult | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>('total');
  const [activeSubTab, setActiveSubTab] = useState<PromotionSubTab>('always');
  const [spendBasis, setSpendBasis] = useState<SpendBasis>('gross');
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [comparisonStart, setComparisonStart] = useState('');
  const [comparisonEnd, setComparisonEnd] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [campaignFilter, setCampaignFilter] = useState<string[]>([]);
  const [adgroupFilter, setAdgroupFilter] = useState<string[]>([]);
  const [adFilter, setAdFilter] = useState<string[]>([]);
  const [authError, setAuthError] = useState('');
  const preferenceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyShareLink = useCallback((targetBrand: Brand) => {
    const url = buildReportShareUrl(location.origin, targetBrand, spendBasis, exchangeRate);
    navigator.clipboard.writeText(url).then(() => alert('공유 링크를 복사했습니다.'));
  }, [exchangeRate, spendBasis]);

  useEffect(() => {
    applyBrandColor(brand?.color || null);
  }, [brand?.color]);

  const resetReportState = useCallback(() => {
    setXlsxResult(null);
    setMetaResult(null);
    setXReportResult(null);
    setSelectedXlsxReportFileId('');
    setSelectedMetaReportFileId('');
    setReportComment(null);
    setCreativeAssets({});
    setCommentEditing(false);
    setPeriodStart('');
    setPeriodEnd('');
    setComparisonStart('');
    setComparisonEnd('');
    setCampaignFilter([]);
    setAdgroupFilter([]);
    setAdFilter([]);
    setNotice('');
  }, []);

  const applyReportResult = useCallback((
    nextResult: ReportParseResult | null,
    createdAt: number | undefined,
    source: ReportSourceType,
    options: { activate?: boolean; updatePeriod?: boolean } = {}
  ) => {
    const scopedResult = source === 'xlsx' && nextResult
      ? filterReportResultRows(nextResult, isSingleOneUploadRow, 'SingleOne Upload')
      : nextResult;

    if (source === 'meta') setMetaResult(scopedResult);
    else setXlsxResult(scopedResult);

    const activate = options.activate ?? true;
    const updatePeriod = options.updatePeriod ?? true;
    if (activate) setActiveTab('total');
    setCampaignFilter([]);
    setAdgroupFilter([]);
    setAdFilter([]);
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

  const loadBrandContext = useCallback(async (
    target: Brand | null,
    preferences: Partial<Pick<Brand, 'spendBasis' | 'exchangeRate'>> = {}
  ) => {
    setBrand(target);
    if (!target) {
      setSpendBasis('gross');
      setExchangeRate(DEFAULT_EXCHANGE_RATE);
      setDashboardTabs([]);
      setDashboardTab(null);
      setKpi(emptyKpi);
      resetReportState();
      return;
    }

    setSpendBasis(preferences.spendBasis ?? target.spendBasis);
    setExchangeRate(preferences.exchangeRate ?? target.exchangeRate);

    const loadedTabs = await listTabs(target.id);
    const nextTab = loadedTabs[0] || null;
    setDashboardTabs(loadedTabs);
    setDashboardTab(nextTab);
    if (!nextTab) {
      setKpi(emptyKpi);
      resetReportState();
      return;
    }

    const [loadedKpi, loadedReportFiles, loadedCreativeAssets, loadedXReportFiles] = await Promise.all([
      getKpi(target.id, nextTab.id),
      listReportFiles(target.id, nextTab.id),
      listCreativeAssets(target.id, nextTab.id),
      listXReportFiles(target.id, nextTab.id)
    ]);
    setKpi(loadedKpi);
    setCreativeAssets(indexCreativeAssets(loadedCreativeAssets));

    const firstXReport = loadedXReportFiles[0] || null;
    setXReportResult(firstXReport ? (await getXReportFile(target.id, nextTab.id, firstXReport.id))?.result || null : null);

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
          const shareUrl = new URL(window.location.href);
          const shareToken = shareUrl.searchParams.get('share');
          const sharedBasis = parseSharedSpendBasis(shareUrl.searchParams.get('basis'));
          const sharedExchangeRate = parseSharedExchangeRate(shareUrl.searchParams.get('rate'));
          const sharedPreferences = {
            ...(sharedBasis ? { spendBasis: sharedBasis } : {}),
            ...(sharedExchangeRate ? { exchangeRate: sharedExchangeRate } : {})
          };

          if (admin) {
            const list = await listBrandsForAdmin();
            setBrands(list);
            const sharedBrand = shareToken
              ? list.find(item => item.shareToken === shareToken) || await findBrandByShareToken(shareToken)
              : null;
            await loadBrandContext(sharedBrand || list[0] || null, sharedPreferences);
          } else if (shareToken) {
            const found = await findBrandByShareToken(shareToken);
            setBrands(found ? [found] : []);
            await loadBrandContext(found, sharedPreferences);
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

  const adjustedXlsxResult = useMemo(
    () => applyExchangeRate(xlsxResult, exchangeRate, false),
    [exchangeRate, xlsxResult]
  );
  const adjustedMetaResult = useMemo(
    () => applyExchangeRate(metaResult, exchangeRate, true),
    [exchangeRate, metaResult]
  );
  const combinedResult = useMemo(
    () => combineReportResults(adjustedXlsxResult, adjustedMetaResult),
    [adjustedMetaResult, adjustedXlsxResult]
  );
  const commissionSetting = useMemo<CommissionSetting | undefined>(
    () => brand ? { commissionPercent: brand.commissionPercent, commissionRules: brand.commissionRules } : undefined,
    [brand?.commissionPercent, brand?.commissionRules]
  );
  const result = useMemo(() => {
    if (!combinedResult) return combinedResult;
    const grossResult = applyGrossSpendRule(combinedResult, commissionSetting);
    if (spendBasis === 'gross') return grossResult;
    const rows = grossResult.rows.map(row => ({ ...row, grossCostKrw: row.costKrw }));
    return { ...grossResult, rows, preview: rows.slice(0, 12) };
  }, [combinedResult, commissionSetting, spendBasis]);
  const selectedReportFileId = selectedXlsxReportFileId || selectedMetaReportFileId;

  /** 그로스/넷 토글과 브랜드 수수료율을 적용한 X RAW 행. X 성과 섹션과 보고서 행이 같은 값을 본다. */
  const xRows = useMemo<XReportRow[]>(() => {
    if (!xReportResult) return [];
    return xReportResult.rows.map(row => ({
      ...row,
      spend: spendBasis === 'gross' ? toGrossCostKrw(row.spend, row.date, commissionSetting) : row.spend
    }));
  }, [commissionSetting, spendBasis, xReportResult]);

  /**
   * 보고서 전체가 보는 원본 행. X RAW 파일이 올라와 있으면 그 파일이 X의 기준이므로
   * SingleOne RAW의 media=X 행을 빼고 X RAW 행을 캠페인으로 바꿔 넣는다.
   */
  const sourceRows = useMemo<NormalizedReportRow[]>(() => {
    const rawRows = result?.rows || [];
    if (!xRows.length) return rawRows;
    return [
      ...rawRows.filter(row => !isXMediaRow(row)),
      ...xRows.map((row, index) => toReportRowFromX(row, index, row.spend))
    ];
  }, [result, xRows]);

  const dates = useMemo(() => {
    const list = sourceRows.map(row => row.date).filter(Boolean).sort();
    return { min: list[0] || '', max: list[list.length - 1] || '' };
  }, [sourceRows]);

  const activeMarketplace = useMemo(() => marketplaceTabs.find(tab => tab.id === activeTab), [activeTab]);
  const visibleTabs = useMemo(
    () => tabs.filter(tab => brand?.visibleReportTabs.includes(tab.id) ?? true),
    [brand?.visibleReportTabs]
  );
  const activeSubTabs = activeMarketplace ? marketplaceSubTabs[activeMarketplace.id] : [];
  const activeSubTabLabel = activeSubTabs.find(tab => tab.id === activeSubTab)?.label || '';
  const activeMarketplaceTitle = activeMarketplace ? `${activeMarketplace.label} ${activeSubTabLabel}`.trim() : '';

  useEffect(() => {
    if (!activeMarketplace || activeSubTabs.some(tab => tab.id === activeSubTab)) return;
    setActiveSubTab(activeSubTabs[0]?.id || 'total');
  }, [activeMarketplace, activeSubTab, activeSubTabs]);

  useEffect(() => {
    if (visibleTabs.some(tab => tab.id === activeTab)) return;
    if (visibleTabs[0]) setActiveTab(visibleTabs[0].id);
  }, [activeTab, visibleTabs]);

  const periodRows = useMemo(() => {
    if (!result) return [];
    return filterRowsByPeriod(sourceRows.filter(row => !isExcludedAmazonRow(row)), periodStart || dates.min, periodEnd || dates.max);
  }, [dates.max, dates.min, periodEnd, periodStart, result, sourceRows]);

  const optionRows = useMemo(() => {
    if (!activeMarketplace) return periodRows;
    return periodRows.filter(row => matchesMarketplaceTab(row, activeMarketplace.id) && matchesPromotionSubTab(row, activeMarketplace.id, activeSubTab));
  }, [activeMarketplace, activeSubTab, periodRows]);

  const campaignOptions = useMemo(() => uniqueLabels(optionRows, row => row.campaignName), [optionRows]);
  const adgroupOptions = useMemo(() => {
    return uniqueLabels(optionRows.filter(row => matchesSelectedValues(row.campaignName, campaignFilter)), row => row.adgroupName);
  }, [campaignFilter, optionRows]);
  const adOptions = useMemo(() => {
    return uniqueLabels(
      optionRows.filter(row => matchesSelectedValues(row.campaignName, campaignFilter) && matchesSelectedValues(row.adgroupName, adgroupFilter)),
      row => row.adName
    );
  }, [adgroupFilter, campaignFilter, optionRows]);

  useEffect(() => {
    setCampaignFilter(current => retainAvailableSelections(current, campaignOptions));
    setAdgroupFilter(current => retainAvailableSelections(current, adgroupOptions));
    setAdFilter(current => retainAvailableSelections(current, adOptions));
  }, [adOptions, adgroupOptions, campaignOptions]);

  const filteredRows = useMemo(() => {
    if (!result) return [];
    return sourceRows.filter(row => {
      if (isExcludedAmazonRow(row)) return false;
      if (activeMarketplace && (!matchesMarketplaceTab(row, activeMarketplace.id) || !matchesPromotionSubTab(row, activeMarketplace.id, activeSubTab))) return false;
      if (!matchesSelectedValues(row.campaignName, campaignFilter)) return false;
      if (!matchesSelectedValues(row.adgroupName, adgroupFilter)) return false;
      if (!matchesSelectedValues(row.adName, adFilter)) return false;
      return true;
    });
  }, [activeMarketplace, activeSubTab, adFilter, adgroupFilter, campaignFilter, result, sourceRows]);

  const marketplaceRows = useMemo(() => {
    if (!result || !activeMarketplace) return [];
    return sourceRows.filter(row => {
      if (isExcludedAmazonRow(row)) return false;
      if (!matchesMarketplaceTab(row, activeMarketplace.id)) return false;
      if (!matchesSelectedValues(row.campaignName, campaignFilter)) return false;
      if (!matchesSelectedValues(row.adgroupName, adgroupFilter)) return false;
      if (!matchesSelectedValues(row.adName, adFilter)) return false;
      return true;
    });
  }, [activeMarketplace, adFilter, adgroupFilter, campaignFilter, result, sourceRows]);

  const defaultComparison = useMemo(
    () => previousMatchingPeriod(periodStart || dates.min, periodEnd || dates.max),
    [dates.max, dates.min, periodEnd, periodStart]
  );

  /** 보고서 표·차트가 함께 보는 행. X RAW는 sourceRows 단계에서 이미 합쳐져 있다. */
  const viewRows = filteredRows;

  const reportView = useMemo(() => {
    if (!result) return null;
    return buildReportView(
      viewRows,
      periodStart || dates.min,
      periodEnd || dates.max,
      comparisonStart,
      comparisonEnd
    );
  }, [comparisonEnd, comparisonStart, dates.max, dates.min, periodEnd, periodStart, result, viewRows]);

  /** X 성과 섹션은 지금 화면에 들어와 있는 X 행만 보여준다. (탭·드롭다운·기간 선택을 그대로 따른다) */
  const xSectionRows = useMemo<XReportRow[]>(() => {
    if (!xRows.length) return [];
    const start = periodStart || dates.min;
    const end = periodEnd || dates.max;
    const selected = new Set(
      (reportView?.currentRows || []).filter(isXMediaRow).map(row => -row.sourceRowNumber - 1)
    );
    return xRows.filter((row, index) =>
      selected.has(index) && (!start || row.date >= start) && (!end || row.date <= end)
    );
  }, [dates.max, dates.min, periodEnd, periodStart, reportView, xRows]);

  /** 상단 KPI에 X가 더해졌을 때 그 사실을 밝히는 데 쓰는 X 합계. */
  const xKpiTotal = useMemo<XReportSummary | null>(() => {
    if (!xSectionRows.length) return null;
    return summarizeXReportRows('x-kpi', 'X', xSectionRows);
  }, [xSectionRows]);

  const creativeUploadTargets = useMemo<CreativeUploadTarget[]>(() => {
    const targets = new Map<string, CreativeUploadTarget>();
    for (const row of reportView?.currentRows || []) {
      if (!row.adName.trim()) continue;
      const key = makeCreativeKey(row);
      if (targets.has(key)) continue;
      targets.set(key, {
        key,
        label: row.adName,
        campaignName: row.campaignName,
        adgroupName: row.adgroupName,
        adName: row.adName,
        media: row.media
      });
    }
    return Array.from(targets.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [reportView?.currentRows]);

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
        throw new Error('업로드 파일에서 media가 s- 계열이거나 META/X인 SingleOne 행을 찾지 못했습니다.');
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
      setSelectedXlsxReportFileId(savedId);
      setReportComment(null);
      setCommentEditing(false);
      applyReportResult(parsed, createdAt, 'xlsx');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function handleXFile(file: File) {
    if (!brand || !dashboardTab || !isAdmin) {
      setError('파일 저장을 위해서는 관리자 로그인과 브랜드 선택이 필요합니다.');
      return;
    }
    setBusy('X RAW 데이터를 읽는 중입니다...');
    setError('');
    setNotice('');
    try {
      const parsed = await parseXReportFile(file);
      const detectedDates = parsed.rows.map(row => row.date).filter(Boolean).sort();
      const createdAt = Date.now();
      await saveXReportFile(brand.id, dashboardTab.id, {
        filename: file.name,
        fileSize: file.size,
        dateStart: detectedDates[0] || '',
        dateEnd: detectedDates[detectedDates.length - 1] || '',
        rowCount: parsed.rows.length,
        result: parsed,
        createdAt
      });
      setXReportResult(parsed);
      setNotice(`X RAW 적용 완료: ${parsed.rows.length.toLocaleString()}행 · ${detectedDates[0] || '-'} ~ ${detectedDates[detectedDates.length - 1] || '-'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function fetchReportFromMeta(adsetIds: string[], dateStart: string, dateEnd: string) {
    if (!brand || !dashboardTab || !user || !isAdmin) return;
    setMetaImportOpen(false);
    setBusy('Meta API에서 성과 데이터를 가져오는 중입니다...');
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
      const data = await readApiJsonResponse(resp);
      if (!resp.ok) throw new Error(data.error || 'Meta API 가져오기에 실패했습니다.');

      const loadedReportFiles = await listReportFiles(brand.id, dashboardTab.id);
      const saved = loadedReportFiles.find(file => file.id === data.fileId) || loadedReportFiles.find(file => isMetaReportFile(file)) || null;
      setSelectedMetaReportFileId(saved?.id || '');
      setReportComment(null);
      setCommentEditing(false);

      if (saved) {
        const loadedFile = await getReportFile(brand.id, dashboardTab.id, saved.id);
        applyReportResult(loadedFile?.result || null, loadedFile?.createdAt || saved.createdAt, 'meta');
      }
      setActiveTab('total');
      setActiveSubTab('total');
      setNotice(`Meta API 데이터 적용 완료: ${Number(data.rowCount || 0).toLocaleString()}행 · ${data.dateStart || '-'} ~ ${data.dateEnd || '-'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function fetchCreativeImagesFromMeta(ads: MetaCreativeSelection[], dateStart: string, dateEnd: string) {
    if (!brand || !dashboardTab || !user || !isAdmin) return;
    setMetaImageImportOpen(false);
    setBusy('Meta 소재 이미지를 불러오는 중입니다...');
    setError('');
    setNotice('');

    try {
      const pendingAds = ads.filter(ad => {
        const key = makeCreativeKey({
          media: 'Meta',
          campaignName: ad.campaignName,
          adgroupName: ad.adgroupName,
          adName: ad.adName
        });
        return !findCreativeAsset(creativeAssets, key);
      });
      const imageStats = {
        total: ads.length,
        skippedExisting: ads.length - pendingAds.length,
        saved: 0,
        failed: 0
      };
      let imageError = '';
      const imageBatches = chunkItems(pendingAds, 25);

      for (let index = 0; index < imageBatches.length; index += 1) {
        const batch = imageBatches[index];
        setBusy(`Meta 소재 이미지를 저장하는 중입니다... ${index + 1}/${imageBatches.length}`);
        try {
          const token = await user.getIdToken(index === 0);
          const response = await fetch('/api/report-meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              action: 'sync-creatives',
              brandId: brand.id,
              tabId: dashboardTab.id,
              creativeCandidates: batch
            })
          });
          const data = await readApiJsonResponse(response);
          if (!response.ok) throw new Error(data.error || 'Meta 소재 이미지 저장에 실패했습니다.');
          const batchStats = data.creativeImages || {};
          imageStats.skippedExisting += Number(batchStats.skippedExisting || 0);
          imageStats.saved += Number(batchStats.saved || 0);
          imageStats.failed += Number(batchStats.failed || 0);
        } catch (err) {
          imageStats.failed += batch.length;
          imageError = err instanceof Error ? err.message : String(err);
          if (/quota exceeded/i.test(imageError)) {
            const remaining = pendingAds.length - ((index + 1) * 25);
            imageStats.failed += Math.max(remaining, 0);
            break;
          }
        }
      }

      const loadedCreativeAssets = await listCreativeAssets(brand.id, dashboardTab.id);
      setCreativeAssets(indexCreativeAssets(loadedCreativeAssets));
      const failureSummary = imageStats.failed ? ` · ${imageStats.failed.toLocaleString()}개 실패` : '';
      const errorSummary = imageError ? ` · 이미지 오류: ${imageError}` : '';
      setNotice(
        `Meta 소재 이미지 적용 완료: ${dateStart} ~ ${dateEnd} · 선택 ${imageStats.total.toLocaleString()}개 · ${imageStats.saved.toLocaleString()}개 저장 · 기존 ${imageStats.skippedExisting.toLocaleString()}개 건너뜀${failureSummary}${errorSummary}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function uploadCreativeImagesDirectly(uploads: PreparedCreativeUpload[]) {
    if (!brand || !dashboardTab || !user || !isAdmin) {
      throw new Error('이미지 업로드를 위해서는 관리자 로그인과 브랜드 선택이 필요합니다.');
    }
    if (!uploads.length || uploads.length > 20) {
      throw new Error('이미지는 한 번에 1개 이상 20개 이하로 업로드해주세요.');
    }

    setBusy(`직접 업로드 이미지를 저장하는 중입니다... 0/${uploads.length}`);
    setError('');
    setNotice('');
    try {
      const now = Date.now();
      const uploadBatches = chunkItems(uploads, 5);
      for (let index = 0; index < uploadBatches.length; index += 1) {
        const batch = uploadBatches[index];
        setBusy(`직접 업로드 이미지를 저장하는 중입니다... ${Math.min((index + 1) * 5, uploads.length)}/${uploads.length}`);
        await upsertCreativeAssets(brand.id, dashboardTab.id, batch.map(upload => ({
          key: upload.key,
          source: 'upload',
          media: upload.media,
          campaignName: upload.campaignName,
          adgroupName: upload.adgroupName,
          adName: upload.adName,
          imageData: upload.imageData,
          sourceImageUrl: '',
          mimeType: upload.mimeType,
          width: upload.width,
          height: upload.height,
          imageHash: upload.imageHash,
          capturedAt: now
        })));
      }
      const loadedCreativeAssets = await listCreativeAssets(brand.id, dashboardTab.id);
      setCreativeAssets(indexCreativeAssets(loadedCreativeAssets));
      setDirectImageImportOpen(false);
      setNotice(`직접 업로드 이미지 적용 완료: ${uploads.length.toLocaleString()}개 소재`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw new Error(message);
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

  async function updateBrandFlow(brandId: string, patch: BrandPatch) {
    try {
      await updateBrand(brandId, patch);
      const list = await listBrandsForAdmin();
      setBrands(list);
      const updated = list.find(item => item.id === brandId);
      if (updated && brand?.id === brandId) {
        setBrand(updated);
        if (patch.spendBasis !== undefined) setSpendBasis(updated.spendBasis);
        if (patch.exchangeRate !== undefined) setExchangeRate(updated.exchangeRate);
      }
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
      await saveNoteHistory(brand.id, dashboardTab.id, 'comment', {
        text: nextText,
        periodStart,
        periodEnd
      });
      const saved = await getReportComment(brand.id, dashboardTab.id, selectedReportFileId);
      setReportComment(saved);
      setCommentHistoryKey(key => key + 1);
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

  const saveBrandReportPreferences = useCallback(async (
    patch: Pick<BrandPatch, 'spendBasis' | 'exchangeRate'>
  ) => {
    if (!brand || !isAdmin) return;
    const nextPatch: Pick<BrandPatch, 'spendBasis' | 'exchangeRate'> = {};
    if (patch.spendBasis !== undefined) nextPatch.spendBasis = patch.spendBasis;
    if (patch.exchangeRate !== undefined) {
      nextPatch.exchangeRate = Number.isFinite(patch.exchangeRate) && patch.exchangeRate > 0
        ? Math.round(patch.exchangeRate * 10000) / 10000
        : brand.exchangeRate;
    }
    try {
      await updateBrand(brand.id, nextPatch);
      setBrand(current => current?.id === brand.id
        ? { ...current, ...nextPatch }
        : current);
      setBrands(current => current.map(item => item.id === brand.id
        ? { ...item, ...nextPatch }
        : item));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [brand, isAdmin]);

  const scheduleExchangeRateSave = useCallback((nextExchangeRate: number) => {
    if (preferenceSaveTimerRef.current) clearTimeout(preferenceSaveTimerRef.current);
    preferenceSaveTimerRef.current = setTimeout(() => {
      preferenceSaveTimerRef.current = null;
      void saveBrandReportPreferences({ exchangeRate: nextExchangeRate });
    }, 500);
  }, [saveBrandReportPreferences]);

  useEffect(() => () => {
    if (preferenceSaveTimerRef.current) clearTimeout(preferenceSaveTimerRef.current);
  }, []);

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
            {brand && <button className="btn ghost" onClick={() => copyShareLink(brand)}>공유</button>}
            {brand && dashboardTab && (
              <label className="btn brand">
                RAW 업로드
                <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => event.target.files?.[0] && handleFile(event.target.files[0])} />
              </label>
            )}
            {brand && dashboardTab && (
              <label className="btn outline">
                X RAW 업로드
                <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => event.target.files?.[0] && handleXFile(event.target.files[0])} />
              </label>
            )}
            {brand && dashboardTab && user && (
              <button className="btn outline" onClick={() => setMetaImportOpen(true)}>
                Meta API 가져오기
              </button>
            )}
            {brand && dashboardTab && user && (
              <button className="btn outline" onClick={() => setImageImportSourceOpen(true)}>
                이미지 불러오기
              </button>
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
          {visibleTabs.map(tab => (
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
            <button
              type="button"
              className={`report-spend-basis-toggle ${spendBasis === 'net' ? 'is-net' : ''}`}
              onClick={() => {
                const nextBasis = spendBasis === 'gross' ? 'net' : 'gross';
                if (preferenceSaveTimerRef.current) {
                  clearTimeout(preferenceSaveTimerRef.current);
                  preferenceSaveTimerRef.current = null;
                }
                setSpendBasis(nextBasis);
                void saveBrandReportPreferences({ spendBasis: nextBasis });
              }}
              aria-pressed={spendBasis === 'net'}
              title="광고비 표시 기준 전환"
            >
              {spendBasis === 'gross' ? '그로스' : '넷'}
            </button>
            <span className="filter-label">환율</span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1000"
              value={exchangeRate}
              onChange={event => {
                const nextRate = Number(event.target.value);
                if (!Number.isFinite(nextRate) || nextRate <= 0) return;
                setExchangeRate(nextRate);
                scheduleExchangeRateSave(nextRate);
              }}
              onBlur={() => {
                if (preferenceSaveTimerRef.current) {
                  clearTimeout(preferenceSaveTimerRef.current);
                  preferenceSaveTimerRef.current = null;
                }
                void saveBrandReportPreferences({ exchangeRate });
              }}
            />
            <span className="muted">JPY → KRW · 관리자 변경값은 브랜드별로 자동 저장됩니다.</span>
            {result && (
              <>
                <span className="filter-label">시트</span>
                <span className="badge">{result.sheet.sheetName}</span>
                <span className="filter-label">행</span>
                <span className="badge">{reportView?.currentRows.length.toLocaleString()}개 선택</span>
              </>
            )}
          </div>

          {/* RAW 파일 목록은 설정에서만 관리한다. 화면에는 소스별 최신 파일이 자동으로 적용된다. */}

          {result && (
            <div className="filter-bar report-dimension-controls">
              <span className="filter-label">캠페인</span>
              <CheckboxFilterDropdown
                label="캠페인"
                options={campaignOptions}
                selected={campaignFilter}
                onChange={setCampaignFilter}
              />
              <span className="filter-label">광고세트</span>
              <CheckboxFilterDropdown
                label="광고세트"
                options={adgroupOptions}
                selected={adgroupFilter}
                onChange={setAdgroupFilter}
              />
              <span className="filter-label">소재</span>
              <CheckboxFilterDropdown
                label="소재"
                options={adOptions}
                selected={adFilter}
                onChange={setAdFilter}
              />
              {(campaignFilter.length > 0 || adgroupFilter.length > 0 || adFilter.length > 0) && (
                <button
                  className="btn ghost compact"
                  onClick={() => {
                    setCampaignFilter([]);
                    setAdgroupFilter([]);
                    setAdFilter([]);
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
                  allRows={viewRows}
                  kpi={kpi}
                  xTotal={xKpiTotal}
                  brandId={brand.id}
                  tabId={dashboardTab.id}
                  historyKey={commentHistoryKey}
                  comment={reportComment}
                  editing={commentEditing}
                  setEditing={setCommentEditing}
                  isAdmin={isAdmin}
                  busy={commentBusy}
                  onGenerate={generateReportComment}
                  onSave={saveReportCommentFlow}
                  dailyToplineMetrics={brand.dailyToplineMetrics}
                />
              )}
              {activeTab === 'campaigns' && <CampaignReport view={reportView} kpi={kpi} dailyToplineMetrics={brand.dailyToplineMetrics} />}
              {activeTab === 'creatives' && <CreativeReport view={reportView} kpi={kpi} creativeAssets={creativeAssets} />}
              {activeMarketplace && (
                <PromotionDetailReport
                  title={activeMarketplaceTitle}
                  view={reportView}
                  allRows={viewRows}
                  marketplace={activeMarketplace.id}
                  marketplaceRows={marketplaceRows}
                  activeSubTab={activeSubTab}
                  dailyToplineMetrics={brand.dailyToplineMetrics}
                  xRows={xSectionRows}
                  xTotal={xKpiTotal}
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
      {imageImportSourceOpen && brand && dashboardTab && user && (
        <ImageImportSourceModal
          onClose={() => setImageImportSourceOpen(false)}
          onSelectMeta={() => {
            setImageImportSourceOpen(false);
            setMetaImageImportOpen(true);
          }}
          onSelectUpload={() => {
            setImageImportSourceOpen(false);
            setDirectImageImportOpen(true);
          }}
        />
      )}
      {metaImageImportOpen && brand && user && (
        <MetaCreativeFilterModal
          brand={brand}
          user={user}
          apiPath="/api/report-meta"
          onClose={() => setMetaImageImportOpen(false)}
          onImport={fetchCreativeImagesFromMeta}
        />
      )}
      {directImageImportOpen && brand && dashboardTab && user && (
        <DirectCreativeUploadModal
          targets={creativeUploadTargets}
          onClose={() => setDirectImageImportOpen(false)}
          onUpload={uploadCreativeImagesDirectly}
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
          getShareUrl={item => buildReportShareUrl(location.origin, item, item.spendBasis, item.exchangeRate)}
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

function CheckboxFilterDropdown({
  label,
  options,
  selected,
  onChange
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const triggerText = selected.length === 0
    ? '전체'
    : selected.length === 1
      ? selected[0]
      : `${selected.length.toLocaleString()}개 선택`;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function toggleOption(option: string) {
    const next = selectedSet.has(option)
      ? selected.filter(value => value !== option)
      : [...selected, option];
    onChange(next.length === options.length ? [] : next);
  }

  return (
    <div className={`report-checkbox-filter${open ? ' open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="report-checkbox-filter-trigger"
        aria-label={`${label} 필터`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected.length ? selected.join('\n') : `${label} 전체`}
        disabled={!options.length}
        onClick={() => setOpen(value => !value)}
      >
        <span>{triggerText}</span>
      </button>
      {open && (
        <div className="report-checkbox-filter-menu" role="listbox" aria-label={`${label} 복수 선택`} aria-multiselectable="true">
          <label className="report-checkbox-filter-option is-all">
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
            <span>전체</span>
            <small>{options.length.toLocaleString()}</small>
          </label>
          <div className="report-checkbox-filter-options">
            {options.map(option => (
              <label className="report-checkbox-filter-option" key={option} title={option}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(option)}
                  onChange={() => toggleOption(option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
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
          XLSX RAW 파일을 업로드하면 media가 s- 계열이거나 META/X인 SingleOne 행만 보고서 데이터로 변환합니다.
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
  xTotal,
  brandId,
  tabId,
  historyKey,
  comment,
  editing,
  setEditing,
  isAdmin,
  busy,
  onGenerate,
  onSave,
  dailyToplineMetrics
}: {
  view: ReportView;
  allRows: NormalizedReportRow[];
  kpi: Kpi;
  /** SingleOne RAW에 없는 X RAW 합계. 있으면 상단 KPI에 더한다. */
  xTotal: XReportSummary | null;
  brandId: string;
  tabId: string;
  historyKey: number;
  comment: ReportCommentDoc | null;
  editing: boolean;
  setEditing: (value: boolean) => void;
  isAdmin: boolean;
  busy: string;
  onGenerate: () => void;
  onSave: (text: string) => void;
  dailyToplineMetrics: DailyToplineMetric[];
}) {
  const comparisonLabel = formatComparisonLabel(view);
  const latestDate = latestReportDate(allRows) || view.currentPeriod.end;
  const weekly = buildRecentWeeklySummaries(allRows, latestDate);
  const yearlyDaily = buildYearDailyGroups(allRows, latestDate);

  return (
    <>
      <SummaryCards total={view.current.total} kpi={kpi} />
      {xTotal && <p className="muted report-x-kpi-note">X RAW 광고비 {formatCurrency(xTotal.spend)} · 노출 {formatInteger(xTotal.impressions)} 포함</p>}
      <ReportCommentSection
        brandId={brandId}
        tabId={tabId}
        historyKey={historyKey}
        comment={comment}
        editing={editing}
        setEditing={setEditing}
        isAdmin={isAdmin}
        busy={busy}
        onGenerate={onGenerate}
        onSave={onSave}
      />
      <DailyToplineChart rows={view.current.byDaily} metrics={dailyToplineMetrics} comparisonLabel={comparisonLabel} />
      <ComparisonTable rows={view.comparison} comparisonLabel={comparisonLabel} />
      <SummaryTable title="프로모션별 성과" rows={view.current.byPromotion} previousRows={view.previous.byPromotion} limit={30} showComparisonRows comparisonLabel={comparisonLabel} />
      <RecentWeeklyPerformanceTable data={weekly} />
      <YearDailyPerformanceTable data={yearlyDaily} />
    </>
  );
}

function DailyPerformanceDetails({ view, dailyToplineMetrics }: { view: ReportView; dailyToplineMetrics: DailyToplineMetric[] }) {
  return (
    <>
      <DailyToplineChart rows={view.current.byDaily} metrics={dailyToplineMetrics} />
      <SummaryTable title="일자별 핵심 성과" rows={view.current.byDaily} previousRows={view.previous.byDaily} limit={120} sortByLabel />
      <SummaryTable title="일자별 캠페인 성과" rows={view.current.byCampaign} previousRows={view.previous.byCampaign} limit={80} />
    </>
  );
}

function CampaignReport({ view, kpi, dailyToplineMetrics }: { view: ReportView; kpi: Kpi; dailyToplineMetrics: DailyToplineMetric[] }) {
  return (
    <>
      <SummaryCards total={view.current.total} kpi={kpi} />
      <SummaryTable title="캠페인 성과" rows={view.current.byCampaign} previousRows={view.previous.byCampaign} limit={100} showComparisonRows />
      <DailyPerformanceDetails view={view} dailyToplineMetrics={dailyToplineMetrics} />
      <SummaryTable title="광고그룹 성과" rows={view.current.byAdgroup} previousRows={view.previous.byAdgroup} limit={100} showComparisonRows />
    </>
  );
}

function CreativeReport({ view, kpi, creativeAssets }: { view: ReportView; kpi: Kpi; creativeAssets: Record<string, CreativeAssetDoc> }) {
  const creativeRows = view.current.byCreative.filter(hasReportPerformance);
  const dailyRowsByCreative = useMemo(() => buildCreativeDailyRows(view.currentRows), [view.currentRows]);
  return (
    <>
      <SummaryCards total={view.current.total} kpi={kpi} />
      <SummaryTable
        title="소재 성과"
        rows={creativeRows}
        previousRows={view.previous.byCreative}
        limit={140}
        showComparisonRows
        alwaysShowComparisonRows
        creativeAssets={creativeAssets}
        dailyRowsByKey={dailyRowsByCreative}
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
  activeSubTab,
  dailyToplineMetrics,
  xRows,
  xTotal
}: {
  title: string;
  view: ReportView;
  allRows: NormalizedReportRow[];
  marketplace: MarketplaceTab;
  marketplaceRows: NormalizedReportRow[];
  activeSubTab: PromotionSubTab;
  dailyToplineMetrics: DailyToplineMetric[];
  xRows: XReportRow[];
  /** SingleOne RAW에 없는 X RAW 합계. 있으면 상단 KPI에 더한다. */
  xTotal: XReportSummary | null;
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
  const campaignGroups = buildMediaCampaignPerformanceGroups(allRows, view.currentRows, view.previousRows, view.currentPeriod.start, view.currentPeriod.end, view.previousPeriod.start, view.previousPeriod.end);

  return (
    <>
      <section className="section">
        <div className="section-head">
          <b>{title} 성과</b>
          <span className="muted">최신 {latestDate || '-'}</span>
        </div>
        <PromotionKpiCards total={view.current.total} showRegistration={marketplace === 'owned'} />
        {xTotal && <p className="muted report-x-kpi-note">X RAW 광고비 {formatCurrency(xTotal.spend)} · 노출 {formatInteger(xTotal.impressions)} 포함</p>}
      </section>
      <DailyToplineChart rows={view.current.byDaily} metrics={dailyToplineMetrics} />
      {historicalRows.length > 0 && historicalTitle && <HistoricalPerformanceTable title={historicalTitle} rows={historicalRows} />}
      <PromotionPerformanceSection title="전체 성과" rows={overallRows} showRegistration={marketplace === 'owned'} />
      <PromotionPerformanceSection title="목적별 성과" rows={objectiveRows} showRegistration={marketplace === 'owned'} />
      <CampaignPerformanceSection title="캠페인별 성과" groups={campaignGroups} showRegistration={marketplace === 'owned'} />
      {xRows.length > 0 && <XPerformanceSection rows={xRows} />}
      <YearDailyPerformanceTable data={dailyData} showRegistration={marketplace === 'owned'} />
    </>
  );
}

function XPerformanceSection({ rows }: { rows: XReportRow[] }) {
  const dailyRows = buildXReportDailyRows(rows);
  const total = summarizeXReportRows('x-total', '합계', rows);
  const rangeStart = dailyRows[0]?.label || '-';
  const rangeEnd = dailyRows[dailyRows.length - 1]?.label || '-';

  return (
    <section className="section">
      <div className="section-head">
        <b>X 성과</b>
        <span className="muted">X RAW 업로드 기준 · {rangeStart} ~ {rangeEnd}</span>
      </div>
      <div className="table-wrap sticky-detail">
        <table className="promotion-performance-table x-performance-table">
          <thead>
            <tr>
              <th>일자</th>
              <th title="Spend">광고비</th>
              <th title="Impressions (노출)">IMP</th>
              <th title="Engagements (인게이지먼트, 광고비 ÷ Cost per engagement)">ENG</th>
              <th title="Engagement rate (ENG ÷ IMP)">ER</th>
              <th title="CPM">CPM</th>
              <th title="Cost per engagement">CPE</th>
              <th title="Profile visits">프로필방문</th>
            </tr>
          </thead>
          <tbody>
            <tr className="report-total-row">
              <td>합계</td>
              <XPerformanceCells row={total} />
            </tr>
            {dailyRows.map(row => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <XPerformanceCells row={row} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function XPerformanceCells({ row }: { row: XReportSummary }) {
  return (
    <>
      <td>{formatCurrency(row.spend)}</td>
      <td>{formatInteger(row.impressions)}</td>
      <td>{formatInteger(row.engagements)}</td>
      <td>{formatPercent(row.engagementRate)}</td>
      <td>{formatCurrency(row.cpm)}</td>
      <td>{formatCurrency(row.cpe)}</td>
      <td>{formatInteger(row.profileVisits)}</td>
    </>
  );
}

function PromotionKpiCards({ total, showRegistration = false }: { total: ReportSummary; showRegistration?: boolean }) {
  const cards = [
    { label: '광고비', value: formatCurrency(total.spend) },
    { label: '매출', value: formatCurrency(total.sales) },
    { label: 'ROAS', value: total.roas.toFixed(2) },
    { label: 'CTR', value: formatPercent(total.ctr) },
    { label: 'CPM', value: formatCurrency(total.cpm) },
    { label: 'CVR', value: formatPercent(total.cvr) },
    { label: '전환CPA', value: formatCurrency(total.cpa) },
    { label: '장바구니 CPA', value: formatCurrency(total.cartCpa) }
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
  const cards: Array<{ label: string; value: string; current?: number; goal?: number; goalValue?: string; inverse?: boolean }> = [
    { label: '광고비', value: formatCurrency(total.spend), current: total.spend, goal: kpi.spendGoal, goalValue: formatCurrency(kpi.spendGoal) },
    { label: '매출', value: formatCurrency(total.sales), current: total.sales, goal: kpi.salesGoal, goalValue: formatCurrency(kpi.salesGoal) },
    { label: 'ROAS', value: total.roas.toFixed(2), current: total.roas, goal: kpi.roasGoal, goalValue: kpi.roasGoal.toLocaleString() },
    { label: 'CTR', value: formatPercent(total.ctr), current: total.ctr, goal: kpi.ctrGoal, goalValue: formatPercent(kpi.ctrGoal) },
    { label: 'CPM', value: formatCurrency(total.cpm), current: total.cpm, goal: kpi.cpmGoal, goalValue: formatCurrency(kpi.cpmGoal), inverse: true },
    { label: 'CVR', value: formatPercent(total.cvr) },
    { label: '전환CPA', value: formatCurrency(total.cpa) },
    { label: '장바구니 CPA', value: formatCurrency(total.cartCpa) }
  ];
  return (
    <div className="report-stat-grid">
      {cards.map(card => {
        const goal = Number(card.goal || 0);
        const current = Number(card.current || 0);
        const pct = goal > 0 && current > 0 ? (card.inverse ? goal / current : current / goal) * 100 : 0;
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
  brandId,
  tabId,
  historyKey,
  comment,
  editing,
  setEditing,
  isAdmin,
  busy,
  onGenerate,
  onSave
}: {
  brandId: string;
  tabId: string;
  historyKey: number;
  comment: ReportCommentDoc | null;
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
        <b>
          Comment
          <NoteHistoryButton brandId={brandId} tabId={tabId} kind="comment" title="Comment" refreshKey={historyKey} />
        </b>
        {isAdmin && !editing && (
          <div className="report-comment-actions">
            <button className="btn outline" disabled={Boolean(busy)} onClick={onGenerate}>
              {busy || 'Comment 생성'}
            </button>
            <button className="btn ghost" disabled={Boolean(busy)} onClick={() => setEditing(true)}>
              {comment?.text ? '수정' : '작성'}
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <RichTextEditor
          initialText={comment?.text || ''}
          placeholder="이번 기간 성과에 대해 공유할 내용을 적어주세요."
          busy={busy}
          minHeight={420}
          onCancel={() => setEditing(false)}
          onSave={onSave}
        />
      ) : (
        <div className="report-comment-box">
          {comment?.text
            ? <RichText text={comment.text} className="report-comment-content" lineClassName="report-comment-line" />
            : <span className="muted">Comment를 작성하면 공유 링크에서도 이 영역에 표시됩니다.</span>}
        </div>
      )}
    </section>
  );
}

function DailyToplineChart({
  rows,
  metrics,
  comparisonLabel
}: {
  rows: ReportSummary[];
  metrics: DailyToplineMetric[];
  comparisonLabel?: string;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; row: ReportSummary } | null>(null);
  const [barMetricOne = 'spend', barMetricTwo = 'sales', lineMetric = 'roas'] = metrics;
  const barOneLabel = DAILY_TOPLINE_METRIC_LABELS[barMetricOne];
  const barTwoLabel = DAILY_TOPLINE_METRIC_LABELS[barMetricTwo];
  const lineLabel = DAILY_TOPLINE_METRIC_LABELS[lineMetric];
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
  const barOneValues = sorted.map(row => dailyToplineMetricValue(row, barMetricOne));
  const barTwoValues = sorted.map(row => dailyToplineMetricValue(row, barMetricTwo));
  const lineValues = sorted.map(row => dailyToplineMetricValue(row, lineMetric));
  const barOneMax = Math.max(1, ...barOneValues.filter(Number.isFinite));
  const barTwoMax = Math.max(1, ...barTwoValues.filter(Number.isFinite));
  const positiveLineValues = lineValues.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const rawLineMax = Math.max(1, ...positiveLineValues);
  const p90 = percentile(positiveLineValues, 0.9);
  const p75 = percentile(positiveLineValues, 0.75);
  const robustMax = Math.max(1, p90 * 1.35, p75 * 2);
  const lineMax = rawLineMax > robustMax * 1.5 ? robustMax : rawLineMax;
  const slot = chartWidth / Math.max(sorted.length, 1);
  const barWidth = Math.max(3, Math.min(18, slot * 0.3));
  const xCenter = (index: number) => left + slot * index + slot / 2;
  const yBarOne = (value: number) => top + chartHeight - (Math.min(Math.max(0, value), barOneMax) / barOneMax) * chartHeight;
  const yBarTwo = (value: number) => top + chartHeight - (Math.min(Math.max(0, value), barTwoMax) / barTwoMax) * chartHeight;
  const yLine = (value: number) => top + chartHeight - (Math.min(Math.max(0, value), lineMax) / lineMax) * chartHeight;
  const linePath = lineValues.map((value, index) => `${index === 0 ? 'M' : 'L'} ${xCenter(index)} ${yLine(value)}`).join(' ');
  const dateTickEvery = Math.max(1, Math.ceil(sorted.length / 12));

  return (
    <section className="section report-chart-section">
      <div className="report-band-title">
        <span>Daily Topline</span>
        <PeriodBadge label={comparisonLabel || ''} />
      </div>
      <div className="report-chart-wrap" onMouseLeave={() => setTooltip(null)}>
        {tooltip && (
          <div className="report-chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            <b>{tooltip.row.label}</b>
            <span>{barOneLabel} {formatDailyToplineMetric(barMetricOne, dailyToplineMetricValue(tooltip.row, barMetricOne))}</span>
            <span>{barTwoLabel} {formatDailyToplineMetric(barMetricTwo, dailyToplineMetricValue(tooltip.row, barMetricTwo))}</span>
            <span>{lineLabel} {formatDailyToplineMetric(lineMetric, dailyToplineMetricValue(tooltip.row, lineMetric))}</span>
          </div>
        )}
        <div className="report-chart-legend">
          <span><i style={{ background: 'var(--chart-1)' }} />{barOneLabel}</span>
          <span><i style={{ background: 'var(--chart-3)' }} />{barTwoLabel}</span>
          <span><i className="line" style={{ background: 'var(--c-danger)' }} />{lineLabel}</span>
        </div>
        <svg className="report-topline-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`일자별 ${barOneLabel}, ${barTwoLabel}, ${lineLabel} 추이`}>
          {[0, 0.25, 0.5, 0.75, 1].map(rate => {
            const y = top + chartHeight - chartHeight * rate;
            return (
              <g key={rate}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--chart-grid-strong)" strokeWidth="1" />
                <text x={left - 8} y={y + 4} textAnchor="end" className="report-chart-axis">
                  {compactDailyToplineMetric(barMetricOne, barOneMax * rate)}
                </text>
                <text x={width - right + 8} y={y + 4} textAnchor="start" className="report-chart-axis">
                  {rate === 1 && rawLineMax > lineMax ? `>${compactDailyToplineMetric(lineMetric, lineMax * rate)}` : compactDailyToplineMetric(lineMetric, lineMax * rate)}
                </text>
              </g>
            );
          })}
          {sorted.map((row, index) => {
            const center = xCenter(index);
            const barOneY = yBarOne(barOneValues[index]);
            const barTwoY = yBarTwo(barTwoValues[index]);
            return (
              <g key={`bars-${row.key}`}>
                <rect x={center - barWidth} y={barOneY} width={barWidth} height={top + chartHeight - barOneY} rx="2" fill="var(--chart-1)" />
                <rect x={center} y={barTwoY} width={barWidth} height={top + chartHeight - barTwoY} rx="2" fill="var(--chart-3)" />
              </g>
            );
          })}
          <path d={linePath} fill="none" stroke="var(--c-danger)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {sorted.map((row, index) => (
            <g key={row.key}>
              <circle cx={xCenter(index)} cy={yLine(lineValues[index])} r="3" fill="var(--c-danger)" />
              {index % dateTickEvery === 0 && (
                <text x={xCenter(index)} y={height - 14} textAnchor="middle" className="report-chart-date">{row.label}</text>
              )}
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
      </div>
    </section>
  );
}

function dailyToplineMetricValue(row: ReportSummary, metric: DailyToplineMetric): number {
  if (metric === 'registrationCpa') return safeRatio(row.spend, row.registration);
  return Number(row[metric] || 0);
}

function formatDailyToplineMetric(metric: DailyToplineMetric, value: number): string {
  if (['spend', 'sales', 'registrationCpa', 'cpm', 'cpc', 'cpa'].includes(metric)) return formatCurrency(value);
  if (metric === 'ctr' || metric === 'cvr') return formatPercent(value);
  if (metric === 'roas') return (Number(value) || 0).toFixed(2);
  return formatInteger(value);
}

function compactDailyToplineMetric(metric: DailyToplineMetric, value: number): string {
  if (metric === 'ctr' || metric === 'cvr') return formatPercent(value);
  if (metric === 'roas') return (Number(value) || 0).toFixed(1);
  return compactCurrency(value);
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
    cpm: metric('cpm')?.[prefix as 'current' | 'previous'] || 0,
    cpc: safeRatio(metric('spend')?.[prefix as 'current' | 'previous'] || 0, metric('clicks')?.[prefix as 'current' | 'previous'] || 0),
    cvr: metric('cvr')?.[prefix as 'current' | 'previous'] || 0,
    cpa: metric('cpa')?.[prefix as 'current' | 'previous'] || 0,
    cartCpa: safeRatio(metric('spend')?.[prefix as 'current' | 'previous'] || 0, metric('addToCart')?.[prefix as 'current' | 'previous'] || 0),
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
        <table className="promotion-performance-table promotion-stacked-table period-comparison-table">
          <thead>
            <tr>
              <th>구분</th>
              <PromotionCompactHeaders extended />
            </tr>
          </thead>
          <tbody>
            <tr className="promotion-target-row">
              <td>선택 기간</td>
              <PromotionCompactCells row={current} extended />
            </tr>
            <tr className="promotion-period-row">
              <td>이전 기간</td>
              <PromotionCompactCells row={previous} extended />
            </tr>
            <tr className="promotion-pop-row">
              <td>PoP Diff</td>
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

type YearDailyYearGroup = {
  key: string;
  label: string;
  isLatestYear: boolean;
  total: ReportSummary;
  months: YearDailyGroup[];
};

type YearDailyData = {
  startDate: string;
  latestDate: string;
  total: ReportSummary;
  years: YearDailyYearGroup[];
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
              <PromotionPerformanceRowBlock
                key={row.label}
                row={row}
                headRowClassName={index === 0 && row.label === '전체 성과' ? 'report-total-row' : ''}
                showRegistration={showRegistration}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PromotionPerformanceRowBlock({
  row,
  headRowClassName = '',
  labelClassName = '',
  showRegistration = false
}: {
  row: PromotionPerformanceRow;
  headRowClassName?: string;
  labelClassName?: string;
  showRegistration?: boolean;
}) {
  return (
    <React.Fragment>
      <tr className={headRowClassName}>
        <td className={labelClassName}>{row.label}</td>
        <PromotionComparisonCells row={row.total} showRegistration={showRegistration} />
      </tr>
      <tr className="promotion-target-row">
        <td className={labelClassName}>대상 기간</td>
        <PromotionComparisonCells row={row.target} showRegistration={showRegistration} />
      </tr>
      <tr className="promotion-period-row">
        <td className={labelClassName}>이전 기간</td>
        <PromotionComparisonCells row={row.previous} showRegistration={showRegistration} />
      </tr>
      <tr className="promotion-pop-row">
        <td className={labelClassName}>PoP Diff</td>
        <PromotionComparisonDiffCells current={row.target} previous={row.previous} showRegistration={showRegistration} />
      </tr>
    </React.Fragment>
  );
}

function CampaignPerformanceSection({
  title,
  groups,
  showRegistration = false
}: {
  title: string;
  groups: MediaCampaignGroup[];
  showRegistration?: boolean;
}) {
  const first = groups[0]?.summary;
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
            {groups.map(group => (
              <React.Fragment key={group.key}>
                <PromotionPerformanceRowBlock
                  row={group.summary}
                  headRowClassName="report-total-row"
                  showRegistration={showRegistration}
                />
                {group.campaigns.map(campaign => (
                  <PromotionPerformanceRowBlock
                    key={`${group.key}|||${campaign.label}`}
                    row={campaign}
                    labelClassName="promotion-child-label"
                    showRegistration={showRegistration}
                  />
                ))}
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
      <th>장바구니 CPA</th>
      {showRegistration && (
        <>
          <th>회원가입수</th>
          <th>회원가입 CPA</th>
        </>
      )}
      <th>CTR</th>
      <th>CPM</th>
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
      <td>{formatCurrency(row.cartCpa)}</td>
      {showRegistration && (
        <>
          <td>{formatInteger(row.registration)}</td>
          <td>{formatCurrency(safeRatio(row.spend, row.registration))}</td>
        </>
      )}
      <td>{formatPercent(row.ctr)}</td>
      <td>{formatCurrency(row.cpm)}</td>
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
      <PromotionDiffCell current={current.cartCpa} previous={previous.cartCpa} inverse />
      {showRegistration && (
        <>
          <PromotionDiffCell current={current.registration} previous={previous.registration} />
          <PromotionDiffCell current={safeRatio(current.spend, current.registration)} previous={safeRatio(previous.spend, previous.registration)} inverse />
        </>
      )}
      <PromotionDiffCell current={current.ctr} previous={previous.ctr} />
      <PromotionDiffCell current={current.cpm} previous={previous.cpm} inverse />
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
          <th>CPM</th>
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
          <td>{formatCurrency(row.cpm)}</td>
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
      <PromotionDiffCell current={current.cpm} previous={previous.cpm} inverse />
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
  const visibleYears = useMemo(() => data.years
    .map(year => ({
      ...year,
      months: year.months
        .map(month => ({ ...month, days: month.days.filter(hasReportPerformance) }))
        .filter(month => hasReportPerformance(month.total) || month.days.length > 0)
    }))
    .filter(year => hasReportPerformance(year.total) || year.months.length > 0), [data.years]);
  const defaultOpenYears = useMemo(
    () => new Set(visibleYears.filter(year => year.isLatestYear).map(year => year.key)),
    [visibleYears]
  );
  const defaultOpenMonths = useMemo(
    () => new Set(visibleYears.flatMap(year => year.months.filter(month => month.isCurrentMonth).map(month => month.key))),
    [visibleYears]
  );
  const [openYears, setOpenYears] = useState(defaultOpenYears);
  const [openMonths, setOpenMonths] = useState(defaultOpenMonths);

  useEffect(() => {
    setOpenYears(defaultOpenYears);
    setOpenMonths(defaultOpenMonths);
  }, [defaultOpenMonths, defaultOpenYears]);

  function toggleYear(key: string) {
    setOpenYears(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
              <td>TOTAL</td>
              <MetricCells row={data.total} showRegistration={showRegistration} />
            </tr>
            {visibleYears.map(year => {
              const isYearOpen = openYears.has(year.key);
              return (
                <React.Fragment key={year.key}>
                  <tr className="report-year-row">
                    <td>
                      <button type="button" className="report-month-toggle" onClick={() => toggleYear(year.key)}>
                        <span>{isYearOpen ? '접기' : '펼치기'}</span>
                        <b>{year.label} TOTAL</b>
                      </button>
                    </td>
                    <MetricCells row={year.total} showRegistration={showRegistration} />
                  </tr>
                  {isYearOpen && year.months.map(month => {
                    const isMonthOpen = openMonths.has(month.key);
                    return (
                      <React.Fragment key={month.key}>
                        <tr className="report-month-row">
                          <td>
                            <button type="button" className="report-month-toggle" onClick={() => toggleMonth(month.key)}>
                              <span>{isMonthOpen ? '접기' : '펼치기'}</span>
                              <b>{month.label} TOTAL</b>
                            </button>
                          </td>
                          <MetricCells row={month.total} showRegistration={showRegistration} />
                        </tr>
                        {isMonthOpen && month.days.map(day => (
                          <tr className="report-day-row" key={day.key}>
                            <td>{day.label}</td>
                            <MetricCells row={day} showRegistration={showRegistration} />
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
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
      <th>장바구니 CPA</th>
      {showRegistration && (
        <>
          <th>회원가입수</th>
          <th>회원가입 CPA</th>
        </>
      )}
      <th>CTR</th>
      <th>CPM</th>
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
      <td>{formatCurrency(row.cartCpa)}</td>
      {showRegistration && (
        <>
          <td>{formatInteger(row.registration)}</td>
          <td>{formatCurrency(safeRatio(row.spend, row.registration))}</td>
        </>
      )}
      <td>{formatPercent(row.ctr)}</td>
      <td>{formatCurrency(row.cpm)}</td>
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

const EMPTY_REPORT_SUMMARY: ReportSummary = {
  key: '',
  label: '',
  rows: 0,
  spend: 0,
  grossSpend: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0,
  sales: 0,
  addToCart: 0,
  registration: 0,
  lead: 0,
  order: 0,
  ctr: 0,
  cpm: 0,
  cpc: 0,
  cvr: 0,
  cpa: 0,
  cartCpa: 0,
  roas: 0
};

function SummaryTable({
  title,
  rows,
  previousRows = [],
  limit,
  sortByLabel = false,
  showComparisonRows = false,
  alwaysShowComparisonRows = false,
  comparisonLabel,
  creativeAssets,
  dailyRowsByKey
}: {
  title: string;
  rows: ReportSummary[];
  previousRows?: ReportSummary[];
  limit: number;
  sortByLabel?: boolean;
  showComparisonRows?: boolean;
  alwaysShowComparisonRows?: boolean;
  comparisonLabel?: string;
  creativeAssets?: Record<string, CreativeAssetDoc>;
  dailyRowsByKey?: Record<string, ReportSummary[]>;
}) {
  const [creativePreview, setCreativePreview] = useState<{ src: string; label: string } | null>(null);
  const [creativeHover, setCreativeHover] = useState<{ src: string; label: string; left: number; top: number } | null>(null);
  const [expandedDailyKeys, setExpandedDailyKeys] = useState<Set<string>>(() => new Set());
  const previousByKey = new Map(previousRows.map(row => [row.key, row]));
  const displayRows = rows
    .filter(hasReportPerformance)
    .sort((a, b) => sortByLabel ? a.key.localeCompare(b.key) : b.spend - a.spend || a.label.localeCompare(b.label));
  const visibleRows = displayRows.slice(0, limit);
  const expandableKeys = visibleRows.filter(row => dailyRowsByKey?.[row.key]?.length).map(row => row.key);
  // 저장된 이미지가 있는데도 표에 안 붙는 경우를 바로 알아볼 수 있게 연결 현황을 함께 보여준다.
  const creativeImageStatus = creativeAssets
    ? {
      saved: new Set(Object.values(creativeAssets).map(asset => asset.key)).size,
      linked: visibleRows.filter(row => findCreativeAsset(creativeAssets, row.key)).length
    }
    : null;
  const allDailyExpanded = expandableKeys.length > 0 && expandableKeys.every(key => expandedDailyKeys.has(key));

  function toggleDailyRows(key: string) {
    setExpandedDailyKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllDailyRows() {
    setExpandedDailyKeys(current => {
      const next = new Set(current);
      if (allDailyExpanded) expandableKeys.forEach(key => next.delete(key));
      else expandableKeys.forEach(key => next.add(key));
      return next;
    });
  }

  return (
    <section className="section">
      <div className="section-head">
        <PeriodBadge label={comparisonLabel || ''} />
        <b>{title}</b>
        <span className="muted">총 {displayRows.length.toLocaleString()}개 그룹 중 {Math.min(displayRows.length, limit).toLocaleString()}개 표시</span>
        {creativeImageStatus && (
          <span className="muted">이미지 연결 {creativeImageStatus.linked.toLocaleString()}/{visibleRows.length.toLocaleString()} · 저장된 소재 이미지 {creativeImageStatus.saved.toLocaleString()}개</span>
        )}
        {expandableKeys.length > 0 && (
          <button type="button" className="btn outline compact creative-daily-all-toggle" onClick={toggleAllDailyRows}>
            {allDailyExpanded ? '일별 전체 접기' : '일별 전체 펼치기'}
          </button>
        )}
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
              <th>장바구니 CPA</th>
              <th>CTR</th>
              <th>CPM</th>
              <th>CVR</th>
              <th>CPC</th>
              <th>CPA</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => {
              const matchedPrevious = previousByKey.get(row.key);
              const previous = matchedPrevious || EMPTY_REPORT_SUMMARY;
              const showPrevious = showComparisonRows && (Boolean(matchedPrevious) || alwaysShowComparisonRows);
              const dailyRows = dailyRowsByKey?.[row.key] || [];
              const dailyExpanded = expandedDailyKeys.has(row.key);
              return (
                <React.Fragment key={row.key}>
                  <tr>
                    <td title={row.label}>
                      {creativeAssets
                        ? (
                          <div className="creative-summary-cell">
                            <CreativeGroupCell
                              row={row}
                              asset={findCreativeAsset(creativeAssets, row.key)}
                              onPreview={(src, label) => {
                                setCreativeHover(null);
                                setCreativePreview({ src, label });
                              }}
                              onHover={(src, label, rect) => {
                                const previewSize = 176;
                                const gap = 12;
                                const left = rect.right + gap + previewSize <= window.innerWidth
                                  ? rect.right + gap
                                  : Math.max(gap, rect.left - gap - previewSize);
                                const top = Math.min(
                                  Math.max(gap, rect.top + rect.height / 2 - previewSize / 2),
                                  window.innerHeight - previewSize - gap
                                );
                                setCreativeHover({ src, label, left, top });
                              }}
                              onHoverEnd={() => setCreativeHover(null)}
                            />
                            {dailyRows.length > 0 && (
                              <button
                                type="button"
                                className={`creative-daily-toggle ${dailyExpanded ? 'active' : ''}`}
                                aria-expanded={dailyExpanded}
                                onClick={() => toggleDailyRows(row.key)}
                              >
                                {dailyExpanded ? '일별 접기' : `일별 ${dailyRows.length.toLocaleString()}일`}
                              </button>
                            )}
                          </div>
                        )
                        : trim(row.label, 44)}
                    </td>
                    <td>{formatCurrency(row.spend)}</td>
                    <td>{formatCurrency(row.sales)}</td>
                    <td>{formatInteger(row.impressions)}</td>
                    <td>{formatInteger(row.clicks)}</td>
                    <td>{formatInteger(row.conversions)}</td>
                    <td>{formatInteger(row.addToCart)}</td>
                    <td>{formatCurrency(row.cartCpa)}</td>
                    <td>{formatPercent(row.ctr)}</td>
                    <td>{formatCurrency(row.cpm)}</td>
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
                      <td>{formatCurrency(previous.cartCpa)}</td>
                      <td>{formatPercent(previous.ctr)}</td>
                      <td>{formatCurrency(previous.cpm)}</td>
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
                      <DiffCell current={row.cartCpa} previous={previous.cartCpa} inverse />
                      <DiffCell current={row.ctr} previous={previous.ctr} />
                      <DiffCell current={row.cpm} previous={previous.cpm} inverse />
                      <DiffCell current={row.cvr} previous={previous.cvr} />
                      <DiffCell current={row.cpc} previous={previous.cpc} inverse />
                      <DiffCell current={row.cpa} previous={previous.cpa} inverse />
                      <DiffCell current={row.roas} previous={previous.roas} />
                    </tr>
                  )}
                  {dailyExpanded && dailyRows.map(day => (
                    <tr className="creative-daily-row" key={day.key}>
                      <td><span aria-hidden="true">↳</span>{day.label}</td>
                      <MetricCells row={day} />
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {creativeHover && (
        <div
          className="creative-hover-preview"
          style={{ left: creativeHover.left, top: creativeHover.top }}
          role="img"
          aria-label={`${creativeHover.label} 이미지 확대 미리보기`}
        >
          <img src={creativeHover.src} alt="" />
        </div>
      )}
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
  onPreview,
  onHover,
  onHoverEnd
}: {
  row: ReportSummary;
  asset?: CreativeAssetDoc;
  onPreview: (src: string, label: string) => void;
  onHover: (src: string, label: string, rect: DOMRect) => void;
  onHoverEnd: () => void;
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
          onMouseEnter={event => onHover(src, row.label, event.currentTarget.getBoundingClientRect())}
          onMouseLeave={onHoverEnd}
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

function isMetaReportFile(file: ReportFileDoc): boolean {
  const sheetName = normalizeSearchText(file.result?.sheet?.sheetName || '');
  const filename = normalizeSearchText(file.filename || file.result?.fileName || '');
  return sheetName === 'meta api' || filename.startsWith('meta api');
}

function indexCreativeAssets(assets: CreativeAssetDoc[]): Record<string, CreativeAssetDoc> {
  const index: Record<string, CreativeAssetDoc> = {};
  const fallbacks = new Map<string, CreativeAssetDoc>();

  for (const asset of assets) {
    if (!asset.key) continue;
    index[asset.key] = asset;
    for (const fallbackKey of creativeFallbackIndexKeys(asset.key)) {
      // 열쇠 앞부분이 겹치는 소재가 여럿이면 가장 최근에 저장한 이미지를 쓴다.
      const owner = fallbacks.get(fallbackKey);
      if (!owner || creativeAssetFreshness(asset) > creativeAssetFreshness(owner)) {
        fallbacks.set(fallbackKey, asset);
      }
    }
  }

  for (const [fallbackKey, asset] of fallbacks.entries()) {
    index[fallbackKey] ||= asset;
  }

  return index;
}

function creativeAssetFreshness(asset: CreativeAssetDoc): number {
  return Number(asset.updatedAt || 0) || Number(asset.capturedAt || 0);
}

/**
 * 정확한 열쇠가 안 맞을 때 순서대로 시도하는 느슨한 열쇠들.
 *
 * 소재 이미지는 `매체|||캠페인|||광고그룹|||소재명` 열쇠로 저장돼 있는데, X RAW는 export 형식마다
 * Campaign·Ad group·Ad name 열이 있기도 없기도 해서 같은 소재라도 앞부분이 달라진다.
 * 그래서 매체 → 광고그룹 → 캠페인 순으로 조건을 하나씩 풀어가며 저장된 이미지를 찾는다.
 */
function creativeFallbackIndexKeys(key: string): string[] {
  const parts = key.split('|||');
  const adName = parts.at(-1) || '';
  if (!adName) return [];
  const [, campaignName = '', adgroupName = ''] = parts;
  return [
    `identity|||${campaignName}|||${adgroupName}|||${adName}`,
    `campaign-ad|||${campaignName}|||${adName}`,
    `name|||${adName}`
  ];
}

/** 정확한 열쇠 → 매체 무시 → 광고그룹 무시 → 소재 이름 순으로 저장된 이미지를 찾는다. */
function findCreativeAsset(
  index: Record<string, CreativeAssetDoc>,
  key: string
): CreativeAssetDoc | undefined {
  if (index[key]) return index[key];
  for (const fallbackKey of creativeFallbackIndexKeys(key)) {
    if (index[fallbackKey]) return index[fallbackKey];
  }
  return undefined;
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

function applyExchangeRate(result: ReportParseResult | null, exchangeRate: number, forceJpy: boolean): ReportParseResult | null {
  if (!result) return null;
  const safeRate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : DEFAULT_EXCHANGE_RATE;
  const revalueCost = forceJpy || Boolean(result.sheet.columns.costJpy && !result.sheet.columns.costKrw);
  const revalueSales = forceJpy || Boolean(result.sheet.columns.salesJpy && !result.sheet.columns.salesKrw);
  const rows = result.rows.map(row => {
    // 통화를 아는 행(Meta API)은 그 통화를 따른다. KRW 계정 금액에 환율을 곱하면 광고비가 10배로 뛴다.
    const isJpyRow = !row.currency || row.currency.toUpperCase() === 'JPY';
    const costKrw = revalueCost && isJpyRow ? row.costJpy * safeRate : row.costKrw;
    const salesKrw = revalueSales && isJpyRow ? row.salesJpy * safeRate : row.salesKrw;
    return {
      ...row,
      costKrw,
      grossCostKrw: costKrw,
      salesKrw,
      ctr: reportRatio(row.clicks, row.impressions),
      cpm: reportRatio(costKrw * 1000, row.impressions),
      cpc: reportRatio(costKrw, row.clicks),
      cvr: reportRatio(row.conversions, row.clicks),
      cpa: reportRatio(costKrw, row.conversions),
      cartCpa: reportRatio(costKrw, row.addToCart),
      roas: reportRatio(salesKrw, costKrw)
    };
  });
  return {
    ...result,
    rows,
    preview: rows.slice(0, 12),
    exchangeRate: safeRate
  };
}

function applyGrossSpendRule(result: ReportParseResult, commissionSetting?: CommissionSetting): ReportParseResult {
  const rows = result.rows.map(row => ({
    ...row,
    grossCostKrw: row.costKrw ? toGrossCostKrw(row.costKrw, row.date, commissionSetting) : row.grossCostKrw
  }));
  return {
    ...result,
    rows,
    preview: rows.slice(0, 12)
  };
}

function reportRatio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

function buildReportShareUrl(origin: string, brand: Brand, spendBasis: SpendBasis, exchangeRate: number): string {
  const url = new URL('/report-lab', origin);
  url.searchParams.set('share', brand.shareToken);
  url.searchParams.set('basis', spendBasis);
  url.searchParams.set('rate', String(Math.round(exchangeRate * 10000) / 10000));
  return url.toString();
}

function parseSharedSpendBasis(value: string | null): SpendBasis | null {
  return value === 'gross' || value === 'net' ? value : null;
}

function parseSharedExchangeRate(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function combineReportResults(singleOneResult: ReportParseResult | null, metaResult: ReportParseResult | null): ReportParseResult | null {
  if (!singleOneResult && !metaResult) return null;
  const base = metaResult || singleOneResult;
  if (!base) return null;

  // Meta API 결과가 있으면 그것이 META의 기준이다. SingleOne RAW에도 같은 META 캠페인이 들어 있어
  // 그대로 이어붙이면 광고비·노출·클릭이 두 번 더해지므로 SingleOne 쪽 META 행은 뺀다.
  // (SingleOne이 단독으로 집행하는 S-META는 Meta API가 커버하지 않으므로 그대로 둔다)
  const singleOneRows = metaResult
    ? (singleOneResult?.rows || []).filter(row => !isMetaMediaRow(row))
    : (singleOneResult?.rows || []);

  const rows = [
    ...(metaResult?.rows || []),
    ...singleOneRows
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
    return { startDate: '', latestDate: '', total: summarizeReportRows('TOTAL', 'TOTAL', []), years: [] };
  }
  const sortedDates = rows.map(row => row.date).filter(Boolean).sort();
  const startDate = sortedDates[0] || latestDate;
  const first = parseIsoDate(startDate);
  const latest = parseIsoDate(latestDate);
  const rowsInRange = rows.filter(row => row.date >= startDate && row.date <= latestDate);
  const rowsByDate = new Map<string, NormalizedReportRow[]>();

  for (const row of rowsInRange) {
    const list = rowsByDate.get(row.date) || [];
    list.push(row);
    rowsByDate.set(row.date, list);
  }

  const months: YearDailyGroup[] = [];
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

    months.push({
      key,
      label: `${monthYear}년 ${month + 1}월`,
      isCurrentMonth: monthYear === latest.getFullYear() && month === latest.getMonth(),
      total: summarizeReportRows(`${key}-TOTAL`, `${monthYear}년 ${month + 1}월 TOTAL`, rowsInRange.filter(row => row.date.startsWith(key))),
      days
    });
  }

  const years = Array.from(new Set(months.map(month => month.key.slice(0, 4))))
    .sort()
    .map(year => ({
      key: year,
      label: year,
      isLatestYear: Number(year) === latest.getFullYear(),
      total: summarizeReportRows(`${year}-TOTAL`, `${year} TOTAL`, rowsInRange.filter(row => row.date.startsWith(`${year}-`))),
      months: months.filter(month => month.key.startsWith(`${year}-`))
    }));

  return {
    startDate,
    latestDate,
    total: summarizeReportRows('ALL-DAYS-TOTAL', '전체 데이터 TOTAL', rowsInRange),
    years
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

/** 캠페인별 성과에서 플랫폼(media) 블록을 노출하는 순서. 목록에 없는 매체는 뒤에 붙는다. */
const MEDIA_GROUP_ORDER = ['s-meta', 'meta', 'x'];
const MEDIA_GROUP_LABELS: Record<string, string> = {
  's-meta': 'S-META',
  meta: 'META',
  x: 'X',
  's-tiktok': 'S-TIKTOK',
  's-line': 'S-LINE'
};

type MediaCampaignGroup = {
  key: string;
  label: string;
  summary: PromotionPerformanceRow;
  campaigns: PromotionPerformanceRow[];
};

const X_MEDIA_KEY = 'x';
const META_MEDIA_KEY = 'meta';

function mediaGroupKey(row: NormalizedReportRow): string {
  return row.media.trim().toLowerCase() || '미분류';
}

function isXMediaRow(row: NormalizedReportRow): boolean {
  return mediaGroupKey(row) === X_MEDIA_KEY;
}

function isMetaMediaRow(row: NormalizedReportRow): boolean {
  return mediaGroupKey(row) === META_MEDIA_KEY;
}

function mediaGroupLabel(key: string): string {
  return MEDIA_GROUP_LABELS[key] || (key === '미분류' ? '미분류 매체' : key.toUpperCase());
}

function mediaGroupRank(key: string): number {
  const index = MEDIA_GROUP_ORDER.indexOf(key);
  return index === -1 ? MEDIA_GROUP_ORDER.length : index;
}

function groupReportRows(
  rows: NormalizedReportRow[],
  keyOf: (row: NormalizedReportRow) => string
): Map<string, NormalizedReportRow[]> {
  const groups = new Map<string, NormalizedReportRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

function buildMediaCampaignPerformanceGroups(
  rows: NormalizedReportRow[],
  targetRows: NormalizedReportRow[],
  previousRows: NormalizedReportRow[],
  targetStart: string,
  targetEnd: string,
  previousStart: string,
  previousEnd: string
): MediaCampaignGroup[] {
  const campaignKeyOf = (row: NormalizedReportRow) => `${mediaGroupKey(row)}|||${campaignNameLabel(row)}`;
  const campaignTotals = groupReportRows(rows, campaignKeyOf);
  const campaignTargets = groupReportRows(targetRows, campaignKeyOf);
  const campaignPreviouses = groupReportRows(previousRows, campaignKeyOf);

  const makeRow = (
    label: string,
    keyPrefix: string,
    totalRows: NormalizedReportRow[],
    periodTargetRows: NormalizedReportRow[],
    periodPreviousRows: NormalizedReportRow[]
  ): PromotionPerformanceRow => ({
    label,
    total: summarizeReportRows(`${keyPrefix}-total`, label, totalRows),
    target: summarizeReportRows(`${keyPrefix}-target`, label, periodTargetRows),
    previous: summarizeReportRows(`${keyPrefix}-previous`, label, periodPreviousRows),
    targetStart,
    targetEnd,
    previousStart,
    previousEnd
  });

  const byMedia = new Map<string, PromotionPerformanceRow[]>();
  for (const [key, list] of campaignTotals.entries()) {
    // X는 캠페인별 성과에서 제외하고 전용 'X 성과' 섹션에서 보여준다.
    if (key.startsWith(`${X_MEDIA_KEY}|||`)) continue;
    const periodTargetRows = campaignTargets.get(key) || [];
    // 기존 캠페인별 성과와 동일하게, 대상 기간에 실적이 있는 캠페인만 개별 노출한다.
    if (!hasReportPerformance(summarizeReportRows(key, key, periodTargetRows))) continue;
    const [mediaKey, campaignLabel] = [key.slice(0, key.indexOf('|||')), key.slice(key.indexOf('|||') + 3)];
    const campaigns = byMedia.get(mediaKey) || [];
    campaigns.push(makeRow(campaignLabel, key, list, periodTargetRows, campaignPreviouses.get(key) || []));
    byMedia.set(mediaKey, campaigns);
  }

  const mediaTotals = groupReportRows(rows, mediaGroupKey);
  const mediaTargets = groupReportRows(targetRows, mediaGroupKey);
  const mediaPreviouses = groupReportRows(previousRows, mediaGroupKey);

  return [...byMedia.entries()]
    .map(([mediaKey, campaigns]) => {
      const label = mediaGroupLabel(mediaKey);
      return {
        key: mediaKey,
        label,
        summary: makeRow(
          `${label} 합계`,
          `media-${mediaKey}`,
          mediaTotals.get(mediaKey) || [],
          mediaTargets.get(mediaKey) || [],
          mediaPreviouses.get(mediaKey) || []
        ),
        campaigns: campaigns.sort((a, b) => b.total.spend - a.total.spend || b.total.rows - a.total.rows)
      };
    })
    .sort((a, b) => mediaGroupRank(a.key) - mediaGroupRank(b.key) || b.summary.target.spend - a.summary.target.spend || a.label.localeCompare(b.label, 'ko'));
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

function buildCreativeDailyRows(rows: NormalizedReportRow[]): Record<string, ReportSummary[]> {
  const grouped = new Map<string, Map<string, NormalizedReportRow[]>>();
  for (const row of rows) {
    if (!row.date) continue;
    const creativeKey = makeCreativeKey(row);
    const byDate = grouped.get(creativeKey) || new Map<string, NormalizedReportRow[]>();
    const dateRows = byDate.get(row.date) || [];
    dateRows.push(row);
    byDate.set(row.date, dateRows);
    grouped.set(creativeKey, byDate);
  }

  return Object.fromEntries(
    [...grouped.entries()].map(([creativeKey, byDate]) => [
      creativeKey,
      [...byDate.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, dateRows]) => summarizeReportRows(`${creativeKey}|||${date}`, date, dateRows))
        .filter(hasReportPerformance)
    ])
  );
}

function summarizeReportRows(key: string, label: string, rows: NormalizedReportRow[]): ReportSummary {
  const summary = rows.reduce(
    (acc, row) => {
      acc.spend += row.grossCostKrw;
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
    cpm: safeRatio(summary.spend * 1000, summary.impressions),
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

/**
 * X RAW 한 줄을 보고서 행으로 바꾼다.
 * export의 Campaign / Ad group / Ad name을 그대로 써서 다른 매체와 똑같이 드롭다운에서 고를 수 있게 한다.
 * 열이 없는 export는 있는 이름으로 대신 채운다.
 */
function toReportRowFromX(row: XReportRow, index: number, costKrw: number): NormalizedReportRow {
  // 광고 이름 열이 없는 export가 많아 광고그룹 이름을, 그것도 없으면 매체명을 이름표로 쓴다.
  const named = [row.adName, row.adGroupName].map(value => (value || '').trim()).find(value => value && value !== '이름 없는 소재');
  const label = named || 'X 광고';
  const campaignName = (row.campaignName || '').trim() || label;
  const adgroupName = (row.adGroupName || '').trim() || label;
  return {
    sourceRowNumber: -(index + 1),
    date: row.date,
    brand: '',
    media: 'X',
    promotion: '',
    campaignName,
    adgroupName,
    adName: label,
    impressions: row.impressions,
    clicks: row.linkClicks,
    conversions: 0,
    costJpy: 0,
    costKrw,
    grossCostKrw: costKrw,
    salesJpy: 0,
    salesKrw: 0,
    addToCart: 0,
    registration: 0,
    lead: 0,
    order: 0,
    ctr: safeRatio(row.linkClicks, row.impressions),
    cpm: safeRatio(costKrw * 1000, row.impressions),
    cpc: safeRatio(costKrw, row.linkClicks),
    cvr: 0,
    cpa: 0,
    cartCpa: 0,
    roas: 0,
    raw: {}
  };
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

function roundNumber(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function matchesSelectedValues(value: string, selected: string[]): boolean {
  return selected.length === 0 || selected.includes(value);
}

function retainAvailableSelections(selected: string[], options: string[]): string[] {
  const available = new Set(options);
  const next = selected.filter(value => available.has(value));
  return next.length === selected.length && next.every((value, index) => value === selected[index]) ? selected : next;
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

/** SingleOne RAW에서 s- 계열 외에 추가로 받아들이는 매체(media) 값. SingleONE 직접 다운로드 RAW는 media가 meta로만 내려온다. */
const EXTRA_UPLOAD_MEDIA = new Set(['x', 'meta']);

function isSingleOneUploadRow(row: NormalizedReportRow): boolean {
  const media = row.media.trim().toLowerCase();
  return media.startsWith('s-') || EXTRA_UPLOAD_MEDIA.has(media);
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

async function readApiJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const summary = text.replace(/\s+/g, ' ').trim().slice(0, 180);
    throw new Error(`서버 응답 오류 (${response.status})${summary ? `: ${summary}` : ''}`);
  }
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
