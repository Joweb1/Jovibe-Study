import {
  createAdminAlert,
  createId,
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_QUOTA_CONFIG,
  getDb,
  runImmediateTransaction,
  type FeatureFlags,
  type FeatureKey,
  type QuotaConfig,
} from './db.ts';
import { sanitizeErrorMessage } from './crypto.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LAGOS_TZ = 'Africa/Lagos';

export type KeyOrigin = 'shared_admin' | 'shared_env' | 'personal_byok';

export interface UserAccessStatus {
  uid: string;
  email: string;
  displayName: string;
  accountStatus: 'active' | 'suspended' | 'deleted';
  registeredAtMs: number;
  freeAccess: {
    active: boolean;
    expired: boolean;
    daysTotal: number;
    daysRemaining: number;
    hoursRemaining: number;
    expiresAtMs: number;
    override: 'default' | 'force_allow' | 'force_block';
    firstLoginNoticeSeen: boolean;
  };
  quota: {
    used: number;
    limit: number;
    remaining: number;
    dateKeyLagos: string;
    resetAtIso: string;
    resetLabel: string;
    hasCustomOverride: boolean;
  };
  hasPersonalKey: boolean;
  featureFlags: FeatureFlags;
}

export class AiAccessError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  meta?: Record<string, unknown>;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    retryable?: boolean;
    meta?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = 'AiAccessError';
    this.status = params.status;
    this.code = params.code;
    this.retryable = params.retryable ?? false;
    this.meta = params.meta;
  }
}

/**
 * Returns the current date string (YYYY-MM-DD) in Africa/Lagos (WAT, UTC+1).
 */
export function getLagosDateKey(nowMs = Date.now()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: LAGOS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(nowMs));
}

/**
 * Computes the exact UTC timestamp (ms) of the next 12:00 AM Africa/Lagos (WAT, UTC+1).
 * Nigeria does not observe DST, so Africa/Lagos is fixed at UTC+01:00.
 */
export function getNextLagosMidnightMs(nowMs = Date.now()): number {
  const dateKey = getLagosDateKey(nowMs);
  const [y, m, d] = dateKey.split('-').map(Number);
  // 00:00:00+01:00 on (y, m, d + 1) === 23:00:00 UTC on (y, m, d)
  return Date.UTC(y, m - 1, d, 23, 0, 0, 0);
}

export function getNextLagosMidnightIso(nowMs = Date.now()): string {
  return new Date(getNextLagosMidnightMs(nowMs)).toISOString();
}

export function formatLagosResetLabel(nowMs = Date.now()): string {
  const diffMs = Math.max(0, getNextLagosMidnightMs(nowMs) - nowMs);
  const hours = Math.floor(diffMs / 3_600_000);
  const mins = Math.floor((diffMs % 3_600_000) / 60_000);
  const countdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return `Resets at 12:00 AM WAT (Africa/Lagos) · in ${countdown}`;
}

// ---------------------------------------------------------------------------
// Platform Settings: Feature Flags & Quota Config
// ---------------------------------------------------------------------------

export function getFeatureFlags(): FeatureFlags {
  const db = getDb();
  const row = db
    .prepare("SELECT value_json FROM platform_settings WHERE key = 'feature_flags'")
    .get() as { value_json?: string } | undefined;

  if (!row?.value_json) {
    return {
      aiGlobalEnabled: DEFAULT_FEATURE_FLAGS.aiGlobalEnabled,
      features: { ...DEFAULT_FEATURE_FLAGS.features },
    };
  }
  try {
    const parsed = JSON.parse(row.value_json) as Partial<FeatureFlags>;
    return {
      aiGlobalEnabled:
        typeof parsed.aiGlobalEnabled === 'boolean'
          ? parsed.aiGlobalEnabled
          : DEFAULT_FEATURE_FLAGS.aiGlobalEnabled,
      features: {
        ...DEFAULT_FEATURE_FLAGS.features,
        ...(parsed.features && typeof parsed.features === 'object' ? parsed.features : {}),
      },
    };
  } catch {
    return {
      aiGlobalEnabled: DEFAULT_FEATURE_FLAGS.aiGlobalEnabled,
      features: { ...DEFAULT_FEATURE_FLAGS.features },
    };
  }
}

