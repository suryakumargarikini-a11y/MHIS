import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const resolvedFirebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY?.trim() || firebaseConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || firebaseConfig.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID?.trim() || firebaseConfig.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || firebaseConfig.storageBucket,
  messagingSenderId:
    env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || firebaseConfig.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID?.trim() || firebaseConfig.appId,
  measurementId:
    env.VITE_FIREBASE_MEASUREMENT_ID?.trim() || firebaseConfig.measurementId || 'G-4N2PTF337L',
};

const resolvedFirestoreDatabaseId =
  env.VITE_FIREBASE_FIRESTORE_DATABASE_ID?.trim() ||
  firebaseConfig.firestoreDatabaseId ||
  'ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5';

export const app = initializeApp(resolvedFirebaseConfig);
export const db = getFirestore(app, resolvedFirestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export let analytics: Analytics | null = null;

if (typeof window !== 'undefined') {
  void isSupported()
    .then((supported) => {
      if (supported && resolvedFirebaseConfig.measurementId) {
        analytics = getAnalytics(app);
      }
    })
    .catch(() => {
      analytics = null;
    });
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function maskEmail(email: string | null | undefined): string | null | undefined {
  if (!email) return email;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: maskEmail(auth.currentUser?.email),
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: maskEmail(provider.email),
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firebase Firestore client appears offline.');
    }
    return false;
  }
}
