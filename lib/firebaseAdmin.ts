import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

type ServiceAccountConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function readServiceAccount(): ServiceAccountConfig {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const parsed = JSON.parse(raw) as {
      project_id?: string;
      projectId?: string;
      client_email?: string;
      clientEmail?: string;
      private_key?: string;
      privateKey?: string;
    };
    return {
      projectId: parsed.project_id || parsed.projectId || '',
      clientEmail: parsed.client_email || parsed.clientEmail || '',
      privateKey: parsed.private_key || parsed.privateKey || ''
    };
  }

  return {
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID || readWebProjectId(),
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '',
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY || ''
  };
}

function readWebProjectId(): string {
  const raw = process.env.FIREBASE_WEB_CONFIG;
  if (!raw) return '';
  try {
    return String((JSON.parse(raw) as { projectId?: string }).projectId || '');
  } catch {
    return '';
  }
}

function adminApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  const serviceAccount = readServiceAccount();
  if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
    throw new Error('Firebase Admin 서비스 계정 환경변수가 필요합니다.');
  }

  return initializeApp({
    credential: cert({
      projectId: serviceAccount.projectId,
      clientEmail: serviceAccount.clientEmail,
      privateKey: serviceAccount.privateKey.replace(/\\n/g, '\n')
    })
  });
}

export function adminDb() {
  return getFirestore(adminApp());
}