export function updateFeatureFlags(
  patch: Partial<{ aiGlobalEnabled: boolean; features: Partial<FeatureFlags['features']> }>,
  updatedBy: string
): FeatureFlags {
  const current = getFeatureFlags();
  const next: FeatureFlags = {
    aiGlobalEnabled:
      typeof patch.aiGlobalEnabled === 'boolean'
        ? patch.aiGlobalEnabled
        : current.aiGlobalEnabled,
    features: {
      ...current.features,
      ...(patch.features || {}),
    },
  };

  // Normalize strictly to booleans
  for (const k of Object.keys(DEFAULT_FEATURE_FLAGS.features) as FeatureKey[]) {
    next.features[k] = Boolean(next.features[k]);
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO platform_settings (key, value_json, updated_at_ms, updated_by)
     VALUES ('feature_flags', ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms, updated_by = excluded.updated_by`
  ).run(JSON.stringify(next), Date.now(), updatedBy);

  return next;
}

export function getQuotaConfig(): QuotaConfig {
  const db = getDb();
  const row = db
    .prepare("SELECT value_json FROM platform_settings WHERE key = 'quota_config'")
    .get() as { value_json?: string } | undefined;

  if (!row?.value_json) {
    return { ...DEFAULT_QUOTA_CONFIG };
  }
  try {
    const parsed = JSON.parse(row.value_json) as Partial<QuotaConfig>;
    return {
      defaultDailyQuota: clampInt(parsed.defaultDailyQuota, 1, 10000, DEFAULT_QUOTA_CONFIG.defaultDailyQuota),
      defaultFreeAccessDays: clampInt(parsed.defaultFreeAccessDays, 1, 365, DEFAULT_QUOTA_CONFIG.defaultFreeAccessDays),
      timezone: 'Africa/Lagos',
      excessiveUsageThresholdPct: clampInt(
        parsed.excessiveUsageThresholdPct,
        50,
        100,
        DEFAULT_QUOTA_CONFIG.excessiveUsageThresholdPct
      ),
      abnormalHourlyThreshold: clampInt(
        parsed.abnormalHourlyThreshold,
        5,
        1000,
        DEFAULT_QUOTA_CONFIG.abnormalHourlyThreshold
      ),
    };
  } catch {
    return { ...DEFAULT_QUOTA_CONFIG };
  }
}

export function updateQuotaConfig(patch: Partial<QuotaConfig>, updatedBy: string): QuotaConfig {
  const current = getQuotaConfig();
  const next: QuotaConfig = {
    defaultDailyQuota: clampInt(patch.defaultDailyQuota, 1, 10000, current.defaultDailyQuota),
    defaultFreeAccessDays: clampInt(
      patch.defaultFreeAccessDays,
      1,
      365,
      current.defaultFreeAccessDays
    ),
    timezone: 'Africa/Lagos',
    excessiveUsageThresholdPct: clampInt(
      patch.excessiveUsageThresholdPct,
      50,
      100,
      current.excessiveUsageThresholdPct
    ),
    abnormalHourlyThreshold: clampInt(
      patch.abnormalHourlyThreshold,
      5,
      1000,
      current.abnormalHourlyThreshold
    ),
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO platform_settings (key, value_json, updated_at_ms, updated_by)
     VALUES ('quota_config', ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms, updated_by = excluded.updated_by`
  ).run(JSON.stringify(next), Date.now(), updatedBy);

  return next;
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(val)));
}

// ---------------------------------------------------------------------------
// Feature Resolution Helpers
// ---------------------------------------------------------------------------

const VALID_FEATURE_KEYS = new Set<string>(Object.keys(DEFAULT_FEATURE_FLAGS.features));

