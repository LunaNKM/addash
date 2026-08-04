import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { db, primaryAdminEmail } from './firebase';
import { DAILY_TOPLINE_METRIC_KEYS, DEFAULT_DAILY_TOPLINE_METRICS, DEFAULT_VISIBLE_REPORT_TABS, type Brand, type BrandPatch, type CreativeAssetDoc, type DashboardTab, type FileDoc, type InsightDoc, type Kpi, type ReportCommentDoc, type ReportFileDoc, type SingleOneCollectorSettings } from './types';
import type { NormalizedReportRow, ReportParseResult } from './report/reportTypes';
import { creativeAssetId, makeCreativeKey } from './report/creativeKey';
import { DEFAULT_COMMISSION_PERCENT } from './report/schema';

const REPORT_FILE_ROWS_PER_CHUNK = 25;
const REPORT_FILE_CHUNKS_PER_COMMIT = 8;

export const emptyKpi: Kpi = {
  spendGoal: 0,
  salesGoal: 0,
  impressionGoal: 0,
  clickGoal: 0,
  landingPageViewGoal: 0,
  ctrGoal: 0,
  cpmGoal: 0,
  cpcGoal: 0,
  roasGoal: 0
};

export async function isAdminEmail(email: string | null): Promise<boolean> {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (lower === primaryAdminEmail) return true;
  const snap = await getDoc(doc(db, 'admins', lower));
  return snap.exists();
}

type AdminListItem = { email: string; primary?: boolean } & Record<string, unknown>;

export async function listAdmins(): Promise<AdminListItem[]> {
  const snap = await getDocs(collection(db, 'admins'));
  const admins: AdminListItem[] = snap.docs.map(d => ({ email: d.id, ...(d.data() as Record<string, unknown>) }));
  if (!admins.some(a => a.email === primaryAdminEmail)) admins.unshift({ email: primaryAdminEmail, primary: true });
  return admins;
}

export async function addAdmin(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('올바른 이메일을 입력해주세요.');
  await setDoc(doc(db, 'admins', normalized), cleanFirestoreData({ email: normalized, createdAt: Date.now() }), { merge: true });
}

export async function removeAdmin(email: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized === primaryAdminEmail) throw new Error('기본 관리자 계정은 삭제할 수 없습니다.');
  await deleteDoc(doc(db, 'admins', normalized));
}

export async function listBrandsForAdmin(): Promise<Brand[]> {
  const snap = await getDocs(query(collection(db, 'brands'), orderBy('createdAt', 'asc')));
  return snap.docs.map(d => normalizeBrand(d.id, d.data()));
}

