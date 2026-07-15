import { NextResponse } from 'next/server';
import { buildFileStats } from '@/lib/aggregation';
import type { ParsedRow } from '@/lib/types';

const META_API_VERSION = 'v20.0';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const primaryAdminEmail = (process.env.GFU_DASH_PRIMARY_ADMIN_EMAIL || '').toLowerCase();

function webConfig() {
  const raw = process.env.FIREBASE_WEB_CONFIG;
  if (!raw) throw new Error('FIREBASE_WEB_CONFIG is missing.');
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

// ── Meta API helpers ────────────────────────────────────────────

type MetaInsightRow = {
  date_start: string;
  date_stop: string;
  campaign_name: string;
  adset_name: string;
  ad_name: string;
  spend: string;
  impressions: string;
  inline_link_clicks: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  ctr: string;
  cpm: string;
  cpc: string;
  website_purchase_roas?: Array<{ action_type: string; value: string }>;
};

function findAction(list: Array<{ action_type: string; value: string }> | undefined, type: string): number {
  return Number(list?.find(a => a.action_type === type)?.value || 0);
}

type MetaCampaign = { id: string; name: string };
type MetaAdset = { id: string; name: string; campaignId: string; campaignName: string };

async function fetchCampaignsAndAdsets(adAccountId: string, dateStart: string, dateEnd: string): Promise<{ campaigns: MetaCampaign[]; adsets: MetaAdset[] }> {
  if (!META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN 환경변수가 설정되지 않았습니다.');
  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
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
    if (!resp.ok) throw new Error(`Meta API: ${data?.error?.message || 'Meta API 오류'}`);
    rows.push(...(data.data as Row[]));
    url = data.paging?.next || null;
  }
  const campaignMap = new Map<string, string>();
  const adsetMap = new Map<string, Omit<MetaAdset, 'id'>>();
  for (const row of rows) {
    campaignMap.set(row.campaign_id, row.campaign_name);
    adsetMap.set(row.adset_id, { name: row.adset_name, campaignId: row.campaign_id, campaignName: row.campaign_name });
  }
  const campaigns = Array.from(campaignMap.entries()).map(([id, name]) => ({ id, name }));
  const adsets = Array.from(adsetMap.entries()).map(([id, rest]) => ({ id, ...rest }));
  return { campaigns, adsets };
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

async function fetchAllInsights(adAccountId: string, dateStart: string, dateEnd: string, adsetIds?: string[]): Promise<MetaInsightRow[]> {
  if (!META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN 환경변수가 설정되지 않았습니다.');

  const fields = [
    'date_start', 'date_stop',
    'campaign_name', 'adset_name', 'ad_name',
    'spend', 'impressions', 'inline_link_clicks',
    'actions', 'action_values',
    'ctr', 'cpm', 'cpc',
    'website_purchase_roas'
  ].join(',');

  const filtering = adsetIds?.length
    ? [{ field: 'adset.id', operator: 'IN', value: adsetIds }]
    : [];

  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
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
    if (!resp.ok) {
      const msg = data?.error?.message || 'Meta API 오류';
      throw new Error(`Meta API: ${msg}`);
    }
    rows.push(...(data.data as MetaInsightRow[]));
    url = data.paging?.next || null;
  }

  return rows;
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

function toRows(insights: MetaInsightRow[]): ParsedRow[] {
  return insights.map(row => {
    const spend = Number(row.spend || 0);
    const impression = Number(row.impressions || 0);
    const click = Number(row.inline_link_clicks || 0);
    const landingPageView = findAction(row.actions, 'landing_page_view');
    const ctr = Number(row.ctr || 0);
    const cpm = Number(row.cpm || 0);
    const cpc = Number(row.cpc || 0);
    const purchaseValue = findAction(row.action_values, 'purchase');
    const roas = spend > 0 ? purchaseValue / spend : 0;

    return {
      date: row.date_start,
      campaignName: row.campaign_name || '',
      adsetName: row.adset_name || '',
      adName: row.ad_name || '',
      spend,
      impression,
      click,
      landingPageView,
      ctr,
      cpm,
      cpc,
      roas,
      ctrWeight: impression,
      cpmWeight: impression,
      cpcWeight: click,
      roasWeight: spend
    };
  });
}

// ── Firestore save via REST (서버 사이드, 서비스 계정 없음) ──────

async function saveToFirestore(brandId: string, tabId: string, fileDoc: Record<string, unknown>, idToken: string) {
  const { projectId } = webConfig();
  const filename = fileDoc.filename as string;
  const colPath = `projects/${projectId}/databases/(default)/documents/brands/${brandId}/tabs/${tabId}/files`;

  const listResp = await fetch(
    `https://firestore.googleapis.com/v1/${colPath}?pageSize=100`,
    { headers: { Authorization: `Bearer ${idToken}` }, cache: 'no-store' }
  );
  if (listResp.ok) {
    const listData = await listResp.json();
    const existing = (listData.documents || []) as Array<{ name: string; fields: Record<string, unknown> }>;
    for (const doc of existing) {
      const docFilename = (doc.fields?.filename as { stringValue?: string })?.stringValue;
      if (docFilename?.startsWith('Meta API ')) {
        await fetch(`https://firestore.googleapis.com/v1/${doc.name}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${idToken}` }
        });
      }
    }
  }

  function toFirestoreValue(v: unknown): unknown {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
    if (typeof v === 'object') {
      const fields: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        if (val !== undefined) fields[key] = toFirestoreValue(val);
      }
      return { mapValue: { fields } };
    }
    return { stringValue: String(v) };
  }

  const fields: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(fileDoc)) {
    if (val !== undefined) fields[key] = toFirestoreValue(val);
  }

  const createResp = await fetch(
    `https://firestore.googleapis.com/v1/${colPath}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ fields })
    }
  );

  if (!createResp.ok) {
    const err = await createResp.text();
    throw new Error(`Firestore 저장 실패: ${err}`);
  }
}

// ── Route handlers ───────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const auth = req.headers.get('authorization') || '';
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!idToken) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

    const user = await verifyFirebaseToken(idToken);
    if (!user) return NextResponse.json({ error: '유효하지 않은 토큰입니다.' }, { status: 401 });

    const allowed = await isAdmin(user.email, idToken);
    if (!allowed) return NextResponse.json({ error: '관리자만 사용할 수 있습니다.' }, { status: 403 });

    const url = new URL(req.url);
    const adAccountId = url.searchParams.get('adAccountId') || '';
    const dateStart = url.searchParams.get('dateStart') || '';
    const dateEnd = url.searchParams.get('dateEnd') || '';
    const adAccountIds = parseAdAccountIds(adAccountId);

    if (!adAccountIds.length || !dateStart || !dateEnd) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const result = await fetchCampaignsAndAdsetsForAccounts(adAccountIds, dateStart, dateEnd);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get('authorization') || '';
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!idToken) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

    const user = await verifyFirebaseToken(idToken);
    if (!user) return NextResponse.json({ error: '유효하지 않은 토큰입니다.' }, { status: 401 });

    const allowed = await isAdmin(user.email, idToken);
    if (!allowed) return NextResponse.json({ error: '관리자만 사용할 수 있습니다.' }, { status: 403 });

    const { brandId, tabId, adAccountId, dateStart, dateEnd, adsetIds } = await req.json() as {
      brandId: string; tabId: string; adAccountId: string; dateStart: string; dateEnd: string; adsetIds?: string[];
    };

    const adAccountIds = parseAdAccountIds(adAccountId);
    if (!brandId || !tabId || !adAccountIds.length || !dateStart || !dateEnd) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const insights = await fetchAllInsightsForAccounts(adAccountIds, dateStart, dateEnd, adsetIds);
    if (!insights.length) {
      return NextResponse.json({ error: '해당 기간에 데이터가 없습니다.' }, { status: 404 });
    }

    const rows = toRows(insights);
    const stats = buildFileStats(rows);
    const filename = `Meta API${adAccountIds.length > 1 ? ` ${adAccountIds.length} accounts` : ''} ${dateStart}~${dateEnd}`;

    const fileDoc = {
      filename,
      fileSize: 0,
      createdAt: Date.now(),
      source: 'meta_api',
      ...stats
    };

    await saveToFirestore(brandId, tabId, fileDoc, idToken);

    return NextResponse.json({ ok: true, rowCount: rows.length, dateStart: stats.dateStart, dateEnd: stats.dateEnd });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
