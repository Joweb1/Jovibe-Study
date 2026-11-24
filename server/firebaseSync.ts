import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb, writeAdminAuditLog } from './db.ts';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

export interface ServiceAccountJson {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
}

export interface FirebaseSyncResult {
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

let cachedConfig: { value: FirebaseAppletConfig; mtimeMs: number } | null = null;
let cachedOAuthToken: { token: string; expiresAtMs: number } | null = null;
let lastAutoSyncMs = 0;
let lastSyncResult: FirebaseSyncResult | null = null;

export function getFirebaseConfig(): FirebaseAppletConfig {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const stat = fs.statSync(cfgPath);
    if (cachedConfig && cachedConfig.mtimeMs === stat.mtimeMs) {
      return {
        projectId: process.env.FIREBASE_PROJECT_ID?.trim() || cachedConfig.value.projectId,
        firestoreDatabaseId:
          process.env.FIREBASE_DATABASE_ID?.trim() || cachedConfig.value.firestoreDatabaseId,
      };
    }
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Partial<FirebaseAppletConfig>;
    const parsed: FirebaseAppletConfig = {
      projectId: raw.projectId || 'sotal-study',
      firestoreDatabaseId: raw.firestoreDatabaseId || '(default)',
    };
    cachedConfig = { value: parsed, mtimeMs: stat.mtimeMs };
    return {
      projectId: process.env.FIREBASE_PROJECT_ID?.trim() || parsed.projectId,
      firestoreDatabaseId:
        process.env.FIREBASE_DATABASE_ID?.trim() || parsed.firestoreDatabaseId,
    };
  } catch {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID?.trim() || 'sotal-study',
      firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID?.trim() || '(default)',
    };
  }
}

export function loadServiceAccount(): ServiceAccountJson | null {
  const inlineJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (inlineJson) {
    try {
      const parsed = JSON.parse(inlineJson) as Partial<ServiceAccountJson>;
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
          project_id: parsed.project_id,
          token_uri: parsed.token_uri,
        };
      }
    } catch {
      // Fall through to file paths
    }
  }

  const candidatePaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim(),
    path.resolve(process.cwd(), 'serviceAccountKey.json'),
  ].filter((p): p is string => Boolean(p));

  // Also check any *firebase-adminsdk*.json file in project root
  try {
    const entries = fs.readdirSync(process.cwd());
    for (const name of entries) {
      if (name.includes('firebase-adminsdk') && name.endsWith('.json')) {
        candidatePaths.push(path.resolve(process.cwd(), name));
      }
    }
  } catch {
    // Ignore readdir errors
  }

  for (const filePath of candidatePaths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ServiceAccountJson>;
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
          project_id: parsed.project_id,
          token_uri: parsed.token_uri,
        };
      }
    } catch {
      // Try next candidate
    }
  }

  return null;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function isServiceAccountConfigured(): boolean {
  return loadServiceAccount() !== null;
}

export async function getServiceAccountAccessToken(sa: ServiceAccountJson): Promise<string> {
  const now = Date.now();
  if (cachedOAuthToken && cachedOAuthToken.expiresAtMs > now + 60_000) {
    return cachedOAuthToken.token;
  }

  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;

  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: [
        'https://www.googleapis.com/auth/datastore',
        'https://www.googleapis.com/auth/identitytoolkit',
        'https://www.googleapis.com/auth/firebase',
      ].join(' '),
      aud: tokenUri,
      iat,
      exp,
    })
  );

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claimSet}`);
  signer.end();
  const signature = base64UrlEncode(signer.sign(sa.private_key));
  const assertion = `${header}.${claimSet}.${signature}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Service account OAuth2 token exchange failed (HTTP ${res.status}): ${errText.slice(0, 180)}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error('Google OAuth2 returned no access_token.');
  }

  cachedOAuthToken = {
    token: json.access_token,
    expiresAtMs: now + (Number(json.expires_in) || 3600) * 1000,
  };
  return json.access_token;
}

// ---------------------------------------------------------------------------
// Firestore REST Value Decoding Helpers
// ---------------------------------------------------------------------------

type FirestoreValue = {
  stringValue?: string;
  integerValue?: string | number;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  mapValue?: { fields?: Record<string, FirestoreValue> };
  arrayValue?: { values?: FirestoreValue[] };
};

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

function decodeValue(val: FirestoreValue | undefined): unknown {
  if (!val || typeof val !== 'object') return undefined;
  if ('stringValue' in val) return val.stringValue ?? '';
  if ('integerValue' in val) return Number(val.integerValue ?? 0);
  if ('doubleValue' in val) return Number(val.doubleValue ?? 0);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('timestampValue' in val) return val.timestampValue ? Date.parse(val.timestampValue) : null;
  if ('nullValue' in val) return null;
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue?.fields || {})) {
      out[k] = decodeValue(v);
    }
    return out;
  }
  if ('arrayValue' in val) {
    return (val.arrayValue?.values || []).map(decodeValue);
  }
  return undefined;
}

