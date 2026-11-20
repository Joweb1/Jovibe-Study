import {
  buildExecutionCandidates,
  recordApiKeyFailure,
  recordApiKeySuccess,
} from './keyManager';
import type { SchemaValidator } from './schemaValidator';

export const AVAILABLE_AI_MODELS = [
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen (Recommended default)',
    description: 'Fast, balanced model for Tutor explanations, OCR, practice generation, and Automatic Study.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    description: 'Lightweight low-latency model for quick checks, flashcards, and high-volume study drills.',
  },
] as const;

export const AVAILABLE_TTS_VOICES = [
  {
    id: 'Kore',
    label: 'Kore',
    description: 'Clear, calm, balanced academic lecturer voice (default).',
  },
  {
    id: 'Puck',
    label: 'Puck',
    description: 'Bright, engaging conversational tutor voice.',
  },
  {
    id: 'Charon',
    label: 'Charon',
    description: 'Deep, measured, authoritative lecture voice.',
  },
  {
    id: 'Fenrir',
    label: 'Fenrir',
    description: 'Crisp, articulate, structured explanation voice.',
  },
  {
    id: 'Zephyr',
    label: 'Zephyr',
    description: 'Warm, steady, approachable study companion voice.',
  },
] as const;

export type AiModelId = (typeof AVAILABLE_AI_MODELS)[number]['id'] | string;

export interface AiRequestMeta {
  model: string;
  keySource: 'byok' | 'server_fallback';
  keyLabel: string;
}

export interface ApiErrorBody {
  error?: string;
  code?: string;
  retryable?: boolean;
  shouldRotateKey?: boolean;
  cooldownMs?: number;
}

export class AiServiceError extends Error {
  code: string;
  retryable: boolean;

  constructor(message: string, code = 'AI_ERROR', retryable = false) {
    super(message);
    this.name = 'AiServiceError';
    this.code = code;
    this.retryable = retryable;
  }
}

const MAX_ATTEMPTS = 4;
const GENERATION_TIMEOUT_MS = 35_000;
const KEY_TEST_TIMEOUT_MS = 18_000;
const TRANSIENT_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureOnline(): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new AiServiceError(
      'You are currently offline. AI Tutor, OCR, Practice generation, and Automatic Study require an internet connection.',
      'OFFLINE',
      false
    );
  }
}

async function fetchWithTimeout(
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

async function executeWithFallback<TResponse>(
  endpoint: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  allowTransientModelFallback = true
): Promise<{ body: TResponse; meta: AiRequestMeta }> {
  ensureOnline();

  const candidates = buildExecutionCandidates();
  if (candidates.length === 0) {
    throw new AiServiceError(
      'No active Gemini API key is available. Add a BYOK key in Settings or enable server GEMINI_API_KEY fallback.',
      'NO_API_KEY',
      false
    );
  }

  let attempts = 0;
  let lastError: AiServiceError = new AiServiceError('AI request failed.', 'UNKNOWN', false);

  for (let i = 0; i < candidates.length && attempts < MAX_ATTEMPTS; i += 1) {
    const candidate = candidates[i];
    attempts += 1;

    if (signal?.aborted) {
      throw new AiServiceError('Request cancelled.', 'ABORTED', false);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (candidate.kind === 'byok' && candidate.apiKey) {
      headers['x-sotal-gemini-key'] = candidate.apiKey;
    }

    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        },
        GENERATION_TIMEOUT_MS,
        signal
      );

      const json = (await response.json().catch(() => ({}))) as TResponse &
        ApiErrorBody & { model?: string; keySource?: 'byok' | 'server_fallback' };

      if (response.ok) {
        if (candidate.kind === 'byok' && candidate.keyId) {
          recordApiKeySuccess(candidate.keyId);
        }
        return {
          body: json,
          meta: {
            model: json.model || String(payload.model || 'gemini-4-hydrogen'),
            keySource: json.keySource || candidate.kind,
            keyLabel: candidate.label,
          },
        };
      }

      const code = json.code || (response.status === 429 ? 'RATE_LIMIT' : 'SERVER_ERROR');
      const message = json.error || `AI request failed (HTTP ${response.status}).`;
      const cooldownMs = typeof json.cooldownMs === 'number' ? json.cooldownMs : 0;

      if (candidate.kind === 'byok' && candidate.keyId) {
        recordApiKeyFailure(candidate.keyId, code, message, cooldownMs);
      }

      lastError = new AiServiceError(message, code, Boolean(json.retryable));

      // Never rotate keys or retry on invalid client requests, safety blocks, or missing model
      if (
        code === 'INVALID_REQUEST' ||
        code === 'SAFETY_BLOCKED' ||
        code === 'MODEL_UNAVAILABLE'
      ) {
        throw lastError;
      }

      // If more candidates remain (another BYOK key or server fallback), move cleanly to next candidate
      if (json.shouldRotateKey && i < candidates.length - 1) {
        await sleep(250);
        continue;
      }

      // Controlled single transient retry on same candidate for temporary 5xx
      if (code === 'SERVER_ERROR' && attempts < MAX_ATTEMPTS) {
        await sleep(800 * attempts);
        i -= 1; // retry this candidate once
        continue;
      }

      if (i < candidates.length - 1) {
        continue;
      }

      break;
    } catch (err) {
      if (err instanceof AiServiceError) {
        throw err;
      }
      if (signal?.aborted) {
        throw new AiServiceError('Request cancelled.', 'ABORTED', false);
      }
      const isTimeout =
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.message === 'TIMEOUT');
      const msg = isTimeout
        ? 'The AI request timed out while waiting for Gemini to respond.'
        : err instanceof Error
        ? err.message
        : 'Network error contacting AI service.';
      lastError = new AiServiceError(msg, isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR', true);
      if (i >= candidates.length - 1) {
        break;
      }
    }
  }

  // Transparent transient failover to gemini-3.1-flash-lite if gemini-4-hydrogen is overloaded/timing out
  const requestedModel = String(payload.model || 'gemini-4-hydrogen');
  if (
    allowTransientModelFallback &&
    requestedModel !== TRANSIENT_FALLBACK_MODEL &&
    (lastError.code === 'SERVER_ERROR' || lastError.code === 'TIMEOUT')
  ) {
    return executeWithFallback<TResponse>(
      endpoint,
      { ...payload, model: TRANSIENT_FALLBACK_MODEL },
      signal,
      false
    );
  }

  throw lastError;
}

