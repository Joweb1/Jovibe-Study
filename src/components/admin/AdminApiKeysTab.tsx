import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Zap,
} from 'lucide-react';
import { apiFetchJson } from '../../services/api/authHeaders';
import { Button } from '../ui/Button';
import {
  ADMIN_PROVIDER_LABELS,
  type AdminApiKeyView,
  type AdminManagedProvider,
  type AdminVaultStatus,
  type ProviderSourceSummary,
} from './adminTypes';

const PROVIDER_LIST: AdminManagedProvider[] = [
  'gemini',
  'openrouter',
  'groq',
  'cloudflare',
  'nvidia_nim',
];

export const AdminApiKeysTab: React.FC = () => {
  const [keys, setKeys] = useState<AdminApiKeyView[]>([]);
  const [providerSources, setProviderSources] = useState<
    Record<AdminManagedProvider, ProviderSourceSummary> | null
  >(null);
  const [vaultStatus, setVaultStatus] = useState<AdminVaultStatus | null>(null);
  const [syncingVault, setSyncingVault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Add key form state
  const [provider, setProvider] = useState<AdminManagedProvider>('gemini');
  const [label, setLabel] = useState('');
  const [rawKey, setRawKey] = useState('');
  const [priority, setPriority] = useState('100');
  const [adding, setAdding] = useState(false);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadKeys = async (forceSync = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetchJson<{
        keys: AdminApiKeyView[];
        providerSources: Record<AdminManagedProvider, ProviderSourceSummary>;
        vaultStatus?: AdminVaultStatus;
      }>(`/api/admin/api-keys${forceSync ? '?forceSync=1' : ''}`);
      setKeys(data.keys || []);
      setProviderSources(data.providerSources || null);
      if (data.vaultStatus) setVaultStatus(data.vaultStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin API keys.');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncVault = async () => {
    setSyncingVault(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiFetchJson<{
        ok: boolean;
        pushed: number;
        keys: AdminApiKeyView[];
        providerSources: Record<AdminManagedProvider, ProviderSourceSummary>;
        vaultStatus?: AdminVaultStatus;
      }>('/api/admin/api-keys/sync-vault', { method: 'POST' });
      setKeys(data.keys || []);
      setProviderSources(data.providerSources || null);
      if (data.vaultStatus) setVaultStatus(data.vaultStatus);
      setNotice(`Synced ${data.keys?.length ?? 0} encrypted admin key(s) with Firestore Cloud Vault.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync keys with Firestore.');
    } finally {
      setSyncingVault(false);
    }
  };

  useEffect(() => {
    void loadKeys();
  }, []);

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawKey.trim()) return;
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetchJson<{
        key: AdminApiKeyView;
        providerSources: Record<AdminManagedProvider, ProviderSourceSummary>;
        vaultSynced?: boolean;
        vaultStatus?: AdminVaultStatus;
      }>('/api/admin/api-keys', {
        method: 'POST',
        body: {
          provider,
          label: label.trim() || `${ADMIN_PROVIDER_LABELS[provider]} Key`,
          apiKey: rawKey.trim(),
          priority: Number(priority) || 100,
        },
      });
      setRawKey('');
      setLabel('');
      if (res.vaultStatus) setVaultStatus(res.vaultStatus);
      setNotice(
        `Encrypted and saved ${res.key.label} (${res.key.keyMask})${
          res.vaultSynced ? ' — backed up to Firestore Cloud Vault.' : '.'
        }`
      );
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add API key.');
    } finally {
      setAdding(false);
    }
  };

  const handleToggleEnabled = async (key: AdminApiKeyView) => {
    setError(null);
    try {
      await apiFetchJson(`/api/admin/api-keys/${encodeURIComponent(key.id)}`, {
        method: 'PATCH',
        body: { enabled: !key.enabled },
      });
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update key.');
    }
  };

  const handleResetCooldown = async (key: AdminApiKeyView) => {
    setError(null);
    try {
      await apiFetchJson(`/api/admin/api-keys/${encodeURIComponent(key.id)}`, {
        method: 'PATCH',
        body: { resetCooldown: true },
      });
      setNotice(`Reset cooldown/status for ${key.label}.`);
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset cooldown.');
    }
  };

  const handleTestKey = async (key: AdminApiKeyView) => {
    setTestingId(key.id);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetchJson<{
        ok: boolean;
        model: string;
        latencyMs: number;
        error?: string;
      }>(`/api/admin/api-keys/${encodeURIComponent(key.id)}/test`, { method: 'POST' });
      if (result.ok) {
        setNotice(`${key.label} verified OK (${result.model} · ${result.latencyMs}ms).`);
      } else {
        setError(`${key.label} verification failed: ${result.error || 'Unknown error'}`);
      }
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key verification failed.');
    } finally {
      setTestingId(null);
    }
  };

  const handleDeleteKey = async (id: string) => {
    setError(null);
    try {
      await apiFetchJson(`/api/admin/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      setNotice('API key permanently removed.');
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete key.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-4 text-xs text-zinc-600 dark:text-zinc-400">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-800 dark:text-zinc-200" />
            <div>
              <span className="font-semibold text-zinc-950 dark:text-zinc-100">
                AES-256-GCM Encrypted Admin Key Pool + Firestore Cloud Vault
              </span>
              <p className="mt-0.5 leading-relaxed">
                Admin-managed keys are encrypted before saving and automatically synced to Firestore so they survive server restarts and redeploys. If no healthy admin keys are available for a provider, the server rotates across configured <code className="font-mono">.env</code> keys (<code className="font-mono">*_API_KEY</code>, <code className="font-mono">*_API_KEY_1</code>, <code className="font-mono">*_API_KEY_2</code>, ...).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSyncVault()}
            disabled={syncingVault}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
          >
            <Cloud className={`h-3.5 w-3.5 ${syncingVault ? 'animate-pulse' : ''}`} />
            {syncingVault ? 'Syncing...' : 'Sync Vault'}
          </button>
        </div>

        {vaultStatus && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-200/80 dark:border-zinc-800 pt-2.5 text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-200">
              <Cloud className="h-3.5 w-3.5" />
              Vault:{' '}
              {vaultStatus.persistentBackend === 'firestore_service_account'
                ? 'Firestore Auto-Restore Active'
                : vaultStatus.persistentBackend === 'firestore_admin_token'
                ? 'Firestore Synced (Admin Token)'
                : 'Local SQLite Only'}
            </span>
            <span>
              Encryption Key:{' '}
              <strong className={vaultStatus.envEncryptionKeyConfigured ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                {vaultStatus.envEncryptionKeyConfigured ? 'Pinned via ADMIN_ENCRYPTION_KEY' : 'Ephemeral local file'}
              </strong>
            </span>
            {vaultStatus.lastSyncedAtMs > 0 && (
              <span className="text-zinc-500">
                Last synced {new Date(vaultStatus.lastSyncedAtMs).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

        {vaultStatus?.warning && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{vaultStatus.warning}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Provider Priority Summary */}
      {providerSources && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {PROVIDER_LIST.map((p) => {
            const info = providerSources[p];
            const envCount = info.envKeyCount ?? (info.envFallbackConfigured ? 1 : 0);
            const activeEnvCount = info.activeEnvKeyCount ?? envCount;
            return (
              <div
                key={p}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3"
              >
                <div className="text-xs font-semibold text-zinc-950 dark:text-zinc-100">
                  {ADMIN_PROVIDER_LABELS[p]}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {info.effectiveSource === 'admin_pool'
                    ? `Admin Pool (${info.activeAdminKeyCount}/${info.adminKeyCount} active)`
                    : info.effectiveSource === 'env_fallback'
                    ? `.env Pool (${activeEnvCount}/${envCount} ${envCount === 1 ? 'key' : 'keys'} active)`
                    : 'Not configured'}
                </div>
                {envCount > 0 && info.effectiveSource === 'admin_pool' && (
                  <div className="mt-0.5 text-[10px] text-zinc-400">
                    Backup: {envCount} .env {envCount === 1 ? 'key' : 'keys'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Key Form */}
      <form
        onSubmit={handleAddKey}
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-100">
          <Plus className="h-4 w-4" />
          Add Shared Admin API Key
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as AdminManagedProvider)}
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-950 dark:text-zinc-100"
            >
              {PROVIDER_LIST.map((p) => (
                <option key={p} value={p}>
                  {ADMIN_PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Label
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Gemini Pool Key #1"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              API Key {provider === 'cloudflare' ? '(ACCOUNT_ID:API_TOKEN)' : ''}
            </label>
            <input
              type="password"
              value={rawKey}
              onChange={(e) => setRawKey(e.target.value)}
              placeholder="Paste secret key..."
              required
              autoComplete="off"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Priority (lower = first)
            </label>
            <input
              type="number"
              min={1}
              max={1000}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-950 dark:text-zinc-100"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={adding} disabled={!rawKey.trim()}>
            <KeyRound className="h-3.5 w-3.5" />
            Encrypt &amp; Add Key
          </Button>
        </div>
      </form>

      {/* Managed Keys Table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
            Stored Admin API Keys ({keys.length})
          </h3>
          <button
            type="button"
            onClick={() => void loadKeys()}
            className="inline-flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {keys.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500">
            {loading
              ? 'Loading keys...'
              : 'No admin-managed API keys added yet. Currently falling back to configured .env keys.'}
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Provider &amp; Label</th>
                <th className="px-4 py-2.5 font-medium">Masked Key</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Usage &amp; Health</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-zinc-950 dark:text-zinc-100">{k.label}</div>
                    <div className="text-[11px] text-zinc-500">
                      {ADMIN_PROVIDER_LABELS[k.provider]} · Priority {k.priority}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                    {k.keyMask}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          k.undecryptable
                            ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                            : !k.enabled
                            ? 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                            : k.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : k.status === 'invalid'
                            ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}
                      >
                        {k.undecryptable ? 'Key mismatch' : !k.enabled ? 'Disabled' : k.status}
                      </span>
                    </div>
                    {k.undecryptable && (
                      <p className="mt-1 max-w-xs text-[10px] text-red-600 dark:text-red-400">
                        Encrypted with a different ADMIN_ENCRYPTION_KEY. Restore original env key or delete &amp; re-add.
                      </p>
                    )}
                    {k.lastError && !k.undecryptable && (
                      <p className="mt-1 max-w-xs truncate text-[10px] text-red-600 dark:text-red-400" title={k.lastError}>
                        {k.lastError}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                    <div>
                      {k.totalRequests} req · {k.failedRequests} err · {k.rateLimitHits} 429s
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      {k.failoverCount} failovers
                      {k.lastUsedAtMs ? ` · Last used ${new Date(k.lastUsedAtMs).toLocaleTimeString()}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleTestKey(k)}
                        disabled={testingId === k.id}
                        className="inline-flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
                      >
                        <Zap className="h-3 w-3" />
                        {testingId === k.id ? 'Testing...' : 'Test'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleEnabled(k)}
                        className="rounded border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                      >
                        {k.enabled ? 'Disable' : 'Enable'}
                      </button>
                      {k.status !== 'active' && (
                        <button
                          type="button"
                          onClick={() => void handleResetCooldown(k)}
                          title="Reset cooldown / invalid state"
                          className="inline-flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reset
                        </button>
                      )}
                      {confirmDeleteId === k.id ? (
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleDeleteKey(k.id)}
                            className="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[11px] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(k.id)}
                          aria-label={`Remove ${k.label}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
