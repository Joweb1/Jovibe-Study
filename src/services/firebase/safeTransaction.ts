import { runTransaction, type Firestore, type Transaction } from 'firebase/firestore';
import { auth } from './config';

export class OfflineTransactionError extends Error {
  readonly code = 'unavailable';

  constructor(message = 'Firestore client is offline.') {
    super(message);
    this.name = 'OfflineTransactionError';
  }
}

/**
 * Guards Firestore `runTransaction` against a Firebase JS SDK 13.x internal assertion crash:
 * `FIRESTORE (13.4.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: 3c6b) CONTEXT: {"code":"auth/network-request-failed"}`
 *
 * When a cached Auth ID token expires while the device is offline or on a flaky network,
 * Firestore's internal `TransactionRunner` catches `auth/network-request-failed` inside
 * `isPermanentError` and throws a fatal assertion. Pre-checking `navigator.onLine` and
 * `auth.currentUser.getIdToken(false)` catches auth network failures cleanly before
 * `TransactionRunner` ever starts.
 */
export async function safeRunTransaction<T>(
  firestore: Firestore,
  updateFunction: (transaction: Transaction) => Promise<T>
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new OfflineTransactionError('Skipped Firestore transaction because the client is offline.');
  }

  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      await currentUser.getIdToken(false);
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code ?? '').toLowerCase()
          : '';
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (
        code === 'auth/network-request-failed' ||
        msg.includes('network-request-failed') ||
        msg.includes('network error') ||
        msg.includes('failed to fetch') ||
        msg.includes('offline')
      ) {
        throw new OfflineTransactionError(
          'Unable to refresh auth token while offline (auth/network-request-failed).'
        );
      }
      throw err;
    }
  }

  return runTransaction(firestore, updateFunction);
}