export async function findBrandByShareToken(token: string): Promise<Brand | null> {
  const snap = await getDocs(query(collection(db, 'brands'), where('shareToken', '==', token), limit(1)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return normalizeBrand(d.id, d.data());
}

export async function createBrand(name: string, color = '#1AB7B0'): Promise<Brand> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('브랜드명을 입력해주세요.');
  const existing = await getDocs(query(collection(db, 'brands'), where('name', '==', trimmed), limit(1)));
  if (!existing.empty) throw new Error('이미 존재하는 브랜드명입니다.');
  const brandRef = doc(collection(db, 'brands'));
  const brand: Brand = {
    id: brandRef.id,
    name: trimmed,
    color,
    shareToken: makeShareToken(),
    metaAdAccountId: '',
    commissionPercent: DEFAULT_COMMISSION_PERCENT,
    visibleReportTabs: [...DEFAULT_VISIBLE_REPORT_TABS],
    dailyToplineMetrics: [...DEFAULT_DAILY_TOPLINE_METRICS],
    createdAt: Date.now()
  };
  const tabRef = doc(collection(db, 'brands', brand.id, 'tabs'));
  const tab: DashboardTab = { id: tabRef.id, brandId: brand.id, name: '기본', sortOrder: 0, createdAt: Date.now() };
  const batch = writeBatch(db);
  batch.set(brandRef, cleanFirestoreData(omitId(brand)));
  batch.set(tabRef, cleanFirestoreData(omitId(tab)));
  batch.set(doc(db, 'brands', brand.id, 'tabs', tab.id, 'kpi', 'default'), cleanFirestoreData(emptyKpi));
  await batch.commit();
  return brand;
}

export async function deleteBrand(brandId: string) {
  const tabs = await listTabs(brandId);
  for (const tab of tabs) await deleteTab(brandId, tab.id, { allowLast: true });
  await deleteDoc(doc(db, 'brands', brandId));
}

export async function updateBrand(brandId: string, patch: BrandPatch) {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error('브랜드명을 입력해주세요.');
    const existing = await getDocs(query(collection(db, 'brands'), where('name', '==', trimmed), limit(2)));
    if (existing.docs.some(d => d.id !== brandId)) throw new Error('이미 존재하는 브랜드명입니다.');
    update.name = trimmed;
  }
  if (patch.color !== undefined) {
    const color = patch.color.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('올바른 HEX 색상을 입력해주세요. (#RRGGBB)');
    update.color = color;
  }
  if (patch.metaAdAccountId !== undefined) {
    update.metaAdAccountId = normalizeMetaAdAccountIds(patch.metaAdAccountId);
  }
  if (patch.commissionPercent !== undefined) {
    const commissionPercent = Number(patch.commissionPercent);
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
      throw new Error('수수료율은 0~100 사이의 숫자로 입력해주세요.');
    }
    update.commissionPercent = Math.round(commissionPercent * 100) / 100;
  }
  if (patch.visibleReportTabs !== undefined) {
    const visibleReportTabs = DEFAULT_VISIBLE_REPORT_TABS.filter(tab => patch.visibleReportTabs?.includes(tab));
    if (!visibleReportTabs.length) throw new Error('최소 1개의 보고서 탭은 표시해야 합니다.');
    update.visibleReportTabs = visibleReportTabs;
  }
  if (patch.dailyToplineMetrics !== undefined) {
    const dailyToplineMetrics = DAILY_TOPLINE_METRIC_KEYS.filter(metric => patch.dailyToplineMetrics?.includes(metric));
    if (!dailyToplineMetrics.length) throw new Error('Daily Topline 지표를 최소 1개 선택해주세요.');
    update.dailyToplineMetrics = dailyToplineMetrics;
  }
  if (Object.keys(update).length === 0) return;
  await updateDoc(doc(db, 'brands', brandId), update);
}

function normalizeMetaAdAccountIds(value: string): string {
  const ids = value
    .split(/[\s,;]+/)
    .map(part => part.trim().replace(/^act_/, ''))
    .filter(Boolean);
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.some(id => !/^\d+$/.test(id))) throw new Error('Ad Account ID는 숫자 또는 act_숫자 형식이어야 합니다.');
  if (uniqueIds.length > 2) throw new Error('브랜드당 Ad Account ID는 최대 2개까지 입력할 수 있습니다.');
  return uniqueIds.join(', ');
}

export async function listTabs(brandId: string): Promise<DashboardTab[]> {
  const snap = await getDocs(query(collection(db, 'brands', brandId, 'tabs'), orderBy('sortOrder', 'asc')));
  return snap.docs.map(d => normalizeTab(d.id, brandId, d.data()));
}

export async function createTab(brandId: string, name: string): Promise<DashboardTab> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('탭 이름을 입력해주세요.');
  const tabs = await listTabs(brandId);
  if (tabs.some(t => t.name === trimmed)) throw new Error('이미 존재하는 탭 이름입니다.');
  const ref = doc(collection(db, 'brands', brandId, 'tabs'));
  const tab: DashboardTab = { id: ref.id, brandId, name: trimmed, sortOrder: tabs.length, createdAt: Date.now() };
  const batch = writeBatch(db);
  batch.set(ref, cleanFirestoreData(omitId(tab)));
  batch.set(doc(db, 'brands', brandId, 'tabs', tab.id, 'kpi', 'default'), cleanFirestoreData(emptyKpi));
  await batch.commit();
  return tab;
}

export async function renameTab(brandId: string, tabId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('탭 이름을 입력해주세요.');
  await updateDoc(doc(db, 'brands', brandId, 'tabs', tabId), { name: trimmed });
}

