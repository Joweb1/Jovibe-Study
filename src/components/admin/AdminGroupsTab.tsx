import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  EyeOff,
  FileText,
  Flag,
  RefreshCw,
  Search,
  ShieldBan,
  Trash2,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { apiFetchJson } from '../../services/api/authHeaders';
import { Button } from '../ui/Button';
import type { AdminGroupRow } from './adminTypes';

interface GroupDetailPayload {
  group: AdminGroupRow;
  members: Array<{
    member_uid: string;
    display_name: string;
    email: string;
    role: 'owner' | 'member';
    status: 'active' | 'removed';
    joined_at_ms: number;
  }>;
  notes: Array<{
    id: string;
    author_uid: string;
    author_name: string;
    title: string;
    content: string;
    status: 'active' | 'hidden' | 'deleted';
    moderation_reason: string;
    created_at_ms: number;
  }>;
  materials: Array<{
    uid: string;
    course_id: string;
    source_id: string;
    title: string;
    material_type: string;
    status: 'active' | 'hidden' | 'deleted';
    moderation_reason: string;
    created_at_ms: number;
  }>;
  activity: Array<{
    id: string;
    actor_name: string;
    action: string;
    details: string;
    created_at_ms: number;
  }>;
  reports: GroupReportRow[];
}

interface GroupReportRow {
  id: string;
  group_id: string;
  target_type: string;
  target_id: string;
  target_label: string;
  reported_user_uid: string;
  reported_user_email: string;
  reporter_uid: string;
  reporter_email: string;
  reason: string;
  details: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  resolution_note: string;
  resolved_by: string;
  created_at_ms: number;
}