export function normalizeFeatureKey(rawFeature: unknown, task: string): FeatureKey {
  const clean = typeof rawFeature === 'string' ? rawFeature.trim().toLowerCase() : '';
  if (VALID_FEATURE_KEYS.has(clean)) {
    return clean as FeatureKey;
  }
  switch (clean) {
    case 'cbt':
      return 'practice_cbt';
    case 'flashcards':
      return 'practice_flashcards';
    case 'fill_in_the_gap':
    case 'fill_gap':
      return 'practice_fill_gap';
    case 'exam_prep':
    case 'oral_exam':
      return 'practice_exam_prep';
    case 'live':
    case 'sotal_live':
      return 'live_voice_ai';
    case 'ocr':
    case 'vision':
      return 'vision_ocr';
    default:
      break;
  }

  switch (task) {
    case 'vision':
      return 'vision_ocr';
    case 'tts':
      return 'tts';
    case 'transcription':
      return 'transcription';
    case 'image_generation':
      return 'image_generation';
    case 'live':
      return 'live_voice_ai';
    case 'structured_json':
      return 'automatic_study';
    default:
      return 'tutor';
  }
}

export function getFeatureDisplayName(feature: FeatureKey): string {
  const map: Record<FeatureKey, string> = {
    tutor: 'AI Tutor',
    practice_cbt: 'Practice — CBT',
    practice_flashcards: 'Practice — Flashcards',
    practice_fill_gap: 'Practice — Fill in the Gap',
    practice_exam_prep: 'Practice — Oral Exam Prep',
    automatic_study: 'Automatic Study',
    live_voice_ai: 'Live Voice AI',
    vision_ocr: 'Vision OCR',
    tts: 'Audio Narration (TTS)',
    transcription: 'Voice Transcription',
    image_generation: 'Concept Visuals',
  };
  return map[feature] || feature;
}

// ---------------------------------------------------------------------------
// User Access Status Computation
// ---------------------------------------------------------------------------

interface UserRow {
  uid: string;
  email: string;
  display_name: string;
  status: 'active' | 'suspended' | 'deleted';
  registered_at_ms: number;
  free_access_days_override: number | null;
  free_access_expires_at_ms: number | null;
  daily_quota_override: number | null;
  shared_ai_access_override: 'default' | 'force_allow' | 'force_block';
  first_login_notice_seen: number;
  has_personal_key: number;
}

export function getUserAccessStatus(uid: string, nowMs = Date.now()): UserAccessStatus {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as UserRow | undefined;
  const quotaConfig = getQuotaConfig();
  const featureFlags = getFeatureFlags();
  const dateKeyLagos = getLagosDateKey(nowMs);

  const registeredAtMs = user ? Number(user.registered_at_ms) : nowMs;
  const daysTotal =
    user && typeof user.free_access_days_override === 'number' && user.free_access_days_override > 0
      ? user.free_access_days_override
      : quotaConfig.defaultFreeAccessDays;

  const expiresAtMs =
    user && typeof user.free_access_expires_at_ms === 'number' && user.free_access_expires_at_ms > 0
      ? user.free_access_expires_at_ms
      : registeredAtMs + daysTotal * MS_PER_DAY;

  const override = user?.shared_ai_access_override ?? 'default';
  const remainingMs = Math.max(0, expiresAtMs - nowMs);
  const expiredByTime = nowMs >= expiresAtMs;

  let active: boolean;
  let expired: boolean;
  if (override === 'force_allow') {
    active = true;
    expired = false;
  } else if (override === 'force_block') {
    active = false;
    expired = true;
  } else {
    active = !expiredByTime;
    expired = expiredByTime;
  }

  const effectiveLimit =
    user && typeof user.daily_quota_override === 'number' && user.daily_quota_override >= 0
      ? user.daily_quota_override
      : quotaConfig.defaultDailyQuota;

  const quotaRow = db
    .prepare('SELECT used_count FROM user_daily_quotas WHERE uid = ? AND date_key = ?')
    .get(uid, dateKeyLagos) as { used_count?: number } | undefined;

  const used = quotaRow ? Math.max(0, Number(quotaRow.used_count)) : 0;
  const remaining = Math.max(0, effectiveLimit - used);

  return {
    uid,
    email: user?.email ?? '',
    displayName: user?.display_name ?? '',
    accountStatus: user?.status ?? 'active',
    registeredAtMs,
    freeAccess: {
      active,
      expired,
      daysTotal,
      daysRemaining: Math.ceil(remainingMs / MS_PER_DAY),
      hoursRemaining: Math.ceil(remainingMs / 3_600_000),
      expiresAtMs,
      override,
      firstLoginNoticeSeen: Boolean(user?.first_login_notice_seen),
    },
    quota: {
      used,
      limit: effectiveLimit,
      remaining,
      dateKeyLagos,
      resetAtIso: getNextLagosMidnightIso(nowMs),
      resetLabel: formatLagosResetLabel(nowMs),
      hasCustomOverride: Boolean(
        user && typeof user.daily_quota_override === 'number'
      ),
    },
    hasPersonalKey: Boolean(user?.has_personal_key),
    featureFlags,
  };
}

