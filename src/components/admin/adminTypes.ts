import type { PlatformFeatureFlags } from '../../context/PlatformAccessContext';

export type AdminManagedProvider = 'gemini' | 'openrouter' | 'groq' | 'cloudflare' | 'nvidia_nim';

export interface ProviderSourceSummary {
  adminKeyCount: number;
  activeAdminKeyCount: number;
  envFallbackConfigured: boolean;
  effectiveSource: 'admin_pool' | 'env_fallback' | 'unconfigured';
}

export interface QuotaConfig {
  defaultDailyQuota: number;
  defaultFreeAccessDays: number;
  timezone: 'Africa/Lagos';
  excessiveUsageThresholdPct: number;
  abnormalHourlyThreshold: number;
}

export interface AdminAlertRow {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  title: string;
  message: string;
  metadata_json: string;
  acknowledged: number;
  created_at_ms: number;
}

export interface FirebaseSyncStatus {
  ok: boolean;
  source: 'service_account' | 'admin_token' | 'client_sdk' | 'none';
  usersSynced: number;
  coursesSynced: number;
  materialsSynced: number;
  groupsSynced: number;
  syncedAtMs: number;
  projectId?: string;
  firestoreDatabaseId?: string;
  permissionDenied?: boolean;
  error?: string;
  setupHint?: string;
}

export interface AdminOverviewResponse {
  users: {
    total: number;
    active: number;
    suspended: number;
    deleted: number;
    active24h: number;
    active7d: number;
  };
  content: {
    totalCourses: number;
    totalMaterials: number;
    totalGroups: number;
    activeGroups: number;
    suspendedGroups: number;
    openReports: number;
  };
  aiUsage: {
    totalLogicalRequests: number;
    totalProviderAttempts: number;
    todayRequests: number;
    weekRequests: number;
    monthRequests: number;
    sharedRequests: number;
    personalRequests: number;
    totalFailovers: number;
    totalRateLimits: number;
    totalFailures: number;
    totalTokens: number;
  };
  featureFlags: PlatformFeatureFlags;
  quotaConfig: QuotaConfig;
  providerSources: Record<AdminManagedProvider, ProviderSourceSummary>;
  todayDateKeyLagos: string;
  nextResetIso: string;
  alerts: AdminAlertRow[];
  firebaseSync?: FirebaseSyncStatus | null;
}

export interface AdminUserListItem {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  status: 'active' | 'suspended' | 'deleted';
  registeredAtMs: number;
  lastActiveAtMs: number;
  coursesCount: number;
  materialsCount: number;
  hasPersonalKey: boolean;
  notes: string;
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
  aiStats: {
    totalRequests: number;
    sharedRequests: number;
    personalRequests: number;
  };
}

export interface AdminApiKeyView {
  id: string;
  provider: AdminManagedProvider;
  label: string;
  keyMask: string;
  enabled: boolean;
  status: 'active' | 'cooldown' | 'quota_exhausted' | 'invalid';
  cooldownUntilMs: number | null;
  priority: number;
  totalRequests: number;
  failedRequests: number;
  rateLimitHits: number;
  failoverCount: number;
  lastUsedAtMs: number | null;
  lastError: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AdminAiAnalyticsResponse {
  fromMs: number;
  toMs: number;
  todayDateKeyLagos: string;
  summary: {
    totalAttempts: number;
    totalLogicalRequests: number;
    sharedRequests: number;
    personalRequests: number;
    successfulAttempts: number;
    failedAttempts: number;
    rateLimitHits: number;
    quotaBlocked: number;
    failovers: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    avgLatencyMs: number;
  };
  dailySeries: Array<{
    dateKey: string;
    total: number;
    shared: number;
    personal: number;
    errors: number;
    failovers: number;
    tokens: number;
  }>;
  byFeature: Array<{
    feature: string;
    requests: number;
    sharedRequests: number;
    personalRequests: number;
    totalTokens: number;
  }>;
  byProvider: Array<{
    provider: string;
    totalAttempts: number;
    successes: number;
    failures: number;
    rateLimits: number;
    failovers: number;
    sharedAttempts: number;
    personalAttempts: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    avgLatencyMs: number;
  }>;
  materialUploadsByDay: Array<{ dateKey: string; uploads: number }>;
  materialUploadsByType: Array<{ materialType: string; count: number }>;
  heavyUsers: Array<{
    uid: string;
    email: string;
    displayName: string;
    status: string;
    todayUsed: number;
    dailyLimit: number;
    todayRemaining: number;
    todayPct: number;
    quotaExhausted: boolean;
    freeAccessActive: boolean;
    freeAccessExpiresAtMs: number;
    rangeTotal: number;
    rangeShared: number;
    rangePersonal: number;
    rangeTokens: number;
  }>;
  exhaustedUsers: Array<{
    uid: string;
    email: string;
    displayName: string;
    todayUsed: number;
    dailyLimit: number;
    todayRemaining: number;
  }>;
}

export interface AdminGroupRow {
  id: string;
  author_uid: string;
  author_email: string;
  author_name: string;
  course_id: string;
  course_code: string;
  course_name: string;
  name: string;
  description: string;
  status: 'active' | 'suspended' | 'deleted';
  share_token: string;
  member_count: number;
  active_members: number;
  notes_count: number;
  open_reports_count: number;
  last_activity_at_ms: number;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface AdminAuditLogRow {
  id: string;
  admin_uid: string;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string;
  details_json: string;
  created_at_ms: number;
}

export const FEATURE_LABELS: Record<string, string> = {
  tutor: 'AI Tutor',
  practice_cbt: 'Practice — CBT',
  practice_flashcards: 'Practice — Flashcards',
  practice_fill_gap: 'Practice — Fill in the Gap',
  practice_exam_prep: 'Practice — Oral Exam Prep',
  automatic_study: 'Automatic Study',
  live_voice_ai: 'Live Voice AI',
  vision_ocr: 'Document Vision OCR',
  tts: 'Audio Narration (TTS)',
  transcription: 'Voice Transcription',
  image_generation: 'Concept Visuals',
};

export const ADMIN_PROVIDER_LABELS: Record<AdminManagedProvider, string> = {
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  cloudflare: 'Cloudflare Workers AI',
  nvidia_nim: 'NVIDIA NIM',
};