export const AdminGroupsTab: React.FC = () => {
  const [subView, setSubView] = useState<'groups' | 'reports'>('groups');
  const [groups, setGroups] = useState<AdminGroupRow[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reports, setReports] = useState<GroupReportRow[]>([]);
  const [abusiveUsers, setAbusiveUsers] = useState<
    Array<{ uid: string; email: string; reportCount: number; openReports: number }>
  >([]);
  const [reportFilter, setReportFilter] = useState('all');

  // Selected group detail modal
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GroupDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'members' | 'content' | 'activity' | 'reports'>('members');
  const [transferTargetUid, setTransferTargetUid] = useState('');
  const [moderationNotice, setModerationNotice] = useState<string | null>(null);

  const loadGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      const data = await apiFetchJson<{ groups: AdminGroupRow[] }>(
        `/api/admin/groups?${qs.toString()}`
      );
      setGroups(data.groups || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load study groups.');
    } finally {
      setLoading(false);
    }
  };

  const loadReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetchJson<{
        reports: GroupReportRow[];
        abusiveUsers: Array<{ uid: string; email: string; reportCount: number; openReports: number }>;
      }>(`/api/admin/groups/reports?status=${encodeURIComponent(reportFilter)}`);
      setReports(data.reports || []);
      setAbusiveUsers(data.abusiveUsers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load moderation reports.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (subView === 'groups') {
      const t = window.setTimeout(() => void loadGroups(), 150);
      return () => window.clearTimeout(t);
    } else {
      void loadReports();
    }
  }, [subView, search, statusFilter, reportFilter]);

  const openGroup = async (groupId: string) => {
    setSelectedGroupId(groupId);
    setDetailLoading(true);
    setDetailTab('members');
    setTransferTargetUid('');
    setModerationNotice(null);
    try {
      const data = await apiFetchJson<GroupDetailPayload>(
        `/api/admin/groups/${encodeURIComponent(groupId)}`
      );
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load group details.');
      setSelectedGroupId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleGroupStatus = async (groupId: string, nextStatus: 'active' | 'suspended' | 'deleted') => {
    await apiFetchJson(`/api/admin/groups/${encodeURIComponent(groupId)}/status`, {
      method: 'PATCH',
      body: { status: nextStatus, reason: `Admin set status to ${nextStatus}` },
    });
    setModerationNotice(`Group status updated to ${nextStatus}.`);
    await Promise.all([loadGroups(), openGroup(groupId)]);
  };

  const handleRemoveMember = async (groupId: string, memberUid: string) => {
    await apiFetchJson(
      `/api/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberUid)}`,
      { method: 'DELETE', body: { reason: 'Removed by administrator' } }
    );
    setModerationNotice('Member removed from study group.');
    await Promise.all([loadGroups(), openGroup(groupId)]);
  };

  const handleTransferOwnership = async (groupId: string) => {
    if (!transferTargetUid) return;
    await apiFetchJson(`/api/admin/groups/${encodeURIComponent(groupId)}/transfer-ownership`, {
      method: 'POST',
      body: { newOwnerUid: transferTargetUid },
    });
    setTransferTargetUid('');
    setModerationNotice('Group ownership transferred successfully.');
    await Promise.all([loadGroups(), openGroup(groupId)]);
  };

  const handleModerateNote = async (
    groupId: string,
    noteId: string,
    status: 'active' | 'hidden' | 'deleted'
  ) => {
    await apiFetchJson(
      `/api/admin/groups/${encodeURIComponent(groupId)}/notes/${encodeURIComponent(noteId)}`,
      {
        method: 'PATCH',
        body: { status, moderationReason: status === 'active' ? '' : 'Moderated by admin' },
      }
    );
    setModerationNotice(`Shared note marked ${status}.`);
    await openGroup(groupId);
  };

  const handleModerateMaterial = async (
    uid: string,
    courseId: string,
    sourceId: string,
    status: 'active' | 'hidden' | 'deleted'
  ) => {
    await apiFetchJson(
      `/api/admin/materials/${encodeURIComponent(uid)}/${encodeURIComponent(courseId)}/${encodeURIComponent(sourceId)}`,
      {
        method: 'PATCH',
        body: { status, moderationReason: status === 'active' ? '' : 'Moderated by admin' },
      }
    );
    setModerationNotice(`Course material marked ${status}.`);
    if (selectedGroupId) await openGroup(selectedGroupId);
  };

  const handleUpdateReport = async (
    reportId: string,
    status: 'reviewing' | 'resolved' | 'dismissed'
  ) => {
    await apiFetchJson(`/api/admin/groups/reports/${encodeURIComponent(reportId)}`, {
      method: 'PATCH',
      body: { status, resolutionNote: `Marked ${status} via Admin Dashboard` },
    });
    await loadReports();
    if (selectedGroupId) await openGroup(selectedGroupId);
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Sub-navigation: All Groups vs Reports & Abuse */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-1 text-xs">
          <button
            type="button"
            onClick={() => setSubView('groups')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium cursor-pointer ${
              subView === 'groups'
                ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Study Groups
          </button>
          <button
            type="button"
            onClick={() => setSubView('reports')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium cursor-pointer ${
              subView === 'reports'
                ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Flag className="h-3.5 w-3.5" />
            Reports &amp; Abuse Queue
          </button>
        </div>

        <button
          type="button"
          onClick={() => void (subView === 'groups' ? loadGroups() : loadReports())}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {subView === 'groups' ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search group name, course, or owner..."
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-2 pl-9 pr-3 text-xs text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs"
            >
              <option value="all">All groups</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deleted">Deleted</option>
              <option value="reported">With Open Reports</option>
            </select>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
            {groups.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">
                {loading ? 'Loading study groups...' : 'No study groups found.'}
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Group &amp; Course</th>
                    <th className="px-4 py-3 font-medium">Owner</th>
                    <th className="px-4 py-3 font-medium">Members / Notes</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Created / Last Active</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {groups.map((g) => (
                    <tr key={g.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-950/40">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-zinc-950 dark:text-zinc-100">{g.name}</div>
                        <div className="text-[11px] text-zinc-500">
                          {g.course_code ? `${g.course_code} · ` : ''}
                          {g.course_name || g.course_id}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-zinc-900 dark:text-zinc-100">{g.author_name}</div>
                        <div className="text-[11px] text-zinc-500">{g.author_email || g.author_uid}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px]">
                        <div>{g.active_members || g.member_count} members</div>
                        <div className="text-zinc-500">
                          {g.notes_count} notes
                          {g.open_reports_count > 0 && (
                            <span className="ml-1.5 font-semibold text-red-600 dark:text-red-400">
                              · {g.open_reports_count} reports
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
                            g.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : g.status === 'suspended'
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                          }`}
                        >
                          {g.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">
                        <div>Created {new Date(g.created_at_ms).toLocaleDateString()}</div>
                        <div>Active {new Date(g.last_activity_at_ms).toLocaleDateString()}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void openGroup(g.id)}
                          className="rounded bg-zinc-950 dark:bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-white dark:text-zinc-950 cursor-pointer"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <select
              value={reportFilter}
              onChange={(e) => setReportFilter(e.target.value)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs"
            >
              <option value="all">All Reports</option>
              <option value="open">Open</option>
              <option value="reviewing">Reviewing</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>

          {/* Abusive Users Tracker */}
          {abusiveUsers.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200 mb-2">
                <AlertTriangle className="h-4 w-4" />
                Frequently Reported / Flagged Users
              </div>
              <div className="flex flex-wrap gap-2">
                {abusiveUsers.map((u) => (
                  <span
                    key={u.uid}
                    className="rounded-md border border-amber-300/80 dark:border-amber-800 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs"
                  >
                    {u.email || u.uid} — <strong className="font-mono">{u.reportCount}</strong> reports ({u.openReports} open)
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Reports List */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
            {reports.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">
                {loading ? 'Loading reports...' : 'No moderation reports found.'}
              </div>
            ) : (
              reports.map((r) => (
                <div key={r.id} className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase">
                        {r.target_type}
                      </span>
                      <span className="font-semibold text-zinc-950 dark:text-zinc-100">
                        {r.target_label || r.target_id}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                          r.status === 'open'
                            ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                            : r.status === 'resolved'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                    <p className="text-zinc-700 dark:text-zinc-300">
                      <strong>Reason:</strong> {r.reason} {r.details ? `— ${r.details}` : ''}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      Reported by {r.reporter_email || r.reporter_uid}
                      {r.reported_user_email ? ` · Target user: ${r.reported_user_email}` : ''} ·{' '}
                      {new Date(r.created_at_ms).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void openGroup(r.group_id)}
                      className="rounded border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-[11px] cursor-pointer"
                    >
                      Open group
                    </button>
                    {r.status !== 'resolved' && (
                      <button
                        type="button"
                        onClick={() => void handleUpdateReport(r.id, 'resolved')}
                        className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white cursor-pointer"
                      >
                        Resolve
                      </button>
                    )}
                    {r.status !== 'dismissed' && (
                      <button
                        type="button"
                        onClick={() => void handleUpdateReport(r.id, 'dismissed')}
                        className="rounded border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-[11px] cursor-pointer"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Group Detail & Moderation Modal */}
      {selectedGroupId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
                  {detail?.group.name || 'Study Group'}
                </h3>
                <p className="text-xs text-zinc-500">
                  {detail?.group.course_code} {detail?.group.course_name} · Owner:{' '}
                  {detail?.group.author_name} · Status: <strong className="capitalize">{detail?.group.status}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedGroupId(null);
                  setDetail(null);
                }}
                aria-label="Close group inspector"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailLoading || !detail ? (
              <div className="p-8 text-center text-xs text-zinc-500">Loading group details...</div>
            ) : (
              <>
                {/* Group Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 px-5 py-3">
                  <div className="flex items-center gap-1 text-xs">
                    {(['members', 'content', 'activity', 'reports'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setDetailTab(t)}
                        className={`rounded-md px-2.5 py-1 font-medium capitalize cursor-pointer ${
                          detailTab === t
                            ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {detail.group.status === 'active' ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void handleGroupStatus(detail.group.id, 'suspended')}
                      >
                        <ShieldBan className="h-3.5 w-3.5" />
                        Suspend Group
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => void handleGroupStatus(detail.group.id, 'active')}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Restore Group
                      </Button>
                    )}
                    {detail.group.status !== 'deleted' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleGroupStatus(detail.group.id, 'deleted')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {moderationNotice && (
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                      {moderationNotice}
                    </div>
                  )}

                  {detailTab === 'members' && (
                    <div className="space-y-4">
                      {/* Transfer ownership */}
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 text-xs">
                        <ArrowRightLeft className="h-4 w-4 text-zinc-500" />
                        <span className="font-medium">Transfer ownership:</span>
                        <select
                          value={transferTargetUid}
                          onChange={(e) => setTransferTargetUid(e.target.value)}
                          className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1 text-xs"
                        >
                          <option value="">Select active member...</option>
                          {detail.members
                            .filter((m) => m.status === 'active' && m.member_uid !== detail.group.author_uid)
                            .map((m) => (
                              <option key={m.member_uid} value={m.member_uid}>
                                {m.display_name} ({m.email || m.member_uid})
                              </option>
                            ))}
                        </select>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!transferTargetUid}
                          onClick={() => void handleTransferOwnership(detail.group.id)}
                        >
                          Transfer
                        </Button>
                      </div>

                      <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
                        {detail.members.map((m) => (
                          <div
                            key={m.member_uid}
                            className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                          >
                            <div>
                              <div className="font-medium text-zinc-950 dark:text-zinc-100">
                                {m.display_name}{' '}
                                <span className="ml-1 rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase">
                                  {m.role}
                                </span>
                                {m.status === 'removed' && (
                                  <span className="ml-1 text-red-600">(Removed)</span>
                                )}
                              </div>
                              <div className="text-[11px] text-zinc-500">
                                {m.email || m.member_uid} · Joined{' '}
                                {new Date(m.joined_at_ms).toLocaleDateString()}
                              </div>
                            </div>
                            {m.role !== 'owner' && m.status === 'active' && (
                              <button
                                type="button"
                                onClick={() => void handleRemoveMember(detail.group.id, m.member_uid)}
                                className="inline-flex items-center gap-1 rounded border border-red-200 dark:border-red-900 px-2 py-1 text-[11px] text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                              >
                                <UserMinus className="h-3 w-3" />
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {detailTab === 'content' && (
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-xs font-semibold text-zinc-950 dark:text-zinc-100 mb-2">
                          Shared Notes ({detail.notes.length})
                        </h4>
                        {detail.notes.length === 0 ? (
                          <p className="text-xs text-zinc-500">No shared notes in this group.</p>
                        ) : (
                          <div className="space-y-2">
                            {detail.notes.map((n) => (
                              <div
                                key={n.id}
                                className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 text-xs space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <span className="font-semibold text-zinc-950 dark:text-zinc-100">
                                      {n.title}
                                    </span>{' '}
                                    <span className="text-zinc-500">by {n.author_name}</span>{' '}
                                    <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] capitalize">
                                      {n.status}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {n.status !== 'hidden' && (
                                      <button
                                        type="button"
                                        onClick={() => void handleModerateNote(detail.group.id, n.id, 'hidden')}
                                        className="inline-flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-[11px] cursor-pointer"
                                      >
                                        <EyeOff className="h-3 w-3" /> Hide
                                      </button>
                                    )}
                                    {n.status !== 'active' && (
                                      <button
                                        type="button"
                                        onClick={() => void handleModerateNote(detail.group.id, n.id, 'active')}
                                        className="rounded border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-[11px] cursor-pointer"
                                      >
                                        Restore
                                      </button>
                                    )}
                                    {n.status !== 'deleted' && (
                                      <button
                                        type="button"
                                        onClick={() => void handleModerateNote(detail.group.id, n.id, 'deleted')}
                                        className="rounded border border-red-200 dark:border-red-900 px-2 py-0.5 text-[11px] text-red-600 cursor-pointer"
                                      >
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <p className="text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap line-clamp-3">
                                  {n.content}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-zinc-950 dark:text-zinc-100 mb-2">
                          Course Materials ({detail.materials.length})
                        </h4>
                        {detail.materials.length === 0 ? (
                          <p className="text-xs text-zinc-500">No course materials linked yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {detail.materials.map((m) => (
                              <div
                                key={m.source_id}
                                className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 text-xs"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText className="h-4 w-4 text-zinc-400 shrink-0" />
                                  <div className="truncate">
                                    <span className="font-medium text-zinc-950 dark:text-zinc-100">
                                      {m.title}
                                    </span>{' '}
                                    <span className="text-zinc-500">({m.material_type})</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] capitalize">
                                    {m.status}
                                  </span>
                                  {m.status === 'active' ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleModerateMaterial(m.uid, m.course_id, m.source_id, 'hidden')
                                      }
                                      className="rounded border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-[11px] cursor-pointer"
                                    >
                                      Hide
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleModerateMaterial(m.uid, m.course_id, m.source_id, 'active')
                                      }
                                      className="rounded border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-[11px] cursor-pointer"
                                    >
                                      Restore
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {detailTab === 'activity' && (
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
                      {detail.activity.length === 0 ? (
                        <p className="p-4 text-xs text-zinc-500">No group activity recorded yet.</p>
                      ) : (
                        detail.activity.map((a) => (
                          <div key={a.id} className="px-3.5 py-2.5 text-xs flex justify-between gap-2">
                            <div>
                              <span className="font-medium text-zinc-950 dark:text-zinc-100">
                                {a.actor_name}
                              </span>{' '}
                              <span className="font-mono text-[11px] text-zinc-500">[{a.action}]</span>{' '}
                              <span className="text-zinc-600 dark:text-zinc-400">{a.details}</span>
                            </div>
                            <span className="font-mono text-[11px] text-zinc-400 shrink-0">
                              {new Date(a.created_at_ms).toLocaleString()}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {detailTab === 'reports' && (
                    <div className="space-y-2">
                      {detail.reports.length === 0 ? (
                        <p className="text-xs text-zinc-500">No reports filed for this group.</p>
                      ) : (
                        detail.reports.map((r) => (
                          <div
                            key={r.id}
                            className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 text-xs flex items-center justify-between gap-2"
                          >
                            <div>
                              <div className="font-medium">
                                [{r.target_type}] {r.reason}
                              </div>
                              <div className="text-[11px] text-zinc-500">
                                {r.details} · Status: {r.status}
                              </div>
                            </div>
                            {r.status !== 'resolved' && (
                              <button
                                type="button"
                                onClick={() => void handleUpdateReport(r.id, 'resolved')}
                                className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] text-white cursor-pointer"
                              >
                                Resolve
                              </button>
                            )}
                          </div>
                        ))
                      )}
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
