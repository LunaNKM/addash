import { NextResponse } from 'next/server';
import { AdminCheckError, isAdminEmailServer } from '@/lib/server/firestoreRest';
import { creativeAssetId, makeCreativeKey } from '@/lib/report/creativeKey';
import { adminDb } from '@/lib/firebaseAdmin';

type CreativeAssetPayload = {
  key?: string;
  media?: string;
  campaignName?: string;
  adgroupName?: string;
  adName?: string;
  imageData?: string;
  sourceImageUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  imageHash?: string;
  capturedAt?: number;
};

const primaryAdminEmail = (process.env.GFU_DASH_PRIMARY_ADMIN_EMAIL || 'kangmin.j@gfutures.co').toLowerCase();
const MAX_IMAGE_DATA_LENGTH = 240_000;
type AuthResult = { idToken: string } | { collector: true } | { error: NextResponse };

function webConfig() {
  const raw = process.env.FIREBASE_WEB_CONFIG;
  if (!raw) throw new Error('FIREBASE_WEB_CONFIG is not configured.');
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
  return isAdminEmailServer(email, idToken, primaryAdminEmail);
}

async function requireAdmin(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!idToken) return { error: NextResponse.json({ error: 'Login is required.' }, { status: 401 }) };

  const user = await verifyFirebaseToken(idToken);
  if (!user) return { error: NextResponse.json({ error: 'Invalid auth token.' }, { status: 401 }) };

  let allowed = false;
  try {
    allowed = await isAdmin(user.email, idToken);
  } catch (err) {
    const status = err instanceof AdminCheckError ? err.status : 503;
    const message = err instanceof Error ? err.message : 'Admin check failed.';
    return { error: NextResponse.json({ error: message }, { status }) };
  }
  if (!allowed) return { error: NextResponse.json({ error: 'Admin access is required.' }, { status: 403 }) };

  return { idToken };
}

export async function POST(req: Request) {
  try {
    const { brandId, tabId, assets } = await req.json() as {
      brandId?: string;
      tabId?: string;
      assets?: CreativeAssetPayload[];
    };
    if (!isSafeSegment(brandId) || !isSafeSegment(tabId) || !Array.isArray(assets)) {
      return NextResponse.json({ error: 'Missing required parameters.' }, { status: 400 });
    }

    const auth = await requireCollectorOrAdmin(req, brandId, tabId);
    if ('error' in auth) return auth.error;

    const normalized = assets.map(normalizeAsset).filter((asset): asset is ReturnType<typeof normalizeAsset> & { key: string } => Boolean(asset?.key));
    if (!normalized.length) {
      return NextResponse.json({ error: 'No creative images to save.' }, { status: 400 });
    }

    if ('idToken' in auth) await saveWithUserToken(brandId, tabId, normalized, auth.idToken);
    else await saveWithAdmin(brandId, tabId, normalized);

    return NextResponse.json({ ok: true, count: normalized.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function requireCollectorOrAdmin(req: Request, brandId: string, tabId: string): Promise<AuthResult> {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return requireAdmin(req);

  const token = req.headers.get('x-collector-token') || '';
  if (!token) return { error: NextResponse.json({ error: 'Collector token is required.' }, { status: 401 }) };

  const snap = await adminDb().doc(`brands/${brandId}/tabs/${tabId}/collectorSettings/singleone`).get();
  const expectedToken = String(snap.data()?.token || '');
  if (!expectedToken || token !== expectedToken) {
    return { error: NextResponse.json({ error: 'Invalid collector token.' }, { status: 403 }) };
  }

  return { collector: true };
}

function normalizeAsset(asset: CreativeAssetPayload) {
  const key = asset.key || makeCreativeKey(asset);
  if (!key.replace(/\|/g, '')) return null;
  if (asset.imageData && asset.imageData.length > MAX_IMAGE_DATA_LENGTH) {
    throw new Error('Image data is too large. Send a 320px WebP thumbnail only.');
  }

  const now = Date.now();
  return {
    key,
    source: 'singleone',
    media: asset.media || 's-meta',
    campaignName: asset.campaignName || '',
    adgroupName: asset.adgroupName || '',
    adName: asset.adName || '',
    imageData: asset.imageData || '',
    sourceImageUrl: asset.sourceImageUrl || '',
    mimeType: asset.mimeType || 'image/webp',
    width: Number(asset.width || 0),
    height: Number(asset.height || 0),
    imageHash: asset.imageHash || '',
    capturedAt: Number(asset.capturedAt || now),
    updatedAt: now
  };
}

function isSafeSegment(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
}

async function saveWithAdmin(brandId: string, tabId: string, assets: Array<ReturnType<typeof normalizeAsset> & { key: string }>) {
  const db = adminDb();
  for (let index = 0; index < assets.length; index += 450) {
    const batch = db.batch();
    assets.slice(index, index + 450).forEach(asset => {
      const ref = db.doc(`brands/${brandId}/tabs/${tabId}/creativeAssets/${creativeAssetId(asset.key)}`);
      batch.set(ref, asset, { merge: true });
    });
    await batch.commit();
  }
}

async function saveWithUserToken(brandId: string, tabId: string, assets: Array<ReturnType<typeof normalizeAsset> & { key: string }>, idToken: string) {
  const { projectId } = webConfig();
  const basePath = `projects/${projectId}/databases/(default)/documents/brands/${brandId}/tabs/${tabId}/creativeAssets`;
  for (const asset of assets) {
    await writeFirestoreDocument(`${basePath}/${creativeAssetId(asset.key)}`, asset, idToken);
  }
}

async function writeFirestoreDocument(path: string, data: Record<string, unknown>, idToken: string) {
  const resp = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Firestore save failed: ${err}`);
  }
}

function toFirestoreFields(data: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (typeof value === 'number') fields[key] = Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else fields[key] = { stringValue: String(value ?? '') };
  }
  return fields;
}
