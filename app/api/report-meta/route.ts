import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { creativeAssetId, makeCreativeKey } from '@/lib/report/creativeKey';
import { toGrossCostKrw } from '@/lib/report/schema';
import type { NormalizedReportRow, ReportParseResult } from '@/lib/report/reportTypes';

/** 2년치처럼 긴 기간을 가져올 때 기본 실행 시간(10~15초)으로는 반드시 504가 난다. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const META_API_VERSION = process.env.META_API_VERSION || 'v20.0';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const REPORT_FILE_ROWS_PER_CHUNK = 200;
const META_DATE_CHUNK_DAYS = 7;
const META_ADSET_FILTER_CHUNK_SIZE = 50;
const META_AD_CREATIVE_CHUNK_SIZE = 50;
const META_CREATIVE_WRITE_CONCURRENCY = 6;
const META_CREATIVE_REQUEST_BATCH_SIZE = 25;
const MAX_META_IMAGE_DATA_LENGTH = 240_000;
/** Meta Graph API 요청은 전역으로 이만큼만 동시에 나간다(rate limit 회피). */
const META_REQUEST_CONCURRENCY = 6;
const REPORT_CHUNK_WRITE_CONCURRENCY = 12;
const primaryAdminEmail = (process.env.GFU_DASH_PRIMARY_ADMIN_EMAIL || '').toLowerCase();

type MetaAction = { action_type: string; value: string };

type MetaInsightRow = {
  date_start: string;
  date_stop: string;
  ad_id?: string;
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
  spend?: string;
  account_currency?: string;
  impressions?: string;
  inline_link_clicks?: string;
  clicks?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
};

type MetaCampaign = { id: string; name: string };
type MetaAdset = { id: string; name: string; campaignId: string; campaignName: string };
type MetaAdOption = {
  id: string;
  adId: string;
  name: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
};
type MetaCreativeCandidate = {
  adId: string;
  key: string;
  documentId: string;
  campaignName: string;
  adgroupName: string;
  adName: string;
};
type MetaAdCreative = {
  id?: string;
  creative?: {
    id?: string;
    thumbnail_url?: string;
    image_url?: string;
  };
};
type MetaCreativeSyncStats = {
  total: number;
  requested: number;
  skippedExisting: number;
  saved: number;
  failed: number;
};

type MetaApiErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

function webConfig() {
  const raw = process.env.FIREBASE_WEB_CONFIG;
  if (!raw) throw new Error('FIREBASE_WEB_CONFIG가 설정되지 않았습니다.');
  return JSON.parse(raw) as { apiKey: string; projectId: string };
}

async function verifyFirebaseToken(idToken: string): Promise<{ email: string } | null> {
  const { apiKey } = webConfig();
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const email = data.users?.[0]?.email?.toLowerCase();
  return email ? { email } : null;
}

