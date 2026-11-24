import { sanitizeErrorMessage } from './crypto.ts';

export type EnvPoolProvider =
  | 'gemini'
  | 'openrouter'
  | 'groq'
  | 'cloudflare'
  | 'nvidia_nim'
  | 'cerebras';

export interface EnvKeyEntry {
  /** Deterministic identifier derived from provider + env variable name (+ index for multi-value lists). */
  id: string;
  provider: EnvPoolProvider;
  /** Secret API key (or ACCOUNT_ID:API_TOKEN for Cloudflare). Never expose in responses/logs. */
  apiKey: string;
  /** Safe human-readable label (uses env var name, never secret content). */
  label: string;
  /** Source env var name (e.g. GEMINI_API_KEY_1). */
  envVarName: string;
}

export interface EnvKeyRuntimeState {
  status: 'active' | 'cooldown' | 'quota_exhausted' | 'invalid';
  cooldownUntilMs: number | null;
  lastUsedAtMs: number;
  totalRequests: number;
  failedRequests: number;
  rateLimitHits: number;
  lastError: string;
}

const runtimeStateMap = new Map<string, EnvKeyRuntimeState>();

function envVal(name: string): string {
  return (process.env[name] || '').trim();
}

export function areServerProviderKeysEnabled(): boolean {
  return envVal('ALLOW_SERVER_PROVIDER_KEYS').toLowerCase() !== 'false';
}

/**
 * Splits a potentially comma- or newline-separated env value into individual non-empty keys.
 */
