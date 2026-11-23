import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from './AuthContext';
import { useCourses } from './CourseContext';
import { apiFetchJson, subscribeQuotaSnapshot } from '../services/api/authHeaders';
import { hasUserEnteredOwnKey, listAllStoredApiKeys } from '../services/ai/keyManager';
import { timestampToMillis } from '../utils/validation';

export interface PlatformFeatureFlags {
  aiGlobalEnabled: boolean;
  features: {
    tutor: boolean;
    practice_cbt: boolean;
    practice_flashcards: boolean;
    practice_fill_gap: boolean;
    practice_exam_prep: boolean;
    automatic_study: boolean;
    live_voice_ai: boolean;
    vision_ocr: boolean;
    tts: boolean;
    transcription: boolean;
    image_generation: boolean;
  };
}

export interface PlatformAccessStatus {
  isAdmin: boolean;
  uid: string;
  email: string;
  displayName: string;
  accountStatus: 'active' | 'suspended' | 'deleted';
  registeredAtMs: number;
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
  hasPersonalKey: boolean;
  featureFlags: PlatformFeatureFlags;
}

interface PlatformAccessContextValue {
  status: PlatformAccessStatus | null;
  loading: boolean;
  isAdmin: boolean;
  usingPersonalKey: boolean;
  refreshAccessStatus: () => Promise<void>;
  acknowledgeFreeAccessNotice: () => Promise<void>;
  syncMaterialsMetadata: (
    courseId: string,
    materials: Array<{
      sourceId: string;
      title: string;
      materialType: string;
      pageCount?: number;
      originalFileName?: string;
      contentPreview?: string;
      createdAtMs?: number;
      updatedAtMs?: number;
    }>
  ) => Promise<void>;
  syncGroupsMetadata: (
    groups: Array<{
      id: string;
      courseId: string;
      courseCode?: string;
      courseName?: string;
      name: string;
      description?: string;
      shareToken?: string;
      authorUid?: string;
      authorName?: string;
      members?: Array<{
        uid: string;
        displayName?: string;
        email?: string;
        photoURL?: string;
        joinedAtMs?: number;
      }>;
      createdAtMs?: number;
    }>
  ) => Promise<void>;
  trackActivity: (payload: {
    eventType: string;
    feature?: string;
    courseId?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
}

const PlatformAccessContext = createContext<PlatformAccessContextValue | null>(null);

export const PlatformAccessProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, isOnline } = useAuth();
  const { ownedCourses } = useCourses();

  const [status, setStatus] = useState<PlatformAccessStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [usingPersonalKey, setUsingPersonalKey] = useState<boolean>(
    () => hasUserEnteredOwnKey() || listAllStoredApiKeys().length > 0
  );

  const lastCourseSyncHashRef = useRef<string>('');

  const refreshAccessStatus = useCallback(async () => {
    if (!user || !isOnline) return;
    setLoading(true);
    try {
      const data = await apiFetchJson<PlatformAccessStatus>('/api/me/access-status');
      setStatus(data);
    } catch {
      // Non-fatal while offline or server restarting
    } finally {
      setLoading(false);
    }
  }, [user, isOnline]);

  // Refresh personal-key flag whenever localStorage changes or window focuses
  useEffect(() => {
    const syncLocalKeyFlag = () => {
      setUsingPersonalKey(hasUserEnteredOwnKey() || listAllStoredApiKeys().length > 0);
    };
    syncLocalKeyFlag();
    window.addEventListener('storage', syncLocalKeyFlag);
    window.addEventListener('focus', syncLocalKeyFlag);
    return () => {
      window.removeEventListener('storage', syncLocalKeyFlag);
      window.removeEventListener('focus', syncLocalKeyFlag);
    };
  }, [user?.uid]);

  // Fetch authoritative access status on login / reconnect
  useEffect(() => {
    if (!user) {
      setStatus(null);
      lastCourseSyncHashRef.current = '';
      return;
    }
    void refreshAccessStatus();
  }, [user?.uid, isOnline, refreshAccessStatus]);