export async function deleteTab(brandId: string, tabId: string, opts: { allowLast?: boolean } = {}) {
  const tabs = await listTabs(brandId);
  if (!opts.allowLast && tabs.length <= 1) throw new Error('마지막 탭은 삭제할 수 없습니다.');
  const files = await listFiles(brandId, tabId);
  for (const file of files) await deleteFile(brandId, tabId, file.id);
  const reportFiles = await listReportFiles(brandId, tabId);
  for (const file of reportFiles) await deleteReportFile(brandId, tabId, file.id);
  const reportComments = await listReportComments(brandId, tabId);
  for (const comment of reportComments) await deleteDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'reportComments', comment.id));
  const insights = await listInsights(brandId, tabId);
  for (const insight of insights) await deleteDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'insights', insight.id));
  const creativeAssets = await listCreativeAssets(brandId, tabId);
  for (const asset of creativeAssets) await deleteDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'creativeAssets', asset.id));
  await deleteDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'kpi', 'default'));
  await deleteDoc(doc(db, 'brands', brandId, 'tabs', tabId));
}

export async function getKpi(brandId: string, tabId: string): Promise<Kpi> {
  const snap = await getDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'kpi', 'default'));
  return snap.exists() ? { ...emptyKpi, ...(snap.data() as Partial<Kpi>) } : emptyKpi;
}

export async function saveKpi(brandId: string, tabId: string, kpi: Kpi) {
  await setDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'kpi', 'default'), cleanFirestoreData({ ...emptyKpi, ...kpi, updatedAt: Date.now() }), { merge: true });
}

export async function listFiles(brandId: string, tabId: string): Promise<FileDoc[]> {
  const snap = await getDocs(query(collection(db, 'brands', brandId, 'tabs', tabId, 'files'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => normalizeFile(d.id, d.data()));
}

export async function saveFile(brandId: string, tabId: string, file: Omit<FileDoc, 'id'>) {
  const sameName = await getDocs(query(collection(db, 'brands', brandId, 'tabs', tabId, 'files'), where('filename', '==', file.filename), limit(1)));
  for (const d of sameName.docs) await deleteDoc(d.ref);
  const ref = doc(collection(db, 'brands', brandId, 'tabs', tabId, 'files'));
  await setDoc(ref, cleanFirestoreData(file));
  return ref.id;
}

export async function deleteFile(brandId: string, tabId: string, fileId: string) {
  await deleteDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'files', fileId));
}

export async function listReportFiles(brandId: string, tabId: string): Promise<ReportFileDoc[]> {
  const snap = await getDocs(query(collection(db, 'brands', brandId, 'tabs', tabId, 'reportFiles'), orderBy('createdAt', 'desc')));
  return Promise.all(snap.docs.map(d => normalizeReportFile(d.id, brandId, tabId, d.data(), false)));
}

export async function getReportFile(brandId: string, tabId: string, fileId: string): Promise<ReportFileDoc | null> {
  const snap = await getDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'reportFiles', fileId));
  if (!snap.exists()) return null;
  return normalizeReportFile(snap.id, brandId, tabId, snap.data(), true);
}

export async function saveReportFile(brandId: string, tabId: string, file: Omit<ReportFileDoc, 'id'>) {
  const sameName = await getDocs(query(collection(db, 'brands', brandId, 'tabs', tabId, 'reportFiles'), where('filename', '==', file.filename), limit(1)));
  for (const d of sameName.docs) await deleteReportFile(brandId, tabId, d.id);

  const ref = doc(collection(db, 'brands', brandId, 'tabs', tabId, 'reportFiles'));
  const rows = stripReportRows(file.result.rows);
  const chunks = chunk(rows, REPORT_FILE_ROWS_PER_CHUNK);
  const resultMeta: ReportParseResult = { ...file.result, rows: [], preview: [] };

  try {
    for (let index = 0; index < chunks.length; index += REPORT_FILE_CHUNKS_PER_COMMIT) {
      const batch = writeBatch(db);
      chunks.slice(index, index + REPORT_FILE_CHUNKS_PER_COMMIT).forEach((rowsChunk, offset) => {
        const chunkIndex = index + offset;
        batch.set(doc(db, 'brands', brandId, 'tabs', tabId, 'reportFiles', ref.id, 'chunks', String(chunkIndex).padStart(4, '0')), {
          index: chunkIndex,
          rows: rowsChunk
        });
      });
      await batch.commit();
    }

    await setDoc(ref, cleanFirestoreData({ ...file, result: resultMeta, chunkCount: chunks.length }));

    return ref.id;
  } catch (err) {
    await deleteReportFile(brandId, tabId, ref.id).catch(() => undefined);
    throw err;
  }
}