function splitKeyList(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\r\n,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

interface NumberedVarMatch {
  varName: string;
  index: number;
  value: string;
}

/**
 * Scans `process.env` for numbered variables matching any of the given prefixes, e.g.:
 *   GEMINI_API_KEY_1, GEMINI_API_KEY_2, ..., GEMINI_API_KEY_10
 *   GEMINI_API_KEY1, GEMINI_API_KEY2, ...
 * Sorted ascending by numeric index (1, 2, ..., 10, ...).
 */
function findNumberedEnvVars(prefixes: string[]): NumberedVarMatch[] {
  const regexes = prefixes.map((prefix) => new RegExp(`^${prefix}_?(\\d+)$`, 'i'));
  const matches: NumberedVarMatch[] = [];

  for (const [key, rawVal] of Object.entries(process.env)) {
    const val = (rawVal || '').trim();
    if (!val) continue;
    for (const rx of regexes) {
      const m = key.match(rx);
      if (m) {
        const idx = Number.parseInt(m[1], 10);
        if (Number.isFinite(idx) && idx >= 0) {
          matches.push({ varName: key, index: idx, value: val });
        }
        break;
      }
    }
  }

  matches.sort((a, b) => a.index - b.index || a.varName.localeCompare(b.varName));
  return matches;
}

function resolveCloudflareAccountIdForIndex(index?: number): string {
  if (typeof index === 'number') {
    const numbered =
      envVal(`CLOUDFLARE_ACCOUNT_ID_${index}`) || envVal(`CLOUDFLARE_ACCOUNT_ID${index}`);
    if (numbered) return numbered;
  }
  return envVal('CLOUDFLARE_ACCOUNT_ID');
}

function normalizeCloudflareValue(rawToken: string, index?: number): string {
  const trimmed = rawToken.trim();
  if (!trimmed) return '';
  if (trimmed.includes(':')) {
    const sep = trimmed.indexOf(':');
    const acc = trimmed.slice(0, sep).trim();
    const tok = trimmed.slice(sep + 1).trim();
    return acc && tok ? `${acc}:${tok}` : '';
  }
  const accountId = resolveCloudflareAccountIdForIndex(index);
  return accountId ? `${accountId}:${trimmed}` : '';
}

const PROVIDER_ENV_PATTERNS: Record<
  Exclude<EnvPoolProvider, 'cloudflare'>,
  {
    singleVars: string[];
    listVars: string[];
    numberedPrefixes: string[];
  }
> = {
  gemini: {
    singleVars: ['GEMINI_API_KEY'],
    listVars: ['GEMINI_API_KEYS'],
    numberedPrefixes: ['GEMINI_API_KEY'],
  },
  openrouter: {
    singleVars: ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'],
    listVars: ['OPENROUTER_API_KEYS', 'OPEN_ROUTER_API_KEYS'],
    numberedPrefixes: ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'],
  },
  groq: {
    singleVars: ['GROQ_API_KEY'],
    listVars: ['GROQ_API_KEYS'],
    numberedPrefixes: ['GROQ_API_KEY'],
  },
  nvidia_nim: {
    singleVars: ['NVIDIA_API_KEY'],
    listVars: ['NVIDIA_API_KEYS'],
    numberedPrefixes: ['NVIDIA_API_KEY'],
  },
  cerebras: {
    singleVars: ['CEREBRAS_API_KEY'],
    listVars: ['CEREBRAS_API_KEYS'],
    numberedPrefixes: ['CEREBRAS_API_KEY'],
  },
};

/**
 * Discovers ALL configured `.env` keys for a provider in deterministic order:
 *  1. Base var (e.g. `GEMINI_API_KEY` — also supports comma/newline-separated values)
 *  2. Plural list var (e.g. `GEMINI_API_KEYS`)
 *  3. Numbered vars (e.g. `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, ..., `GEMINI_API_KEY1`, ...)
 *
 * Deduplicates identical secret values while preserving first-seen order and env var label.
 */
export function getEnvKeysForProvider(provider: EnvPoolProvider): EnvKeyEntry[] {
  if (provider !== 'gemini' && !areServerProviderKeysEnabled()) {
    return [];
  }

  const results: EnvKeyEntry[] = [];
  const seenKeys = new Set<string>();

  const pushKey = (apiKey: string, varName: string, listPosition?: number) => {
    const clean = apiKey.trim();
    if (!clean || seenKeys.has(clean)) return;
    seenKeys.add(clean);
    const suffix = typeof listPosition === 'number' ? `#${listPosition + 1}` : '';
    const id = `env:${provider}:${varName}${suffix}`;
    results.push({
      id,
      provider,
      apiKey: clean,
      label: `Server ${provider} (${varName}${suffix})`,
      envVarName: varName,
    });
  };

  if (provider === 'cloudflare') {
    const baseVars = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_API_TOKENS'];
    for (const varName of baseVars) {
      const parts = splitKeyList(envVal(varName));
      parts.forEach((part, idx) => {
        const normalized = normalizeCloudflareValue(part);
        if (normalized) {
          pushKey(normalized, varName, parts.length > 1 ? idx : undefined);
        }
      });
    }

    const numbered = findNumberedEnvVars(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY']);
    for (const match of numbered) {
      const parts = splitKeyList(match.value);
      parts.forEach((part, idx) => {
        const normalized = normalizeCloudflareValue(part, match.index);
        if (normalized) {
          pushKey(normalized, match.varName, parts.length > 1 ? idx : undefined);
        }
      });
    }
    return results;
  }

  const pattern = PROVIDER_ENV_PATTERNS[provider];

  for (const varName of [...pattern.singleVars, ...pattern.listVars]) {
    const parts = splitKeyList(envVal(varName));
    parts.forEach((part, idx) => {
      pushKey(part, varName, parts.length > 1 ? idx : undefined);
    });
  }

  const numbered = findNumberedEnvVars(pattern.numberedPrefixes);
  for (const match of numbered) {
    const parts = splitKeyList(match.value);
    parts.forEach((part, idx) => {
      pushKey(part, match.varName, parts.length > 1 ? idx : undefined);
    });
  }

  return results;
}

/**
 * Returns the first available `.env` key for a provider (for simple single-key callers).
 */
export function getFirstEnvKeyForProvider(provider: EnvPoolProvider): string {
  const healthy = getHealthyEnvKeyEntries(provider);
  if (healthy.length > 0) return healthy[0].apiKey;
  const all = getEnvKeysForProvider(provider);
  return all[0]?.apiKey || '';
}

function getOrInitState(id: string): EnvKeyRuntimeState {
  let st = runtimeStateMap.get(id);
  if (!st) {
    st = {
      status: 'active',
      cooldownUntilMs: null,
      lastUsedAtMs: 0,
      totalRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0,
      lastError: '',
    };
    runtimeStateMap.set(id, st);
  }
  return st;
}

/**
 * Returns healthy `.env` keys for a provider ordered by least-recently-used (`lastUsedAtMs ASC`)
 * so requests automatically rotate across `*_KEY_1`, `*_KEY_2`, `*_KEY_3`, etc., skipping
 * keys currently in cooldown, quota_exhausted, or invalid state.
 */
export function getHealthyEnvKeyEntries(
  provider: EnvPoolProvider,
  nowMs = Date.now()
): EnvKeyEntry[] {
  const all = getEnvKeysForProvider(provider);
  if (all.length === 0) return [];

  const healthyWithOrder: Array<{ entry: EnvKeyEntry; lastUsedAtMs: number; originalIdx: number }> =
    [];

  all.forEach((entry, originalIdx) => {
    const st = getOrInitState(entry.id);

    // Auto-recover expired cooldowns
    if (
      (st.status === 'cooldown' || st.status === 'quota_exhausted') &&
      st.cooldownUntilMs !== null &&
      st.cooldownUntilMs <= nowMs
    ) {
      st.status = 'active';
      st.cooldownUntilMs = null;
    }

    if (st.status === 'invalid') return;
    if (
      (st.status === 'cooldown' || st.status === 'quota_exhausted') &&
      st.cooldownUntilMs !== null &&
      st.cooldownUntilMs > nowMs
    ) {
      return;
    }

    healthyWithOrder.push({
      entry,
      lastUsedAtMs: st.lastUsedAtMs,
      originalIdx,
    });
  });

  // Least-recently-used rotation (0 = never used goes first, preserving original env order on ties)
  healthyWithOrder.sort(
    (a, b) => a.lastUsedAtMs - b.lastUsedAtMs || a.originalIdx - b.originalIdx
  );

  return healthyWithOrder.map((item) => item.entry);
}

export function recordEnvKeySuccess(envKeyId: string, nowMs = Date.now()): void {
  const st = getOrInitState(envKeyId);
  st.status = 'active';
  st.cooldownUntilMs = null;
  st.lastError = '';
  st.totalRequests += 1;
  st.lastUsedAtMs = nowMs;
}

export function recordEnvKeyFailure(
  envKeyId: string,
  code: string,
  errorMessage: string,
  cooldownMs: number,
  nowMs = Date.now()
): void {
  const st = getOrInitState(envKeyId);
  const safeErr = sanitizeErrorMessage(errorMessage);
  st.totalRequests += 1;
  st.failedRequests += 1;
  st.lastUsedAtMs = nowMs;
  st.lastError = safeErr;

  if (code === 'INVALID_KEY') {
    st.status = 'invalid';
    st.cooldownUntilMs = null;
  } else if (code === 'QUOTA_EXHAUSTED') {
    st.status = 'quota_exhausted';
    st.rateLimitHits += 1;
    st.cooldownUntilMs = nowMs + Math.max(120_000, cooldownMs || 120_000);
  } else if (code === 'RATE_LIMIT') {
    st.status = 'cooldown';
    st.rateLimitHits += 1;
    st.cooldownUntilMs = nowMs + Math.max(60_000, cooldownMs || 60_000);
  } else if (cooldownMs > 0) {
    st.status = 'cooldown';
    st.cooldownUntilMs = nowMs + cooldownMs;
  }
}

export function getEnvKeyPoolSummary(
  provider: EnvPoolProvider,
  nowMs = Date.now()
): {
  envKeyCount: number;
  activeEnvKeyCount: number;
  envVarNames: string[];
} {
  const all = getEnvKeysForProvider(provider);
  const active = getHealthyEnvKeyEntries(provider, nowMs);
  return {
    envKeyCount: all.length,
    activeEnvKeyCount: active.length,
    envVarNames: Array.from(new Set(all.map((e) => e.envVarName))),
  };
}

export function resetEnvKeyRuntimeState(): void {
  runtimeStateMap.clear();
}
