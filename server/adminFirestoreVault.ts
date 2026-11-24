import { getDb } from './db.ts';
import { decryptSecret, isEnvEncryptionKeyConfigured } from './crypto.ts';
import {
  getFirebaseConfig,
  getServiceAccountAccessToken,
  isServiceAccountConfigured,
  loadServiceAccount,
} from './firebaseSync.ts';

interface FirestoreValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
}

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

interface AdminApiKeyDbRow {
  id: string;
  provider: string;
  label: string;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  key_mask: string;
  enabled: number;
  status: string;
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

export interface AdminVaultStatus {
  persistentBackend: 'firestore_service_account' | 'firestore_admin_token' | 'local_sqlite_only';
  envEncryptionKeyConfigured: boolean;
  serviceAccountConfigured: boolean;
  lastSyncedAtMs: number;
  hydratedKeyCount: number;
  undecryptableKeyCount: number;
  lastError?: string;
  warning?: string;
}

let lastVaultHydrateMs = 0;
let lastVaultSyncSource: AdminVaultStatus['persistentBackend'] = 'local_sqlite_only';
let lastVaultError: string | undefined;
let hydratedOnce = false;
let hydrateInFlight: Promise<AdminVaultStatus> | null = null;

function getFirestoreBaseUrl(): string {
  const { projectId, firestoreDatabaseId } = getFirebaseConfig();
  const dbSegment = encodeURIComponent(firestoreDatabaseId || '(default)');
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${dbSegment}/documents`;
}

async function resolveVaultAuth(bearerToken?: string): Promise<{
  token: string;
  source: 'firestore_service_account' | 'firestore_admin_token';
} | null> {
  const sa = loadServiceAccount();
  if (sa) {
    const token = await getServiceAccountAccessToken(sa);
    return { token, source: 'firestore_service_account' };
  }
  const cleanBearer = (bearerToken || '').trim();
  if (cleanBearer) {
    return { token: cleanBearer, source: 'firestore_admin_token' };
  }
  return null;
}

function toFsString(val: string): FirestoreValue {
  return { stringValue: String(val ?? '') };
}

function toFsInt(val: number): FirestoreValue {
  return { integerValue: String(Math.trunc(Number.isFinite(val) ? val : 0)) };
}

function toFsBool(val: boolean): FirestoreValue {
  return { booleanValue: Boolean(val) };
}

function fromFsString(v?: FirestoreValue, fallback = ''): string {
  if (!v) return fallback;
  if (typeof v.stringValue === 'string') return v.stringValue;
  return fallback;
}

function fromFsInt(v?: FirestoreValue, fallback = 0): number {
  if (!v) return fallback;
  if (typeof v.integerValue === 'string') {
    const n = Number.parseInt(v.integerValue, 10);
    return Number.isFinite(n) ? n : fallback;
  }
  if (typeof v.doubleValue === 'number' && Number.isFinite(v.doubleValue)) {
    return Math.trunc(v.doubleValue);
  }
  return fallback;
}

function fromFsBool(v?: FirestoreValue, fallback = false): boolean {
  if (!v) return fallback;
  if (typeof v.booleanValue === 'boolean') return v.booleanValue;
  return fallback;
}

function extractDocId(docName: string): string {
  const idx = docName.lastIndexOf('/');
  return idx >= 0 ? docName.slice(idx + 1) : docName;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 8_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function listCollectionDocs(
  collectionPath: string,
  token: string
): Promise<FirestoreDocument[]> {
  const baseUrl = getFirestoreBaseUrl();
  const docs: FirestoreDocument[] = [];
  let pageToken = '';
  let pages = 0;

  while (pages < 10) {
    pages += 1;
    const params = new URLSearchParams({ pageSize: '200' });
    if (pageToken) params.set('pageToken', pageToken);
    const url = `${baseUrl}/${collectionPath}?${params.toString()}`;
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 404) {
      return docs;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Firestore GET ${collectionPath} failed (HTTP ${res.status}): ${body.slice(0, 180)}`);
    }

    const json = (await res.json()) as {
      documents?: FirestoreDocument[];
      nextPageToken?: string;
    };
    if (Array.isArray(json.documents)) {
      docs.push(...json.documents);
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }

  return docs;
}

