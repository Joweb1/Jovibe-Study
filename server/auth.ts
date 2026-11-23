import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from './db.ts';

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export interface VerifiedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  photoURL: string;
  isAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: VerifiedUser;
    }
  }
}

let cachedProjectId: { value: string; mtimeMs: number } | null = null;

export function getFirebaseProjectId(): string {
  const fromEnv = (process.env.FIREBASE_PROJECT_ID || '').trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const stat = fs.statSync(configPath);
    if (cachedProjectId && cachedProjectId.mtimeMs === stat.mtimeMs) {
      return cachedProjectId.value;
    }
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
    if (raw.projectId) {
      cachedProjectId = { value: raw.projectId, mtimeMs: stat.mtimeMs };
      return raw.projectId;
    }
  } catch {
    // Fallback below
  }
  return 'sotal-study';
}

export function getConfiguredAdminEmail(): string {
  return (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
}

export function isAdminEmail(email: string, emailVerified: boolean): boolean {
  const adminEmail = getConfiguredAdminEmail();
  if (!adminEmail) return false;
  if (!emailVerified) return false;
  return email.trim().toLowerCase() === adminEmail;
}

// ---------------------------------------------------------------------------
// Google Public X.509 Cert Cache for Firebase ID Token Verification
// ---------------------------------------------------------------------------

let certsCache: { certs: Record<string, string>; expiresAtMs: number } | null = null;

async function fetchGoogleCerts(force = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!force && certsCache && certsCache.expiresAtMs > now) {
    return certsCache.certs;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase signing certificates (HTTP ${res.status}).`);
  }
  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSeconds = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) : 3600;
  certsCache = {
    certs,
    expiresAtMs: now + maxAgeSeconds * 1000,
  };
  return certs;
}

function base64UrlDecode(segment: string): Buffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

type TestTokenVerifier = (token: string) => Promise<VerifiedUser | null>;
let testTokenVerifier: TestTokenVerifier | null = null;

/** Test-only hook (strictly ignored outside NODE_ENV=test). */
export function setTestTokenVerifier(fn: TestTokenVerifier | null): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setTestTokenVerifier is only allowed when NODE_ENV=test');
  }
  testTokenVerifier = fn;
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedUser> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('Missing authentication token.');
  }

  if (process.env.NODE_ENV === 'test' && testTokenVerifier) {
    const mocked = await testTokenVerifier(trimmed);
    if (!mocked) {
      throw new Error('Invalid test authentication token.');
    }
    return {
      ...mocked,
      isAdmin: isAdminEmail(mocked.email, mocked.emailVerified),
    };
  }

  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: string; kid?: string };
  let payload: {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };

  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new Error('Failed to decode Firebase ID token.');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported Firebase ID token algorithm.');
  }

  const projectId = getFirebaseProjectId();
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const nowSec = Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId) {
    throw new Error('Invalid token audience.');
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error('Invalid token issuer.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new Error('Invalid token subject.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Authentication token has expired. Please refresh your session.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Invalid token issued-at timestamp.');
  }

  let certs = await fetchGoogleCerts(false);
  let pem = certs[header.kid];
  if (!pem) {
    certs = await fetchGoogleCerts(true);
    pem = certs[header.kid];
  }
  if (!pem) {
    throw new Error('Unknown Firebase token signing key.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const signature = base64UrlDecode(sigB64);
  if (!verifier.verify(pem, signature)) {
    throw new Error('Invalid Firebase ID token signature.');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const emailVerified = Boolean(payload.email_verified);
  const displayName =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim().slice(0, 120)
      : email.split('@')[0] || 'Student';
  const photoURL = typeof payload.picture === 'string' ? payload.picture.slice(0, 500) : '';

  return {
    uid: payload.sub,
    email,
    emailVerified,
    displayName,
    photoURL,
    isAdmin: isAdminEmail(email, emailVerified),
  };
}

export function extractBearerToken(req: Request): string {
  const authHeader = req.headers.authorization;
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (typeof raw === 'string' && raw.toLowerCase().startsWith('bearer ')) {
    return raw.slice(7).trim();
  }
  const alt = req.headers['x-sotal-id-token'];
  const altRaw = Array.isArray(alt) ? alt[0] : alt;
  if (typeof altRaw === 'string' && altRaw.trim()) {
    return altRaw.trim();
  }
  return '';
}

export function upsertUserFromAuth(
  user: VerifiedUser,
  clientCreatedAtMs?: number
): {
  uid: string;
  email: string;
  display_name: string;
  photo_url: string;
  status: 'active' | 'suspended' | 'deleted';
  registered_at_ms: number;
  last_active_at_ms: number;
  free_access_days_override: number | null;
  free_access_expires_at_ms: number | null;
  daily_quota_override: number | null;
  shared_ai_access_override: 'default' | 'force_allow' | 'force_block';
  first_login_notice_seen: number;
  has_personal_key: number;
  courses_count: number;
  materials_count: number;
  notes: string;
} {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare('SELECT * FROM users WHERE uid = ?')
    .get(user.uid) as Record<string, unknown> | undefined;

  if (!existing) {
    // Only trust an earlier clientCreatedAtMs if it's a valid historical timestamp (not in the future, not older than 2024)
    const minValidTs = Date.UTC(2024, 0, 1);
    const registeredAtMs =
      typeof clientCreatedAtMs === 'number' &&
      Number.isFinite(clientCreatedAtMs) &&
      clientCreatedAtMs >= minValidTs &&
      clientCreatedAtMs <= now
        ? Math.floor(clientCreatedAtMs)
        : now;

    db.prepare(
      `INSERT INTO users (
        uid, email, display_name, photo_url, status, registered_at_ms, last_active_at_ms,
        shared_ai_access_override, first_login_notice_seen, has_personal_key,
        courses_count, materials_count, notes, updated_at_ms
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, 'default', 0, 0, 0, 0, '', ?)`
    ).run(
      user.uid,
      user.email,
      user.displayName,
      user.photoURL,
      registeredAtMs,
      now,
      now
    );

    return db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as never;
  }

  // Update metadata and last_active_at_ms (never overwrite registered_at_ms or status!)
  db.prepare(
    `UPDATE users
     SET email = CASE WHEN ? != '' THEN ? ELSE email END,
         display_name = CASE WHEN ? != '' THEN ? ELSE display_name END,
         photo_url = CASE WHEN ? != '' THEN ? ELSE photo_url END,
         last_active_at_ms = ?,
         updated_at_ms = ?
     WHERE uid = ?`
  ).run(
    user.email,
    user.email,
    user.displayName,
    user.displayName,
    user.photoURL,
    user.photoURL,
    now,
    now,
    user.uid
  );

  return db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as never;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'Authentication required. Please sign in to SOTAL Study.',
      code: 'UNAUTHENTICATED',
      retryable: false,
      shouldRotateKey: false,
      cooldownMs: 0,
    });
    return;
  }

  try {
    const verified = await verifyFirebaseIdToken(token);
    req.authUser = verified;
    upsertUserFromAuth(verified);
    next();
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid or expired authentication token.',
      code: 'UNAUTHENTICATED',
      retryable: false,
      shouldRotateKey: false,
      cooldownMs: 0,
    });
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'Authentication required.',
      code: 'UNAUTHENTICATED',
    });
    return;
  }

  try {
    const verified = await verifyFirebaseIdToken(token);
    req.authUser = verified;
    upsertUserFromAuth(verified);

    if (!verified.isAdmin) {
      res.status(403).json({
        error: 'Admin access is restricted to the sole configured administrator account.',
        code: 'ADMIN_FORBIDDEN',
      });
      return;
    }

    next();
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid or expired authentication token.',
      code: 'UNAUTHENTICATED',
    });
  }
}
