import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export interface FeatureFlags {
  aiGlobalEnabled: boolean;
  features: {
    tutor: boolean;
    practice_cbt: boolean;
    practice_flashcards: boolean;
    practice_fill_gap: boolean;
    practice_exam_prep: boolean;
    automatic_study: boolean;
    live_voice_ai: boolean;
    vision_ocr: boolean;
    tts: boolean;
    transcription: boolean;
    image_generation: boolean;
  };
}

export type FeatureKey = keyof FeatureFlags['features'];

export interface QuotaConfig {
  defaultDailyQuota: number;
  defaultFreeAccessDays: number;
  timezone: 'Africa/Lagos';
  excessiveUsageThresholdPct: number;
  abnormalHourlyThreshold: number;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  aiGlobalEnabled: true,
  features: {
    tutor: true,
    practice_cbt: true,
    practice_flashcards: true,
    practice_fill_gap: true,
    practice_exam_prep: true,
    automatic_study: true,
    live_voice_ai: true,
    vision_ocr: true,
    tts: true,
    transcription: true,
    image_generation: true,
  },
};

export const DEFAULT_QUOTA_CONFIG: QuotaConfig = {
  defaultDailyQuota: 30,
  defaultFreeAccessDays: 7,
  timezone: 'Africa/Lagos',
  excessiveUsageThresholdPct: 80,
  abnormalHourlyThreshold: 20,
};

