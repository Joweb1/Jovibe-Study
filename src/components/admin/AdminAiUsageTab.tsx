import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Clock,
  Cpu,
  Flame,
  RefreshCw,
  RotateCcw,
  Save,
  Sliders,
} from 'lucide-react';
import { apiFetchJson } from '../../services/api/authHeaders';
import { Button } from '../ui/Button';
import {
  FEATURE_LABELS,
  type AdminAiAnalyticsResponse,
  type QuotaConfig,
} from './adminTypes';

interface AdminAiUsageTabProps {
  quotaConfig: QuotaConfig;
  onQuotaConfigUpdated: (next: QuotaConfig) => void;
}

const QUOTA_PRESETS = [10, 20, 30, 50];

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const AdminAiUsageTab: React.FC<AdminAiUsageTabProps> = ({
  quotaConfig,
  onQuotaConfigUpdated,
}) => {
  const [rangePreset, setRangePreset] = useState<'today' | '7d' | '30d' | 'custom'>('30d');
  const [fromDate, setFromDate] = useState(() => toDateInputValue(new Date(Date.now() - 30 * 86_400_000)));
  const [toDate, setToDate] = useState(() => toDateInputValue(new Date()));
  const [originFilter, setOriginFilter] = useState<'all' | 'shared' | 'personal'>('all');

  const [analytics, setAnalytics] = useState<AdminAiAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Global quota config form
  const [dailyQuota, setDailyQuota] = useState(quotaConfig.defaultDailyQuota);
  const [freeDays, setFreeDays] = useState(quotaConfig.defaultFreeAccessDays);
  const [alertPct, setAlertPct] = useState(quotaConfig.excessiveUsageThresholdPct);
  const [hourlyThreshold, setHourlyThreshold] = useState(quotaConfig.abnormalHourlyThreshold);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  useEffect(() => {
    setDailyQuota(quotaConfig.defaultDailyQuota);
    setFreeDays(quotaConfig.defaultFreeAccessDays);
    setAlertPct(quotaConfig.excessiveUsageThresholdPct);
    setHourlyThreshold(quotaConfig.abnormalHourlyThreshold);
  }, [quotaConfig]);

  const applyPreset = (preset: 'today' | '7d' | '30d') => {
    setRangePreset(preset);
    const now = new Date();
    const to = toDateInputValue(now);
    const daysBack = preset === 'today' ? 0 : preset === '7d' ? 7 : 30;
    const from = toDateInputValue(new Date(Date.now() - daysBack * 86_400_000));
    setFromDate(from);
    setToDate(to);
  };

  const loadAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        from: fromDate,
        to: toDate,
        origin: originFilter,
      });
      const data = await apiFetchJson<AdminAiAnalyticsResponse>(
        `/api/admin/analytics/ai-usage?${qs.toString()}`
      );
      setAnalytics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI usage analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAnalytics();
  }, [fromDate, toDate, originFilter]);

  const handleSaveQuotaConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setConfigSaved(false);
    setError(null);
    try {
      const next = await apiFetchJson<QuotaConfig>('/api/admin/quota-config', {
        method: 'PUT',
        body: {
          defaultDailyQuota: Number(dailyQuota),
          defaultFreeAccessDays: Number(freeDays),
          excessiveUsageThresholdPct: Number(alertPct),
          abnormalHourlyThreshold: Number(hourlyThreshold),
        },
      });
      onQuotaConfigUpdated(next);
      setConfigSaved(true);
      window.setTimeout(() => setConfigSaved(false), 3000);
      await loadAnalytics();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save quota configuration.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleResetUserQuota = async (uid: string) => {
    await apiFetchJson(`/api/admin/users/${encodeURIComponent(uid)}/reset-quota`, {
      method: 'POST',
    });
    await loadAnalytics();
  };

  const maxDaily = Math.max(1, ...(analytics?.dailySeries.map((d) => d.total) ?? [1]));
  const maxFeature = Math.max(1, ...(analytics?.byFeature.map((f) => f.requests) ?? [1]));

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Global Shared Quota Settings Card */}
      <form
        onSubmit={handleSaveQuotaConfig}
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
              Shared AI Quota & Daily Reset Policy
            </h3>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
            <Clock className="h-3 w-3" />
            Daily reset: 12:00 AM WAT (Africa/Lagos)
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              Default Daily Shared Quota
            </label>
            <div className="flex items-center gap-1.5 mb-2">
              {QUOTA_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDailyQuota(preset)}
                  className={`rounded-md border px-2 py-1 font-mono text-xs cursor-pointer ${
                    dailyQuota === preset
                      ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 font-semibold'
                      : 'border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={1}
              max={10000}
              value={dailyQuota}
              onChange={(e) => setDailyQuota(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              Default Free Trial Duration (Days)
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={freeDays}
              onChange={(e) => setFreeDays(Math.max(1, Number(e.target.value) || 7))}
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-950 dark:text-zinc-100"
            />
            <p className="mt-1 text-[11px] text-zinc-500">Countdown starts on user onboarding.</p>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              High Usage Alert Threshold (%)
            </label>
            <input
              type="number"
              min={50}
              max={100}
              value={alertPct}
              onChange={(e) => setAlertPct(Math.max(50, Math.min(100, Number(e.target.value) || 80)))}
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-950 dark:text-zinc-100"
            />
            <p className="mt-1 text-[11px] text-zinc-500">Alert when user hits this % of daily limit.</p>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              Abnormal Spike Alert (Req/Hour)
            </label>
            <input
              type="number"
              min={5}
              max={1000}
              value={hourlyThreshold}
              onChange={(e) => setHourlyThreshold(Math.max(5, Number(e.target.value) || 20))}
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-950 dark:text-zinc-100"
            />
            <p className="mt-1 text-[11px] text-zinc-500">Flags burst consumption automatically.</p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            {configSaved ? 'Quota policy saved and active immediately.' : ''}
          </span>
          <Button type="submit" size="sm" loading={savingConfig}>
            <Save className="h-3.5 w-3.5" />
            Save quota policy
          </Button>
        </div>
      </form>

      {/* Date & Origin Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['today', '7d', '30d'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                rangePreset === p
                  ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
              }`}
            >
              {p === 'today' ? 'Today' : p === '7d' ? 'Last 7 days' : 'Last 30 days'}
            </button>
          ))}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setRangePreset('custom');
              setFromDate(e.target.value);
            }}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs"
          />
          <span className="text-xs text-zinc-400">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setRangePreset('custom');
              setToDate(e.target.value);
            }}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value as 'all' | 'shared' | 'personal')}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs"
          >
            <option value="all">All Key Origins</option>
            <option value="shared">Shared Admin Keys Only</option>
            <option value="personal">Personal BYOK Keys Only</option>
          </select>
          <button
            type="button"
            onClick={() => void loadAnalytics()}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      {analytics && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5">
              <div className="text-[11px] text-zinc-500">Logical Requests</div>
              <div className="mt-1 font-mono text-xl font-semibold text-zinc-950 dark:text-zinc-100">
                {analytics.summary.totalLogicalRequests.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5">
              <div className="text-[11px] text-zinc-500">Shared Admin Keys</div>
              <div className="mt-1 font-mono text-xl font-semibold text-sky-700 dark:text-sky-400">
                {analytics.summary.sharedRequests.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5">
              <div className="text-[11px] text-zinc-500">Personal BYOK</div>
              <div className="mt-1 font-mono text-xl font-semibold text-emerald-700 dark:text-emerald-400">
                {analytics.summary.personalRequests.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5">
              <div className="text-[11px] text-zinc-500">Failovers / Retries</div>
              <div className="mt-1 font-mono text-xl font-semibold text-amber-600 dark:text-amber-400">
                {analytics.summary.failovers.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5">
              <div className="text-[11px] text-zinc-500">Rate Limits / Errors</div>
              <div className="mt-1 font-mono text-xl font-semibold text-red-600 dark:text-red-400">
                {analytics.summary.rateLimitHits + analytics.summary.failedAttempts}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5">
              <div className="text-[11px] text-zinc-500">Total Tokens</div>
              <div className="mt-1 font-mono text-xl font-semibold text-zinc-950 dark:text-zinc-100">
                {analytics.summary.totalTokens.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Daily Trend Chart & Feature Breakdown */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-zinc-500" />
                  <h4 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                    Daily AI Requests (Shared vs Personal)
                  </h4>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm bg-zinc-900 dark:bg-zinc-100" /> Shared
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm bg-sky-500" /> Personal BYOK
                  </span>
                </div>
              </div>

              {analytics.dailySeries.length === 0 ? (
                <div className="flex h-44 items-center justify-center text-xs text-zinc-400">
                  No AI requests recorded in this date range.
                </div>
              ) : (
                <div className="flex h-44 items-end gap-1.5 overflow-x-auto pb-2">
                  {analytics.dailySeries.map((day) => {
                    const sharedPct = Math.round((day.shared / maxDaily) * 100);
                    const personalPct = Math.round((day.personal / maxDaily) * 100);
                    return (
                      <div
                        key={day.dateKey}
                        className="flex min-w-[26px] flex-1 flex-col items-center gap-1.5 h-full justify-end"
                        title={`${day.dateKey}: ${day.total} total (${day.shared} shared, ${day.personal} personal, ${day.tokens} tokens)`}
                      >
                        <span className="font-mono text-[10px] text-zinc-500">{day.total}</span>
                        <div className="flex w-full max-w-[28px] flex-col justify-end h-32 rounded-t bg-zinc-100 dark:bg-zinc-800/70 overflow-hidden">
                          {day.personal > 0 && (
                            <div
                              className="w-full bg-sky-500 transition-all"
                              style={{ height: `${Math.max(4, personalPct)}%` }}
                            />
                          )}
                          {day.shared > 0 && (
                            <div
                              className="w-full bg-zinc-900 dark:bg-zinc-100 transition-all"
                              style={{ height: `${Math.max(4, sharedPct)}%` }}
                            />
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-zinc-400">
                          {day.dateKey.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="lg:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <h4 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100 mb-3">
                Most-Used Features
              </h4>
              {analytics.byFeature.length === 0 ? (
                <p className="text-xs text-zinc-400">No feature usage recorded yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {analytics.byFeature.map((f) => {
                    const width = Math.max(4, Math.round((f.requests / maxFeature) * 100));
                    return (
                      <div key={f.feature} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-zinc-800 dark:text-zinc-200">
                            {FEATURE_LABELS[f.feature] || f.feature}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                            {f.requests} ({f.sharedRequests} shared · {f.personalRequests} BYOK)
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-zinc-950 dark:bg-zinc-200"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Provider-Level Telemetry Table */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
            <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
              <Cpu className="h-4 w-4 text-zinc-500" />
              <h4 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                Provider-Level Telemetry & Failover Logs
              </h4>
            </div>
            {analytics.byProvider.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-400">
                No provider attempts recorded in this range.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 text-zinc-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Provider</th>
                    <th className="px-4 py-2.5 font-medium">Attempts</th>
                    <th className="px-4 py-2.5 font-medium">Success</th>
                    <th className="px-4 py-2.5 font-medium">Failed</th>
                    <th className="px-4 py-2.5 font-medium">Rate Limits</th>
                    <th className="px-4 py-2.5 font-medium">Failovers</th>
                    <th className="px-4 py-2.5 font-medium">Tokens</th>
                    <th className="px-4 py-2.5 font-medium">Avg Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-mono text-[11px]">
                  {analytics.byProvider.map((p) => (
                    <tr key={p.provider}>
                      <td className="px-4 py-2.5 font-sans font-semibold text-zinc-950 dark:text-zinc-100 uppercase">
                        {p.provider}
                      </td>
                      <td className="px-4 py-2.5">{p.totalAttempts}</td>
                      <td className="px-4 py-2.5 text-emerald-600 dark:text-emerald-400">{p.successes}</td>
                      <td className="px-4 py-2.5 text-red-600 dark:text-red-400">{p.failures}</td>
                      <td className="px-4 py-2.5 text-amber-600 dark:text-amber-400">{p.rateLimits}</td>
                      <td className="px-4 py-2.5">{p.failovers}</td>
                      <td className="px-4 py-2.5">{Number(p.totalTokens || 0).toLocaleString()}</td>
                      <td className="px-4 py-2.5">{p.avgLatencyMs ? `${p.avgLatencyMs}ms` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Heavy Users & Exhausted Quotas */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-amber-500" />
                <h4 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                  Per-User AI Usage & Daily Quota Monitor ({analytics.exhaustedUsers.length} exhausted today)
                </h4>
              </div>
              <span className="font-mono text-[11px] text-zinc-500">
                WAT Date: {analytics.todayDateKeyLagos}
              </span>
            </div>
            {analytics.heavyUsers.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-400">No user usage recorded yet.</div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 text-zinc-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-4 py-2.5 font-medium">Today&apos;s Shared Quota</th>
                    <th className="px-4 py-2.5 font-medium">Free Access Expiry</th>
                    <th className="px-4 py-2.5 font-medium">Range Requests</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {analytics.heavyUsers.map((u) => (
                    <tr key={u.uid}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-zinc-950 dark:text-zinc-100">
                          {u.displayName || 'Student'}
                        </div>
                        <div className="text-[11px] text-zinc-500">{u.email}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          <span className={u.quotaExhausted ? 'font-semibold text-red-600 dark:text-red-400' : ''}>
                            {u.todayUsed}/{u.dailyLimit} used · {u.todayRemaining} remaining
                          </span>
                          {u.quotaExhausted && <AlertCircle className="h-3.5 w-3.5 text-red-500" />}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                        {u.freeAccessActive
                          ? `Active until ${new Date(u.freeAccessExpiresAtMs).toLocaleDateString()}`
                          : 'Expired'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                        {u.rangeTotal} ({u.rangeShared} shared · {u.rangePersonal} BYOK)
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void handleResetUserQuota(u.uid)}
                          className="inline-flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reset today
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
};
