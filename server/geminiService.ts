import { GoogleGenAI, Type, type GenerateContentResponse } from '@google/genai';

export const ALLOWED_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;

export const DEFAULT_MODEL = 'gemini-4-hydrogen';
export const LITE_TEXT_MODEL = 'gemini-3.1-flash-lite';
export const TTS_MODEL = 'gemini-3.8-flash-lite-tts';
export const LITE_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
export const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
export const IMAGE_MODEL = 'gemini-3.1-flash-image';
export const LITE_IMAGE_MODEL = 'gemini-3.1-flash-lite-image';
export const ALLOWED_TTS_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'] as const;
export type TtsVoiceName = (typeof ALLOWED_TTS_VOICES)[number];
export type GeminiModelTaskType = 'text' | 'image' | 'tts' | 'transcribe' | 'live';

export function resolveTtsVoice(requestedVoice?: unknown): TtsVoiceName {
  if (typeof requestedVoice === 'string') {
    const match = ALLOWED_TTS_VOICES.find((v) => v.toLowerCase() === requestedVoice.trim().toLowerCase());
    if (match) return match;
  }
  return 'Kore';
}

const DEPRECATED_MODEL_PATTERNS = [
  /^gemini-1\.5/i,
  /^gemini-2\.0/i,
  /^gemini-pro$/i,
];

export type AiErrorCode =
  | 'NO_API_KEY'
  | 'INVALID_KEY'
  | 'RATE_LIMIT'
  | 'MODEL_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'SAFETY_BLOCKED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR';

export interface ClassifiedAiError {
  code: AiErrorCode;
  status: number;
  message: string;
  retryable: boolean;
  shouldRotateKey: boolean;
  cooldownMs: number;
}

export interface GeminiFallbackExhaustedMeta {
  modelFallbackAttempted: boolean;
  attemptedModels: string[];
  highTraffic503: boolean;
}

const FALLBACK_META_KEY = '__sotalGeminiFallbackMeta';

export function attachGeminiFallbackMeta(err: unknown, meta: GeminiFallbackExhaustedMeta): unknown {
  if (err && typeof err === 'object') {
    try {
      (err as Record<string, unknown>)[FALLBACK_META_KEY] = meta;
    } catch {
      // Ignore frozen error objects
    }
  }
  return err;
}

export function extractGeminiFallbackMeta(err: unknown): GeminiFallbackExhaustedMeta | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const raw = (err as Record<string, unknown>)[FALLBACK_META_KEY];
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Partial<GeminiFallbackExhaustedMeta>;
  if (typeof rec.modelFallbackAttempted !== 'boolean' || !Array.isArray(rec.attemptedModels)) {
    return undefined;
  }
  return {
    modelFallbackAttempted: rec.modelFallbackAttempted,
    attemptedModels: rec.attemptedModels.filter((m): m is string => typeof m === 'string'),
    highTraffic503: Boolean(rec.highTraffic503),
  };
}

export interface ResolvedKeyContext {
  apiKey: string;
  keySource: 'byok' | 'server_fallback';
}

function isByokOnlyFlag(header?: string | string[] | boolean): boolean {
  if (typeof header === 'boolean') return header;
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

export function resolveApiKey(
  headerKey?: string | string[],
  byokOnlyHeader?: string | string[] | boolean
): ResolvedKeyContext {
  const rawHeader = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  const trimmedByok = typeof rawHeader === 'string' ? rawHeader.trim() : '';

  if (trimmedByok.length > 0) {
    return { apiKey: trimmedByok, keySource: 'byok' };
  }

  // Once a user has added any personal API key, they are permanently banned from using server .env keys.
  if (isByokOnlyFlag(byokOnlyHeader)) {
    throw new Error('NO_API_KEY_CONFIGURED');
  }

  const serverKey = (process.env.GEMINI_API_KEY || '').trim();
  if (serverKey.length > 0) {
    return { apiKey: serverKey, keySource: 'server_fallback' };
  }

  throw new Error('NO_API_KEY_CONFIGURED');
}

export function resolveModelName(requestedModel?: unknown, fallbackModel: string = DEFAULT_MODEL): string {
  if (typeof requestedModel !== 'string' || !requestedModel.trim()) {
    return fallbackModel;
  }
  const clean = requestedModel.trim();
  if (DEPRECATED_MODEL_PATTERNS.some((p) => p.test(clean))) {
    return fallbackModel;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(clean) || clean.length > 80) {
    return fallbackModel;
  }
  return clean;
}

export function createGeminiClient(apiKey: string, apiVersion?: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractNumericStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const rec = err as Record<string, unknown>;
  const candidates = [
    rec.status,
    rec.statusCode,
    rec.code,
    rec.error && typeof rec.error === 'object' ? (rec.error as Record<string, unknown>).code : undefined,
    rec.error && typeof rec.error === 'object' ? (rec.error as Record<string, unknown>).status : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string' && /^\d{3}$/.test(candidate.trim())) {
      return Number(candidate.trim());
    }
  }
  return null;
}

