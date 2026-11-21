import type { FirestoreTimestamp } from '../types/models';

/**
 * Volumetric & structural constraints synchronized verbatim with firebase-blueprint.json
 * and firestore.rules so outgoing mutations always adhere to schema bounds.
 */
export const SCHEMA_LIMITS = {
  ID_MAX_LENGTH: 128,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  DISPLAY_NAME_MAX: 120,
  EMAIL_MAX: 254,
  PHOTO_URL_MAX: 500,
  COURSE_CODE_MAX: 32,
  COURSE_NAME_MAX: 120,
  COURSE_DESC_MAX: 1000,
  TOPIC_NAME_MAX: 120,
  TOPIC_DESC_MAX: 600,
  GROUP_NAME_MAX: 80,
  GROUP_DESC_MAX: 300,
  SOURCE_TITLE_MAX: 200,
  SOURCE_CONTENT_MAX: 450000,
  SOURCE_NOTES_MAX: 20000,
  MODEL_NAME_MAX: 80,
} as const;

export function isValidId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= SCHEMA_LIMITS.ID_MAX_LENGTH &&
    SCHEMA_LIMITS.ID_PATTERN.test(id)
  );
}

/**
 * Generates a URL-safe, Firestore-rule-compliant document ID matching ^[a-zA-Z0-9_-]+$.
 */
export function generateDocumentId(prefix: string): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'doc';
  const timePart = Date.now().toString(36);
  const randomBytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < randomBytes.length; i += 1) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const randPart = Array.from(randomBytes, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 12);
  return `${cleanPrefix}_${timePart}_${randPart}`;
}

export function sanitizeBoundedString(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function validateCourseInput(input: {
  code: string;
  name: string;
  description: string;
}): { valid: boolean; error?: string; sanitized: { code: string; name: string; description: string } } {
  const code = sanitizeBoundedString(input.code, SCHEMA_LIMITS.COURSE_CODE_MAX);
  const name = sanitizeBoundedString(input.name, SCHEMA_LIMITS.COURSE_NAME_MAX);
  const description = sanitizeBoundedString(input.description, SCHEMA_LIMITS.COURSE_DESC_MAX);

  if (!code) {
    return { valid: false, error: 'Course code is required (e.g., BUS 115, CS 101).', sanitized: { code, name, description } };
  }
  if (!name) {
    return { valid: false, error: 'Course name is required.', sanitized: { code, name, description } };
  }

  return { valid: true, sanitized: { code, name, description } };
}

export function validateTopicInput(input: {
  name: string;
  description: string;
}): { valid: boolean; error?: string; sanitized: { name: string; description: string } } {
  const name = sanitizeBoundedString(input.name, SCHEMA_LIMITS.TOPIC_NAME_MAX);
  const description = sanitizeBoundedString(input.description, SCHEMA_LIMITS.TOPIC_DESC_MAX);

  if (!name) {
    return { valid: false, error: 'Topic name is required.', sanitized: { name, description } };
  }

  return { valid: true, sanitized: { name, description } };
}

export function timestampToMillis(ts: FirestoreTimestamp | null | undefined): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'object' && 'toMillis' in ts && typeof ts.toMillis === 'function') {
    return ts.toMillis();
  }
  return 0;
}

export function formatShortDate(ts: FirestoreTimestamp | null | undefined): string {
  const ms = timestampToMillis(ts);
  if (!ms) return 'Just now';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}
