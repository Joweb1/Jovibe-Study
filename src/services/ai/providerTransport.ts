import { AiServiceError } from './errors';
import {
  fetchWithTimeout,
  PROVIDER_GENERATION_TIMEOUT_MS,
  PROVIDER_KEY_TEST_TIMEOUT_MS,
  toHttpError,
  toNetworkError,
} from './http';
import { hasUserEnteredOwnKey } from './keyManager';
import type { AiProvider, AiTask } from './providers';
import { buildAuthHeaders, notifyQuotaFromHeaders } from '../api/authHeaders';

type NonGeminiProvider = Exclude<AiProvider, 'gemini'>;

const TASK_PATHS: Record<AiTask, string> = {
  chat: 'generate',
  structured_json: 'generate-json',
  vision: 'vision',
  transcription: 'transcribe',
  tts: 'tts',
  image_generation: 'generate-image',
};

export interface ProviderCallParams {
  provider: NonGeminiProvider;
  task: AiTask;
  payload: Record<string, unknown>;
  /** BYOK key, or `null` to use the server-managed shared pool / fallback key. */
  apiKey: string | null;
  requestId?: string;
  feature?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Calls our own provider proxy route. The provider key is sent only to the
 * SOTAL server for the duration of the request and is never persisted there.
 */
export async function callProviderTask<TResponse extends { model?: string }>(
  params: ProviderCallParams
): Promise<TResponse> {
  const headers = await buildAuthHeaders({
    'Content-Type': 'application/json',
  });
  if (params.apiKey) {
    headers['x-sotal-provider-key'] = params.apiKey;
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
      `/api/providers/${params.provider}/${TASK_PATHS[params.task]}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(params.payload),
      },
      params.timeoutMs ?? PROVIDER_GENERATION_TIMEOUT_MS,
      params.signal
    );

    notifyQuotaFromHeaders(response.headers);
    const json = (await response.json().catch(() => ({}))) as TResponse & Record<string, unknown>;
    if (response.ok) return json;

    throw toHttpError(
      response.status,
      json,
      params.provider,
      `${params.provider} request failed (HTTP ${response.status}).`
    );
  } catch (err) {
    if (err instanceof AiServiceError) throw err;
    throw toNetworkError(err, params.provider, params.signal);
  }
}

export interface ProviderKeyTestResult {
  ok: boolean;
  provider: AiProvider;
  model: string;
  latencyMs: number;
  error?: string;
  code?: string;
}

export async function testProviderApiKey(params: {
  provider: NonGeminiProvider;
  rawKey: string;
  keyId?: string;
}): Promise<ProviderKeyTestResult> {
  const { recordApiKeyFailure, recordApiKeySuccess } = await import('./keyManager');

  try {
    const authHeaders = await buildAuthHeaders({
      'Content-Type': 'application/json',
      'x-sotal-provider-key': params.rawKey,
      'x-sotal-byok-only': '1',
    });
    const response = await fetchWithTimeout(
      `/api/providers/${params.provider}/test-key`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      },
      PROVIDER_KEY_TEST_TIMEOUT_MS
    );

    const json = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      model?: string;
      latencyMs?: number;
      error?: string;
      code?: string;
      cooldownMs?: number;
    };

    if (response.ok && json.ok) {
      if (params.keyId) {
        recordApiKeySuccess(params.keyId);
      }
      return {
        ok: true,
        provider: params.provider,
        model: json.model || 'unknown',
        latencyMs: json.latencyMs ?? 0,
      };
    }

    const code = json.code || (response.status === 429 ? 'RATE_LIMIT' : 'INVALID_KEY');
    const errorMsg = json.error || `Key test failed (HTTP ${response.status}).`;
    if (params.keyId) {
      recordApiKeyFailure(
        params.keyId,
        code,
        errorMsg,
        typeof json.cooldownMs === 'number' ? json.cooldownMs : 0
      );
    }

    return {
      ok: false,
      provider: params.provider,
      model: json.model || 'unknown',
      latencyMs: 0,
      error: errorMsg,
      code,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Timed out while testing the key.';
    if (params.keyId) {
      recordApiKeyFailure(params.keyId, 'TIMEOUT', errorMsg, 0);
    }
    return {
      ok: false,
      provider: params.provider,
      model: 'unknown',
      latencyMs: 0,
      error: errorMsg,
      code: 'TIMEOUT',
    };
  }
}