export async function deleteReportFile(brandId: string, tabId: string, fileId: string) {
  const chunks = await getDocs(collection(db, 'brands', brandId, 'tabs', tabId, 'reportFiles', fileId, 'chunks'));
  for (let index = 0; index < chunks.docs.length; index += 450) {
    const batch = writeBatch(db);
    chunks.docs.slice(index, index + 450).forEach(chunkDoc => batch.delete(chunkDoc.ref));
    await batch.commit();
  }
  await deleteDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'reportFiles', fileId));
  await deleteDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'reportComments', fileId)).catch(() => undefined);
}

export async function listReportComments(brandId: string, tabId: string): Promise<ReportCommentDoc[]> {
  const snap = await getDocs(query(collection(db, 'brands', brandId, 'tabs', tabId, 'reportComments'), orderBy('updatedAt', 'desc')));
  return snap.docs.map(d => normalizeReportComment(d.id, d.data()));
}

export async function getReportComment(brandId: string, tabId: string, fileId: string): Promise<ReportCommentDoc | null> {
  const snap = await getDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'reportComments', fileId));
  return snap.exists() ? normalizeReportComment(snap.id, snap.data()) : null;
}

export async function saveReportComment(
  brandId: string,
  tabId: string,
  fileId: string,
  comment: Omit<ReportCommentDoc, 'id' | 'fileId' | 'createdAt' | 'updatedAt'>
) {
  const ref = doc(db, 'brands', brandId, 'tabs', tabId, 'reportComments', fileId);
  const existing = await getDoc(ref);
  const now = Date.now();
  await setDoc(ref, cleanFirestoreData({
    ...comment,
    fileId,
    createdAt: existing.exists() ? Number(existing.data().createdAt || now) : now,
    updatedAt: now
  }), { merge: true });
}

export async function listInsights(brandId: string, tabId: string): Promise<InsightDoc[]> {
  const snap = await getDocs(query(collection(db, 'brands', brandId, 'tabs', tabId, 'insights'), orderBy('createdAt', 'desc'), limit(20)));
  return snap.docs.map(d => normalizeInsight(d.id, d.data()));
}

export async function saveInsight(brandId: string, tabId: string, insight: Omit<InsightDoc, 'id'>) {
  const ref = doc(collection(db, 'brands', brandId, 'tabs', tabId, 'insights'));
  await setDoc(ref, cleanFirestoreData(insight));
  return ref.id;
}

export async function listCreativeAssets(brandId: string, tabId: string): Promise<CreativeAssetDoc[]> {
  const snap = await getDocs(collection(db, 'brands', brandId, 'tabs', tabId, 'creativeAssets'));
  return snap.docs.map(d => normalizeCreativeAsset(d.id, d.data()));
}

export async function upsertCreativeAssets(brandId: string, tabId: string, assets: Array<Partial<CreativeAssetDoc>>) {
  const now = Date.now();
  for (let index = 0; index < assets.length; index += 450) {
    const batch = writeBatch(db);
    assets.slice(index, index + 450).forEach(asset => {
      const key = asset.key || makeCreativeKey(asset);
      if (!key.replace(/\|/g, '')) return;
      const id = asset.id || creativeAssetId(key);
      batch.set(doc(db, 'brands', brandId, 'tabs', tabId, 'creativeAssets', id), cleanFirestoreData({
        ...asset,
        id: undefined,
        key,
        source: asset.source || 'singleone',
        media: asset.media || 's-meta',
        mimeType: asset.mimeType || 'image/webp',
        capturedAt: Number(asset.capturedAt || now),
        updatedAt: now
      }), { merge: true });
    });
    await batch.commit();
  }
}

export async function deleteCreativeAsset(brandId: string, tabId: string, assetId: string) {
  await deleteDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'creativeAssets', assetId));
}

