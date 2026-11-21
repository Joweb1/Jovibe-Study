import {
  buildProviderCandidates,
  getByokConfig,
  listStoredApiKeys,
  listUsableApiKeys,
  recordApiKeyFailure,
  recordApiKeySuccess,
  type StoredApiKey,
} from './keyManager';
import {
  AiServiceError,
  isAiServiceError,
  NON_ROTATABLE_CODES,
  TRANSIENT_CODES,
} from './errors';
import { ensureOnline, sleep } from './http';
import { checkServerFallbackStatus } from './geminiTransport';
import {
  PROVIDERS,
  PROVIDER_CHAINS,
  TASK_LABELS,
  type AiProvider,
  type AiRequestMeta,
  type AiTask,
} from './providers';

/** A single provider + key attempt in the fallback plan. */
export interface RouteAttempt {
  provider: AiProvider;
  kind: 'byok' | 'server_fallback';
  keyId: string | null;
  label: string;
  apiKey: string | null;
}

export interface AiExecuteResult<T> {
  value: T;
  model: string;
}

export interface RunAiTaskParams<T> {
  task: AiTask;
  signal?: AbortSignal;
  /** Optional post-processing gate (e.g. structured-output schema validation). */
  validate?: (value: T) => T;
  execute: (attempt: RouteAttempt) => Promise<AiExecuteResult<T>>;
}

/** Retries on the same key for transient failures before trying another provider. */
const MAX_TRANSIENT_ATTEMPTS = 2;
const TRANSIENT_BACKOFF_MS = 700;

function candidateFromStoredKey(provider: AiProvider, entry: StoredApiKey): RouteAttempt {
  return {
    provider,
    kind: 'byok',
    keyId: entry.id,
    label: entry.label,
    apiKey: entry.key,
  };
}

/**
 * Builds the ordered attempt plan for a task:
 *   Gemini (rotating keys, then optional server key)
 *   → Cerebras (chat only)
 *   → NVIDIA NIM (rotating keys)
 *   → OpenRouter (rotating keys)
 *
 * Providers without a usable key are skipped entirely, so an unconfigured
 * OpenRouter never slows down a request.
 */
export async function buildRoutePlan(task: AiTask): Promise<RouteAttempt[]> {
  const chain = PROVIDER_CHAINS[task];
  const plan: RouteAttempt[] = [];

  for (const provider of chain) {
    if (provider === 'gemini') {
      const geminiCandidates = buildProviderCandidates('gemini');
      const byok = geminiCandidates.filter((candidate) => candidate.kind === 'byok');
      for (const candidate of byok) {
        plan.push(candidate);
      }
      const config = getByokConfig();
      if (config.fallbackToServerKey) {
        const serverAvailable = await checkServerFallbackStatus();
        if (serverAvailable) {
          plan.push({
            provider: 'gemini',
            kind: 'server_fallback',
            keyId: null,
            label: 'Server GEMINI_API_KEY',
            apiKey: null,
          });
        }
      }
      continue;
    }

    for (const entry of listUsableApiKeys(provider)) {
      plan.push(candidateFromStoredKey(provider, entry));
    }
  }

  return plan;
}

function unavailableMessage(task: AiTask, planWasEmpty: boolean): string {
  const chain = PROVIDER_CHAINS[task]
    .map((provider) => PROVIDERS[provider].shortLabel)
    .join(' → ');
  const taskLabel = TASK_LABELS[task].toLowerCase();

  if (planWasEmpty) {
    return (
      `No AI provider is available for ${taskLabel}. Add a key in Settings. ` +
      `Fallback order: ${chain}.`
    );
  }
  return (
    `All configured providers are temporarily exhausted for ${taskLabel} (${chain}). ` +
    'Gemini keys are cooling down after rate/quota limits. Wait a moment, add another key, or reset a cooled-down key in Settings.'
  );
}

