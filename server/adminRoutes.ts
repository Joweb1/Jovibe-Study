import { Router } from 'express';
import { extractBearerToken, requireAdmin } from './auth.ts';
import { createId, getDb, writeAdminAuditLog } from './db.ts';
import {
  getLastFirebaseSyncStatus,
  importClientFirestoreSnapshot,
  syncAllFromFirebase,
  type ClientFirestoreSnapshotPayload,
} from './firebaseSync.ts';
import {
  ADMIN_MANAGED_PROVIDERS,
  addAdminApiKey,
  deleteAdminApiKey,
  getProviderKeySourceSummary,
  listAdminApiKeys,
  testAdminApiKeyById,
  updateAdminApiKey,
} from './adminKeyPool.ts';
import {
  deleteAdminKeyFromFirestore,
  getAdminVaultStatus,
  hydrateAdminVaultFromFirestore,
  persistAdminKeyToFirestore,
  persistPlatformSettingToFirestore,
} from './adminFirestoreVault.ts';
import {
  getFeatureFlags,
  getLagosDateKey,
  getNextLagosMidnightIso,
  getQuotaConfig,
  getUserAccessStatus,
  updateFeatureFlags,
  updateQuotaConfig,
} from './quotaService.ts';

function parseDateRangeMs(fromRaw: unknown, toRaw: unknown, defaultDays = 30): {
  fromMs: number;
  toMs: number;
} {
  const now = Date.now();
  let toMs = now;
  if (typeof toRaw === 'string' && toRaw.trim()) {
    const parsed = Date.parse(toRaw.includes('T') ? toRaw : `${toRaw}T23:59:59.999+01:00`);
    if (Number.isFinite(parsed)) toMs = parsed;
  }
  let fromMs = toMs - defaultDays * 86_400_000;
  if (typeof fromRaw === 'string' && fromRaw.trim()) {
    const parsed = Date.parse(fromRaw.includes('T') ? fromRaw : `${fromRaw}T00:00:00.000+01:00`);
    if (Number.isFinite(parsed)) fromMs = parsed;
  }
  if (fromMs > toMs) {
    fromMs = toMs - 86_400_000;
  }
  return { fromMs, toMs };
}

