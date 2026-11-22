import { generateDocumentId } from '../../utils/validation';
import { PROVIDERS, type AiProvider } from './providers';

const KEYS_STORAGE_KEY = 'sotal_study_byok_keys_v1';
const CONFIG_STORAGE_KEY = 'sotal_study_byok_config_v1';
const STORAGE_SCHEMA_VERSION = 2;

export type ApiKeyStatus = 'untested' | 'active' | 'cooldown' | 'invalid' | 'quota_exceeded';

export interface StoredApiKey {
  id: string;
  /** Provider this key belongs to. Missing on v1 entries and treated as Gemini. */
  provider: AiProvider;
  label: string;
  /** Strictly device-local in browser localStorage. NEVER sent to Firestore or synced. */
  key: string;
  maskedKey: string;
  status: ApiKeyStatus;
  cooldownUntilMs: number | null;
  lastTestedAtMs: number | null;
  lastError: string | null;
  createdAtMs: number;
}

export interface ByokConfig {
  /** Schema version for on-device migrations. */
  version: number;
  preferredKeyId: string | null;
  preferredKeyIds: Partial<Record<AiProvider, string | null>>;
  enableKeyRotation: boolean;
  fallbackToServerKey: boolean;
  /** Once true, the app never falls back to the server env GEMINI_API_KEY again. */
  hasEnteredOwnKey: boolean;
}

export interface ExecutionCandidate {
  provider: AiProvider;
  kind: 'byok' | 'server_fallback';
  keyId: string | null;
  label: string;
  apiKey: string | null;
}

export const DEFAULT_BYOK_CONFIG: ByokConfig = {
  version: STORAGE_SCHEMA_VERSION,
  preferredKeyId: null,
  preferredKeyIds: {},
  enableKeyRotation: true,
  fallbackToServerKey: true,
  hasEnteredOwnKey: false,
};

/** Minimum plausible length per provider (guards against obvious paste errors). */
const MIN_KEY_LENGTH: Record<AiProvider, number> = {
  gemini: 16,
  openrouter: 20,
  cerebras: 16,
  groq: 20,
  cloudflare: 24,
  nvidia_nim: 20,
};