// ---------------------------------------------------------------------------
// Atomic Server-Side Quota & Feature Enforcement
// ---------------------------------------------------------------------------

export interface ReserveAiExecutionParams {
  uid: string;
  userEmail: string;
  feature: FeatureKey;
  task: string;
  usesPersonalKey: boolean;
  logicalRequestId?: string;
  nowMs?: number;
}

export interface ReservedAiExecution {
  logicalRequestId: string;
  dateKeyLagos: string;
  quotaChargedNow: boolean;
  isFailoverReuse: boolean;
  quotaSnapshot: {
    used: number;
    limit: number;
    remaining: number;
    resetAtIso: string;
    resetLabel: string;
  };
}

/**
 * Atomically enforces:
 *  1. Account status (suspended/deleted blocked)
 *  2. Admin global AI kill-switch & per-feature flags
 *  3. For shared-key requests: 7-day free access expiry + admin overrides
 *  4. For shared-key requests: Atomic SQLite BEGIN IMMEDIATE daily quota reservation
 *     with logical-request deduplication so internal provider failovers/retries never
 *     double-charge the user, while completed logical IDs cannot be replayed to bypass limits.
 */
export function reserveAiExecution(params: ReserveAiExecutionParams): ReservedAiExecution {
  const nowMs = params.nowMs ?? Date.now();
  const dateKeyLagos = getLagosDateKey(nowMs);
  const resetAtIso = getNextLagosMidnightIso(nowMs);
  const resetLabel = formatLagosResetLabel(nowMs);

  const featureFlags = getFeatureFlags();
  const quotaConfig = getQuotaConfig();

  // Check feature flags first (applies to both shared and personal keys)
  if (!featureFlags.aiGlobalEnabled) {
    recordBlockedLog({
      logicalRequestId: params.logicalRequestId || createId('lreq'),
      uid: params.uid,
      userEmail: params.userEmail,
      feature: params.feature,
      task: params.task,
      keyOrigin: params.usesPersonalKey ? 'personal_byok' : 'shared_admin',
      status: 'feature_disabled',
      errorCode: 'AI_DISABLED_GLOBALLY',
      errorMessage: 'AI functionality is currently disabled by the administrator.',
      dateKeyLagos,
      nowMs,
    });
    throw new AiAccessError({
      status: 503,
      code: 'FEATURE_DISABLED',
      message:
        'AI functionality is temporarily disabled by the administrator. Your notes and saved materials remain accessible.',
      retryable: false,
      meta: { feature: 'ai_global' },
    });
  }

  if (!featureFlags.features[params.feature]) {
    const label = getFeatureDisplayName(params.feature);
    recordBlockedLog({
      logicalRequestId: params.logicalRequestId || createId('lreq'),
      uid: params.uid,
      userEmail: params.userEmail,
      feature: params.feature,
      task: params.task,
      keyOrigin: params.usesPersonalKey ? 'personal_byok' : 'shared_admin',
      status: 'feature_disabled',
      errorCode: 'FEATURE_DISABLED',
      errorMessage: `${label} is currently disabled by the administrator.`,
      dateKeyLagos,
      nowMs,
    });
    throw new AiAccessError({
      status: 503,
      code: 'FEATURE_DISABLED',
      message: `${label} is currently disabled by the administrator.`,
      retryable: false,
      meta: { feature: params.feature },
    });
  }

  // Personal BYOK keys do NOT consume shared quota and are NOT blocked by 7-day expiry,
  // but suspended/deleted accounts are still blocked.
  if (params.usesPersonalKey) {
    const db = getDb();
    const userRow = db
      .prepare('SELECT status, daily_quota_override FROM users WHERE uid = ?')
      .get(params.uid) as { status?: string; daily_quota_override?: number | null } | undefined;

    if (userRow?.status === 'suspended') {
      throw new AiAccessError({
        status: 403,
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Contact support for help.',
        retryable: false,
      });
    }
    if (userRow?.status === 'deleted') {
      throw new AiAccessError({
        status: 403,
        code: 'ACCOUNT_DELETED',
        message: 'This account is no longer active.',
        retryable: false,
      });
    }

    const logicalRequestId = normalizeClientLogicalId(params.logicalRequestId) || createId('lreq');
    const quotaRow = db
      .prepare('SELECT used_count FROM user_daily_quotas WHERE uid = ? AND date_key = ?')
      .get(params.uid, dateKeyLagos) as { used_count?: number } | undefined;
    const limit =
      typeof userRow?.daily_quota_override === 'number'
        ? userRow.daily_quota_override
        : quotaConfig.defaultDailyQuota;
    const used = quotaRow ? Number(quotaRow.used_count) : 0;

    return {
      logicalRequestId,
      dateKeyLagos,
      quotaChargedNow: false,
      isFailoverReuse: false,
      quotaSnapshot: {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        resetAtIso,
        resetLabel,
      },
    };
  }

  // Shared key path: Atomic BEGIN IMMEDIATE SQLite transaction!
  const result = runImmediateTransaction<ReservedAiExecution>((db) => {
    const user = db.prepare('SELECT * FROM users WHERE uid = ?').get(params.uid) as
      | UserRow
      | undefined;

    if (!user) {
      throw new AiAccessError({
        status: 401,
        code: 'UNAUTHENTICATED',
        message: 'User account record not found. Please sign in again.',
        retryable: false,
      });
    }

    if (user.status === 'suspended') {
      throw new AiAccessError({
        status: 403,
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. AI access is disabled.',
        retryable: false,
      });
    }

    if (user.status === 'deleted') {
      throw new AiAccessError({
        status: 403,
        code: 'ACCOUNT_DELETED',
        message: 'This account has been deactivated.',
        retryable: false,
      });
    }

    // 7-day free access check + overrides
    const daysTotal =
      typeof user.free_access_days_override === 'number' && user.free_access_days_override > 0
        ? user.free_access_days_override
        : quotaConfig.defaultFreeAccessDays;
    const expiresAtMs =
      typeof user.free_access_expires_at_ms === 'number' && user.free_access_expires_at_ms > 0
        ? user.free_access_expires_at_ms
        : Number(user.registered_at_ms) + daysTotal * MS_PER_DAY;

    const override = user.shared_ai_access_override || 'default';
    const isBlockedByTrial =
      override === 'force_block' || (override !== 'force_allow' && nowMs >= expiresAtMs);

    if (isBlockedByTrial) {
      throw new AiAccessError({
        status: 403,
        code: 'FREE_TRIAL_EXPIRED',
        message:
          override === 'force_block'
            ? 'Shared AI access is disabled for your account. Add your own free API key in Settings to continue using AI features.'
            : 'Your 7-day free AI access has expired. Add your own free API key in Settings to continue using SOTAL Study AI features.',
        retryable: false,
        meta: {
          expiresAtMs,
          registeredAtMs: Number(user.registered_at_ms),
          daysTotal,
          override,
        },
      });
    }

    const dailyLimit =
      typeof user.daily_quota_override === 'number' && user.daily_quota_override >= 0
        ? user.daily_quota_override
        : quotaConfig.defaultDailyQuota;

    // Ensure today's quota row exists
    db.prepare(
      `INSERT OR IGNORE INTO user_daily_quotas (uid, date_key, used_count, daily_limit_snapshot, updated_at_ms)
       VALUES (?, ?, 0, ?, ?)`
    ).run(params.uid, dateKeyLagos, dailyLimit, nowMs);

    const quotaRow = db
      .prepare('SELECT used_count FROM user_daily_quotas WHERE uid = ? AND date_key = ?')
      .get(params.uid, dateKeyLagos) as { used_count: number };
    const currentUsed = Number(quotaRow.used_count);

    // Check if this request is a legitimate in-flight failover/retry for an existing logical request
    const clientLogicalId = normalizeClientLogicalId(params.logicalRequestId);
    if (clientLogicalId) {
      const existingLogical = db
        .prepare('SELECT * FROM ai_logical_requests WHERE logical_request_id = ?')
        .get(clientLogicalId) as
        | {
            logical_request_id: string;
            uid: string;
            feature: string;
            date_key_lagos: string;
            quota_charged: number;
            final_status: string;
            created_at_ms: number;
          }
        | undefined;

      if (existingLogical) {
        const withinFailoverWindow = nowMs - Number(existingLogical.created_at_ms) <= 3 * 60_000;
        if (
          existingLogical.uid === params.uid &&
          existingLogical.date_key_lagos === dateKeyLagos &&
          existingLogical.final_status === 'in_flight' &&
          withinFailoverWindow
        ) {
          // Legitimate internal provider failover or retry on the same logical request: do NOT double-charge!
          return {
            logicalRequestId: clientLogicalId,
            dateKeyLagos,
            quotaChargedNow: false,
            isFailoverReuse: true,
            quotaSnapshot: {
              used: currentUsed,
              limit: dailyLimit,
              remaining: Math.max(0, dailyLimit - currentUsed),
              resetAtIso,
              resetLabel,
            },
          };
        }
        // If already succeeded or expired/belongs to another user, allocate a fresh logical ID and charge normally (prevents replay bypass!)
      }
    }

    // Enforce daily quota atomically!
    if (currentUsed >= dailyLimit) {
      throw new AiAccessError({
        status: 429,
        code: 'SHARED_QUOTA_EXHAUSTED',
        message: `You have used all ${currentUsed}/${dailyLimit} free shared AI requests for today (0 remaining). ${resetLabel}. Add your own free API key in Settings for uninterrupted access.`,
        retryable: false,
        meta: {
          used: currentUsed,
          limit: dailyLimit,
          remaining: 0,
          dateKeyLagos,
          resetAtIso,
          resetLabel,
        },
      });
    }

    const logicalRequestId =
      clientLogicalId &&
      !db
        .prepare('SELECT 1 FROM ai_logical_requests WHERE logical_request_id = ?')
        .get(clientLogicalId)
        ? clientLogicalId
        : createId('lreq');

    const nextUsed = currentUsed + 1;
    db.prepare(
      `UPDATE user_daily_quotas
       SET used_count = ?, daily_limit_snapshot = ?, updated_at_ms = ?
       WHERE uid = ? AND date_key = ?`
    ).run(nextUsed, dailyLimit, nowMs, params.uid, dateKeyLagos);

    db.prepare(
      `INSERT INTO ai_logical_requests (
        logical_request_id, uid, feature, key_origin, date_key_lagos, quota_charged, final_status, created_at_ms
      ) VALUES (?, ?, ?, 'shared_admin', ?, 1, 'in_flight', ?)`
    ).run(logicalRequestId, params.uid, params.feature, dateKeyLagos, nowMs);

    return {
      logicalRequestId,
      dateKeyLagos,
      quotaChargedNow: true,
      isFailoverReuse: false,
      quotaSnapshot: {
        used: nextUsed,
        limit: dailyLimit,
        remaining: Math.max(0, dailyLimit - nextUsed),
        resetAtIso,
        resetLabel,
      },
    };
  });

  // Trigger automated alerts outside the write transaction (non-blocking)
  if (result.quotaChargedNow && result.quotaSnapshot.limit > 0) {
    const pct = Math.round((result.quotaSnapshot.used / result.quotaSnapshot.limit) * 100);
    if (result.quotaSnapshot.used >= result.quotaSnapshot.limit) {
      createAdminAlert({
        severity: 'warning',
        category: 'excessive_usage',
        title: `User exhausted daily shared AI quota (${params.userEmail || params.uid})`,
        message: `${params.userEmail || params.uid} reached ${result.quotaSnapshot.used}/${result.quotaSnapshot.limit} shared AI requests on ${dateKeyLagos}.`,
        metadata: { uid: params.uid, email: params.userEmail, used: result.quotaSnapshot.used, limit: result.quotaSnapshot.limit },
        dedupeWindowMs: 6 * 3_600_000,
      });
    } else if (pct >= quotaConfig.excessiveUsageThresholdPct) {
      createAdminAlert({
        severity: 'info',
        category: 'excessive_usage',
        title: `High daily shared AI consumption (${params.userEmail || params.uid})`,
        message: `${params.userEmail || params.uid} has used ${result.quotaSnapshot.used}/${result.quotaSnapshot.limit} (${pct}%) of today's shared quota.`,
        metadata: { uid: params.uid, email: params.userEmail, pct },
        dedupeWindowMs: 6 * 3_600_000,
      });
    }

    // Check abnormal hourly spike
    const db = getDb();
    const hourAgo = nowMs - 3_600_000;
    const hourlyRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM ai_logical_requests
         WHERE uid = ? AND created_at_ms >= ?`
      )
      .get(params.uid, hourAgo) as { cnt?: number };
    const hourlyCount = Number(hourlyRow?.cnt ?? 0);
    if (hourlyCount >= quotaConfig.abnormalHourlyThreshold) {
      createAdminAlert({
        severity: 'critical',
        category: 'abnormal_usage',
        title: `Abnormal AI request rate detected (${params.userEmail || params.uid})`,
        message: `${params.userEmail || params.uid} triggered ${hourlyCount} logical AI requests within the last 60 minutes (threshold: ${quotaConfig.abnormalHourlyThreshold}/hr).`,
        metadata: { uid: params.uid, email: params.userEmail, hourlyCount },
        dedupeWindowMs: 60 * 60_000,
      });
    }
  }

  return result;
}

function normalizeClientLogicalId(raw?: string): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.length < 8 || trimmed.length > 96) return '';
  if (!/^[a-zA-Z0-9_.:-]+$/.test(trimmed)) return '';
  return trimmed;
}

export function finalizeLogicalRequest(params: {
  logicalRequestId: string;
  status: 'success' | 'failed';
  keyOrigin?: KeyOrigin;
}): void {
  const db = getDb();
  db.prepare(
    `UPDATE ai_logical_requests
     SET final_status = ?,
         key_origin = COALESCE(?, key_origin),
         completed_at_ms = ?
     WHERE logical_request_id = ? AND final_status = 'in_flight'`
  ).run(params.status, params.keyOrigin ?? null, Date.now(), params.logicalRequestId);
}

/**
 * Refunds a reserved shared quota credit ONLY when a request could not be served
 * at all due to server/key-pool exhaustion (e.g. NO_API_KEY / all shared keys unavailable)
 * and the client will not be retrying the same logical request.
 */
export function refundLogicalRequestQuota(logicalRequestId: string): void {
  runImmediateTransaction((db) => {
    const row = db
      .prepare(
        `SELECT uid, date_key_lagos, quota_charged, final_status
         FROM ai_logical_requests WHERE logical_request_id = ?`
      )
      .get(logicalRequestId) as
      | { uid: string; date_key_lagos: string; quota_charged: number; final_status: string }
      | undefined;
    if (!row || row.quota_charged !== 1 || row.final_status !== 'in_flight') return;

    db.prepare(
      `UPDATE ai_logical_requests
       SET quota_charged = 0, final_status = 'refunded', completed_at_ms = ?
       WHERE logical_request_id = ?`
    ).run(Date.now(), logicalRequestId);

    db.prepare(
      `UPDATE user_daily_quotas
       SET used_count = MAX(0, used_count - 1), updated_at_ms = ?
       WHERE uid = ? AND date_key = ?`
    ).run(Date.now(), row.uid, row.date_key_lagos);
  });
}

// ---------------------------------------------------------------------------
// AI Request & Provider Telemetry Logging
// ---------------------------------------------------------------------------

export interface RecordAiAttemptParams {
  logicalRequestId: string;
  uid: string;
  userEmail: string;
  feature: FeatureKey;
  task: string;
  keyOrigin: KeyOrigin;
  provider: string;
  adminKeyId?: string | null;
  model?: string;
  status: 'success' | 'failed' | 'rate_limited' | 'quota_blocked' | 'feature_disabled' | 'failover';
  isLogicalRoot: boolean;
  isFailover: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
  knownSecrets?: string[];
  nowMs?: number;
}

export function recordAiAttemptLog(params: RecordAiAttemptParams): void {
  const db = getDb();
  const nowMs = params.nowMs ?? Date.now();
  const dateKeyLagos = getLagosDateKey(nowMs);
  const inputTokens = Math.max(0, Math.floor(params.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.floor(params.outputTokens ?? 0));
  const totalTokens = Math.max(
    inputTokens + outputTokens,
    Math.floor(params.totalTokens ?? 0)
  );
  const safeError = params.errorMessage
    ? sanitizeErrorMessage(params.errorMessage, params.knownSecrets)
    : '';

  db.prepare(
    `INSERT INTO ai_request_logs (
      id, logical_request_id, uid, user_email, feature, task, key_origin,
      provider, admin_key_id, model, status, is_logical_root, is_failover,
      input_tokens, output_tokens, total_tokens, latency_ms,
      error_code, error_message, date_key_lagos, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    createId('ailog'),
    params.logicalRequestId,
    params.uid,
    params.userEmail,
    params.feature,
    params.task,
    params.keyOrigin,
    params.provider,
    params.adminKeyId ?? null,
    params.model || '',
    params.status,
    params.isLogicalRoot ? 1 : 0,
    params.isFailover ? 1 : 0,
    inputTokens,
    outputTokens,
    totalTokens,
    Math.max(0, Math.floor(params.latencyMs ?? 0)),
    params.errorCode || '',
    safeError,
    dateKeyLagos,
    nowMs
  );
}

function recordBlockedLog(params: {
  logicalRequestId: string;
  uid: string;
  userEmail: string;
  feature: FeatureKey;
  task: string;
  keyOrigin: KeyOrigin;
  status: 'quota_blocked' | 'feature_disabled';
  errorCode: string;
  errorMessage: string;
  dateKeyLagos: string;
  nowMs: number;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO ai_request_logs (
      id, logical_request_id, uid, user_email, feature, task, key_origin,
      provider, admin_key_id, model, status, is_logical_root, is_failover,
      input_tokens, output_tokens, total_tokens, latency_ms,
      error_code, error_message, date_key_lagos, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'system', NULL, '', ?, 1, 0, 0, 0, 0, 0, ?, ?, ?, ?)`
  ).run(
    createId('ailog'),
    params.logicalRequestId,
    params.uid,
    params.userEmail,
    params.feature,
    params.task,
    params.keyOrigin,
    params.status,
    params.errorCode,
    params.errorMessage,
    params.dateKeyLagos,
    params.nowMs
  );
}