export function createAdminRouter(): Router {
  const router = Router();

  // Strictly enforce sole admin authentication on every single /api/admin/* endpoint
  router.use(requireAdmin);

  // =========================================================================
  // 1. OVERVIEW, FIREBASE SYNC & ALERTS
  // =========================================================================

  router.post('/sync-firebase', async (req, res) => {
    const result = await syncAllFromFirebase({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      adminIdToken: extractBearerToken(req),
      force: true,
    });
    res.json(result);
  });

  router.post('/import-firestore-snapshot', (req, res) => {
    const result = importClientFirestoreSnapshot({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      payload: (req.body ?? {}) as ClientFirestoreSnapshotPayload,
    });
    res.json(result);
  });

  router.get('/overview', async (req, res) => {
    const firebaseSync = await syncAllFromFirebase({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      adminIdToken: extractBearerToken(req),
      force: false,
    });
    const db = getDb();
    const now = Date.now();
    const todayKey = getLagosDateKey(now);
    const dayAgo = now - 86_400_000;
    const weekAgo = now - 7 * 86_400_000;
    const monthAgo = now - 30 * 86_400_000;

    const userStats = db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
          SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deleted,
          SUM(CASE WHEN last_active_at_ms >= ? THEN 1 ELSE 0 END) AS active_24h,
          SUM(CASE WHEN last_active_at_ms >= ? THEN 1 ELSE 0 END) AS active_7d
        FROM users`
      )
      .get(dayAgo, weekAgo) as Record<string, number>;

    const courseRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM user_courses_mirror')
      .get() as { cnt?: number };
    const materialRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM user_materials_mirror WHERE status != 'deleted'")
      .get() as { cnt?: number };
    const groupRow = db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended
        FROM study_groups WHERE status != 'deleted'`
      )
      .get() as Record<string, number>;
    const openReportsRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM group_reports WHERE status IN ('open', 'reviewing')")
      .get() as { cnt?: number };

    const aiStats = db
      .prepare(
        `SELECT
          COUNT(*) AS total_attempts,
          SUM(CASE WHEN is_logical_root = 1 THEN 1 ELSE 0 END) AS total_logical,
          SUM(CASE WHEN date_key_lagos = ? AND is_logical_root = 1 THEN 1 ELSE 0 END) AS today_logical,
          SUM(CASE WHEN created_at_ms >= ? AND is_logical_root = 1 THEN 1 ELSE 0 END) AS week_logical,
          SUM(CASE WHEN created_at_ms >= ? AND is_logical_root = 1 THEN 1 ELSE 0 END) AS month_logical,
          SUM(CASE WHEN key_origin IN ('shared_admin', 'shared_env') AND is_logical_root = 1 THEN 1 ELSE 0 END) AS shared_logical,
          SUM(CASE WHEN key_origin = 'personal_byok' AND is_logical_root = 1 THEN 1 ELSE 0 END) AS personal_logical,
          SUM(CASE WHEN is_failover = 1 THEN 1 ELSE 0 END) AS total_failovers,
          SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) AS total_rate_limits,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS total_failures,
          SUM(total_tokens) AS total_tokens
        FROM ai_request_logs`
      )
      .get(todayKey, weekAgo, monthAgo) as Record<string, number>;

    const alerts = db
      .prepare(
        `SELECT * FROM admin_alerts
         ORDER BY acknowledged ASC, created_at_ms DESC
         LIMIT 30`
      )
      .all();

    res.json({
      users: {
        total: Number(userStats?.total ?? 0),
        active: Number(userStats?.active ?? 0),
        suspended: Number(userStats?.suspended ?? 0),
        deleted: Number(userStats?.deleted ?? 0),
        active24h: Number(userStats?.active_24h ?? 0),
        active7d: Number(userStats?.active_7d ?? 0),
      },
      content: {
        totalCourses: Number(courseRow?.cnt ?? 0),
        totalMaterials: Number(materialRow?.cnt ?? 0),
        totalGroups: Number(groupRow?.total ?? 0),
        activeGroups: Number(groupRow?.active ?? 0),
        suspendedGroups: Number(groupRow?.suspended ?? 0),
        openReports: Number(openReportsRow?.cnt ?? 0),
      },
      aiUsage: {
        totalLogicalRequests: Number(aiStats?.total_logical ?? 0),
        totalProviderAttempts: Number(aiStats?.total_attempts ?? 0),
        todayRequests: Number(aiStats?.today_logical ?? 0),
        weekRequests: Number(aiStats?.week_logical ?? 0),
        monthRequests: Number(aiStats?.month_logical ?? 0),
        sharedRequests: Number(aiStats?.shared_logical ?? 0),
        personalRequests: Number(aiStats?.personal_logical ?? 0),
        totalFailovers: Number(aiStats?.total_failovers ?? 0),
        totalRateLimits: Number(aiStats?.total_rate_limits ?? 0),
        totalFailures: Number(aiStats?.total_failures ?? 0),
        totalTokens: Number(aiStats?.total_tokens ?? 0),
      },
      featureFlags: getFeatureFlags(),
      quotaConfig: getQuotaConfig(),
      providerSources: getProviderKeySourceSummary(),
      todayDateKeyLagos: todayKey,
      nextResetIso: getNextLagosMidnightIso(now),
      alerts,
      firebaseSync,
    });
  });

  router.post('/alerts/:alertId/acknowledge', (req, res) => {
    const db = getDb();
    db.prepare('UPDATE admin_alerts SET acknowledged = 1 WHERE id = ?').run(req.params.alertId);
    res.json({ ok: true });
  });

  // =========================================================================
  // 2. USERS MANAGEMENT & QUOTA / TRIAL OVERRIDES
  // =========================================================================

  router.get('/users', async (req, res) => {
    const firebaseSync = await syncAllFromFirebase({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      adminIdToken: extractBearerToken(req),
      force: false,
    });
    const db = getDb();
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : 'all';
    const todayKey = getLagosDateKey();

    const rows = db
      .prepare('SELECT * FROM users ORDER BY last_active_at_ms DESC LIMIT 500')
      .all() as Array<Record<string, unknown>>;

    const aiCountsRows = db
      .prepare(
        `SELECT uid,
                SUM(CASE WHEN is_logical_root = 1 THEN 1 ELSE 0 END) AS total_requests,
                SUM(CASE WHEN key_origin IN ('shared_admin', 'shared_env') AND is_logical_root = 1 THEN 1 ELSE 0 END) AS shared_requests,
                SUM(CASE WHEN key_origin = 'personal_byok' AND is_logical_root = 1 THEN 1 ELSE 0 END) AS personal_requests
         FROM ai_request_logs
         GROUP BY uid`
      )
      .all() as Array<{ uid: string; total_requests: number; shared_requests: number; personal_requests: number }>;

    const aiMap = new Map(aiCountsRows.map((r) => [r.uid, r]));

    const enriched = rows.map((row) => {
      const uid = String(row.uid);
      const access = getUserAccessStatus(uid);
      const aiCounts = aiMap.get(uid);
      return {
        uid,
        email: String(row.email || ''),
        displayName: String(row.display_name || ''),
        photoURL: String(row.photo_url || ''),
        status: String(row.status || 'active'),
        registeredAtMs: Number(row.registered_at_ms),
        lastActiveAtMs: Number(row.last_active_at_ms),
        coursesCount: Number(row.courses_count || 0),
        materialsCount: Number(row.materials_count || 0),
        hasPersonalKey: Boolean(row.has_personal_key),
        notes: String(row.notes || ''),
        freeAccess: access.freeAccess,
        quota: access.quota,
        todayDateKeyLagos: todayKey,
        aiStats: {
          totalRequests: Number(aiCounts?.total_requests ?? 0),
          sharedRequests: Number(aiCounts?.shared_requests ?? 0),
          personalRequests: Number(aiCounts?.personal_requests ?? 0),
        },
      };
    });

    const filtered = enriched.filter((u) => {
      if (statusFilter === 'active' && u.status !== 'active') return false;
      if (statusFilter === 'suspended' && u.status !== 'suspended') return false;
      if (statusFilter === 'deleted' && u.status !== 'deleted') return false;
      if (statusFilter === 'trial_active' && !u.freeAccess.active) return false;
      if (statusFilter === 'trial_expired' && !u.freeAccess.expired) return false;
      if (statusFilter === 'quota_exhausted' && u.quota.remaining > 0) return false;
      if (search) {
        const hay = `${u.displayName} ${u.email} ${u.uid}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    res.json({
      users: filtered,
      total: filtered.length,
      firebaseSync: firebaseSync ?? getLastFirebaseSyncStatus(),
    });
  });

  router.get('/users/:uid', (req, res) => {
    const uid = req.params.uid;
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const access = getUserAccessStatus(uid);
    const courses = db
      .prepare('SELECT * FROM user_courses_mirror WHERE uid = ? ORDER BY updated_at_ms DESC')
      .all(uid);
    const materials = db
      .prepare('SELECT * FROM user_materials_mirror WHERE uid = ? ORDER BY created_at_ms DESC LIMIT 200')
      .all(uid);
    const recentActivity = db
      .prepare('SELECT * FROM user_activity_events WHERE uid = ? ORDER BY created_at_ms DESC LIMIT 100')
      .all(uid);
    const recentAiLogs = db
      .prepare(
        `SELECT id, logical_request_id, feature, task, key_origin, provider, model, status,
                is_failover, input_tokens, output_tokens, total_tokens, latency_ms, error_code,
                date_key_lagos, created_at_ms
         FROM ai_request_logs
         WHERE uid = ?
         ORDER BY created_at_ms DESC
         LIMIT 100`
      )
      .all(uid);

    const featureBreakdown = db
      .prepare(
        `SELECT feature, COUNT(*) AS count
         FROM ai_request_logs
         WHERE uid = ? AND is_logical_root = 1
         GROUP BY feature
         ORDER BY count DESC`
      )
      .all(uid);

    res.json({
      user: {
        uid,
        email: String(row.email || ''),
        displayName: String(row.display_name || ''),
        photoURL: String(row.photo_url || ''),
        status: String(row.status || 'active'),
        registeredAtMs: Number(row.registered_at_ms),
        lastActiveAtMs: Number(row.last_active_at_ms),
        coursesCount: Number(row.courses_count || 0),
        materialsCount: Number(row.materials_count || 0),
        hasPersonalKey: Boolean(row.has_personal_key),
        notes: String(row.notes || ''),
        freeAccessDaysOverride: row.free_access_days_override,
        freeAccessExpiresAtMs: row.free_access_expires_at_ms,
        dailyQuotaOverride: row.daily_quota_override,
        sharedAiAccessOverride: row.shared_ai_access_override,
        freeAccess: access.freeAccess,
        quota: access.quota,
      },
      courses,
      materials,
      recentActivity,
      recentAiLogs,
      featureBreakdown,
    });
  });

  router.patch('/users/:uid/status', (req, res) => {
    const uid = req.params.uid;
    const { status, notes } = (req.body ?? {}) as { status?: string; notes?: string };
    if (status !== 'active' && status !== 'suspended' && status !== 'deleted') {
      res.status(400).json({ error: 'Invalid status. Must be active, suspended, or deleted.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT uid, email, status FROM users WHERE uid = ?').get(uid) as
      | { uid?: string; email?: string; status?: string }
      | undefined;
    if (!existing?.uid) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    if (uid === req.authUser!.uid && status !== 'active') {
      res.status(400).json({ error: 'You cannot suspend or delete the sole admin account.' });
      return;
    }

    db.prepare(
      `UPDATE users
       SET status = ?, notes = COALESCE(?, notes), updated_at_ms = ?
       WHERE uid = ?`
    ).run(status, typeof notes === 'string' ? notes.slice(0, 1000) : null, Date.now(), uid);

    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: `user_status_${status}`,
      targetType: 'user',
      targetId: uid,
      details: { previousStatus: existing.status, newStatus: status, email: existing.email, notes },
    });

    res.json({ ok: true, status });
  });

  router.patch('/users/:uid/overrides', (req, res) => {
    const uid = req.params.uid;
    const {
      dailyQuotaOverride,
      freeAccessDaysOverride,
      freeAccessExpiresAtMs,
      sharedAiAccessOverride,
      notes,
    } = (req.body ?? {}) as {
      dailyQuotaOverride?: number | null;
      freeAccessDaysOverride?: number | null;
      freeAccessExpiresAtMs?: number | null;
      sharedAiAccessOverride?: 'default' | 'force_allow' | 'force_block';
      notes?: string;
    };

    const db = getDb();
    const existing = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const nextDaily =
      dailyQuotaOverride === null
        ? null
        : typeof dailyQuotaOverride === 'number' && Number.isFinite(dailyQuotaOverride)
        ? Math.max(0, Math.min(10000, Math.floor(dailyQuotaOverride)))
        : (existing.daily_quota_override as number | null);

    const nextDays =
      freeAccessDaysOverride === null
        ? null
        : typeof freeAccessDaysOverride === 'number' && Number.isFinite(freeAccessDaysOverride)
        ? Math.max(1, Math.min(365, Math.floor(freeAccessDaysOverride)))
        : (existing.free_access_days_override as number | null);

    const nextExpires =
      freeAccessExpiresAtMs === null
        ? null
        : typeof freeAccessExpiresAtMs === 'number' && Number.isFinite(freeAccessExpiresAtMs)
        ? Math.floor(freeAccessExpiresAtMs)
        : (existing.free_access_expires_at_ms as number | null);

    const validOverrides = new Set(['default', 'force_allow', 'force_block']);
    const nextSharedOverride =
      typeof sharedAiAccessOverride === 'string' && validOverrides.has(sharedAiAccessOverride)
        ? sharedAiAccessOverride
        : String(existing.shared_ai_access_override || 'default');

    db.prepare(
      `UPDATE users
       SET daily_quota_override = ?,
           free_access_days_override = ?,
           free_access_expires_at_ms = ?,
           shared_ai_access_override = ?,
           notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END,
           updated_at_ms = ?
       WHERE uid = ?`
    ).run(
      nextDaily,
      nextDays,
      nextExpires,
      nextSharedOverride,
      typeof notes === 'string' ? notes : null,
      typeof notes === 'string' ? notes.slice(0, 1000) : '',
      Date.now(),
      uid
    );

    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: 'user_overrides_updated',
      targetType: 'user',
      targetId: uid,
      details: {
        email: existing.email,
        dailyQuotaOverride: nextDaily,
        freeAccessDaysOverride: nextDays,
        freeAccessExpiresAtMs: nextExpires,
        sharedAiAccessOverride: nextSharedOverride,
      },
    });

    res.json({ ok: true, access: getUserAccessStatus(uid) });
  });

  router.post('/users/:uid/reset-quota', (req, res) => {
    const uid = req.params.uid;
    const db = getDb();
    const existing = db.prepare('SELECT uid, email FROM users WHERE uid = ?').get(uid) as
      | { uid?: string; email?: string }
      | undefined;
    if (!existing?.uid) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const todayKey = getLagosDateKey();
    db.prepare(
      `INSERT INTO user_daily_quotas (uid, date_key, used_count, daily_limit_snapshot, updated_at_ms)
       VALUES (?, ?, 0, ?, ?)
       ON CONFLICT(uid, date_key) DO UPDATE SET used_count = 0, updated_at_ms = excluded.updated_at_ms`
    ).run(uid, todayKey, getQuotaConfig().defaultDailyQuota, Date.now());

    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: 'user_quota_reset',
      targetType: 'user',
      targetId: uid,
      details: { email: existing.email, dateKeyLagos: todayKey },
    });

    res.json({ ok: true, access: getUserAccessStatus(uid) });
  });

  // =========================================================================
  // 3. FEATURE FLAGS & GLOBAL QUOTA SETTINGS
  // =========================================================================

  router.get('/feature-flags', async (req, res) => {
    await hydrateAdminVaultFromFirestore({ bearerToken: extractBearerToken(req) || undefined });
    res.json(getFeatureFlags());
  });

  router.put('/feature-flags', async (req, res) => {
    const updated = updateFeatureFlags(req.body ?? {}, req.authUser!.email);
    await persistPlatformSettingToFirestore('feature_flags', extractBearerToken(req) || undefined);
    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: 'feature_flags_updated',
      targetType: 'platform_settings',
      targetId: 'feature_flags',
      details: updated as unknown as Record<string, unknown>,
    });
    res.json(updated);
  });

  router.get('/quota-config', async (req, res) => {
    await hydrateAdminVaultFromFirestore({ bearerToken: extractBearerToken(req) || undefined });
    res.json(getQuotaConfig());
  });

  router.put('/quota-config', async (req, res) => {
    const updated = updateQuotaConfig(req.body ?? {}, req.authUser!.email);
    await persistPlatformSettingToFirestore('quota_config', extractBearerToken(req) || undefined);
    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: 'quota_config_updated',
      targetType: 'platform_settings',
      targetId: 'quota_config',
      details: updated as unknown as Record<string, unknown>,
    });
    res.json(updated);
  });

  // =========================================================================
  // 4. ADMIN API KEYS & ROTATION (ALL PROVIDERS EXCEPT CEREBRAS)
  // =========================================================================

  router.get('/api-keys', async (req, res) => {
    const forceSync = req.query.forceSync === '1' || req.query.forceSync === 'true';
    const bearer = extractBearerToken(req) || undefined;
    const vaultStatus = await hydrateAdminVaultFromFirestore({
      bearerToken: bearer,
      force: forceSync,
    });
    res.json({
      supportedProviders: ADMIN_MANAGED_PROVIDERS,
      keys: listAdminApiKeys(),
      providerSources: getProviderKeySourceSummary(),
      vaultStatus,
    });
  });

  router.post('/api-keys/sync-vault', async (req, res) => {
    const bearer = extractBearerToken(req) || undefined;
    await hydrateAdminVaultFromFirestore({ bearerToken: bearer, force: true });
    // Mirror any locally stored keys back up to Firestore so nothing is ever lost
    const localKeys = listAdminApiKeys();
    let pushed = 0;
    for (const k of localKeys) {
      const r = await persistAdminKeyToFirestore(k.id, bearer);
      if (r.synced) pushed += 1;
    }
    await persistPlatformSettingToFirestore('feature_flags', bearer);
    await persistPlatformSettingToFirestore('quota_config', bearer);

    res.json({
      ok: true,
      pushed,
      keys: listAdminApiKeys(),
      providerSources: getProviderKeySourceSummary(),
      vaultStatus: getAdminVaultStatus(),
    });
  });

  router.post('/api-keys', async (req, res) => {
    try {
      const { provider, label, apiKey, priority } = (req.body ?? {}) as {
        provider?: string;
        label?: string;
        apiKey?: string;
        priority?: number;
      };
      const created = addAdminApiKey({
        provider: String(provider || ''),
        label: String(label || ''),
        rawKey: String(apiKey || ''),
        priority: typeof priority === 'number' ? priority : undefined,
      });

      const bearer = extractBearerToken(req) || undefined;
      const syncResult = await persistAdminKeyToFirestore(created.id, bearer);

      writeAdminAuditLog({
        adminUid: req.authUser!.uid,
        adminEmail: req.authUser!.email,
        action: 'admin_api_key_added',
        targetType: 'admin_api_key',
        targetId: created.id,
        details: {
          provider: created.provider,
          label: created.label,
          keyMask: created.keyMask,
          firestoreSynced: syncResult.synced,
        },
      });

      res.status(201).json({
        key: created,
        providerSources: getProviderKeySourceSummary(),
        vaultSynced: syncResult.synced,
        vaultStatus: getAdminVaultStatus(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to add API key.' });
    }
  });

  router.patch('/api-keys/:id', async (req, res) => {
    try {
      const { label, enabled, priority, resetCooldown } = (req.body ?? {}) as {
        label?: string;
        enabled?: boolean;
        priority?: number;
        resetCooldown?: boolean;
      };
      const updated = updateAdminApiKey(req.params.id, {
        label,
        enabled,
        priority,
        resetCooldown,
      });

      const bearer = extractBearerToken(req) || undefined;
      const syncResult = await persistAdminKeyToFirestore(updated.id, bearer);

      writeAdminAuditLog({
        adminUid: req.authUser!.uid,
        adminEmail: req.authUser!.email,
        action: 'admin_api_key_updated',
        targetType: 'admin_api_key',
        targetId: updated.id,
        details: {
          provider: updated.provider,
          enabled: updated.enabled,
          priority: updated.priority,
          resetCooldown: Boolean(resetCooldown),
          firestoreSynced: syncResult.synced,
        },
      });

      res.json({
        key: updated,
        providerSources: getProviderKeySourceSummary(),
        vaultSynced: syncResult.synced,
        vaultStatus: getAdminVaultStatus(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update API key.' });
    }
  });

  router.delete('/api-keys/:id', async (req, res) => {
    const deleted = deleteAdminApiKey(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    const bearer = extractBearerToken(req) || undefined;
    const syncResult = await deleteAdminKeyFromFirestore(req.params.id, bearer);

    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: 'admin_api_key_removed',
      targetType: 'admin_api_key',
      targetId: req.params.id,
      details: { firestoreSynced: syncResult.synced },
    });
    res.json({
      ok: true,
      providerSources: getProviderKeySourceSummary(),
      vaultSynced: syncResult.synced,
      vaultStatus: getAdminVaultStatus(),
    });
  });

  router.post('/api-keys/:id/test', async (req, res) => {
    try {
      const result = await testAdminApiKeyById(req.params.id);
      await persistAdminKeyToFirestore(req.params.id, extractBearerToken(req) || undefined);
      res.json(result);
    } catch (err) {
      res.status(404).json({ ok: false, error: err instanceof Error ? err.message : 'Test failed.' });
    }
  });

  // =========================================================================
  // 5. ANALYTICS & AI USAGE MONITORING
  // =========================================================================

  router.get('/analytics/ai-usage', (req, res) => {
    const db = getDb();
    const { fromMs, toMs } = parseDateRangeMs(req.query.from, req.query.to, 30);
    const originFilter = typeof req.query.origin === 'string' ? req.query.origin : 'all';
    const todayKey = getLagosDateKey();

    let originClause = '';
    if (originFilter === 'shared') {
      originClause = " AND key_origin IN ('shared_admin', 'shared_env')";
    } else if (originFilter === 'personal') {
      originClause = " AND key_origin = 'personal_byok'";
    }

    const summary = db
      .prepare(
        `SELECT
          COUNT(*) AS total_attempts,
          SUM(CASE WHEN is_logical_root = 1 THEN 1 ELSE 0 END) AS total_logical_requests,
          SUM(CASE WHEN key_origin IN ('shared_admin', 'shared_env') AND is_logical_root = 1 THEN 1 ELSE 0 END) AS shared_requests,
          SUM(CASE WHEN key_origin = 'personal_byok' AND is_logical_root = 1 THEN 1 ELSE 0 END) AS personal_requests,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful_attempts,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_attempts,
          SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) AS rate_limit_hits,
          SUM(CASE WHEN status = 'quota_blocked' THEN 1 ELSE 0 END) AS quota_blocked,
          SUM(CASE WHEN is_failover = 1 THEN 1 ELSE 0 END) AS failovers,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,
          SUM(total_tokens) AS total_tokens,
          AVG(CASE WHEN latency_ms > 0 THEN latency_ms END) AS avg_latency_ms
        FROM ai_request_logs
        WHERE created_at_ms >= ? AND created_at_ms <= ? ${originClause}`
      )
      .get(fromMs, toMs) as Record<string, number>;

    const dailySeries = db
      .prepare(
        `SELECT
          date_key_lagos AS dateKey,
          SUM(CASE WHEN is_logical_root = 1 THEN 1 ELSE 0 END) AS total,
          SUM(CASE WHEN key_origin IN ('shared_admin', 'shared_env') AND is_logical_root = 1 THEN 1 ELSE 0 END) AS shared,
          SUM(CASE WHEN key_origin = 'personal_byok' AND is_logical_root = 1 THEN 1 ELSE 0 END) AS personal,
          SUM(CASE WHEN status = 'failed' OR status = 'rate_limited' THEN 1 ELSE 0 END) AS errors,
          SUM(CASE WHEN is_failover = 1 THEN 1 ELSE 0 END) AS failovers,
          SUM(total_tokens) AS tokens
        FROM ai_request_logs
        WHERE created_at_ms >= ? AND created_at_ms <= ? ${originClause}
        GROUP BY date_key_lagos
        ORDER BY date_key_lagos ASC`
      )
      .all(fromMs, toMs);

    const byFeature = db
      .prepare(
        `SELECT
          feature,
          SUM(CASE WHEN is_logical_root = 1 THEN 1 ELSE 0 END) AS requests,
          SUM(CASE WHEN key_origin IN ('shared_admin', 'shared_env') AND is_logical_root = 1 THEN 1 ELSE 0 END) AS sharedRequests,
          SUM(CASE WHEN key_origin = 'personal_byok' AND is_logical_root = 1 THEN 1 ELSE 0 END) AS personalRequests,
          SUM(total_tokens) AS totalTokens
        FROM ai_request_logs
        WHERE created_at_ms >= ? AND created_at_ms <= ? ${originClause}
        GROUP BY feature
        ORDER BY requests DESC`
      )
      .all(fromMs, toMs);

    const byProvider = db
      .prepare(
        `SELECT
          provider,
          COUNT(*) AS totalAttempts,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failures,
          SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) AS rateLimits,
          SUM(CASE WHEN is_failover = 1 THEN 1 ELSE 0 END) AS failovers,
          SUM(CASE WHEN key_origin IN ('shared_admin', 'shared_env') THEN 1 ELSE 0 END) AS sharedAttempts,
          SUM(CASE WHEN key_origin = 'personal_byok' THEN 1 ELSE 0 END) AS personalAttempts,
          SUM(input_tokens) AS inputTokens,
          SUM(output_tokens) AS outputTokens,
          SUM(total_tokens) AS totalTokens,
          ROUND(AVG(CASE WHEN latency_ms > 0 THEN latency_ms END)) AS avgLatencyMs
        FROM ai_request_logs
        WHERE created_at_ms >= ? AND created_at_ms <= ? AND provider != 'system' ${originClause}
        GROUP BY provider
        ORDER BY totalAttempts DESC`
      )
      .all(fromMs, toMs);

    const materialUploadsByDay = db
      .prepare(
        `SELECT
          strftime('%Y-%m-%d', created_at_ms / 1000, 'unixepoch', '+1 hour') AS dateKey,
          COUNT(*) AS uploads
        FROM user_materials_mirror
        WHERE created_at_ms >= ? AND created_at_ms <= ? AND status != 'deleted'
        GROUP BY dateKey
        ORDER BY dateKey ASC`
      )
      .all(fromMs, toMs);

    const materialUploadsByType = db
      .prepare(
        `SELECT material_type AS materialType, COUNT(*) AS count
         FROM user_materials_mirror
         WHERE created_at_ms >= ? AND created_at_ms <= ? AND status != 'deleted'
         GROUP BY material_type
         ORDER BY count DESC`
      )
      .all(fromMs, toMs);

    // Heavy users & users exhausting today's quota
    const allUsers = db
      .prepare("SELECT uid, email, display_name, status FROM users WHERE status != 'deleted'")
      .all() as Array<{ uid: string; email: string; display_name: string; status: string }>;

    const userRangeUsageRows = db
      .prepare(
        `SELECT uid,
                SUM(CASE WHEN is_logical_root = 1 THEN 1 ELSE 0 END) AS range_total,
                SUM(CASE WHEN key_origin IN ('shared_admin', 'shared_env') AND is_logical_root = 1 THEN 1 ELSE 0 END) AS range_shared,
                SUM(CASE WHEN key_origin = 'personal_byok' AND is_logical_root = 1 THEN 1 ELSE 0 END) AS range_personal,
                SUM(total_tokens) AS range_tokens
         FROM ai_request_logs
         WHERE created_at_ms >= ? AND created_at_ms <= ?
         GROUP BY uid`
      )
      .all(fromMs, toMs) as Array<{
      uid: string;
      range_total: number;
      range_shared: number;
      range_personal: number;
      range_tokens: number;
    }>;
    const rangeMap = new Map(userRangeUsageRows.map((r) => [r.uid, r]));

    const userUsageList = allUsers
      .map((u) => {
        const access = getUserAccessStatus(u.uid);
        const r = rangeMap.get(u.uid);
        const pct =
          access.quota.limit > 0
            ? Math.round((access.quota.used / access.quota.limit) * 100)
            : 0;
        return {
          uid: u.uid,
          email: u.email,
          displayName: u.display_name,
          status: u.status,
          todayUsed: access.quota.used,
          dailyLimit: access.quota.limit,
          todayRemaining: access.quota.remaining,
          todayPct: pct,
          quotaExhausted: access.quota.limit > 0 && access.quota.used >= access.quota.limit,
          freeAccessActive: access.freeAccess.active,
          freeAccessExpiresAtMs: access.freeAccess.expiresAtMs,
          rangeTotal: Number(r?.range_total ?? 0),
          rangeShared: Number(r?.range_shared ?? 0),
          rangePersonal: Number(r?.range_personal ?? 0),
          rangeTokens: Number(r?.range_tokens ?? 0),
        };
      })
      .sort((a, b) => b.todayUsed - a.todayUsed || b.rangeTotal - a.rangeTotal);

    res.json({
      fromMs,
      toMs,
      todayDateKeyLagos: todayKey,
      summary: {
        totalAttempts: Number(summary?.total_attempts ?? 0),
        totalLogicalRequests: Number(summary?.total_logical_requests ?? 0),
        sharedRequests: Number(summary?.shared_requests ?? 0),
        personalRequests: Number(summary?.personal_requests ?? 0),
        successfulAttempts: Number(summary?.successful_attempts ?? 0),
        failedAttempts: Number(summary?.failed_attempts ?? 0),
        rateLimitHits: Number(summary?.rate_limit_hits ?? 0),
        quotaBlocked: Number(summary?.quota_blocked ?? 0),
        failovers: Number(summary?.failovers ?? 0),
        inputTokens: Number(summary?.input_tokens ?? 0),
        outputTokens: Number(summary?.output_tokens ?? 0),
        totalTokens: Number(summary?.total_tokens ?? 0),
        avgLatencyMs: Math.round(Number(summary?.avg_latency_ms ?? 0)),
      },
      dailySeries,
      byFeature,
      byProvider,
      materialUploadsByDay,
      materialUploadsByType,
      heavyUsers: userUsageList.slice(0, 30),
      exhaustedUsers: userUsageList.filter((u) => u.quotaExhausted),
    });
  });

  // =========================================================================
  // 6. GROUP STUDY MANAGEMENT & MODERATION
  // =========================================================================

  router.get('/groups', (req, res) => {
    const db = getDb();
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : 'all';

    const groups = db
      .prepare(
        `SELECT g.*,
          (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.status = 'active') AS active_members,
          (SELECT COUNT(*) FROM group_shared_notes gn WHERE gn.group_id = g.id AND gn.status != 'deleted') AS notes_count,
          (SELECT COUNT(*) FROM group_reports gr WHERE gr.group_id = g.id AND gr.status IN ('open', 'reviewing')) AS open_reports_count
        FROM study_groups g
        ORDER BY g.last_activity_at_ms DESC
        LIMIT 300`
      )
      .all() as Array<Record<string, unknown>>;

    const filtered = groups.filter((g) => {
      if (statusFilter !== 'all' && statusFilter !== 'reported' && g.status !== statusFilter) {
        return false;
      }
      if (statusFilter === 'reported' && Number(g.open_reports_count ?? 0) === 0) {
        return false;
      }
      if (search) {
        const hay = `${g.name} ${g.course_code} ${g.course_name} ${g.author_name} ${g.author_email}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    res.json({ groups: filtered });
  });

  router.get('/groups/reports', (req, res) => {
    const db = getDb();
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'all';
    const reports =
      statusFilter === 'all'
        ? db.prepare('SELECT * FROM group_reports ORDER BY created_at_ms DESC LIMIT 200').all()
        : db
            .prepare('SELECT * FROM group_reports WHERE status = ? ORDER BY created_at_ms DESC LIMIT 200')
            .all(statusFilter);

    // Aggregate abusive users with multiple reports
    const abusiveUsers = db
      .prepare(
        `SELECT reported_user_uid AS uid, reported_user_email AS email, COUNT(*) AS reportCount,
                SUM(CASE WHEN status IN ('open', 'reviewing') THEN 1 ELSE 0 END) AS openReports
         FROM group_reports
         WHERE reported_user_uid != ''
         GROUP BY reported_user_uid
         ORDER BY reportCount DESC
         LIMIT 30`
      )
      .all();

    res.json({ reports, abusiveUsers });
  });

  router.get('/groups/:groupId', (req, res) => {
    const db = getDb();
    const groupId = req.params.groupId;
    const group = db.prepare('SELECT * FROM study_groups WHERE id = ?').get(groupId) as
      | Record<string, unknown>
      | undefined;
    if (!group) {
      res.status(404).json({ error: 'Study group not found.' });
      return;
    }

    const members = db
      .prepare('SELECT * FROM group_members WHERE group_id = ? ORDER BY role DESC, joined_at_ms ASC')
      .all(groupId);
    const notes = db
      .prepare('SELECT * FROM group_shared_notes WHERE group_id = ? ORDER BY created_at_ms DESC')
      .all(groupId);
    const materials = db
      .prepare(
        `SELECT * FROM user_materials_mirror
         WHERE uid = ? AND course_id = ?
         ORDER BY created_at_ms DESC`
      )
      .all(String(group.author_uid), String(group.course_id));
    const activity = db
      .prepare('SELECT * FROM group_activity_logs WHERE group_id = ? ORDER BY created_at_ms DESC LIMIT 100')
      .all(groupId);
    const reports = db
      .prepare('SELECT * FROM group_reports WHERE group_id = ? ORDER BY created_at_ms DESC')
      .all(groupId);

    res.json({ group, members, notes, materials, activity, reports });
  });

  router.patch('/groups/:groupId/status', (req, res) => {
    const groupId = req.params.groupId;
    const { status, reason } = (req.body ?? {}) as { status?: string; reason?: string };
    if (status !== 'active' && status !== 'suspended' && status !== 'deleted') {
      res.status(400).json({ error: 'Status must be active, suspended, or deleted.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, name, status FROM study_groups WHERE id = ?').get(groupId) as
      | { id?: string; name?: string; status?: string }
      | undefined;
    if (!existing?.id) {
      res.status(404).json({ error: 'Study group not found.' });
      return;
    }

    const now = Date.now();
    db.prepare('UPDATE study_groups SET status = ?, updated_at_ms = ? WHERE id = ?').run(
      status,
      now,
      groupId
    );
    db.prepare(
      `INSERT INTO group_activity_logs (id, group_id, actor_uid, actor_name, action, details, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId('gact'),
      groupId,
      req.authUser!.uid,
      `Admin (${req.authUser!.email})`,
      `group_${status}`,
      reason ? String(reason).slice(0, 300) : `Group status set to ${status}`,
      now
    );

    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: `group_${status}`,
      targetType: 'study_group',
      targetId: groupId,
      details: { groupName: existing.name, previousStatus: existing.status, newStatus: status, reason },
    });

    res.json({ ok: true, status });
  });

  router.delete('/groups/:groupId/members/:memberUid', (req, res) => {
    const { groupId, memberUid } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : '';
    const db = getDb();

    const group = db.prepare('SELECT id, name, author_uid FROM study_groups WHERE id = ?').get(groupId) as
      | { id?: string; name?: string; author_uid?: string }
      | undefined;
    if (!group?.id) {
      res.status(404).json({ error: 'Study group not found.' });
      return;
    }
    if (group.author_uid === memberUid) {
      res.status(400).json({ error: 'Transfer group ownership before removing the current owner.' });
      return;
    }

    const now = Date.now();
    db.prepare(
      "UPDATE group_members SET status = 'removed', updated_at_ms = ? WHERE group_id = ? AND member_uid = ?"
    ).run(now, groupId, memberUid);

    const cntRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = ? AND status = 'active'")
      .get(groupId) as { cnt?: number };
    db.prepare('UPDATE study_groups SET member_count = ?, updated_at_ms = ? WHERE id = ?').run(
      Number(cntRow?.cnt ?? 0),
      now,
      groupId
    );

    db.prepare(
      `INSERT INTO group_activity_logs (id, group_id, actor_uid, actor_name, action, details, created_at_ms)
       VALUES (?, ?, ?, ?, 'member_removed', ?, ?)`
    ).run(
      createId('gact'),
      groupId,
      req.authUser!.uid,
      `Admin (${req.authUser!.email})`,
      `Removed member ${memberUid}${reason ? `: ${reason}` : ''}`,
      now
    );

    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: 'group_member_removed',
      targetType: 'study_group',
      targetId: groupId,
      details: { groupName: group.name, memberUid, reason },
    });

    res.json({ ok: true });
  });

  router.post('/groups/:groupId/transfer-ownership', (req, res) => {
    const { groupId } = req.params;
    const { newOwnerUid } = (req.body ?? {}) as { newOwnerUid?: string };
    if (typeof newOwnerUid !== 'string' || !newOwnerUid.trim()) {
      res.status(400).json({ error: 'newOwnerUid is required.' });
      return;
    }

    const db = getDb();
    const group = db.prepare('SELECT * FROM study_groups WHERE id = ?').get(groupId) as
      | Record<string, unknown>
      | undefined;
    if (!group) {
      res.status(404).json({ error: 'Study group not found.' });
      return;
    }

    const targetMember = db
      .prepare('SELECT * FROM group_members WHERE group_id = ? AND member_uid = ?')
      .get(groupId, newOwnerUid) as Record<string, unknown> | undefined;
    const targetUser = db
      .prepare('SELECT uid, email, display_name, photo_url FROM users WHERE uid = ?')
      .get(newOwnerUid) as { uid?: string; email?: string; display_name?: string; photo_url?: string } | undefined;

    if (!targetMember && !targetUser) {
      res.status(404).json({ error: 'Target user not found.' });
      return;
    }

    const newOwnerName = String(targetMember?.display_name || targetUser?.display_name || 'Student');
    const newOwnerEmail = String(targetMember?.email || targetUser?.email || '');
    const previousOwnerUid = String(group.author_uid);
    const now = Date.now();

    db.prepare(
      `UPDATE study_groups
       SET author_uid = ?, author_name = ?, author_email = ?, updated_at_ms = ?
       WHERE id = ?`
    ).run(newOwnerUid, newOwnerName, newOwnerEmail, now, groupId);

    db.prepare(
      "UPDATE group_members SET role = 'member', updated_at_ms = ? WHERE group_id = ? AND member_uid = ?"
    ).run(now, groupId, previousOwnerUid);

    db.prepare(
      `INSERT INTO group_members (group_id, member_uid, display_name, email, photo_url, role, status, joined_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, 'owner', 'active', ?, ?)
       ON CONFLICT(group_id, member_uid) DO UPDATE SET role = 'owner', status = 'active', updated_at_ms = excluded.updated_at_ms`
    ).run(groupId, newOwnerUid, newOwnerName, newOwnerEmail, String(targetUser?.photo_url || ''), now, now);

    db.prepare(
      `INSERT INTO group_activity_logs (id, group_id, actor_uid, actor_name, action, details, created_at_ms)
       VALUES (?, ?, ?, ?, 'ownership_transferred', ?, ?)`
    ).run(
      createId('gact'),
      groupId,
      req.authUser!.uid,
      `Admin (${req.authUser!.email})`,
      `Ownership transferred from ${previousOwnerUid} to ${newOwnerName} (${newOwnerUid})`,
      now
    );

    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: 'group_ownership_transferred',
      targetType: 'study_group',
      targetId: groupId,
      details: { groupName: group.name, previousOwnerUid, newOwnerUid, newOwnerName },
    });

    res.json({ ok: true });
  });

  router.patch('/groups/:groupId/notes/:noteId', (req, res) => {
    const { groupId, noteId } = req.params;
    const { status, moderationReason } = (req.body ?? {}) as {
      status?: string;
      moderationReason?: string;
    };
    if (status !== 'active' && status !== 'hidden' && status !== 'deleted') {
      res.status(400).json({ error: 'Invalid note status.' });
      return;
    }

    const db = getDb();
    const existing = db
      .prepare('SELECT id, title FROM group_shared_notes WHERE id = ? AND group_id = ?')
      .get(noteId, groupId) as { id?: string; title?: string } | undefined;
    if (!existing?.id) {
      res.status(404).json({ error: 'Shared note not found.' });
      return;
    }

    const now = Date.now();
    db.prepare(
      'UPDATE group_shared_notes SET status = ?, moderation_reason = ?, updated_at_ms = ? WHERE id = ?'
    ).run(status, String(moderationReason || '').slice(0, 300), now, noteId);

    db.prepare(
      `INSERT INTO group_activity_logs (id, group_id, actor_uid, actor_name, action, details, created_at_ms)
       VALUES (?, ?, ?, ?, 'note_moderated', ?, ?)`
    ).run(
      createId('gact'),
      groupId,
      req.authUser!.uid,
      `Admin (${req.authUser!.email})`,
      `Note "${existing.title}" marked ${status}${moderationReason ? ` (${moderationReason})` : ''}`,
      now
    );

    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: `group_note_${status}`,
      targetType: 'group_note',
      targetId: noteId,
      details: { groupId, title: existing.title, moderationReason },
    });

    res.json({ ok: true, status });
  });

  router.patch('/materials/:uid/:courseId/:sourceId', (req, res) => {
    const { uid, courseId, sourceId } = req.params;
    const { status, moderationReason } = (req.body ?? {}) as {
      status?: string;
      moderationReason?: string;
    };
    if (status !== 'active' && status !== 'hidden' && status !== 'deleted') {
      res.status(400).json({ error: 'Invalid material status.' });
      return;
    }

    const db = getDb();
    db.prepare(
      `UPDATE user_materials_mirror
       SET status = ?, moderation_reason = ?, updated_at_ms = ?
       WHERE uid = ? AND course_id = ? AND source_id = ?`
    ).run(status, String(moderationReason || '').slice(0, 300), Date.now(), uid, courseId, sourceId);

    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: `material_${status}`,
      targetType: 'material',
      targetId: `${uid}/${courseId}/${sourceId}`,
      details: { moderationReason },
    });

    res.json({ ok: true, status });
  });

  router.patch('/groups/reports/:reportId', (req, res) => {
    const { reportId } = req.params;
    const { status, resolutionNote } = (req.body ?? {}) as {
      status?: string;
      resolutionNote?: string;
    };
    if (status !== 'open' && status !== 'reviewing' && status !== 'resolved' && status !== 'dismissed') {
      res.status(400).json({ error: 'Invalid report status.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, group_id FROM group_reports WHERE id = ?').get(reportId) as
      | { id?: string; group_id?: string }
      | undefined;
    if (!existing?.id) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    const now = Date.now();
    db.prepare(
      `UPDATE group_reports
       SET status = ?, resolution_note = ?, resolved_by = ?, updated_at_ms = ?
       WHERE id = ?`
    ).run(status, String(resolutionNote || '').slice(0, 500), req.authUser!.email, now, reportId);

    writeAdminAuditLog({
      adminUid: req.authUser!.uid,
      adminEmail: req.authUser!.email,
      action: `group_report_${status}`,
      targetType: 'group_report',
      targetId: reportId,
      details: { groupId: existing.group_id, resolutionNote },
    });

    res.json({ ok: true, status });
  });

  // =========================================================================
  // 7. ADMIN AUDIT LOGS
  // =========================================================================

  router.get('/audit-logs', (req, res) => {
    const db = getDb();
    const limit = Math.min(300, Math.max(10, Number(req.query.limit) || 100));
    const targetType = typeof req.query.targetType === 'string' ? req.query.targetType.trim() : '';

    const logs = targetType
      ? db
          .prepare('SELECT * FROM admin_audit_logs WHERE target_type = ? ORDER BY created_at_ms DESC LIMIT ?')
          .all(targetType, limit)
      : db
          .prepare('SELECT * FROM admin_audit_logs ORDER BY created_at_ms DESC LIMIT ?')
          .all(limit);

    res.json({ logs });
  });

  return router;
}
