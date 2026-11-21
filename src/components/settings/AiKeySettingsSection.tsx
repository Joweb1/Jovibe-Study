import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
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
  buildProviderCandidates,
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
import { testProviderApiKey } from '../../services/ai/providerTransport';
import {
  PROVIDERS,
  PROVIDER_CHAINS,
  TASK_LABELS,
  type AiProvider,
  type AiTask,
} from '../../services/ai/providers';
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

const PROVIDER_ORDER: AiProvider[] = ['gemini', 'cerebras', 'nvidia_nim', 'openrouter', 'groq'];
const PROVIDER_POSITION_LABELS: Record<AiProvider, string> = {
  gemini: 'Primary',
  cerebras: '2nd fallback',
  nvidia_nim: '3rd fallback',
  openrouter: '4th fallback',
  groq: 'Audio / 5th fallback',
};
const ALL_TASKS: AiTask[] = ['chat', 'structured_json', 'vision', 'transcription', 'tts'];

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

function statusColorClass(status: ApiKeyStatus): string {
  if (status === 'active') return 'font-medium text-zinc-900 dark:text-zinc-100';
  if (status === 'invalid') return 'font-medium text-red-700 dark:text-red-400';
  if (status === 'cooldown' || status === 'quota_exceeded') return 'text-amber-700 dark:text-amber-400';
  return 'text-zinc-500 dark:text-zinc-400';
}

