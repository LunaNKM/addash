import { initializeApp, getApps } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  setPersistence,
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

export async function signInWithGoogleSafe() {
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithRedirect(auth, provider);
}

export async function completeRedirectLogin() {
  try {
    await getRedirectResult(auth);
  } catch (err) {
    console.warn('Google redirect login failed:', err);
  }
}

export async function logout() {
  await signOut(auth);
}

export function userEmail(user: User | null): string | null {
  return user?.email?.toLowerCase() || null;
}