export async function testSpecificApiKey(params: {
  rawKey?: string;
  keyId?: string;
  model?: string;
}): Promise<{
  ok: boolean;
  keySource: 'byok' | 'server_fallback';
  model: string;
  latencyMs: number;
  error?: string;
  code?: string;
}> {
  ensureOnline();

  const runSingleTest = async (targetModel: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (params.rawKey && params.rawKey.trim()) {
      headers['x-sotal-gemini-key'] = params.rawKey.trim();
    }

    try {
      const response = await fetchWithTimeout(
        '/api/ai/test-key',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: targetModel }),
        },
        KEY_TEST_TIMEOUT_MS
      );

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        keySource?: 'byok' | 'server_fallback';
        model?: string;
        latencyMs?: number;
        error?: string;
        code?: string;
        cooldownMs?: number;
      };

      if (response.ok && data.ok) {
        return {
          ok: true as const,
          keySource: data.keySource || (params.rawKey ? ('byok' as const) : ('server_fallback' as const)),
          model: data.model || targetModel,
          latencyMs: data.latencyMs ?? 0,
        };
      }

      return {
        ok: false as const,
        keySource: data.keySource || (params.rawKey ? ('byok' as const) : ('server_fallback' as const)),
        model: targetModel,
        latencyMs: 0,
        error: data.error || `Key test failed (HTTP ${response.status}).`,
        code: data.code || 'INVALID_KEY',
        cooldownMs: data.cooldownMs ?? 0,
      };
    } catch {
      return {
        ok: false as const,
        keySource: params.rawKey ? ('byok' as const) : ('server_fallback' as const),
        model: targetModel,
        latencyMs: 0,
        error: `Timed out waiting for ${targetModel} to respond.`,
        code: 'TIMEOUT',
        cooldownMs: 0,
      };
    }
  };

  const initialModel = params.model || 'gemini-4-hydrogen';
  let result = await runSingleTest(initialModel);

  // If the primary model is experiencing temporary 5xx/timeout, confirm key validity on gemini-3.1-flash-lite
  if (
    !result.ok &&
    initialModel !== TRANSIENT_FALLBACK_MODEL &&
    (result.code === 'SERVER_ERROR' || result.code === 'TIMEOUT')
  ) {
    const fallbackResult = await runSingleTest(TRANSIENT_FALLBACK_MODEL);
    if (fallbackResult.ok) {
      result = fallbackResult;
    }
  }

  if (result.ok) {
    if (params.keyId) {
      recordApiKeySuccess(params.keyId);
    }
    return result;
  }

  if (params.keyId) {
    recordApiKeyFailure(
      params.keyId,
      result.code || 'INVALID_KEY',
      result.error || 'Key test failed.',
      result.cooldownMs ?? 0
    );
  }
  return {
    ok: false,
    keySource: result.keySource,
    model: result.model,
    latencyMs: 0,
    error: result.error,
    code: result.code,
  };
}