/**
 * Runs a task across the provider fallback chain.
 *
 * Key rotation and provider switching rules:
 *  - INVALID_KEY / RATE_LIMIT / QUOTA_EXHAUSTED → cool the key down, try the next key.
 *  - MODEL_UNAVAILABLE → this provider cannot serve the task; move on.
 *  - TIMEOUT / NETWORK_ERROR / SERVER_ERROR → retry the same provider, then move on.
 *  - INVALID_REQUEST / SAFETY_BLOCKED / OFFLINE / ABORTED → stop immediately.
 */
export async function runAiTask<T>(
  params: RunAiTaskParams<T>
): Promise<{ value: T; meta: AiRequestMeta }> {
  ensureOnline();

  const plan = await buildRoutePlan(params.task);
  if (plan.length === 0) {
    throw new AiServiceError(unavailableMessage(params.task, true), 'NO_API_KEY', {
      retryable: false,
    });
  }

  let lastError: AiServiceError | null = null;

  for (const attempt of plan) {
    if (params.signal?.aborted) {
      throw new AiServiceError('Request cancelled.', 'ABORTED', {
        provider: attempt.provider,
        retryable: false,
      });
    }

    let transientAttempts = 0;

    // Key-level loop: one candidate may be retried for transient failures.
    for (;;) {
      try {
        const result = await params.execute(attempt);
        const value = params.validate ? params.validate(result.value) : result.value;

        if (attempt.keyId) {
          recordApiKeySuccess(attempt.keyId);
        }

        return {
          value,
          meta: {
            provider: attempt.provider,
            model: result.model,
            keySource: attempt.kind,
            keyLabel: attempt.label,
          },
        };
      } catch (rawError) {
        const error = isAiServiceError(rawError)
          ? rawError
          : new AiServiceError(
              rawError instanceof Error ? rawError.message : 'AI request failed.',
              'UNKNOWN',
              { provider: attempt.provider, retryable: true }
            );

        if (NON_ROTATABLE_CODES.has(error.code)) {
          throw error;
        }

        if (attempt.keyId) {
          recordApiKeyFailure(
            attempt.keyId,
            error.code,
            error.message,
            error.code === 'RATE_LIMIT' || error.code === 'QUOTA_EXHAUSTED'
              ? error.cooldownMs || 60_000
              : error.cooldownMs
          );
        }

        lastError = error;

        // Structured-output validation failures are model-level: another key
        // on the same provider will not help, so advance to the next provider.
        if (error.code === 'VALIDATION_ERROR') {
          break;
        }

        if (
          TRANSIENT_CODES.has(error.code) &&
          transientAttempts < MAX_TRANSIENT_ATTEMPTS
        ) {
          transientAttempts += 1;
          await sleep(TRANSIENT_BACKOFF_MS * transientAttempts);
          continue;
        }

        // Invalid key, rate limit, quota, model missing, or transient retries
        // exhausted → move to the next key/provider.
        break;
      }
    }
  }

  throw (
    lastError ??
    new AiServiceError(unavailableMessage(params.task, false), 'PROVIDER_EXHAUSTED', {
      retryable: true,
    })
  );
}

export interface ProviderReadiness {
  provider: AiProvider;
  label: string;
  configured: boolean;
  usableKeys: number;
  savedKeys: number;
  supportsRotation: boolean;
}

/** Synchronous snapshot used by the Settings routing overview. */
export function getProviderReadiness(): ProviderReadiness[] {
  return (Object.keys(PROVIDERS) as AiProvider[]).map((provider) => {
    const savedKeys = listStoredApiKeys(provider).length;
    const usableKeys = listUsableApiKeys(provider).length;
    return {
      provider,
      label: PROVIDERS[provider].shortLabel,
      configured: usableKeys > 0,
      usableKeys,
      savedKeys,
      supportsRotation: PROVIDERS[provider].supportsRotation,
    };
  });
}

/** Chain description for the UI, e.g. "Gemini → Cerebras → NIM → OpenRouter". */
export function describeChain(task: AiTask): string {
  return PROVIDER_CHAINS[task].map((provider) => PROVIDERS[provider].shortLabel).join(' → ');
}
