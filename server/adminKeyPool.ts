import { createAdminAlert, createId, getDb } from './db.ts';
import { decryptSecret, encryptSecret, maskApiKey, sanitizeErrorMessage } from './crypto.ts';
import {
  createGeminiClient,
  DEFAULT_MODEL,
  checkSafetyBlock,
  classifyAiError,
  executeGeminiWithModelFallback,
} from './geminiService.ts';
import {
  getProviderDefinition,
  ProviderRequestError,
  testProviderConnection,
  type OpenAiProviderId,
} from './openaiProvider.ts';
import type { KeyOrigin } from './quotaService.ts';
import {
  getEnvKeyPoolSummary,
  getHealthyEnvKeyEntries,
  recordEnvKeyFailure,
  recordEnvKeySuccess,
} from './envKeyPool.ts';
import { scheduleBackgroundKeySync } from './adminFirestoreVault.ts';

export { recordEnvKeySuccess, recordEnvKeyFailure };

/**
 * Supported AI providers for Admin-managed API keys.
 * Explicitly excludes 'cerebras' per specification.
 */
export const ADMIN_MANAGED_PROVIDERS = [
  'gemini',
  'openrouter',
  'groq',
  'cloudflare',
  'nvidia_nim',
] as const;

export type AdminManagedProvider = (typeof ADMIN_MANAGED_PROVIDERS)[number];

export type AnyAiProvider = AdminManagedProvider | 'cerebras';

export function isAdminManagedProvider(value: unknown): value is AdminManagedProvider {
  return (
    value === 'gemini' ||
    value === 'openrouter' ||
    value === 'groq' ||
    value === 'cloudflare' ||
    value === 'nvidia_nim'
  );
}

const MIN_KEY_LENGTH: Record<AdminManagedProvider, number> = {
  gemini: 16,
  openrouter: 20,
  groq: 20,
  cloudflare: 24,
  nvidia_nim: 20,
};

