import React, { useEffect, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Star,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  addStoredApiKey,
  buildExecutionCandidates,
  clearAllLocalApiKeys,
  clearKeyCooldown,
  getByokConfig,
  listStoredApiKeys,
  removeStoredApiKey,
  saveByokConfig,
  setPreferredApiKey,
  updateStoredApiKey,
  type ApiKeyStatus,
  type ByokConfig,
  type StoredApiKey,
} from '../../services/ai/keyManager';
import {
  checkServerFallbackStatus,
  testSpecificApiKey,
} from '../../services/ai/geminiClient';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/StateViews';

interface AiKeySettingsSectionProps {
  defaultModel: string;
}

interface ConnectionTestResult {
  ok: boolean;
  sourceLabel: string;
  model: string;
  latencyMs: number;
  message: string;
}

function formatStatusLabel(key: StoredApiKey): string {
  const statusMap: Record<ApiKeyStatus, string> = {
    untested: 'Untested',
    active: 'Verified active',
    cooldown: 'Cooling down',
    invalid: 'Invalid key',
    quota_exceeded: 'Quota cooldown',
  };

  if (key.cooldownUntilMs && key.cooldownUntilMs > Date.now()) {
    const remainingSec = Math.max(1, Math.ceil((key.cooldownUntilMs - Date.now()) / 1000));
    return `${statusMap[key.status]} (${remainingSec}s)`;
  }

  return statusMap[key.status];
}

function formatRelativeTime(timestampMs: number | null): string {
  if (!timestampMs) return 'Never tested';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 10) return 'Tested just now';
  if (diffSec < 60) return `Tested ${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Tested ${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Tested ${diffHr}h ago`;
  return `Tested ${Math.floor(diffHr / 24)}d ago`;
}

