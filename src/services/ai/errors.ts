import type { AiProvider } from './providers';

export type AiErrorCode =
  | 'NO_API_KEY'
  | 'INVALID_KEY'
  | 'RATE_LIMIT'
  | 'QUOTA_EXHAUSTED'
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
}

export class AiServiceError extends Error {
  code: AiErrorCode;
  retryable: boolean;
  provider?: AiProvider;
  cooldownMs: number;
  status?: number;

  constructor(message: string, code: AiErrorCode = 'UNKNOWN', options: AiErrorOptions = {}) {
    super(message);
    this.name = 'AiServiceError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.provider = options.provider;
    this.cooldownMs = options.cooldownMs ?? 0;
    this.status = options.status;
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
