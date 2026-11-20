import { generateDocumentId } from '../../utils/validation';

const KEYS_STORAGE_KEY = 'sotal_study_byok_keys_v1';
const CONFIG_STORAGE_KEY = 'sotal_study_byok_config_v1';

export type ApiKeyStatus = 'untested' | 'active' | 'cooldown' | 'invalid' | 'quota_exceeded';

export interface StoredApiKey {
  id: string;
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
  preferredKeyId: string | null;
  enableKeyRotation: boolean;
  fallbackToServerKey: boolean;
}

export interface ExecutionCandidate {
  kind: 'byok' | 'server_fallback';
  keyId: string | null;
  label: string;
  apiKey: string | null;
}

export const DEFAULT_BYOK_CONFIG: ByokConfig = {
  preferredKeyId: null,
  enableKeyRotation: true,
  fallbackToServerKey: true,
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

export function listStoredApiKeys(): StoredApiKey[] {
  const keys = readLocalStorage<StoredApiKey[]>(KEYS_STORAGE_KEY, []);
  const now = Date.now();
  return Array.isArray(keys)
    ? keys.map((k) => {
        if (
          (k.status === 'cooldown' || k.status === 'quota_exceeded') &&
          k.cooldownUntilMs &&
          k.cooldownUntilMs <= now
        ) {
          return { ...k, status: 'active' as const, cooldownUntilMs: null };
        }
        return k;
      })
    : [];
}

function persistKeys(keys: StoredApiKey[]): void {
  writeLocalStorage(KEYS_STORAGE_KEY, keys);
}

export function getByokConfig(): ByokConfig {
  const saved = readLocalStorage<Partial<ByokConfig>>(CONFIG_STORAGE_KEY, {});
  return {
    preferredKeyId: typeof saved.preferredKeyId === 'string' ? saved.preferredKeyId : null,
    enableKeyRotation:
      typeof saved.enableKeyRotation === 'boolean'
        ? saved.enableKeyRotation
        : DEFAULT_BYOK_CONFIG.enableKeyRotation,
    fallbackToServerKey:
      typeof saved.fallbackToServerKey === 'boolean'
        ? saved.fallbackToServerKey
        : DEFAULT_BYOK_CONFIG.fallbackToServerKey,
  };
}

export function saveByokConfig(patch: Partial<ByokConfig>): ByokConfig {
  const next: ByokConfig = {
    ...getByokConfig(),
    ...patch,
  };
  writeLocalStorage(CONFIG_STORAGE_KEY, next);
  return next;
}

export function addStoredApiKey(label: string, rawKey: string): StoredApiKey {
  const cleanKey = rawKey.trim();
  const cleanLabel = label.trim().slice(0, 60) || 'Personal Gemini Key';

  if (cleanKey.length < 16) {
    throw new Error('Please enter a valid Gemini API key obtained from Google AI Studio.');
  }

  const existing = listStoredApiKeys();
  if (existing.some((item) => item.key === cleanKey)) {
    throw new Error('This API key is already saved on this device.');
  }

  const entry: StoredApiKey = {
    id: generateDocumentId('key'),
    label: cleanLabel,
    key: cleanKey,
    maskedKey: maskApiKey(cleanKey),
    status: 'untested',
    cooldownUntilMs: null,
    lastTestedAtMs: null,
    lastError: null,
    createdAtMs: Date.now(),
  };

  const next = [...existing, entry];
  persistKeys(next);

  const config = getByokConfig();
  if (!config.preferredKeyId) {
    saveByokConfig({ preferredKeyId: entry.id });
  }

  return entry;
}

export function updateStoredApiKey(
  id: string,
  updates: { label?: string; rawKey?: string }
): StoredApiKey {
  const existing = listStoredApiKeys();
  const target = existing.find((k) => k.id === id);
  if (!target) throw new Error('API key not found.');

  let nextKey = target.key;
  let nextMasked = target.maskedKey;
  let nextStatus = target.status;
  let nextError = target.lastError;
  let nextCooldown = target.cooldownUntilMs;

  if (updates.rawKey !== undefined && updates.rawKey.trim().length > 0) {
    const cleanKey = updates.rawKey.trim();
    if (cleanKey.length < 16) {
      throw new Error('Replacement Gemini API key looks too short.');
    }
    if (existing.some((item) => item.id !== id && item.key === cleanKey)) {
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
    label: updates.label !== undefined ? updates.label.trim().slice(0, 60) || target.label : target.label,
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
  const existing = listStoredApiKeys();
  const remaining = existing.filter((k) => k.id !== id);
  persistKeys(remaining);

  const config = getByokConfig();
  if (config.preferredKeyId === id) {
    saveByokConfig({ preferredKeyId: remaining[0]?.id ?? null });
  }
}

export function setPreferredApiKey(id: string): void {
  const existing = listStoredApiKeys();
  if (!existing.some((k) => k.id === id)) return;
  saveByokConfig({ preferredKeyId: id });
}

export function recordApiKeySuccess(id: string): void {
  const existing = listStoredApiKeys();
  const now = Date.now();
  const updated = existing.map((k) =>
    k.id === id
      ? {
          ...k,
          status: 'active' as const,
          cooldownUntilMs: null,
          lastTestedAtMs: now,
          lastError: null,
        }
      : k
  );
  persistKeys(updated);
}

export function recordApiKeyFailure(
  id: string,
  code: string,
  errorMessage: string,
  cooldownMs: number
): void {
  const existing = listStoredApiKeys();
  const now = Date.now();
  const updated = existing.map((k) => {
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
    if (code === 'RATE_LIMIT') {
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
  });
  persistKeys(updated);
}

export function clearKeyCooldown(id: string): void {
  const existing = listStoredApiKeys();
  persistKeys(
    existing.map((k) =>
      k.id === id ? { ...k, status: 'untested', cooldownUntilMs: null, lastError: null } : k
    )
  );
}

export function clearAllLocalApiKeys(): void {
  persistKeys([]);
  saveByokConfig({ preferredKeyId: null });
}

/**
 * Builds the ordered execution plan:
 * 1. Preferred device-local BYOK key (if eligible and not invalid/cooling down)
 * 2. Other eligible device-local BYOK keys (if rotation enabled)
 * 3. Server GEMINI_API_KEY fallback (if enabled and no BYOK key succeeded or none configured)
 */
export function buildExecutionCandidates(): ExecutionCandidate[] {
  const keys = listStoredApiKeys();
  const config = getByokConfig();
  const now = Date.now();

  const eligibleByok = keys.filter((k) => {
    if (k.status === 'invalid') return false;
    if (k.cooldownUntilMs && k.cooldownUntilMs > now) return false;
    return true;
  });

  // Sort preferred key first
  eligibleByok.sort((a, b) => {
    if (a.id === config.preferredKeyId) return -1;
    if (b.id === config.preferredKeyId) return 1;
    return a.createdAtMs - b.createdAtMs;
  });

  const candidates: ExecutionCandidate[] = [];

  if (eligibleByok.length > 0) {
    if (config.enableKeyRotation) {
      for (const k of eligibleByok) {
        candidates.push({
          kind: 'byok',
          keyId: k.id,
          label: k.label,
          apiKey: k.key,
        });
      }
    } else {
      const first = eligibleByok[0];
      candidates.push({
        kind: 'byok',
        keyId: first.id,
        label: first.label,
        apiKey: first.key,
      });
    }
  }

  if (config.fallbackToServerKey) {
    candidates.push({
      kind: 'server_fallback',
      keyId: null,
      label: 'Server GEMINI_API_KEY',
      apiKey: null,
    });
  }

  return candidates;
}