export const AiKeySettingsSection: React.FC<AiKeySettingsSectionProps> = ({ defaultModel }) => {
  // ── Provider keys state ──────────────────────────────────────────────────
  const [providerKeys, setProviderKeys] = useState<Record<AiProvider, StoredApiKey[]>>(() => ({
    gemini: listStoredApiKeys('gemini'),
    cerebras: listStoredApiKeys('cerebras'),
    nvidia_nim: listStoredApiKeys('nvidia_nim'),
    openrouter: listStoredApiKeys('openrouter'),
    groq: listStoredApiKeys('groq'),
  }));
  const [config, setConfig] = useState<ByokConfig>(() => getByokConfig());
  const [serverFallbackAvailable, setServerFallbackAvailable] = useState<boolean | null>(null);

  // ── Panel collapse state (gemini expanded by default) ────────────────────
  const [collapsedProviders, setCollapsedProviders] = useState<Set<AiProvider>>(
    new Set(['cerebras', 'nvidia_nim', 'openrouter', 'groq'])
  );

  // ── Add key form state ───────────────────────────────────────────────────
  const [addingProvider, setAddingProvider] = useState<AiProvider | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newRawKey, setNewRawKey] = useState('');
  const [showNewKey, setShowNewKey] = useState(false);

  // ── Edit state ───────────────────────────────────────────────────────────
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editRawKey, setEditRawKey] = useState('');
  const [showEditKey, setShowEditKey] = useState(false);

  // ── Confirm states ───────────────────────────────────────────────────────
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmClearProvider, setConfirmClearProvider] = useState<AiProvider | null>(null);

  // ── Test states ──────────────────────────────────────────────────────────
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [testingActive, setTestingActive] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ConnectionTestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Bootstrap ────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    void checkServerFallbackStatus().then((available) => {
      if (mounted) setServerFallbackAvailable(available);
    });
    return () => { mounted = false; };
  }, []);

  const refreshState = () => {
    setProviderKeys({
      gemini: listStoredApiKeys('gemini'),
      cerebras: listStoredApiKeys('cerebras'),
      nvidia_nim: listStoredApiKeys('nvidia_nim'),
      openrouter: listStoredApiKeys('openrouter'),
      groq: listStoredApiKeys('groq'),
    });
    setConfig(getByokConfig());
  };

  const toggleCollapse = (provider: AiProvider) => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  // ── Add key ──────────────────────────────────────────────────────────────
  const handleAddKey = async (e: React.FormEvent, provider: AiProvider) => {
    e.preventDefault();
    setFormError(null);
    setConnectionResult(null);
    setAddingProvider(provider);
    try {
      const created = addStoredApiKey(newLabel, newRawKey, provider);
      setNewLabel('');
      setNewRawKey('');
      setShowNewKey(false);
      refreshState();

      setTestingKeyId(created.id);
      let result: ConnectionTestResult;
      if (provider === 'gemini') {
        const r = await testSpecificApiKey({ rawKey: created.key, keyId: created.id, model: defaultModel });
        result = {
          ok: r.ok,
          sourceLabel: `BYOK: ${created.label}`,
          model: r.model,
          latencyMs: r.latencyMs,
          message: r.ok
            ? `Key "${created.label}" verified on ${r.model} (${r.latencyMs}ms).`
            : r.error || 'Key verification failed.',
        };
      } else {
        const r = await testProviderApiKey({ provider, rawKey: created.key });
        result = {
          ok: r.ok,
          sourceLabel: `${PROVIDERS[provider].shortLabel}: ${created.label}`,
          model: r.model,
          latencyMs: r.latencyMs,
          message: r.ok
            ? `Key "${created.label}" verified on ${r.model} (${r.latencyMs}ms).`
            : r.error || 'Key verification failed.',
        };
      }
      refreshState();
      setConnectionResult(result);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save API key.');
    } finally {
      setAddingProvider(null);
      setTestingKeyId(null);
    }
  };

  // ── Test individual key ──────────────────────────────────────────────────
  const handleTestKey = async (entry: StoredApiKey) => {
    setFormError(null);
    setConnectionResult(null);
    setTestingKeyId(entry.id);
    try {
      let result: ConnectionTestResult;
      if (entry.provider === 'gemini') {
        const r = await testSpecificApiKey({ rawKey: entry.key, keyId: entry.id, model: defaultModel });
        refreshState();
        result = {
          ok: r.ok,
          sourceLabel: `BYOK: ${entry.label}`,
          model: r.model,
          latencyMs: r.latencyMs,
          message: r.ok
            ? `Key "${entry.label}" responded on ${r.model} in ${r.latencyMs}ms.`
            : r.error || 'Key test failed.',
        };
      } else {
        const r = await testProviderApiKey({ provider: entry.provider, rawKey: entry.key });
        refreshState();
        result = {
          ok: r.ok,
          sourceLabel: `${PROVIDERS[entry.provider].shortLabel}: ${entry.label}`,
          model: r.model,
          latencyMs: r.latencyMs,
          message: r.ok
            ? `Key "${entry.label}" responded on ${r.model} in ${r.latencyMs}ms.`
            : r.error || 'Key test failed.',
        };
      }
      setConnectionResult(result);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to test API key.');
    } finally {
      setTestingKeyId(null);
    }
  };

  // ── Test active Gemini connection ────────────────────────────────────────
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
          message: 'No active Gemini key path configured. Add a BYOK key or enable server GEMINI_API_KEY fallback.',
        });
        return;
      }
      const first = activeCandidates[0];
      const r = await testSpecificApiKey({
        rawKey: first.kind === 'byok' ? first.apiKey ?? undefined : undefined,
        keyId: first.keyId ?? undefined,
        model: defaultModel,
      });
      refreshState();
      setConnectionResult({
        ok: r.ok,
        sourceLabel: first.kind === 'byok' ? `BYOK: ${first.label}` : 'Server GEMINI_API_KEY fallback',
        model: r.model,
        latencyMs: r.latencyMs,
        message: r.ok
          ? `Connected via ${first.kind === 'byok' ? `BYOK (${first.label})` : 'server GEMINI_API_KEY'} using ${r.model} (${r.latencyMs}ms).`
          : r.error || 'Connection check failed.',
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to test AI connection.');
    } finally {
      setTestingActive(false);
    }
  };

  // ── Edit ─────────────────────────────────────────────────────────────────
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

  // ── Remove / clear ───────────────────────────────────────────────────────
  const handleRemoveKey = (id: string) => {
    removeStoredApiKey(id);
    setConfirmRemoveId(null);
    if (editingKeyId === id) setEditingKeyId(null);
    refreshState();
  };

  const handleClearProvider = (provider: AiProvider) => {
    clearAllLocalApiKeys(provider);
    setConfirmClearProvider(null);
    setEditingKeyId(null);
    setConnectionResult(null);
    refreshState();
  };

  const handleConfigChange = (patch: Partial<ByokConfig>) => {
    const next = saveByokConfig(patch);
    setConfig(next);
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const geminiCandidates = buildExecutionCandidates();
  const primaryCandidate = geminiCandidates[0] ?? null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <section className="space-y-6 border-t border-zinc-200 dark:border-zinc-800 pt-8">
      {/* Section header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            AI keys & fallback routing
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            All API keys are stored device-locally only — never synced to the cloud.
            Gemini is always tried first; fallbacks activate only when primary keys are exhausted.
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
          Test Gemini connection
        </Button>
      </div>

      {/* Error / result banners */}
      {formError && <ErrorBanner message={formError} onDismiss={() => setFormError(null)} />}
      {connectionResult && (
        <div
          className={`flex items-start justify-between gap-3 rounded-md border px-3.5 py-3 text-xs ${
            connectionResult.ok
              ? 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
              : 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {connectionResult.ok ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-900 dark:text-zinc-100" />
            ) : (
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700 dark:text-red-400" />
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
            className="text-[11px] underline underline-offset-2 opacity-70 hover:opacity-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Fallback chain status ─────────────────────────────────────────── */}
      <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
            Active fallback chains
          </span>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {ALL_TASKS.map((task) => {
            const chain = PROVIDER_CHAINS[task];
            return (
              <div key={task} className="flex flex-wrap items-center gap-x-1 gap-y-1.5 px-4 py-2.5 bg-white dark:bg-zinc-950">
                <span className="text-xs text-zinc-600 dark:text-zinc-400 w-48 shrink-0 font-medium">
                  {TASK_LABELS[task]}
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {chain.map((provider, idx) => {
                    const hasKey = buildProviderCandidates(provider).length > 0;
                    return (
                      <React.Fragment key={provider}>
                        {idx > 0 && (
                          <span className="text-zinc-300 dark:text-zinc-700 text-xs select-none">→</span>
                        )}
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                            hasKey
                              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                              : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600'
                          }`}
                        >
                          {PROVIDERS[provider]?.shortLabel || provider}
                          {hasKey && <Check className="ml-1 h-2.5 w-2.5" />}
                        </span>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Provider panels ───────────────────────────────────────────────── */}
      <div className="space-y-0 divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-md overflow-hidden">
        {PROVIDER_ORDER.map((provider) => {
          const def = PROVIDERS[provider];
          const keys = providerKeys[provider] || [];
          const isCollapsed = collapsedProviders.has(provider);
          const preferredId = config.preferredKeyIds?.[provider] ?? null;
          const keyCount = keys.length;
          const isAddingThis = addingProvider === provider;
          const canAddMore = def.maxKeys === null || keyCount < def.maxKeys;

          return (
            <div key={provider}>
              {/* Panel header */}
              <button
                type="button"
                onClick={() => toggleCollapse(provider)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3.5 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <KeyRound className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
                  <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 truncate">
                    {def.label}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 shrink-0">
                    {PROVIDER_POSITION_LABELS[provider]}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 transition-colors ${
                      keyCount > 0
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    {keyCount > 0 ? `${keyCount} key${keyCount !== 1 ? 's' : ''}` : 'No keys'}
                  </span>
                </div>
                {isCollapsed ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                ) : (
                  <ChevronUp className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                )}
              </button>

              {/* Panel body */}
              {!isCollapsed && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-4 space-y-4">
                  {/* Description + tasks + docs link */}
                  <div className="space-y-1">
                    <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {def.description}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        Tasks: {def.tasks.map((t) => TASK_LABELS[t]).join(', ')}
                      </span>
                      <a
                        href={def.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 underline underline-offset-2"
                      >
                        Get API key
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>

                  {/* Gemini-only: active route + server fallback status */}
                  {provider === 'gemini' && (
                    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-zinc-700 dark:text-zinc-300">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          Active route priority
                        </span>
                        <span className="font-mono text-zinc-950 dark:text-zinc-50">
                          {primaryCandidate
                            ? primaryCandidate.kind === 'byok'
                              ? `BYOK (${primaryCandidate.label})`
                              : 'Server GEMINI_API_KEY fallback'
                            : 'No active route'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-zinc-500 dark:text-zinc-400">
                        <span>Server GEMINI_API_KEY status</span>
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
                  )}

                  {/* Add key form */}
                  {canAddMore && (
                    <form
                      onSubmit={(e) => void handleAddKey(e, provider)}
                      className="space-y-3 rounded-md border border-zinc-200 dark:border-zinc-800 p-3.5 bg-zinc-50/50 dark:bg-zinc-900/30"
                    >
                      <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                        Add {def.shortLabel} API key
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                        <div className="sm:col-span-4">
                          <label htmlFor={`byok-label-${provider}`} className="sr-only">
                            Key label
                          </label>
                          <input
                            id={`byok-label-${provider}`}
                            type="text"
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            placeholder="Label (e.g., Personal Key 1)"
                            maxLength={60}
                            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-300 focus:outline-none"
                          />
                        </div>
                        <div className="relative sm:col-span-6">
                          <label htmlFor={`byok-secret-${provider}`} className="sr-only">
                            API key
                          </label>
                          <input
                            id={`byok-secret-${provider}`}
                            type={showNewKey ? 'text' : 'password'}
                            value={newRawKey}
                            onChange={(e) => setNewRawKey(e.target.value)}
                            placeholder={def.keyPlaceholder}
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-2 pl-3 pr-9 font-mono text-sm text-zinc-950 dark:text-zinc-50 placeholder:font-sans placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-300 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewKey((prev) => !prev)}
                            aria-label={showNewKey ? 'Hide API key' : 'Show API key'}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                          >
                            {showNewKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <div className="sm:col-span-2">
                          <Button
                            type="submit"
                            className="w-full"
                            loading={isAddingThis}
                            disabled={!newRawKey.trim()}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add
                          </Button>
                        </div>
                      </div>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
                        {def.keyHint}
                      </p>
                    </form>
                  )}

                  {/* Cerebras at-capacity notice */}
                  {!canAddMore && provider === 'cerebras' && (
                    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                      Cerebras supports a single key. Remove the existing key to replace it.
                    </div>
                  )}

                  {/* Saved keys list */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Saved keys ({keyCount})
                      </h4>
                      {def.supportsRotation && keyCount > 0 && (
                        <div>
                          {confirmClearProvider === provider ? (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-zinc-600 dark:text-zinc-400">
                                Remove all {def.shortLabel} keys?
                              </span>
                              <button
                                type="button"
                                onClick={() => handleClearProvider(provider)}
                                className="font-medium text-red-700 dark:text-red-400 underline underline-offset-2 hover:text-red-900 dark:hover:text-red-300"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmClearProvider(null)}
                                className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmClearProvider(provider)}
                              className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-2"
                            >
                              Clear all {def.shortLabel} keys
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {keyCount === 0 ? (
                      <div className="border-y border-zinc-100 dark:border-zinc-800 py-4 text-xs text-zinc-400 dark:text-zinc-500">
                        No {def.shortLabel} keys saved on this device.{' '}
                        {provider === 'groq' &&
                          'Groq will serve as fast audio playback (TTS) fallback when a key is saved.'}
                        {provider === 'openrouter' &&
                          'OpenRouter will remain inactive until a key is added.'}
                        {provider === 'gemini' &&
                          'SOTAL Study will use the server GEMINI_API_KEY automatically when fallback is enabled.'}
                      </div>
                    ) : (
                      <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border-y border-zinc-100 dark:border-zinc-800">
                        {keys.map((entry) => {
                          const isPreferred = preferredId === entry.id;
                          const isEditing = editingKeyId === entry.id;
                          const isTesting = testingKeyId === entry.id;
                          const needsReset =
                            entry.status === 'cooldown' ||
                            entry.status === 'quota_exceeded' ||
                            entry.status === 'invalid';

                          return (
                            <div key={entry.id} className="py-3.5 space-y-2.5">
                              {isEditing ? (
                                <div className="space-y-3">
                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div>
                                      <label className="block text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                                        Label
                                      </label>
                                      <input
                                        type="text"
                                        value={editLabel}
                                        onChange={(e) => setEditLabel(e.target.value)}
                                        maxLength={60}
                                        className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-950 dark:text-zinc-50 focus:border-zinc-950 dark:focus:border-zinc-300 focus:outline-none"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-zinc-600 dark:text-zinc-400 mb-1">
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
                                          className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1.5 pl-3 pr-9 font-mono text-sm text-zinc-950 dark:text-zinc-50 focus:border-zinc-950 dark:focus:border-zinc-300 focus:outline-none"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => setShowEditKey((prev) => !prev)}
                                          aria-label={showEditKey ? 'Hide API key' : 'Show API key'}
                                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
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
                                    <Button type="button" size="sm" onClick={() => handleSaveEdit(entry.id)}>
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
                                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm font-medium text-zinc-950 dark:text-zinc-50 truncate">
                                        {entry.label}
                                      </span>
                                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                                        {entry.maskedKey}
                                      </span>
                                      {isPreferred && def.supportsRotation && (
                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                                          <Star className="h-3 w-3 fill-zinc-900 text-zinc-900 dark:fill-zinc-100 dark:text-zinc-100" />
                                          Preferred
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
                                      <span className={statusColorClass(entry.status)}>
                                        {formatStatusLabel(entry)}
                                      </span>
                                      <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>
                                      <span className="text-zinc-500 dark:text-zinc-400">
                                        {formatRelativeTime(entry.lastTestedAtMs)}
                                      </span>
                                    </div>
                                    {entry.lastError && (
                                      <p className="text-xs text-red-700 dark:text-red-400 leading-relaxed">
                                        {entry.lastError}
                                      </p>
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
                                    {def.supportsRotation && !isPreferred && (
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
                                          className="font-medium text-red-700 dark:text-red-400 underline underline-offset-2 hover:text-red-900 dark:hover:text-red-300 cursor-pointer"
                                        >
                                          Delete
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmRemoveId(null)}
                                          className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
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
                                        <Trash2 className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
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
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Security disclosure ───────────────────────────────────────────── */}
      <div className="space-y-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        <p>
          <strong className="font-medium text-zinc-800 dark:text-zinc-200">Local storage only:</strong> All API keys
          are stored solely in this browser&apos;s local storage and sent directly per request.
          They are never written to Firestore, never synced to other devices, and never logged.
        </p>
        <p>
          <strong className="font-medium text-zinc-800 dark:text-zinc-200">Gemini quota note:</strong> Multiple Gemini
          keys from the same Google Cloud project share the same project-level quota. For
          independent rotation capacity, use keys from separate projects.
        </p>
      </div>

      {/* ── Rotation & fallback controls ─────────────────────────────────── */}
      <div className="space-y-3 pt-1">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enableKeyRotation}
            onChange={(e) => handleConfigChange({ enableKeyRotation: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 accent-zinc-950 dark:accent-zinc-100 cursor-pointer"
          />
          <span className="text-sm text-zinc-800 dark:text-zinc-200">
            Automatic BYOK rotation on rate limit or temporary key failure
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              Puts throttled keys in temporary cooldown and tries your next saved key for that
              provider. Never rotates on safety blocks or invalid prompts.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.fallbackToServerKey}
            onChange={(e) => handleConfigChange({ fallbackToServerKey: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 accent-zinc-950 dark:accent-zinc-100 cursor-pointer"
          />
          <span className="text-sm text-zinc-800 dark:text-zinc-200">
            Fall back to server <span className="font-mono text-xs">GEMINI_API_KEY</span> when no
            Gemini BYOK key is available
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              Ensures uninterrupted AI if no personal Gemini key is saved on this device or all
              local Gemini keys are in cooldown.
            </span>
          </span>
        </label>
      </div>
    </section>
  );
};