function decodeDoc(doc: FirestoreDocument): { id: string; data: Record<string, unknown>; createMs: number; updateMs: number } {
  const segments = doc.name.split('/');
  const id = segments[segments.length - 1] || '';
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    data[k] = decodeValue(v);
  }
  const createMs = doc.createTime ? Date.parse(doc.createTime) : Date.now();
  const updateMs = doc.updateTime ? Date.parse(doc.updateTime) : createMs;
  return {
    id,
    data,
    createMs: Number.isFinite(createMs) ? createMs : Date.now(),
    updateMs: Number.isFinite(updateMs) ? updateMs : Date.now(),
  };
}

async function listFirestoreCollection(
  collectionPath: string,
  bearerToken: string
): Promise<{ docs: FirestoreDocument[]; permissionDenied: boolean; errorDetail?: string }> {
  const cfg = getFirebaseConfig();
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    cfg.projectId
  )}/databases/${encodeURIComponent(cfg.firestoreDatabaseId)}/documents/${collectionPath}`;

  const docs: FirestoreDocument[] = [];
  let pageToken = '';

  for (let page = 0; page < 20; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    if (res.status === 403) {
      const text = await res.text().catch(() => '');
      return { docs: [], permissionDenied: true, errorDetail: text.slice(0, 220) };
    }
    if (res.status === 404) {
      return { docs: [], permissionDenied: false };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Firestore list ${collectionPath} failed (HTTP ${res.status}): ${text.slice(0, 180)}`);
    }

    const payload = (await res.json()) as {
      documents?: FirestoreDocument[];
      nextPageToken?: string;
    };
    if (Array.isArray(payload.documents)) {
      docs.push(...payload.documents);
    }
    if (!payload.nextPageToken) break;
    pageToken = payload.nextPageToken;
  }

  return { docs, permissionDenied: false };
}