function extractUpstreamStatusString(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const rec = err as Record<string, unknown>;
  if (typeof rec.status === 'string') return rec.status.toUpperCase();
  if (rec.error && typeof rec.error === 'object') {
    const nested = (rec.error as Record<string, unknown>).status;
    if (typeof nested === 'string') return nested.toUpperCase();
  }
  return '';
}

/**
 * Detects Gemini 503 high-traffic / overload / temporary unavailability errors.
 * Explicitly excludes auth (401/403), quota/rate-limit (429), invalid input (400),
 * safety blocks, and missing-key errors so we only downgrade models on real 503 traffic spikes.
 */
export function isGeminiHighTrafficError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg === 'NO_API_KEY_CONFIGURED') return false;

  const numericStatus = extractNumericStatus(err);
  if (numericStatus === 503) return true;
  if (
    numericStatus === 400 ||
    numericStatus === 401 ||
    numericStatus === 403 ||
    numericStatus === 404 ||
    numericStatus === 422 ||
    numericStatus === 429
  ) {
    return false;
  }

  const upstreamStatus = extractUpstreamStatusString(err);
  if (upstreamStatus === 'UNAVAILABLE') return true;

  const lower = msg.toLowerCase();
  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthenticated') ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('invalid_argument') ||
    lower.includes('safety') ||
    lower.includes('blocked') ||
    /\b(400|401|403|404|429)\b/.test(lower)
  ) {
    return false;
  }

  return (
    /\b503\b/.test(lower) ||
    lower.includes('service unavailable') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('model is overloaded') ||
    lower.includes('overloaded') ||
    lower.includes('high demand') ||
    lower.includes('high traffic') ||
    lower.includes('experiencing high') ||
    lower.includes('"status":"unavailable"') ||
    lower.includes('"status": "unavailable"') ||
    lower.includes('unavailable') ||
    lower.includes('capacity')
  );
}

/**
 * Returns the ordered list of lower-tier, valid (non-deprecated) Gemini models
 * to retry on the SAME API key when the primary model hits a 503 high-traffic spike.
 */
