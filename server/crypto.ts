import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

let cachedMasterKey: Buffer | null = null;
let cachedMasterKeyPath: string | null = null;

function resolveMasterKeyPath(): string {
  if (process.env.ADMIN_KEY_FILE && process.env.ADMIN_KEY_FILE.trim()) {
    return path.resolve(process.env.ADMIN_KEY_FILE.trim());
  }
  const dbPath = process.env.ADMIN_DB_PATH?.trim();
  if (dbPath && dbPath !== ':memory:') {
    return path.join(path.dirname(path.resolve(dbPath)), '.master.key');
  }
  return path.resolve(process.cwd(), 'data', '.master.key');
}

function getMasterKey(): Buffer {
  const envSecret = (process.env.ADMIN_ENCRYPTION_KEY || '').trim();
  if (envSecret.length > 0) {
    if (cachedMasterKey && cachedMasterKeyPath === `env:${envSecret.length}`) {
      return cachedMasterKey;
    }
    cachedMasterKey = crypto.scryptSync(envSecret, 'sotal-study-admin-keys-v1', KEY_LENGTH);
    cachedMasterKeyPath = `env:${envSecret.length}`;
    return cachedMasterKey;
  }

  const keyFile = resolveMasterKeyPath();
  if (cachedMasterKey && cachedMasterKeyPath === keyFile) {
    return cachedMasterKey;
  }

  try {
    if (fs.existsSync(keyFile)) {
      const hex = fs.readFileSync(keyFile, 'utf8').trim();
      if (/^[0-9a-fA-F]{64}$/.test(hex)) {
        cachedMasterKey = Buffer.from(hex, 'hex');
        cachedMasterKeyPath = keyFile;
        return cachedMasterKey;
      }
    }
  } catch {
    // Fall through to generate a new key
  }

  const generated = crypto.randomBytes(KEY_LENGTH);
  try {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, generated.toString('hex'), { mode: 0o600 });
  } catch {
    // In-memory fallback if filesystem is read-only (e.g. restricted container)
  }
  cachedMasterKey = generated;
  cachedMasterKeyPath = keyFile;
  return generated;
}

export function isEnvEncryptionKeyConfigured(): boolean {
  return (process.env.ADMIN_ENCRYPTION_KEY || '').trim().length > 0;
}

export function resetCachedMasterKey(): void {
  cachedMasterKey = null;
  cachedMasterKeyPath = null;
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptSecret(plaintext: string): EncryptedPayload {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptSecret(payload: EncryptedPayload): string {
  const key = getMasterKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

/**
 * Strips any API-key-like tokens or known secret substrings from error strings
 * before returning them to clients or persisting them to logs/analytics.
 */
export function sanitizeErrorMessage(message: string, knownSecrets: string[] = []): string {
  let out = String(message || '').slice(0, 500);
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 8) {
      out = out.split(secret).join('[REDACTED_KEY]');
    }
  }
  // Redact common API key prefixes (Google AIza, OpenRouter sk-or-, Groq gsk_, NVIDIA nvapi-, generic sk-)
  out = out
    .replace(/\bAIza[0-9A-Za-z_-]{16,}\b/g, '[REDACTED_KEY]')
    .replace(/\bsk-or-[0-9A-Za-z_-]{12,}\b/g, '[REDACTED_KEY]')
    .replace(/\bgsk_[0-9A-Za-z_-]{12,}\b/g, '[REDACTED_KEY]')
    .replace(/\bnvapi-[0-9A-Za-z_-]{12,}\b/g, '[REDACTED_KEY]')
    .replace(/\bcsk-[0-9A-Za-z_-]{12,}\b/g, '[REDACTED_KEY]')
    .replace(/\bsk-[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[0-9A-Za-z._-]{16,}/gi, 'Bearer [REDACTED]');
  return out;
}
