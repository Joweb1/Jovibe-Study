import {
  buildProviderCandidates,
  canUseServerFallbackKey,
  hasUserEnteredOwnKey,
  listAllStoredApiKeys,
  listStoredApiKeys,
  listUsableApiKeys,
  recordApiKeyFailure,
  recordApiKeySuccess,
  type StoredApiKey,
} from './keyManager';
import { emitApiKeyLimitReached } from './keyLimitBus';
import {
  clearAiActivity,
  completeAiActivity,
  guessInitialModelLabel,
  startAiActivity,
} from './aiActivityBus';
import {
  AiServiceError,
  isAiServiceError,
  NON_ROTATABLE_CODES,
  TRANSIENT_CODES,
} from './errors';
import { ensureOnline, sleep } from './http';
import { checkServerFallbackProviders } from './geminiTransport';
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
  /** Optional feature attribution sent to backend telemetry/flags (e.g., tutor, practice_cbt, automatic_study). */
  feature?: string;
  /** Optional primary model hint shown in the subtle live AI model badge before the response arrives. */
  requestedModel?: string;
  signal?: AbortSignal;
  /** Optional post-processing gate (e.g. structured-output schema validation). */
  validate?: (value: T) => T;
  execute: (attempt: RouteAttempt, context: { requestId: string; feature?: string }) => Promise<AiExecuteResult<T>>;
}

let aiOperationSequence = 0;

function formatSwitchReason(code: AiServiceError['code']): string {
  switch (code) {
    case 'RATE_LIMIT':
    case 'QUOTA_EXHAUSTED':
      return 'Limit reached — switching';
    case 'INVALID_KEY':
      return 'Key rejected — switching';
    case 'MODEL_UNAVAILABLE':
      return 'Model unavailable — switching';
    case 'TIMEOUT':
      return 'Timed out — switching';
    default:
      return 'Switching fallback';
  }
}

/** Retries on the same key for transient failures before trying another provider. */
const MAX_TRANSIENT_ATTEMPTS = 2;
const TRANSIENT_BACKOFF_MS = 700;

/**
 * In-memory cooldowns for server `.env` fallback providers so multi-page PDF OCR
 * or back-to-back calls skip a rate-limited `.env` Gemini key immediately and go
 * straight to healthy `.env` fallback providers (e.g., NVIDIA NIM) until cooldown expires.
 */
const serverFallbackCooldowns = new Map<AiProvider, number>();

export function clearServerFallbackCooldowns(): void {
  serverFallbackCooldowns.clear();
}

function isServerFallbackCoolingDown(provider: AiProvider): boolean {
  const until = serverFallbackCooldowns.get(provider);
  if (!until) return false;
  if (until <= Date.now()) {
    serverFallbackCooldowns.delete(provider);
    return false;
  }
  return true;
}

function recordServerFallbackFailure(provider: AiProvider, error: AiServiceError): void {
  const now = Date.now();
  if (error.code === 'RATE_LIMIT' || error.code === 'QUOTA_EXHAUSTED') {
    serverFallbackCooldowns.set(provider, now + Math.max(60_000, error.cooldownMs || 60_000));
    return;
  }
  if (error.code === 'INVALID_KEY' || error.code === 'MODEL_UNAVAILABLE' || error.code === 'NO_API_KEY') {
    serverFallbackCooldowns.set(provider, now + 5 * 60_000);
    return;
  }
  if (error.code === 'SERVER_ERROR' || error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR') {
    serverFallbackCooldowns.set(provider, now + Math.max(15_000, error.cooldownMs || 20_000));
  }
}

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
 *  - Before the user has ever entered any personal API key (`canUseServerFallbackKey() === true`):
 *    uses configured server `.env` keys across the ENTIRE task fallback chain
 *    (e.g., Vision OCR: Gemini (.env) → NVIDIA NIM (.env) → OpenRouter (.env)).
 *  - Once the user has entered ANY personal API key (`hasUserEnteredOwnKey() === true`):
 *    they are permanently banned from using server `.env` keys; ONLY their own
 *    device-local BYOK keys are included in the plan.
 */
