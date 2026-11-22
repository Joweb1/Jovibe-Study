import {
  AiServiceError,
  type AiErrorCode,
} from './errors';
import { callGeminiEndpoint } from './geminiTransport';
import { PROVIDER_JSON_TIMEOUT_MS, PROVIDER_VISION_TIMEOUT_MS } from './http';
import { callProviderTask } from './providerTransport';
import { runAiTask, type RouteAttempt } from './aiRouter';
import { toProviderSafeAudio } from './audioTranscode';
import type { AiRequestMeta } from './providers';

export type { AiRequestMeta } from './providers';
export { AiServiceError } from './errors';
export { checkServerFallbackStatus } from './geminiTransport';

export const AVAILABLE_AI_MODELS = [
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen (Recommended default)',
    description:
      'Fast, balanced model for Tutor explanations, OCR, practice generation, and Automatic Study.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    description:
      'Lightweight low-latency model for quick checks, flashcards, and high-volume study drills.',
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

export interface ApiErrorBody {
  error?: string;
  code?: string;
  retryable?: boolean;
  shouldRotateKey?: boolean;
  cooldownMs?: number;
}

const DEFAULT_CHAT_MODEL = 'gemini-4-hydrogen';
const TRANSIENT_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

interface ProviderTextBody {
  text?: string;
  model?: string;
}

interface ProviderJsonBody<T> {
  data?: T;
  rawText?: string;
  model?: string;
}

interface ProviderVisionBody {
  sections?: Array<{ heading: string; level: number; content: string; pageOrSlide?: number }>;
  uncertainCount?: number;
  notes?: string;
  model?: string;
}

interface ProviderTranscribeBody {
  text?: string;
  model?: string;
}

interface ProviderTtsBody {
  audioBase64?: string;
  mimeType?: string;
  voiceName?: string;
  model?: string;
}

function providerForAttempt(attempt: RouteAttempt): Exclude<AiRequestMeta['provider'], 'gemini'> {
  if (attempt.provider === 'gemini') {
    throw new AiServiceError('Internal routing error: Gemini attempt sent to provider transport.', 'UNKNOWN', {
      retryable: false,
    });
  }
  return attempt.provider;
}

function normalizeModel(model: string | undefined, fallback: string): string {
  return typeof model === 'string' && model.trim() ? model.trim() : fallback;
}

export async function generateText(params: {
  prompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; text: string }>;
  systemInstruction?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<{ text: string; meta: AiRequestMeta }> {
  const model = params.model || DEFAULT_CHAT_MODEL;

  const { value, meta } = await runAiTask<{ text: string }>({
    task: 'chat',
    requestedModel: model,
    signal: params.signal,
    execute: async (attempt) => {
      if (attempt.provider === 'gemini') {
        const body = await callGeminiEndpoint<ProviderTextBody>({
          endpoint: '/api/ai/generate',
          apiKey: attempt.apiKey,
          signal: params.signal,
          payload: {
            prompt: params.prompt,
            messages: params.messages,
            systemInstruction: params.systemInstruction,
            model,
          },
        });
        return { value: { text: body.text || '' }, model: normalizeModel(body.model, model) };
      }

      const body = await callProviderTask<ProviderTextBody>({
        provider: providerForAttempt(attempt),
        task: 'chat',
        apiKey: attempt.apiKey,
        signal: params.signal,
        payload: {
          prompt: params.prompt,
          messages: params.messages,
          systemInstruction: params.systemInstruction,
        },
      });
      return { value: { text: body.text || '' }, model: normalizeModel(body.model, 'provider') };
    },
  });

  return { text: value.text, meta };
}

export async function generateStructuredJson<T>(params: {
  prompt: string;
  systemInstruction?: string;
  responseSchema?: Record<string, unknown>;
  validator: (raw: unknown) => { valid: boolean; data?: T; error?: string };
  model?: string;
  signal?: AbortSignal;
}): Promise<{ data: T; meta: AiRequestMeta }> {
  const model = params.model || DEFAULT_CHAT_MODEL;

  const validate = (value: T): T => {
    const validation = params.validator(value);
    if (!validation.valid || validation.data === undefined) {
      throw new AiServiceError(
        validation.error || 'AI returned structured output that failed schema validation.',
        'VALIDATION_ERROR',
        { retryable: true }
      );
    }
    return validation.data;
  };

  const { value, meta } = await runAiTask<T>({
    task: 'structured_json',
    requestedModel: model,
    signal: params.signal,
    validate,
    execute: async (attempt) => {
      if (attempt.provider === 'gemini') {
        const body = await callGeminiEndpoint<ProviderJsonBody<T>>({
          endpoint: '/api/ai/generate-json',
          apiKey: attempt.apiKey,
          signal: params.signal,
          payload: {
            prompt: params.prompt,
            systemInstruction: params.systemInstruction,
            responseSchema: params.responseSchema,
            model,
          },
        });
        return { value: (body.data ?? undefined) as T, model: normalizeModel(body.model, model) };
      }

      const body = await callProviderTask<ProviderJsonBody<T>>({
        provider: providerForAttempt(attempt),
        task: 'structured_json',
        apiKey: attempt.apiKey,
        signal: params.signal,
        timeoutMs: PROVIDER_JSON_TIMEOUT_MS,
        payload: {
          prompt: params.prompt,
          systemInstruction: params.systemInstruction,
          responseSchema: params.responseSchema,
        },
      });

      if (body.data === undefined) {
        throw new AiServiceError('Fallback provider returned no structured output.', 'VALIDATION_ERROR', {
          retryable: true,
          provider: attempt.provider,
        });
      }
      return { value: body.data, model: normalizeModel(body.model, 'provider') };
    },
  });

  return { data: value, meta };
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
  const model = params.model || DEFAULT_CHAT_MODEL;

  const { value, meta } = await runAiTask<ProviderVisionBody>({
    task: 'vision',
    requestedModel: model,
    signal: params.signal,
    execute: async (attempt) => {
      if (attempt.provider === 'gemini') {
        const body = await callGeminiEndpoint<ProviderVisionBody>({
          endpoint: '/api/extract/vision',
          apiKey: attempt.apiKey,
          signal: params.signal,
          payload: {
            imageBase64: params.imageBase64,
            mimeType: params.mimeType,
            mode: params.mode,
            pageNumber: params.pageNumber,
            model,
          },
        });
        return { value: body, model: normalizeModel(body.model, model) };
      }

      const body = await callProviderTask<ProviderVisionBody>({
        provider: providerForAttempt(attempt),
        task: 'vision',
        apiKey: attempt.apiKey,
        signal: params.signal,
        timeoutMs: PROVIDER_VISION_TIMEOUT_MS,
        payload: {
          imageBase64: params.imageBase64,
          mimeType: params.mimeType,
          mode: params.mode,
          pageNumber: params.pageNumber,
        },
      });
      return { value: body, model: normalizeModel(body.model, 'provider') };
    },
  });

  return {
    sections: Array.isArray(value.sections) ? value.sections : [],
    uncertainCount: typeof value.uncertainCount === 'number' ? value.uncertainCount : 0,
    notes: typeof value.notes === 'string' ? value.notes : '',
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
  const { value, meta } = await runAiTask<ProviderTtsBody>({
    task: 'tts',
    requestedModel: 'gemini-3.8-flash-lite-tts',
    signal: params.signal,
    execute: async (attempt) => {
      if (attempt.provider === 'gemini') {
        const body = await callGeminiEndpoint<ProviderTtsBody>({
          endpoint: '/api/ai/tts',
          apiKey: attempt.apiKey,
          signal: params.signal,
          payload: {
            text: params.text,
            voiceName: params.voiceName || 'Kore',
            style: params.style,
          },
        });
        return { value: body, model: normalizeModel(body.model, 'gemini-3.8-flash-lite-tts') };
      }

      // Non-Gemini audio playback fallback (Groq Orpheus TTS)
      const body = await callProviderTask<ProviderTtsBody>({
        provider: providerForAttempt(attempt),
        task: 'tts',
        apiKey: attempt.apiKey,
        payload: {
          text: params.text,
          voiceName: params.voiceName,
        },
        signal: params.signal,
      });
      return { value: body, model: normalizeModel(body.model, `${attempt.provider}-tts`) };
    },
  });

  if (!value.audioBase64) {
    throw new AiServiceError('TTS provider returned no audio data.', 'SERVER_ERROR', {
      retryable: true,
    });
  }

  return {
    audioBase64: value.audioBase64,
    mimeType: value.mimeType || 'audio/wav',
    voiceName: value.voiceName || params.voiceName || 'Kore',
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
  const { value, meta } = await runAiTask<{ text: string }>({
    task: 'transcription',
    requestedModel: 'gemini-3.5-transcribe',
    signal: params.signal,
    execute: async (attempt) => {
      if (attempt.provider === 'gemini') {
        const body = await callGeminiEndpoint<ProviderTranscribeBody>({
          endpoint: '/api/ai/transcribe',
          apiKey: attempt.apiKey,
          signal: params.signal,
          payload: {
            audioBase64: params.audioBase64,
            mimeType: params.mimeType,
            courseContextHint: params.courseContextHint,
          },
        });
        return {
          value: { text: (body.text || '').trim() },
          model: normalizeModel(body.model, 'gemini-3.5-transcribe'),
        };
      }

      // NIM/OpenRouter audio models accept WAV or MP3 only. Browser recordings
      // are WebM/Opus or M4A, so transcode before sending.
      const safeAudio = await toProviderSafeAudio(params.audioBase64, params.mimeType);

      const body = await callProviderTask<ProviderTranscribeBody>({
        provider: providerForAttempt(attempt),
        task: 'transcription',
        apiKey: attempt.apiKey,
        signal: params.signal,
        payload: {
          audioBase64: safeAudio.audioBase64,
          mimeType: safeAudio.mimeType,
          courseContextHint: params.courseContextHint,
        },
      });
      return {
        value: { text: (body.text || '').trim() },
        model: normalizeModel(body.model, 'provider'),
      };
    },
  });

  return { text: value.text, meta };
}

// ---------------------------------------------------------------------------
// Key testing (Gemini)
// ---------------------------------------------------------------------------

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
  const { recordApiKeyFailure, recordApiKeySuccess } = await import('./keyManager');

  const runSingleTest = async (targetModel: string) => {
    try {
      const body = await callGeminiEndpoint<{ ok?: boolean; latencyMs?: number; model?: string }>({
        endpoint: '/api/ai/test-key',
        apiKey: params.rawKey?.trim() || null,
        timeoutMs: 18_000,
        payload: { model: targetModel },
      });
      return {
        ok: true as const,
        keySource: params.rawKey ? ('byok' as const) : ('server_fallback' as const),
        model: body.model || targetModel,
        latencyMs: body.latencyMs ?? 0,
      };
    } catch (err) {
      const error = err instanceof AiServiceError ? err : null;
      return {
        ok: false as const,
        keySource: params.rawKey ? ('byok' as const) : ('server_fallback' as const),
        model: targetModel,
        latencyMs: 0,
        error: error?.message || 'Key test failed.',
        code: (error?.code as AiErrorCode | undefined) || 'INVALID_KEY',
        cooldownMs: error?.cooldownMs ?? 0,
      };
    }
  };

  const initialModel = params.model || DEFAULT_CHAT_MODEL;
  let result = await runSingleTest(initialModel);

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
    if (params.keyId) recordApiKeySuccess(params.keyId);
    return {
      ok: true,
      keySource: result.keySource,
      model: result.model,
      latencyMs: result.latencyMs,
    };
  }

  if (params.keyId) {
    recordApiKeyFailure(
      params.keyId,
      result.code || 'INVALID_KEY',
      result.error || 'Key test failed.',
      'cooldownMs' in result ? result.cooldownMs : 0
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
