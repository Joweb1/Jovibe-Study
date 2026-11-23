import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Clock,
  CloudDownload,
  FileText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldBan,
  ShieldCheck,
  Sliders,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { apiFetchJson } from '../../services/api/authHeaders';
import { Button } from '../ui/Button';
import { FEATURE_LABELS, type AdminUserListItem, type FirebaseSyncStatus } from './adminTypes';

interface UserDetailPayload {
  user: AdminUserListItem & {
    freeAccessDaysOverride: number | null;
    freeAccessExpiresAtMs: number | null;
    dailyQuotaOverride: number | null;
    sharedAiAccessOverride: 'default' | 'force_allow' | 'force_block';
  };
  courses: Array<{
    course_id: string;
    code: string;
    name: string;
    description: string;
    is_public: number;
    updated_at_ms: number;
  }>;
  materials: Array<{
    course_id: string;
    source_id: string;
    title: string;
    material_type: string;
    page_count: number;
    status: string;
    created_at_ms: number;
  }>;
  recentActivity: Array<{
    id: string;
    event_type: string;
    feature: string;
    title: string;
    created_at_ms: number;
  }>;
  recentAiLogs: Array<{
    id: string;
    feature: string;
    provider: string;
    model: string;
    key_origin: string;
    status: string;
    total_tokens: number;
    latency_ms: number;
    created_at_ms: number;
  }>;
  featureBreakdown: Array<{ feature: string; count: number }>;
}

