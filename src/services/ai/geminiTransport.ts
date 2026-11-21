import { AiServiceError } from './errors';
import {
  fetchWithTimeout,
  GEMINI_GENERATION_TIMEOUT_MS,
  toHttpError,
  toNetworkError,
} from './http';

interface GeminiCallParams {
  endpoint: string;
  payload: Record<string, unknown>;
  /** BYOK key. `null` uses the server-managed GEMINI_API_KEY. */
  apiKey: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * POSTs to one of SOTAL's Gemini-backed server routes.
 * The key always travels to our own server (never to Google directly), so the
 * device-local BYOK contract is preserved.
 */export async function callGeminiEndpoint<TResponse extends { model?: string }>(
  params: GeminiCallParams
): Promise<TResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.apiKey) {
    headers['x-sotal-gemini-key'] = params.apiKey;
  }

  try {
    const response = await fetchWithTimeout(
      params.endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(params.payload),
      },
      params.timeoutMs ?? GEMINI_GENERATION_TIMEOUT_MS,
      params.signal
    );

    const json = (await response.json().catch(() => ({}))) as TResponse & Record<string, unknown>;

    if (response.ok) return json;

    throw toHttpError(
      response.status,
      json,
      'gemini',
      `Gemini request failed (HTTP ${response.status}).`
    );
  } catch (err) {
    if (err instanceof AiServiceError) throw err;
    throw toNetworkError(err, 'gemini', params.signal);
  }
}

let serverFallbackCache: { available: boolean; checkedAtMs: number } | null = null;
const SERVER_FALLBACK_CACHE_MS = 60_000;

/**
 * Cached health probe telling the router whether the server holds a usable
 * GEMINI_API_KEY. Avoids appending a dead candidate on every request.
 */
export async function checkServerFallbackStatus(force = false): Promise<boolean> {
  const now = Date.now();
  if (
    !force &&
    serverFallbackCache &&
    now - serverFallbackCache.checkedAtMs < SERVER_FALLBACK_CACHE_MS
  ) {
    return serverFallbackCache.available;
  }
  try {
    const res = await fetch('/api/health');
    if (!res.ok) {
      serverFallbackCache = { available: false, checkedAtMs: now };
      return false;
    }
    const data = (await res.json()) as { serverFallbackAvailable?: boolean };
    const available = Boolean(data.serverFallbackAvailable);
    serverFallbackCache = { available, checkedAtMs: now };
    return available;
  } catch {
    serverFallbackCache = { available: false, checkedAtMs: now };
    return false;
  }
}
