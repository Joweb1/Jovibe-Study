import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
  justReconnected: boolean;
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
  const [justReconnected, setJustReconnected] = useState(false);
  const wasOfflineRef = useRef(!isOnline);

  useEffect(() => {
    let reconnectTimer: number | null = null;

    const handleOnline = () => {
      setIsOnline(true);
      if (wasOfflineRef.current) {
        setJustReconnected(true);
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(() => {
          setJustReconnected(false);
        }, 3800);
      }
      wasOfflineRef.current = false;
    };

    const handleOffline = () => {
      wasOfflineRef.current = true;
      setIsOnline(false);
      setJustReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
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
            if (typeof navigator === 'undefined' || navigator.onLine) {
              setAuthError(formatReadableError(err));
            }
          }
        );
      } catch (err) {
        if (typeof navigator === 'undefined' || navigator.onLine) {
          setAuthError(formatReadableError(err));
        }
      } finally {
        setAuthReady(true);
      }
    });

    return () => {
      authUnsub();
      if (profileUnsub) profileUnsub();
    };
  }, []);

  // Re-ensure profile cleanly only when returning online after booting/going offline
  useEffect(() => {
    if (!isOnline || !justReconnected || !user) return;
    void ensureUserProfile(user)
      .then((ensured) => setProfile(ensured))
      .catch(() => {
        // Non-fatal background sync retry
      });
  }, [isOnline, justReconnected, user]);

  const signInWithGoogle = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setAuthError("You're offline. Turn on your internet connection to sign in with Google.");
      return;
    }
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
        justReconnected,
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
