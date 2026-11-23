import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  ClipboardList,
  CloudDownload,
  KeyRound,
  LayoutDashboard,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sliders,
  Users,
  UsersRound,
} from 'lucide-react';
import { usePlatformAccess } from '../context/PlatformAccessContext';
import { useRouter } from '../router/RouterContext';
import { apiFetchJson } from '../services/api/authHeaders';
import { syncAllUsersFromClientFirestore } from '../services/firebase/adminFirestoreSync';
import { AdminOverviewTab } from '../components/admin/AdminOverviewTab';
import { AdminUsersTab } from '../components/admin/AdminUsersTab';
import { AdminAiUsageTab } from '../components/admin/AdminAiUsageTab';
import { AdminApiKeysTab } from '../components/admin/AdminApiKeysTab';
import { AdminFeaturesTab } from '../components/admin/AdminFeaturesTab';
import { AdminGroupsTab } from '../components/admin/AdminGroupsTab';
import { AdminAuditTab } from '../components/admin/AdminAuditTab';
import type { AdminOverviewResponse, FirebaseSyncStatus } from '../components/admin/adminTypes';
import { Button } from '../components/ui/Button';
import { ErrorBanner, LoadingSkeleton } from '../components/ui/StateViews';

type AdminTab =
  | 'overview'
  | 'users'
  | 'ai-usage'
  | 'api-keys'
  | 'features'
  | 'groups'
  | 'audit';

const TABS: Array<{
  id: AdminTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'ai-usage', label: 'AI Usage & Quotas', icon: BarChart3 },
  { id: 'api-keys', label: 'API Keys & Rotation', icon: KeyRound },
  { id: 'features', label: 'Feature Controls', icon: Sliders },
  { id: 'groups', label: 'Group Study', icon: UsersRound },
  { id: 'audit', label: 'Audit Log', icon: ClipboardList },
];

