import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'sole.admin@gmail.com';
process.env.ADMIN_DB_PATH = ':memory:';
process.env.ADMIN_ENCRYPTION_KEY = 'unit-test-super-secret-encryption-key-32bytes';
process.env.GEMINI_API_KEY = 'AIzaEnvFallbackTestKey1234567890';
process.env.GROQ_API_KEY = 'gsk_env_fallback_test_key_1234567890';

import { createApiApp } from '../server.ts';
import { setTestTokenVerifier, upsertUserFromAuth } from '../server/auth.ts';
import {
  addAdminApiKey,
  deleteAdminApiKey,
  recordAdminKeyFailure,
  resolveSharedKeyCandidates,
} from '../server/adminKeyPool.ts';
import { decryptSecret, encryptSecret, sanitizeErrorMessage } from '../server/crypto.ts';
import { closeDb, getDb, initDb } from '../server/db.ts';
import {
  AiAccessError,
  finalizeLogicalRequest,
  getLagosDateKey,
  getNextLagosMidnightIso,
  getUserAccessStatus,
  recordAiAttemptLog,
  reserveAiExecution,
  updateFeatureFlags,
  updateQuotaConfig,
} from '../server/quotaService.ts';

const TEST_TOKENS: Record<
  string,
  { uid: string; email: string; emailVerified: boolean; displayName: string; photoURL: string }
> = {
  'token-admin': {
    uid: 'uid_admin',
    email: 'sole.admin@gmail.com',
    emailVerified: true,
    displayName: 'Sole Admin',
    photoURL: '',
  },
  'token-admin-unverified': {
    uid: 'uid_admin_unv',
    email: 'sole.admin@gmail.com',
    emailVerified: false,
    displayName: 'Unverified Admin',
    photoURL: '',
  },
  'token-student-1': {
    uid: 'uid_student_1',
    email: 'student1@example.com',
    emailVerified: true,
    displayName: 'Ada Student',
    photoURL: '',
  },
  'token-student-2': {
    uid: 'uid_student_2',
    email: 'student2@example.com',
    emailVerified: true,
    displayName: 'Chidi Student',
    photoURL: '',
  },
};

let server: http.Server;
let baseUrl: string;

async function reqJson<T = Record<string, unknown>>(
  path: string,
  options: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; data: T; headers: Headers }> {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data, headers: res.headers };
}

