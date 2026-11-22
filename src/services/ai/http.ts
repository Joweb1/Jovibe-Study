import { AiServiceError } from './errors';
import type { AiProvider } from './providers';

export const GEMINI_GENERATION_TIMEOUT_MS = 35_000;
export const GEMINI_KEY_TEST_TIMEOUT_MS = 18_000;
export const PROVIDER_GENERATION_TIMEOUT_MS = 35_000;
export const PROVIDER_JSON_TIMEOUT_MS = 55_000;
export const PROVIDER_VISION_TIMEOUT_MS = 65_000;
export const PROVIDER_IMAGE_TIMEOUT_MS = 55_000;
export const PROVIDER_KEY_TEST_TIMEOUT_MS = 20_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ensureOnline(): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new AiServiceError(
      'You are currently offline. AI Tutor, OCR, Practice generation, and Automatic Study require an internet connection.',
      'OFFLINE',
      { retryable: false }
    );
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs);

  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export interface RawErrorBody {
  error?: unknown;
  message?: unknown;
  code?: unknown;
  retryable?: unknown;
  shouldRotateKey?: unknown;
  cooldownMs?: unknown;
}

/** Normalizes any JSON body into the optional fields toHttpError understands. */
function asRawErrorBody(body: RawErrorBody | Record<string, unknown>): RawErrorBody {
  return (body ?? {}) as RawErrorBody;
}

function stringifyErrorField(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

/**
 * Converts any failed HTTP response into the single error shape the router uses.
 * Providers keep their own status → code mapping on the server; this is the
 * client-side safety net for unexpected payloads.
 */
export function toHttpError(
  status: number,
  rawBody: RawErrorBody | Record<string, unknown>,
  provider: AiProvider,
  fallbackMessage: string
): AiServiceError {
  const body = asRawErrorBody(rawBody);
  const message =
    stringifyErrorField(body.error) || stringifyErrorField(body.message) || fallbackMessage;
  const explicitCode = typeof body.code === 'string' ? body.code : '';
  const cooldownMs = typeof body.cooldownMs === 'number' ? body.cooldownMs : 0;

  const code =
    explicitCode ||
    (status === 401 || status === 403
      ? 'INVALID_KEY'
      : status === 402
      ? 'QUOTA_EXHAUSTED'
      : status === 429
      ? 'RATE_LIMIT'
      : status === 404
      ? 'MODEL_UNAVAILABLE'
      : status === 400 || status === 422
      ? 'INVALID_REQUEST'
      : status >= 500
      ? 'SERVER_ERROR'
      : 'UNKNOWN');

  return new AiServiceError(message, code as AiServiceError['code'], {
    provider,
    retryable:
      typeof body.retryable === 'boolean'
        ? body.retryable
        : code === 'RATE_LIMIT' ||
          code === 'QUOTA_EXHAUSTED' ||
          code === 'SERVER_ERROR' ||
          code === 'TIMEOUT' ||
          code === 'NETWORK_ERROR',
    cooldownMs,
    status,
  });
}

export function toNetworkError(
  err: unknown,
  provider: AiProvider,
  externalSignal?: AbortSignal
): AiServiceError {
  if (err instanceof AiServiceError) return err;
  if (externalSignal?.aborted) {
    return new AiServiceError('Request cancelled.', 'ABORTED', { provider, retryable: false });
  }
  const isTimeout =
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.message === 'TIMEOUT');
  return new AiServiceError(
    isTimeout
      ? 'The AI request timed out while waiting for a response.'
      : err instanceof Error
      ? err.message
      : 'Network error contacting the AI service.',
    isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
    { provider, retryable: true }
  );
}
