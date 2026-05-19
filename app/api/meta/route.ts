import { NextResponse } from 'next/server';

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

async function fetchAllInsights(adAccountId: string, dateStart: string, dateEnd: string): Promise<MetaInsightRow[]> {
  if (!META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN 환경변수가 설정되지 않았습니다.');

  const fields = [
    'date_start', 'date_stop',
    'campaign_name', 'adset_name', 'ad_name',
    'spend', 'impressions', 'inline_link_clicks',
    'actions', 'action_values',
    'ctr', 'cpm', 'cpc',
    'website_purchase_roas'
  ].join(',');

  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    level: 'ad',
    time_increment: '1',
    time_range: JSON.stringify({ since: dateStart, until: dateEnd }),
    fields,
    limit: '500'
  });

  const rows: MetaInsightRow[] = [];
  let url: string | null = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights?${params}`;

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

// ── FileDoc 변환 ────────────────────────────────────────────────

type ParsedRow = {
  date: string;
  campaignName: string;
  adsetName: string;
  adName: string;
  spend: number;
  impression: number;
  click: number;
  landingPageView: number;
  ctr: number;
  cpm: number;
  cpc: number;
  roas: number;
  ctrWeight: number;
  cpmWeight: number;
  cpcWeight: number;
  roasWeight: number;
};

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

type Bucket = {
  key: string;
  date?: string;
  campaignName?: string;
  adsetName?: string;
  adName?: string;
  spend: number;
  impression: number;
  click: number;
  landingPageView: number;
  ctrWeighted: number; ctrWeight: number;
  cpmWeighted: number; cpmWeight: number;
  cpcWeighted: number; cpcWeight: number;
  roasWeighted: number; roasWeight: number;
};

function makeBucket(base: Partial<Bucket> & { key: string }): Bucket {
  return { spend: 0, impression: 0, click: 0, landingPageView: 0, ctrWeighted: 0, ctrWeight: 0, cpmWeighted: 0, cpmWeight: 0, cpcWeighted: 0, cpcWeight: 0, roasWeighted: 0, roasWeight: 0, ...base };
}

function addToBucket(b: Bucket, r: ParsedRow) {
  b.spend += r.spend; b.impression += r.impression; b.click += r.click; b.landingPageView += r.landingPageView;
  if (r.ctrWeight > 0) { b.ctrWeighted += r.ctr * r.ctrWeight; b.ctrWeight += r.ctrWeight; }
  if (r.cpmWeight > 0) { b.cpmWeighted += r.cpm * r.cpmWeight; b.cpmWeight += r.cpmWeight; }
  if (r.cpcWeight > 0) { b.cpcWeighted += r.cpc * r.cpcWeight; b.cpcWeight += r.cpcWeight; }
  if (r.roasWeight > 0) { b.roasWeighted += r.roas * r.roasWeight; b.roasWeight += r.roasWeight; }
}

function r2(n: number) { return Math.round((n || 0) * 100) / 100; }
function r4(n: number) { return Math.round((n || 0) * 10000) / 10000; }

type StatRow = { key: string; date?: string; campaignName?: string; adsetName?: string; adName?: string; spend: number; impression: number; click: number; landingPageView: number; ctr: number; cpm: number; cpc: number; roas: number };

function finalizeBucket(b: Bucket): StatRow {
  const row: StatRow = {
    key: b.key,
    spend: r2(b.spend),
    impression: Math.round(b.impression),
    click: r2(b.click),
    landingPageView: r2(b.landingPageView),
    ctr: r4(b.ctrWeight ? b.ctrWeighted / b.ctrWeight : (b.impression ? (b.click / b.impression) * 100 : 0)),
    cpm: r2(b.cpmWeight ? b.cpmWeighted / b.cpmWeight : (b.impression ? (b.spend / b.impression) * 1000 : 0)),
    cpc: r2(b.cpcWeight ? b.cpcWeighted / b.cpcWeight : (b.click ? b.spend / b.click : 0)),
    roas: r4(b.roasWeight ? b.roasWeighted / b.roasWeight : 0)
  };
  if (b.date) row.date = b.date;
  if (b.campaignName) row.campaignName = b.campaignName;
  if (b.adsetName) row.adsetName = b.adsetName;
  if (b.adName) row.adName = b.adName;
  return row;
}

function aggregate(rows: ParsedRow[], getKey: (r: ParsedRow) => Partial<Bucket> & { key: string }): StatRow[] {
  const map = new Map<string, Bucket>();
  for (const row of rows) {
    const base = getKey(row);
    let b = map.get(base.key);
    if (!b) { b = makeBucket(base); map.set(base.key, b); }
    addToBucket(b, row);
  }
  return [...map.values()].map(finalizeBucket);
}

function buildStats(rows: ParsedRow[]) {
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  const dailyStats = aggregate(rows, r => ({ key: r.date, date: r.date })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const campaignDailyStats = aggregate(rows, r => ({ key: `${r.date}|||${r.campaignName}`, date: r.date, campaignName: r.campaignName }));
  const adsetDailyStats = aggregate(rows, r => ({ key: `${r.date}|||${r.campaignName}|||${r.adsetName}`, date: r.date, campaignName: r.campaignName, adsetName: r.adsetName }));
  const detailStats = aggregate(rows, r => ({ key: `${r.date}|||${r.campaignName}|||${r.adsetName}`, date: r.date, campaignName: r.campaignName, adsetName: r.adsetName })).filter(r => r.spend > 0);
  const creativeStats = aggregate(rows, r => ({ key: `${r.campaignName}|||${r.adsetName}|||${r.adName}`, campaignName: r.campaignName, adsetName: r.adsetName, adName: r.adName }));

  // total via single-bucket aggregation
  const totalBucket = makeBucket({ key: 'total' });
  for (const r of rows) addToBucket(totalBucket, r);
  const total = finalizeBucket(totalBucket);

  return {
    dateStart: dates[0] || '',
    dateEnd: dates[dates.length - 1] || '',
    rowCount: rows.length,
    total,
    dailyStats,
    campaignDailyStats,
    adsetDailyStats,
    detailStats,
    creativeStats
  };
}

// ── Firestore save via REST (서버 사이드, 서비스 계정 없음) ──────

async function saveToFirestore(brandId: string, tabId: string, fileDoc: Record<string, unknown>, idToken: string) {
  const { projectId } = webConfig();

  // 같은 이름 파일이 있으면 먼저 삭제
  const filename = fileDoc.filename as string;
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const queryBody = {
    structuredQuery: {
      from: [{ collectionId: 'files' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'filename' },
          op: 'EQUAL',
          value: { stringValue: filename }
        }
      },
      limit: 5
    }
  };

  // Firestore REST API를 직접 쓰는 것보다 collection path query가 더 안전
  // brands/{brandId}/tabs/{tabId}/files
  const colPath = `projects/${projectId}/databases/(default)/documents/brands/${brandId}/tabs/${tabId}/files`;

  // 기존 파일 조회 (filename 기준)
  const listResp = await fetch(
    `https://firestore.googleapis.com/v1/${colPath}?pageSize=100`,
    { headers: { Authorization: `Bearer ${idToken}` }, cache: 'no-store' }
  );
  if (listResp.ok) {
    const listData = await listResp.json();
    const existing = (listData.documents || []) as Array<{ name: string; fields: Record<string, unknown> }>;
    for (const doc of existing) {
      const docFilename = (doc.fields?.filename as { stringValue?: string })?.stringValue;
      if (docFilename === filename) {
        await fetch(`https://firestore.googleapis.com/v1/${doc.name}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${idToken}` }
        });
      }
    }
  }

  // 새 문서 저장
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

// ── Route handler ────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const auth = req.headers.get('authorization') || '';
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!idToken) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

    const user = await verifyFirebaseToken(idToken);
    if (!user) return NextResponse.json({ error: '유효하지 않은 토큰입니다.' }, { status: 401 });

    const allowed = await isAdmin(user.email, idToken);
    if (!allowed) return NextResponse.json({ error: '관리자만 사용할 수 있습니다.' }, { status: 403 });

    const { brandId, tabId, adAccountId, dateStart, dateEnd } = await req.json() as {
      brandId: string; tabId: string; adAccountId: string; dateStart: string; dateEnd: string;
    };

    if (!brandId || !tabId || !adAccountId || !dateStart || !dateEnd) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const insights = await fetchAllInsights(adAccountId, dateStart, dateEnd);
    if (!insights.length) {
      return NextResponse.json({ error: '해당 기간에 데이터가 없습니다.' }, { status: 404 });
    }

    const rows = toRows(insights);
    const stats = buildStats(rows);
    const filename = `Meta API ${dateStart}~${dateEnd}`;

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