export async function checkServerFallbackStatus(): Promise<boolean> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return false;
    const data = (await res.json()) as { serverFallbackAvailable?: boolean };
    return Boolean(data.serverFallbackAvailable);
  } catch {
    return false;
  }
}

export async function generateText(params: {
  prompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; text: string }>;
  systemInstruction?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<{ text: string; meta: AiRequestMeta }> {
  const { body, meta } = await executeWithFallback<{ text: string }>(
    '/api/ai/generate',
    {
      prompt: params.prompt,
      messages: params.messages,
      systemInstruction: params.systemInstruction,
      model: params.model || 'gemini-4-hydrogen',
    },
    params.signal
  );

  return {
    text: body.text || '',
    meta,
  };
}

export async function generateStructuredJson<T>(params: {
  prompt: string;
  systemInstruction?: string;
  responseSchema?: Record<string, unknown>;
  validator: SchemaValidator<T>;
  model?: string;
  signal?: AbortSignal;
}): Promise<{ data: T; meta: AiRequestMeta }> {
  const { body, meta } = await executeWithFallback<{ data: unknown; rawText?: string }>(
    '/api/ai/generate-json',
    {
      prompt: params.prompt,
      systemInstruction: params.systemInstruction,
      responseSchema: params.responseSchema,
      model: params.model || 'gemini-4-hydrogen',
    },
    params.signal
  );

  const validation = params.validator(body.data);
  if (!validation.valid || validation.data === undefined) {
    throw new AiServiceError(
      validation.error || 'AI returned structured output that failed schema validation.',
      'VALIDATION_ERROR',
      true
    );
  }

  return {
    data: validation.data,
    meta,
  };
}

export async function extractVisionWithClient(params: {
  imageBase64: string;
  mimeType: string;
  mode: string;
  pageNumber?: number;
  model?: string;
  signal?: AbortSignal;
}): Promise<{
  sections: Array<{ heading: string; level: number; content: string; pageOrSlide?: number }>;
  uncertainCount: number;
  notes: string;
  meta: AiRequestMeta;
}> {
  const { body, meta } = await executeWithFallback<{
    sections?: Array<{ heading: string; level: number; content: string; pageOrSlide?: number }>;
    uncertainCount?: number;
    notes?: string;
  }>(
    '/api/extract/vision',
    {
      imageBase64: params.imageBase64,
      mimeType: params.mimeType,
      mode: params.mode,
      pageNumber: params.pageNumber,
      model: params.model || 'gemini-4-hydrogen',
    },
    params.signal
  );

  return {
    sections: Array.isArray(body.sections) ? body.sections : [],
    uncertainCount: typeof body.uncertainCount === 'number' ? body.uncertainCount : 0,
    notes: typeof body.notes === 'string' ? body.notes : '',
    meta,
  };
}

export async function synthesizeSpeechWithClient(params: {
  text: string;
  voiceName?: string;
  style?: string;
  signal?: AbortSignal;
}): Promise<{
  audioBase64: string;
  mimeType: string;
  voiceName: string;
  meta: AiRequestMeta;
}> {
  const { body, meta } = await executeWithFallback<{
    audioBase64?: string;
    mimeType?: string;
    voiceName?: string;
  }>(
    '/api/ai/tts',
    {
      text: params.text,
      voiceName: params.voiceName || 'Kore',
      style: params.style,
    },
    params.signal,
    false
  );

  if (!body.audioBase64) {
    throw new AiServiceError(
      'Gemini 3.8 TTS returned no audio data.',
      'SERVER_ERROR',
      true
    );
  }

  return {
    audioBase64: body.audioBase64,
    mimeType: body.mimeType || 'audio/wav',
    voiceName: body.voiceName || params.voiceName || 'Kore',
    meta,
  };
}

export async function transcribeAudioWithClient(params: {
  audioBase64: string;
  mimeType: string;
  courseContextHint?: string;
  signal?: AbortSignal;
}): Promise<{
  text: string;
  meta: AiRequestMeta;
}> {
  const { body, meta } = await executeWithFallback<{ text?: string }>(
    '/api/ai/transcribe',
    {
      audioBase64: params.audioBase64,
      mimeType: params.mimeType,
      courseContextHint: params.courseContextHint,
    },
    params.signal,
    false
  );

  return {
    text: (body.text || '').trim(),
    meta,
  };
}