export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function readLocalStorage<T>(storageKey: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalStorage(storageKey: string, value: unknown): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

/**
 * Reads and normalizes stored keys.
 * v1 entries (saved before multi-provider support) have no `provider` field and
 * are migrated in place to Gemini without losing their rotation state.
 */
function readAllKeys(): StoredApiKey[] {
  const raw = readLocalStorage<Array<Partial<StoredApiKey>>>(KEYS_STORAGE_KEY, []);
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw
    .filter((entry): entry is Partial<StoredApiKey> => Boolean(entry) && typeof entry.id === 'string')
    .map((entry) => {
      const provider: AiProvider =
        entry.provider === 'cerebras' ||
        entry.provider === 'nvidia_nim' ||
        entry.provider === 'openrouter' ||
        entry.provider === 'groq' ||
        entry.provider === 'cloudflare'
          ? entry.provider
          : 'gemini';
      const normalized: StoredApiKey = {
        id: entry.id as string,
        provider,
        label: typeof entry.label === 'string' && entry.label.trim() ? entry.label : 'API key',
        key: typeof entry.key === 'string' ? entry.key : '',
        maskedKey:
          typeof entry.maskedKey === 'string' && entry.maskedKey
            ? entry.maskedKey
            : maskApiKey(typeof entry.key === 'string' ? entry.key : ''),
        status: (entry.status as ApiKeyStatus) || 'untested',
        cooldownUntilMs: typeof entry.cooldownUntilMs === 'number' ? entry.cooldownUntilMs : null,
        lastTestedAtMs: typeof entry.lastTestedAtMs === 'number' ? entry.lastTestedAtMs : null,
        lastError: typeof entry.lastError === 'string' ? entry.lastError : null,
        createdAtMs: typeof entry.createdAtMs === 'number' ? entry.createdAtMs : now,
      };
      if (
        (normalized.status === 'cooldown' || normalized.status === 'quota_exceeded') &&
        normalized.cooldownUntilMs &&
        normalized.cooldownUntilMs <= now
      ) {
        return { ...normalized, status: 'active' as const, cooldownUntilMs: null };
      }
      return normalized;
    })
    .filter((entry) => entry.key.length > 0);
}

function persistKeys(keys: StoredApiKey[]): void {
  writeLocalStorage(KEYS_STORAGE_KEY, keys);
}

export function listAllStoredApiKeys(): StoredApiKey[] {
  return readAllKeys().sort((a, b) => a.createdAtMs - b.createdAtMs);
}

export function listStoredApiKeys(provider: AiProvider = 'gemini'): StoredApiKey[] {
  return readAllKeys()
    .filter((key) => key.provider === provider)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
}

export function countStoredApiKeys(provider: AiProvider): number {
  return readAllKeys().filter((key) => key.provider === provider).length;
}

export function getByokConfig(): ByokConfig {
  const saved = readLocalStorage<Partial<ByokConfig>>(CONFIG_STORAGE_KEY, {});
  const preferredKeyIds =
    saved.preferredKeyIds && typeof saved.preferredKeyIds === 'object'
      ? saved.preferredKeyIds
      : {};
  const hasSavedKeys = readAllKeys().length > 0;
  const hasEnteredOwnKey = saved.hasEnteredOwnKey === true || hasSavedKeys;

  return {
    version: STORAGE_SCHEMA_VERSION,
    preferredKeyId:
      typeof saved.preferredKeyId === 'string'
        ? saved.preferredKeyId
        : typeof preferredKeyIds.gemini === 'string'
        ? preferredKeyIds.gemini
        : null,
    preferredKeyIds: {
      ...preferredKeyIds,
      gemini:
        typeof preferredKeyIds.gemini === 'string'
          ? preferredKeyIds.gemini
          : typeof saved.preferredKeyId === 'string'
          ? saved.preferredKeyId
          : null,
    },
    enableKeyRotation:
      typeof saved.enableKeyRotation === 'boolean'
        ? saved.enableKeyRotation
        : DEFAULT_BYOK_CONFIG.enableKeyRotation,
    fallbackToServerKey: hasEnteredOwnKey
      ? false
      : typeof saved.fallbackToServerKey === 'boolean'
      ? saved.fallbackToServerKey
      : DEFAULT_BYOK_CONFIG.fallbackToServerKey,
    hasEnteredOwnKey,
  };
}

export function saveByokConfig(patch: Partial<ByokConfig>): ByokConfig {
  const current = getByokConfig();
  const hasEnteredOwnKey = current.hasEnteredOwnKey || patch.hasEnteredOwnKey === true;
  const next: ByokConfig = {
    ...current,
    ...patch,
    hasEnteredOwnKey,
    // Once a user has entered their own API key, never re-enable server env key fallback
    fallbackToServerKey: hasEnteredOwnKey
      ? false
      : typeof patch.fallbackToServerKey === 'boolean'
      ? patch.fallbackToServerKey
      : current.fallbackToServerKey,
    preferredKeyIds: {
      ...current.preferredKeyIds,
      ...(patch.preferredKeyIds ?? {}),
    },
  };
  writeLocalStorage(CONFIG_STORAGE_KEY, next);
  return next;
}

/** True once the user has added any personal API key on this device. */
export function hasUserEnteredOwnKey(): boolean {
  return getByokConfig().hasEnteredOwnKey;
}

/**
 * True ONLY before the user has ever entered their own API key (e.g. skipped onboarding).
 * Once the user adds their own key, the application never uses the server env key again.
 */
export function canUseServerFallbackKey(): boolean {
  const config = getByokConfig();
  if (config.hasEnteredOwnKey) return false;
  if (readAllKeys().length > 0) return false;
  return config.fallbackToServerKey;
}

export function getPreferredKeyId(provider: AiProvider): string | null {
  return getByokConfig().preferredKeyIds[provider] ?? null;
}

export function addStoredApiKey(
  label: string,
  rawKey: string,
  provider: AiProvider = 'gemini'
): StoredApiKey {
  const cleanKey = rawKey.trim();
  const cleanLabel = label.trim().slice(0, 60) || 'Personal API Key';
  const minLength = MIN_KEY_LENGTH[provider];

  if (cleanKey.length < minLength) {
    throw new Error(
      `This ${provider === 'gemini' ? 'Gemini' : 'provider'} API key looks too short. Paste the full key.`
    );
  }

  const existing = readAllKeys();
  if (existing.some((item) => item.provider === provider && item.key === cleanKey)) {
    throw new Error('This API key is already saved on this device.');
  }

  if (provider === 'cerebras' && existing.some((item) => item.provider === 'cerebras')) {
    throw new Error(
      'Cerebras supports a single key on this device. Remove the saved Cerebras key before adding another.'
    );
  }

  const entry: StoredApiKey = {
    id: generateDocumentId('key'),
    provider,
    label: cleanLabel,
    key: cleanKey,
    maskedKey: maskApiKey(cleanKey),
    status: 'untested',
    cooldownUntilMs: null,
    lastTestedAtMs: null,
    lastError: null,
    createdAtMs: Date.now(),
  };

  persistKeys([...existing, entry]);

  const config = getByokConfig();
  saveByokConfig({
    hasEnteredOwnKey: true,
    fallbackToServerKey: false,
    preferredKeyIds: {
      ...config.preferredKeyIds,
      [provider]: config.preferredKeyIds[provider] ?? entry.id,
    },
    ...(provider === 'gemini' && !config.preferredKeyId ? { preferredKeyId: entry.id } : {}),
  });

  return entry;
}

export function updateStoredApiKey(
  id: string,
  updates: { label?: string; rawKey?: string }
): StoredApiKey {
  const existing = readAllKeys();
  const target = existing.find((k) => k.id === id);
  if (!target) throw new Error('API key not found.');

  let nextKey = target.key;
  let nextMasked = target.maskedKey;
  let nextStatus = target.status;
  let nextError = target.lastError;
  let nextCooldown = target.cooldownUntilMs;

  if (updates.rawKey !== undefined && updates.rawKey.trim().length > 0) {
    const cleanKey = updates.rawKey.trim();
    if (cleanKey.length < MIN_KEY_LENGTH[target.provider]) {
      throw new Error('Replacement API key looks too short.');
    }
    if (
      existing.some(
        (item) => item.id !== id && item.provider === target.provider && item.key === cleanKey
      )
    ) {
      throw new Error('Another saved entry already uses this API key.');
    }
    nextKey = cleanKey;
    nextMasked = maskApiKey(cleanKey);
    nextStatus = 'untested';
    nextError = null;
    nextCooldown = null;
  }

  const updated: StoredApiKey = {
    ...target,
    label:
      updates.label !== undefined ? updates.label.trim().slice(0, 60) || target.label : target.label,
    key: nextKey,
    maskedKey: nextMasked,
    status: nextStatus,
    lastError: nextError,
    cooldownUntilMs: nextCooldown,
  };

  persistKeys(existing.map((k) => (k.id === id ? updated : k)));
  return updated;
}

export function removeStoredApiKey(id: string): void {
  const existing = readAllKeys();
  const target = existing.find((k) => k.id === id);
  const remaining = existing.filter((k) => k.id !== id);
  persistKeys(remaining);

  if (!target) return;
  const config = getByokConfig();
  if (config.preferredKeyIds[target.provider] === id) {
    const nextPreferred = remaining.find((k) => k.provider === target.provider)?.id ?? null;
    saveByokConfig({
      preferredKeyIds: { ...config.preferredKeyIds, [target.provider]: nextPreferred },
      ...(target.provider === 'gemini' ? { preferredKeyId: nextPreferred } : {}),
    });
  }
}

export function setPreferredApiKey(id: string): void {
  const target = readAllKeys().find((k) => k.id === id);
  if (!target) return;
  const config = getByokConfig();
  saveByokConfig({
    preferredKeyIds: { ...config.preferredKeyIds, [target.provider]: id },
    ...(target.provider === 'gemini' ? { preferredKeyId: id } : {}),
  });
}

export function recordApiKeySuccess(id: string): void {
  const existing = readAllKeys();
  const now = Date.now();
  persistKeys(
    existing.map((k) =>
      k.id === id
        ? {
            ...k,
            status: 'active' as const,
            cooldownUntilMs: null,
            lastTestedAtMs: now,
            lastError: null,
          }
        : k
    )
  );
}

export function recordApiKeyFailure(
  id: string,
  code: string,
  errorMessage: string,
  cooldownMs: number
): void {
  const existing = readAllKeys();
  const now = Date.now();
  persistKeys(
    existing.map((k) => {
      if (k.id !== id) return k;
      if (code === 'INVALID_KEY') {
        return {
          ...k,
          status: 'invalid' as const,
          cooldownUntilMs: null,
          lastTestedAtMs: now,
          lastError: errorMessage,
        };
      }
      if (code === 'RATE_LIMIT' || code === 'QUOTA_EXHAUSTED') {
        return {
          ...k,
          status: 'quota_exceeded' as const,
          cooldownUntilMs: now + Math.max(15_000, cooldownMs || 60_000),
          lastTestedAtMs: now,
          lastError: errorMessage,
        };
      }
      if (cooldownMs > 0) {
        return {
          ...k,
          status: 'cooldown' as const,
          cooldownUntilMs: now + cooldownMs,
          lastTestedAtMs: now,
          lastError: errorMessage,
        };
      }
      return {
        ...k,
        lastTestedAtMs: now,
        lastError: errorMessage,
      };
    })
  );
}

export function clearKeyCooldown(id: string): void {
  const existing = readAllKeys();
  persistKeys(
    existing.map((k) =>
      k.id === id ? { ...k, status: 'untested', cooldownUntilMs: null, lastError: null } : k
    )
  );
}

export function clearAllLocalApiKeys(provider: AiProvider = 'gemini'): void {
  persistKeys(readAllKeys().filter((k) => k.provider !== provider));
  const config = getByokConfig();
  saveByokConfig({
    preferredKeyIds: { ...config.preferredKeyIds, [provider]: null },
    ...(provider === 'gemini' ? { preferredKeyId: null } : {}),
  });
}

function isUsable(entry: StoredApiKey): boolean {
  if (entry.status === 'invalid') return false;
  if (entry.cooldownUntilMs && entry.cooldownUntilMs > Date.now()) return false;
  return true;
}

export function listUsableApiKeys(provider: AiProvider): StoredApiKey[] {
  const config = getByokConfig();
  const preferredId = config.preferredKeyIds[provider] ?? null;
  const usable = listStoredApiKeys(provider).filter(isUsable);
  if (!config.enableKeyRotation || !PROVIDERS[provider].supportsRotation) {
    const preferred = usable.find((k) => k.id === preferredId) ?? usable[0];
    return preferred ? [preferred] : [];
  }
  return usable.sort((a, b) => {
    if (a.id === preferredId) return -1;
    if (b.id === preferredId) return 1;
    return a.createdAtMs - b.createdAtMs;
  });
}

export function hasUsableApiKey(provider: AiProvider): boolean {
  return listUsableApiKeys(provider).length > 0;
}

/**
 * Ordered key candidates for a single provider. Gemini can only use the
 * server-managed GEMINI_API_KEY if the user has never entered their own key.
 */
export function buildProviderCandidates(provider: AiProvider): ExecutionCandidate[] {
  const candidates: ExecutionCandidate[] = listUsableApiKeys(provider).map((entry) => ({
    provider,
    kind: 'byok' as const,
    keyId: entry.id,
    label: entry.label,
    apiKey: entry.key,
  }));

  if (provider === 'gemini' && canUseServerFallbackKey()) {
    candidates.push({
      provider,
      kind: 'server_fallback',
      keyId: null,
      label: 'Server GEMINI_API_KEY',
      apiKey: null,
    });
  }

  return candidates;
}

/** Backwards-compatible Gemini-only candidate list used by the Gemini settings UI. */
export function buildExecutionCandidates(): ExecutionCandidate[] {
  return buildProviderCandidates('gemini');
}