function encodeAdminKeyFields(row: AdminApiKeyDbRow): Record<string, FirestoreValue> {
  return {
    id: toFsString(row.id),
    provider: toFsString(row.provider),
    label: toFsString(row.label),
    encryptedKey: toFsString(row.encrypted_key),
    iv: toFsString(row.iv),
    authTag: toFsString(row.auth_tag),
    keyMask: toFsString(row.key_mask),
    enabled: toFsBool(Boolean(row.enabled)),
    status: toFsString(row.status),
    cooldownUntilMs: toFsInt(row.cooldown_until_ms ?? 0),
    priority: toFsInt(row.priority),
    totalRequests: toFsInt(row.total_requests),
    failedRequests: toFsInt(row.failed_requests),
    rateLimitHits: toFsInt(row.rate_limit_hits),
    failoverCount: toFsInt(row.failover_count),
    lastUsedAtMs: toFsInt(row.last_used_at_ms ?? 0),
    lastError: toFsString((row.last_error || '').slice(0, 500)),
    createdAtMs: toFsInt(row.created_at_ms),
    updatedAtMs: toFsInt(row.updated_at_ms),
  };
}

function countUndecryptableAdminKeys(): number {
  try {
    const db = getDb();
    const rows = db
      .prepare('SELECT encrypted_key, iv, auth_tag FROM admin_api_keys')
      .all() as Array<{ encrypted_key: string; iv: string; auth_tag: string }>;
    let undecryptable = 0;
    for (const row of rows) {
      try {
        decryptSecret({
          ciphertext: row.encrypted_key,
          iv: row.iv,
          authTag: row.auth_tag,
        });
      } catch {
        undecryptable += 1;
      }
    }
    return undecryptable;
  } catch {
    return 0;
  }
}

export function getAdminVaultStatus(): AdminVaultStatus {
  const envEncryptionKeyConfigured = isEnvEncryptionKeyConfigured();
  const serviceAccountConfigured = isServiceAccountConfigured();
  const db = getDb();
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM admin_api_keys').get() as { cnt?: number };
  const undecryptableKeyCount = countUndecryptableAdminKeys();

  const effectiveBackend: AdminVaultStatus['persistentBackend'] = serviceAccountConfigured
    ? 'firestore_service_account'
    : lastVaultSyncSource === 'firestore_admin_token'
    ? 'firestore_admin_token'
    : 'local_sqlite_only';

  let warning: string | undefined;
  if (undecryptableKeyCount > 0) {
    warning = `${undecryptableKeyCount} stored admin key(s) cannot be decrypted with the current encryption key. Set the original ADMIN_ENCRYPTION_KEY environment variable on your host or delete and re-add those keys.`;
  } else if (!envEncryptionKeyConfigured) {
    warning =
      'ADMIN_ENCRYPTION_KEY is not set in environment variables. On ephemeral hosts like Render Free, set a permanent ADMIN_ENCRYPTION_KEY (e.g. a 32+ char random string) so keys restored from Firestore remain decryptable after restarts.';
  } else if (!serviceAccountConfigured) {
    warning =
      'FIREBASE_SERVICE_ACCOUNT_JSON is not set. Keys are backed up to Firestore whenever you manage them in Admin, but adding FIREBASE_SERVICE_ACCOUNT_JSON lets the server auto-restore keys on cold start before you sign in.';
  }

  return {
    persistentBackend: effectiveBackend,
    envEncryptionKeyConfigured,
    serviceAccountConfigured,
    lastSyncedAtMs: lastVaultHydrateMs,
    hydratedKeyCount: Number(countRow?.cnt ?? 0),
    undecryptableKeyCount,
    ...(lastVaultError ? { lastError: lastVaultError } : {}),
    ...(warning ? { warning } : {}),
  };
}

/**
 * Persists a single encrypted admin API key row (already AES-256-GCM encrypted) to Firestore.
 * Plaintext secrets are NEVER sent to Firestore.
 */
export async function persistAdminKeyToFirestore(
  keyId: string,
  bearerToken?: string
): Promise<{ synced: boolean; error?: string }> {
  try {
    const auth = await resolveVaultAuth(bearerToken);
    if (!auth) {
      return { synced: false, error: 'No Firestore credentials available for vault write.' };
    }

    const db = getDb();
    const row = db
      .prepare('SELECT * FROM admin_api_keys WHERE id = ?')
      .get(keyId) as unknown as AdminApiKeyDbRow | undefined;
    if (!row) {
      return { synced: false, error: 'Admin key not found locally.' };
    }

    const url = `${getFirestoreBaseUrl()}/adminApiKeys/${encodeURIComponent(keyId)}`;
    const res = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: encodeAdminKeyFields(row) }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const msg = `Firestore vault write failed (HTTP ${res.status}): ${errBody.slice(0, 180)}`;
      lastVaultError = msg;
      return { synced: false, error: msg };
    }

    lastVaultSyncSource = auth.source;
    lastVaultHydrateMs = Date.now();
    lastVaultError = undefined;
    return { synced: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Firestore vault write failed.';
    lastVaultError = msg;
    return { synced: false, error: msg };
  }
}

/**
 * Deletes a single admin API key document from Firestore.
 */