const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  {
    version: 1,
    name: 'initial_admin_quota_usage_and_groups',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY,
        email TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        photo_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
        registered_at_ms INTEGER NOT NULL,
        last_active_at_ms INTEGER NOT NULL,
        free_access_days_override INTEGER,
        free_access_expires_at_ms INTEGER,
        daily_quota_override INTEGER,
        shared_ai_access_override TEXT NOT NULL DEFAULT 'default' CHECK (shared_ai_access_override IN ('default', 'force_allow', 'force_block')),
        first_login_notice_seen INTEGER NOT NULL DEFAULT 0,
        has_personal_key INTEGER NOT NULL DEFAULT 0,
        courses_count INTEGER NOT NULL DEFAULT 0,
        materials_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        updated_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

      CREATE TABLE IF NOT EXISTS platform_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        updated_by TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS admin_api_keys (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('gemini', 'openrouter', 'groq', 'cloudflare', 'nvidia_nim')),
        label TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        key_mask TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cooldown', 'quota_exhausted', 'invalid')),
        cooldown_until_ms INTEGER,
        priority INTEGER NOT NULL DEFAULT 100,
        total_requests INTEGER NOT NULL DEFAULT 0,
        failed_requests INTEGER NOT NULL DEFAULT 0,
        rate_limit_hits INTEGER NOT NULL DEFAULT 0,
        failover_count INTEGER NOT NULL DEFAULT 0,
        last_used_at_ms INTEGER,
        last_error TEXT NOT NULL DEFAULT '',
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_admin_keys_provider ON admin_api_keys(provider, enabled, priority);

      CREATE TABLE IF NOT EXISTS user_daily_quotas (
        uid TEXT NOT NULL,
        date_key TEXT NOT NULL,
        used_count INTEGER NOT NULL DEFAULT 0,
        daily_limit_snapshot INTEGER NOT NULL DEFAULT 30,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (uid, date_key)
      );

      CREATE INDEX IF NOT EXISTS idx_user_daily_quotas_date ON user_daily_quotas(date_key);

      CREATE TABLE IF NOT EXISTS ai_logical_requests (
        logical_request_id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        feature TEXT NOT NULL,
        key_origin TEXT NOT NULL CHECK (key_origin IN ('shared_admin', 'shared_env', 'personal_byok')),
        date_key_lagos TEXT NOT NULL,
        quota_charged INTEGER NOT NULL DEFAULT 0,
        final_status TEXT NOT NULL DEFAULT 'in_flight' CHECK (final_status IN ('in_flight', 'success', 'failed', 'refunded')),
        created_at_ms INTEGER NOT NULL,
        completed_at_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_logical_req_uid_date ON ai_logical_requests(uid, date_key_lagos);

      CREATE TABLE IF NOT EXISTS ai_request_logs (
        id TEXT PRIMARY KEY,
        logical_request_id TEXT NOT NULL,
        uid TEXT NOT NULL,
        user_email TEXT NOT NULL DEFAULT '',
        feature TEXT NOT NULL,
        task TEXT NOT NULL,
        key_origin TEXT NOT NULL CHECK (key_origin IN ('shared_admin', 'shared_env', 'personal_byok')),
        provider TEXT NOT NULL,
        admin_key_id TEXT,
        model TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'rate_limited', 'quota_blocked', 'feature_disabled', 'failover')),
        is_logical_root INTEGER NOT NULL DEFAULT 1,
        is_failover INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        error_code TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        date_key_lagos TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_request_logs(created_at_ms);
      CREATE INDEX IF NOT EXISTS idx_ai_logs_date_origin ON ai_request_logs(date_key_lagos, key_origin);
      CREATE INDEX IF NOT EXISTS idx_ai_logs_uid ON ai_request_logs(uid, created_at_ms);
      CREATE INDEX IF NOT EXISTS idx_ai_logs_provider ON ai_request_logs(provider, created_at_ms);
      CREATE INDEX IF NOT EXISTS idx_ai_logs_feature ON ai_request_logs(feature, created_at_ms);

      CREATE TABLE IF NOT EXISTS user_courses_mirror (
        uid TEXT NOT NULL,
        course_id TEXT NOT NULL,
        code TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        is_public INTEGER NOT NULL DEFAULT 0,
        share_token TEXT NOT NULL DEFAULT '',
        author_name TEXT NOT NULL DEFAULT '',
        materials_count INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (uid, course_id)
      );

      CREATE TABLE IF NOT EXISTS user_materials_mirror (
        uid TEXT NOT NULL,
        course_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        material_type TEXT NOT NULL DEFAULT 'other',
        page_count INTEGER NOT NULL DEFAULT 0,
        original_file_name TEXT NOT NULL DEFAULT '',
        content_preview TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
        moderation_reason TEXT NOT NULL DEFAULT '',
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (uid, course_id, source_id)
      );

      CREATE INDEX IF NOT EXISTS idx_materials_created ON user_materials_mirror(created_at_ms);

      CREATE TABLE IF NOT EXISTS study_groups (
        id TEXT PRIMARY KEY,
        author_uid TEXT NOT NULL,
        author_email TEXT NOT NULL DEFAULT '',
        author_name TEXT NOT NULL DEFAULT '',
        course_id TEXT NOT NULL,
        course_code TEXT NOT NULL DEFAULT '',
        course_name TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
        share_token TEXT NOT NULL DEFAULT '',
        member_count INTEGER NOT NULL DEFAULT 1,
        last_activity_at_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_groups_status ON study_groups(status);
      CREATE INDEX IF NOT EXISTS idx_groups_author ON study_groups(author_uid);

      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        member_uid TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        photo_url TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
        joined_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (group_id, member_uid),
        FOREIGN KEY (group_id) REFERENCES study_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS group_shared_notes (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        course_id TEXT NOT NULL DEFAULT '',
        author_uid TEXT NOT NULL,
        author_name TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
        moderation_reason TEXT NOT NULL DEFAULT '',
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        FOREIGN KEY (group_id) REFERENCES study_groups(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_group_notes_group ON group_shared_notes(group_id, status);

      CREATE TABLE IF NOT EXISTS group_reports (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('group', 'note', 'material', 'member')),
        target_id TEXT NOT NULL DEFAULT '',
        target_label TEXT NOT NULL DEFAULT '',
        reported_user_uid TEXT NOT NULL DEFAULT '',
        reported_user_email TEXT NOT NULL DEFAULT '',
        reporter_uid TEXT NOT NULL,
        reporter_email TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
        resolution_note TEXT NOT NULL DEFAULT '',
        resolved_by TEXT NOT NULL DEFAULT '',
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_group_reports_status ON group_reports(status, created_at_ms);
      CREATE INDEX IF NOT EXISTS idx_group_reports_group ON group_reports(group_id);

      CREATE TABLE IF NOT EXISTS group_activity_logs (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        actor_uid TEXT NOT NULL,
        actor_name TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_group_activity_group ON group_activity_logs(group_id, created_at_ms);

      CREATE TABLE IF NOT EXISTS user_activity_events (
        id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        event_type TEXT NOT NULL,
        feature TEXT NOT NULL DEFAULT '',
        course_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_activity_uid ON user_activity_events(uid, created_at_ms);
      CREATE INDEX IF NOT EXISTS idx_user_activity_type ON user_activity_events(event_type, created_at_ms);

      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id TEXT PRIMARY KEY,
        admin_uid TEXT NOT NULL,
        admin_email TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at_ms);

      CREATE TABLE IF NOT EXISTS admin_alerts (
        id TEXT PRIMARY KEY,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
        category TEXT NOT NULL CHECK (category IN ('excessive_usage', 'provider_exhaustion', 'abnormal_usage', 'group_report', 'key_failure')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        acknowledged INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_admin_alerts_ack ON admin_alerts(acknowledged, created_at_ms);
    `,
  },
];

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at_ms INTEGER NOT NULL
    );
  `);

  const existingRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{
    version: number;
  }>;
  const applied = new Set(existingRows.map((r) => Number(r.version)));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)'
      ).run(migration.version, migration.name, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure
      }
      throw err;
    }
  }

  // Ensure default platform settings rows exist
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO platform_settings (key, value_json, updated_at_ms, updated_by)
     VALUES ('feature_flags', ?, ?, 'system')`
  ).run(JSON.stringify(DEFAULT_FEATURE_FLAGS), now);

  db.prepare(
    `INSERT OR IGNORE INTO platform_settings (key, value_json, updated_at_ms, updated_by)
     VALUES ('quota_config', ?, ?, 'system')`
  ).run(JSON.stringify(DEFAULT_QUOTA_CONFIG), now);
}

export function initDb(customPath?: string): DatabaseSync {
  const targetPath =
    customPath ||
    process.env.ADMIN_DB_PATH?.trim() ||
    path.resolve(process.cwd(), 'data', 'sotal-admin.sqlite');

  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // Ignore close error
    }
    dbInstance = null;
  }

  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(targetPath)), { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  if (targetPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  runMigrations(db);

  dbInstance = db;
  currentDbPath = targetPath;
  return db;
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    return initDb();
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // Ignore close errors
    }
    dbInstance = null;
    currentDbPath = null;
  }
}

export function runImmediateTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback errors
    }
    throw err;
  }
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

export function writeAdminAuditLog(params: {
  adminUid: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO admin_audit_logs (id, admin_uid, admin_email, action, target_type, target_id, details_json, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    createId('aud'),
    params.adminUid,
    params.adminEmail,
    params.action,
    params.targetType,
    params.targetId || '',
    JSON.stringify(params.details ?? {}),
    Date.now()
  );
}

export function createAdminAlert(params: {
  severity: 'info' | 'warning' | 'critical';
  category: 'excessive_usage' | 'provider_exhaustion' | 'abnormal_usage' | 'group_report' | 'key_failure';
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  dedupeWindowMs?: number;
}): void {
  const db = getDb();
  const now = Date.now();
  const dedupeWindow = params.dedupeWindowMs ?? 30 * 60_000;

  if (dedupeWindow > 0) {
    const existing = db
      .prepare(
        `SELECT id FROM admin_alerts
         WHERE category = ? AND title = ? AND acknowledged = 0 AND created_at_ms >= ?
         LIMIT 1`
      )
      .get(params.category, params.title, now - dedupeWindow) as { id?: string } | undefined;
    if (existing?.id) return;
  }

  db.prepare(
    `INSERT INTO admin_alerts (id, severity, category, title, message, metadata_json, acknowledged, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    createId('alt'),
    params.severity,
    params.category,
    params.title,
    params.message,
    JSON.stringify(params.metadata ?? {}),
    now
  );
}
