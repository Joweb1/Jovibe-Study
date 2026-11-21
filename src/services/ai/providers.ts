/**
 * Shared AI provider registry.
 *
 * Fallback policy (single source of truth):
 *  - Gemini is always the primary provider and rotates across the user's BYOK keys.
 *  - Chat:          Gemini → Cerebras → NVIDIA NIM → OpenRouter → Groq
 *  - Audio/TTS:     Gemini → Groq (fast speech playback fallback)
 *  - Transcription: Gemini → Groq → NVIDIA NIM → OpenRouter
 *  - Structured/OCR: Gemini → NVIDIA NIM → OpenRouter
 *
 * Provider switching only happens once a provider is exhausted: every key is in
 * quota/rate-limit cooldown, invalid, or the provider has no usable key. A single
 * transient failure never switches providers — it retries the same provider first.
 */

export type AiProvider = 'gemini' | 'cerebras' | 'nvidia_nim' | 'openrouter' | 'groq';

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
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    shortLabel: 'Cerebras',
    description:
      'Chat-only fallback used right after Gemini is exhausted. A single API key is supported.',
    supportsRotation: false,
    maxKeys: 1,
    keyPlaceholder: 'Paste Cerebras API key',
    keyHint: 'Used only for the AI Tutor chat. One key, no rotation.',
    docsUrl: 'https://cloud.cerebras.ai',
    tasks: ['chat'],
  },
  nvidia_nim: {
    id: 'nvidia_nim',
    label: 'NVIDIA NIM',
    shortLabel: 'NIM',
    description:
      'Last-resort provider for chat, structured JSON, OCR/vision and voice-note transcription. Rotates across your saved NIM keys.',
    supportsRotation: true,
    maxKeys: null,
    keyPlaceholder: 'Paste NVIDIA NIM API key (nvapi-...)',
    keyHint: 'Create keys at build.nvidia.com. Quotas are per key, so multiple keys extend rotation.',
    docsUrl: 'https://build.nvidia.com',
    tasks: ['chat', 'structured_json', 'vision', 'transcription'],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    shortLabel: 'OpenRouter',
    description:
      'Final fallback for AI features after NIM. Inactive until you add at least one OpenRouter key.',
    supportsRotation: true,
    maxKeys: null,
    keyPlaceholder: 'Paste OpenRouter API key (sk-or-...)',
    keyHint: 'Create keys at openrouter.ai/keys. Requests stay idle until a key is saved here.',
    docsUrl: 'https://openrouter.ai/keys',
    tasks: ['chat', 'structured_json', 'vision', 'transcription'],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    shortLabel: 'Groq',
    description:
      'Ultra-fast audio fallback provider for speech playback (TTS) and voice-note transcription. Rotates across your saved Groq keys.',
    supportsRotation: true,
    maxKeys: null,
    keyPlaceholder: 'Paste Groq API key (gsk_...)',
    keyHint: 'Create keys at console.groq.com/keys. Serves as fallback for audio playback when Gemini TTS is unavailable.',
    docsUrl: 'https://console.groq.com/keys',
    tasks: ['tts', 'transcription', 'chat'],
  },
};

/**
 * Ordered fallback chain per task.
 * Speech playback (TTS) falls back to Groq when Gemini keys are exhausted.
 */
export const PROVIDER_CHAINS: Record<AiTask, AiProvider[]> = {
  chat: ['gemini', 'cerebras', 'nvidia_nim', 'openrouter', 'groq'],
  structured_json: ['gemini', 'nvidia_nim', 'openrouter'],
  vision: ['gemini', 'nvidia_nim', 'openrouter'],
  transcription: ['gemini', 'groq', 'nvidia_nim', 'openrouter'],
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
  cerebras: 'gpt-oss-120b',
  nvidia_nim: 'nemotron-3.5-super-vl-120b-a12b',
  openrouter: 'configured on the server (default: openai/gpt-4o-mini)',
  groq: 'canopylabs/orpheus-v1-english (TTS) / whisper-large-v3-turbo / llama-3.3-70b-versatile',
};

export function isProvider(value: unknown): value is AiProvider {
  return (
    value === 'gemini' ||
    value === 'cerebras' ||
    value === 'nvidia_nim' ||
    value === 'openrouter' ||
    value === 'groq'
  );
}

export function providerSupportsTask(provider: AiProvider, task: AiTask): boolean {
  return PROVIDERS[provider].tasks.includes(task);
}
