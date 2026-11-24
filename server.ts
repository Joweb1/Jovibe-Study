import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSharedProvidersAvailability } from './server/adminKeyPool.ts';
import { hydrateAdminVaultFromFirestore } from './server/adminFirestoreVault.ts';
import { createAdminRouter } from './server/adminRoutes.ts';
import {
  executeProtectedAiRoute,
  extractGeminiTokenUsage,
  extractOpenAiTokenUsage,
} from './server/aiExecution.ts';
import { requireAuth } from './server/auth.ts';
import { sanitizeErrorMessage } from './server/crypto.ts';
import { initDb } from './server/db.ts';
import { attachLiveWebSocketServer } from './server/liveBridge.ts';
import {
  checkSafetyBlock,
  classifyAiError,
  createGeminiClient,
  executeGeminiWithModelFallback,
  extractFinishReason,
  IMAGE_MODEL,
  resolveApiKey,
  resolveModelName,
  resolveTtsVoice,
  TRANSCRIBE_MODEL,
  TTS_MODEL,
  Type,
} from './server/geminiService.ts';
import {
  areServerProviderKeysAllowed,
  extractProviderVision,
  generateProviderImage,
  generateProviderJson,
  generateProviderText,
  isOpenAiProviderId,
  ProviderRequestError,
  resolveProviderKey,
  testProviderConnection,
  transcribeProviderAudio,
  synthesizeProviderSpeech,
  type OpenAiProviderId,
} from './server/openaiProvider.ts';
import { buildVisionPrompt } from './server/prompts.ts';
import { getFeatureFlags } from './server/quotaService.ts';
import { createUserSyncRouter } from './server/userSyncRoutes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/aac',
  'audio/x-m4a',
]);

function resolveProviderParam(value: string): OpenAiProviderId {
  if (!isOpenAiProviderId(value)) {
    throw new ProviderRequestError({
      status: 404,
      code: 'MODEL_UNAVAILABLE',
      message: `Unknown AI provider "${value}".`,
      retryable: false,
      cooldownMs: 0,
    });
  }
  return value;
}

function sendProviderError(
  res: import('express').Response,
  provider: string,
  err: unknown,
  knownSecrets: string[] = []
): void {
  if (err instanceof ProviderRequestError) {
    res.status(err.status).json({
      error: sanitizeErrorMessage(err.message, knownSecrets),
      code: err.code,
      retryable: err.retryable,
      shouldRotateKey:
        err.code === 'INVALID_KEY' ||
        err.code === 'RATE_LIMIT' ||
        err.code === 'QUOTA_EXHAUSTED',
      cooldownMs: err.cooldownMs,
      provider,
    });
    return;
  }

  res.status(500).json({
    error: sanitizeErrorMessage(
      err instanceof Error ? err.message : `${provider} request failed.`,
      knownSecrets
    ),
    code: 'SERVER_ERROR',
    retryable: true,
    shouldRotateKey: false,
    cooldownMs: 5_000,
    provider,
  });
}

