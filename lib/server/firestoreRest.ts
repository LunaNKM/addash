/**
 * Firestore REST 호출 공통 헬퍼.
 *
 * Firestore는 짧은 시간에 읽기/쓰기가 몰리면 429(Quota exceeded)를 돌려준다.
 * 이때 한 번의 실패를 그대로 "권한 없음"이나 "저장 실패"로 확정해버리면
 * 관리자에게 "관리자만 사용할 수 있습니다" 같은 엉뚱한 메시지가 나가므로,
 * 일시적 상태 코드는 백오프 후 재시도하고 그래도 안 되면 이유를 그대로 올린다.
 */

const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function firestoreWebConfig() {
  const raw = process.env.FIREBASE_WEB_CONFIG;
  if (!raw) throw new Error('FIREBASE_WEB_CONFIG가 설정되지 않았습니다.');
  return JSON.parse(raw) as { apiKey: string; projectId: string };
}

export async function firestoreFetch(
  url: string,
  init: RequestInit = {},
  { retries = 4, baseDelayMs = 400 }: { retries?: number; baseDelayMs?: number } = {}
): Promise<Response> {
  let lastResp: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const resp = await fetch(url, { cache: 'no-store', ...init });
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
  if (normalized && normalized === primaryAdminEmail) return true;

  const { projectId } = firestoreWebConfig();
  if (!projectId) throw new AdminCheckError('FIREBASE_WEB_CONFIG.projectId가 없습니다.', 500);

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/admins/${encodeURIComponent(normalized)}`;
  const resp = await firestoreFetch(url, { headers: { Authorization: `Bearer ${idToken}` } });

  if (resp.ok) return true;
  if (resp.status === 404) return false;

  const details = await resp.text().catch(() => '');
  if (resp.status === 429) {
    throw new AdminCheckError('Firestore 요청 한도(429)에 걸려 관리자 확인을 못 했습니다. 잠시 후 다시 시도해주세요.', 429);
  }
  throw new AdminCheckError(`관리자 확인에 실패했습니다. (HTTP ${resp.status}) ${details}`.trim(), 503);
}