export async function deleteAdminKeyFromFirestore(
  keyId: string,
  bearerToken?: string
): Promise<{ synced: boolean; error?: string }> {
  try {
    const auth = await resolveVaultAuth(bearerToken);
    if (!auth) {
      return { synced: false, error: 'No Firestore credentials available for vault delete.' };
    }

    const url = `${getFirestoreBaseUrl()}/adminApiKeys/${encodeURIComponent(keyId)}`;
    const res = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    });

    if (!res.ok && res.status !== 404) {
      const errBody = await res.text().catch(() => '');
      const msg = `Firestore vault delete failed (HTTP ${res.status}): ${errBody.slice(0, 180)}`;
      lastVaultError = msg;
      return { synced: false, error: msg };
    }

    lastVaultSyncSource = auth.source;
    lastVaultHydrateMs = Date.now();
    lastVaultError = undefined;
    return { synced: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Firestore vault delete failed.';
    lastVaultError = msg;
    return { synced: false, error: msg };
  }
}

/**
 * Persists a platform setting (`feature_flags` or `quota_config`) to Firestore `adminSettings/{key}`.
 */
export async function persistPlatformSettingToFirestore(
  settingKey: 'feature_flags' | 'quota_config',
  bearerToken?: string
): Promise<{ synced: boolean; error?: string }> {
  try {
    const auth = await resolveVaultAuth(bearerToken);
    if (!auth) {
      return { synced: false, error: 'No Firestore credentials available for settings write.' };
    }

    const db = getDb();
    const row = db
      .prepare('SELECT key, value_json, updated_at_ms, updated_by FROM platform_settings WHERE key = ?')
      .get(settingKey) as
      | { key: string; value_json: string; updated_at_ms: number; updated_by: string }
      | undefined;

    if (!row) {
      return { synced: false, error: 'Setting not found locally.' };
    }

    const url = `${getFirestoreBaseUrl()}/adminSettings/${encodeURIComponent(settingKey)}`;
    const res = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          key: toFsString(row.key),
          valueJson: toFsString(row.value_json),
          updatedAtMs: toFsInt(row.updated_at_ms),
          updatedBy: toFsString((row.updated_by || 'admin').slice(0, 160)),
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const msg = `Firestore settings write failed (HTTP ${res.status}): ${errBody.slice(0, 180)}`;
      lastVaultError = msg;
      return { synced: false, error: msg };
    }

    lastVaultSyncSource = auth.source;
    lastVaultHydrateMs = Date.now();
    lastVaultError = undefined;
    return { synced: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Firestore settings write failed.';
    lastVaultError = msg;
    return { synced: false, error: msg };
  }
}

/**
 * Hydrates encrypted Admin API keys and Platform Settings from Firestore into local SQLite.
 * Called on server boot (when FIREBASE_SERVICE_ACCOUNT_JSON is configured) and on Admin dashboard
 * loads (using service account or verified Admin ID token).
 */