export const AdminUsersTab: React.FC = () => {
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [syncingFirebase, setSyncingFirebase] = useState(false);
  const [syncStatus, setSyncStatus] = useState<FirebaseSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'courses' | 'materials' | 'activity'>('overview');

  // Override form state
  const [quotaInput, setQuotaInput] = useState<string>('');
  const [freeDaysInput, setFreeDaysInput] = useState<string>('');
  const [sharedOverride, setSharedOverride] = useState<'default' | 'force_allow' | 'force_block'>('default');
  const [adminNotes, setAdminNotes] = useState<string>('');
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      const data = await apiFetchJson<{
        users: AdminUserListItem[];
        firebaseSync?: FirebaseSyncStatus | null;
      }>(`/api/admin/users?${qs.toString()}`);
      setUsers(data.users || []);
      if (data.firebaseSync) {
        setSyncStatus(data.firebaseSync);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncFromFirebase = async () => {
    setSyncingFirebase(true);
    setError(null);
    try {
      const result = await apiFetchJson<FirebaseSyncStatus>('/api/admin/sync-firebase', {
        method: 'POST',
      });
      setSyncStatus(result);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Firebase sync failed.');
    } finally {
      setSyncingFirebase(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [search, statusFilter]);

  const openUserDetail = async (uid: string) => {
    setSelectedUid(uid);
    setDetailLoading(true);
    setDetailTab('overview');
    setActionNotice(null);
    try {
      const data = await apiFetchJson<UserDetailPayload>(`/api/admin/users/${encodeURIComponent(uid)}`);
      setDetail(data);
      setQuotaInput(
        data.user.dailyQuotaOverride !== null && data.user.dailyQuotaOverride !== undefined
          ? String(data.user.dailyQuotaOverride)
          : ''
      );
      setFreeDaysInput(
        data.user.freeAccessDaysOverride !== null && data.user.freeAccessDaysOverride !== undefined
          ? String(data.user.freeAccessDaysOverride)
          : ''
      );
      setSharedOverride(data.user.sharedAiAccessOverride || 'default');
      setAdminNotes(data.user.notes || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user details.');
      setSelectedUid(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleStatusChange = async (uid: string, nextStatus: 'active' | 'suspended' | 'deleted') => {
    setSavingAction(`status_${nextStatus}`);
    setActionNotice(null);
    try {
      await apiFetchJson(`/api/admin/users/${encodeURIComponent(uid)}/status`, {
        method: 'PATCH',
        body: { status: nextStatus, notes: adminNotes },
      });
      setActionNotice(`User status updated to ${nextStatus}.`);
      await Promise.all([loadUsers(), openUserDetail(uid)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setSavingAction(null);
    }
  };

  const handleSaveOverrides = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUid) return;
    setSavingAction('overrides');
    setActionNotice(null);
    try {
      const parsedQuota = quotaInput.trim() === '' ? null : Math.max(0, Number(quotaInput));
      const parsedDays = freeDaysInput.trim() === '' ? null : Math.max(1, Number(freeDaysInput));
      await apiFetchJson(`/api/admin/users/${encodeURIComponent(selectedUid)}/overrides`, {
        method: 'PATCH',
        body: {
          dailyQuotaOverride: parsedQuota !== null && Number.isFinite(parsedQuota) ? parsedQuota : null,
          freeAccessDaysOverride: parsedDays !== null && Number.isFinite(parsedDays) ? parsedDays : null,
          freeAccessExpiresAtMs: null,
          sharedAiAccessOverride: sharedOverride,
          notes: adminNotes,
        },
      });
      setActionNotice('User quota & free-access overrides saved.');
      await Promise.all([loadUsers(), openUserDetail(selectedUid)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save overrides.');
    } finally {
      setSavingAction(null);
    }
  };

  const handleResetQuota = async (uid: string) => {
    setSavingAction('reset_quota');
    setActionNotice(null);
    try {
      await apiFetchJson(`/api/admin/users/${encodeURIComponent(uid)}/reset-quota`, {
        method: 'POST',
      });
      setActionNotice("Today's shared AI quota has been reset to 0.");
      await loadUsers();
      if (selectedUid === uid) {
        await openUserDetail(uid);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset quota.');
    } finally {
      setSavingAction(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or UID..."
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-2 pl-9 pr-3 text-xs text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">All users</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deleted">Deleted</option>
            <option value="trial_active">7-Day Trial Active</option>
            <option value="trial_expired">Trial Expired</option>
            <option value="quota_exhausted">Daily Quota Exhausted</option>
          </select>

          <button
            type="button"
            onClick={() => void handleSyncFromFirebase()}
            disabled={syncingFirebase}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
          >
            <CloudDownload className={`h-3.5 w-3.5 ${syncingFirebase ? 'animate-pulse' : ''}`} />
            {syncingFirebase ? 'Syncing...' : 'Sync Firebase'}
          </button>

          <button
            type="button"
            onClick={() => void loadUsers()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {syncStatus?.permissionDenied && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/90 dark:bg-amber-950/35 px-4 py-3 text-xs text-amber-950 dark:text-amber-100 space-y-1">
          <div className="font-semibold">Only users who signed in after this update are listed so far</div>
          <p className="text-amber-900/90 dark:text-amber-200/90">{syncStatus.setupHint}</p>
        </div>
      )}

      {/* Users Table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
        {users.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
            {loading ? 'Loading users...' : 'No users match your current filter.'}
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Courses / Materials</th>
                <th className="px-4 py-3 font-medium">Free AI Trial</th>
                <th className="px-4 py-3 font-medium">Today&apos;s Quota</th>
                <th className="px-4 py-3 font-medium">Total AI</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {users.map((u) => {
                const pct =
                  u.quota.limit > 0 ? Math.min(100, Math.round((u.quota.used / u.quota.limit) * 100)) : 0;
                return (
                  <tr key={u.uid} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-950/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-950 dark:text-zinc-100">
                        {u.displayName || 'Student'}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
                          u.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : u.status === 'suspended'
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      {u.coursesCount} courses · {u.materialsCount} files
                    </td>
                    <td className="px-4 py-3">
                      {u.hasPersonalKey ? (
                        <span className="rounded bg-sky-50 dark:bg-sky-950/60 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                          Personal BYOK
                        </span>
                      ) : u.freeAccess.active ? (
                        <div className="text-[11px]">
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            {u.freeAccess.daysRemaining}d left
                          </span>
                          <div className="text-zinc-400">
                            Ends {new Date(u.freeAccess.expiresAtMs).toLocaleDateString()}
                          </div>
                        </div>
                      ) : (
                        <span className="rounded bg-red-50 dark:bg-red-950/50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">
                          Expired
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-32 space-y-1">
                        <div className="flex justify-between font-mono text-[11px] tabular-nums">
                          <span className="text-zinc-900 dark:text-zinc-100">
                            {u.quota.used}/{u.quota.limit}
                          </span>
                          <span className="text-zinc-500 dark:text-zinc-400">
                            {u.quota.remaining} left
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                          <div
                            className={`h-full rounded-full ${
                              pct >= 100
                                ? 'bg-red-600'
                                : pct >= 80
                                ? 'bg-amber-500'
                                : 'bg-zinc-950 dark:bg-zinc-200'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-zinc-700 dark:text-zinc-300 tabular-nums">
                      <div>{u.aiStats.totalRequests} total</div>
                      <div className="text-[10px] text-zinc-400">
                        {u.aiStats.sharedRequests} shared · {u.aiStats.personalRequests} BYOK
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleResetQuota(u.uid)}
                          title="Reset today's daily quota"
                          className="rounded border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-[11px] text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                        >
                          Reset quota
                        </button>
                        <button
                          type="button"
                          onClick={() => void openUserDetail(u.uid)}
                          className="rounded bg-zinc-950 dark:bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-white cursor-pointer"
                        >
                          Manage
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* User Detail & Management Modal */}
      {selectedUid && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
                  {detail?.user.displayName || 'User Details'}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {detail?.user.email} · UID: <span className="font-mono">{selectedUid}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedUid(null);
                  setDetail(null);
                }}
                aria-label="Close user detail modal"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailLoading || !detail ? (
              <div className="p-8 text-center text-xs text-zinc-500">Loading user profile...</div>
            ) : (
              <>
                <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 px-5 pt-2 text-xs">
                  {(['overview', 'courses', 'materials', 'activity'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDetailTab(t)}
                      className={`border-b-2 px-3 py-2 font-medium capitalize cursor-pointer ${
                        detailTab === t
                          ? 'border-zinc-950 dark:border-zinc-100 text-zinc-950 dark:text-zinc-100'
                          : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                      }`}
                    >
                      {t}
                      {t === 'courses' ? ` (${detail.courses.length})` : ''}
                      {t === 'materials' ? ` (${detail.materials.length})` : ''}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  {actionNotice && (
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                      {actionNotice}
                    </div>
                  )}

                  {detailTab === 'overview' && (
                    <div className="space-y-5">
                      {/* Account status & quick controls */}
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-4">
                        <div className="space-y-1 text-xs">
                          <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                            Account Status:{' '}
                            <span className="capitalize">{detail.user.status}</span>
                          </div>
                          <div className="text-zinc-500 dark:text-zinc-400">
                            Registered {new Date(detail.user.registeredAtMs).toLocaleDateString()} ·
                            Quota today: <strong className="font-mono">{detail.user.quota.used}/{detail.user.quota.limit}</strong> ({detail.user.quota.remaining} remaining)
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={savingAction === 'reset_quota'}
                            onClick={() => void handleResetQuota(detail.user.uid)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Reset today&apos;s quota
                          </Button>
                          {detail.user.status === 'active' ? (
                            <Button
                              size="sm"
                              variant="danger"
                              loading={savingAction === 'status_suspended'}
                              onClick={() => void handleStatusChange(detail.user.uid, 'suspended')}
                            >
                              <ShieldBan className="h-3.5 w-3.5" />
                              Suspend
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              loading={savingAction === 'status_active'}
                              onClick={() => void handleStatusChange(detail.user.uid, 'active')}
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                              Restore / Unsuspend
                            </Button>
                          )}
                          {detail.user.status !== 'deleted' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={savingAction === 'status_deleted'}
                              onClick={() => void handleStatusChange(detail.user.uid, 'deleted')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Mark Deleted
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Overrides form */}
                      <form
                        onSubmit={handleSaveOverrides}
                        className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4"
                      >
                        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-950 dark:text-zinc-100">
                          <Sliders className="h-4 w-4" />
                          Admin Quota & Free-Access Overrides
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div>
                            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                              Daily Quota Override (blank = default)
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={10000}
                              value={quotaInput}
                              onChange={(e) => setQuotaInput(e.target.value)}
                              placeholder={`Default (${detail.user.quota.limit})`}
                              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                              Free Access Days Override
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={365}
                              value={freeDaysInput}
                              onChange={(e) => setFreeDaysInput(e.target.value)}
                              placeholder={`Default (${detail.user.freeAccess.daysTotal}d)`}
                              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                              Shared AI Access Override
                            </label>
                            <select
                              value={sharedOverride}
                              onChange={(e) =>
                                setSharedOverride(
                                  e.target.value as 'default' | 'force_allow' | 'force_block'
                                )
                              }
                              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100"
                            >
                              <option value="default">Default (7-day trial rule)</option>
                              <option value="force_allow">Force Allow Shared AI</option>
                              <option value="force_block">Force Block Shared AI</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                            Admin Notes
                          </label>
                          <textarea
                            rows={2}
                            value={adminNotes}
                            onChange={(e) => setAdminNotes(e.target.value)}
                            placeholder="Internal moderation or support note..."
                            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100"
                          />
                        </div>

                        <div className="flex justify-end">
                          <Button type="submit" size="sm" loading={savingAction === 'overrides'}>
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Save overrides
                          </Button>
                        </div>
                      </form>

                      {/* User feature usage breakdown */}
                      {detail.featureBreakdown.length > 0 && (
                        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
                          <div className="text-xs font-semibold text-zinc-950 dark:text-zinc-100 mb-2">
                            Feature Usage Breakdown
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {detail.featureBreakdown.map((f) => (
                              <span
                                key={f.feature}
                                className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1 text-xs"
                              >
                                {FEATURE_LABELS[f.feature] || f.feature}:{' '}
                                <strong className="font-mono">{f.count}</strong>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {detailTab === 'courses' && (
                    <div className="space-y-2">
                      {detail.courses.length === 0 ? (
                        <p className="text-xs text-zinc-500">No synced courses for this user yet.</p>
                      ) : (
                        detail.courses.map((c) => (
                          <div
                            key={c.course_id}
                            className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 text-xs"
                          >
                            <div className="flex items-start gap-2.5">
                              <BookOpen className="mt-0.5 h-4 w-4 text-zinc-400" />
                              <div>
                                <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                                  {c.code} — {c.name}
                                </div>
                                {c.description && (
                                  <p className="mt-0.5 text-zinc-500 dark:text-zinc-400 line-clamp-2">
                                    {c.description}
                                  </p>
                                )}
                              </div>
                            </div>
                            <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px]">
                              {c.is_public ? 'Public' : 'Private'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {detailTab === 'materials' && (
                    <div className="space-y-2">
                      {detail.materials.length === 0 ? (
                        <p className="text-xs text-zinc-500">No uploaded course materials synced yet.</p>
                      ) : (
                        detail.materials.map((m) => (
                          <div
                            key={`${m.course_id}_${m.source_id}`}
                            className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 text-xs"
                          >
                            <div className="flex items-start gap-2.5 min-w-0">
                              <FileText className="mt-0.5 h-4 w-4 text-zinc-400 shrink-0" />
                              <div className="min-w-0">
                                <div className="truncate font-medium text-zinc-950 dark:text-zinc-100">
                                  {m.title}
                                </div>
                                <div className="text-[11px] text-zinc-500">
                                  {m.material_type} · {m.page_count} pages ·{' '}
                                  {new Date(m.created_at_ms).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                            <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] capitalize">
                              {m.status}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {detailTab === 'activity' && (
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                          Recent AI Requests ({detail.recentAiLogs.length})
                        </h4>
                        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
                          {detail.recentAiLogs.length === 0 ? (
                            <p className="p-3 text-xs text-zinc-500">No AI requests logged yet.</p>
                          ) : (
                            detail.recentAiLogs.slice(0, 30).map((l) => (
                              <div
                                key={l.id}
                                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px]"
                              >
                                <div className="flex items-center gap-2">
                                  <Clock className="h-3 w-3 text-zinc-400" />
                                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                    {FEATURE_LABELS[l.feature] || l.feature}
                                  </span>
                                  <span className="font-mono text-zinc-500">
                                    {l.provider}/{l.model || '-'}
                                  </span>
                                  <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px]">
                                    {l.key_origin === 'personal_byok' ? 'Personal BYOK' : 'Shared'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 font-mono text-zinc-500">
                                  <span>{l.status}</span>
                                  <span>{l.total_tokens} tok</span>
                                  <span>{new Date(l.created_at_ms).toLocaleTimeString()}</span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
