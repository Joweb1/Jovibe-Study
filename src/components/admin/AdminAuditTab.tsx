import React, { useEffect, useState } from 'react';
import { ClipboardList, RefreshCw } from 'lucide-react';
import { apiFetchJson } from '../../services/api/authHeaders';
import type { AdminAuditLogRow } from './adminTypes';

export const AdminAuditTab: React.FC = () => {
  const [logs, setLogs] = useState<AdminAuditLogRow[]>([]);
  const [targetFilter, setTargetFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const qs = targetFilter ? `?targetType=${encodeURIComponent(targetFilter)}&limit=150` : '?limit=150';
      const data = await apiFetchJson<{ logs: AdminAuditLogRow[] }>(`/api/admin/audit-logs${qs}`);
      setLogs(data.logs || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, [targetFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-zinc-500" />
          <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
            Admin Audit Log
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="">All targets</option>
            <option value="user">Users</option>
            <option value="admin_api_key">API Keys</option>
            <option value="platform_settings">Feature Flags & Quota</option>
            <option value="study_group">Study Groups</option>
            <option value="group_note">Group Notes</option>
            <option value="group_report">Reports</option>
            <option value="material">Materials</option>
          </select>
          <button
            type="button"
            onClick={() => void loadLogs()}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
        {logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
            {loading ? 'Loading audit log...' : 'No admin actions recorded yet.'}
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-4 py-2.5 font-medium">Admin</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Target</th>
                <th className="px-4 py-2.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {logs.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-950/40">
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                    {new Date(row.created_at_ms).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">{row.admin_email}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-900 dark:text-zinc-100">
                      {row.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                    {row.target_type}:{row.target_id || 'global'}
                  </td>
                  <td className="px-4 py-2.5 max-w-md truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                    {row.details_json}
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
