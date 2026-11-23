import { AiServiceError } from './errors';
import {
  fetchWithTimeout,
  GEMINI_GENERATION_TIMEOUT_MS,
  toHttpError,
  toNetworkError,
} from './http';
import { hasUserEnteredOwnKey } from './keyManager';
import type { AiProvider } from './providers';
import { buildAuthHeaders, notifyQuotaFromHeaders } from '../api/authHeaders';

export type ServerFallbackProviders = Record<AiProvider, boolean>;

const EMPTY_SERVER_PROVIDERS: ServerFallbackProviders = {
  gemini: false,
  openrouter: false,
  cerebras: false,
  groq: false,
  cloudflare: false,
  nvidia_nim: false,
};

interface GeminiCallParams {
  endpoint: string;
  payload: Record<string, unknown>;
  /** BYOK key. `null` uses the admin shared pool / server-managed fallback key (only during eligible free trial). */
  apiKey: string | null;
  requestId?: string;
  feature?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * POSTs to one of SOTAL's Gemini-backed server routes.
 * The key always travels to our own server (never to Google directly), so the
 * device-local BYOK contract is preserved.
 */
export async function callGeminiEndpoint<TResponse extends { model?: string }>(
  params: GeminiCallParams
): Promise<TResponse> {
  const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });
  if (params.apiKey) {
    headers['x-sotal-gemini-key'] = params.apiKey;
  }
  if (hasUserEnteredOwnKey()) {
    headers['x-sotal-byok-only'] = '1';
  }
  if (params.requestId) {
    headers['x-sotal-request-id'] = params.requestId;
  }
  if (params.feature) {
    headers['x-sotal-feature'] = params.feature;
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

    notifyQuotaFromHeaders(response.headers);
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

let serverFallbackCache: {
  providers: ServerFallbackProviders;
  checkedAtMs: number;
} | null = null;
const SERVER_FALLBACK_CACHE_MS = 60_000;

export function resetServerFallbackCache(): void {
  serverFallbackCache = null;
}

/**
 * Cached health probe telling the router which providers have usable `.env`
 * fallback keys configured on the server (used ONLY before a user has ever
 * entered a personal API key).
 */
export async function checkServerFallbackProviders(
  force = false
): Promise<ServerFallbackProviders> {
  const now = Date.now();
  if (
    !force &&
    serverFallbackCache &&
    now - serverFallbackCache.checkedAtMs < SERVER_FALLBACK_CACHE_MS
  ) {
    return serverFallbackCache.providers;
  }
  try {
    const res = await fetch('/api/health');
    if (!res.ok) {
      serverFallbackCache = { providers: { ...EMPTY_SERVER_PROVIDERS }, checkedAtMs: now };
      return serverFallbackCache.providers;
    }
    const data = (await res.json()) as {
      serverFallbackAvailable?: boolean;
      serverFallbackProviders?: Partial<ServerFallbackProviders>;
    };
    const raw = data.serverFallbackProviders;
    const providers: ServerFallbackProviders = raw
      ? {
          gemini: Boolean(raw.gemini),
          openrouter: Boolean(raw.openrouter),
          cerebras: Boolean(raw.cerebras),
          groq: Boolean(raw.groq),
          cloudflare: Boolean(raw.cloudflare),
          nvidia_nim: Boolean(raw.nvidia_nim),
        }
      : {
          ...EMPTY_SERVER_PROVIDERS,
          gemini: Boolean(data.serverFallbackAvailable),
        };
    serverFallbackCache = { providers, checkedAtMs: now };
    return providers;
  } catch {
    serverFallbackCache = { providers: { ...EMPTY_SERVER_PROVIDERS }, checkedAtMs: now };
    return serverFallbackCache.providers;
  }
}

/**
 * Cached health probe telling the UI whether any server-managed `.env`
 * fallback provider is available.
 */
export async function checkServerFallbackStatus(force = false): Promise<boolean> {
  const providers = await checkServerFallbackProviders(force);
  return Object.values(providers).some(Boolean);
}