async function syncFirebaseAuthAccounts(accessToken: string): Promise<number> {
  const cfg = getFirebaseConfig();
  const db = getDb();
  const now = Date.now();
  let totalSynced = 0;
  let nextPageToken = '';

  for (let page = 0; page < 20; page++) {
    const url = new URL(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
        cfg.projectId
      )}/accounts:batchGet`
    );
    url.searchParams.set('maxResults', '1000');
    if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) break;

    const payload = (await res.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        displayName?: string;
        photoUrl?: string;
        createdAt?: string;
        lastLoginAt?: string;
        disabled?: boolean;
      }>;
      nextPageToken?: string;
    };

    for (const u of payload.users || []) {
      if (!u.localId) continue;
      const uid = u.localId;
      const email = (u.email || '').trim().toLowerCase();
      const displayName = (u.displayName || email.split('@')[0] || 'Student').slice(0, 120);
      const photoUrl = (u.photoUrl || '').slice(0, 500);
      const createdAtMs = u.createdAt && Number(u.createdAt) > 0 ? Number(u.createdAt) : now;
      const lastActiveMs =
        u.lastLoginAt && Number(u.lastLoginAt) > 0 ? Number(u.lastLoginAt) : createdAtMs;
      const status = u.disabled ? 'suspended' : 'active';

      const existing = db.prepare('SELECT uid, registered_at_ms FROM users WHERE uid = ?').get(uid) as
        | { uid?: string; registered_at_ms?: number }
        | undefined;

      if (!existing?.uid) {
        db.prepare(
          `INSERT INTO users (
            uid, email, display_name, photo_url, status, registered_at_ms, last_active_at_ms,
            shared_ai_access_override, first_login_notice_seen, has_personal_key,
            courses_count, materials_count, notes, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'default', 0, 0, 0, 0, '', ?)`
        ).run(uid, email, displayName, photoUrl, status, createdAtMs, lastActiveMs, now);
      } else {
        const earliestReg = Math.min(Number(existing.registered_at_ms || createdAtMs), createdAtMs);
        db.prepare(
          `UPDATE users
           SET email = CASE WHEN ? != '' THEN ? ELSE email END,
               display_name = CASE WHEN ? != '' THEN ? ELSE display_name END,
               photo_url = CASE WHEN ? != '' THEN ? ELSE photo_url END,
               registered_at_ms = ?,
               last_active_at_ms = MAX(last_active_at_ms, ?),
               updated_at_ms = ?
           WHERE uid = ?`
        ).run(email, email, displayName, displayName, photoUrl, photoUrl, earliestReg, lastActiveMs, now, uid);
      }
      totalSynced += 1;
    }

    if (!payload.nextPageToken) break;
    nextPageToken = payload.nextPageToken;
  }

  return totalSynced;
}

async function syncFirestoreCollections(
  bearerToken: string
): Promise<{
  permissionDenied: boolean;
  errorDetail?: string;
  usersSynced: number;
  coursesSynced: number;
  materialsSynced: number;
  groupsSynced: number;
}> {
  const usersRes = await listFirestoreCollection('users', bearerToken);
  if (usersRes.permissionDenied) {
    return {
      permissionDenied: true,
      errorDetail: usersRes.errorDetail,
      usersSynced: 0,
      coursesSynced: 0,
      materialsSynced: 0,
      groupsSynced: 0,
    };
  }

  const db = getDb();
  const now = Date.now();
  let usersSynced = 0;
  let coursesSynced = 0;
  let materialsSynced = 0;
  let groupsSynced = 0;

  for (const rawUserDoc of usersRes.docs) {
    const parsed = decodeDoc(rawUserDoc);
    const uid = String(parsed.data.userId || parsed.id || '').trim();
    if (!uid) continue;

    const email = String(parsed.data.email || '').trim().toLowerCase();
    const displayName = String(parsed.data.displayName || email.split('@')[0] || 'Student').slice(0, 120);
    const photoUrl = String(parsed.data.photoURL || '').slice(0, 500);
    const createdAtMs =
      typeof parsed.data.createdAt === 'number' && parsed.data.createdAt > 0
        ? Math.floor(parsed.data.createdAt)
        : parsed.createMs;
    const updatedAtMs =
      typeof parsed.data.updatedAt === 'number' && parsed.data.updatedAt > 0
        ? Math.floor(parsed.data.updatedAt)
        : parsed.updateMs;

    const existingUser = db
      .prepare('SELECT uid, registered_at_ms FROM users WHERE uid = ?')
      .get(uid) as { uid?: string; registered_at_ms?: number } | undefined;

    if (!existingUser?.uid) {
      db.prepare(
        `INSERT INTO users (
          uid, email, display_name, photo_url, status, registered_at_ms, last_active_at_ms,
          shared_ai_access_override, first_login_notice_seen, has_personal_key,
          courses_count, materials_count, notes, updated_at_ms
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, 'default', 0, 0, 0, 0, '', ?)`
      ).run(uid, email, displayName, photoUrl, createdAtMs, updatedAtMs, now);
    } else {
      const earliestReg = Math.min(Number(existingUser.registered_at_ms || createdAtMs), createdAtMs);
      db.prepare(
        `UPDATE users
         SET email = CASE WHEN ? != '' THEN ? ELSE email END,
             display_name = CASE WHEN ? != '' THEN ? ELSE display_name END,
             photo_url = CASE WHEN ? != '' THEN ? ELSE photo_url END,
             registered_at_ms = ?,
             last_active_at_ms = MAX(last_active_at_ms, ?),
             updated_at_ms = ?
         WHERE uid = ?`
      ).run(email, email, displayName, displayName, photoUrl, photoUrl, earliestReg, updatedAtMs, now, uid);
    }
    usersSynced += 1;

    // Fetch user's owned courses
    const coursesRes = await listFirestoreCollection(`users/${encodeURIComponent(uid)}/courses`, bearerToken);
    if (coursesRes.permissionDenied) continue;

    for (const rawCourse of coursesRes.docs) {
      const c = decodeDoc(rawCourse);
      const courseId = c.id;
      const code = String(c.data.code || '').slice(0, 32);
      const name = String(c.data.name || '').slice(0, 120);
      const description = String(c.data.description || '').slice(0, 1000);
      const isPublic = c.data.isPublic ? 1 : 0;
      const shareToken = String(c.data.shareToken || '').slice(0, 128);
      const authorName = String(c.data.authorName || displayName).slice(0, 120);
      const cCreated = typeof c.data.createdAt === 'number' ? Math.floor(c.data.createdAt) : c.createMs;
      const cUpdated = typeof c.data.updatedAt === 'number' ? Math.floor(c.data.updatedAt) : c.updateMs;

      db.prepare(
        `INSERT INTO user_courses_mirror (
          uid, course_id, code, name, description, is_public, share_token, author_name,
          materials_count, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(uid, course_id) DO UPDATE SET
          code = excluded.code, name = excluded.name, description = excluded.description,
          is_public = excluded.is_public, share_token = excluded.share_token,
          author_name = excluded.author_name, updated_at_ms = excluded.updated_at_ms`
      ).run(uid, courseId, code, name, description, isPublic, shareToken, authorName, cCreated, cUpdated);
      coursesSynced += 1;

      // Fetch course sources (uploaded materials)
      const sourcesRes = await listFirestoreCollection(
        `users/${encodeURIComponent(uid)}/courses/${encodeURIComponent(courseId)}/sources`,
        bearerToken
      );
      if (!sourcesRes.permissionDenied) {
        for (const rawSource of sourcesRes.docs) {
          const s = decodeDoc(rawSource);
          const sCreated = typeof s.data.createdAt === 'number' ? Math.floor(s.data.createdAt) : s.createMs;
          const sUpdated = typeof s.data.updatedAt === 'number' ? Math.floor(s.data.updatedAt) : s.updateMs;
          db.prepare(
            `INSERT INTO user_materials_mirror (
              uid, course_id, source_id, title, material_type, page_count,
              original_file_name, content_preview, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(uid, course_id, source_id) DO UPDATE SET
              title = excluded.title, material_type = excluded.material_type,
              page_count = excluded.page_count, original_file_name = excluded.original_file_name,
              content_preview = excluded.content_preview, updated_at_ms = excluded.updated_at_ms`
          ).run(
            uid,
            courseId,
            s.id,
            String(s.data.title || 'Untitled').slice(0, 200),
            String(s.data.materialType || 'other').slice(0, 40),
            Math.max(0, Math.floor(Number(s.data.pageOrSlideCount) || 0)),
            String(s.data.originalFileName || '').slice(0, 260),
            String(s.data.extractedContent || '').slice(0, 400),
            sCreated,
            sUpdated
          );
          materialsSynced += 1;
        }
      }

      // Fetch course study groups & members
      const [groupsRes, membersRes] = await Promise.all([
        listFirestoreCollection(
          `users/${encodeURIComponent(uid)}/courses/${encodeURIComponent(courseId)}/groups`,
          bearerToken
        ),
        listFirestoreCollection(
          `users/${encodeURIComponent(uid)}/courses/${encodeURIComponent(courseId)}/members`,
          bearerToken
        ),
      ]);

      const decodedMembers = membersRes.permissionDenied
        ? []
        : membersRes.docs.map((m) => decodeDoc(m));

      if (!groupsRes.permissionDenied) {
        for (const rawGroup of groupsRes.docs) {
          const g = decodeDoc(rawGroup);
          const gCreated = typeof g.data.createdAt === 'number' ? Math.floor(g.data.createdAt) : g.createMs;
          const gUpdated = typeof g.data.updatedAt === 'number' ? Math.floor(g.data.updatedAt) : g.updateMs;

          const existingGroup = db
            .prepare('SELECT id, status FROM study_groups WHERE id = ?')
            .get(g.id) as { id?: string; status?: string } | undefined;

          if (!existingGroup?.id) {
            db.prepare(
              `INSERT INTO study_groups (
                id, author_uid, author_email, author_name, course_id, course_code, course_name,
                name, description, status, share_token, member_count, last_activity_at_ms, created_at_ms, updated_at_ms
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?, ?)`
            ).run(
              g.id,
              uid,
              email,
              authorName,
              courseId,
              code,
              name,
              String(g.data.name || 'Study Group').slice(0, 100),
              String(g.data.description || '').slice(0, 400),
              shareToken,
              gUpdated,
              gCreated,
              gUpdated
            );
            db.prepare(
              `INSERT OR IGNORE INTO group_members (
                group_id, member_uid, display_name, email, photo_url, role, status, joined_at_ms, updated_at_ms
              ) VALUES (?, ?, ?, ?, ?, 'owner', 'active', ?, ?)`
            ).run(g.id, uid, displayName, email, photoUrl, gCreated, now);
          }

          for (const m of decodedMembers) {
            const mUid = String(m.data.memberUid || m.id || '').trim();
            const mGroupId = String(m.data.groupId || '');
            if (!mUid) continue;
            const mDisplayName = String(m.data.displayName || 'Student').slice(0, 120);
            const mPhoto = String(m.data.photoURL || '').slice(0, 500);
            const mJoinedAt = typeof m.data.joinedAt === 'number' ? Math.floor(m.data.joinedAt) : m.createMs;

            // Ensure any discovered course member also exists in the admin users directory
            const existingMemberUser = db.prepare('SELECT uid FROM users WHERE uid = ?').get(mUid) as
              | { uid?: string }
              | undefined;
            if (!existingMemberUser?.uid) {
              db.prepare(
                `INSERT OR IGNORE INTO users (
                  uid, email, display_name, photo_url, status, registered_at_ms, last_active_at_ms,
                  shared_ai_access_override, first_login_notice_seen, has_personal_key,
                  courses_count, materials_count, notes, updated_at_ms
                ) VALUES (?, '', ?, ?, 'active', ?, ?, 'default', 0, 0, 0, 0, '', ?)`
              ).run(mUid, mDisplayName, mPhoto, mJoinedAt, mJoinedAt, now);
              usersSynced += 1;
            }

            if (mGroupId && mGroupId !== g.id) continue;
            db.prepare(
              `INSERT OR IGNORE INTO group_members (
                group_id, member_uid, display_name, email, photo_url, role, status, joined_at_ms, updated_at_ms
              ) VALUES (?, ?, ?, '', ?, 'member', 'active', ?, ?)`
            ).run(g.id, mUid, mDisplayName, mPhoto, mJoinedAt, now);
          }

          const cntRow = db
            .prepare("SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = ? AND status = 'active'")
            .get(g.id) as { cnt?: number };
          db.prepare('UPDATE study_groups SET member_count = ? WHERE id = ?').run(
            Math.max(1, Number(cntRow?.cnt ?? 1)),
            g.id
          );
          groupsSynced += 1;
        }
      }
    }

    // Recompute accurate counts on user row
    const cCount = db
      .prepare('SELECT COUNT(*) AS cnt FROM user_courses_mirror WHERE uid = ?')
      .get(uid) as { cnt?: number };
    const mCount = db
      .prepare("SELECT COUNT(*) AS cnt FROM user_materials_mirror WHERE uid = ? AND status != 'deleted'")
      .get(uid) as { cnt?: number };
    db.prepare(
      'UPDATE users SET courses_count = ?, materials_count = ?, updated_at_ms = ? WHERE uid = ?'
    ).run(Number(cCount?.cnt ?? 0), Number(mCount?.cnt ?? 0), now, uid);
  }

  return {
    permissionDenied: false,
    usersSynced,
    coursesSynced,
    materialsSynced,
    groupsSynced,
  };
}

export function getLastFirebaseSyncStatus(): FirebaseSyncResult | null {
  return lastSyncResult;
}

/**
 * Syncs all Firebase users, courses, materials, and study groups into the Admin Dashboard SQLite DB.
 * Uses Firebase Service Account credentials if present (syncing both Firebase Auth & Firestore),
 * otherwise uses the authenticated admin's Firebase ID token against Firestore REST API.
 */
export async function syncAllFromFirebase(params: {
  adminUid: string;
  adminEmail: string;
  adminIdToken?: string;
  force?: boolean;
}): Promise<FirebaseSyncResult> {
  const now = Date.now();
  const cfg = getFirebaseConfig();

  // Only reuse cached sync result within cooldown when the previous sync succeeded
  if (
    !params.force &&
    lastSyncResult &&
    lastSyncResult.ok &&
    !lastSyncResult.permissionDenied &&
    now - lastAutoSyncMs < 30_000
  ) {
    return lastSyncResult;
  }

  // Skip real network sync during automated offline tests
  if (process.env.NODE_ENV === 'test') {
    const empty: FirebaseSyncResult = {
      ok: true,
      source: 'none',
      usersSynced: 0,
      coursesSynced: 0,
      materialsSynced: 0,
      groupsSynced: 0,
      syncedAtMs: now,
      projectId: cfg.projectId,
      firestoreDatabaseId: cfg.firestoreDatabaseId,
    };
    lastSyncResult = empty;
    lastAutoSyncMs = now;
    return empty;
  }

  lastAutoSyncMs = now;

  try {
    // Path 1: Service Account (syncs BOTH Firebase Auth accounts AND Firestore collections)
    const sa = loadServiceAccount();
    if (sa) {
      const accessToken = await getServiceAccountAccessToken(sa);
      const authCount = await syncFirebaseAuthAccounts(accessToken);
      const fsResult = await syncFirestoreCollections(accessToken);
      const result: FirebaseSyncResult = {
        ok: true,
        source: 'service_account',
        usersSynced: Math.max(authCount, fsResult.usersSynced),
        coursesSynced: fsResult.coursesSynced,
        materialsSynced: fsResult.materialsSynced,
        groupsSynced: fsResult.groupsSynced,
        syncedAtMs: Date.now(),
        projectId: cfg.projectId,
        firestoreDatabaseId: cfg.firestoreDatabaseId,
      };
      lastSyncResult = result;
      if (params.force) {
        writeAdminAuditLog({
          adminUid: params.adminUid,
          adminEmail: params.adminEmail,
          action: 'firebase_sync_completed',
          targetType: 'system',
          targetId: 'firebase',
          details: result as unknown as Record<string, unknown>,
        });
      }
      return result;
    }

    // Path 2: Admin's verified Firebase ID token via Firestore REST API
    if (params.adminIdToken) {
      const fsResult = await syncFirestoreCollections(params.adminIdToken);
      if (fsResult.permissionDenied) {
        const denied: FirebaseSyncResult = {
          ok: false,
          source: 'admin_token',
          usersSynced: 0,
          coursesSynced: 0,
          materialsSynced: 0,
          groupsSynced: 0,
          syncedAtMs: Date.now(),
          projectId: cfg.projectId,
          firestoreDatabaseId: cfg.firestoreDatabaseId,
          permissionDenied: true,
          error:
            `Firestore REST API denied listing /users on ${cfg.projectId} (${cfg.firestoreDatabaseId}).` +
            (fsResult.errorDetail ? ` Details: ${fsResult.errorDetail}` : ''),
          setupHint:
            'Verify firestore.rules are deployed to this database and that your signed-in admin email matches firestore.rules, or configure FIREBASE_SERVICE_ACCOUNT_JSON in environment variables to sync both Firebase Auth and Firestore.',
        };
        lastSyncResult = denied;
        return denied;
      }

      const result: FirebaseSyncResult = {
        ok: true,
        source: 'admin_token',
        usersSynced: fsResult.usersSynced,
        coursesSynced: fsResult.coursesSynced,
        materialsSynced: fsResult.materialsSynced,
        groupsSynced: fsResult.groupsSynced,
        syncedAtMs: Date.now(),
        projectId: cfg.projectId,
        firestoreDatabaseId: cfg.firestoreDatabaseId,
      };
      lastSyncResult = result;
      if (params.force) {
        writeAdminAuditLog({
          adminUid: params.adminUid,
          adminEmail: params.adminEmail,
          action: 'firebase_sync_completed',
          targetType: 'system',
          targetId: 'firebase',
          details: result as unknown as Record<string, unknown>,
        });
      }
      return result;
    }

    const noCreds: FirebaseSyncResult = {
      ok: false,
      source: 'none',
      usersSynced: 0,
      coursesSynced: 0,
      materialsSynced: 0,
      groupsSynced: 0,
      syncedAtMs: Date.now(),
      projectId: cfg.projectId,
      firestoreDatabaseId: cfg.firestoreDatabaseId,
      error: 'No Firebase admin credentials or ID token available for sync.',
    };
    lastSyncResult = noCreds;
    return noCreds;
  } catch (err) {
    const failed: FirebaseSyncResult = {
      ok: false,
      source: 'none',
      usersSynced: 0,
      coursesSynced: 0,
      materialsSynced: 0,
      groupsSynced: 0,
      syncedAtMs: Date.now(),
      projectId: cfg.projectId,
      firestoreDatabaseId: cfg.firestoreDatabaseId,
      error: err instanceof Error ? err.message : 'Firebase sync failed.',
    };
    lastSyncResult = failed;
    return failed;
  }
}

export interface ClientFirestoreSnapshotPayload {
  users?: Array<{
    uid?: string;
    email?: string;
    displayName?: string;
    photoURL?: string;
    createdAtMs?: number;
    updatedAtMs?: number;
  }>;
  courses?: Array<{
    uid?: string;
    courseId?: string;
    code?: string;
    name?: string;
    description?: string;
    isPublic?: boolean;
    shareToken?: string;
    authorName?: string;
    createdAtMs?: number;
    updatedAtMs?: number;
  }>;
  materials?: Array<{
    uid?: string;
    courseId?: string;
    sourceId?: string;
    title?: string;
    materialType?: string;
    pageCount?: number;
    originalFileName?: string;
    contentPreview?: string;
    createdAtMs?: number;
    updatedAtMs?: number;
  }>;
  groups?: Array<{
    id?: string;
    authorUid?: string;
    authorEmail?: string;
    authorName?: string;
    courseId?: string;
    courseCode?: string;
    courseName?: string;
    name?: string;
    description?: string;
    shareToken?: string;
    createdAtMs?: number;
    updatedAtMs?: number;
    members?: Array<{
      uid?: string;
      displayName?: string;
      photoURL?: string;
      joinedAtMs?: number;
    }>;
  }>;
}

/**
 * Imports a live snapshot read by the authenticated admin's Firebase Web SDK
 * into the server's Admin SQLite DB so all Firestore users/courses/materials/groups
 * appear immediately in the Admin Dashboard.
 */
export function importClientFirestoreSnapshot(params: {
  adminUid: string;
  adminEmail: string;
  payload: ClientFirestoreSnapshotPayload;
}): FirebaseSyncResult {
  const db = getDb();
  const cfg = getFirebaseConfig();
  const now = Date.now();
  const touchedUids = new Set<string>();

  let usersSynced = 0;
  let coursesSynced = 0;
  let materialsSynced = 0;
  let groupsSynced = 0;

  const incomingUsers = Array.isArray(params.payload?.users) ? params.payload.users : [];
  for (const u of incomingUsers.slice(0, 5000)) {
    const uid = typeof u?.uid === 'string' ? u.uid.trim().slice(0, 128) : '';
    if (!uid) continue;
    touchedUids.add(uid);

    const email = typeof u.email === 'string' ? u.email.trim().toLowerCase().slice(0, 254) : '';
    const displayName = (
      typeof u.displayName === 'string' && u.displayName.trim()
        ? u.displayName.trim()
        : email.split('@')[0] || 'Student'
    ).slice(0, 120);
    const photoUrl = typeof u.photoURL === 'string' ? u.photoURL.slice(0, 500) : '';
    const createdAtMs =
      typeof u.createdAtMs === 'number' && Number.isFinite(u.createdAtMs) && u.createdAtMs > 0
        ? Math.floor(u.createdAtMs)
        : now;
    const updatedAtMs =
      typeof u.updatedAtMs === 'number' && Number.isFinite(u.updatedAtMs) && u.updatedAtMs > 0
        ? Math.floor(u.updatedAtMs)
        : createdAtMs;

    const existingUser = db
      .prepare('SELECT uid, registered_at_ms FROM users WHERE uid = ?')
      .get(uid) as { uid?: string; registered_at_ms?: number } | undefined;

    if (!existingUser?.uid) {
      db.prepare(
        `INSERT INTO users (
          uid, email, display_name, photo_url, status, registered_at_ms, last_active_at_ms,
          shared_ai_access_override, first_login_notice_seen, has_personal_key,
          courses_count, materials_count, notes, updated_at_ms
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, 'default', 0, 0, 0, 0, '', ?)`
      ).run(uid, email, displayName, photoUrl, createdAtMs, updatedAtMs, now);
    } else {
      const earliestReg = Math.min(Number(existingUser.registered_at_ms || createdAtMs), createdAtMs);
      db.prepare(
        `UPDATE users
         SET email = CASE WHEN ? != '' THEN ? ELSE email END,
             display_name = CASE WHEN ? != '' THEN ? ELSE display_name END,
             photo_url = CASE WHEN ? != '' THEN ? ELSE photo_url END,
             registered_at_ms = ?,
             last_active_at_ms = MAX(last_active_at_ms, ?),
             updated_at_ms = ?
         WHERE uid = ?`
      ).run(email, email, displayName, displayName, photoUrl, photoUrl, earliestReg, updatedAtMs, now, uid);
    }
    usersSynced += 1;
  }

  const incomingCourses = Array.isArray(params.payload?.courses) ? params.payload.courses : [];
  for (const c of incomingCourses.slice(0, 10000)) {
    const uid = typeof c?.uid === 'string' ? c.uid.trim().slice(0, 128) : '';
    const courseId = typeof c?.courseId === 'string' ? c.courseId.trim().slice(0, 128) : '';
    if (!uid || !courseId) continue;
    touchedUids.add(uid);

    const cCreated =
      typeof c.createdAtMs === 'number' && Number.isFinite(c.createdAtMs) && c.createdAtMs > 0
        ? Math.floor(c.createdAtMs)
        : now;
    const cUpdated =
      typeof c.updatedAtMs === 'number' && Number.isFinite(c.updatedAtMs) && c.updatedAtMs > 0
        ? Math.floor(c.updatedAtMs)
        : cCreated;

    db.prepare(
      `INSERT INTO user_courses_mirror (
        uid, course_id, code, name, description, is_public, share_token, author_name,
        materials_count, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(uid, course_id) DO UPDATE SET
        code = excluded.code, name = excluded.name, description = excluded.description,
        is_public = excluded.is_public, share_token = excluded.share_token,
        author_name = excluded.author_name, updated_at_ms = excluded.updated_at_ms`
    ).run(
      uid,
      courseId,
      String(c.code || '').slice(0, 32),
      String(c.name || '').slice(0, 120),
      String(c.description || '').slice(0, 1000),
      c.isPublic ? 1 : 0,
      String(c.shareToken || '').slice(0, 128),
      String(c.authorName || 'Student').slice(0, 120),
      cCreated,
      cUpdated
    );
    coursesSynced += 1;
  }

  const incomingMaterials = Array.isArray(params.payload?.materials) ? params.payload.materials : [];
  for (const m of incomingMaterials.slice(0, 20000)) {
    const uid = typeof m?.uid === 'string' ? m.uid.trim().slice(0, 128) : '';
    const courseId = typeof m?.courseId === 'string' ? m.courseId.trim().slice(0, 128) : '';
    const sourceId = typeof m?.sourceId === 'string' ? m.sourceId.trim().slice(0, 128) : '';
    if (!uid || !courseId || !sourceId) continue;
    touchedUids.add(uid);

    const sCreated =
      typeof m.createdAtMs === 'number' && Number.isFinite(m.createdAtMs) && m.createdAtMs > 0
        ? Math.floor(m.createdAtMs)
        : now;
    const sUpdated =
      typeof m.updatedAtMs === 'number' && Number.isFinite(m.updatedAtMs) && m.updatedAtMs > 0
        ? Math.floor(m.updatedAtMs)
        : sCreated;

    db.prepare(
      `INSERT INTO user_materials_mirror (
        uid, course_id, source_id, title, material_type, page_count,
        original_file_name, content_preview, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid, course_id, source_id) DO UPDATE SET
        title = excluded.title, material_type = excluded.material_type,
        page_count = excluded.page_count, original_file_name = excluded.original_file_name,
        content_preview = excluded.content_preview, updated_at_ms = excluded.updated_at_ms`
    ).run(
      uid,
      courseId,
      sourceId,
      String(m.title || 'Untitled').slice(0, 200),
      String(m.materialType || 'other').slice(0, 40),
      Math.max(0, Math.floor(Number(m.pageCount) || 0)),
      String(m.originalFileName || '').slice(0, 260),
      String(m.contentPreview || '').slice(0, 400),
      sCreated,
      sUpdated
    );
    materialsSynced += 1;
  }

  const incomingGroups = Array.isArray(params.payload?.groups) ? params.payload.groups : [];
  for (const g of incomingGroups.slice(0, 2000)) {
    const groupId = typeof g?.id === 'string' ? g.id.trim().slice(0, 128) : '';
    const authorUid = typeof g?.authorUid === 'string' ? g.authorUid.trim().slice(0, 128) : '';
    const courseId = typeof g?.courseId === 'string' ? g.courseId.trim().slice(0, 128) : '';
    if (!groupId || !authorUid || !courseId) continue;

    const gCreated =
      typeof g.createdAtMs === 'number' && Number.isFinite(g.createdAtMs) && g.createdAtMs > 0
        ? Math.floor(g.createdAtMs)
        : now;
    const gUpdated =
      typeof g.updatedAtMs === 'number' && Number.isFinite(g.updatedAtMs) && g.updatedAtMs > 0
        ? Math.floor(g.updatedAtMs)
        : gCreated;

    const existingGroup = db
      .prepare('SELECT id FROM study_groups WHERE id = ?')
      .get(groupId) as { id?: string } | undefined;

    if (!existingGroup?.id) {
      db.prepare(
        `INSERT INTO study_groups (
          id, author_uid, author_email, author_name, course_id, course_code, course_name,
          name, description, status, share_token, member_count, last_activity_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?, ?)`
      ).run(
        groupId,
        authorUid,
        String(g.authorEmail || '').slice(0, 254),
        String(g.authorName || 'Student').slice(0, 120),
        courseId,
        String(g.courseCode || '').slice(0, 32),
        String(g.courseName || '').slice(0, 120),
        String(g.name || 'Study Group').slice(0, 100),
        String(g.description || '').slice(0, 400),
        String(g.shareToken || '').slice(0, 128),
        gUpdated,
        gCreated,
        gUpdated
      );
      db.prepare(
        `INSERT OR IGNORE INTO group_members (
          group_id, member_uid, display_name, email, photo_url, role, status, joined_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, '', 'owner', 'active', ?, ?)`
      ).run(
        groupId,
        authorUid,
        String(g.authorName || 'Student').slice(0, 120),
        String(g.authorEmail || '').slice(0, 254),
        gCreated,
        now
      );
    }

    for (const m of Array.isArray(g.members) ? g.members.slice(0, 500) : []) {
      const mUid = typeof m?.uid === 'string' ? m.uid.trim().slice(0, 128) : '';
      if (!mUid) continue;
      const mJoined =
        typeof m.joinedAtMs === 'number' && Number.isFinite(m.joinedAtMs) && m.joinedAtMs > 0
          ? Math.floor(m.joinedAtMs)
          : gCreated;
      db.prepare(
        `INSERT OR IGNORE INTO group_members (
          group_id, member_uid, display_name, email, photo_url, role, status, joined_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, '', ?, 'member', 'active', ?, ?)`
      ).run(
        groupId,
        mUid,
        String(m.displayName || 'Student').slice(0, 120),
        String(m.photoURL || '').slice(0, 500),
        mJoined,
        now
      );
    }

    const cntRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = ? AND status = 'active'")
      .get(groupId) as { cnt?: number };
    db.prepare('UPDATE study_groups SET member_count = ? WHERE id = ?').run(
      Math.max(1, Number(cntRow?.cnt ?? 1)),
      groupId
    );
    groupsSynced += 1;
  }

  for (const uid of touchedUids) {
    const cCount = db
      .prepare('SELECT COUNT(*) AS cnt FROM user_courses_mirror WHERE uid = ?')
      .get(uid) as { cnt?: number };
    const mCount = db
      .prepare("SELECT COUNT(*) AS cnt FROM user_materials_mirror WHERE uid = ? AND status != 'deleted'")
      .get(uid) as { cnt?: number };
    db.prepare(
      'UPDATE users SET courses_count = ?, materials_count = ?, updated_at_ms = ? WHERE uid = ?'
    ).run(Number(cCount?.cnt ?? 0), Number(mCount?.cnt ?? 0), now, uid);
  }

  const result: FirebaseSyncResult = {
    ok: true,
    source: 'client_sdk',
    usersSynced,
    coursesSynced,
    materialsSynced,
    groupsSynced,
    syncedAtMs: Date.now(),
    projectId: cfg.projectId,
    firestoreDatabaseId: cfg.firestoreDatabaseId,
  };
  lastSyncResult = result;
  lastAutoSyncMs = Date.now();

  writeAdminAuditLog({
    adminUid: params.adminUid,
    adminEmail: params.adminEmail,
    action: 'firebase_client_snapshot_imported',
    targetType: 'system',
    targetId: 'firebase',
    details: result as unknown as Record<string, unknown>,
  });

  return result;
}