export async function buildRoutePlan(task: AiTask): Promise<RouteAttempt[]> {
  const chain = PROVIDER_CHAINS[task];
  const allowServerEnv = canUseServerFallbackKey();

  if (allowServerEnv) {
    const serverProviders = await checkServerFallbackProviders();
    const healthyPlan: RouteAttempt[] = [];
    const coolingPlan: RouteAttempt[] = [];

    for (const provider of chain) {
      if (!serverProviders[provider]) continue;
      const attempt: RouteAttempt = {
        provider,
        kind: 'server_fallback',
        keyId: null,
        label: `Server ${PROVIDERS[provider].shortLabel} (.env)`,
        apiKey: null,
      };
      if (isServerFallbackCoolingDown(provider)) {
        coolingPlan.push(attempt);
      } else {
        healthyPlan.push(attempt);
      }
    }

    // Try non-cooling providers first; only fall back to cooling ones if ALL providers are cooling down
    return healthyPlan.length > 0 ? healthyPlan : coolingPlan;
  }

  // User has entered at least one personal API key -> strictly BYOK only (no .env fallback).
  const plan: RouteAttempt[] = [];
  for (const provider of chain) {
    if (provider === 'gemini') {
      const geminiCandidates = buildProviderCandidates('gemini').filter(
        (candidate) => candidate.kind === 'byok'
      );
      for (const candidate of geminiCandidates) {
        plan.push(candidate);
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
    const chain = PROVIDER_CHAINS[params.task];
    const allSavedForTask = listAllStoredApiKeys().filter((k) => chain.includes(k.provider));
    const hasCoolingOrExhaustedKeys = allSavedForTask.some(
      (k) =>
        k.status === 'quota_exceeded' ||
        k.status === 'cooldown' ||
        (k.cooldownUntilMs !== null && k.cooldownUntilMs > Date.now())
    );
    const msg = unavailableMessage(params.task, !hasCoolingOrExhaustedKeys);
    if (hasUserEnteredOwnKey() && (hasCoolingOrExhaustedKeys || allSavedForTask.length > 0)) {
      emitApiKeyLimitReached({
        provider: allSavedForTask[0]?.provider ?? 'gemini',
        task: params.task,
        reason: 'all_keys_cooling_down',
        message: msg,
      });
    }
    throw new AiServiceError(
      msg,
      hasCoolingOrExhaustedKeys ? 'QUOTA_EXHAUSTED' : 'NO_API_KEY',
      {
        retryable: hasCoolingOrExhaustedKeys,
      }
    );
  }

  const opId = `ai_${Date.now()}_${++aiOperationSequence}`;
  let lastError: AiServiceError | null = null;
  let sawLimitError = false;
  let limitProvider: AiProvider = 'gemini';
  const skippedProviders = new Set<AiProvider>();
  let attemptIndex = 0;
  let completedOp = false;

  try {
    for (const attempt of plan) {
      if (skippedProviders.has(attempt.provider)) {
        continue;
      }

      if (params.signal?.aborted) {
        throw new AiServiceError('Request cancelled.', 'ABORTED', {
          provider: attempt.provider,
          retryable: false,
        });
      }

      const isFallbackAttempt = attempt.provider !== 'gemini' || attemptIndex > 0;
      const modelHint = guessInitialModelLabel(
        attempt.provider,
        params.task,
        params.requestedModel
      );

      startAiActivity({
        id: opId,
        task: params.task,
        provider: attempt.provider,
        model: modelHint,
        keyLabel: attempt.label,
        keySource: attempt.kind,
        isFallback: isFallbackAttempt,
        status: 'running',
      });

      let transientAttempts = 0;

      // Key-level loop: one candidate may be retried for transient failures.
      for (;;) {
        try {
          const result = await params.execute(attempt, {
            requestId: opId,
            feature: params.feature,
          });
          const value = params.validate ? params.validate(result.value) : result.value;

          if (attempt.keyId) {
            recordApiKeySuccess(attempt.keyId);
          } else if (attempt.kind === 'server_fallback') {
            serverFallbackCooldowns.delete(attempt.provider);
          }

          completedOp = true;
          completeAiActivity(opId, {
            task: params.task,
            provider: attempt.provider,
            model: result.model,
            keyLabel: attempt.label,
            keySource: attempt.kind,
            isFallback: isFallbackAttempt,
          });

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

          if (error.code === 'FREE_TRIAL_EXPIRED') {
            emitApiKeyLimitReached({
              provider: attempt.provider,
              task: params.task,
              reason: 'free_trial_expired',
              message: error.message,
            });
            throw error;
          }

          if (error.code === 'SHARED_QUOTA_EXHAUSTED') {
            const meta = error.meta ?? {};
            emitApiKeyLimitReached({
              provider: attempt.provider,
              task: params.task,
              reason: 'shared_quota_exhausted',
              message: error.message,
              quota:
                typeof meta.used === 'number' && typeof meta.limit === 'number'
                  ? {
                      used: meta.used,
                      limit: meta.limit,
                      remaining: typeof meta.remaining === 'number' ? meta.remaining : 0,
                      resetLabel: typeof meta.resetLabel === 'string' ? meta.resetLabel : undefined,
                    }
                  : undefined,
            });
            throw error;
          }

          if (NON_ROTATABLE_CODES.has(error.code)) {
            throw error;
          }

          const isProviderLevelFailure =
            error.code === 'VALIDATION_ERROR' || error.code === 'MODEL_UNAVAILABLE';

          if (attempt.keyId && !isProviderLevelFailure) {
            recordApiKeyFailure(
              attempt.keyId,
              error.code,
              error.message,
              error.code === 'RATE_LIMIT' || error.code === 'QUOTA_EXHAUSTED'
                ? error.cooldownMs || 60_000
                : error.cooldownMs
            );
          }

          if (
            attempt.kind === 'byok' &&
            (error.code === 'RATE_LIMIT' || error.code === 'QUOTA_EXHAUSTED')
          ) {
            sawLimitError = true;
            limitProvider = attempt.provider;
          }

          lastError = error;

          // Structured-output validation and model-unavailable failures are
          // provider/model-level: trying sibling keys on the same provider will
          // not help, so skip the rest of this provider and move to the next.
          if (isProviderLevelFailure) {
            if (attempt.kind === 'server_fallback') {
              recordServerFallbackFailure(attempt.provider, error);
            }
            skippedProviders.add(attempt.provider);
            startAiActivity({
              id: opId,
              task: params.task,
              provider: attempt.provider,
              model: modelHint,
              keyLabel: attempt.label,
              keySource: attempt.kind,
              isFallback: true,
              status: 'switching',
              note: formatSwitchReason(error.code),
            });
            break;
          }

          const hasAnotherCandidateInPlan = plan.some(
            (candidate) =>
              candidate !== attempt &&
              !skippedProviders.has(candidate.provider) &&
              (candidate.provider !== attempt.provider || candidate.keyId !== attempt.keyId)
          );
          const shouldRetryTransient =
            TRANSIENT_CODES.has(error.code) &&
            transientAttempts < MAX_TRANSIENT_ATTEMPTS &&
            !(error.code === 'TIMEOUT' && hasAnotherCandidateInPlan);

          if (shouldRetryTransient) {
            transientAttempts += 1;
            await sleep(TRANSIENT_BACKOFF_MS * transientAttempts);
            continue;
          }

          if (attempt.kind === 'server_fallback') {
            recordServerFallbackFailure(attempt.provider, error);
          }

          startAiActivity({
            id: opId,
            task: params.task,
            provider: attempt.provider,
            model: modelHint,
            keyLabel: attempt.label,
            keySource: attempt.kind,
            isFallback: true,
            status: 'switching',
            note: formatSwitchReason(error.code),
          });

          // Invalid key, rate limit, quota, or transient retries exhausted →
          // move to the next key/provider.
          break;
        }
      }

      attemptIndex += 1;
    }
  } finally {
    if (!completedOp) {
      clearAiActivity(opId);
    }
  }

  const finalError =
    lastError ??
    new AiServiceError(unavailableMessage(params.task, false), 'PROVIDER_EXHAUSTED', {
      retryable: true,
    });

  if (
    hasUserEnteredOwnKey() &&
    (sawLimitError ||
      finalError.code === 'RATE_LIMIT' ||
      finalError.code === 'QUOTA_EXHAUSTED' ||
      finalError.code === 'PROVIDER_EXHAUSTED')
  ) {
    emitApiKeyLimitReached({
      provider: limitProvider,
      task: params.task,
      reason: finalError.code === 'RATE_LIMIT' ? 'rate_limit' : 'quota_exhausted',
      message: finalError.message,
    });
  }

  throw finalError;
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
