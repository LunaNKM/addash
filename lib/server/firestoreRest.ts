/**
 * Firestore REST 호출 공통 헬퍼.
 *
 * 서버에서 Firestore REST를 부를 때 API 키를 붙이지 않으면 그 요청은
 * 프로젝트가 아니라 "익명 소비자" 쿼터로 잡힌다. 서버리스 환경처럼 여러
 * 요청이 같은 출구 IP를 쓰면 이 익명 쿼터가 금방 차서, 정상적인 호출도
 * 429(RESOURCE_EXHAUSTED)를 맞는다. 관리자 판정이 이 읽기 하나에 걸려
 * 있었기 때문에 기본 관리자(문서 조회를 건너뛰는 계정)를 뺀 전원이
 * "관리자만 사용할 수 있습니다"를 보게 됐다.
 *
 * 그래서 여기서 세 가지를 한다.
 *  1) firestore.googleapis.com 요청에 웹 API 키를 붙여 프로젝트 쿼터로 보낸다.
 *  2) 429/5xx는 백오프 재시도한다.
 *  3) 관리자 판정 결과를 짧게 캐시해 같은 사람이 연달아 눌러도 읽기가 늘지 않게 한다.
 */

const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const ADMIN_CACHE_TTL_MS = 5 * 60 * 1000;

const adminCache = new Map<string, { value: boolean; expiresAt: number }>();

export function firestoreWebConfig() {
  const raw = process.env.FIREBASE_WEB_CONFIG;
  if (!raw) throw new Error('FIREBASE_WEB_CONFIG가 설정되지 않았습니다.');
  return JSON.parse(raw) as { apiKey: string; projectId: string };
}

/** 환경변수로 지정한 비상용 관리자 목록(Firestore가 죽어도 통하는 경로). */
function envAdminEmails(): Set<string> {
  const raw = process.env.GFU_DASH_ADMIN_EMAILS || '';
  return new Set(raw.split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
}

/** firestore.googleapis.com 요청이면 웹 API 키를 붙여 프로젝트 쿼터로 계산되게 한다. */
function withApiKey(url: string): string {
  if (!url.includes('firestore.googleapis.com')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('key')) return url;
    const { apiKey } = firestoreWebConfig();
    if (!apiKey) return url;
    parsed.searchParams.set('key', apiKey);
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function firestoreFetch(
  url: string,
  init: RequestInit = {},
  { retries = 4, baseDelayMs = 400 }: { retries?: number; baseDelayMs?: number } = {}
): Promise<Response> {
  const target = withApiKey(url);
  let lastResp: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const resp = await fetch(target, { cache: 'no-store', ...init });
    if (!RETRIABLE_STATUS.has(resp.status)) return resp;
    lastResp = resp;
    if (attempt === retries) break;
    const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 200);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  return lastResp as Response;
}

/** 관리자 확인 실패(권한 없음이 아니라 확인 자체를 못 한 경우)를 구분하기 위한 오류. */
export class AdminCheckError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminCheckError';
    this.status = status;
  }
}

/**
 * admins/{email} 문서 존재 여부로 관리자를 판정한다.
 * 404만 "관리자가 아님"이고, 그 밖의 실패는 판정 불가로 던진다.
 */
export async function isAdminEmailServer(email: string, idToken: string, primaryAdminEmail: string): Promise<boolean> {
  const normalized = (email || '').toLowerCase();
  if (!normalized) return false;
  if (normalized === primaryAdminEmail) return true;
  if (envAdminEmails().has(normalized)) return true;

  const cached = adminCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { projectId } = firestoreWebConfig();
  if (!projectId) throw new AdminCheckError('FIREBASE_WEB_CONFIG.projectId가 없습니다.', 500);

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/admins/${encodeURIComponent(normalized)}`;
  const resp = await firestoreFetch(url, { headers: { Authorization: `Bearer ${idToken}` } });

  if (resp.ok || resp.status === 404) {
    const value = resp.ok;
    adminCache.set(normalized, { value, expiresAt: Date.now() + ADMIN_CACHE_TTL_MS });
    return value;
  }

  const details = (await resp.text().catch(() => '')).slice(0, 300);
  if (resp.status === 429) {
    throw new AdminCheckError(
      `Firestore 요청 한도(429)에 걸려 관리자 확인을 못 했습니다. 잠시 후 다시 시도해주세요. ${details}`.trim(),
      429
    );
  }
  throw new AdminCheckError(`관리자 확인에 실패했습니다. (HTTP ${resp.status}) ${details}`.trim(), 503);
}
