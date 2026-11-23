import type { Request, Response } from 'express';
import {
  isAdminManagedProvider,
  recordAdminKeyFailure,
  recordAdminKeySuccess,
  resolveSharedKeyCandidates,
  shouldRotateAdminKeyForCode,
  type AnyAiProvider,
} from './adminKeyPool.ts';
import { sanitizeErrorMessage } from './crypto.ts';
import { classifyAiError, extractGeminiFallbackMeta } from './geminiService.ts';
import { ProviderRequestError } from './openaiProvider.ts';
import {
  AiAccessError,
  finalizeLogicalRequest,
  normalizeFeatureKey,
  recordAiAttemptLog,
  refundLogicalRequestQuota,
  reserveAiExecution,
  type KeyOrigin,
  type ReservedAiExecution,
} from './quotaService.ts';

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ExecutionContext {
  apiKey: string;
  keySource: 'byok' | 'server_fallback';
  keyOrigin: KeyOrigin;
  adminKeyId: string | null;
}

export interface ExecutionResult<T> {
  payload: T;
  model: string;
  switchedFromModel?: string;
  tokens?: TokenUsage;
}

function getHeaderString(req: Request, name: string): string {
  const val = req.headers[name.toLowerCase()];
  const raw = Array.isArray(val) ? val[0] : val;
  return typeof raw === 'string' ? raw.trim() : '';
}

function isByokOnlyRequest(req: Request): boolean {
  const val = getHeaderString(req, 'x-sotal-byok-only').toLowerCase();
  return val === '1' || val === 'true';
}

export function extractGeminiTokenUsage(response: unknown): TokenUsage {
  if (!response || typeof response !== 'object') return {};
  const usage = (response as { usageMetadata?: Record<string, unknown> }).usageMetadata;
  if (!usage || typeof usage !== 'object') return {};
  const inputTokens = Number(usage.promptTokenCount ?? 0) || 0;
  const outputTokens = Number(usage.candidatesTokenCount ?? 0) || 0;
  const totalTokens = Number(usage.totalTokenCount ?? inputTokens + outputTokens) || 0;
  return { inputTokens, outputTokens, totalTokens };
}