export async function hydrateAdminVaultFromFirestore(opts?: {
  bearerToken?: string;
  force?: boolean;
}): Promise<AdminVaultStatus> {
  const now = Date.now();
  const minIntervalMs = 30_000;
  if (!opts?.force && hydratedOnce && now - lastVaultHydrateMs < minIntervalMs) {
    return getAdminVaultStatus();
  }
  if (hydrateInFlight) {
    return hydrateInFlight;
  }

  hydrateInFlight = (async () => {
    try {
      const auth = await resolveVaultAuth(opts?.bearerToken);
      if (!auth) {
        return getAdminVaultStatus();
      }

      const [keyDocs, settingDocs] = await Promise.all([
        listCollectionDocs('adminApiKeys', auth.token),
        listCollectionDocs('adminSettings', auth.token),
      ]);

      const db = getDb();

      const selectKeyUpdated = db.prepare(
        'SELECT updated_at_ms FROM admin_api_keys WHERE id = ?'
      );
      const upsertKey = db.prepare(
        `INSERT INTO admin_api_keys (
          id, provider, label, encrypted_key, iv, auth_tag, key_mask,
          enabled, status, cooldown_until_ms, priority,
          total_requests, failed_requests, rate_limit_hits, failover_count,
          last_used_at_ms, last_error, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          provider = excluded.provider,
          label = excluded.label,
          encrypted_key = excluded.encrypted_key,
          iv = excluded.iv,
          auth_tag = excluded.auth_tag,
          key_mask = excluded.key_mask,
          enabled = excluded.enabled,
          status = excluded.status,
          cooldown_until_ms = excluded.cooldown_until_ms,
          priority = excluded.priority,
          total_requests = MAX(admin_api_keys.total_requests, excluded.total_requests),
          failed_requests = MAX(admin_api_keys.failed_requests, excluded.failed_requests),
          rate_limit_hits = MAX(admin_api_keys.rate_limit_hits, excluded.rate_limit_hits),
          failover_count = MAX(admin_api_keys.failover_count, excluded.failover_count),
          last_used_at_ms = CASE
            WHEN COALESCE(admin_api_keys.last_used_at_ms, 0) >= COALESCE(excluded.last_used_at_ms, 0)
            THEN admin_api_keys.last_used_at_ms
            ELSE excluded.last_used_at_ms
          END,
          last_error = excluded.last_error,
          updated_at_ms = excluded.updated_at_ms`
      );

      for (const doc of keyDocs) {
        const f = doc.fields || {};
        const id = fromFsString(f.id) || extractDocId(doc.name);
        const provider = fromFsString(f.provider);
        const encryptedKey = fromFsString(f.encryptedKey);
        const iv = fromFsString(f.iv);
        const authTag = fromFsString(f.authTag);
        if (!id || !provider || !encryptedKey || !iv || !authTag) continue;

        const remoteUpdatedAtMs = fromFsInt(f.updatedAtMs, Date.now());
        const existing = selectKeyUpdated.get(id) as { updated_at_ms?: number } | undefined;
        if (existing && Number(existing.updated_at_ms ?? 0) > remoteUpdatedAtMs) {
          continue;
        }

        const cooldownRaw = fromFsInt(f.cooldownUntilMs, 0);
        const lastUsedRaw = fromFsInt(f.lastUsedAtMs, 0);
        const statusRaw = fromFsString(f.status, 'active');
        const safeStatus =
          statusRaw === 'active' ||
          statusRaw === 'cooldown' ||
          statusRaw === 'quota_exhausted' ||
          statusRaw === 'invalid'
            ? statusRaw
            : 'active';

        upsertKey.run(
          id,
          provider,
          fromFsString(f.label, `${provider.toUpperCase()} Key`),
          encryptedKey,
          iv,
          authTag,
          fromFsString(f.keyMask, '••••••••'),
          fromFsBool(f.enabled, true) ? 1 : 0,
          safeStatus,
          cooldownRaw > 0 ? cooldownRaw : null,
          Math.max(1, Math.min(1000, fromFsInt(f.priority, 100))),
          Math.max(0, fromFsInt(f.totalRequests, 0)),
          Math.max(0, fromFsInt(f.failedRequests, 0)),
          Math.max(0, fromFsInt(f.rateLimitHits, 0)),
          Math.max(0, fromFsInt(f.failoverCount, 0)),
          lastUsedRaw > 0 ? lastUsedRaw : null,
          fromFsString(f.lastError, ''),
          fromFsInt(f.createdAtMs, remoteUpdatedAtMs),
          remoteUpdatedAtMs
        );
      }

      // Hydrate platform settings (feature_flags, quota_config)
      const selectSetting = db.prepare('SELECT updated_at_ms FROM platform_settings WHERE key = ?');
      const upsertSetting = db.prepare(
        `INSERT INTO platform_settings (key, value_json, updated_at_ms, updated_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at_ms = excluded.updated_at_ms,
           updated_by = excluded.updated_by`
      );

      for (const doc of settingDocs) {
        const f = doc.fields || {};
        const key = fromFsString(f.key) || extractDocId(doc.name);
        if (key !== 'feature_flags' && key !== 'quota_config') continue;
        const valueJson = fromFsString(f.valueJson);
        if (!valueJson) continue;
        try {
          JSON.parse(valueJson);
        } catch {
          continue;
        }
        const remoteUpdatedAtMs = fromFsInt(f.updatedAtMs, Date.now());
        const existing = selectSetting.get(key) as { updated_at_ms?: number } | undefined;
        if (existing && Number(existing.updated_at_ms ?? 0) > remoteUpdatedAtMs) {
          continue;
        }
        upsertSetting.run(key, valueJson, remoteUpdatedAtMs, fromFsString(f.updatedBy, 'admin'));
      }

      lastVaultSyncSource = auth.source;
      lastVaultHydrateMs = Date.now();
      hydratedOnce = true;
      lastVaultError = undefined;

      return getAdminVaultStatus();
    } catch (err) {
      lastVaultError = err instanceof Error ? err.message : 'Failed to hydrate admin vault from Firestore.';
      return getAdminVaultStatus();
    } finally {
      hydrateInFlight = null;
    }
  })();

  return hydrateInFlight;
}

/**
 * Triggers a non-blocking background mirror of an admin key's status/usage to Firestore
 * when a service account is configured (e.g. after runtime cooldown/invalid state transitions).
 */
export function scheduleBackgroundKeySync(keyId: string): void {
  if (!isServiceAccountConfigured()) return;
  void persistAdminKeyToFirestore(keyId);
}
