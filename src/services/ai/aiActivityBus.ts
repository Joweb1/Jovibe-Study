import { PROVIDERS, type AiKeySource, type AiProvider, type AiTask } from './providers';

export interface AiActivityEvent {
  id: string;
  task: AiTask;
  provider: AiProvider;
  providerLabel: string;
  model: string;
  keyLabel: string;
  keySource: AiKeySource;
  isFallback: boolean;
  status: 'running' | 'switching' | 'completed';
  note?: string;
  updatedAtMs: number;
}

type Listener = (current: AiActivityEvent | null) => void;

const COMPLETED_HOLD_MS = 2400;

const activeOperations = new Map<string, AiActivityEvent>();
let recentCompleted: AiActivityEvent | null = null;
let completedTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

export function formatCompactModelName(rawModel: string): string {
  const cleaned = (rawModel || '')
    .trim()
    .replace(/^private\//i, '')
    .replace(/^@cf\/[^/]+\//i, '')
    .replace(/^(?:nvidia|openai|mistralai|canopylabs|qwen|meta-llama)\//i, '');

  if (!cleaned) return '';
  if (cleaned.length <= 28) return cleaned;
  // Shorten verbose suffixes like "-120b-a12b" or "-1t-a52b" cleanly if long
  const shortened = cleaned.replace(/-a\d+b$/i, '').replace(/-\d+b$/i, '');
  return shortened.length <= 28 ? shortened : `${shortened.slice(0, 26)}…`;
}

export function guessInitialModelLabel(
  provider: AiProvider,
  task: AiTask,
  requestedModel?: string
): string {
  if (provider === 'gemini') {
    if (task === 'tts') return 'gemini-3.8-flash-lite-tts';
    if (task === 'transcription') return 'gemini-3.5-transcribe';
    if (task === 'image_generation') return 'gemini-3.1-flash-image';
    return formatCompactModelName(requestedModel || 'gemini-4-hydrogen');
  }
  if (provider === 'cerebras') {
    return 'gpt-oss-120b';
  }
  if (provider === 'nvidia_nim') {
    if (task === 'vision') return 'nemotron-3.5-super-vl';
    if (task === 'transcription') return 'nemotron-3-nano-omni';
    if (task === 'image_generation') return 'flux.1-schnell';
    return 'NVIDIA NIM';
  }
  if (provider === 'groq') {
    if (task === 'tts') return 'orpheus-v1-english';
    if (task === 'transcription') return 'whisper-large-v3';
    return 'gpt-oss-120b';
  }
  if (provider === 'cloudflare') {
    if (task === 'image_generation') return 'flux-1-schnell';
    return 'llama-3.3-70b';
  }
  if (task === 'image_generation') return 'flux-1-schnell';
  return 'OpenRouter';
}

function resolveCurrentEvent(): AiActivityEvent | null {
  if (activeOperations.size > 0) {
    let latest: AiActivityEvent | null = null;
    for (const op of activeOperations.values()) {
      if (!latest || op.updatedAtMs >= latest.updatedAtMs) {
        latest = op;
      }
    }
    return latest;
  }
  return recentCompleted;
}

function emit(): void {
  const current = resolveCurrentEvent();
  for (const listener of listeners) {
    try {
      listener(current);
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function startAiActivity(params: {
  id: string;
  task: AiTask;
  provider: AiProvider;
  model: string;
  keyLabel: string;
  keySource: AiKeySource;
  isFallback: boolean;
  status?: 'running' | 'switching';
  note?: string;
}): void {
  if (completedTimer) {
    clearTimeout(completedTimer);
    completedTimer = null;
  }
  recentCompleted = null;

  activeOperations.set(params.id, {
    id: params.id,
    task: params.task,
    provider: params.provider,
    providerLabel: PROVIDERS[params.provider].shortLabel,
    model: formatCompactModelName(params.model) || PROVIDERS[params.provider].shortLabel,
    keyLabel: params.keyLabel,
    keySource: params.keySource,
    isFallback: params.isFallback,
    status: params.status ?? 'running',
    note: params.note,
    updatedAtMs: Date.now(),
  });
  emit();
}

export function completeAiActivity(
  id: string,
  finalMeta: {
    task: AiTask;
    provider: AiProvider;
    model: string;
    keyLabel: string;
    keySource: AiKeySource;
    isFallback: boolean;
  }
): void {
  activeOperations.delete(id);

  recentCompleted = {
    id,
    task: finalMeta.task,
    provider: finalMeta.provider,
    providerLabel: PROVIDERS[finalMeta.provider].shortLabel,
    model: formatCompactModelName(finalMeta.model) || PROVIDERS[finalMeta.provider].shortLabel,
    keyLabel: finalMeta.keyLabel,
    keySource: finalMeta.keySource,
    isFallback: finalMeta.isFallback,
    status: 'completed',
    updatedAtMs: Date.now(),
  };
  emit();

  if (completedTimer) {
    clearTimeout(completedTimer);
  }
  completedTimer = setTimeout(() => {
    completedTimer = null;
    if (recentCompleted?.id === id) {
      recentCompleted = null;
      emit();
    }
  }, COMPLETED_HOLD_MS);
}

export function clearAiActivity(id: string): void {
  if (!activeOperations.has(id)) return;
  activeOperations.delete(id);
  emit();
}

export function getActiveAiActivity(): AiActivityEvent | null {
  return resolveCurrentEvent();
}

export function getActiveAiActivityForTask(task: AiTask): AiActivityEvent | null {
  let latest: AiActivityEvent | null = null;
  for (const op of activeOperations.values()) {
    if (op.task === task && (!latest || op.updatedAtMs >= latest.updatedAtMs)) {
      latest = op;
    }
  }
  if (latest) return latest;
  if (recentCompleted && recentCompleted.task === task) return recentCompleted;
  return null;
}

export function subscribeAiActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
