import { auth } from './config';

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

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatReadableError(error: unknown): string {
  if (!error) return 'An unexpected error occurred.';
  const rawMessage = error instanceof Error ? error.message : String(error);

  try {
    const parsed = JSON.parse(rawMessage) as Partial<FirestoreErrorInfo>;
    if (parsed && typeof parsed.error === 'string' && parsed.operationType) {
      if (parsed.error.toLowerCase().includes('quota exceeded')) {
        return 'Cloud database daily free-tier quota was exceeded. Quota resets tomorrow.';
      }
      if (parsed.error.toLowerCase().includes('permission')) {
        return `Access denied while attempting to ${parsed.operationType} data. Please verify your sign-in session.`;
      }
      return parsed.error;
    }
  } catch {
    // Not a JSON-wrapped FirestoreErrorInfo
  }

  if (rawMessage.includes('auth/popup-closed-by-user')) {
    return 'Sign-in window was closed before completing authentication.';
  }
  if (rawMessage.includes('auth/popup-blocked')) {
    return 'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.';
  }
  if (rawMessage.includes('auth/network-request-failed')) {
    return 'Network error while connecting to authentication service. Check your connection.';
  }
  return rawMessage;
}