export async function getSingleOneCollectorSettings(brandId: string, tabId: string): Promise<SingleOneCollectorSettings | null> {
  const snap = await getDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'collectorSettings', 'singleone'));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    token: String(data.token || ''),
    updatedAt: Number(data.updatedAt || 0)
  };
}

export async function saveSingleOneCollectorSettings(brandId: string, tabId: string, settings: SingleOneCollectorSettings) {
  await setDoc(doc(db, 'brands', brandId, 'tabs', tabId, 'collectorSettings', 'singleone'), cleanFirestoreData(settings), { merge: true });
}

function makeShareToken() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `brand_${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

function omitId<T extends { id: string }>(item: T): Omit<T, 'id'> {
  const { id, ...rest } = item;
  return rest;
}

function cleanFirestoreData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => cleanFirestoreData(v)).filter(v => v !== undefined) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) continue;
      out[key] = cleanFirestoreData(val);
    }
    return out as T;
  }
  return value;
}

function normalizeBrand(id: string, data: Record<string, unknown>): Brand {
  const storedCommission = Number(data.commissionPercent);
  const storedVisibleTabs = Array.isArray(data.visibleReportTabs) ? data.visibleReportTabs.map(String) : [];
  const visibleReportTabs = DEFAULT_VISIBLE_REPORT_TABS.filter(tab => storedVisibleTabs.includes(tab));
  const storedDailyToplineMetrics = Array.isArray(data.dailyToplineMetrics) ? data.dailyToplineMetrics.map(String) : [];
  const dailyToplineMetrics = DAILY_TOPLINE_METRIC_KEYS.filter(metric => storedDailyToplineMetrics.includes(metric));
  return {
    id,
    name: String(data.name || ''),
    color: String(data.color || '#1AB7B0'),
    shareToken: String(data.shareToken || ''),
    metaAdAccountId: String(data.metaAdAccountId || ''),
    commissionPercent: Number.isFinite(storedCommission) && storedCommission >= 0 && storedCommission <= 100
      ? storedCommission
      : DEFAULT_COMMISSION_PERCENT,
    visibleReportTabs: visibleReportTabs.length ? visibleReportTabs : [...DEFAULT_VISIBLE_REPORT_TABS],
    dailyToplineMetrics: dailyToplineMetrics.length ? dailyToplineMetrics : [...DEFAULT_DAILY_TOPLINE_METRICS],
    createdAt: Number(data.createdAt || 0)
  };
}

function normalizeTab(id: string, brandId: string, data: Record<string, unknown>): DashboardTab {
  return {
    id,
    brandId: String(data.brandId || brandId),
    name: String(data.name || '기본'),
    sortOrder: Number(data.sortOrder || 0),
    createdAt: Number(data.createdAt || 0)
  };
}

function normalizeFile(id: string, data: Record<string, unknown>): FileDoc {
  return {
    id,
    filename: String(data.filename || ''),
    fileSize: Number(data.fileSize || 0),
    dateStart: String(data.dateStart || ''),
    dateEnd: String(data.dateEnd || ''),
    rowCount: Number(data.rowCount || 0),
    total: normalizeStat(data.total as Record<string, unknown> | undefined, 'total'),
    dailyStats: normalizeStats(data.dailyStats),
    campaignDailyStats: normalizeStats(data.campaignDailyStats),
    adsetDailyStats: normalizeStats(data.adsetDailyStats),
    detailStats: normalizeStats(data.detailStats),
    creativeStats: normalizeStats(data.creativeStats),
    createdAt: Number(data.createdAt || 0)
  };
}

async function normalizeReportFile(id: string, brandId: string, tabId: string, data: Record<string, unknown>, includeRows: boolean): Promise<ReportFileDoc> {
  const rows = includeRows ? await loadReportFileRows(brandId, tabId, id) : [];
  const result = data.result as ReportParseResult | undefined;
  const safeResult: ReportParseResult = {
    fileName: String(result?.fileName || data.filename || ''),
    sheet: result?.sheet || {
      sheetName: '',
      headerRowIndex: 0,
      rowCount: rows.length,
      score: 0,
      columns: {},
      missingRequired: [],
      missingRecommended: []
    },
    detections: Array.isArray(result?.detections) ? result.detections : [],
    rows,
    preview: rows.slice(0, 12),
    issues: Array.isArray(result?.issues) ? result.issues : [],
    exchangeRate: Number(result?.exchangeRate || data.exchangeRate || 0),
    generatedAt: Number(result?.generatedAt || data.createdAt || 0)
  };

  return {
    id,
    filename: String(data.filename || safeResult.fileName || ''),
    fileSize: Number(data.fileSize || 0),
    dateStart: String(data.dateStart || ''),
    dateEnd: String(data.dateEnd || ''),
    rowCount: Number(data.rowCount || rows.length || 0),
    exchangeRate: Number(data.exchangeRate || safeResult.exchangeRate || 0),
    result: safeResult,
    createdAt: Number(data.createdAt || 0)
  };
}

async function loadReportFileRows(brandId: string, tabId: string, fileId: string): Promise<NormalizedReportRow[]> {
  const chunksSnap = await getDocs(query(collection(db, 'brands', brandId, 'tabs', tabId, 'reportFiles', fileId, 'chunks'), orderBy('index', 'asc')));
  return chunksSnap.docs.flatMap(chunkDoc => {
    const chunkData = chunkDoc.data() as { rows?: NormalizedReportRow[] };
    return Array.isArray(chunkData.rows) ? chunkData.rows : [];
  });
}

function normalizeInsight(id: string, data: Record<string, unknown>): InsightDoc {
  return {
    id,
    text: String(data.text || ''),
    createdAt: Number(data.createdAt || 0),
    fileIds: Array.isArray(data.fileIds) ? data.fileIds.map(String) : [],
    periodStart: String(data.periodStart || ''),
    periodEnd: String(data.periodEnd || '')
  };
}

function normalizeStats(value: unknown): import('./types').StatRow[] {
  return Array.isArray(value) ? value.map((v, index) => normalizeStat(v as Record<string, unknown>, String(index))) : [];
}

function normalizeReportComment(id: string, data: Record<string, unknown>): ReportCommentDoc {
  return {
    id,
    fileId: String(data.fileId || id),
    text: String(data.text || ''),
    periodStart: String(data.periodStart || ''),
    periodEnd: String(data.periodEnd || ''),
    createdAt: Number(data.createdAt || 0),
    updatedAt: Number(data.updatedAt || 0)
  };
}

function normalizeCreativeAsset(id: string, data: Record<string, unknown>): CreativeAssetDoc {
  const asset = {
    id,
    key: String(data.key || ''),
    source: data.source === 'meta' ? 'meta' as const : 'singleone' as const,
    media: String(data.media || 's-meta'),
    campaignName: String(data.campaignName || ''),
    adgroupName: String(data.adgroupName || ''),
    adName: String(data.adName || ''),
    imageData: data.imageData ? String(data.imageData) : undefined,
    sourceImageUrl: data.sourceImageUrl ? String(data.sourceImageUrl) : undefined,
    mimeType: String(data.mimeType || 'image/webp'),
    width: Number(data.width || 0),
    height: Number(data.height || 0),
    imageHash: String(data.imageHash || ''),
    capturedAt: Number(data.capturedAt || 0),
    updatedAt: Number(data.updatedAt || 0)
  };
  return {
    ...asset,
    key: asset.key || makeCreativeKey(asset)
  };
}

function stripReportRows(rows: NormalizedReportRow[]): NormalizedReportRow[] {
  return rows.map(row => ({ ...row, raw: {} }));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeStat(data: Record<string, unknown> | undefined, fallbackKey: string): import('./types').StatRow {
  const d = data || {};
  const base: import('./types').StatRow = {
    key: String(d.key || fallbackKey),
    spend: Number(d.spend || 0),
    impression: Number(d.impression || 0),
    click: Number(d.click || 0),
    landingPageView: Number(d.landingPageView || 0),
    ctr: Number(d.ctr || 0),
    cpm: Number(d.cpm || 0),
    cpc: Number(d.cpc || 0),
    roas: Number(d.roas || 0)
  };
  if (d.date) base.date = String(d.date);
  if (d.campaignName) base.campaignName = String(d.campaignName);
  if (d.adsetName) base.adsetName = String(d.adsetName);
  if (d.adName) base.adName = String(d.adName);
  return base;
}