export function createApiApp(): express.Express {
  initDb();
  const app = express();

  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    const serverFallbackProviders = getSharedProvidersAvailability();
    const anyFallback = Object.values(serverFallbackProviders).some(Boolean);
    res.json({
      ok: true,
      serverFallbackAvailable: anyFallback,
      serverFallbackProviders,
      visionConfigured:
        serverFallbackProviders.gemini ||
        serverFallbackProviders.nvidia_nim ||
        serverFallbackProviders.openrouter,
      serverProviderKeysEnabled: areServerProviderKeysAllowed(),
      supportedProviders: ['gemini', 'openrouter', 'cerebras', 'groq', 'cloudflare', 'nvidia_nim'],
      featureFlags: getFeatureFlags(),
    });
  });

  // Admin Dashboard & Management API (strictly protected by sole ADMIN_EMAIL verification)
  app.use('/api/admin', createAdminRouter());

  // User Access Status, Sync, Activity, and Group Study Notes/Reports API
  app.use('/api', createUserSyncRouter());

  // Test a personal BYOK Gemini key (does not consume shared user quota)
  app.post('/api/ai/test-key', requireAuth, async (req, res) => {
    const startMs = Date.now();
    const rawHeader = Array.isArray(req.headers['x-sotal-gemini-key'])
      ? req.headers['x-sotal-gemini-key'][0]
      : req.headers['x-sotal-gemini-key'];
    const trimmedByok = typeof rawHeader === 'string' ? rawHeader.trim() : '';

    if (trimmedByok) {
      try {
        const requestedModel = resolveModelName(req.body?.model);
        const ai = createGeminiClient(trimmedByok);
        const { result: response, model, switchedFromModel } = await executeGeminiWithModelFallback({
          primaryModel: requestedModel,
          task: 'text',
          run: (activeModel) =>
            ai.models.generateContent({
              model: activeModel,
              contents: 'Reply with the single word OK.',
            }),
        });
        checkSafetyBlock(response);
        const text = (response.text ?? '').trim();
        res.json({
          ok: true,
          keySource: 'byok',
          model,
          ...(switchedFromModel ? { switchedFromModel } : {}),
          latencyMs: Date.now() - startMs,
          sampleReply: text.slice(0, 40),
        });
      } catch (err) {
        const classified = classifyAiError(err, 'byok');
        res.status(classified.status).json({
          ok: false,
          error: sanitizeErrorMessage(classified.message, [trimmedByok]),
          code: classified.code,
          retryable: classified.retryable,
          shouldRotateKey: classified.shouldRotateKey,
          cooldownMs: classified.cooldownMs,
          keySource: 'byok',
        });
      }
      return;
    }

    // If testing without a personal key, still enforce shared-key eligibility & admin key pool
    try {
      const resolved = resolveApiKey(undefined, req.headers['x-sotal-byok-only']);
      const requestedModel = resolveModelName(req.body?.model);
      const ai = createGeminiClient(resolved.apiKey);
      const { result: response, model, switchedFromModel } = await executeGeminiWithModelFallback({
        primaryModel: requestedModel,
        task: 'text',
        run: (activeModel) =>
          ai.models.generateContent({
            model: activeModel,
            contents: 'Reply with the single word OK.',
          }),
      });
      checkSafetyBlock(response);
      res.json({
        ok: true,
        keySource: 'server_fallback',
        model,
        ...(switchedFromModel ? { switchedFromModel } : {}),
        latencyMs: Date.now() - startMs,
        sampleReply: (response.text ?? '').trim().slice(0, 40),
      });
    } catch (err) {
      const classified = classifyAiError(err, 'server_fallback');
      res.status(classified.status).json({
        ok: false,
        error: sanitizeErrorMessage(classified.message),
        code: classified.code,
        retryable: classified.retryable,
        shouldRotateKey: classified.shouldRotateKey,
        cooldownMs: classified.cooldownMs,
        keySource: 'server_fallback',
      });
    }
  });

  // Modular text / conversation generation route
  app.post('/api/ai/generate', requireAuth, async (req, res) => {
    const { prompt, messages, systemInstruction, model: requestedModel } = req.body ?? {};
    const model = resolveModelName(requestedModel);

    let contents: unknown;
    if (Array.isArray(messages) && messages.length > 0) {
      contents = messages
        .filter(
          (m): m is { role: string; text: string } =>
            Boolean(m) && typeof m.text === 'string' && m.text.trim().length > 0
        )
        .map((m) => ({
          role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
          parts: [{ text: m.text }],
        }));
    } else if (typeof prompt === 'string' && prompt.trim().length > 0) {
      contents = prompt;
    } else {
      res.status(400).json({
        error: 'Either prompt or non-empty messages array is required.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
      });
      return;
    }

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider: 'gemini',
      task: 'chat',
      keyHeaderName: 'x-sotal-gemini-key',
      run: async (ctx) => {
        const ai = createGeminiClient(ctx.apiKey);
        const { result: response, model: actualModel, switchedFromModel } =
          await executeGeminiWithModelFallback({
            primaryModel: model,
            task: 'text',
            run: (activeModel) =>
              ai.models.generateContent({
                model: activeModel,
                contents: contents as string,
                config:
                  typeof systemInstruction === 'string' && systemInstruction.trim()
                    ? { systemInstruction: systemInstruction.trim() }
                    : undefined,
              }),
          });
        checkSafetyBlock(response);
        const text = (response.text ?? '').trim();
        return {
          payload: { text, finishReason: extractFinishReason(response) },
          model: actualModel,
          switchedFromModel,
          tokens: extractGeminiTokenUsage(response),
        };
      },
    });

    if (!executed) return;
    res.json({
      text: executed.result.payload.text,
      model: executed.result.model,
      ...(executed.result.switchedFromModel
        ? { switchedFromModel: executed.result.switchedFromModel }
        : {}),
      keySource: executed.keySource,
      finishReason: executed.result.payload.finishReason,
      quota: executed.quota,
    });
  });

  // Modular structured JSON output route with schema enforcement
  app.post('/api/ai/generate-json', requireAuth, async (req, res) => {
    const { prompt, systemInstruction, responseSchema, model: requestedModel } = req.body ?? {};
    const model = resolveModelName(requestedModel);

    if (typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({
        error: 'A non-empty prompt is required for structured generation.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
      });
      return;
    }

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider: 'gemini',
      task: 'structured_json',
      keyHeaderName: 'x-sotal-gemini-key',
      run: async (ctx) => {
        const ai = createGeminiClient(ctx.apiKey);
        const config: Record<string, unknown> = {
          responseMimeType: 'application/json',
        };
        if (typeof systemInstruction === 'string' && systemInstruction.trim()) {
          config.systemInstruction = systemInstruction.trim();
        }
        if (responseSchema && typeof responseSchema === 'object') {
          config.responseSchema = responseSchema;
        }

        const { result: response, model: actualModel, switchedFromModel } =
          await executeGeminiWithModelFallback({
            primaryModel: model,
            task: 'text',
            run: (activeModel) =>
              ai.models.generateContent({
                model: activeModel,
                contents: prompt,
                config,
              }),
          });

        checkSafetyBlock(response);
        const rawText = (response.text ?? '').trim();
        if (!rawText) {
          throw new ProviderRequestError({
            status: 502,
            code: 'SERVER_ERROR',
            message: 'Gemini returned an empty structured response.',
            retryable: true,
            cooldownMs: 5000,
          });
        }

        let data: unknown;
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new ProviderRequestError({
            status: 502,
            code: 'SERVER_ERROR',
            message: 'Gemini returned malformed JSON that failed parsing.',
            retryable: true,
            cooldownMs: 2000,
          });
        }

        return {
          payload: { data, rawText, finishReason: extractFinishReason(response) },
          model: actualModel,
          switchedFromModel,
          tokens: extractGeminiTokenUsage(response),
        };
      },
    });

    if (!executed) return;
    res.json({
      data: executed.result.payload.data,
      rawText: executed.result.payload.rawText,
      model: executed.result.model,
      ...(executed.result.switchedFromModel
        ? { switchedFromModel: executed.result.switchedFromModel }
        : {}),
      keySource: executed.keySource,
      finishReason: executed.result.payload.finishReason,
      quota: executed.quota,
    });
  });

  // Multimodal Vision OCR & Handwriting Extraction
  app.post('/api/extract/vision', requireAuth, async (req, res) => {
    const { imageBase64, mimeType, mode = 'textbook_photo', pageNumber, model: requestedModel } =
      req.body ?? {};

    if (typeof imageBase64 !== 'string' || imageBase64.length < 20) {
      res.status(400).json({
        error: 'Missing or invalid image payload.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
      });
      return;
    }

    if (imageBase64.length > 14_000_000) {
      res.status(413).json({
        error: 'Image is too large. Please resize or crop before uploading.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
      });
      return;
    }

    const normalizedMime =
      typeof mimeType === 'string' && ALLOWED_IMAGE_MIMES.has(mimeType.toLowerCase())
        ? mimeType.toLowerCase() === 'image/jpg'
          ? 'image/jpeg'
          : mimeType.toLowerCase()
        : 'image/jpeg';

    const model = resolveModelName(requestedModel);
    const prompt = buildVisionPrompt(
      String(mode),
      typeof pageNumber === 'number' ? pageNumber : undefined
    );

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider: 'gemini',
      task: 'vision',
      keyHeaderName: 'x-sotal-gemini-key',
      run: async (ctx) => {
        const ai = createGeminiClient(ctx.apiKey);
        const { result: response, model: actualModel, switchedFromModel } =
          await executeGeminiWithModelFallback({
            primaryModel: model,
            task: 'text',
            run: (activeModel) =>
              ai.models.generateContent({
                model: activeModel,
                contents: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: normalizedMime,
                        data: imageBase64,
                      },
                    },
                    { text: prompt },
                  ],
                },
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      sections: {
                        type: Type.ARRAY,
                        description: 'Ordered structured sections extracted from the image.',
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            heading: { type: Type.STRING },
                            level: { type: Type.INTEGER },
                            content: { type: Type.STRING },
                          },
                          required: ['heading', 'level', 'content'],
                        },
                      },
                      uncertainCount: { type: Type.INTEGER },
                      notes: { type: Type.STRING },
                    },
                    required: ['sections', 'uncertainCount', 'notes'],
                  },
                },
              }),
          });

        checkSafetyBlock(response);
        const rawJson = (response.text ?? '').trim();
        if (!rawJson) {
          throw new ProviderRequestError({
            status: 502,
            code: 'SERVER_ERROR',
            message: 'Vision model returned an empty response.',
            retryable: true,
            cooldownMs: 5000,
          });
        }

        const parsed = JSON.parse(rawJson) as {
          sections?: Array<{ heading?: string; level?: number; content?: string }>;
          uncertainCount?: number;
          notes?: string;
        };

        const sections = Array.isArray(parsed.sections)
          ? parsed.sections
              .filter((s) => s && typeof s.content === 'string' && s.content.trim().length > 0)
              .map((s, idx) => ({
                heading:
                  typeof s.heading === 'string' && s.heading.trim()
                    ? s.heading.trim()
                    : pageNumber
                    ? `Page ${pageNumber}`
                    : `Section ${idx + 1}`,
                level: typeof s.level === 'number' && s.level >= 1 && s.level <= 3 ? s.level : 2,
                content: (s.content ?? '').trim(),
                ...(typeof pageNumber === 'number' ? { pageOrSlide: pageNumber } : {}),
              }))
          : [];

        return {
          payload: {
            sections,
            uncertainCount: typeof parsed.uncertainCount === 'number' ? parsed.uncertainCount : 0,
            notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : '',
          },
          model: actualModel,
          switchedFromModel,
          tokens: extractGeminiTokenUsage(response),
        };
      },
    });

    if (!executed) return;
    res.json({
      ...executed.result.payload,
      keySource: executed.keySource,
      model: executed.result.model,
      ...(executed.result.switchedFromModel
        ? { switchedFromModel: executed.result.switchedFromModel }
        : {}),
      quota: executed.quota,
    });
  });

  // Gemini Text-to-Speech
  app.post('/api/ai/tts', requireAuth, async (req, res) => {
    const { text, voiceName: requestedVoice, style, model: requestedModel } = req.body ?? {};

    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({
        error: 'Non-empty text is required for speech generation.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
      });
      return;
    }

    const cleanText = text.trim().slice(0, 3500);
    const voiceName = resolveTtsVoice(requestedVoice);
    const primaryTtsModel = resolveModelName(requestedModel, TTS_MODEL);
    const speechStyle =
      typeof style === 'string' && style.trim()
        ? style.trim().slice(0, 160)
        : 'Clear, calm, articulate academic tutor';

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider: 'gemini',
      task: 'tts',
      keyHeaderName: 'x-sotal-gemini-key',
      run: async (ctx) => {
        const ai = createGeminiClient(ctx.apiKey, 'v1beta');
        const { result: response, model: actualModel, switchedFromModel } =
          await executeGeminiWithModelFallback({
            primaryModel: primaryTtsModel,
            task: 'tts',
            run: (activeModel) =>
              ai.models.generateContent({
                model: activeModel,
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: cleanText,
                        speechMetadata: { style: speechStyle },
                      } as Record<string, unknown>,
                    ],
                  },
                ],
                config: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName },
                    },
                  },
                },
              }),
          });

        checkSafetyBlock(response);
        const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        const audioBase64 = inlineData?.data;
        const mimeType = inlineData?.mimeType || 'audio/wav';

        if (!audioBase64) {
          throw new ProviderRequestError({
            status: 502,
            code: 'SERVER_ERROR',
            message: 'Gemini TTS returned no audio payload.',
            retryable: true,
            cooldownMs: 5000,
          });
        }

        return {
          payload: { audioBase64, mimeType, voiceName },
          model: actualModel,
          switchedFromModel,
          tokens: extractGeminiTokenUsage(response),
        };
      },
    });

    if (!executed) return;
    res.json({
      ...executed.result.payload,
      model: executed.result.model,
      ...(executed.result.switchedFromModel
        ? { switchedFromModel: executed.result.switchedFromModel }
        : {}),
      keySource: executed.keySource,
      quota: executed.quota,
    });
  });

  // Gemini Concept Infographic / Illustrative Image Generation
  app.post('/api/ai/generate-image', requireAuth, async (req, res) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const primaryImageModel = resolveModelName(req.body?.model, IMAGE_MODEL);

    if (!prompt) {
      res.status(400).json({
        error: 'A non-empty visual prompt is required for image generation.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
      });
      return;
    }

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider: 'gemini',
      task: 'image_generation',
      keyHeaderName: 'x-sotal-gemini-key',
      run: async (ctx) => {
        const ai = createGeminiClient(ctx.apiKey, 'v1beta');
        const { result: response, model: actualModel, switchedFromModel } =
          await executeGeminiWithModelFallback({
            primaryModel: primaryImageModel,
            task: 'image',
            run: (activeModel) =>
              ai.models.generateContent({
                model: activeModel,
                contents: prompt.slice(0, 1600),
                config: { responseModalities: ['IMAGE'] },
              }),
          });

        checkSafetyBlock(response);
        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const imgPart = parts.find(
          (p) => p && typeof p === 'object' && p.inlineData && typeof p.inlineData.data === 'string'
        );
        const imageBase64 = imgPart?.inlineData?.data;
        const mimeType = imgPart?.inlineData?.mimeType || 'image/png';

        if (!imageBase64) {
          throw new ProviderRequestError({
            status: 502,
            code: 'SERVER_ERROR',
            message: 'Gemini returned no image data for this prompt.',
            retryable: true,
            cooldownMs: 5000,
          });
        }

        return {
          payload: { imageBase64, mimeType },
          model: actualModel,
          switchedFromModel,
          tokens: extractGeminiTokenUsage(response),
        };
      },
    });

    if (!executed) return;
    res.json({
      ...executed.result.payload,
      model: executed.result.model,
      ...(executed.result.switchedFromModel
        ? { switchedFromModel: executed.result.switchedFromModel }
        : {}),
      keySource: executed.keySource,
      quota: executed.quota,
    });
  });

  // Gemini Voice Note Transcription
  app.post('/api/ai/transcribe', requireAuth, async (req, res) => {
    const { audioBase64, mimeType, courseContextHint, model: requestedModel } = req.body ?? {};
    const primaryTranscribeModel = resolveModelName(requestedModel, TRANSCRIBE_MODEL);

    if (typeof audioBase64 !== 'string' || audioBase64.length < 40) {
      res.status(400).json({
        error: 'Missing or invalid audio recording payload.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
      });
      return;
    }

    if (audioBase64.length > 14_000_000) {
      res.status(413).json({
        error: 'Audio note is too large. Please keep voice notes under 2 minutes.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
      });
      return;
    }

    const rawMime =
      typeof mimeType === 'string' ? mimeType.split(';')[0].toLowerCase().trim() : 'audio/webm';
    const normalizedMime = ALLOWED_AUDIO_MIMES.has(rawMime) ? rawMime : 'audio/webm';
    const hint =
      typeof courseContextHint === 'string' && courseContextHint.trim()
        ? ` Academic course context for accurate terminology spelling: ${courseContextHint.trim().slice(0, 200)}.`
        : '';

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider: 'gemini',
      task: 'transcription',
      keyHeaderName: 'x-sotal-gemini-key',
      run: async (ctx) => {
        const ai = createGeminiClient(ctx.apiKey, 'v1beta');
        const { result: response, model: actualModel, switchedFromModel } =
          await executeGeminiWithModelFallback({
            primaryModel: primaryTranscribeModel,
            task: 'transcribe',
            run: (activeModel) =>
              ai.models.generateContent({
                model: activeModel,
                contents: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: normalizedMime,
                        data: audioBase64,
                      },
                    },
                    {
                      text: `Transcribe this student voice note accurately into clean text with proper punctuation. Return only the transcription text without commentary.${hint}`,
                    },
                  ],
                },
              }),
          });
        checkSafetyBlock(response);
        return {
          payload: { text: (response.text ?? '').trim() },
          model: actualModel,
          switchedFromModel,
          tokens: extractGeminiTokenUsage(response),
        };
      },
    });

    if (!executed) return;
    res.json({
      text: executed.result.payload.text,
      model: executed.result.model,
      ...(executed.result.switchedFromModel
        ? { switchedFromModel: executed.result.switchedFromModel }
        : {}),
      keySource: executed.keySource,
      quota: executed.quota,
    });
  });

  // ---------------------------------------------------------------------------
  // OpenAI-compatible provider proxy (OpenRouter / Cerebras / Groq / Cloudflare / NIM)
  // ---------------------------------------------------------------------------
  app.post('/api/providers/:provider/test-key', requireAuth, async (req, res) => {
    let provider: OpenAiProviderId | null = null;
    const rawKey = Array.isArray(req.headers['x-sotal-provider-key'])
      ? req.headers['x-sotal-provider-key'][0]
      : req.headers['x-sotal-provider-key'];
    const trimmedKey = typeof rawKey === 'string' ? rawKey.trim() : '';
    try {
      provider = resolveProviderParam(req.params.provider);
      const resolved = resolveProviderKey(
        provider,
        trimmedKey || undefined,
        req.headers['x-sotal-byok-only']
      );
      const result = await testProviderConnection({ provider, apiKey: resolved.apiKey });
      res.json({
        ok: true,
        provider,
        keySource: resolved.keySource,
        model: result.model,
        latencyMs: result.latencyMs,
      });
    } catch (err) {
      sendProviderError(res, provider ?? req.params.provider, err, trimmedKey ? [trimmedKey] : []);
    }
  });

  app.post('/api/providers/:provider/generate', requireAuth, async (req, res) => {
    let provider: OpenAiProviderId;
    try {
      provider = resolveProviderParam(req.params.provider);
    } catch (err) {
      sendProviderError(res, req.params.provider, err);
      return;
    }

    const { prompt, messages, systemInstruction, model } = req.body ?? {};
    if (
      (typeof prompt !== 'string' || !prompt.trim()) &&
      (!Array.isArray(messages) || messages.length === 0)
    ) {
      res.status(400).json({
        error: 'Either prompt or non-empty messages array is required.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
        provider,
      });
      return;
    }

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider,
      task: 'chat',
      keyHeaderName: 'x-sotal-provider-key',
      run: async (ctx) => {
        const result = await generateProviderText({
          provider,
          apiKey: ctx.apiKey,
          prompt,
          messages,
          systemInstruction,
          model,
        });
        return {
          payload: { text: result.text, finishReason: result.finishReason },
          model: result.model,
          tokens: extractOpenAiTokenUsage(result.usage),
        };
      },
    });

    if (!executed) return;
    res.json({
      text: executed.result.payload.text,
      model: executed.result.model,
      provider,
      keySource: executed.keySource,
      finishReason: executed.result.payload.finishReason,
      quota: executed.quota,
    });
  });

  app.post('/api/providers/:provider/generate-json', requireAuth, async (req, res) => {
    let provider: OpenAiProviderId;
    try {
      provider = resolveProviderParam(req.params.provider);
    } catch (err) {
      sendProviderError(res, req.params.provider, err);
      return;
    }

    const { prompt, systemInstruction, responseSchema, model } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({
        error: 'A non-empty prompt is required for structured generation.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
        provider,
      });
      return;
    }

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider,
      task: 'structured_json',
      keyHeaderName: 'x-sotal-provider-key',
      run: async (ctx) => {
        const result = await generateProviderJson({
          provider,
          apiKey: ctx.apiKey,
          prompt,
          systemInstruction:
            typeof systemInstruction === 'string' ? systemInstruction : undefined,
          responseSchema:
            responseSchema && typeof responseSchema === 'object'
              ? (responseSchema as Record<string, unknown>)
              : undefined,
          model: typeof model === 'string' ? model : undefined,
        });
        return {
          payload: { data: result.data, rawText: result.rawText },
          model: result.model,
          tokens: extractOpenAiTokenUsage(result.usage),
        };
      },
    });

    if (!executed) return;
    res.json({
      data: executed.result.payload.data,
      rawText: executed.result.payload.rawText,
      model: executed.result.model,
      provider,
      keySource: executed.keySource,
      quota: executed.quota,
    });
  });

  app.post('/api/providers/:provider/vision', requireAuth, async (req, res) => {
    let provider: OpenAiProviderId;
    try {
      provider = resolveProviderParam(req.params.provider);
    } catch (err) {
      sendProviderError(res, req.params.provider, err);
      return;
    }

    const { imageBase64, mimeType, mode = 'textbook_photo', pageNumber, model } = req.body ?? {};
    if (typeof imageBase64 !== 'string' || imageBase64.length < 20) {
      res.status(400).json({
        error: 'Missing or invalid image payload.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
        provider,
      });
      return;
    }

    if (imageBase64.length > 14_000_000) {
      res.status(413).json({
        error: 'Image is too large. Please resize or crop before uploading.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
        provider,
      });
      return;
    }

    const normalizedMime =
      typeof mimeType === 'string' && ALLOWED_IMAGE_MIMES.has(mimeType.toLowerCase())
        ? mimeType.toLowerCase() === 'image/jpg'
          ? 'image/jpeg'
          : mimeType.toLowerCase()
        : 'image/jpeg';

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider,
      task: 'vision',
      keyHeaderName: 'x-sotal-provider-key',
      run: async (ctx) => {
        const result = await extractProviderVision({
          provider,
          apiKey: ctx.apiKey,
          imageBase64,
          mimeType: normalizedMime,
          mode: String(mode),
          pageNumber: typeof pageNumber === 'number' ? pageNumber : undefined,
          model: typeof model === 'string' ? model : undefined,
        });
        return {
          payload: {
            sections: result.sections,
            uncertainCount: result.uncertainCount,
            notes: result.notes,
          },
          model: result.model,
          tokens: extractOpenAiTokenUsage(result.usage),
        };
      },
    });

    if (!executed) return;
    res.json({
      ...executed.result.payload,
      model: executed.result.model,
      provider,
      keySource: executed.keySource,
      quota: executed.quota,
    });
  });

  app.post('/api/providers/:provider/transcribe', requireAuth, async (req, res) => {
    let provider: OpenAiProviderId;
    try {
      provider = resolveProviderParam(req.params.provider);
    } catch (err) {
      sendProviderError(res, req.params.provider, err);
      return;
    }

    const { audioBase64, mimeType, courseContextHint, model } = req.body ?? {};
    if (typeof audioBase64 !== 'string' || audioBase64.length < 40) {
      res.status(400).json({
        error: 'Missing or invalid audio recording payload.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
        provider,
      });
      return;
    }

    if (audioBase64.length > 14_000_000) {
      res.status(413).json({
        error: 'Audio note is too large. Please keep voice notes under 2 minutes.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
        provider,
      });
      return;
    }

    const rawMime =
      typeof mimeType === 'string' ? mimeType.split(';')[0].toLowerCase().trim() : 'audio/wav';

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider,
      task: 'transcription',
      keyHeaderName: 'x-sotal-provider-key',
      run: async (ctx) => {
        const result = await transcribeProviderAudio({
          provider,
          apiKey: ctx.apiKey,
          audioBase64,
          mimeType: rawMime,
          courseContextHint:
            typeof courseContextHint === 'string' ? courseContextHint : undefined,
          model: typeof model === 'string' ? model : undefined,
        });
        return {
          payload: { text: result.text },
          model: result.model,
        };
      },
    });

    if (!executed) return;
    res.json({
      text: executed.result.payload.text,
      model: executed.result.model,
      provider,
      keySource: executed.keySource,
      quota: executed.quota,
    });
  });

  app.post('/api/providers/:provider/tts', requireAuth, async (req, res) => {
    let provider: OpenAiProviderId;
    try {
      provider = resolveProviderParam(req.params.provider);
    } catch (err) {
      sendProviderError(res, req.params.provider, err);
      return;
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      res.status(400).json({
        error: 'A non-empty text string is required for speech synthesis.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
        provider,
      });
      return;
    }

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider,
      task: 'tts',
      keyHeaderName: 'x-sotal-provider-key',
      run: async (ctx) => {
        const result = await synthesizeProviderSpeech({
          provider,
          apiKey: ctx.apiKey,
          text,
          voiceName: typeof req.body?.voiceName === 'string' ? req.body.voiceName : undefined,
          model: typeof req.body?.model === 'string' ? req.body.model : undefined,
        });
        return {
          payload: {
            audioBase64: result.audioBase64,
            mimeType: result.mimeType,
            voiceName: result.voiceName,
          },
          model: result.model,
        };
      },
    });

    if (!executed) return;
    res.json({
      ...executed.result.payload,
      model: executed.result.model,
      provider,
      keySource: executed.keySource,
      quota: executed.quota,
    });
  });

  app.post('/api/providers/:provider/generate-image', requireAuth, async (req, res) => {
    let provider: OpenAiProviderId;
    try {
      provider = resolveProviderParam(req.params.provider);
    } catch (err) {
      sendProviderError(res, req.params.provider, err);
      return;
    }

    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      res.status(400).json({
        error: 'A non-empty visual prompt is required for image generation.',
        code: 'INVALID_REQUEST',
        retryable: false,
        shouldRotateKey: false,
        cooldownMs: 0,
        provider,
      });
      return;
    }

    const executed = await executeProtectedAiRoute({
      req,
      res,
      provider,
      task: 'image_generation',
      keyHeaderName: 'x-sotal-provider-key',
      run: async (ctx) => {
        const result = await generateProviderImage({
          provider,
          apiKey: ctx.apiKey,
          prompt,
          aspectRatio: typeof req.body?.aspectRatio === 'string' ? req.body.aspectRatio : undefined,
          model: typeof req.body?.model === 'string' ? req.body.model : undefined,
        });
        return {
          payload: { imageBase64: result.imageBase64, mimeType: result.mimeType },
          model: result.model,
        };
      },
    });

    if (!executed) return;
    res.json({
      ...executed.result.payload,
      model: executed.result.model,
      provider,
      keySource: executed.keySource,
      quota: executed.quota,
    });
  });

  return app;
}