async function isAdmin(email: string, idToken: string): Promise<boolean> {
  if (email === primaryAdminEmail) return true;
  const { projectId } = webConfig();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/admins/${encodeURIComponent(email)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` }, cache: 'no-store' });
  return resp.ok;
}

async function requireAdmin(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!idToken) return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) };

  const user = await verifyFirebaseToken(idToken);
  if (!user) return { error: NextResponse.json({ error: '유효하지 않은 토큰입니다.' }, { status: 401 }) };

  const allowed = await isAdmin(user.email, idToken);
  if (!allowed) return { error: NextResponse.json({ error: '관리자만 사용할 수 있습니다.' }, { status: 403 }) };

  return { idToken };
}

function metaToken() {
  if (!META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN 환경변수가 설정되지 않았습니다.');
  return META_ACCESS_TOKEN;
}

async function fetchCampaignsAndAdsets(adAccountId: string, dateStart: string, dateEnd: string): Promise<{ campaigns: MetaCampaign[]; adsets: MetaAdset[] }> {
  const campaignMap = new Map<string, string>();
  const adsetMap = new Map<string, Omit<MetaAdset, 'id'>>();

  const chunks = dateChunks(dateStart, dateEnd, META_DATE_CHUNK_DAYS);
  const windows = await Promise.all(chunks.map(range => (
    withDailyFallback(range.start, range.end, (start, end) => fetchCampaignsAndAdsetsWindow(adAccountId, start, end))
  )));
  for (const result of windows) {
    for (const campaign of result.campaigns) campaignMap.set(campaign.id, campaign.name);
    for (const adset of result.adsets) {
      adsetMap.set(adset.id, {
        name: adset.name,
        campaignId: adset.campaignId,
        campaignName: adset.campaignName
      });
    }
  }

  return {
    campaigns: Array.from(campaignMap.entries()).map(([id, name]) => ({ id, name })),
    adsets: Array.from(adsetMap.entries()).map(([id, rest]) => ({ id, ...rest }))
  };
}

async function fetchCampaignsAndAdsetsForAccounts(adAccountIds: string[], dateStart: string, dateEnd: string): Promise<{ campaigns: MetaCampaign[]; adsets: MetaAdset[] }> {
  const results = await Promise.all(adAccountIds.map(adAccountId => fetchCampaignsAndAdsets(adAccountId, dateStart, dateEnd)));
  const campaigns: MetaCampaign[] = [];
  const adsets: MetaAdset[] = [];

  results.forEach((result, index) => {
    const adAccountId = adAccountIds[index];
    for (const campaign of result.campaigns) {
      campaigns.push({
        id: accountScopedId(adAccountId, campaign.id),
        name: adAccountIds.length > 1 ? `${campaign.name} · act_${adAccountId}` : campaign.name
      });
    }
    for (const adset of result.adsets) {
      adsets.push({
        id: accountScopedId(adAccountId, adset.id),
        name: adAccountIds.length > 1 ? `${adset.name} · act_${adAccountId}` : adset.name,
        campaignId: accountScopedId(adAccountId, adset.campaignId),
        campaignName: adAccountIds.length > 1 ? `${adset.campaignName} · act_${adAccountId}` : adset.campaignName
      });
    }
  });

  return { campaigns, adsets };
}

async function fetchCreativeOptionsForAccounts(
  adAccountIds: string[],
  dateStart: string,
  dateEnd: string
): Promise<{ campaigns: MetaCampaign[]; adsets: MetaAdset[]; ads: MetaAdOption[] }> {
  const results = await Promise.all(adAccountIds.map(adAccountId => fetchCreativeOptions(adAccountId, dateStart, dateEnd)));
  const campaigns: MetaCampaign[] = [];
  const adsets: MetaAdset[] = [];
  const ads: MetaAdOption[] = [];

  results.forEach((result, index) => {
    const adAccountId = adAccountIds[index];
    for (const campaign of result.campaigns) {
      campaigns.push({
        id: accountScopedId(adAccountId, campaign.id),
        name: adAccountIds.length > 1 ? `${campaign.name} · act_${adAccountId}` : campaign.name
      });
    }
    for (const adset of result.adsets) {
      adsets.push({
        id: accountScopedId(adAccountId, adset.id),
        name: adAccountIds.length > 1 ? `${adset.name} · act_${adAccountId}` : adset.name,
        campaignId: accountScopedId(adAccountId, adset.campaignId),
        campaignName: adAccountIds.length > 1 ? `${adset.campaignName} · act_${adAccountId}` : adset.campaignName
      });
    }
    for (const ad of result.ads) {
      ads.push({
        id: accountScopedId(adAccountId, ad.adId),
        adId: ad.adId,
        name: ad.name,
        adsetId: accountScopedId(adAccountId, ad.adsetId),
        adsetName: ad.adsetName,
        campaignId: accountScopedId(adAccountId, ad.campaignId),
        campaignName: ad.campaignName
      });
    }
  });

  return { campaigns, adsets, ads };
}

async function fetchCreativeOptions(
  adAccountId: string,
  dateStart: string,
  dateEnd: string
): Promise<{ campaigns: MetaCampaign[]; adsets: MetaAdset[]; ads: MetaAdOption[] }> {
  try {
    return await fetchCreativeOptionsWindow(adAccountId, dateStart, dateEnd);
  } catch (err) {
    if (!isTemporaryMetaError(err)) throw err;
    const parts = await Promise.all(dateChunks(dateStart, dateEnd, 30).map(range => (
      fetchCreativeOptionsWindow(adAccountId, range.start, range.end)
    )));
    return mergeCreativeOptions(parts);
  }
}

async function fetchCreativeOptionsWindow(
  adAccountId: string,
  dateStart: string,
  dateEnd: string
): Promise<{ campaigns: MetaCampaign[]; adsets: MetaAdset[]; ads: MetaAdOption[] }> {
  type Row = {
    campaign_id?: string;
    campaign_name?: string;
    adset_id?: string;
    adset_name?: string;
    ad_id?: string;
    ad_name?: string;
  };
  const params = new URLSearchParams({
    access_token: metaToken(),
    level: 'ad',
    time_range: JSON.stringify({ since: dateStart, until: dateEnd }),
    fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name',
    limit: '500'
  });
  const rows: Row[] = [];
  let url: string | null = `https://graph.facebook.com/${META_API_VERSION}/act_${normalizeAdAccountId(adAccountId)}/insights?${params}`;
  while (url) {
    const data = await fetchMetaJson<{ data?: Row[]; paging?: { next?: string } }>(url);
    rows.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  const campaigns = new Map<string, string>();
  const adsets = new Map<string, MetaAdset>();
  const ads = new Map<string, MetaAdOption>();
  for (const row of rows) {
    if (!row.campaign_id || !row.adset_id || !row.ad_id) continue;
    const campaignName = row.campaign_name || row.campaign_id;
    const adsetName = row.adset_name || row.adset_id;
    campaigns.set(row.campaign_id, campaignName);
    adsets.set(row.adset_id, {
      id: row.adset_id,
      name: adsetName,
      campaignId: row.campaign_id,
      campaignName
    });
    ads.set(row.ad_id, {
      id: row.ad_id,
      adId: row.ad_id,
      name: row.ad_name || row.ad_id,
      adsetId: row.adset_id,
      adsetName,
      campaignId: row.campaign_id,
      campaignName
    });
  }

  return {
    campaigns: Array.from(campaigns.entries()).map(([id, name]) => ({ id, name })),
    adsets: Array.from(adsets.values()),
    ads: Array.from(ads.values())
  };
}

function mergeCreativeOptions(
  parts: Array<{ campaigns: MetaCampaign[]; adsets: MetaAdset[]; ads: MetaAdOption[] }>
): { campaigns: MetaCampaign[]; adsets: MetaAdset[]; ads: MetaAdOption[] } {
  const campaigns = new Map<string, MetaCampaign>();
  const adsets = new Map<string, MetaAdset>();
  const ads = new Map<string, MetaAdOption>();
  for (const part of parts) {
    for (const campaign of part.campaigns) campaigns.set(campaign.id, campaign);
    for (const adset of part.adsets) adsets.set(adset.id, adset);
    for (const ad of part.ads) ads.set(ad.id, ad);
  }
  return {
    campaigns: Array.from(campaigns.values()),
    adsets: Array.from(adsets.values()),
    ads: Array.from(ads.values())
  };
}

async function fetchCampaignsAndAdsetsWindow(adAccountId: string, dateStart: string, dateEnd: string): Promise<{ campaigns: MetaCampaign[]; adsets: MetaAdset[] }> {
  const params = new URLSearchParams({
    access_token: metaToken(),
    level: 'adset',
    time_range: JSON.stringify({ since: dateStart, until: dateEnd }),
    fields: 'campaign_id,campaign_name,adset_id,adset_name',
    limit: '500'
  });

  type Row = { campaign_id: string; campaign_name: string; adset_id: string; adset_name: string };
  const rows: Row[] = [];
  let url: string | null = `https://graph.facebook.com/${META_API_VERSION}/act_${normalizeAdAccountId(adAccountId)}/insights?${params}`;
  while (url) {
    const data = await fetchMetaJson<{ data?: Row[]; paging?: { next?: string } }>(url);
    rows.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  const campaignMap = new Map<string, string>();
  const adsetMap = new Map<string, Omit<MetaAdset, 'id'>>();
  for (const row of rows) {
    if (!row.campaign_id || !row.adset_id) continue;
    campaignMap.set(row.campaign_id, row.campaign_name || row.campaign_id);
    adsetMap.set(row.adset_id, {
      name: row.adset_name || row.adset_id,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name || row.campaign_id
    });
  }

  return {
    campaigns: Array.from(campaignMap.entries()).map(([id, name]) => ({ id, name })),
    adsets: Array.from(adsetMap.entries()).map(([id, rest]) => ({ id, ...rest }))
  };
}

async function fetchAllInsights(adAccountId: string, dateStart: string, dateEnd: string, adsetIds?: string[]): Promise<MetaInsightRow[]> {
  const adsetChunks = adsetIds?.length ? chunk(adsetIds, META_ADSET_FILTER_CHUNK_SIZE) : [[]];
  const rangeChunks = dateChunks(dateStart, dateEnd, META_DATE_CHUNK_DAYS);
  const jobs = rangeChunks.flatMap(range => adsetChunks.map(ids => ({ range, ids })));

  // 2년치면 기간 청크만 100개가 넘는다. 순차로 돌리면 함수 실행 시간을 넘겨 504가 난다.
  const results = await Promise.all(jobs.map(job => (
    withDailyFallback(job.range.start, job.range.end, (start, end) => fetchAllInsightsWindow(adAccountId, start, end, job.ids))
  )));

  return results.flat();
}

async function fetchAllInsightsForAccounts(adAccountIds: string[], dateStart: string, dateEnd: string, adsetIds?: string[]): Promise<MetaInsightRow[]> {
  const filtersByAccount = adsetIds?.length ? adsetFiltersByAccount(adAccountIds, adsetIds) : null;
  const results = await Promise.all(adAccountIds.map(adAccountId => {
    const scopedAdsetIds = filtersByAccount?.get(adAccountId);
    if (filtersByAccount && !scopedAdsetIds?.length) return Promise.resolve([] as MetaInsightRow[]);
    return fetchAllInsights(adAccountId, dateStart, dateEnd, scopedAdsetIds);
  }));
  return results.flat();
}

async function fetchAllInsightsWindow(adAccountId: string, dateStart: string, dateEnd: string, adsetIds?: string[]): Promise<MetaInsightRow[]> {
  const fields = [
    'date_start',
    'date_stop',
    'ad_id',
    'campaign_name',
    'adset_name',
    'ad_name',
    'spend',
    'account_currency',
    'impressions',
    'inline_link_clicks',
    'clicks',
    'actions',
    'action_values'
  ].join(',');

  const filtering = adsetIds?.length
    ? [{ field: 'adset.id', operator: 'IN', value: adsetIds }]
    : [];

  const params = new URLSearchParams({
    access_token: metaToken(),
    level: 'ad',
    time_increment: '1',
    time_range: JSON.stringify({ since: dateStart, until: dateEnd }),
    fields,
    limit: '500',
    ...(filtering.length ? { filtering: JSON.stringify(filtering) } : {})
  });

  const rows: MetaInsightRow[] = [];
  let url: string | null = `https://graph.facebook.com/${META_API_VERSION}/act_${normalizeAdAccountId(adAccountId)}/insights?${params}`;
  while (url) {
    const data = await fetchMetaJson<{ data?: MetaInsightRow[]; paging?: { next?: string } }>(url);
    rows.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  return rows;
}

async function withDailyFallback<T>(dateStart: string, dateEnd: string, fetcher: (start: string, end: string) => Promise<T>): Promise<T> {
  try {
    return await fetcher(dateStart, dateEnd);
  } catch (err) {
    if (!isTemporaryMetaError(err) || dateStart === dateEnd) throw err;
    const dailyResults = await Promise.all(
      dateChunks(dateStart, dateEnd, 1).map(chunk => fetcher(chunk.start, chunk.end))
    );
    const first = dailyResults[0];
    if (Array.isArray(first)) return dailyResults.flat() as T;
    const campaigns = new Map<string, string>();
    const adsets = new Map<string, MetaAdset>();
    for (const result of dailyResults as { campaigns: MetaCampaign[]; adsets: MetaAdset[] }[]) {
      for (const campaign of result.campaigns) campaigns.set(campaign.id, campaign.name);
      for (const adset of result.adsets) adsets.set(adset.id, adset);
    }
    return {
      campaigns: Array.from(campaigns.entries()).map(([id, name]) => ({ id, name })),
      adsets: Array.from(adsets.values())
    } as T;
  }
}

function isTemporaryMetaError(err: unknown): boolean {
  return err instanceof Error && (err.message.includes('code=2') || err.message.includes('code=1'));
}

/** 순서를 유지하면서 최대 limit개씩만 동시에 실행한다. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

let metaInFlight = 0;
const metaWaiters: Array<() => void> = [];

/** 계정·기간 청크를 병렬로 돌려도 Graph API 동시 요청 수는 전역으로 묶어 둔다. */
async function withMetaSlot<T>(task: () => Promise<T>): Promise<T> {
  while (metaInFlight >= META_REQUEST_CONCURRENCY) {
    await new Promise<void>(resolve => metaWaiters.push(resolve));
  }
  metaInFlight += 1;
  try {
    return await task();
  } finally {
    metaInFlight -= 1;
    metaWaiters.shift()?.();
  }
}

async function fetchMetaJson<T>(url: string): Promise<T> {
  return withMetaSlot(() => fetchMetaJsonDirect<T>(url));
}

async function fetchMetaJsonDirect<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) return data as T;

      const message = formatMetaError(data as MetaApiErrorBody);
      const code = (data as MetaApiErrorBody).error?.code;
      if (code === 1 || code === 2) {
        lastError = new Error(message);
        await delay(400 * (attempt + 1));
        continue;
      }
      throw new Error(message);
    } catch (err) {
      lastError = err;
      await delay(400 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Meta API 조회에 실패했습니다.');
}

function formatMetaError(data: MetaApiErrorBody): string {
  const error = data.error;
  if (!error) return 'Meta API: 조회에 실패했습니다.';
  const parts = [
    `Meta API: ${error.message || '조회에 실패했습니다.'}`,
    error.type ? `type=${error.type}` : '',
    error.code !== undefined ? `code=${error.code}` : '',
    error.error_subcode !== undefined ? `subcode=${error.error_subcode}` : '',
    error.fbtrace_id ? `fbtrace_id=${error.fbtrace_id}` : ''
  ].filter(Boolean);
  return parts.join(' · ');
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toReportResult(insights: MetaInsightRow[], filename: string, exchangeRate: number): ReportParseResult {
  const rows = insights.map((row, index) => toReportRow(row, index + 1, exchangeRate));
  return {
    fileName: filename,
    sheet: {
      sheetName: 'Meta API',
      headerRowIndex: 0,
      rowCount: rows.length,
      score: 100,
      columns: {},
      missingRequired: [],
      missingRecommended: []
    },
    detections: [],
    rows,
    preview: rows.slice(0, 12),
    issues: [],
    exchangeRate,
    generatedAt: Date.now()
  };
}

function toReportRow(row: MetaInsightRow, sourceRowNumber: number, exchangeRate: number): NormalizedReportRow {
  const spend = number(row.spend);
  const sales = actionValue(row.action_values, ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']);
  const clicks = number(row.inline_link_clicks) || number(row.clicks);
  const impressions = number(row.impressions);
  const conversions = actionValue(row.actions, ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']);
  const addToCart = actionValue(row.actions, ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart']);
  const registration = actionValue(row.actions, ['omni_complete_registration', 'complete_registration', 'offsite_conversion.fb_pixel_complete_registration']);
  const lead = actionValue(row.actions, ['omni_lead', 'lead', 'offsite_conversion.fb_pixel_lead']);
  const date = row.date_start || row.date_stop || '';
  // 광고 계정 통화가 JPY가 아니면(예: KRW 계정) 환율을 곱하면 안 된다.
  const currency = normalizeCurrency(row.account_currency);
  const isJpy = currency === 'JPY';
  const costKrw = isJpy ? spend * exchangeRate : spend;
  const salesKrw = isJpy ? sales * exchangeRate : sales;
  const costJpy = isJpy ? spend : 0;
  const salesJpy = isJpy ? sales : 0;
  const identityText = `${row.campaign_name || ''} ${row.adset_name || ''} ${row.ad_name || ''}`;

  return {
    sourceRowNumber,
    date,
    brand: '',
    media: 'Meta',
    promotion: inferMetaPromotion(identityText),
    campaignName: row.campaign_name || 'Meta 캠페인',
    adgroupName: row.adset_name || 'Meta 광고세트',
    adName: row.ad_name || 'Meta 광고',
    currency,
    impressions,
    clicks,
    conversions,
    costJpy,
    costKrw,
    grossCostKrw: toGrossCostKrw(costKrw, date),
    salesJpy,
    salesKrw,
    addToCart,
    registration,
    lead,
    order: conversions,
    ctr: ratio(clicks, impressions),
    cpm: ratio(costKrw * 1000, impressions),
    cpc: ratio(costKrw, clicks),
    cvr: ratio(conversions, clicks),
    cpa: ratio(costKrw, conversions),
    cartCpa: ratio(costKrw, addToCart),
    roas: ratio(salesKrw, costKrw),
    raw: row as Record<string, unknown>
  };
}

/** 조회 결과에 섞여 있는 광고 계정 통화 목록. 파일명에 붙여 어떤 통화로 들어왔는지 보여준다. */
function insightCurrencies(insights: MetaInsightRow[]): string[] {
  return [...new Set(insights.map(row => normalizeCurrency(row.account_currency)))].sort();
}

/** Meta 계정 통화. 값이 없는 응답은 기존 동작(JPY 계정)을 유지한다. */
function normalizeCurrency(value: unknown): string {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : 'JPY';
}

function inferMetaPromotion(value: string): string {
  if (textIncludesAny(value, ['메가포', 'megapo', 'mega po'])) return '메가포 캠페인';
  if (textIncludesAny(value, ['메가와리', 'megawari', 'mega wari'])) return '메가와리 캠페인';
  if (textIncludesAny(value, ['market', '마켓'])) return '마켓';
  return 'Meta';
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function textIncludesAny(value: string, keywords: string[]): boolean {
  const text = normalizeText(value);
  const compactText = text.replace(/\s+/g, '');
  return keywords.some(keyword => {
    const normalized = normalizeText(keyword);
    return text.includes(normalized) || compactText.includes(normalized.replace(/\s+/g, ''));
  });
}

async function syncMetaCreativeCandidates(
  brandId: string,
  tabId: string,
  candidates: MetaCreativeCandidate[],
  idToken: string
): Promise<MetaCreativeSyncStats> {
  if (!candidates.length) return { total: 0, requested: 0, skippedExisting: 0, saved: 0, failed: 0 };

  const existingDocumentIds = await listExistingCreativeDocumentIds(brandId, tabId, candidates, idToken);
  const missing = candidates.filter(candidate => !existingDocumentIds.has(candidate.documentId));
  if (!missing.length) {
    return {
      total: candidates.length,
      requested: 0,
      skippedExisting: candidates.length,
      saved: 0,
      failed: 0
    };
  }

  const creativeByAdId = await fetchMetaAdCreatives(missing.map(candidate => candidate.adId));
  const downloadedByAdId = new Map<string, Promise<DownloadedMetaImage>>();
  let saved = 0;
  let failed = 0;

  await runWithConcurrency(missing, META_CREATIVE_WRITE_CONCURRENCY, async candidate => {
    try {
      const ad = creativeByAdId.get(candidate.adId);
      const creative = ad?.creative;
      if (!creative) throw new Error('creative 정보가 없습니다.');

      let download = downloadedByAdId.get(candidate.adId);
      if (!download) {
        download = downloadMetaCreativeImage(creative.thumbnail_url, creative.image_url);
        downloadedByAdId.set(candidate.adId, download);
      }
      const image = await download;
      const now = Date.now();
      const { projectId } = webConfig();
      const path = `projects/${projectId}/databases/(default)/documents/brands/${brandId}/tabs/${tabId}/creativeAssets/${candidate.documentId}`;
      await writeFirestoreDocument(path, {
        key: candidate.key,
        source: 'meta',
        media: 'Meta',
        campaignName: candidate.campaignName,
        adgroupName: candidate.adgroupName,
        adName: candidate.adName,
        imageData: image.imageData,
        sourceImageUrl: image.sourceUrl,
        mimeType: image.mimeType,
        width: 0,
        height: 0,
        imageHash: image.imageHash,
        capturedAt: now,
        updatedAt: now
      }, idToken);
      saved += 1;
    } catch {
      failed += 1;
    }
  });

  return {
    total: candidates.length,
    requested: missing.length,
    skippedExisting: candidates.length - missing.length,
    saved,
    failed
  };
}

function normalizeMetaCreativeCandidatePayload(value: unknown): MetaCreativeCandidate[] {
  if (!Array.isArray(value) || value.length > META_CREATIVE_REQUEST_BATCH_SIZE) return [];
  const candidates = new Map<string, MetaCreativeCandidate>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const adId = String(raw.adId || '').trim();
    const campaignName = String(raw.campaignName || '').trim();
    const adgroupName = String(raw.adgroupName || '').trim();
    const adName = String(raw.adName || '').trim();
    if (!/^\d+$/.test(adId) || !campaignName || !adgroupName || !adName) continue;
    if ([campaignName, adgroupName, adName].some(name => name.length > 500)) continue;
    const key = makeCreativeKey({ media: 'Meta', campaignName, adgroupName, adName });
    candidates.set(key, {
      adId,
      key,
      documentId: creativeAssetId(key),
      campaignName,
      adgroupName,
      adName
    });
  }
  return Array.from(candidates.values());
}

async function listExistingCreativeDocumentIds(
  brandId: string,
  tabId: string,
  candidates: MetaCreativeCandidate[],
  idToken: string
): Promise<Set<string>> {
  const { projectId } = webConfig();
  const documentPrefix = `projects/${projectId}/databases/(default)/documents/brands/${brandId}/tabs/${tabId}/creativeAssets`;
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchGet`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        documents: candidates.map(candidate => `${documentPrefix}/${candidate.documentId}`),
        mask: { fieldPaths: ['key'] }
      }),
      cache: 'no-store'
    }
  );
  const data = await resp.json().catch(() => ({})) as Array<{ found?: { name?: string } }> | { error?: { message?: string } };
  if (!resp.ok || !Array.isArray(data)) {
    const message = !Array.isArray(data) ? data.error?.message : '';
    throw new Error(`Firestore 기존 이미지 확인 실패: ${message || `HTTP ${resp.status}`}`);
  }

  return new Set(data.flatMap(item => {
    const name = item.found?.name || '';
    return name ? [name.split('/').at(-1) || ''] : [];
  }).filter(Boolean));
}

async function fetchMetaAdCreatives(adIds: string[]): Promise<Map<string, MetaAdCreative>> {
  const result = new Map<string, MetaAdCreative>();
  const uniqueIds = Array.from(new Set(adIds));
  for (const ids of chunk(uniqueIds, META_AD_CREATIVE_CHUNK_SIZE)) {
    const params = new URLSearchParams({
      access_token: metaToken(),
      ids: ids.join(','),
      fields: 'id,creative{id,thumbnail_url,image_url}'
    });
    const data = await fetchMetaJson<Record<string, MetaAdCreative>>(`https://graph.facebook.com/${META_API_VERSION}/?${params}`);
    for (const [adId, ad] of Object.entries(data)) {
      if (ad && !('error' in ad)) result.set(adId, ad);
    }
  }
  return result;
}

type DownloadedMetaImage = {
  imageData: string;
  sourceUrl: string;
  mimeType: string;
  imageHash: string;
};

async function downloadMetaCreativeImage(thumbnailUrl?: string, imageUrl?: string): Promise<DownloadedMetaImage> {
  const urls = Array.from(new Set([thumbnailUrl, imageUrl].filter((value): value is string => Boolean(value))));
  let lastError = '이미지 URL이 없습니다.';

  for (const sourceUrl of urls) {
    try {
      const resp = await fetch(sourceUrl, { cache: 'no-store', redirect: 'follow' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const mimeType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      if (!mimeType.startsWith('image/')) throw new Error(`${mimeType} 응답`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const imageData = `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
      if (imageData.length > MAX_META_IMAGE_DATA_LENGTH) {
        throw new Error(`이미지 데이터가 너무 큽니다 (${imageData.length.toLocaleString()} bytes)`);
      }
      return {
        imageData,
        sourceUrl,
        mimeType,
        imageHash: await sha256Hex(bytes)
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex');
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function saveReportFileToFirestore(brandId: string, tabId: string, fileDoc: {
  filename: string;
  fileSize: number;
  dateStart: string;
  dateEnd: string;
  rowCount: number;
  exchangeRate: number;
  result: ReportParseResult;
  createdAt: number;
}, idToken: string) {
  const { projectId } = webConfig();
  const docId = `meta_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const basePath = `projects/${projectId}/databases/(default)/documents/brands/${brandId}/tabs/${tabId}/reportFiles/${docId}`;
  const rows = fileDoc.result.rows.map(row => ({ ...row, raw: {} }));
  const chunks = chunk(rows, REPORT_FILE_ROWS_PER_CHUNK);
  const resultMeta: ReportParseResult = { ...fileDoc.result, rows: [], preview: [] };

  await writeFirestoreDocument(basePath, {
    ...fileDoc,
    result: resultMeta,
    chunkCount: chunks.length
  }, idToken);

  // 2년치는 청크 문서가 수백 개가 된다. 한 개씩 PATCH하면 Meta 조회를 통과해도 저장 단계에서 504가 난다.
  await mapWithConcurrency(chunks, REPORT_CHUNK_WRITE_CONCURRENCY, (rowsChunk, index) => (
    writeFirestoreDocument(`${basePath}/chunks/${String(index).padStart(4, '0')}`, {
      index,
      rows: rowsChunk
    }, idToken)
  ));

  return docId;
}

async function writeFirestoreDocument(path: string, data: Record<string, unknown>, idToken: string) {
  const resp = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Firestore 저장 실패: ${err}`);
  }
}

function toFirestoreFields(data: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) fields[key] = toFirestoreValue(value);
  }
  return fields;
}

function toFirestoreValue(value: unknown): unknown {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: toFirestoreFields(value as Record<string, unknown>) } };
  return { stringValue: String(value) };
}

function actionValue(actions: MetaAction[] | undefined, exactTypes: string[]): number {
  if (!actions?.length) return 0;
  for (const type of exactTypes) {
    const matched = actions.find(action => action.action_type === type);
    if (matched) return number(matched.value);
  }
  return 0;
}

function number(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

function normalizeAdAccountId(value: string): string {
  return value.trim().replace(/^act_/, '');
}

function parseAdAccountIds(value: string): string[] {
  const ids = value
    .split(/[\s,;]+/)
    .map(part => normalizeAdAccountId(part))
    .filter(Boolean);
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.some(id => !/^\d+$/.test(id))) throw new Error('Ad Account ID는 숫자 또는 act_숫자 형식이어야 합니다.');
  if (uniqueIds.length > 2) throw new Error('브랜드당 Ad Account ID는 최대 2개까지 입력할 수 있습니다.');
  return uniqueIds;
}

function accountScopedId(adAccountId: string, id: string): string {
  return `${adAccountId}:${id}`;
}

function adsetFiltersByAccount(adAccountIds: string[], adsetIds: string[]): Map<string, string[]> {
  const filters = new Map(adAccountIds.map(adAccountId => [adAccountId, [] as string[]]));
  for (const id of adsetIds) {
    const [maybeAccountId, rawId] = id.split(':');
    if (rawId && filters.has(maybeAccountId)) {
      filters.get(maybeAccountId)?.push(rawId);
      continue;
    }
    for (const adAccountId of adAccountIds) filters.get(adAccountId)?.push(id);
  }
  return filters;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function dateChunks(start: string, end: string, days: number): { start: string; end: string }[] {
  const startDate = parseIsoDate(start);
  const endDate = parseIsoDate(end);
  if (!startDate || !endDate || startDate > endDate) return [{ start, end }];

  const chunks: { start: string; end: string }[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const chunkStart = cursor;
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + days - 1);
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());
    chunks.push({ start: toIsoDate(chunkStart), end: toIsoDate(chunkEnd) });

    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

function parseIsoDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateRange(rows: NormalizedReportRow[]) {
  const dates = rows.map(row => row.date).filter(Boolean).sort();
  return { start: dates[0] || '', end: dates[dates.length - 1] || '' };
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const url = new URL(req.url);
    const adAccountId = url.searchParams.get('adAccountId') || '';
    const dateStart = url.searchParams.get('dateStart') || '';
    const dateEnd = url.searchParams.get('dateEnd') || '';
    const mode = url.searchParams.get('mode') || 'performance';
    const adAccountIds = parseAdAccountIds(adAccountId);
    if (!adAccountIds.length || !dateStart || !dateEnd) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const result = mode === 'creative-options'
      ? await fetchCreativeOptionsForAccounts(adAccountIds, dateStart, dateEnd)
      : await fetchCampaignsAndAdsetsForAccounts(adAccountIds, dateStart, dateEnd);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const body = await req.json() as {
      action?: string;
      brandId: string;
      tabId: string;
      adAccountId?: string;
      dateStart?: string;
      dateEnd?: string;
      adsetIds?: string[];
      exchangeRate?: number;
      creativeCandidates?: unknown;
    };
    const { brandId, tabId } = body;
    if (body.action === 'sync-creatives') {
      const candidates = normalizeMetaCreativeCandidatePayload(body.creativeCandidates);
      if (!brandId || !tabId || !candidates.length) {
        return NextResponse.json({ error: '저장할 Meta 소재 이미지 정보가 없습니다.' }, { status: 400 });
      }
      const creativeImages = await syncMetaCreativeCandidates(brandId, tabId, candidates, auth.idToken);
      return NextResponse.json({ ok: true, creativeImages });
    }

    const adAccountId = body.adAccountId || '';
    const dateStart = body.dateStart || '';
    const dateEnd = body.dateEnd || '';
    const { adsetIds, exchangeRate } = body;
    const adAccountIds = parseAdAccountIds(adAccountId);
    if (!brandId || !tabId || !adAccountIds.length || !dateStart || !dateEnd) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const insights = await fetchAllInsightsForAccounts(adAccountIds, dateStart, dateEnd, adsetIds);
    if (!insights.length) {
      return NextResponse.json({ error: '해당 기간에 가져올 Meta 데이터가 없습니다.' }, { status: 404 });
    }

    const safeExchangeRate = Number(exchangeRate || 1) || 1;
    const currencies = insightCurrencies(insights);
    const filename = `Meta API${adAccountIds.length > 1 ? ` ${adAccountIds.length} accounts` : ''} ${dateStart}~${dateEnd} · ${currencies.join('+')}`;
    const result = toReportResult(insights, filename, safeExchangeRate);
    const range = dateRange(result.rows);
    const createdAt = Date.now();
    const fileId = await saveReportFileToFirestore(brandId, tabId, {
      filename,
      fileSize: 0,
      dateStart: range.start,
      dateEnd: range.end,
      rowCount: result.rows.length,
      exchangeRate: safeExchangeRate,
      result,
      createdAt
    }, auth.idToken);

    return NextResponse.json({
      ok: true,
      fileId,
      filename,
      rowCount: result.rows.length,
      dateStart: range.start,
      dateEnd: range.end
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
