import type { User } from 'firebase/auth';
import {
  doc,
  getDoc,
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

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as UserProfile;
      return {
        ...data,
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          ...(data.preferences || {}),
        },
      };
    }
  } catch (error) {
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
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    userId: user.uid,
    displayName,
    email,
    photoURL,
    activeCourseId: '',
    preferences: { ...DEFAULT_USER_PREFERENCES },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
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
      onData({
        ...data,
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          ...(data.preferences || {}),
        },
      });
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
