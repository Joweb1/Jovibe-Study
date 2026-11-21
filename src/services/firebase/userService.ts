import type { User } from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
  type UserProfile,
} from '../../types/models';
import {
  isValidId,
  sanitizeBoundedString,
  SCHEMA_LIMITS,
} from '../../utils/validation';
import { db } from './config';
import { handleFirestoreError, OperationType } from './errors';

const CACHED_PROFILE_PREFIX = 'sotal_cached_profile_v1:';

function readCachedLocalProfile(userId: string): UserProfile | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = window.localStorage.getItem(`${CACHED_PROFILE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    if (!parsed || parsed.userId !== userId) return null;
    return {
      userId,
      displayName: parsed.displayName || 'Student',
      email: parsed.email || '',
      photoURL: parsed.photoURL || '',
      activeCourseId: parsed.activeCourseId || '',
      preferences: {
        ...DEFAULT_USER_PREFERENCES,
        ...(parsed.preferences || {}),
      },
      createdAt: parsed.createdAt ?? null,
      updatedAt: parsed.updatedAt ?? null,
    };
  } catch {
    return null;
  }
}

function writeCachedLocalProfile(profile: UserProfile): void {
  if (typeof window === 'undefined' || !profile.userId) return;
  try {
    window.localStorage.setItem(
      `${CACHED_PROFILE_PREFIX}${profile.userId}`,
      JSON.stringify({
        userId: profile.userId,
        displayName: profile.displayName,
        email: profile.email,
        photoURL: profile.photoURL,
        activeCourseId: profile.activeCourseId,
        preferences: profile.preferences,
      })
    );
  } catch {
    // Ignore storage quota issues
  }
}

function buildFallbackProfile(user: User): UserProfile {
  const cached = readCachedLocalProfile(user.uid);
  if (cached) return cached;

  return {
    userId: user.uid,
    displayName: sanitizeBoundedString(
      user.displayName || user.email?.split('@')[0] || 'Student',
      SCHEMA_LIMITS.DISPLAY_NAME_MAX
    ),
    email: sanitizeBoundedString(user.email || '', SCHEMA_LIMITS.EMAIL_MAX),
    photoURL: sanitizeBoundedString(user.photoURL || '', SCHEMA_LIMITS.PHOTO_URL_MAX),
    activeCourseId: '',
    preferences: { ...DEFAULT_USER_PREFERENCES },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function isOfflineReadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('failed to get document because the client is offline') ||
    msg.includes('network')
  );
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (isBrowserOffline) {
    try {
      const cachedSnap = await getDocFromCache(ref);
      if (cachedSnap.exists()) {
        const data = cachedSnap.data() as UserProfile;
        const normalized: UserProfile = {
          ...data,
          preferences: {
            ...DEFAULT_USER_PREFERENCES,
            ...(data.preferences || {}),
          },
        };
        writeCachedLocalProfile(normalized);
        return normalized;
      }
    } catch {
      // Fall through to localStorage / Firebase Auth user fallback
    }
    return buildFallbackProfile(user);
  }

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as UserProfile;
      const normalized: UserProfile = {
        ...data,
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          ...(data.preferences || {}),
        },
      };
      writeCachedLocalProfile(normalized);
      return normalized;
    }
  } catch (error) {
    if (isOfflineReadError(error)) {
      return buildFallbackProfile(user);
    }
    handleFirestoreError(error, OperationType.GET, path);
  }

  const displayName = sanitizeBoundedString(
    user.displayName || user.email?.split('@')[0] || 'Student',
    SCHEMA_LIMITS.DISPLAY_NAME_MAX
  );
  const email = sanitizeBoundedString(user.email || '', SCHEMA_LIMITS.EMAIL_MAX);
  const photoURL = sanitizeBoundedString(user.photoURL || '', SCHEMA_LIMITS.PHOTO_URL_MAX);

  const newProfilePayload = {
    userId: user.uid,
    displayName,
    email,
    photoURL,
    activeCourseId: '',
    preferences: { ...DEFAULT_USER_PREFERENCES },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, newProfilePayload);
  } catch (error) {
    if (isOfflineReadError(error)) {
      return buildFallbackProfile(user);
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  const created: UserProfile = {
    userId: user.uid,
    displayName,
    email,
    photoURL,
    activeCourseId: '',
    preferences: { ...DEFAULT_USER_PREFERENCES },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  writeCachedLocalProfile(created);
  return created;
}

export function subscribeUserProfile(
  userId: string,
  onData: (profile: UserProfile | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}`;
  const ref = doc(db, 'users', userId);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data() as UserProfile;
      const normalized: UserProfile = {
        ...data,
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          ...(data.preferences || {}),
        },
      };
      writeCachedLocalProfile(normalized);
      onData(normalized);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function updateActiveCourseId(userId: string, courseId: string): Promise<void> {
  if (courseId !== '' && !isValidId(courseId)) {
    throw new Error('Invalid course identifier.');
  }
  const existing = readCachedLocalProfile(userId);
  if (existing) {
    writeCachedLocalProfile({ ...existing, activeCourseId: courseId });
  }
  const path = `users/${userId}`;
  const ref = doc(db, 'users', userId);
  try {
    await updateDoc(ref, {
      activeCourseId: courseId,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

const VALID_TTS_VOICES = new Set(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr']);

export async function updateUserPreferences(
  userId: string,
  preferences: UserPreferences
): Promise<void> {
  const ttsVoice = VALID_TTS_VOICES.has(preferences.ttsVoice)
    ? preferences.ttsVoice
    : DEFAULT_USER_PREFERENCES.ttsVoice;

  const sanitized: UserPreferences = {
    defaultModel: sanitizeBoundedString(
      preferences.defaultModel || DEFAULT_USER_PREFERENCES.defaultModel,
      SCHEMA_LIMITS.MODEL_NAME_MAX
    ),
    tutorSourceMode: preferences.tutorSourceMode,
    voiceEnabled: Boolean(preferences.voiceEnabled),
    voiceRate: Math.min(2.0, Math.max(0.5, Number(preferences.voiceRate) || 1.0)),
    ttsVoice,
    defaultDifficulty: preferences.defaultDifficulty,
  };

  const existing = readCachedLocalProfile(userId);
  if (existing) {
    writeCachedLocalProfile({ ...existing, preferences: sanitized });
  }

  const path = `users/${userId}`;
  const ref = doc(db, 'users', userId);
  try {
    await updateDoc(ref, {
      preferences: sanitized,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
