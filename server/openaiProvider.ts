import { buildVisionPrompt, VISION_JSON_SCHEMA, toJsonSchema } from './prompts';

export type OpenAiProviderId = 'nvidia_nim' | 'openrouter' | 'cerebras' | 'groq' | 'cloudflare';

export type ProviderTask = 'chat' | 'structured_json' | 'vision' | 'transcription' | 'tts';

export interface ProviderKeyContext {
  apiKey: string;
  keySource: 'byok' | 'server_fallback';
}

export interface ProviderErrorShape {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
  cooldownMs: number;
}

export class ProviderRequestError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  cooldownMs: number;

  constructor(shape: ProviderErrorShape) {
    super(shape.message);
    this.name = 'ProviderRequestError';
    this.status = shape.status;
    this.code = shape.code;
    this.retryable = shape.retryable;
    this.cooldownMs = shape.cooldownMs;
  }
}

export function isOpenAiProviderId(value: unknown): value is OpenAiProviderId {
  return (
    value === 'nvidia_nim' ||
    value === 'openrouter' ||
    value === 'cerebras' ||
    value === 'groq' ||
    value === 'cloudflare'
  );
}

function env(name: string): string {
  return (process.env[name] || '').trim();
}

interface ProviderDefinition {
  label: string;
  baseUrl: string;
  envKeyName: string;
  models: Record<ProviderTask, string>;
  /** Nemotron reasoning models only emit content when thinking is disabled. */
  disableThinking: boolean;
  extraHeaders: Record<string, string>;
}

