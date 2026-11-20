import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import type { UserPreferences, UserProfile } from '../types/models';
import { auth, googleProvider } from '../services/firebase/config';
import { formatReadableError } from '../services/firebase/errors';
import {
  ensureUserProfile,
  subscribeUserProfile,
  updateActiveCourseId,
  updateUserPreferences,
} from '../services/firebase/userService';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  authReady: boolean;
  isOnline: boolean;
  authError: string | null;
  signingIn: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  clearAuthError: () => void;
  savePreferences: (prefs: UserPreferences) => Promise<void>;
  persistActiveCourseId: (courseId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let profileUnsub: (() => void) | null = null;

    const authUnsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (profileUnsub) {
        profileUnsub();
        profileUnsub = null;
      }

      setUser(firebaseUser);

      if (!firebaseUser) {
        setProfile(null);
        setAuthReady(true);
        return;
      }

      try {
        const ensured = await ensureUserProfile(firebaseUser);
        setProfile(ensured);
        setAuthError(null);

        profileUnsub = subscribeUserProfile(
          firebaseUser.uid,
          (updatedProfile) => {
            if (updatedProfile) {
              setProfile(updatedProfile);
            }
          },
          (err) => {
            setAuthError(formatReadableError(err));
          }
        );
      } catch (err) {
        setAuthError(formatReadableError(err));
      } finally {
        setAuthReady(true);
      }
    });

    return () => {
      authUnsub();
      if (profileUnsub) profileUnsub();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/courses');
      }
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(formatReadableError(err));
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthError(null);
    try {
      await firebaseSignOut(auth);
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/courses');
      }
    } catch (err) {
      setAuthError(formatReadableError(err));
    }
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const savePreferences = useCallback(
    async (prefs: UserPreferences) => {
      if (!user) return;
      await updateUserPreferences(user.uid, prefs);
    },
    [user]
  );

  const persistActiveCourseId = useCallback(
    async (courseId: string) => {
      if (!user) return;
      await updateActiveCourseId(user.uid, courseId);
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authReady,
        isOnline,
        authError,
        signingIn,
        signInWithGoogle,
        signOut,
        clearAuthError,
        savePreferences,
        persistActiveCourseId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