test.before(async () => {
  initDb(':memory:');
  setTestTokenVerifier(async (token) => {
    const match = TEST_TOKENS[token];
    if (!match) return null;
    return { ...match, isAdmin: false };
  });

  const app = createApiApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert(addr && typeof addr === 'object');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  setTestTokenVerifier(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
});

test('1. Sole ADMIN_EMAIL backend enforcement blocks unauthenticated, non-admin, and unverified admin', async () => {
  const unauth = await reqJson('/api/admin/overview');
  assert.equal(unauth.status, 401);

  const student = await reqJson('/api/admin/overview', { token: 'token-student-1' });
  assert.equal(student.status, 403);
  assert.equal(student.data.code, 'ADMIN_FORBIDDEN');

  const unverifiedAdmin = await reqJson('/api/admin/overview', { token: 'token-admin-unverified' });
  assert.equal(unverifiedAdmin.status, 403);

  const studentStatus = await reqJson<{ isAdmin: boolean }>('/api/me/access-status', {
    token: 'token-student-1',
  });
  assert.equal(studentStatus.status, 200);
  assert.equal(studentStatus.data.isAdmin, false);

  const adminStatus = await reqJson<{ isAdmin: boolean }>('/api/me/access-status', {
    token: 'token-admin',
  });
  assert.equal(adminStatus.status, 200);
  assert.equal(adminStatus.data.isAdmin, true);

  const adminOverview = await reqJson('/api/admin/overview', { token: 'token-admin' });
  assert.equal(adminOverview.status, 200);
});

test('2. AES-256-GCM key encryption, error redaction, Cerebras exclusion, and Admin-key priority over .env', async () => {
  const secret = 'AIzaSySecretKeyMaterialShouldNeverLeak9999';
  const enc = encryptSecret(secret);
  assert.notEqual(enc.ciphertext, secret);
  assert.equal(decryptSecret(enc), secret);
  assert.equal(
    sanitizeErrorMessage(`Upstream failed for key ${secret}`, [secret]),
    'Upstream failed for key [REDACTED_KEY]'
  );

  // Cerebras must be rejected from admin API key management
  const cerebrasRes = await reqJson('/api/admin/api-keys', {
    method: 'POST',
    token: 'token-admin',
    body: { provider: 'cerebras', label: 'Bad Cerebras', apiKey: 'csk-12345678901234567890' },
  });
  assert.equal(cerebrasRes.status, 400);

  // Before adding admin keys, Gemini resolves to .env fallback
  const beforeCandidates = resolveSharedKeyCandidates('gemini');
  assert.equal(beforeCandidates.length, 1);
  assert.equal(beforeCandidates[0].keyOrigin, 'shared_env');

  // Add two Gemini admin keys
  const k1Res = await reqJson<{ key: { id: string; keyMask: string } }>('/api/admin/api-keys', {
    method: 'POST',
    token: 'token-admin',
    body: { provider: 'gemini', label: 'Gemini Pool #1', apiKey: 'AIzaSyAdminPoolKeyOne11111111', priority: 10 },
  });
  assert.equal(k1Res.status, 201);
  assert(!JSON.stringify(k1Res.data).includes('AIzaSyAdminPoolKeyOne11111111'));

  const k2Res = await reqJson<{ key: { id: string; keyMask: string } }>('/api/admin/api-keys', {
    method: 'POST',
    token: 'token-admin',
    body: { provider: 'gemini', label: 'Gemini Pool #2', apiKey: 'AIzaSyAdminPoolKeyTwo22222222', priority: 20 },
  });
  assert.equal(k2Res.status, 201);

  // Verify database never stores plaintext key
  const rawRow = getDb()
    .prepare('SELECT encrypted_key FROM admin_api_keys WHERE id = ?')
    .get(k1Res.data.key.id) as { encrypted_key: string };
  assert(!rawRow.encrypted_key.includes('AIzaSyAdminPoolKeyOne11111111'));

  // Admin keys take priority over .env (no .env mixed in when admin keys exist)
  const poolCandidates = resolveSharedKeyCandidates('gemini');
  assert.equal(poolCandidates.length, 2);
  assert.equal(poolCandidates[0].keyOrigin, 'shared_admin');
  assert.equal(poolCandidates[0].label, 'Gemini Pool #1');
  assert.equal(poolCandidates[1].label, 'Gemini Pool #2');

  // Failover: rate-limiting key #1 removes it from healthy pool and rotates immediately to key #2
  recordAdminKeyFailure(k1Res.data.key.id, 'gemini', 'RATE_LIMIT', '429 limit', 60_000, true);
  const rotatedCandidates = resolveSharedKeyCandidates('gemini');
  assert.equal(rotatedCandidates.length, 1);
  assert.equal(rotatedCandidates[0].label, 'Gemini Pool #2');

  // Removing both admin keys restores .env fallback
  deleteAdminApiKey(k1Res.data.key.id);
  deleteAdminApiKey(k2Res.data.key.id);
  const fallbackAgain = resolveSharedKeyCandidates('gemini');
  assert.equal(fallbackAgain.length, 1);
  assert.equal(fallbackAgain[0].keyOrigin, 'shared_env');

  // Add one fresh key back for subsequent tests
  addAdminApiKey({
    provider: 'gemini',
    label: 'Active Admin Gemini',
    rawKey: 'AIzaSyActiveAdminKey3333333333',
    priority: 10,
  });
});

test('3. Africa/Lagos midnight reset, atomic quota enforcement, failover dedupe, and replay protection', async () => {
  // 22:59:59 UTC on 2026-11-23 is 23:59:59 WAT (still 2026-11-23 in Africa/Lagos)
  const beforeMidnightLagos = Date.UTC(2026, 10, 23, 22, 59, 59);
  // 23:00:00 UTC on 2026-11-23 is 00:00:00 WAT on 2026-11-24 (midnight reset!)
  const atMidnightLagos = Date.UTC(2026, 10, 23, 23, 0, 0);
  assert.equal(getLagosDateKey(beforeMidnightLagos), '2026-11-23');
  assert.equal(getLagosDateKey(atMidnightLagos), '2026-11-24');
  assert.equal(getNextLagosMidnightIso(beforeMidnightLagos), '2026-11-23T23:00:00.000Z');

  // Configure daily quota to 3 for deterministic test
  updateQuotaConfig({ defaultDailyQuota: 3, defaultFreeAccessDays: 7 }, 'sole.admin@gmail.com');

  upsertUserFromAuth({
    ...TEST_TOKENS['token-student-1'],
    isAdmin: false,
  });

  // Request 1 with logical ID 'req_dedupe_1'
  const r1 = reserveAiExecution({
    uid: 'uid_student_1',
    userEmail: 'student1@example.com',
    feature: 'tutor',
    task: 'chat',
    usesPersonalKey: false,
    logicalRequestId: 'req_dedupe_1',
    nowMs: beforeMidnightLagos,
  });
  assert.equal(r1.quotaSnapshot.used, 1);
  assert.equal(r1.quotaSnapshot.remaining, 2);
  assert.equal(r1.quotaChargedNow, true);

  // Internal provider failover reusing the same in-flight logicalRequestId must NOT deduct another credit!
  const r1Failover = reserveAiExecution({
    uid: 'uid_student_1',
    userEmail: 'student1@example.com',
    feature: 'tutor',
    task: 'chat',
    usesPersonalKey: false,
    logicalRequestId: 'req_dedupe_1',
    nowMs: beforeMidnightLagos + 100,
  });
  assert.equal(r1Failover.quotaChargedNow, false);
  assert.equal(r1Failover.isFailoverReuse, true);
  assert.equal(r1Failover.quotaSnapshot.used, 1);

  // Finalize request 1 as succeeded
  finalizeLogicalRequest({ logicalRequestId: 'req_dedupe_1', status: 'success' });

  // Malicious replay of an ALREADY SUCCEEDED logicalRequestId must charge a new credit (no bypass!)
  const r2Replay = reserveAiExecution({
    uid: 'uid_student_1',
    userEmail: 'student1@example.com',
    feature: 'tutor',
    task: 'chat',
    usesPersonalKey: false,
    logicalRequestId: 'req_dedupe_1',
    nowMs: beforeMidnightLagos + 200,
  });
  assert.equal(r2Replay.quotaChargedNow, true);
  assert.equal(r2Replay.quotaSnapshot.used, 2);
  finalizeLogicalRequest({ logicalRequestId: r2Replay.logicalRequestId, status: 'success' });

  // Request 3 hits limit (3/3)
  const r3 = reserveAiExecution({
    uid: 'uid_student_1',
    userEmail: 'student1@example.com',
    feature: 'practice_cbt',
    task: 'structured_json',
    usesPersonalKey: false,
    logicalRequestId: 'req_third_3',
    nowMs: beforeMidnightLagos + 300,
  });
  assert.equal(r3.quotaSnapshot.used, 3);
  assert.equal(r3.quotaSnapshot.remaining, 0);
  finalizeLogicalRequest({ logicalRequestId: r3.logicalRequestId, status: 'success' });

  // Request 4 on same WAT day MUST be blocked with SHARED_QUOTA_EXHAUSTED
  assert.throws(
    () =>
      reserveAiExecution({
        uid: 'uid_student_1',
        userEmail: 'student1@example.com',
        feature: 'automatic_study',
        task: 'structured_json',
        usesPersonalKey: false,
        logicalRequestId: 'req_fourth_4',
        nowMs: beforeMidnightLagos + 400,
      }),
    (err: unknown) => err instanceof AiAccessError && err.code === 'SHARED_QUOTA_EXHAUSTED' && err.status === 429
  );

  // Personal BYOK key MUST still work and NOT consume shared quota!
  const byokReq = reserveAiExecution({
    uid: 'uid_student_1',
    userEmail: 'student1@example.com',
    feature: 'tutor',
    task: 'chat',
    usesPersonalKey: true,
    logicalRequestId: 'req_byok_5',
    nowMs: beforeMidnightLagos + 500,
  });
  assert.equal(byokReq.quotaChargedNow, false);

  // At 12:00 AM Africa/Lagos (23:00:00Z), daily quota resets cleanly to 0!
  const afterReset = reserveAiExecution({
    uid: 'uid_student_1',
    userEmail: 'student1@example.com',
    feature: 'tutor',
    task: 'chat',
    usesPersonalKey: false,
    logicalRequestId: 'req_next_day_1',
    nowMs: atMidnightLagos,
  });
  assert.equal(afterReset.dateKeyLagos, '2026-11-24');
  assert.equal(afterReset.quotaSnapshot.used, 1);
  assert.equal(afterReset.quotaSnapshot.remaining, 2);

  // Restore default 30/day
  updateQuotaConfig({ defaultDailyQuota: 30 }, 'sole.admin@gmail.com');
});

test('4. 7-day free access expiry blocks shared & .env fallback, while allowing personal BYOK and admin override', async () => {
  const status = getUserAccessStatus('uid_student_1');
  const eightDaysLater = status.registeredAtMs + 8 * 86_400_000;

  assert.throws(
    () =>
      reserveAiExecution({
        uid: 'uid_student_1',
        userEmail: 'student1@example.com',
        feature: 'tutor',
        task: 'chat',
        usesPersonalKey: false,
        nowMs: eightDaysLater,
      }),
    (err: unknown) => err instanceof AiAccessError && err.code === 'FREE_TRIAL_EXPIRED' && err.status === 403
  );

  // Personal BYOK still allowed after 7-day expiry
  const byokAfterExpiry = reserveAiExecution({
    uid: 'uid_student_1',
    userEmail: 'student1@example.com',
    feature: 'tutor',
    task: 'chat',
    usesPersonalKey: true,
    nowMs: eightDaysLater,
  });
  assert.equal(byokAfterExpiry.quotaChargedNow, false);

  // Admin override (force_allow) restores shared access
  const overrideRes = await reqJson('/api/admin/users/uid_student_1/overrides', {
    method: 'PATCH',
    token: 'token-admin',
    body: { sharedAiAccessOverride: 'force_allow', dailyQuotaOverride: 50 },
  });
  assert.equal(overrideRes.status, 200);

  const allowedAfterOverride = reserveAiExecution({
    uid: 'uid_student_1',
    userEmail: 'student1@example.com',
    feature: 'tutor',
    task: 'chat',
    usesPersonalKey: false,
    nowMs: eightDaysLater,
  });
  assert.equal(allowedAfterOverride.quotaSnapshot.limit, 50);

  // Reset override back to default
  await reqJson('/api/admin/users/uid_student_1/overrides', {
    method: 'PATCH',
    token: 'token-admin',
    body: { sharedAiAccessOverride: 'default', dailyQuotaOverride: null },
  });
});

test('5. Feature flags (Live Voice AI & Global AI Kill Switch) and User Suspension enforcement', async () => {
  // Disable Live Voice AI only
  updateFeatureFlags({ features: { live_voice_ai: false } }, 'sole.admin@gmail.com');
  assert.throws(
    () =>
      reserveAiExecution({
        uid: 'uid_student_1',
        userEmail: 'student1@example.com',
        feature: 'live_voice_ai',
        task: 'live',
        usesPersonalKey: false,
      }),
    (err: unknown) => err instanceof AiAccessError && err.code === 'FEATURE_DISABLED'
  );

  // Global AI kill switch blocks everything including personal BYOK
  updateFeatureFlags({ aiGlobalEnabled: false }, 'sole.admin@gmail.com');
  assert.throws(
    () =>
      reserveAiExecution({
        uid: 'uid_student_1',
        userEmail: 'student1@example.com',
        feature: 'tutor',
        task: 'chat',
        usesPersonalKey: true,
      }),
    (err: unknown) => err instanceof AiAccessError && err.code === 'FEATURE_DISABLED'
  );

  // Re-enable features
  updateFeatureFlags({ aiGlobalEnabled: true, features: { live_voice_ai: true } }, 'sole.admin@gmail.com');

  // Suspend user via Admin API
  const suspendRes = await reqJson('/api/admin/users/uid_student_1/status', {
    method: 'PATCH',
    token: 'token-admin',
    body: { status: 'suspended', notes: 'Abuse test' },
  });
  assert.equal(suspendRes.status, 200);

  assert.throws(
    () =>
      reserveAiExecution({
        uid: 'uid_student_1',
        userEmail: 'student1@example.com',
        feature: 'tutor',
        task: 'chat',
        usesPersonalKey: false,
      }),
    (err: unknown) => err instanceof AiAccessError && err.code === 'ACCOUNT_SUSPENDED'
  );

  // Unsuspend user
  const restoreRes = await reqJson('/api/admin/users/uid_student_1/status', {
    method: 'PATCH',
    token: 'token-admin',
    body: { status: 'active' },
  });
  assert.equal(restoreRes.status, 200);
});

test('6. Group Study Management, Moderation, Ownership Transfer, Reports & Audit Logs', async () => {
  // Ensure student 2 exists
  await reqJson('/api/me/access-status', { token: 'token-student-2' });

  // Student 1 syncs a course, material, and study group with Student 2 as member
  const syncRes = await reqJson('/api/me/sync', {
    method: 'POST',
    token: 'token-student-1',
    body: {
      courses: [{ id: 'crs_101', code: 'CSC301', name: 'Algorithms', description: 'Graphs & DP', isPublic: true }],
      materials: [{ courseId: 'crs_101', sourceId: 'src_1', title: 'Week 1 Lecture', materialType: 'pdf', pageCount: 12 }],
      groups: [
        {
          id: 'grp_algo_1',
          courseId: 'crs_101',
          courseCode: 'CSC301',
          courseName: 'Algorithms',
          name: 'Algo Study Squad',
          description: 'Exam prep group',
          authorUid: 'uid_student_1',
          authorName: 'Ada Student',
          members: [{ uid: 'uid_student_2', displayName: 'Chidi Student', email: 'student2@example.com' }],
        },
      ],
    },
  });
  assert.equal(syncRes.status, 200);

  // Student 2 posts a shared note
  const noteRes = await reqJson<{ id: string }>('/api/groups/grp_algo_1/notes', {
    method: 'POST',
    token: 'token-student-2',
    body: { title: 'Dijkstra Notes', content: 'Use a min-heap priority queue.' },
  });
  assert.equal(noteRes.status, 201);

  // Student 1 files a report against the note
  const reportRes = await reqJson<{ id: string }>('/api/groups/grp_algo_1/report', {
    method: 'POST',
    token: 'token-student-1',
    body: {
      targetType: 'note',
      targetId: noteRes.data.id,
      targetLabel: 'Dijkstra Notes',
      reportedUserUid: 'uid_student_2',
      reportedUserEmail: 'student2@example.com',
      reason: 'Off-topic spam',
    },
  });
  assert.equal(reportRes.status, 201);

  // Admin inspects group
  const groupDetail = await reqJson<{
    group: { id: string; author_uid: string };
    members: Array<{ member_uid: string }>;
    notes: Array<{ id: string }>;
    materials: Array<{ source_id: string }>;
    reports: Array<{ id: string }>;
  }>('/api/admin/groups/grp_algo_1', { token: 'token-admin' });
  assert.equal(groupDetail.status, 200);
  assert.equal(groupDetail.data.members.length, 2);
  assert.equal(groupDetail.data.notes.length, 1);
  assert.equal(groupDetail.data.materials.length, 1);
  assert.equal(groupDetail.data.reports.length, 1);

  // Admin hides the note, transfers ownership to Student 2, suspends & restores group, resolves report
  const hideNote = await reqJson(`/api/admin/groups/grp_algo_1/notes/${noteRes.data.id}`, {
    method: 'PATCH',
    token: 'token-admin',
    body: { status: 'hidden', moderationReason: 'Spam' },
  });
  assert.equal(hideNote.status, 200);

  const transfer = await reqJson('/api/admin/groups/grp_algo_1/transfer-ownership', {
    method: 'POST',
    token: 'token-admin',
    body: { newOwnerUid: 'uid_student_2' },
  });
  assert.equal(transfer.status, 200);

  const suspendGroup = await reqJson('/api/admin/groups/grp_algo_1/status', {
    method: 'PATCH',
    token: 'token-admin',
    body: { status: 'suspended', reason: 'Under review' },
  });
  assert.equal(suspendGroup.status, 200);

  const resolveRep = await reqJson(`/api/admin/groups/reports/${reportRes.data.id}`, {
    method: 'PATCH',
    token: 'token-admin',
    body: { status: 'resolved', resolutionNote: 'Handled' },
  });
  assert.equal(resolveRep.status, 200);

  // Log shared vs personal AI usage and verify AI Usage Analytics endpoint
  recordAiAttemptLog({
    logicalRequestId: 'analytics_1',
    uid: 'uid_student_1',
    userEmail: 'student1@example.com',
    feature: 'automatic_study',
    task: 'structured_json',
    keyOrigin: 'shared_admin',
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
    status: 'success',
    isLogicalRoot: true,
    isFailover: false,
    inputTokens: 120,
    outputTokens: 340,
    totalTokens: 460,
    latencyMs: 820,
  });
  recordAiAttemptLog({
    logicalRequestId: 'analytics_2',
    uid: 'uid_student_2',
    userEmail: 'student2@example.com',
    feature: 'tutor',
    task: 'chat',
    keyOrigin: 'personal_byok',
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    status: 'success',
    isLogicalRoot: true,
    isFailover: false,
    inputTokens: 50,
    outputTokens: 100,
    totalTokens: 150,
    latencyMs: 540,
  });

  const analyticsRes = await reqJson<{
    summary: { sharedRequests: number; personalRequests: number; totalTokens: number };
    byFeature: Array<{ feature: string; requests: number }>;
    byProvider: Array<{ provider: string; totalAttempts: number }>;
  }>('/api/admin/analytics/ai-usage', { token: 'token-admin' });
  assert.equal(analyticsRes.status, 200);
  assert(analyticsRes.data.summary.sharedRequests >= 1);
  assert(analyticsRes.data.summary.personalRequests >= 1);
  assert(analyticsRes.data.summary.totalTokens >= 610);
  assert(analyticsRes.data.byFeature.length >= 2);
  assert(analyticsRes.data.byProvider.length >= 2);

  // Verify audit logs captured group moderation & admin actions
  const auditRes = await reqJson<{ logs: Array<{ action: string }> }>('/api/admin/audit-logs', {
    token: 'token-admin',
  });
  assert.equal(auditRes.status, 200);
  const actions = new Set(auditRes.data.logs.map((l) => l.action));
  assert(actions.has('group_ownership_transferred'));
  assert(actions.has('group_suspended'));
  assert(actions.has('group_note_hidden'));
  assert(actions.has('group_report_resolved'));
});
