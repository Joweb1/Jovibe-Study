/**
 * Shared AI provider registry.
 *
 * Fallback policy (single source of truth):
 *  - Gemini is always the primary provider and rotates across the user's BYOK keys.
 *  - Chat:            Gemini → OpenRouter → Cerebras → Groq → Cloudflare Workers AI → NVIDIA NIM
 *  - Practice / JSON: Gemini → OpenRouter → Cerebras → Groq → Cloudflare Workers AI → NVIDIA NIM
 *  - Audio/TTS:       Gemini → Groq (fast speech playback fallback)
 *  - Transcription:   Gemini → Groq → OpenRouter → NVIDIA NIM
 *  - OCR / Vision:    Gemini → OpenRouter → NVIDIA NIM
 *
 * Provider switching only happens once a provider is exhausted: every key is in
 * quota/rate-limit cooldown, invalid, or the provider has no usable key. A single
 * transient failure never switches providers — it retries the same provider first.
 */

export type AiProvider =
  | 'gemini'
  | 'openrouter'
  | 'cerebras'
  | 'groq'
  | 'cloudflare'
  | 'nvidia_nim';

export type AiTask = 'chat' | 'structured_json' | 'vision' | 'transcription' | 'tts';

export type AiKeySource = 'byok' | 'server_fallback';

export interface AiRequestMeta {
  provider: AiProvider;
  model: string;
  keySource: AiKeySource;
  keyLabel: string;
}

export interface ProviderDefinition {
  id: AiProvider;
  label: string;
  shortLabel: string;
  description: string;
  /** Whether the provider supports rotating multiple saved keys. */
  supportsRotation: boolean;
  /** Hard cap on saved keys, or null for unlimited. */
  maxKeys: number | null;
  keyPlaceholder: string;
  keyHint: string;
  docsUrl: string;
  /** Tasks this provider can serve. */
  tasks: AiTask[];
}

export const PROVIDERS: Record<AiProvider, ProviderDefinition> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    description:
      'Primary AI for every feature. Rotates across your saved Gemini keys before any other provider is used.',
    supportsRotation: true,
    maxKeys: null,
    keyPlaceholder: 'Paste Gemini API key (AIza...)',
    keyHint: 'Create keys in Google AI Studio. Keys from separate projects give independent quota.',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    tasks: ['chat', 'structured_json', 'vision', 'transcription', 'tts'],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    shortLabel: 'OpenRouter',
    description:
      '2nd fallback right after Gemini for AI Tutor chat, Practice, Automatic Study, and OCR/vision. Rotates across your saved OpenRouter keys.',
    supportsRotation: true,
    maxKeys: null,
    keyPlaceholder: 'Paste OpenRouter API key (sk-or-...)',
    keyHint: 'Create keys at openrouter.ai/keys. Used immediately after Gemini when configured.',
    docsUrl: 'https://openrouter.ai/keys',
    tasks: ['chat', 'structured_json', 'vision', 'transcription'],
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    shortLabel: 'Cerebras',
    description:
      'Ultra-fast fallback for AI Tutor chat, Practice generation, and Automatic Study.',
    supportsRotation: false,
    maxKeys: 1,
    keyPlaceholder: 'Paste Cerebras API key',
    keyHint: 'Used for AI Tutor chat, Practice, and Automatic Study. One key, no rotation.',
    docsUrl: 'https://cloud.cerebras.ai',
    tasks: ['chat', 'structured_json'],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    shortLabel: 'Groq',
    description:
      'Ultra-fast fallback provider for speech playback (TTS), voice transcription, chat, and structured practice generation. Rotates across your saved Groq keys.',
    supportsRotation: true,
    maxKeys: null,
    keyPlaceholder: 'Paste Groq API key (gsk_...)',
    keyHint: 'Create keys at console.groq.com/keys. Serves as fast fallback for audio, chat, and practice generation.',
    docsUrl: 'https://console.groq.com/keys',
    tasks: ['tts', 'transcription', 'chat', 'structured_json'],
  },
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    shortLabel: 'Cloudflare',
    description:
      'Edge-hosted REST API fallback for AI Tutor chat, Practice generation, and Automatic Study before NVIDIA NIM.',
    supportsRotation: true,
    maxKeys: null,
    keyPlaceholder: 'Paste ACCOUNT_ID:API_TOKEN',
    keyHint:
      'Enter as ACCOUNT_ID:API_TOKEN using your Cloudflare Account ID and Workers AI API Token.',
    docsUrl: 'https://developers.cloudflare.com/workers-ai/get-started/rest-api/',
    tasks: ['chat', 'structured_json'],
  },
  nvidia_nim: {
    id: 'nvidia_nim',
    label: 'NVIDIA NIM',
    shortLabel: 'NIM',
    description:
      'Last-resort provider for chat, structured JSON, OCR/vision, and voice-note transcription. Rotates across your saved NIM keys.',
    supportsRotation: true,
    maxKeys: null,
    keyPlaceholder: 'Paste NVIDIA NIM API key (nvapi-...)',
    keyHint: 'Create keys at build.nvidia.com. Used as the final fallback when earlier providers are unavailable.',
    docsUrl: 'https://build.nvidia.com',
    tasks: ['chat', 'structured_json', 'vision', 'transcription'],
  },
};

/**
 * Ordered fallback chain per task.
 * Practice & Chat: Gemini → OpenRouter → Cerebras → Groq → Cloudflare Workers AI → NVIDIA NIM (last resort).
 */
export const PROVIDER_CHAINS: Record<AiTask, AiProvider[]> = {
  chat: ['gemini', 'openrouter', 'cerebras', 'groq', 'cloudflare', 'nvidia_nim'],
  structured_json: ['gemini', 'openrouter', 'cerebras', 'groq', 'cloudflare', 'nvidia_nim'],
  vision: ['gemini', 'openrouter', 'nvidia_nim'],
  transcription: ['gemini', 'groq', 'openrouter', 'nvidia_nim'],
  tts: ['gemini', 'groq'],
};

export const TASK_LABELS: Record<AiTask, string> = {
  chat: 'AI Tutor chat',
  structured_json: 'Structured JSON (Practice & Automatic Study)',
  vision: 'OCR & document vision',
  transcription: 'Voice-note transcription',
  tts: 'Speech playback (TTS)',
};

/** Human-readable model names shown in Settings (server resolves the actual IDs). */
export const PROVIDER_MODEL_HINTS: Record<AiProvider, string> = {
  gemini: 'gemini-4-hydrogen / gemini-3.1-flash-lite / gemini-3.8-flash-lite-tts',
  openrouter: 'configured on the server (default: openai/gpt-4o-mini)',
  cerebras: 'gpt-oss-120b',
  groq: 'openai/gpt-oss-120b / whisper-large-v3 / canopylabs/orpheus-v1-english',
  cloudflare: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  nvidia_nim: 'mistral-large-4 / nemotron-3.5-super-vl (last resort)',
};

export function isProvider(value: unknown): value is AiProvider {
  return (
    value === 'gemini' ||
    value === 'openrouter' ||
    value === 'cerebras' ||
    value === 'groq' ||
    value === 'cloudflare' ||
    value === 'nvidia_nim'
  );
}

export function providerSupportsTask(provider: AiProvider, task: AiTask): boolean {
  return PROVIDERS[provider].tasks.includes(task);
}