export function getProviderDefinition(provider: OpenAiProviderId): ProviderDefinition {
  if (provider === 'nvidia_nim') {
    const defaultModel = env('NVIDIA_MODEL') || 'nvidia/nemotron-3.5-super-vl-120b-a12b';
    return {
      label: 'NVIDIA NIM',
      baseUrl: env('NVIDIA_BASE_URL') || 'https://integrate.api.nvidia.com/v1',
      envKeyName: 'NVIDIA_API_KEY',
      models: {
        chat: defaultModel,
        structured_json: env('NVIDIA_JSON_MODEL') || defaultModel,
        vision: env('NVIDIA_VISION_MODEL') || 'nvidia/nemotron-3.5-super-vl-120b-a12b',
        transcription:
          env('NVIDIA_TRANSCRIBE_MODEL') || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        tts: '',
      },
      disableThinking: true,
      extraHeaders: {},
    };
  }

  if (provider === 'openrouter') {
    const defaultModel = env('OPENROUTER_MODEL') || 'openai/gpt-4o-mini';
    return {
      label: 'OpenRouter',
      baseUrl: env('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1',
      envKeyName: 'OPENROUTER_API_KEY',
      models: {
        chat: defaultModel,
        structured_json: env('OPENROUTER_JSON_MODEL') || defaultModel,
        vision: env('OPENROUTER_VISION_MODEL') || defaultModel,
        transcription: env('OPENROUTER_TRANSCRIBE_MODEL') || 'openai/gpt-4o-audio-preview',
        tts: env('OPENROUTER_TTS_MODEL') || '',
      },
      disableThinking: false,
      extraHeaders: {
        'HTTP-Referer': env('APP_URL') || 'http://localhost:3000',
        'X-Title': 'SOTAL Study',
      },
    };
  }

  if (provider === 'groq') {
    const defaultModel = env('GROQ_MODEL') || 'openai/gpt-oss-120b';
    return {
      label: 'Groq',
      baseUrl: env('GROQ_BASE_URL') || 'https://api.groq.com/openai/v1',
      envKeyName: 'GROQ_API_KEY',
      models: {
        chat: defaultModel,
        structured_json: env('GROQ_JSON_MODEL') || defaultModel,
        vision: '',
        transcription: env('GROQ_TRANSCRIBE_MODEL') || 'whisper-large-v3-turbo',
        tts: env('GROQ_TTS_MODEL') || 'canopylabs/orpheus-v1-english',
      },
      disableThinking: false,
      extraHeaders: {},
    };
  }

  if (provider === 'cloudflare') {
    const defaultModel =
      env('CLOUDFLARE_MODEL') || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    const accountId = env('CLOUDFLARE_ACCOUNT_ID');
    const customBaseUrl = env('CLOUDFLARE_BASE_URL');
    return {
      label: 'Cloudflare Workers AI',
      baseUrl:
        customBaseUrl ||
        (accountId
          ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
          : 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1'),
      envKeyName: 'CLOUDFLARE_API_TOKEN',
      models: {
        chat: defaultModel,
        structured_json: env('CLOUDFLARE_JSON_MODEL') || defaultModel,
        vision: env('CLOUDFLARE_VISION_MODEL') || '',
        transcription: '',
        tts: '',
      },
      disableThinking: false,
      extraHeaders: {},
    };
  }

  return {
    label: 'Cerebras',
    baseUrl: env('CEREBRAS_BASE_URL') || 'https://api.cerebras.ai/v1',
    envKeyName: 'CEREBRAS_API_KEY',
    models: {
      chat: env('CEREBRAS_MODEL') || 'gpt-oss-120b',
      structured_json: env('CEREBRAS_JSON_MODEL') || env('CEREBRAS_MODEL') || 'gpt-oss-120b',
      vision: '',
      transcription: '',
      tts: '',
    },
    disableThinking: false,
    extraHeaders: {},
  };
}

export function areServerProviderKeysAllowed(): boolean {
  return env('ALLOW_SERVER_PROVIDER_KEYS').toLowerCase() !== 'false';
}

function getOpenRouterServerKey(): string {
  return env('OPENROUTER_API_KEY') || env('OPEN_ROUTER_API_KEY');
}

function getCloudflareServerCredential(): string {
  const token = env('CLOUDFLARE_API_TOKEN') || env('CLOUDFLARE_API_KEY');
  if (!token) return '';
  if (token.includes(':')) {
    return token;
  }
  const accountId = env('CLOUDFLARE_ACCOUNT_ID');
  if (accountId) {
    return `${accountId}:${token}`;
  }
  return '';
}

function parseCloudflareCredential(raw: string): { accountId: string; apiToken: string } {
  const trimmed = raw.trim();
  const sepIndex = trimmed.indexOf(':');
  if (sepIndex > 0 && sepIndex < trimmed.length - 1) {
    const accountId = trimmed.slice(0, sepIndex).trim();
    const apiToken = trimmed.slice(sepIndex + 1).trim();
    if (accountId && apiToken) {
      return { accountId, apiToken };
    }
  }

  throw new ProviderRequestError({
    status: 400,
    code: 'INVALID_KEY',
    message:
      'Cloudflare Workers AI keys must use the format ACCOUNT_ID:API_TOKEN (see Cloudflare Workers AI REST API docs).',
    retryable: false,
    cooldownMs: 0,
  });
}

export function getServerFallbackProvidersStatus(): Record<
  'gemini' | OpenAiProviderId,
  boolean
> {
  const allowProviders = areServerProviderKeysAllowed();
  return {
    gemini: Boolean(env('GEMINI_API_KEY')),
    openrouter: allowProviders && Boolean(getOpenRouterServerKey()),
    cerebras: allowProviders && Boolean(env('CEREBRAS_API_KEY')),
    groq: allowProviders && Boolean(env('GROQ_API_KEY')),
    cloudflare: allowProviders && Boolean(getCloudflareServerCredential()),
    nvidia_nim: allowProviders && Boolean(env('NVIDIA_API_KEY')),
  };
}

function isByokOnlyFlag(header?: string | string[] | boolean): boolean {
  if (typeof header === 'boolean') return header;
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

export function resolveProviderKey(
  provider: OpenAiProviderId,
  headerKey?: string | string[],
  byokOnlyHeader?: string | string[] | boolean
): ProviderKeyContext {
  const raw = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';

  if (trimmed.length > 0) {
    return { apiKey: trimmed, keySource: 'byok' };
  }

  // Once a user has added any personal API key, they are permanently banned from using server .env keys.
  if (isByokOnlyFlag(byokOnlyHeader)) {
    throw new ProviderRequestError({
      status: 503,
      code: 'NO_API_KEY',
      message: `No personal ${getProviderDefinition(provider).label} API key was provided. Add your own key in Settings.`,
      retryable: false,
      cooldownMs: 0,
    });
  }

  // For users who have not entered any personal API key yet, allow configured server .env fallback keys.
  if (areServerProviderKeysAllowed()) {
    if (provider === 'cloudflare') {
      const cfCred = getCloudflareServerCredential();
      if (cfCred) {
        return { apiKey: cfCred, keySource: 'server_fallback' };
      }
    } else if (provider === 'openrouter') {
      const orKey = getOpenRouterServerKey();
      if (orKey) {
        return { apiKey: orKey, keySource: 'server_fallback' };
      }
    } else {
      const definition = getProviderDefinition(provider);
      const serverKey = env(definition.envKeyName);
      if (serverKey) {
        return { apiKey: serverKey, keySource: 'server_fallback' };
      }
    }
  }

  throw new ProviderRequestError({
    status: 503,
    code: 'NO_API_KEY',
    message: `No ${getProviderDefinition(provider).label} API key was provided. Add a key in Settings.`,
    retryable: false,
    cooldownMs: 0,
  });
}

function classifyStatus(provider: OpenAiProviderId, status: number, message: string): ProviderErrorShape {
  const label = getProviderDefinition(provider).label;

  if (status === 401 || status === 403) {
    return {
      status: 403,
      code: 'INVALID_KEY',
      message: `${label} rejected this API key. Verify or replace it in Settings.`,
      retryable: false,
      cooldownMs: 0,
    };
  }
  if (status === 402) {
    return {
      status: 429,
      code: 'QUOTA_EXHAUSTED',
      message: `${label} credits or quota are exhausted for this key.`,
      retryable: true,
      cooldownMs: 120_000,
    };
  }
  if (status === 429) {
    return {
      status: 429,
      code: 'RATE_LIMIT',
      message: `${label} rate limit reached for this key. Cooling down before retrying.`,
      retryable: true,
      cooldownMs: 60_000,
    };
  }
  if (status === 404 || status === 410) {
    return {
      status: 404,
      code: 'MODEL_UNAVAILABLE',
      message: `${label} model is unavailable for this key (${message || `HTTP ${status}`}).`,
      retryable: false,
      cooldownMs: 0,
    };
  }
  if (status === 400 || status === 413 || status === 422) {
    return {
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${label} rejected the request: ${message || `HTTP ${status}`}.`,
      retryable: false,
      cooldownMs: 0,
    };
  }
  if (status >= 500) {
    return {
      status: 503,
      code: 'SERVER_ERROR',
      message: `${label} is temporarily unavailable. Retrying shortly.`,
      retryable: true,
      cooldownMs: 20_000,
    };
  }
  return {
    status: 500,
    code: 'NETWORK_ERROR',
    message: message || `${label} request failed (HTTP ${status}).`,
    retryable: true,
    cooldownMs: 5_000,
  };
}

function extractProviderMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  const direct = typeof record.message === 'string' ? record.message : '';
  if (direct) return direct;
  const detail = typeof record.detail === 'string' ? record.detail : '';
  if (detail) return detail;
  const error = record.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const errorRecord = error as Record<string, unknown>;
    if (typeof errorRecord.message === 'string') return errorRecord.message;
  }
  return fallback;
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

interface ChatCompletionOptions {
  provider: OpenAiProviderId;
  apiKey: string;
  task: ProviderTask;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  jsonSchema?: Record<string, unknown>;
  modelOverride?: string;
  timeoutMs?: number;
}

interface ChatCompletionResult {
  content: string;
  model: string;
  finishReason: string;
  usage?: Record<string, unknown>;
}

async function requestChatCompletion(
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const definition = getProviderDefinition(options.provider);
  const rawOverride = options.modelOverride?.trim() || '';
  const safeOverride = rawOverride && !/^gemini-/i.test(rawOverride) ? rawOverride : '';
  const model = safeOverride || definition.models[options.task];

  if (!model) {
    throw new ProviderRequestError({
      status: 501,
      code: 'MODEL_UNAVAILABLE',
      message: `${definition.label} does not support ${options.task} in SOTAL Study.`,
      retryable: false,
      cooldownMs: 0,
    });
  }

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 1200,
    stream: false,
  };

  if (options.jsonSchema) {
    body.response_format =
      options.provider === 'cloudflare'
        ? {
            type: 'json_schema',
            json_schema: {
              name: 'sotal_response',
              schema: options.jsonSchema,
            },
          }
        : {
            type: 'json_schema',
            json_schema: {
              name: 'sotal_response',
              strict: true,
              schema: options.jsonSchema,
            },
          };
  }

  if (definition.disableThinking && /nemotron/i.test(model)) {
    body.chat_template_kwargs = { enable_thinking: false };
  }

  let endpointBaseUrl = definition.baseUrl.replace(/\/+$/, '');
  let bearerToken = options.apiKey;
  if (options.provider === 'cloudflare') {
    const parsedCf = parseCloudflareCredential(options.apiKey);
    bearerToken = parsedCf.apiToken;
    const customCfBase = env('CLOUDFLARE_BASE_URL').replace(/\/+$/, '');
    endpointBaseUrl =
      customCfBase ||
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(parsedCf.accountId)}/ai/v1`;
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 45_000;
  const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs);

  try {
    const response = await fetch(`${endpointBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
        ...definition.extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Leave json null; handled below.
    }

    if (!response.ok) {
      const message = extractProviderMessage(json, text.slice(0, 240));
      throw new ProviderRequestError(
        classifyStatus(options.provider, response.status, message)
      );
    }

    if (!json || typeof json !== 'object') {
      throw new ProviderRequestError({
        status: 502,
        code: 'SERVER_ERROR',
        message: `${definition.label} returned a malformed response.`,
        retryable: true,
        cooldownMs: 5_000,
      });
    }

    const record = json as {
      model?: string;
      choices?: Array<{
        message?: { content?: unknown; reasoning_content?: unknown };
        finish_reason?: string;
      }>;
      usage?: Record<string, unknown>;
    };
    const choice = record.choices?.[0];
    const rawContent = choice?.message?.content;
    const content =
      typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
        ? rawContent
            .map((part) =>
              part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
                ? (part as { text: string }).text
                : ''
            )
            .join('')
        : '';

    const finishReason = choice?.finish_reason || 'STOP';

    if (!content.trim()) {
      const reasoning =
        typeof choice?.message?.reasoning_content === 'string'
          ? choice.message.reasoning_content.length
          : 0;
      throw new ProviderRequestError({
        status: 502,
        code: 'SERVER_ERROR',
        message:
          reasoning > 0
            ? `${definition.label} returned reasoning only (no answer content). Retrying.`
            : `${definition.label} returned an empty response.`,
        retryable: true,
        cooldownMs: 3_000,
      });
    }

    return {
      content,
      model: record.model || model,
      finishReason,
      usage: record.usage,
    };
  } catch (err) {
    if (err instanceof ProviderRequestError) throw err;
    const isTimeout =
      (err instanceof DOMException && err.name === 'AbortError') ||
      (err instanceof Error && err.message === 'TIMEOUT');
    throw new ProviderRequestError({
      status: isTimeout ? 504 : 502,
      code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: isTimeout
        ? `${definition.label} timed out while generating a response.`
        : `${definition.label} request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      retryable: true,
      cooldownMs: 5_000,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Task helpers
// ---------------------------------------------------------------------------

export function buildOpenAiMessages(params: {
  prompt?: unknown;
  messages?: unknown;
  systemInstruction?: unknown;
}): ChatMessage[] {
  const result: ChatMessage[] = [];

  if (typeof params.systemInstruction === 'string' && params.systemInstruction.trim()) {
    result.push({ role: 'system', content: params.systemInstruction.trim() });
  }

  if (Array.isArray(params.messages) && params.messages.length > 0) {
    for (const message of params.messages) {
      if (!message || typeof message !== 'object') continue;
      const record = message as { role?: unknown; text?: unknown };
      if (typeof record.text !== 'string' || !record.text.trim()) continue;
      const role =
        record.role === 'assistant' || record.role === 'model' ? 'assistant' : 'user';
      result.push({ role, content: record.text });
    }
  }

  if (result.length === 0 || !result.some((message) => message.role !== 'system')) {
    if (typeof params.prompt === 'string' && params.prompt.trim()) {
      result.push({ role: 'user', content: params.prompt });
    }
  }

  return result;
}

export async function generateProviderText(params: {
  provider: OpenAiProviderId;
  apiKey: string;
  prompt?: unknown;
  messages?: unknown;
  systemInstruction?: unknown;
  model?: unknown;
}): Promise<{ text: string; model: string; finishReason: string }> {
  const messages = buildOpenAiMessages({
    prompt: params.prompt,
    messages: params.messages,
    systemInstruction: params.systemInstruction,
  });

  if (messages.length === 0) {
    throw new ProviderRequestError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Either prompt or non-empty messages array is required.',
      retryable: false,
      cooldownMs: 0,
    });
  }

  const completion = await requestChatCompletion({
    provider: params.provider,
    apiKey: params.apiKey,
    task: 'chat',
    messages,
    maxTokens: 2000,
    modelOverride: typeof params.model === 'string' ? params.model : undefined,
  });

  return {
    text: completion.content.trim(),
    model: completion.model,
    finishReason: completion.finishReason,
  };
}

export async function generateProviderJson(params: {
  provider: OpenAiProviderId;
  apiKey: string;
  prompt: string;
  systemInstruction?: string;
  responseSchema?: Record<string, unknown>;
  model?: string;
}): Promise<{ data: unknown; rawText: string; model: string }> {
  const schema =
    params.responseSchema && typeof params.responseSchema === 'object'
      ? toJsonSchema(params.responseSchema)
      : undefined;

  const completion = await requestChatCompletion({
    provider: params.provider,
    apiKey: params.apiKey,
    task: 'structured_json',
    messages: buildOpenAiMessages({
      prompt: params.prompt,
      systemInstruction: params.systemInstruction,
    }),
    maxTokens: 4000,
    temperature: 0.2,
    jsonSchema: schema,
    modelOverride: params.model,
    timeoutMs: 50_000,
  });

  const raw = stripJsonFences(completion.content);

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ProviderRequestError({
      status: 502,
      code: 'SERVER_ERROR',
      message: `${getProviderDefinition(params.provider).label} returned malformed JSON.`,
      retryable: true,
      cooldownMs: 2_000,
    });
  }

  return { data, rawText: raw, model: completion.model };
}

export async function extractProviderVision(params: {
  provider: OpenAiProviderId;
  apiKey: string;
  imageBase64: string;
  mimeType: string;
  mode: string;
  pageNumber?: number;
  model?: string;
}): Promise<{
  sections: Array<{ heading: string; level: number; content: string; pageOrSlide?: number }>;
  uncertainCount: number;
  notes: string;
  model: string;
}> {
  const prompt = buildVisionPrompt(params.mode, params.pageNumber);
  const dataUrl = `data:${params.mimeType};base64,${params.imageBase64}`;

  const completion = await requestChatCompletion({
    provider: params.provider,
    apiKey: params.apiKey,
    task: 'vision',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    maxTokens: 2500,
    temperature: 0.1,
    jsonSchema: VISION_JSON_SCHEMA,
    modelOverride: params.model,
    timeoutMs: 60_000,
  });

  const raw = stripJsonFences(completion.content);
  let parsed: {
    sections?: Array<{ heading?: string; level?: number; content?: string }>;
    uncertainCount?: number;
    notes?: string;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderRequestError({
      status: 502,
      code: 'SERVER_ERROR',
      message: `${getProviderDefinition(params.provider).label} returned malformed OCR JSON.`,
      retryable: true,
      cooldownMs: 2_000,
    });
  }

  const sections = Array.isArray(parsed.sections)
    ? parsed.sections
        .filter((section) => section && typeof section.content === 'string' && section.content.trim())
        .map((section, index) => ({
          heading:
            typeof section.heading === 'string' && section.heading.trim()
              ? section.heading.trim()
              : params.pageNumber
              ? `Page ${params.pageNumber}`
              : `Section ${index + 1}`,
          level:
            typeof section.level === 'number' && section.level >= 1 && section.level <= 3
              ? section.level
              : 2,
          content: (section.content ?? '').trim(),
          ...(typeof params.pageNumber === 'number' ? { pageOrSlide: params.pageNumber } : {}),
        }))
    : [];

  return {
    sections,
    uncertainCount:
      typeof parsed.uncertainCount === 'number' ? parsed.uncertainCount : 0,
    notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : '',
    model: completion.model,
  };
}

export async function transcribeProviderAudio(params: {
  provider: OpenAiProviderId;
  apiKey: string;
  audioBase64: string;
  mimeType: string;
  courseContextHint?: string;
  model?: string;
}): Promise<{ text: string; model: string }> {
  const cleanMime = params.mimeType.split(';')[0].toLowerCase().trim();
  if (cleanMime !== 'audio/wav' && cleanMime !== 'audio/mpeg' && cleanMime !== 'audio/mp3') {
    throw new ProviderRequestError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Fallback transcription accepts WAV or MP3 audio only.',
      retryable: false,
      cooldownMs: 0,
    });
  }

  const hint =
    typeof params.courseContextHint === 'string' && params.courseContextHint.trim()
      ? ` Academic course context for accurate terminology spelling: ${params.courseContextHint
          .trim()
          .slice(0, 200)}.`
      : '';

  // Groq Whisper requires multipart/form-data to /audio/transcriptions rather than chat completions.
  if (params.provider === 'groq') {
    const def = getProviderDefinition('groq');
    const rawOverride = params.model?.trim() || '';
    const model =
      rawOverride && !/^gemini-/i.test(rawOverride) ? rawOverride : def.models.transcription;
    if (!model) {
      throw new ProviderRequestError({
        status: 501,
        code: 'MODEL_UNAVAILABLE',
        message: 'Groq transcription model is not configured.',
        retryable: false,
        cooldownMs: 0,
      });
    }

    const audioBuffer = Buffer.from(params.audioBase64, 'base64');
    const isMp3 = cleanMime === 'audio/mpeg' || cleanMime === 'audio/mp3';
    const fileName = isMp3 ? 'voice.mp3' : 'voice.wav';
    const blob = new Blob([audioBuffer], { type: isMp3 ? 'audio/mpeg' : 'audio/wav' });

    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append('model', model);
    formData.append('response_format', 'json');
    if (hint) {
      formData.append('prompt', hint.trim());
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), 45_000);
    try {
      const response = await fetch(`${def.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          ...def.extraHeaders,
        },
        body: formData,
        signal: controller.signal,
      });

      const text = await response.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        // Leave null
      }

      if (!response.ok) {
        const message = extractProviderMessage(json, text.slice(0, 240));
        throw new ProviderRequestError(classifyStatus('groq', response.status, message));
      }

      const transcribed =
        json && typeof json === 'object' && typeof (json as { text?: unknown }).text === 'string'
          ? (json as { text: string }).text.trim()
          : '';

      if (!transcribed) {
        throw new ProviderRequestError({
          status: 502,
          code: 'SERVER_ERROR',
          message: 'Groq Whisper returned an empty transcription.',
          retryable: true,
          cooldownMs: 3_000,
        });
      }

      return { text: transcribed, model };
    } catch (err) {
      if (err instanceof ProviderRequestError) throw err;
      const isTimeout =
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.message === 'TIMEOUT');
      throw new ProviderRequestError({
        status: isTimeout ? 504 : 502,
        code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: isTimeout
          ? 'Groq Whisper timed out while transcribing audio.'
          : `Groq Whisper request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        retryable: true,
        cooldownMs: 5_000,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const completion = await requestChatCompletion({
    provider: params.provider,
    apiKey: params.apiKey,
    task: 'transcription',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Transcribe this student voice note accurately into clean text with proper punctuation. Return only the transcription text without commentary.${hint}`,
          },
          {
            type: 'input_audio',
            input_audio: {
              data: params.audioBase64,
              format: cleanMime === 'audio/mpeg' || cleanMime === 'audio/mp3' ? 'mp3' : 'wav',
            },
          },
        ],
      },
    ],
    maxTokens: 1500,
    temperature: 0,
    modelOverride: params.model,
  });

  return { text: completion.content.trim(), model: completion.model };
}

const GROQ_ORPHEUS_VOICES = new Set(['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy']);
const GEMINI_TO_GROQ_VOICE_MAP: Record<string, string> = {
  kore: 'hannah',
  puck: 'autumn',
  charon: 'daniel',
  fenrir: 'troy',
  zephyr: 'diana',
};

function resolveProviderTtsVoice(provider: OpenAiProviderId, requestedVoice?: string): string {
  const normalized = (requestedVoice || '').trim().toLowerCase();
  if (provider === 'groq') {
    if (GROQ_ORPHEUS_VOICES.has(normalized)) return normalized;
    if (normalized && GEMINI_TO_GROQ_VOICE_MAP[normalized]) {
      return GEMINI_TO_GROQ_VOICE_MAP[normalized];
    }
    return 'troy';
  }
  return requestedVoice?.trim() || 'troy';
}

export async function synthesizeProviderSpeech(params: {
  provider: OpenAiProviderId;
  apiKey: string;
  text: string;
  voiceName?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ audioBase64: string; mimeType: string; voiceName: string; model: string }> {
  const def = getProviderDefinition(params.provider);
  const rawOverride = params.model?.trim() || '';
  const model = (rawOverride && !/^gemini-/i.test(rawOverride) ? rawOverride : '') || def.models.tts;
  if (!model) {
    throw new ProviderRequestError({
      status: 501,
      code: 'MODEL_UNAVAILABLE',
      message: `${def.label} does not support speech synthesis.`,
      retryable: false,
      cooldownMs: 0,
    });
  }

  const voice = resolveProviderTtsVoice(params.provider, params.voiceName);
  const url = `${def.baseUrl.replace(/\/+$/, '')}/audio/speech`;
  const timeout = params.timeoutMs ?? 30_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        ...def.extraHeaders,
      },
      body: JSON.stringify({
        model,
        input: params.text,
        voice,
        response_format: 'wav',
      }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new ProviderRequestError({
        status: 504,
        code: 'TIMEOUT',
        message: `${def.label} speech synthesis timed out.`,
        retryable: true,
        cooldownMs: 1_000,
      });
    }
    throw new ProviderRequestError({
      status: 502,
      code: 'SERVER_ERROR',
      message: `Network error calling ${def.label} speech synthesis.`,
      retryable: true,
      cooldownMs: 2_000,
    });
  }
  clearTimeout(timer);

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    let parsed: any;
    try {
      parsed = JSON.parse(errorText);
    } catch {
      // ignore
    }
    const msg = parsed?.error?.message || errorText || `HTTP ${response.status}`;
    throw new ProviderRequestError({
      status: response.status,
      code:
        response.status === 401
          ? 'INVALID_KEY'
          : response.status === 429
          ? 'RATE_LIMIT'
          : 'SERVER_ERROR',
      message: `${def.label} speech synthesis error: ${msg}`,
      retryable: response.status >= 500,
      cooldownMs: response.status === 429 ? 60_000 : 0,
    });
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const audioBase64 = buffer.toString('base64');

  return {
    audioBase64,
    mimeType: 'audio/wav',
    voiceName: voice,
    model,
  };
}

export async function testProviderConnection(params: {
  provider: OpenAiProviderId;
  apiKey: string;
}): Promise<{ ok: true; model: string; latencyMs: number }> {
  const started = Date.now();
  const completion = await requestChatCompletion({
    provider: params.provider,
    apiKey: params.apiKey,
    task: 'chat',
    messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    maxTokens: 24,
    temperature: 0,
    timeoutMs: 20_000,
  });
  return {
    ok: true,
    model: completion.model,
    latencyMs: Date.now() - started,
  };
}