export const AiKeySettingsSection: React.FC<AiKeySettingsSectionProps> = ({
  defaultModel,
}) => {
  const [keys, setKeys] = useState<StoredApiKey[]>(() => listStoredApiKeys());
  const [config, setConfig] = useState<ByokConfig>(() => getByokConfig());
  const [serverFallbackAvailable, setServerFallbackAvailable] = useState<boolean | null>(null);

  // Add key form state
  const [newLabel, setNewLabel] = useState('');
  const [newRawKey, setNewRawKey] = useState('');
  const [showNewKey, setShowNewKey] = useState(false);
  const [addingKey, setAddingKey] = useState(false);

  // Edit key state
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editRawKey, setEditRawKey] = useState('');
  const [showEditKey, setShowEditKey] = useState(false);

  // Inline confirmation states (never window.confirm)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Testing states
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [testingActive, setTestingActive] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ConnectionTestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const refreshState = () => {
    setKeys(listStoredApiKeys());
    setConfig(getByokConfig());
  };

  useEffect(() => {
    let mounted = true;
    void checkServerFallbackStatus().then((available) => {
      if (mounted) {
        setServerFallbackAvailable(available);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const candidates = buildExecutionCandidates();
  const primaryCandidate = candidates[0] ?? null;

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setConnectionResult(null);
    setAddingKey(true);
    try {
      const created = addStoredApiKey(newLabel, newRawKey);
      setNewLabel('');
      setNewRawKey('');
      setShowNewKey(false);
      refreshState();

      // Automatically verify the newly added key against Gemini
      setTestingKeyId(created.id);
      const result = await testSpecificApiKey({
        rawKey: created.key,
        keyId: created.id,
        model: defaultModel,
      });
      refreshState();
      setConnectionResult({
        ok: result.ok,
        sourceLabel: `BYOK: ${created.label}`,
        model: result.model,
        latencyMs: result.latencyMs,
        message: result.ok
          ? `Key "${created.label}" verified on ${result.model} (${result.latencyMs}ms).`
          : result.error || 'Key verification failed.',
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save API key.');
    } finally {
      setAddingKey(false);
      setTestingKeyId(null);
    }
  };

  const handleTestKey = async (entry: StoredApiKey) => {
    setFormError(null);
    setConnectionResult(null);
    setTestingKeyId(entry.id);
    try {
      const result = await testSpecificApiKey({
        rawKey: entry.key,
        keyId: entry.id,
        model: defaultModel,
      });
      refreshState();
      setConnectionResult({
        ok: result.ok,
        sourceLabel: `BYOK: ${entry.label}`,
        model: result.model,
        latencyMs: result.latencyMs,
        message: result.ok
          ? `Key "${entry.label}" responded on ${result.model} in ${result.latencyMs}ms.`
          : result.error || 'Key test failed.',
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to test API key.');
    } finally {
      setTestingKeyId(null);
    }
  };

  const handleTestActiveConnection = async () => {
    setFormError(null);
    setConnectionResult(null);
    setTestingActive(true);
    try {
      const activeCandidates = buildExecutionCandidates();
      if (activeCandidates.length === 0) {
        setConnectionResult({
          ok: false,
          sourceLabel: 'None',
          model: defaultModel,
          latencyMs: 0,
          message:
            'No active API key path is configured. Add a BYOK key or enable server GEMINI_API_KEY fallback.',
        });
        return;
      }

      const first = activeCandidates[0];
      const result = await testSpecificApiKey({
        rawKey: first.kind === 'byok' ? first.apiKey ?? undefined : undefined,
        keyId: first.keyId ?? undefined,
        model: defaultModel,
      });
      refreshState();

      setConnectionResult({
        ok: result.ok,
        sourceLabel:
          first.kind === 'byok' ? `BYOK: ${first.label}` : 'Server GEMINI_API_KEY fallback',
        model: result.model,
        latencyMs: result.latencyMs,
        message: result.ok
          ? `Connected via ${
              first.kind === 'byok' ? `BYOK (${first.label})` : 'server GEMINI_API_KEY'
            } using ${result.model} (${result.latencyMs}ms).`
          : result.error || 'Connection check failed.',
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to test AI connection.');
    } finally {
      setTestingActive(false);
    }
  };

  const startEditing = (entry: StoredApiKey) => {
    setEditingKeyId(entry.id);
    setEditLabel(entry.label);
    setEditRawKey('');
    setShowEditKey(false);
    setConfirmRemoveId(null);
    setFormError(null);
  };

  const handleSaveEdit = (id: string) => {
    setFormError(null);
    try {
      updateStoredApiKey(id, {
        label: editLabel,
        rawKey: editRawKey.trim() ? editRawKey : undefined,
      });
      setEditingKeyId(null);
      setEditLabel('');
      setEditRawKey('');
      refreshState();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to update API key.');
    }
  };

  const handleRemoveKey = (id: string) => {
    removeStoredApiKey(id);
    setConfirmRemoveId(null);
    if (editingKeyId === id) {
      setEditingKeyId(null);
    }
    refreshState();
  };

  const handleClearAllKeys = () => {
    clearAllLocalApiKeys();
    setConfirmClearAll(false);
    setEditingKeyId(null);
    setConnectionResult(null);
    refreshState();
  };

  const handleConfigChange = (patch: Partial<ByokConfig>) => {
    const next = saveByokConfig(patch);
    setConfig(next);
  };

  return (
    <section className="space-y-6 border-t border-zinc-200 pt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950">
            AI keys &amp; fallback routing (device-local BYOK)
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            BYOK Gemini keys are prioritized first on this device. When no BYOK key is saved or
            available, requests automatically fall back to the server <span className="font-mono">GEMINI_API_KEY</span>.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={testingActive}
          onClick={() => void handleTestActiveConnection()}
          className="shrink-0"
        >
          <Zap className="h-3.5 w-3.5" />
          Test active connection
        </Button>
      </div>

      {formError && <ErrorBanner message={formError} onDismiss={() => setFormError(null)} />}

      {connectionResult && (
        <div
          className={`flex items-start justify-between gap-3 rounded-md border px-3.5 py-3 text-xs ${
            connectionResult.ok
              ? 'border-zinc-300 bg-zinc-50 text-zinc-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {connectionResult.ok ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-900" />
            ) : (
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700" />
            )}
            <div className="space-y-0.5">
              <div className="font-medium">{connectionResult.message}</div>
              <div className="font-mono text-[11px] opacity-80">
                Route: {connectionResult.sourceLabel} · Model: {connectionResult.model}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setConnectionResult(null)}
            className="text-[11px] underline underline-offset-2 opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Active Route Summary */}
      <div className="border-y border-zinc-200 py-4 space-y-2 text-xs text-zinc-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-zinc-900">Active route priority</span>
          <span className="font-mono text-zinc-950">
            {primaryCandidate
              ? primaryCandidate.kind === 'byok'
                ? `BYOK (${primaryCandidate.label})`
                : 'Server GEMINI_API_KEY fallback'
              : 'No active route'}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-zinc-500">
          <span>Server GEMINI_API_KEY fallback status</span>
          <span className="font-mono">
            {serverFallbackAvailable === null
              ? 'Checking...'
              : serverFallbackAvailable
              ? config.fallbackToServerKey
                ? 'Configured & enabled'
                : 'Configured (disabled locally)'
              : 'Not configured on server'}
          </span>
        </div>
      </div>

      {/* Security & Quota Disclosure */}
      <div className="space-y-1.5 text-xs leading-relaxed text-zinc-500">
        <p>
          <strong className="font-medium text-zinc-800">Local storage only:</strong> Personal API
          keys are stored solely in this browser&apos;s local storage and sent directly per request.
          They are never written to Firestore, never synced to other devices, and never logged.
        </p>
        <p>
          <strong className="font-medium text-zinc-800">Quota note:</strong> Multiple keys created
          within the same Google Cloud project share the same project-level quota. For independent
          rotation capacity, use keys from separate projects.
        </p>
      </div>

      {/* Add Key Form */}
      <form onSubmit={handleAddKey} className="space-y-3 rounded-md border border-zinc-200 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-950">
          <KeyRound className="h-3.5 w-3.5 text-zinc-600" />
          Add personal Gemini API key
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div className="sm:col-span-4">
            <label htmlFor="byok-label" className="sr-only">
              Key label
            </label>
            <input
              id="byok-label"
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label (e.g., Personal Key 1)"
              maxLength={60}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-950 focus:outline-none"
            />
          </div>

          <div className="relative sm:col-span-6">
            <label htmlFor="byok-secret" className="sr-only">
              Gemini API key
            </label>
            <input
              id="byok-secret"
              type={showNewKey ? 'text' : 'password'}
              value={newRawKey}
              onChange={(e) => setNewRawKey(e.target.value)}
              placeholder="Paste Gemini API key (AIza...)"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-3 pr-9 font-mono text-sm text-zinc-950 placeholder:font-sans placeholder:text-zinc-400 focus:border-zinc-950 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowNewKey((prev) => !prev)}
              aria-label={showNewKey ? 'Hide API key' : 'Show API key'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-900"
            >
              {showNewKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <div className="sm:col-span-2">
            <Button
              type="submit"
              className="w-full"
              loading={addingKey}
              disabled={!newRawKey.trim()}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </div>
      </form>

      {/* Saved Keys List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Saved keys on this device ({keys.length})
          </h3>
          {keys.length > 0 && (
            <div>
              {confirmClearAll ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-600">Remove all local keys?</span>
                  <button
                    type="button"
                    onClick={handleClearAllKeys}
                    className="font-medium text-red-700 underline underline-offset-2 hover:text-red-900"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="text-zinc-500 hover:text-zinc-900"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="text-xs text-zinc-500 hover:text-zinc-900 underline underline-offset-2"
                >
                  Clear all local keys
                </button>
              )}
            </div>
          )}
        </div>

        {keys.length === 0 ? (
          <div className="border-y border-zinc-200 py-5 text-xs text-zinc-500">
            No personal BYOK keys saved on this browser. SOTAL Study will use the server{' '}
            <span className="font-mono text-zinc-700">GEMINI_API_KEY</span> automatically when
            fallback is enabled.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 border-y border-zinc-200">
            {keys.map((entry) => {
              const isPreferred = config.preferredKeyId === entry.id;
              const isEditing = editingKeyId === entry.id;
              const isTesting = testingKeyId === entry.id;
              const needsReset =
                entry.status === 'cooldown' ||
                entry.status === 'quota_exceeded' ||
                entry.status === 'invalid';

              return (
                <div key={entry.id} className="py-4 space-y-3">
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs text-zinc-600 mb-1">Label</label>
                          <input
                            type="text"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            maxLength={60}
                            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-600 mb-1">
                            Replace API key (leave blank to keep current)
                          </label>
                          <div className="relative">
                            <input
                              type={showEditKey ? 'text' : 'password'}
                              value={editRawKey}
                              onChange={(e) => setEditRawKey(e.target.value)}
                              placeholder={entry.maskedKey}
                              autoComplete="off"
                              spellCheck={false}
                              className="w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-3 pr-9 font-mono text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setShowEditKey((prev) => !prev)}
                              aria-label={showEditKey ? 'Hide API key' : 'Show API key'}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-900"
                            >
                              {showEditKey ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleSaveEdit(entry.id)}
                        >
                          Save changes
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingKeyId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-zinc-950 truncate">
                            {entry.label}
                          </span>
                          <span className="font-mono text-xs text-zinc-500">
                            {entry.maskedKey}
                          </span>
                          {isPreferred && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-900">
                              <Star className="h-3 w-3 fill-zinc-900 text-zinc-900" />
                              Preferred
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 tabular-nums">
                          <span
                            className={
                              entry.status === 'invalid'
                                ? 'font-medium text-red-700'
                                : entry.status === 'active'
                                ? 'font-medium text-zinc-900'
                                : ''
                            }
                          >
                            {formatStatusLabel(entry)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatRelativeTime(entry.lastTestedAtMs)}</span>
                        </div>
                        {entry.lastError && (
                          <p className="text-xs text-red-700 leading-relaxed">{entry.lastError}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={isTesting}
                          onClick={() => void handleTestKey(entry)}
                        >
                          Test
                        </Button>
                        {!isPreferred && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setPreferredApiKey(entry.id);
                              refreshState();
                            }}
                          >
                            Set preferred
                          </Button>
                        )}
                        {needsReset && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              clearKeyCooldown(entry.id);
                              refreshState();
                            }}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Reset
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => startEditing(entry)}
                          aria-label={`Edit ${entry.label}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {confirmRemoveId === entry.id ? (
                          <div className="flex items-center gap-1.5 pl-1 text-xs">
                            <button
                              type="button"
                              onClick={() => handleRemoveKey(entry.id)}
                              className="font-medium text-red-700 underline underline-offset-2"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRemoveId(null)}
                              className="text-zinc-500 hover:text-zinc-900"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmRemoveId(entry.id)}
                            aria-label={`Remove ${entry.label}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-zinc-500" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rotation & Fallback Controls */}
      <div className="space-y-3 pt-1">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enableKeyRotation}
            onChange={(e) => handleConfigChange({ enableKeyRotation: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-zinc-950 cursor-pointer"
          />
          <span className="text-sm text-zinc-800">
            Automatic BYOK rotation on rate limit or temporary key failure
            <span className="block text-xs text-zinc-500">
              Puts throttled keys in temporary cooldown and tries your next saved local key. Never
              rotates on safety blocks or invalid prompts.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.fallbackToServerKey}
            onChange={(e) => handleConfigChange({ fallbackToServerKey: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-zinc-950 cursor-pointer"
          />
          <span className="text-sm text-zinc-800">
            Fall back to server <span className="font-mono text-xs">GEMINI_API_KEY</span> when no
            BYOK key is available
            <span className="block text-xs text-zinc-500">
              Ensures uninterrupted study if no personal key is saved on this device or all local
              keys are in cooldown.
            </span>
          </span>
        </label>
      </div>
    </section>
  );
};