export function extractOpenAiTokenUsage(usage: unknown): TokenUsage {
  if (!usage || typeof usage !== 'object') return {};
  const rec = usage as Record<string, unknown>;
  const inputTokens = Number(rec.prompt_tokens ?? rec.input_tokens ?? 0) || 0;
  const outputTokens = Number(rec.completion_tokens ?? rec.output_tokens ?? 0) || 0;
  const totalTokens = Number(rec.total_tokens ?? inputTokens + outputTokens) || 0;
  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Executes an AI route with full backend enforcement:
 *  - Authenticated user check (attached by requireAuth)
 *  - Account status & feature flag checks
 *  - 7-day free access & atomic daily quota reservation (for shared-key requests)
 *  - Personal BYOK pass-through without consuming shared quota
 *  - Automatic Admin API key rotation & multi-key failover (with .env fallback ONLY when no admin keys exist for that provider)
 *  - Complete provider-level telemetry & secret-redacted error reporting
 */
export async function executeProtectedAiRoute<T>(params: {
  req: Request;
  res: Response;
  provider: AnyAiProvider;
  task: string;
  keyHeaderName: 'x-sotal-gemini-key' | 'x-sotal-provider-key';
  run: (ctx: ExecutionContext) => Promise<ExecutionResult<T>>;
}): Promise<{ result: ExecutionResult<T>; keySource: 'byok' | 'server_fallback'; keyOrigin: KeyOrigin; quota: ReservedAiExecution['quotaSnapshot'] } | null> {
  const { req, res, provider, task, keyHeaderName, run } = params;
  const authUser = req.authUser!;
  const personalKey = getHeaderString(req, keyHeaderName);
  const usesPersonalKey = personalKey.length > 0;
  const byokOnly = isByokOnlyRequest(req);
  const feature = normalizeFeatureKey(
    getHeaderString(req, 'x-sotal-feature') || (req.body as Record<string, unknown> | undefined)?.feature,
    task
  );
  const clientLogicalId = getHeaderString(req, 'x-sotal-request-id');

  // If user is in BYOK-only mode without providing a personal key, block immediately
  if (!usesPersonalKey && byokOnly) {
    res.status(503).json({
      error: `No personal ${provider} API key was provided. Add your own key in Settings.`,
      code: 'NO_API_KEY',
      retryable: false,
      shouldRotateKey: false,
      cooldownMs: 0,
      provider,
    });
    return null;
  }

  let reserved: ReservedAiExecution;
  try {
    reserved = reserveAiExecution({
      uid: authUser.uid,
      userEmail: authUser.email,
      feature,
      task,
      usesPersonalKey,
      logicalRequestId: clientLogicalId,
    });
  } catch (err) {
    if (err instanceof AiAccessError) {
      res.status(err.status).json({
        error: err.message,
        code: err.code,
        retryable: err.retryable,
        shouldRotateKey: false,
        cooldownMs: 0,
        provider,
        ...(err.meta ? { meta: err.meta } : {}),
      });
      return null;
    }
    throw err;
  }

  // Attach authoritative quota headers for real-time frontend progress bars
  res.setHeader('x-sotal-quota-used', String(reserved.quotaSnapshot.used));
  res.setHeader('x-sotal-quota-limit', String(reserved.quotaSnapshot.limit));
  res.setHeader('x-sotal-quota-remaining', String(reserved.quotaSnapshot.remaining));
  res.setHeader('x-sotal-quota-reset', reserved.quotaSnapshot.resetAtIso);

  // -------------------------------------------------------------------------
  // Path A: Personal BYOK key (no shared quota consumed, no admin key pool)
  // -------------------------------------------------------------------------
  if (usesPersonalKey) {
    const startMs = Date.now();
    try {
      const result = await run({
        apiKey: personalKey,
        keySource: 'byok',
        keyOrigin: 'personal_byok',
        adminKeyId: null,
      });

      recordAiAttemptLog({
        logicalRequestId: reserved.logicalRequestId,
        uid: authUser.uid,
        userEmail: authUser.email,
        feature,
        task,
        keyOrigin: 'personal_byok',
        provider,
        adminKeyId: null,
        model: result.model,
        status: 'success',
        isLogicalRoot: !reserved.isFailoverReuse,
        isFailover: reserved.isFailoverReuse,
        inputTokens: result.tokens?.inputTokens,
        outputTokens: result.tokens?.outputTokens,
        totalTokens: result.tokens?.totalTokens,
        latencyMs: Date.now() - startMs,
      });

      return {
        result,
        keySource: 'byok',
        keyOrigin: 'personal_byok',
        quota: reserved.quotaSnapshot,
      };
    } catch (err) {
      const classified = classifyProviderOrGeminiError(provider, err, 'byok', [personalKey]);
      recordAiAttemptLog({
        logicalRequestId: reserved.logicalRequestId,
        uid: authUser.uid,
        userEmail: authUser.email,
        feature,
        task,
        keyOrigin: 'personal_byok',
        provider,
        adminKeyId: null,
        status: classified.code === 'RATE_LIMIT' || classified.code === 'QUOTA_EXHAUSTED' ? 'rate_limited' : 'failed',
        isLogicalRoot: !reserved.isFailoverReuse,
        isFailover: reserved.isFailoverReuse,
        latencyMs: Date.now() - startMs,
        errorCode: classified.code,
        errorMessage: classified.message,
        knownSecrets: [personalKey],
      });

      res.status(classified.status).json({
        error: classified.message,
        code: classified.code,
        retryable: classified.retryable,
        shouldRotateKey: classified.shouldRotateKey,
        cooldownMs: classified.cooldownMs,
        provider,
        keySource: 'byok',
        ...(classified.meta ? { meta: classified.meta } : {}),
      });
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Path B: Shared Admin Key Pool (with rotation + failover) -> .env fallback
  // -------------------------------------------------------------------------
  const candidates = resolveSharedKeyCandidates(provider);
  if (candidates.length === 0) {
    // Refund reserved credit only if this was a brand-new logical request with no fallback available on this provider?
    // Keep logical request 'in_flight' so if client's aiRouter fails over to the NEXT provider in the chain
    // using the SAME x-sotal-request-id, it won't charge a second credit!
    recordAiAttemptLog({
      logicalRequestId: reserved.logicalRequestId,
      uid: authUser.uid,
      userEmail: authUser.email,
      feature,
      task,
      keyOrigin: 'shared_admin',
      provider,
      status: 'failed',
      isLogicalRoot: !reserved.isFailoverReuse,
      isFailover: reserved.isFailoverReuse,
      errorCode: 'NO_API_KEY',
      errorMessage: `No healthy shared ${provider} API key is currently available.`,
    });

    res.status(503).json({
      error: `No healthy shared ${provider} API key is currently available. Trying fallback provider or add your own API key in Settings.`,
      code: 'NO_API_KEY',
      retryable: true,
      shouldRotateKey: true,
      cooldownMs: 30_000,
      provider,
      keySource: 'server_fallback',
    });
    return null;
  }

  const allSecrets = candidates.map((c) => c.apiKey);
  let lastClassified: ReturnType<typeof classifyProviderOrGeminiError> | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const hasNextKey = i < candidates.length - 1;
    const isFailoverAttempt = reserved.isFailoverReuse || i > 0;
    const isLogicalRoot = !reserved.isFailoverReuse && i === 0;
    const startMs = Date.now();

    try {
      const result = await run({
        apiKey: candidate.apiKey,
        keySource: 'server_fallback',
        keyOrigin: candidate.keyOrigin,
        adminKeyId: candidate.adminKeyId,
      });

      if (candidate.adminKeyId) {
        recordAdminKeySuccess(candidate.adminKeyId);
      }

      finalizeLogicalRequest({
        logicalRequestId: reserved.logicalRequestId,
        status: 'success',
        keyOrigin: candidate.keyOrigin,
      });

      recordAiAttemptLog({
        logicalRequestId: reserved.logicalRequestId,
        uid: authUser.uid,
        userEmail: authUser.email,
        feature,
        task,
        keyOrigin: candidate.keyOrigin,
        provider,
        adminKeyId: candidate.adminKeyId,
        model: result.model,
        status: 'success',
        isLogicalRoot,
        isFailover: isFailoverAttempt,
        inputTokens: result.tokens?.inputTokens,
        outputTokens: result.tokens?.outputTokens,
        totalTokens: result.tokens?.totalTokens,
        latencyMs: Date.now() - startMs,
      });

      return {
        result,
        keySource: 'server_fallback',
        keyOrigin: candidate.keyOrigin,
        quota: reserved.quotaSnapshot,
      };
    } catch (err) {
      const classified = classifyProviderOrGeminiError(provider, err, 'server_fallback', allSecrets);
      lastClassified = classified;
      const willRotate = hasNextKey && shouldRotateAdminKeyForCode(classified.code);

      if (candidate.adminKeyId && isAdminManagedProvider(provider)) {
        recordAdminKeyFailure(
          candidate.adminKeyId,
          provider,
          classified.code,
          classified.message,
          classified.cooldownMs,
          willRotate
        );
      }

      const logStatus =
        classified.code === 'RATE_LIMIT' || classified.code === 'QUOTA_EXHAUSTED'
          ? 'rate_limited'
          : willRotate
          ? 'failover'
          : 'failed';

      recordAiAttemptLog({
        logicalRequestId: reserved.logicalRequestId,
        uid: authUser.uid,
        userEmail: authUser.email,
        feature,
        task,
        keyOrigin: candidate.keyOrigin,
        provider,
        adminKeyId: candidate.adminKeyId,
        status: logStatus,
        isLogicalRoot,
        isFailover: isFailoverAttempt,
        latencyMs: Date.now() - startMs,
        errorCode: classified.code,
        errorMessage: classified.message,
        knownSecrets: allSecrets,
      });

      if (willRotate) {
        continue;
      }

      // Non-rotatable client errors (e.g., INVALID_REQUEST, SAFETY_BLOCKED) finalize immediately
      if (classified.code === 'INVALID_REQUEST' || classified.code === 'SAFETY_BLOCKED') {
        finalizeLogicalRequest({
          logicalRequestId: reserved.logicalRequestId,
          status: 'failed',
          keyOrigin: candidate.keyOrigin,
        });
      }
      break;
    }
  }

  const finalErr = lastClassified ?? {
    status: 503,
    code: 'SERVER_ERROR',
    message: `${provider} request failed across all available shared keys.`,
    retryable: true,
    shouldRotateKey: true,
    cooldownMs: 30_000,
  };

  // If the client will NOT be able to recover via provider failover (e.g. non-retryable invalid request), don't refund.
  // If all keys failed on a single-provider task like TTS or caller stops, leave in_flight so provider failover reuses same logical credit.
  if (finalErr.code === 'NO_API_KEY') {
    refundLogicalRequestQuota(reserved.logicalRequestId);
  }

  res.status(finalErr.status).json({
    error: finalErr.message,
    code: finalErr.code,
    retryable: finalErr.retryable,
    shouldRotateKey: finalErr.shouldRotateKey,
    cooldownMs: finalErr.cooldownMs,
    provider,
    keySource: 'server_fallback',
    ...('meta' in finalErr && finalErr.meta ? { meta: finalErr.meta } : {}),
  });
  return null;
}

function classifyProviderOrGeminiError(
  provider: AnyAiProvider,
  err: unknown,
  keySource: 'byok' | 'server_fallback',
  knownSecrets: string[]
): {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
  shouldRotateKey: boolean;
  cooldownMs: number;
  meta?: Record<string, unknown>;
} {
  if (err instanceof ProviderRequestError) {
    return {
      status: err.status,
      code: err.code,
      message: sanitizeErrorMessage(err.message, knownSecrets),
      retryable: err.retryable,
      shouldRotateKey:
        err.code === 'INVALID_KEY' ||
        err.code === 'RATE_LIMIT' ||
        err.code === 'QUOTA_EXHAUSTED',
      cooldownMs: err.cooldownMs,
    };
  }

  if (provider === 'gemini') {
    const classified = classifyAiError(err, keySource);
    const fallbackMeta = extractGeminiFallbackMeta(err);
    return {
      ...classified,
      message: sanitizeErrorMessage(classified.message, knownSecrets),
      ...(fallbackMeta ? { meta: { ...fallbackMeta } } : {}),
    };
  }

  return {
    status: 500,
    code: 'SERVER_ERROR',
    message: sanitizeErrorMessage(
      err instanceof Error ? err.message : `${provider} request failed.`,
      knownSecrets
    ),
    retryable: true,
    shouldRotateKey: false,
    cooldownMs: 5_000,
  };
}