export function getLowerGeminiFallbackModels(
  primaryModel: string,
  task: GeminiModelTaskType = 'text'
): string[] {
  const normalized = (primaryModel || '').trim().toLowerCase();

  if (task === 'image') {
    if (normalized === LITE_IMAGE_MODEL) return [];
    return [LITE_IMAGE_MODEL];
  }

  if (task === 'tts') {
    if (normalized === LITE_TTS_MODEL) return [];
    return [LITE_TTS_MODEL];
  }

  if (task === 'transcribe') {
    if (normalized === LITE_TEXT_MODEL) return [];
    return [LITE_TEXT_MODEL];
  }

  if (task === 'live') {
    if (normalized === 'gemini-3.8-live-extended-thinking') {
      return ['gemini-3.8-live'];
    }
    return [];
  }

  // Default: text / structured_json / vision
  if (normalized === LITE_TEXT_MODEL) return [];
  if (normalized === 'gemini-4-carbon') {
    return ['gemini-4-neon', DEFAULT_MODEL, LITE_TEXT_MODEL];
  }
  if (normalized === 'gemini-4-neon' || normalized === 'gemini-4-argon') {
    return [DEFAULT_MODEL, LITE_TEXT_MODEL];
  }
  if (normalized === DEFAULT_MODEL) {
    return [LITE_TEXT_MODEL];
  }

  // Any other custom/preview text model downgrades to hydrogen -> flash-lite
  return [DEFAULT_MODEL, LITE_TEXT_MODEL].filter((m) => m !== normalized);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isModelNotFoundError(err: unknown): boolean {
  const numericStatus = extractNumericStatus(err);
  if (numericStatus === 404) return true;
  const lower = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return /\b404\b/.test(lower) || lower.includes('not_found') || lower.includes('model not found');
}

/**
 * Executes a Gemini API call on the current key, automatically downgrading to lower
 * Gemini model(s) and retrying on the SAME key when a 503 high-traffic error occurs,
 * BEFORE surfacing the error for key rotation or cross-provider fallback.
 */
export async function executeGeminiWithModelFallback<T>(params: {
  primaryModel: string;
  task?: GeminiModelTaskType;
  fallbackModels?: string[];
  /** When already on the lowest-tier Gemini model, perform 1 brief same-key retry on 503 before rotating keys. */
  retrySameModelIfLowest?: boolean;
  onModelSwitch?: (info: { fromModel: string; toModel: string; reason: string }) => void;
  run: (model: string) => Promise<T>;
}): Promise<{
  result: T;
  model: string;
  switchedFromModel?: string;
  attemptedModels: string[];
}> {
  const { primaryModel, task = 'text', retrySameModelIfLowest = true, run, onModelSwitch } = params;
  const attemptedModels: string[] = [primaryModel];

  try {
    const result = await run(primaryModel);
    return { result, model: primaryModel, attemptedModels };
  } catch (primaryErr) {
    if (!isGeminiHighTrafficError(primaryErr)) {
      throw primaryErr;
    }

    const lowerModels = (
      params.fallbackModels ?? getLowerGeminiFallbackModels(primaryModel, task)
    ).filter((m) => m && m !== primaryModel);

    let lastErr: unknown = primaryErr;

    if (lowerModels.length > 0) {
      let previousModel = primaryModel;
      for (const fallbackModel of lowerModels) {
        attemptedModels.push(fallbackModel);
        console.warn(
          `[Gemini 503] High traffic on ${previousModel} (${task}) — switching to lower model ${fallbackModel} on same key before key rotation.`
        );
        onModelSwitch?.({
          fromModel: previousModel,
          toModel: fallbackModel,
          reason: '503_high_traffic',
        });

        await sleepMs(250);

        try {
          const result = await run(fallbackModel);
          return {
            result,
            model: fallbackModel,
            switchedFromModel: primaryModel,
            attemptedModels,
          };
        } catch (fallbackErr) {
          lastErr = fallbackErr;
          previousModel = fallbackModel;
          // Continue down the ladder only if this lower model ALSO hit 503 high traffic or 404 model unavailable
          if (isGeminiHighTrafficError(fallbackErr) || isModelNotFoundError(fallbackErr)) {
            continue;
          }
          // Auth/quota/safety/invalid-request error on the fallback model should stop immediately
          throw attachGeminiFallbackMeta(fallbackErr, {
            modelFallbackAttempted: true,
            attemptedModels,
            highTraffic503: false,
          });
        }
      }

      throw attachGeminiFallbackMeta(lastErr, {
        modelFallbackAttempted: true,
        attemptedModels,
        highTraffic503: isGeminiHighTrafficError(lastErr),
      });
    }

    // Already on the lowest-tier model for this task: try 1 brief retry on the same key before rotating
    if (retrySameModelIfLowest) {
      console.warn(
        `[Gemini 503] High traffic on lowest-tier model ${primaryModel} (${task}) — retrying once on same key before key rotation.`
      );
      await sleepMs(400);
      try {
        const result = await run(primaryModel);
        return { result, model: primaryModel, attemptedModels };
      } catch (retryErr) {
        throw attachGeminiFallbackMeta(retryErr, {
          modelFallbackAttempted: true,
          attemptedModels,
          highTraffic503: isGeminiHighTrafficError(retryErr),
        });
      }
    }

    throw attachGeminiFallbackMeta(primaryErr, {
      modelFallbackAttempted: false,
      attemptedModels,
      highTraffic503: true,
    });
  }
}

export function classifyAiError(err: unknown, keySource: 'byok' | 'server_fallback' = 'server_fallback'): ClassifiedAiError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  const numericStatus = extractNumericStatus(err);

  if (msg === 'NO_API_KEY_CONFIGURED') {
    return {
      code: 'NO_API_KEY',
      status: 503,
      message:
        'No Gemini API key is available. Add your own Gemini API key in Settings or configure GEMINI_API_KEY on the server.',
      retryable: false,
      shouldRotateKey: false,
      cooldownMs: 0,
    };
  }

  if (
    numericStatus === 401 ||
    numericStatus === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('permission_denied') ||
    lower.includes('403') ||
    lower.includes('401') ||
    lower.includes('unauthenticated')
  ) {
    return {
      code: 'INVALID_KEY',
      status: 403,
      message:
        keySource === 'byok'
          ? 'This Gemini API key was rejected by Google AI. Verify or replace the key in Settings.'
          : 'Server GEMINI_API_KEY was rejected. Verify your key in Settings > Secrets or add a local BYOK key.',
      retryable: false,
      shouldRotateKey: true,
      cooldownMs: 0,
    };
  }

  if (
    numericStatus === 429 ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  ) {
    return {
      code: 'RATE_LIMIT',
      status: 429,
      message:
        'Gemini API rate limit or quota reached for the active key. Cooling down before retrying or trying an eligible fallback key.',
      retryable: true,
      shouldRotateKey: true,
      cooldownMs: 60_000,
    };
  }

  if (
    numericStatus === 404 ||
    lower.includes('404') ||
    lower.includes('not_found') ||
    lower.includes('model not found')
  ) {
    return {
      code: 'MODEL_UNAVAILABLE',
      status: 404,
      message:
        'The requested Gemini model is unavailable for this API key. Switch to gemini-4-hydrogen in Settings.',
      retryable: false,
      shouldRotateKey: false,
      cooldownMs: 0,
    };
  }

  if (lower.includes('safety') || lower.includes('blocked')) {
    return {
      code: 'SAFETY_BLOCKED',
      status: 422,
      message: 'The response was blocked by safety filters. Rephrase the prompt and try again.',
      retryable: false,
      shouldRotateKey: false,
      cooldownMs: 0,
    };
  }

  if (numericStatus === 400 || lower.includes('400') || lower.includes('invalid_argument')) {
    return {
      code: 'INVALID_REQUEST',
      status: 400,
      message: `Invalid AI request parameters: ${msg}`,
      retryable: false,
      shouldRotateKey: false,
      cooldownMs: 0,
    };
  }

  if (isGeminiHighTrafficError(err)) {
    return {
      code: 'SERVER_ERROR',
      status: 503,
      message:
        'Gemini is experiencing high traffic (503) across available models. Rotating key or switching to a fallback provider.',
      retryable: true,
      shouldRotateKey: true,
      cooldownMs: 20_000,
    };
  }

  if (
    numericStatus === 500 ||
    numericStatus === 502 ||
    numericStatus === 504 ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('504') ||
    lower.includes('deadline_exceeded')
  ) {
    return {
      code: 'SERVER_ERROR',
      status: 503,
      message: 'Temporary Gemini service error. Retrying shortly.',
      retryable: true,
      shouldRotateKey: true,
      cooldownMs: 20_000,
    };
  }

  return {
    code: 'NETWORK_ERROR',
    status: 500,
    message: `AI request failed: ${msg}`,
    retryable: true,
    shouldRotateKey: false,
    cooldownMs: 5_000,
  };
}

export function extractFinishReason(response: GenerateContentResponse): string {
  return String(response.candidates?.[0]?.finishReason ?? 'STOP');
}

export function checkSafetyBlock(response: GenerateContentResponse): void {
  const reason = extractFinishReason(response).toUpperCase();
  if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT' || reason === 'BLOCKLIST') {
    throw new Error(`Response blocked due to safety policy (${reason}).`);
  }
}

export { Type };