  // Live update quota progress immediately from AI response headers
  useEffect(() => {
    return subscribeQuotaSnapshot((snap) => {
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              quota: {
                ...prev.quota,
                used: snap.used,
                limit: snap.limit,
                remaining: snap.remaining,
                resetAtIso: snap.resetAtIso || prev.quota.resetAtIso,
              },
            }
          : prev
      );
    });
  }, []);

  // Sync user's onboarding timestamp, personal-key flag, and owned courses into server DB
  useEffect(() => {
    if (!user || !isOnline) return;
    const createdAtMs = profile?.createdAt ? timestampToMillis(profile.createdAt) : undefined;
    const hasPersonal = hasUserEnteredOwnKey() || listAllStoredApiKeys().length > 0;
    setUsingPersonalKey(hasPersonal);

    const coursePayload = ownedCourses.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      isPublic: Boolean(c.isPublic),
      shareToken: c.shareToken || '',
      authorName: c.authorName || profile?.displayName || user.displayName || '',
      isOwner: true,
      createdAtMs: c.createdAt ? timestampToMillis(c.createdAt) : undefined,
      updatedAtMs: c.updatedAt ? timestampToMillis(c.updatedAt) : undefined,
    }));

    const hash = `${user.uid}:${hasPersonal}:${coursePayload.map((c) => `${c.id}:${c.code}:${c.isPublic}`).join('|')}`;
    if (hash === lastCourseSyncHashRef.current) return;
    lastCourseSyncHashRef.current = hash;

    void apiFetchJson('/api/me/sync', {
      method: 'POST',
      body: {
        createdAtMs: createdAtMs && createdAtMs > 0 ? createdAtMs : undefined,
        hasPersonalKey: hasPersonal,
        courses: coursePayload,
      },
    })
      .then(() => refreshAccessStatus())
      .catch(() => {
        // Non-fatal background sync
      });
  }, [user, profile?.createdAt, profile?.displayName, ownedCourses, isOnline, refreshAccessStatus]);

  const acknowledgeFreeAccessNotice = useCallback(async () => {
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            freeAccess: {
              ...prev.freeAccess,
              firstLoginNoticeSeen: true,
            },
          }
        : prev
    );
    try {
      await apiFetchJson('/api/me/acknowledge-free-access-notice', { method: 'POST' });
    } catch {
      // Ignore network hiccup; local state already dismissed
    }
  }, []);

  const syncMaterialsMetadata = useCallback(
    async (
      courseId: string,
      materials: Array<{
        sourceId: string;
        title: string;
        materialType: string;
        pageCount?: number;
        originalFileName?: string;
        contentPreview?: string;
        createdAtMs?: number;
        updatedAtMs?: number;
      }>
    ) => {
      if (!user || !isOnline || materials.length === 0) return;
      try {
        await apiFetchJson('/api/me/sync', {
          method: 'POST',
          body: {
            materials: materials.map((m) => ({ ...m, courseId })),
          },
        });
      } catch {
        // Non-fatal background sync
      }
    },
    [user, isOnline]
  );

  const syncGroupsMetadata = useCallback(
    async (
      groups: Array<{
        id: string;
        courseId: string;
        courseCode?: string;
        courseName?: string;
        name: string;
        description?: string;
        shareToken?: string;
        authorUid?: string;
        authorName?: string;
        members?: Array<{
          uid: string;
          displayName?: string;
          email?: string;
          photoURL?: string;
          joinedAtMs?: number;
        }>;
        createdAtMs?: number;
      }>
    ) => {
      if (!user || !isOnline || groups.length === 0) return;
      try {
        await apiFetchJson('/api/me/sync', {
          method: 'POST',
          body: { groups },
        });
      } catch {
        // Non-fatal background sync
      }
    },
    [user, isOnline]
  );

  const trackActivity = useCallback(
    async (payload: {
      eventType: string;
      feature?: string;
      courseId?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    }) => {
      if (!user || !isOnline) return;
      try {
        await apiFetchJson('/api/me/activity', { method: 'POST', body: payload });
      } catch {
        // Non-fatal telemetry
      }
    },
    [user, isOnline]
  );

  const value = useMemo<PlatformAccessContextValue>(
    () => ({
      status,
      loading,
      isAdmin: Boolean(status?.isAdmin),
      usingPersonalKey,
      refreshAccessStatus,
      acknowledgeFreeAccessNotice,
      syncMaterialsMetadata,
      syncGroupsMetadata,
      trackActivity,
    }),
    [
      status,
      loading,
      usingPersonalKey,
      refreshAccessStatus,
      acknowledgeFreeAccessNotice,
      syncMaterialsMetadata,
      syncGroupsMetadata,
      trackActivity,
    ]
  );

  return (
    <PlatformAccessContext.Provider value={value}>{children}</PlatformAccessContext.Provider>
  );
};

export function usePlatformAccess(): PlatformAccessContextValue {
  const ctx = useContext(PlatformAccessContext);
  if (!ctx) {
    throw new Error('usePlatformAccess must be used within PlatformAccessProvider');
  }
  return ctx;
}