async function startServer() {
  const app = createApiApp();

  // Restore encrypted Admin API keys & platform settings from Firestore on cold start
  // (runs automatically when FIREBASE_SERVICE_ACCOUNT_JSON is configured).
  try {
    const vaultStatus = await hydrateAdminVaultFromFirestore({ force: true });
    if (vaultStatus.persistentBackend === 'firestore_service_account') {
      console.log(
        `[Admin Vault] Restored ${vaultStatus.hydratedKeyCount} admin key(s) from Firestore.`
      );
    }
    if (vaultStatus.warning) {
      console.warn(`[Admin Vault] ${vaultStatus.warning}`);
    }
  } catch (err) {
    console.warn(
      '[Admin Vault] Startup Firestore hydration skipped:',
      err instanceof Error ? err.message : String(err)
    );
  }

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    const viteClientShim = `
const sheetsMap = new Map();
let lastInsertedStyle;

export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement('afterend', style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}

export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}

const dataMap = new Map();
export function createHotContext(ownerPath) {
  if (!dataMap.has(ownerPath)) dataMap.set(ownerPath, {});
  return {
    get data() { return dataMap.get(ownerPath); },
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}

export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}

export class ErrorOverlay extends HTMLElement {}
`.trim();

    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(viteClientShim);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const NO_CACHE_FILES = new Set([
      '/index.html',
      '/sw.js',
      '/registerSW.js',
      '/manifest.webmanifest',
    ]);
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          const rel = '/' + path.relative(distDir, filePath).replace(/\\/g, '/');
          if (NO_CACHE_FILES.has(rel) || rel.endsWith('.webmanifest')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  const httpServer = http.createServer(app);
  attachLiveWebSocketServer(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Jovibe Study server listening on http://0.0.0.0:${PORT}`);
  });
}

// Only start listening when executed directly as entrypoint (not when imported by tests)
const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectEntry) {
  void startServer();
}
