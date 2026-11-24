import React from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  FileText,
  FolderOpen,
  ShieldAlert,
  UserCheck,
  UserMinus,
  Users,
  UserX,
  Zap,
} from 'lucide-react';
import { apiFetchJson } from '../../services/api/authHeaders';
import {
  ADMIN_PROVIDER_LABELS,
  type AdminManagedProvider,
  type AdminOverviewResponse,
} from './adminTypes';

interface AdminOverviewTabProps {
  overview: AdminOverviewResponse;
  onRefresh: () => Promise<void>;
  onNavigateTab: (tab: 'users' | 'ai-usage' | 'api-keys' | 'features' | 'groups' | 'audit') => void;
}

export const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
  overview,
  onRefresh,
  onNavigateTab,
}) => {
  const handleAck = async (alertId: string) => {
    await apiFetchJson(`/api/admin/alerts/${alertId}/acknowledge`, { method: 'POST' });
    await onRefresh();
  };

  const unackAlerts = overview.alerts.filter((a) => !a.acknowledged);

  return (
    <div className="space-y-6">
      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Total Users</span>
            <Users className="h-4 w-4" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-zinc-950 dark:text-zinc-100 tabular-nums">
            {overview.users.total.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {overview.users.active24h} active in 24h · {overview.users.active7d} in 7d
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Active Users</span>
            <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-zinc-950 dark:text-zinc-100 tabular-nums">
            {overview.users.active.toLocaleString()}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <UserMinus className="h-3 w-3" /> {overview.users.suspended} suspended
            </span>
            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
              <UserX className="h-3 w-3" /> {overview.users.deleted} deleted
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Courses & Materials</span>
            <BookOpen className="h-4 w-4" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-zinc-950 dark:text-zinc-100 tabular-nums">
            {overview.content.totalCourses.toLocaleString()}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <FileText className="h-3 w-3" />
            <span>{overview.content.totalMaterials.toLocaleString()} uploaded course materials</span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>AI Requests (Total)</span>
            <Zap className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-zinc-950 dark:text-zinc-100 tabular-nums">
            {overview.aiUsage.totalLogicalRequests.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
            Today: {overview.aiUsage.todayRequests} · 7d: {overview.aiUsage.weekRequests} · 30d:{' '}
            {overview.aiUsage.monthRequests}
          </div>
        </div>
      </div>

      {/* Secondary Metrics Row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Shared vs Personal AI
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('ai-usage')}
              className="text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:underline cursor-pointer"
            >
              View analytics →
            </button>
          </div>
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Shared Admin Keys</div>
              <div className="font-mono text-lg font-semibold text-zinc-950 dark:text-zinc-100 tabular-nums">
                {overview.aiUsage.sharedRequests.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Personal BYOK</div>
              <div className="font-mono text-lg font-semibold text-zinc-950 dark:text-zinc-100 tabular-nums">
                {overview.aiUsage.personalRequests.toLocaleString()}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 dark:border-zinc-800 pt-2 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
            <span>Failovers: {overview.aiUsage.totalFailovers}</span>
            <span>Rate limits: {overview.aiUsage.totalRateLimits}</span>
            <span>Tokens: {overview.aiUsage.totalTokens.toLocaleString()}</span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Study Groups & Moderation
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('groups')}
              className="text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:underline cursor-pointer"
            >
              Manage groups →
            </button>
          </div>
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Active Groups</div>
              <div className="font-mono text-lg font-semibold text-zinc-950 dark:text-zinc-100 tabular-nums">
                {overview.content.activeGroups}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Open Reports</div>
              <div
                className={`font-mono text-lg font-semibold tabular-nums ${
                  overview.content.openReports > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-zinc-950 dark:text-zinc-100'
                }`}
              >
                {overview.content.openReports}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <FolderOpen className="h-3.5 w-3.5" />
            <span>
              {overview.content.totalGroups} total · {overview.content.suspendedGroups} suspended
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Platform Policy
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('features')}
              className="text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:underline cursor-pointer"
            >
              Configure →
            </button>
          </div>
          <div className="space-y-1.5 pt-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Global AI Status</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                  overview.featureFlags.aiGlobalEnabled
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                }`}
              >
                {overview.featureFlags.aiGlobalEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Default Shared Quota</span>
              <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                {overview.quotaConfig.defaultDailyQuota}/day ({overview.quotaConfig.defaultFreeAccessDays}d trial)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Reset Schedule</span>
              <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                12:00 AM WAT (Africa/Lagos)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Provider Key Routing Status */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
              Admin Shared Provider Key Routing
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('api-keys')}
            className="text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:underline cursor-pointer"
          >
            Manage keys →
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {(Object.keys(ADMIN_PROVIDER_LABELS) as AdminManagedProvider[]).map((provider) => {
            const info = overview.providerSources[provider];
            return (
              <div
                key={provider}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 p-3"
              >
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {ADMIN_PROVIDER_LABELS[provider]}
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  <span
                    className={`rounded px-1.5 py-0.5 font-medium ${
                      info?.effectiveSource === 'admin_pool'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                        : info?.effectiveSource === 'env_fallback'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                        : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    {info?.effectiveSource === 'admin_pool'
                      ? `Admin Pool (${info.activeAdminKeyCount}/${info.adminKeyCount})`
                      : info?.effectiveSource === 'env_fallback'
                      ? '.env Fallback'
                      : 'Unconfigured'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* System & Security Alerts */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
              Monitoring Alerts ({unackAlerts.length} active)
            </h3>
          </div>
        </div>

        {overview.alerts.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>No active usage spikes, provider exhaustions, or open moderation alerts.</span>
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {overview.alerts.slice(0, 12).map((alert) => (
              <div
                key={alert.id}
                className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${
                  alert.acknowledged ? 'opacity-55' : ''
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <AlertTriangle
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      alert.severity === 'critical'
                        ? 'text-red-600 dark:text-red-400'
                        : alert.severity === 'warning'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-sky-600 dark:text-sky-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-950 dark:text-zinc-100">
                        {alert.title}
                      </span>
                      <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-600 dark:text-zinc-400">
                        {alert.category}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        {new Date(alert.created_at_ms).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{alert.message}</p>
                  </div>
                </div>
                {!alert.acknowledged && (
                  <button
                    type="button"
                    onClick={() => void handleAck(alert.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Acknowledge
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
