import type { AiProvider, AiTask } from './providers';

export interface ApiKeyLimitEvent {
  provider: AiProvider;
  task: AiTask | 'live';
  reason: 'quota_exhausted' | 'rate_limit' | 'all_keys_cooling_down';
  message: string;
  timestampMs: number;
}

type Listener = (event: ApiKeyLimitEvent) => void;

const listeners = new Set<Listener>();
let lastEmittedAtMs = 0;

/**
 * Broadcasts that the user's own configured API key(s) hit their limit and no
 * other configured BYOK provider was able to fulfill the request.
 * Debounced slightly so parallel failed requests open the popup cleanly once.
 */
export function emitApiKeyLimitReached(
  payload: Omit<ApiKeyLimitEvent, 'timestampMs'>
): void {
  const now = Date.now();
  if (now - lastEmittedAtMs < 1500) {
    return;
  }
  lastEmittedAtMs = now;

  const event: ApiKeyLimitEvent = {
    ...payload,
    timestampMs: now,
  };

  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Never allow UI listeners to break AI error handling
    }
  }
}

export function subscribeApiKeyLimitReached(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