export interface AdminKeyPublicView {
  id: string;
  provider: AdminManagedProvider;
  label: string;
  keyMask: string;
  enabled: boolean;
  status: 'active' | 'cooldown' | 'quota_exhausted' | 'invalid';
  cooldownUntilMs: number | null;
  priority: number;
  totalRequests: number;
  failedRequests: number;
  rateLimitHits: number;
  failoverCount: number;
  lastUsedAtMs: number | null;
  lastError: string;
  undecryptable?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

interface AdminKeyRow {
  id: string;
  provider: AdminManagedProvider;
  label: string;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  key_mask: string;
  enabled: number;
  status: 'active' | 'cooldown' | 'quota_exhausted' | 'invalid';
  cooldown_until_ms: number | null;
  priority: number;
  total_requests: number;
  failed_requests: number;
  rate_limit_hits: number;
  failover_count: number;
  last_used_at_ms: number | null;
  last_error: string;
  created_at_ms: number;
  updated_at_ms: number;
}

function rowToPublicView(row: AdminKeyRow, nowMs = Date.now()): AdminKeyPublicView {
  let status = row.status;
  let cooldownUntilMs = row.cooldown_until_ms ? Number(row.cooldown_until_ms) : null;
  if (
    (status === 'cooldown' || status === 'quota_exhausted') &&
    cooldownUntilMs !== null &&
    cooldownUntilMs <= nowMs
  ) {
    status = 'active';
    cooldownUntilMs = null;
  }

  let undecryptable = false;
  try {
    decryptSecret({
      ciphertext: row.encrypted_key,
      iv: row.iv,
      authTag: row.auth_tag,
    });
  } catch {
    undecryptable = true;
  }

  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    keyMask: row.key_mask,
    enabled: Boolean(row.enabled),
    status,
    cooldownUntilMs,
    priority: Number(row.priority),
    totalRequests: Number(row.total_requests),
    failedRequests: Number(row.failed_requests),
    rateLimitHits: Number(row.rate_limit_hits),
    failoverCount: Number(row.failover_count),
    lastUsedAtMs: row.last_used_at_ms ? Number(row.last_used_at_ms) : null,
    lastError: row.last_error || '',
    ...(undecryptable ? { undecryptable: true } : {}),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

// ---------------------------------------------------------------------------
// CRUD Operations (Never expose decrypted keys!)
// ---------------------------------------------------------------------------

export function listAdminApiKeys(provider?: AdminManagedProvider): AdminKeyPublicView[] {
  const db = getDb();
  const rows = provider
    ? (db
        .prepare(
          'SELECT * FROM admin_api_keys WHERE provider = ? ORDER BY priority ASC, created_at_ms ASC'
        )
        .all(provider) as unknown as AdminKeyRow[])
    : (db
        .prepare(
          'SELECT * FROM admin_api_keys ORDER BY provider ASC, priority ASC, created_at_ms ASC'
        )
        .all() as unknown as AdminKeyRow[]);
  const now = Date.now();
  return rows.map((r) => rowToPublicView(r, now));
}

export function addAdminApiKey(params: {
  provider: string;
  label: string;
  rawKey: string;
  priority?: number;
}): AdminKeyPublicView {
  if (params.provider === 'cerebras') {
    throw new Error('Cerebras is not supported for admin-managed API keys.');
  }
  if (!isAdminManagedProvider(params.provider)) {
    throw new Error(`Unsupported provider "${params.provider}".`);
  }

  const cleanKey = (params.rawKey || '').trim();
  const minLen = MIN_KEY_LENGTH[params.provider];
  if (cleanKey.length < minLen) {
    throw new Error(`API key for ${params.provider} looks too short (minimum ${minLen} characters).`);
  }
  if (params.provider === 'cloudflare' && !cleanKey.includes(':')) {
    throw new Error('Cloudflare Workers AI keys must use the format ACCOUNT_ID:API_TOKEN.');
  }

  const label = (params.label || '').trim().slice(0, 80) || `${params.provider.toUpperCase()} Key`;
  const priority =
    typeof params.priority === 'number' && Number.isFinite(params.priority)
      ? Math.max(1, Math.min(1000, Math.floor(params.priority)))
      : 100;

  const encrypted = encryptSecret(cleanKey);
  const keyMask = maskApiKey(cleanKey);
  const id = createId('akey');
  const now = Date.now();

  const db = getDb();
  db.prepare(
    `INSERT INTO admin_api_keys (
      id, provider, label, encrypted_key, iv, auth_tag, key_mask,
      enabled, status, cooldown_until_ms, priority,
      total_requests, failed_requests, rate_limit_hits, failover_count,
      last_used_at_ms, last_error, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', NULL, ?, 0, 0, 0, 0, NULL, '', ?, ?)`
  ).run(
    id,
    params.provider,
    label,
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.authTag,
    keyMask,
    priority,
    now,
    now
  );

  const created = db
    .prepare('SELECT * FROM admin_api_keys WHERE id = ?')
    .get(id) as unknown as AdminKeyRow;
  return rowToPublicView(created, now);
}

export function updateAdminApiKey(
  id: string,
  patch: { label?: string; enabled?: boolean; priority?: number; resetCooldown?: boolean }
): AdminKeyPublicView {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM admin_api_keys WHERE id = ?')
    .get(id) as unknown as AdminKeyRow | undefined;
  if (!existing) {
    throw new Error('Admin API key not found.');
  }

  const nextLabel =
    typeof patch.label === 'string' && patch.label.trim()
      ? patch.label.trim().slice(0, 80)
      : existing.label;
  const nextEnabled =
    typeof patch.enabled === 'boolean' ? (patch.enabled ? 1 : 0) : existing.enabled;
  const nextPriority =
    typeof patch.priority === 'number' && Number.isFinite(patch.priority)
      ? Math.max(1, Math.min(1000, Math.floor(patch.priority)))
      : existing.priority;
  const nextStatus = patch.resetCooldown ? 'active' : existing.status;
  const nextCooldown = patch.resetCooldown ? null : existing.cooldown_until_ms;
  const nextError = patch.resetCooldown ? '' : existing.last_error;
  const now = Date.now();

  db.prepare(
    `UPDATE admin_api_keys
     SET label = ?, enabled = ?, priority = ?, status = ?, cooldown_until_ms = ?, last_error = ?, updated_at_ms = ?
     WHERE id = ?`
  ).run(nextLabel, nextEnabled, nextPriority, nextStatus, nextCooldown, nextError, now, id);

  const updated = db
    .prepare('SELECT * FROM admin_api_keys WHERE id = ?')
    .get(id) as unknown as AdminKeyRow;
  return rowToPublicView(updated, now);
}

export function deleteAdminApiKey(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM admin_api_keys WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

export async function testAdminApiKeyById(id: string): Promise<{
  ok: boolean;
  provider: AdminManagedProvider;
  model: string;
  latencyMs: number;
  error?: string;
}> {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM admin_api_keys WHERE id = ?')
    .get(id) as unknown as AdminKeyRow | undefined;
  if (!row) {
    throw new Error('Admin API key not found.');
  }

  const rawKey = decryptSecret({
    ciphertext: row.encrypted_key,
    iv: row.iv,
    authTag: row.auth_tag,
  });

  const startMs = Date.now();
  try {
    if (row.provider === 'gemini') {
      const ai = createGeminiClient(rawKey);
      const { result: response, model } = await executeGeminiWithModelFallback({
        primaryModel: DEFAULT_MODEL,
        task: 'text',
        run: (activeModel) =>
          ai.models.generateContent({
            model: activeModel,
            contents: 'Reply with OK.',
          }),
      });
      checkSafetyBlock(response);
      recordAdminKeySuccess(id);
      return {
        ok: true,
        provider: 'gemini',
        model,
        latencyMs: Date.now() - startMs,
      };
    }

    const res = await testProviderConnection({
      provider: row.provider as OpenAiProviderId,
      apiKey: rawKey,
    });
    recordAdminKeySuccess(id);
    return {
      ok: true,
      provider: row.provider,
      model: res.model,
      latencyMs: res.latencyMs,
    };
  } catch (err) {
    const safeMsg = sanitizeErrorMessage(
      err instanceof Error ? err.message : 'Key verification failed.',
      [rawKey]
    );
    const code =
      err instanceof ProviderRequestError
        ? err.code
        : row.provider === 'gemini'
        ? classifyAiError(err, 'server_fallback').code
        : 'INVALID_KEY';
    const cooldownMs =
      err instanceof ProviderRequestError
        ? err.cooldownMs
        : row.provider === 'gemini'
        ? classifyAiError(err, 'server_fallback').cooldownMs
        : 0;
    recordAdminKeyFailure(id, row.provider, code, safeMsg, cooldownMs, false);
    return {
      ok: false,
      provider: row.provider,
      model: row.provider === 'gemini' ? DEFAULT_MODEL : getProviderDefinition(row.provider).models.chat,
      latencyMs: Date.now() - startMs,
      error: safeMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// Key Pool Resolution, Rotation & Automatic Failover
// ---------------------------------------------------------------------------

export interface SharedKeyCandidate {
  apiKey: string;
  keyOrigin: Extract<KeyOrigin, 'shared_admin' | 'shared_env'>;
  adminKeyId: string | null;
  envKeyId: string | null;
  label: string;
}

/**
 * Resolves the ordered list of shared key candidates for a provider.
 * Policy:
 *  - Admin-managed keys ALWAYS take priority over `.env` keys whenever any healthy
 *    decryptable admin key is available for that provider.
 *  - If no healthy admin keys are available for that provider (0 configured, disabled,
 *    undecryptable, or all cooling/invalid), the server falls back to `.env` keys with
 *    full multi-key rotation (`*_KEY`, `*_KEY_1`, `*_KEY_2`, ...) and cooldown tracking.
 *  - Cerebras never has admin keys; uses `.env` multi-key pool if configured.
 *  - Healthy keys are ordered by priority ASC, then least-recently-used (`last_used_at_ms ASC`)
 *    for automatic rotation.
 */
export function resolveSharedKeyCandidates(provider: AnyAiProvider): SharedKeyCandidate[] {
  const now = Date.now();

  if (isAdminManagedProvider(provider)) {
    const db = getDb();
    const enabledRows = db
      .prepare(
        `SELECT * FROM admin_api_keys
         WHERE provider = ? AND enabled = 1
         ORDER BY priority ASC, COALESCE(last_used_at_ms, 0) ASC, created_at_ms ASC`
      )
      .all(provider) as unknown as AdminKeyRow[];

    if (enabledRows.length > 0) {
      const healthy: SharedKeyCandidate[] = [];
      for (const row of enabledRows) {
        if (row.status === 'invalid') continue;
        const cooldownUntil = row.cooldown_until_ms ? Number(row.cooldown_until_ms) : null;
        if (
          (row.status === 'cooldown' || row.status === 'quota_exhausted') &&
          cooldownUntil &&
          cooldownUntil > now
        ) {
          continue;
        }
        // Auto-recover expired cooldowns
        if (
          (row.status === 'cooldown' || row.status === 'quota_exhausted') &&
          cooldownUntil &&
          cooldownUntil <= now
        ) {
          db.prepare(
            "UPDATE admin_api_keys SET status = 'active', cooldown_until_ms = NULL, updated_at_ms = ? WHERE id = ?"
          ).run(now, row.id);
        }
        try {
          const decrypted = decryptSecret({
            ciphertext: row.encrypted_key,
            iv: row.iv,
            authTag: row.auth_tag,
          });
          if (decrypted.trim()) {
            healthy.push({
              apiKey: decrypted.trim(),
              keyOrigin: 'shared_admin',
              adminKeyId: row.id,
              envKeyId: null,
              label: row.label,
            });
          }
        } catch {
          // Skip undecryptable key safely without crashing
        }
      }
      // Admin keys take strict priority whenever at least one healthy admin key is available
      if (healthy.length > 0) {
        return healthy;
      }
    }
  }

  // No healthy admin keys available for this provider -> rotate across configured .env keys
  const envEntries = getHealthyEnvKeyEntries(provider, now);
  if (envEntries.length > 0) {
    return envEntries.map((entry) => ({
      apiKey: entry.apiKey,
      keyOrigin: 'shared_env' as const,
      adminKeyId: null,
      envKeyId: entry.id,
      label: entry.label,
    }));
  }

  return [];
}

/**
 * Returns provider availability map for `/api/health` and the client router
 * (taking both Admin-managed keys AND `.env` fallback into account).
 */
export function getSharedProvidersAvailability(): Record<AnyAiProvider, boolean> {
  const providers: AnyAiProvider[] = [
    'gemini',
    'openrouter',
    'cerebras',
    'groq',
    'cloudflare',
    'nvidia_nim',
  ];
  const out = {} as Record<AnyAiProvider, boolean>;
  for (const p of providers) {
    out[p] = resolveSharedKeyCandidates(p).length > 0;
  }
  return out;
}

export function getProviderKeySourceSummary(): Record<
  AdminManagedProvider,
  {
    adminKeyCount: number;
    activeAdminKeyCount: number;
    envFallbackConfigured: boolean;
    envKeyCount: number;
    activeEnvKeyCount: number;
    envVarNames: string[];
    effectiveSource: 'admin_pool' | 'env_fallback' | 'unconfigured';
  }
> {
  const db = getDb();
  const now = Date.now();
  const result = {} as Record<
    AdminManagedProvider,
    {
      adminKeyCount: number;
      activeAdminKeyCount: number;
      envFallbackConfigured: boolean;
      envKeyCount: number;
      activeEnvKeyCount: number;
      envVarNames: string[];
      effectiveSource: 'admin_pool' | 'env_fallback' | 'unconfigured';
    }
  >;

  for (const provider of ADMIN_MANAGED_PROVIDERS) {
    const rows = db
      .prepare(
        'SELECT enabled, status, cooldown_until_ms, encrypted_key, iv, auth_tag FROM admin_api_keys WHERE provider = ?'
      )
      .all(provider) as Array<{
      enabled: number;
      status: string;
      cooldown_until_ms: number | null;
      encrypted_key: string;
      iv: string;
      auth_tag: string;
    }>;
    const enabledRows = rows.filter((r) => Boolean(r.enabled));
    const activeRows = enabledRows.filter((r) => {
      if (r.status === 'invalid') return false;
      if (
        (r.status === 'cooldown' || r.status === 'quota_exhausted') &&
        r.cooldown_until_ms &&
        Number(r.cooldown_until_ms) > now
      ) {
        return false;
      }
      try {
        decryptSecret({ ciphertext: r.encrypted_key, iv: r.iv, authTag: r.auth_tag });
        return true;
      } catch {
        return false;
      }
    });
    const envSummary = getEnvKeyPoolSummary(provider, now);
    const envConfigured = envSummary.envKeyCount > 0;
    result[provider] = {
      adminKeyCount: rows.length,
      activeAdminKeyCount: activeRows.length,
      envFallbackConfigured: envConfigured,
      envKeyCount: envSummary.envKeyCount,
      activeEnvKeyCount: envSummary.activeEnvKeyCount,
      envVarNames: envSummary.envVarNames,
      effectiveSource:
        activeRows.length > 0
          ? 'admin_pool'
          : envConfigured
          ? 'env_fallback'
          : enabledRows.length > 0
          ? 'admin_pool'
          : 'unconfigured',
    };
  }
  return result;
}

export function recordAdminKeySuccess(adminKeyId: string): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `UPDATE admin_api_keys
     SET status = 'active',
         cooldown_until_ms = NULL,
         last_error = '',
         total_requests = total_requests + 1,
         last_used_at_ms = ?,
         updated_at_ms = ?
     WHERE id = ?`
  ).run(now, now, adminKeyId);
}

export function recordAdminKeyFailure(
  adminKeyId: string,
  provider: AdminManagedProvider,
  code: string,
  errorMessage: string,
  cooldownMs: number,
  didFailover: boolean
): void {
  const db = getDb();
  const now = Date.now();
  const safeErr = sanitizeErrorMessage(errorMessage);
  const isRateLimit = code === 'RATE_LIMIT' || code === 'QUOTA_EXHAUSTED';
  const isInvalid = code === 'INVALID_KEY';

  let nextStatus: 'active' | 'cooldown' | 'quota_exhausted' | 'invalid' = 'active';
  let nextCooldown: number | null = null;

  if (isInvalid) {
    nextStatus = 'invalid';
    createAdminAlert({
      severity: 'critical',
      category: 'key_failure',
      title: `Admin ${provider} API key marked invalid`,
      message: `Key ${adminKeyId} failed authentication: ${safeErr}`,
      metadata: { adminKeyId, provider, code },
      dedupeWindowMs: 60 * 60_000,
    });
  } else if (code === 'QUOTA_EXHAUSTED') {
    nextStatus = 'quota_exhausted';
    nextCooldown = now + Math.max(120_000, cooldownMs || 120_000);
  } else if (code === 'RATE_LIMIT') {
    nextStatus = 'cooldown';
    nextCooldown = now + Math.max(60_000, cooldownMs || 60_000);
  } else if (cooldownMs > 0) {
    nextStatus = 'cooldown';
    nextCooldown = now + cooldownMs;
  }

  db.prepare(
    `UPDATE admin_api_keys
     SET status = ?,
         cooldown_until_ms = ?,
         last_error = ?,
         total_requests = total_requests + 1,
         failed_requests = failed_requests + 1,
         rate_limit_hits = rate_limit_hits + ?,
         failover_count = failover_count + ?,
         last_used_at_ms = ?,
         updated_at_ms = ?
     WHERE id = ?`
  ).run(
    nextStatus,
    nextCooldown,
    safeErr,
    isRateLimit ? 1 : 0,
    didFailover ? 1 : 0,
    now,
    now,
    adminKeyId
  );

  // Persist failure status changes to Firestore vault in background if service account is active
  if (nextStatus !== 'active') {
    scheduleBackgroundKeySync(adminKeyId);
  }

  // Check if all enabled admin keys for this provider are now exhausted/unavailable
  const remainingHealthy = resolveSharedKeyCandidates(provider);
  if (remainingHealthy.length === 0) {
    createAdminAlert({
      severity: 'critical',
      category: 'provider_exhaustion',
      title: `All shared keys exhausted for ${provider}`,
      message: `Every enabled admin key (and any .env fallback keys) for ${provider} is currently cooling down, quota-exhausted, or invalid. Add another key or reset cooldowns in Admin → API Keys.`,
      metadata: { provider, lastCode: code },
      dedupeWindowMs: 15 * 60_000,
    });
  }
}

export function shouldRotateAdminKeyForCode(code: string): boolean {
  return (
    code === 'INVALID_KEY' ||
    code === 'RATE_LIMIT' ||
    code === 'QUOTA_EXHAUSTED' ||
    code === 'SERVER_ERROR' ||
    code === 'TIMEOUT' ||
    code === 'NETWORK_ERROR'
  );
}
