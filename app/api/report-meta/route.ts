import { NextResponse } from 'next/server';
import { DEFAULT_GROSS_RATE } from '@/lib/report/schema';
import type { NormalizedReportRow, ReportParseResult } from '@/lib/report/reportTypes';

const META_API_VERSION = process.env.META_API_VERSION || 'v25.0';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const REPORT_FILE_ROWS_PER_CHUNK = 25;
const primaryAdminEmail = (process.env.GFU_DASH_PRIMARY_ADMIN_EMAIL || '').toLowerCase();

type MetaAction = { action_type: string; value: string };

type MetaInsightRow = {
  date_start: string;
  date_stop: string;
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  inline_link_clicks?: string;
  clicks?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
};

type MetaCampaign = { id: string; name: string };
type MetaAdset = { id: string; name: string; campaignId: string; campaignName: string };

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
    const resp = await fetch(url, { cache: 'no-store' });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`Meta API: ${data?.error?.message || '조회에 실패했습니다.'}`);
    rows.push(...(data.data as Row[]));
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
  const fields = [
    'date_start',
    'date_stop',
    'campaign_name',
    'adset_name',
    'ad_name',
    'spend',
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
    const resp = await fetch(url, { cache: 'no-store' });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`Meta API: ${data?.error?.message || '조회에 실패했습니다.'}`);
    rows.push(...(data.data as MetaInsightRow[]));
    url = data.paging?.next || null;
  }

  return rows;
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
  const sales = actionValue(row.action_values, ['purchase']);
  const clicks = number(row.inline_link_clicks) || number(row.clicks);
  const impressions = number(row.impressions);
  const conversions = actionValue(row.actions, ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase']);
  const addToCart = actionValue(row.actions, ['add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart', 'omni_add_to_cart']);
  const registration = actionValue(row.actions, ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration']);
  const lead = actionValue(row.actions, ['lead', 'offsite_conversion.fb_pixel_lead']);
  const costKrw = spend * exchangeRate;
  const salesKrw = sales * exchangeRate;

  return {
    sourceRowNumber,
    date: row.date_start || row.date_stop || '',
    brand: '',
    media: 'Meta',
    promotion: '자사몰',
    campaignName: row.campaign_name || 'Meta 캠페인',
    adgroupName: row.adset_name || 'Meta 광고세트',
    adName: row.ad_name || 'Meta 광고',
    impressions,
    clicks,
    conversions,
    costJpy: spend,
    costKrw,
    grossCostKrw: costKrw * DEFAULT_GROSS_RATE,
    salesJpy: sales,
    salesKrw,
    addToCart,
    registration,
    lead,
    order: conversions,
    ctr: ratio(clicks, impressions),
    cpc: ratio(costKrw, clicks),
    cvr: ratio(conversions, clicks),
    cpa: ratio(costKrw, conversions),
    cartCpa: ratio(costKrw, addToCart),
    roas: ratio(salesKrw, costKrw),
    raw: row as Record<string, unknown>
  };
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

  for (let index = 0; index < chunks.length; index += 1) {
    await writeFirestoreDocument(`${basePath}/chunks/${String(index).padStart(4, '0')}`, {
      index,
      rows: chunks[index]
    }, idToken);
  }

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
  const exact = new Set(exactTypes);
  return actions.reduce((sum, action) => {
    const type = action.action_type || '';
    if (exact.has(type)) return sum + number(action.value);
    if (exactTypes.some(candidate => type.endsWith(candidate) || type.includes(candidate))) {
      return sum + number(action.value);
    }
    return sum;
  }, 0);
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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
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
    if (!adAccountId || !dateStart || !dateEnd) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const result = await fetchCampaignsAndAdsets(adAccountId, dateStart, dateEnd);
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

    const { brandId, tabId, adAccountId, dateStart, dateEnd, adsetIds, exchangeRate } = await req.json() as {
      brandId: string;
      tabId: string;
      adAccountId: string;
      dateStart: string;
      dateEnd: string;
      adsetIds?: string[];
      exchangeRate?: number;
    };
    if (!brandId || !tabId || !adAccountId || !dateStart || !dateEnd) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const insights = await fetchAllInsights(adAccountId, dateStart, dateEnd, adsetIds);
    if (!insights.length) {
      return NextResponse.json({ error: '해당 기간에 가져올 Meta 데이터가 없습니다.' }, { status: 404 });
    }

    const safeExchangeRate = Number(exchangeRate || 1) || 1;
    const filename = `Meta API 자사몰 ${dateStart}~${dateEnd}`;
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
