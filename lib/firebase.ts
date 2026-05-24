import { initializeApp, getApps } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

function readFirebaseConfig() {
  const raw = process.env.FIREBASE_WEB_CONFIG || process.env.NEXT_PUBLIC_FIREBASE_WEB_CONFIG;
  if (!raw) throw new Error('FIREBASE_WEB_CONFIG 환경변수가 없습니다.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_WEB_CONFIG는 한 줄 JSON 형식이어야 합니다.');
  }
}

const app = getApps().length ? getApps()[0] : initializeApp(readFirebaseConfig());
export const auth = getAuth(app);
export const db = getFirestore(app);
export const primaryAdminEmail = (process.env.GFU_DASH_PRIMARY_ADMIN_EMAIL || process.env.NEXT_PUBLIC_PRIMARY_ADMIN_EMAIL || 'kangmin.j@gfutures.co').toLowerCase();

/** Firebase 에러 코드를 한국어 메시지로 변환 */
export function firebaseAuthErrorMessage(err: unknown): string {
  const code = String((err as { code?: string })?.code || '');
  if (code === 'auth/unauthorized-domain') {
    const domain = typeof window !== 'undefined' ? window.location.hostname : '';
    return `이 도메인(${domain})이 Firebase 승인 도메인에 등록되어 있지 않습니다.\nFirebase Console → Authentication → Settings → Authorized domains 에 추가해주세요.`;
  }
  if (code === 'auth/network-request-failed') return '네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.';
  if (code === 'auth/too-many-requests') return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
  if (code === 'auth/user-disabled') return '비활성화된 계정입니다.';
  if (code === 'auth/web-storage-unsupported') return '브라우저가 웹 스토리지를 지원하지 않거나 차단되어 있습니다.';
  if (code) return `로그인 오류 (${code})`;
  return (err as Error)?.message || '알 수 없는 로그인 오류가 발생했습니다.';
}

/** 팝업 우선, 팝업 차단 시에만 redirect로 전환. 그 외 에러는 호출자에게 전파. */
export async function signInWithGoogleSafe() {
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err: unknown) {
    const code = String((err as { code?: string })?.code || '');
    // 팝업이 브라우저에 의해 차단/닫힌 경우에만 redirect 시도
    if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      await signInWithRedirect(auth, provider);
      return;
    }
    // 그 외 에러(unauthorized-domain 등)는 호출자에게 전파해 사용자에게 표시
    throw err;
  }
}

/** redirect 완료 처리. 에러는 호출자에게 전파(삼키지 않음). */
export async function completeRedirectLogin() {
  return getRedirectResult(auth);
}

export async function logout() {
  await signOut(auth);
}

export function userEmail(user: User | null): string | null {
  return user?.email?.toLowerCase() || null;
}
