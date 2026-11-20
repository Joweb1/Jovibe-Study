import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  checkSafetyBlock,
  classifyAiError,
  createGeminiClient,
  extractFinishReason,
  resolveApiKey,
  resolveModelName,
  resolveTtsVoice,
  TRANSCRIBE_MODEL,
  TTS_MODEL,
  Type,
} from './server/geminiService.ts';

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

function buildVisionPrompt(mode: string, pageNumber?: number): string {
  const pageHint = pageNumber ? `This image is Page ${pageNumber} of a document.` : '';

  if (mode === 'handwriting') {
    return [
      'You are an academic document transcription assistant specializing in handwritten study notes.',
      pageHint,
      'Transcribe the handwritten notes accurately while preserving structure: headings, subheadings, numbered or bulleted lists, definitions, formulas, examples, and tables (in Markdown format).',
      'CRITICAL ACCURACY RULE: If any word, symbol, or phrase is unclear, smudged, or ambiguous, DO NOT invent or guess confidently. Mark uncertain words inline as [unclear: best guess] or [illegible] if unreadable.',
      'Return structured JSON matching the schema. Set uncertainCount to the exact number of [unclear: ...] or [illegible] markers included in your output.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return [
    'You are an academic OCR and document structuring assistant.',
    pageHint,
    'Extract all readable academic text from this textbook page or scanned document while faithfully preserving headings, subheadings, paragraphs, bullet lists, definitions, worked examples, and tables (formatted cleanly in Markdown).',
    'Omit decorative page headers/footers unless they carry meaningful section or page context.',
    'If any text is cut off, blurred, or unreadable, mark it explicitly as [unclear: best guess] or [illegible] rather than inventing content, and count those markers in uncertainCount.',
    'Return structured JSON matching the schema.',
  ]
    .filter(Boolean)
    .join(' ');
}

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      serverFallbackAvailable: Boolean((process.env.GEMINI_API_KEY || '').trim()),
      visionConfigured: Boolean((process.env.GEMINI_API_KEY || '').trim()),
    });
  });

  // Test a BYOK key (passed in x-sotal-gemini-key header) or server fallback key
  app.post('/api/ai/test-key', async (req, res) => {
    const startMs = Date.now();
    let keySource: 'byok' | 'server_fallback' = 'server_fallback';
    try {
      const resolved = resolveApiKey(req.headers['x-sotal-gemini-key']);
      keySource = resolved.keySource;
      const model = resolveModelName(req.body?.model);
      const ai = createGeminiClient(resolved.apiKey);

      const response = await ai.models.generateContent({
        model,
        contents: 'Reply with the single word OK.',
      });

      checkSafetyBlock(response);
      const text = (response.text ?? '').trim();

      res.json({
        ok: true,
        keySource,
        model,
        latencyMs: Date.now() - startMs,
        sampleReply: text.slice(0, 40),
      });
    } catch (err) {
      const classified = classifyAiError(err, keySource);
      res.status(classified.status).json({
        ok: false,
        error: classified.message,
        code: classified.code,
        retryable: classified.retryable,
        shouldRotateKey: classified.shouldRotateKey,
        cooldownMs: classified.cooldownMs,
        keySource,
      });
    }
  });

  // Modular text / conversation generation route
  app.post('/api/ai/generate', async (req, res) => {
    let keySource: 'byok' | 'server_fallback' = 'server_fallback';
    try {
      const resolved = resolveApiKey(req.headers['x-sotal-gemini-key']);
      keySource = resolved.keySource;
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

      const ai = createGeminiClient(resolved.apiKey);
      const response = await ai.models.generateContent({
        model,
        contents: contents as string,
        config:
          typeof systemInstruction === 'string' && systemInstruction.trim()
            ? { systemInstruction: systemInstruction.trim() }
            : undefined,
      });

      checkSafetyBlock(response);
      const text = (response.text ?? '').trim();

      res.json({
        text,
        model,
        keySource,
        finishReason: extractFinishReason(response),
      });
    } catch (err) {
      const classified = classifyAiError(err, keySource);
      res.status(classified.status).json({
        error: classified.message,
        code: classified.code,
        retryable: classified.retryable,
        shouldRotateKey: classified.shouldRotateKey,
        cooldownMs: classified.cooldownMs,
        keySource,
      });
    }
  });

  // Modular structured JSON output route with schema enforcement
  app.post('/api/ai/generate-json', async (req, res) => {
    let keySource: 'byok' | 'server_fallback' = 'server_fallback';
    try {
      const resolved = resolveApiKey(req.headers['x-sotal-gemini-key']);
      keySource = resolved.keySource;
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

      const ai = createGeminiClient(resolved.apiKey);
      const config: Record<string, unknown> = {
        responseMimeType: 'application/json',
      };
      if (typeof systemInstruction === 'string' && systemInstruction.trim()) {
        config.systemInstruction = systemInstruction.trim();
      }
      if (responseSchema && typeof responseSchema === 'object') {
        config.responseSchema = responseSchema;
      }

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config,
      });

      checkSafetyBlock(response);
      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({
          error: 'Gemini returned an empty structured response.',
          code: 'SERVER_ERROR',
          retryable: true,
          shouldRotateKey: false,
          cooldownMs: 5000,
          keySource,
        });
        return;
      }

      let data: unknown;
      try {
        data = JSON.parse(rawText);
      } catch {
        res.status(502).json({
          error: 'Gemini returned malformed JSON that failed parsing.',
          code: 'SERVER_ERROR',
          retryable: true,
          shouldRotateKey: false,
          cooldownMs: 2000,
          keySource,
        });
        return;
      }

      res.json({
        data,
        rawText,
        model,
        keySource,
        finishReason: extractFinishReason(response),
      });
    } catch (err) {
      const classified = classifyAiError(err, keySource);
      res.status(classified.status).json({
        error: classified.message,
        code: classified.code,
        retryable: classified.retryable,
        shouldRotateKey: classified.shouldRotateKey,
        cooldownMs: classified.cooldownMs,
        keySource,
      });
    }
  });

  // Multimodal Vision OCR & Handwriting Extraction (BYOK-first, server fallback)
  app.post('/api/extract/vision', async (req, res) => {
    let keySource: 'byok' | 'server_fallback' = 'server_fallback';
    try {
      const resolved = resolveApiKey(req.headers['x-sotal-gemini-key']);
      keySource = resolved.keySource;
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
      const ai = createGeminiClient(resolved.apiKey);
      const prompt = buildVisionPrompt(
        String(mode),
        typeof pageNumber === 'number' ? pageNumber : undefined
      );

      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: normalizedMime,
                data: imageBase64,
              },
            },
            {
              text: prompt,
            },
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
                    heading: {
                      type: Type.STRING,
                      description: 'Section heading or concise topic label.',
                    },
                    level: {
                      type: Type.INTEGER,
                      description: 'Heading level (1 for main heading, 2 for subheading, 3 for minor heading).',
                    },
                    content: {
                      type: Type.STRING,
                      description:
                        'Formatted text content preserving paragraphs, lists, definitions, examples, and markdown tables.',
                    },
                  },
                  required: ['heading', 'level', 'content'],
                },
              },
              uncertainCount: {
                type: Type.INTEGER,
                description: 'Count of [unclear: ...] or [illegible] markers in the extracted text.',
              },
              notes: {
                type: Type.STRING,
                description: 'Brief quality note if applicable, otherwise empty string.',
              },
            },
            required: ['sections', 'uncertainCount', 'notes'],
          },
        },
      });

      checkSafetyBlock(response);
      const rawJson = (response.text ?? '').trim();
      if (!rawJson) {
        res.status(502).json({
          error: 'Vision model returned an empty response.',
          code: 'SERVER_ERROR',
          retryable: true,
          shouldRotateKey: false,
          cooldownMs: 5000,
          keySource,
        });
        return;
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

      res.json({
        sections,
        uncertainCount: typeof parsed.uncertainCount === 'number' ? parsed.uncertainCount : 0,
        notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : '',
        keySource,
        model,
      });
    } catch (err) {
      const classified = classifyAiError(err, keySource);
      res.status(classified.status).json({
        error: classified.message,
        code: classified.code,
        retryable: classified.retryable,
        shouldRotateKey: classified.shouldRotateKey,
        cooldownMs: classified.cooldownMs,
        keySource,
      });
    }
  });

  // Gemini 3.8 Flash Lite Text-to-Speech (BYOK-first, server GEMINI_API_KEY fallback)
  app.post('/api/ai/tts', async (req, res) => {
    let keySource: 'byok' | 'server_fallback' = 'server_fallback';
    try {
      const resolved = resolveApiKey(req.headers['x-sotal-gemini-key']);
      keySource = resolved.keySource;
      const { text, voiceName: requestedVoice, style } = req.body ?? {};

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
      const speechStyle =
        typeof style === 'string' && style.trim()
          ? style.trim().slice(0, 160)
          : 'Clear, calm, articulate academic tutor';

      const ai = createGeminiClient(resolved.apiKey, 'v1beta');
      const response = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanText,
                speechMetadata: {
                  style: speechStyle,
                },
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
      });

      checkSafetyBlock(response);
      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      const audioBase64 = inlineData?.data;
      const mimeType = inlineData?.mimeType || 'audio/wav';

      if (!audioBase64) {
        res.status(502).json({
          error: 'Gemini 3.8 TTS returned no audio payload.',
          code: 'SERVER_ERROR',
          retryable: true,
          shouldRotateKey: false,
          cooldownMs: 5000,
          keySource,
        });
        return;
      }

      res.json({
        audioBase64,
        mimeType,
        voiceName,
        model: TTS_MODEL,
        keySource,
      });
    } catch (err) {
      const classified = classifyAiError(err, keySource);
      res.status(classified.status).json({
        error: classified.message,
        code: classified.code,
        retryable: classified.retryable,
        shouldRotateKey: classified.shouldRotateKey,
        cooldownMs: classified.cooldownMs,
        keySource,
      });
    }
  });

  // Gemini 3.5 Transcribe Voice Note Transcription (BYOK-first, server GEMINI_API_KEY fallback)
  app.post('/api/ai/transcribe', async (req, res) => {
    let keySource: 'byok' | 'server_fallback' = 'server_fallback';
    try {
      const resolved = resolveApiKey(req.headers['x-sotal-gemini-key']);
      keySource = resolved.keySource;
      const { audioBase64, mimeType, courseContextHint } = req.body ?? {};

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

      const rawMime = typeof mimeType === 'string' ? mimeType.split(';')[0].toLowerCase().trim() : 'audio/webm';
      const normalizedMime = ALLOWED_AUDIO_MIMES.has(rawMime) ? rawMime : 'audio/webm';
      const hint =
        typeof courseContextHint === 'string' && courseContextHint.trim()
          ? ` Academic course context for accurate terminology spelling: ${courseContextHint.trim().slice(0, 200)}.`
          : '';

      const ai = createGeminiClient(resolved.apiKey, 'v1beta');
      const response = await ai.models.generateContent({
        model: TRANSCRIBE_MODEL,
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
      });

      checkSafetyBlock(response);
      const text = (response.text ?? '').trim();

      res.json({
        text,
        model: TRANSCRIBE_MODEL,
        keySource,
      });
    } catch (err) {
      const classified = classifyAiError(err, keySource);
      res.status(classified.status).json({
        error: classified.message,
        code: classified.code,
        retryable: classified.retryable,
        shouldRotateKey: classified.shouldRotateKey,
        cooldownMs: classified.cooldownMs,
        keySource,
      });
    }
  });

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

    // Vite 8 injects /@vite/client even when hmr/ws are disabled, which tries to
    // connect to an unreachable HMR WebSocket port in proxied middleware mode.
    // Serve a clean WebSocket-free client shim preserving CSS injection and HMR context APIs.
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
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SOTAL Study server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
