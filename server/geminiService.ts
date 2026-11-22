import { GoogleGenAI, Type, type GenerateContentResponse } from '@google/genai';

export const ALLOWED_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;

export const DEFAULT_MODEL = 'gemini-4-hydrogen';
export const TTS_MODEL = 'gemini-3.8-flash-lite-tts';
export const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
export const IMAGE_MODEL = 'gemini-3.1-flash-image';
export const ALLOWED_TTS_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'] as const;
export type TtsVoiceName = (typeof ALLOWED_TTS_VOICES)[number];

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

export function resolveModelName(requestedModel?: unknown): string {
  if (typeof requestedModel !== 'string' || !requestedModel.trim()) {
    return DEFAULT_MODEL;
  }
  const clean = requestedModel.trim();
  if (DEPRECATED_MODEL_PATTERNS.some((p) => p.test(clean))) {
    return DEFAULT_MODEL;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(clean) || clean.length > 80) {
    return DEFAULT_MODEL;
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

export function classifyAiError(err: unknown, keySource: 'byok' | 'server_fallback' = 'server_fallback'): ClassifiedAiError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

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

  if (lower.includes('404') || lower.includes('not_found') || lower.includes('model not found')) {
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

  if (lower.includes('400') || lower.includes('invalid_argument')) {
    return {
      code: 'INVALID_REQUEST',
      status: 400,
      message: `Invalid AI request parameters: ${msg}`,
      retryable: false,
      shouldRotateKey: false,
      cooldownMs: 0,
    };
  }

  if (
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
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
