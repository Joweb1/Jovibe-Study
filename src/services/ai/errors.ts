import type { AiProvider } from './providers';

export type AiErrorCode =
  | 'NO_API_KEY'
  | 'INVALID_KEY'
  | 'RATE_LIMIT'
  | 'QUOTA_EXHAUSTED'
  | 'SHARED_QUOTA_EXHAUSTED'
  | 'FREE_TRIAL_EXPIRED'
  | 'FEATURE_DISABLED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_DELETED'
  | 'UNAUTHENTICATED'
  | 'MODEL_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'SAFETY_BLOCKED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'OFFLINE'
  | 'ABORTED'
  | 'VALIDATION_ERROR'
  | 'PROVIDER_EXHAUSTED'
  | 'UNKNOWN';

export interface AiErrorOptions {
  retryable?: boolean;
  provider?: AiProvider;
  cooldownMs?: number;
  /** HTTP status returned by the server, when available. */
  status?: number;
  meta?: Record<string, unknown>;
}

export class AiServiceError extends Error {
  code: AiErrorCode;
  retryable: boolean;
  provider?: AiProvider;
  cooldownMs: number;
  status?: number;
  meta?: Record<string, unknown>;

  constructor(message: string, code: AiErrorCode = 'UNKNOWN', options: AiErrorOptions = {}) {
    super(message);
    this.name = 'AiServiceError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.provider = options.provider;
    this.cooldownMs = options.cooldownMs ?? 0;
    this.status = options.status;
    this.meta = options.meta;
  }
}

export function isAiServiceError(value: unknown): value is AiServiceError {
  return value instanceof AiServiceError;
}

/** Codes that should never trigger a key rotation or provider switch. */
export const NON_ROTATABLE_CODES: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  'INVALID_REQUEST',
  'SAFETY_BLOCKED',
  'ABORTED',
  'OFFLINE',
  'FREE_TRIAL_EXPIRED',
  'SHARED_QUOTA_EXHAUSTED',
  'FEATURE_DISABLED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DELETED',
  'UNAUTHENTICATED',
]);

/** Codes that mean "this key is unusable right now" — move to the next key. */
export const KEY_EXHAUSTED_CODES: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  'INVALID_KEY',
  'RATE_LIMIT',
  'QUOTA_EXHAUSTED',
]);

/** Codes worth retrying on the same provider before switching providers. */
export const TRANSIENT_CODES: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  'SERVER_ERROR',
  'TIMEOUT',
  'NETWORK_ERROR',
  'UNKNOWN',
]);