export const AdminDashboardPage: React.FC = () => {
  const { isAdmin, loading: accessLoading, refreshAccessStatus } = usePlatformAccess();
  const { navigate } = useRouter();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingFirebase, setSyncingFirebase] = useState(false);
  const [syncNotice, setSyncNotice] = useState<FirebaseSyncStatus | null>(null);
  const [syncVersion, setSyncVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = async (runClientFallback = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetchJson<AdminOverviewResponse>('/api/admin/overview');
      setOverview(data);
      let latestSync = data.firebaseSync ?? null;

      // If server didn't use a Service Account (or failed REST auth), also sync directly via Firebase Web SDK
      if (
        runClientFallback &&
        (!latestSync || !latestSync.ok || latestSync.source !== 'service_account')
      ) {
        const clientSync = await syncAllUsersFromClientFirestore();
        if (clientSync.ok) {
          latestSync = clientSync;
          const refreshed = await apiFetchJson<AdminOverviewResponse>('/api/admin/overview');
          setOverview(refreshed);
          setSyncVersion((v) => v + 1);
        } else if (!latestSync || !latestSync.ok) {
          latestSync = clientSync;
        }
      }

      if (latestSync) {
        setSyncNotice(latestSync);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Admin Dashboard.');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncFirebase = async () => {
    setSyncingFirebase(true);
    setError(null);
    try {
      const serverResult = await apiFetchJson<FirebaseSyncStatus>('/api/admin/sync-firebase', {
        method: 'POST',
      });
      let finalResult = serverResult;

      // Also pull directly from Firestore via the admin's Firebase Web SDK so live /users docs always import
      if (!serverResult.ok || serverResult.source !== 'service_account') {
        const clientResult = await syncAllUsersFromClientFirestore();
        if (clientResult.ok && (!serverResult.ok || clientResult.usersSynced >= serverResult.usersSynced)) {
          finalResult = clientResult;
        } else if (!serverResult.ok) {
          finalResult = clientResult;
        }
      }

      setSyncNotice(finalResult);
      setSyncVersion((v) => v + 1);
      await loadOverview(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Firebase sync failed.');
    } finally {
      setSyncingFirebase(false);
    }
  };

  useEffect(() => {
    if (!accessLoading && isAdmin) {
      void loadOverview(true);
    } else if (!accessLoading && !isAdmin) {
      setLoading(false);
    }
  }, [accessLoading, isAdmin]);

  if (accessLoading) {
    return <LoadingSkeleton lines={5} />;
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center space-y-4">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="font-display text-xl font-semibold text-zinc-950 dark:text-zinc-100">
          Admin Access Restricted
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This section is restricted to the sole configured administrator account. All admin APIs are enforced server-side.
        </p>
        <div className="pt-2">
          <Button variant="secondary" onClick={() => navigate('/courses')}>
            Return to Courses
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/courses')}
            aria-label="Back to Courses"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-zinc-950 dark:text-zinc-100 shrink-0" />
              <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100 truncate">
                Admin Dashboard
              </h1>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Platform administration, encrypted API key rotation, Africa/Lagos shared quotas, AI telemetry, and Group Study moderation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleSyncFirebase()}
            loading={syncingFirebase}
          >
            <CloudDownload className="h-3.5 w-3.5" />
            Sync Firebase Users
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void loadOverview(true);
              void refreshAccessStatus();
            }}
            loading={loading}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {syncNotice && !syncNotice.ok && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/90 dark:bg-amber-950/35 px-4 py-3 text-xs text-amber-950 dark:text-amber-100 space-y-1">
          <div className="font-semibold">
            {syncNotice.permissionDenied
              ? 'Firebase Full User Sync Needs Permission'
              : 'Firebase Sync Issue'}
          </div>
          {syncNotice.error && (
            <p className="leading-relaxed text-amber-900/90 dark:text-amber-200/90">
              {syncNotice.error}
            </p>
          )}
          {syncNotice.setupHint && (
            <p className="leading-relaxed text-amber-800 dark:text-amber-300">
              {syncNotice.setupHint}
            </p>
          )}
        </div>
      )}

      {syncNotice && syncNotice.ok && syncNotice.source !== 'none' && (
        <div className="rounded-lg border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/80 dark:bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Synced {syncNotice.usersSynced} user{syncNotice.usersSynced === 1 ? '' : 's'},{' '}
              {syncNotice.coursesSynced} courses, {syncNotice.materialsSynced} materials, and{' '}
              {syncNotice.groupsSynced} groups from Firebase (
              {syncNotice.source === 'service_account'
                ? 'Auth + Firestore'
                : syncNotice.source === 'client_sdk'
                ? 'Firestore SDK'
                : 'Firestore REST'}
              ).
            </span>
            {syncNotice.projectId && (
              <span className="font-mono text-[11px] opacity-80">
                {syncNotice.projectId} / {syncNotice.firestoreDatabaseId || '(default)'}
              </span>
            )}
          </div>
          {syncNotice.source !== 'service_account' && syncNotice.usersSynced <= 1 && (
            <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90">
              Firestore currently contains {syncNotice.usersSynced} user profile document in this database. Users who signed up in Firebase Authentication before opening the app (or exist only in Auth without a Firestore profile) require setting <code className="font-mono">FIREBASE_SERVICE_ACCOUNT_JSON</code> on the server to sync from Firebase Auth.
            </p>
          )}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800 pb-px">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          const openReports =
            tab.id === 'groups' && overview?.content.openReports
              ? overview.content.openReports
              : 0;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                active
                  ? 'border-zinc-950 dark:border-zinc-100 text-zinc-950 dark:text-zinc-100'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
              {openReports > 0 && (
                <span className="ml-0.5 rounded-full bg-red-600 px-1.5 py-0.2 font-mono text-[10px] text-white">
                  {openReports}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Tab Content */}
      <div>
        {activeTab === 'overview' &&
          (overview ? (
            <AdminOverviewTab
              overview={overview}
              onRefresh={() => loadOverview(true)}
              onNavigateTab={(t) => setActiveTab(t)}
            />
          ) : (
            <LoadingSkeleton lines={5} />
          ))}

        {activeTab === 'users' && (
          <AdminUsersTab
            syncVersion={syncVersion}
            onSynced={(res) => {
              setSyncNotice(res);
              void loadOverview(false);
            }}
          />
        )}

        {activeTab === 'ai-usage' && overview && (
          <AdminAiUsageTab
            quotaConfig={overview.quotaConfig}
            onQuotaConfigUpdated={(next) => {
              setOverview((prev) => (prev ? { ...prev, quotaConfig: next } : prev));
              void refreshAccessStatus();
            }}
          />
        )}

        {activeTab === 'api-keys' && <AdminApiKeysTab />}

        {activeTab === 'features' && overview && (
          <AdminFeaturesTab
            flags={overview.featureFlags}
            onUpdated={(next) => {
              setOverview((prev) => (prev ? { ...prev, featureFlags: next } : prev));
              void refreshAccessStatus();
            }}
          />
        )}

        {activeTab === 'groups' && <AdminGroupsTab />}

        {activeTab === 'audit' && <AdminAuditTab />}

        {activeTab !== 'overview' && !overview && (activeTab === 'ai-usage' || activeTab === 'features') && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 py-8">
            <Activity className="h-4 w-4 animate-pulse" />
            Loading configuration...
          </div>
        )}
      </div>
    </div>
  );
};
