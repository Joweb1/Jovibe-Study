import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AppUsageDailyRecord,
  AppUsageSummary,
  DailyStreakRecord,
  StreakProfile,
  StudyActivityEvent,
  StudyActivityType,
} from '../types/models';
import { useAuth } from './AuthContext';
import { auth } from '../services/firebase/config';
import { getLocalDateKey } from '../services/streak/streakEngine';
import {
  claimTodayStreakTransaction,
  ensureAndReconcileStreak,
  flushAppTimeSeconds,
  recordQualifyingLearningActivity,
  subscribeAppUsageDays,
  subscribeAppUsageSummary,
  subscribeStreakDays,
  subscribeStreakProfile,
  subscribeStudyActivities,
} from '../services/firebase/streakService';
import { StreakClaimModal } from '../components/streak/StreakClaimModal';

export interface RecordLearningActivityInput {
  activityType: StudyActivityType;
  title: string;
  courseId?: string;
  courseCode?: string;
  isSharedCourse?: boolean;
  durationSeconds?: number;
  score?: number | null;
  maxScore?: number | null;
  summary?: string;
}

interface StreakContextValue {
  /** Current local calendar date key (YYYY-MM-DD), updates automatically across midnight */
  todayKey: string;
  /** Committed current streak count */
  currentStreak: number;
  longestStreak: number;
  totalStudyDays: number;
  lastQualifyingDate: string;
  accountCreatedDate: string;
  /** True when user has completed a qualifying activity today and already claimed it */
  studiedToday: boolean;
  /** True when user qualified today and has an unclaimed streak ready to claim */
  hasPendingClaimToday: boolean;
  pendingStreakCount: number;
  streakLoading: boolean;
  streakDays: Record<string, DailyStreakRecord>;
  studyActivities: StudyActivityEvent[];
  activitiesLoading: boolean;
  /** Honest foreground "Time in app" metrics (live ticking) */
  todayAppSeconds: number;
  totalAppSeconds: number;
  /** Separate "Active learning time" measured from completed study/practice/tutor sessions */
  todayActiveLearningSeconds: number;
  totalActiveLearningSeconds: number;
  appUsageDays: Record<string, AppUsageDailyRecord>;
  /** Records a genuine completed learning activity & evaluates daily streak qualification */
  recordLearningActivity: (input: RecordLearningActivityInput) => Promise<void>;
  /** Opens the Streak Claim modal manually if there is an unclaimed streak today */
  openPendingClaimModal: () => void;
  /** Confirms today's pending streak claim idempotently */
  claimTodayStreak: () => Promise<void>;
}

const StreakContext = createContext<StreakContextValue | null>(null);

const PENDING_APP_TIME_PREFIX = 'sotal_pending_app_time_v1:';
const PENDING_OFFLINE_ACTIVITIES_PREFIX = 'sotal_pending_offline_activities_v1:';
const ACTIVE_TAB_LEASE_KEY = 'sotal_active_tab_lease_v1';
const FLUSH_INTERVAL_MS = 30_000;

interface StoredPendingSeconds {
  dateKey: string;
  seconds: number;
}

interface QueuedOfflineActivity extends RecordLearningActivityInput {
  dateKey: string;
}

function readQueuedOfflineActivities(userId: string): QueuedOfflineActivity[] {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const raw = window.localStorage.getItem(`${PENDING_OFFLINE_ACTIVITIES_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedOfflineActivity[]).slice(0, 30) : [];
  } catch {
    return [];
  }
}

function writeQueuedOfflineActivities(userId: string, items: QueuedOfflineActivity[]): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const key = `${PENDING_OFFLINE_ACTIVITIES_PREFIX}${userId}`;
    if (items.length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(items.slice(0, 30)));
    }
  } catch {
    // Ignore storage quota issues
  }
}

function readPendingLocalSeconds(userId: string): StoredPendingSeconds | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = window.localStorage.getItem(`${PENDING_APP_TIME_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPendingSeconds>;
    if (typeof parsed.dateKey === 'string' && typeof parsed.seconds === 'number' && parsed.seconds > 0) {
      return { dateKey: parsed.dateKey, seconds: Math.min(3600, Math.floor(parsed.seconds)) };
    }
    return null;
  } catch {
    return null;
  }
}

function writePendingLocalSeconds(userId: string, data: StoredPendingSeconds | null) {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const key = `${PENDING_APP_TIME_PREFIX}${userId}`;
    if (!data || data.seconds <= 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(data));
    }
  } catch {
    // Ignore storage quota issues
  }
}

export const StreakProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isOnline } = useAuth();
  const userId = user?.uid ?? '';

  const [todayKey, setTodayKey] = useState<string>(() => getLocalDateKey());
  const [streakProfile, setStreakProfile] = useState<StreakProfile | null>(null);
  const [streakDays, setStreakDays] = useState<Record<string, DailyStreakRecord>>({});
  const [studyActivities, setStudyActivities] = useState<StudyActivityEvent[]>([]);
  const [appUsageSummary, setAppUsageSummary] = useState<AppUsageSummary | null>(null);
  const [appUsageDays, setAppUsageDays] = useState<Record<string, AppUsageDailyRecord>>({});

  const [streakLoading, setStreakLoading] = useState(true);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  // Streak Claim Modal state
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [claimModalStreakCount, setClaimModalStreakCount] = useState<number>(1);
  const [claimModalActivityTitle, setClaimModalActivityTitle] = useState<string>('');
  const [claiming, setClaiming] = useState(false);
  const autoOpenedPendingDateRef = useRef<string>('');

  // Live unsaved foreground app seconds for smooth Dashboard counter
  const [liveUnsavedSeconds, setLiveUnsavedSeconds] = useState(0);
  const unsavedSecondsRef = useRef(0);
  const unsavedDateKeyRef = useRef(todayKey);
  const flushingRef = useRef(false);
  const tabIdRef = useRef<string>(`tab_${Math.random().toString(36).slice(2, 10)}`);

  // Reconcile streak profile on sign-in and whenever local date rolls over
  useEffect(() => {
    if (!userId) {
      setStreakProfile(null);
      setStreakDays({});
      setStudyActivities([]);
      setAppUsageSummary(null);
      setAppUsageDays({});
      setStreakLoading(false);
      setActivitiesLoading(false);
      setClaimModalOpen(false);
      return;
    }

    setStreakLoading(true);
    setActivitiesLoading(true);

    if (auth.currentUser?.uid === userId && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      void ensureAndReconcileStreak(userId, getLocalDateKey()).catch((err) => {
        console.warn('Streak reconciliation deferred:', err);
      });
    }

    const unsubProfile = subscribeStreakProfile(
      userId,
      (prof) => {
        setStreakProfile(prof);
        setStreakLoading(false);
      },
      () => setStreakLoading(false)
    );

    const unsubDays = subscribeStreakDays(
      userId,
      (days) => setStreakDays(days),
      () => {
        // Non-fatal
      }
    );

    const unsubActivities = subscribeStudyActivities(
      userId,
      (events) => {
        setStudyActivities(events);
        setActivitiesLoading(false);
      },
      () => setActivitiesLoading(false)
    );

    const unsubUsageSummary = subscribeAppUsageSummary(
      userId,
      (summary) => setAppUsageSummary(summary),
      () => {
        // Non-fatal
      }
    );

    const unsubUsageDays = subscribeAppUsageDays(
      userId,
      (days) => setAppUsageDays(days),
      () => {
        // Non-fatal
      }
    );

    return () => {
      unsubProfile();
      unsubDays();
      unsubActivities();
      unsubUsageSummary();
      unsubUsageDays();
    };
  }, [userId]);

  // If user reloads while today's streak is still pending_claim, reopen claim modal once cleanly
  useEffect(() => {
    if (!streakProfile || !userId) return;
    const todayRec = streakDays[todayKey];
    const hasPending =
      streakProfile.pendingClaimDate === todayKey &&
      todayRec?.status === 'pending_claim';

    if (hasPending && autoOpenedPendingDateRef.current !== todayKey) {
      autoOpenedPendingDateRef.current = todayKey;
      setClaimModalStreakCount(
        Math.max(1, todayRec?.streakCount || streakProfile.pendingStreakCount || 1)
      );
      setClaimModalActivityTitle(todayRec?.firstActivityTitle || '');
      setClaimModalOpen(true);
    }
  }, [streakProfile, streakDays, todayKey, userId]);

  // Flush accumulated foreground app time to Firestore safely
  const flushAccumulatedAppTime = useCallback(async () => {
    if (!userId || flushingRef.current) return;
    const secondsToFlush = Math.floor(unsavedSecondsRef.current);
    const targetDateKey = unsavedDateKeyRef.current || getLocalDateKey();
    if (secondsToFlush <= 0) return;

    // Never attempt a Firestore transaction if signed out or offline.
    // Keep accumulated seconds in localStorage so they sync automatically when online.
    if (
      !auth.currentUser ||
      auth.currentUser.uid !== userId ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)
    ) {
      writePendingLocalSeconds(userId, {
        dateKey: targetDateKey,
        seconds: secondsToFlush,
      });
      if (!auth.currentUser || auth.currentUser.uid !== userId) {
        unsavedSecondsRef.current = 0;
        setLiveUnsavedSeconds(0);
      }
      return;
    }

    flushingRef.current = true;
    unsavedSecondsRef.current = 0;
    setLiveUnsavedSeconds(0);
    writePendingLocalSeconds(userId, null);

    try {
      await flushAppTimeSeconds(userId, secondsToFlush, targetDateKey);
    } catch {
      // Restore locally so time is not lost on temporary network blip or mid-flight sign-out
      if (auth.currentUser?.uid === userId) {
        unsavedSecondsRef.current += secondsToFlush;
        setLiveUnsavedSeconds(unsavedSecondsRef.current);
        writePendingLocalSeconds(userId, {
          dateKey: targetDateKey,
          seconds: unsavedSecondsRef.current,
        });
      } else {
        writePendingLocalSeconds(userId, {
          dateKey: targetDateKey,
          seconds: secondsToFlush,
        });
      }
    } finally {
      flushingRef.current = false;
    }
  }, [userId]);

  // Foreground / background time-in-app tracker + midnight rollover reconciliation
  useEffect(() => {
    if (!userId || typeof window === 'undefined' || typeof document === 'undefined') return;

    // Recover any unsaved foreground seconds persisted right before a previous reload/close
    const recovered = readPendingLocalSeconds(userId);
    if (
      recovered &&
      recovered.seconds > 0 &&
      auth.currentUser?.uid === userId &&
      (typeof navigator === 'undefined' || navigator.onLine !== false)
    ) {
      writePendingLocalSeconds(userId, null);
      void flushAppTimeSeconds(userId, recovered.seconds, recovered.dateKey).catch(() => {
        // Ignore transient offline recovery error
      });
    }

    unsavedSecondsRef.current = 0;
    unsavedDateKeyRef.current = getLocalDateKey();
    setLiveUnsavedSeconds(0);

    let lastTickMs = Date.now();
    let isForeground = document.visibilityState === 'visible';

    const claimTabLease = (): boolean => {
      try {
        const now = Date.now();
        const raw = window.localStorage.getItem(ACTIVE_TAB_LEASE_KEY);
        if (raw) {
          const lease = JSON.parse(raw) as { tabId: string; expiresAt: number };
          if (lease.tabId !== tabIdRef.current && lease.expiresAt > now) {
            return false;
          }
        }
        window.localStorage.setItem(
          ACTIVE_TAB_LEASE_KEY,
          JSON.stringify({ tabId: tabIdRef.current, expiresAt: now + 3500 })
        );
        return true;
      } catch {
        return true;
      }
    };

    const tick = () => {
      const now = Date.now();
      const currentDateKey = getLocalDateKey(new Date(now));

      // Handle local midnight rollover seamlessly
      if (currentDateKey !== unsavedDateKeyRef.current) {
        void flushAccumulatedAppTime();
        unsavedDateKeyRef.current = currentDateKey;
        setTodayKey(currentDateKey);
        if (auth.currentUser?.uid === userId) {
          void ensureAndReconcileStreak(userId, currentDateKey).catch(() => {});
        }
      }

      if (isForeground && document.visibilityState === 'visible') {
        const elapsedSec = Math.floor((now - lastTickMs) / 1000);
        // Clamp per-tick delta to max 3 seconds so device sleep/suspend never inflates time
        if (elapsedSec > 0 && elapsedSec <= 3 && claimTabLease()) {
          unsavedSecondsRef.current += elapsedSec;
          setLiveUnsavedSeconds(unsavedSecondsRef.current);
          writePendingLocalSeconds(userId, {
            dateKey: currentDateKey,
            seconds: unsavedSecondsRef.current,
          });
        }
      }
      lastTickMs = now;
    };

    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      isForeground = visible;
      lastTickMs = Date.now();
      if (!visible) {
        void flushAccumulatedAppTime();
      } else {
        const nextDay = getLocalDateKey();
        if (nextDay !== unsavedDateKeyRef.current) {
          setTodayKey(nextDay);
          unsavedDateKeyRef.current = nextDay;
        }
        if (auth.currentUser?.uid === userId) {
          void ensureAndReconcileStreak(userId, nextDay).catch(() => {});
        }
      }
    };

    const handleBlur = () => {
      // Flush cleanly when window loses focus so abrupt closes never lose progress
      void flushAccumulatedAppTime();
    };

    const handleFocus = () => {
      isForeground = document.visibilityState === 'visible';
      lastTickMs = Date.now();
    };

    const handlePageHide = () => {
      if (unsavedSecondsRef.current > 0) {
        writePendingLocalSeconds(userId, {
          dateKey: unsavedDateKeyRef.current,
          seconds: unsavedSecondsRef.current,
        });
      }
      void flushAccumulatedAppTime();
    };

    const secondInterval = window.setInterval(tick, 1000);
    const flushInterval = window.setInterval(() => {
      if (unsavedSecondsRef.current >= 15) {
        void flushAccumulatedAppTime();
      }
    }, FLUSH_INTERVAL_MS);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.clearInterval(secondInterval);
      window.clearInterval(flushInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pagehide', handlePageHide);
      if (auth.currentUser?.uid === userId) {
        void flushAccumulatedAppTime();
      } else if (unsavedSecondsRef.current > 0) {
        writePendingLocalSeconds(userId, {
          dateKey: unsavedDateKeyRef.current || getLocalDateKey(),
          seconds: Math.floor(unsavedSecondsRef.current),
        });
        unsavedSecondsRef.current = 0;
        setLiveUnsavedSeconds(0);
      }
    };
  }, [userId, flushAccumulatedAppTime]);

  // Auto-sync queued offline activities, foreground time, and streak state upon reconnecting
  useEffect(() => {
    if (!isOnline || !userId || auth.currentUser?.uid !== userId) return;

    void ensureAndReconcileStreak(userId, getLocalDateKey()).catch(() => {});
    void flushAccumulatedAppTime();

    const pendingActivities = readQueuedOfflineActivities(userId);
    if (pendingActivities.length > 0) {
      writeQueuedOfflineActivities(userId, []);
      void (async () => {
        for (const item of pendingActivities) {
          try {
            const res = await recordQualifyingLearningActivity(userId, {
              activityType: item.activityType,
              title: item.title,
              courseId: item.courseId || 'global',
              courseCode: item.courseCode || 'COURSE',
              isSharedCourse: Boolean(item.isSharedCourse),
              durationSeconds: item.durationSeconds ?? 0,
              score: item.score ?? null,
              maxScore: item.maxScore ?? null,
              summary: item.summary || '',
              todayKey: item.dateKey || getLocalDateKey(),
            });
            if (res.shouldShowClaimModal) {
              autoOpenedPendingDateRef.current = item.dateKey || getLocalDateKey();
              setClaimModalStreakCount(res.pendingStreakCount);
              setClaimModalActivityTitle(item.title);
              setClaimModalOpen(true);
            }
          } catch {
            // Non-fatal sync skip
          }
        }
      })();
    }
  }, [isOnline, userId, flushAccumulatedAppTime]);

  const recordLearningActivity = useCallback(
    async (input: RecordLearningActivityInput) => {
      if (!userId || auth.currentUser?.uid !== userId) return;
      const currentDayKey = getLocalDateKey();
      if (currentDayKey !== todayKey) {
        setTodayKey(currentDayKey);
      }

      // Queue offline learning completions locally so they sync automatically once online
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const queued = readQueuedOfflineActivities(userId);
        queued.push({ ...input, dateKey: currentDayKey });
        writeQueuedOfflineActivities(userId, queued);
        return;
      }

      try {
        const result = await recordQualifyingLearningActivity(userId, {
          activityType: input.activityType,
          title: input.title,
          courseId: input.courseId || 'global',
          courseCode: input.courseCode || 'COURSE',
          isSharedCourse: Boolean(input.isSharedCourse),
          durationSeconds: input.durationSeconds ?? 0,
          score: input.score ?? null,
          maxScore: input.maxScore ?? null,
          summary: input.summary || '',
          todayKey: currentDayKey,
        });

        if (result.shouldShowClaimModal) {
          autoOpenedPendingDateRef.current = currentDayKey;
          setClaimModalStreakCount(result.pendingStreakCount);
          setClaimModalActivityTitle(input.title);
          setClaimModalOpen(true);
        }
      } catch (err) {
        console.warn('Failed to record learning activity / streak:', err);
      }
    },
    [userId, todayKey]
  );

  const claimTodayStreak = useCallback(async () => {
    if (!userId || auth.currentUser?.uid !== userId || claiming) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    setClaiming(true);
    try {
      await claimTodayStreakTransaction(userId, getLocalDateKey());
      // Let the final flame burst animation shine briefly before closing
      await new Promise((resolve) => window.setTimeout(resolve, 460));
      setClaimModalOpen(false);
    } catch (err) {
      console.warn('Failed to claim today streak:', err);
    } finally {
      setClaiming(false);
    }
  }, [userId, claiming]);

  const todayRecord = streakDays[todayKey];
  const studiedToday = todayRecord?.status === 'claimed';
  const hasPendingClaimToday =
    todayRecord?.status === 'pending_claim' ||
    (streakProfile?.pendingClaimDate === todayKey && !studiedToday);
  const pendingStreakCount = hasPendingClaimToday
    ? Math.max(
        1,
        todayRecord?.streakCount ||
          streakProfile?.pendingStreakCount ||
          (streakProfile?.currentStreak ?? 0) + 1
      )
    : 0;

  const openPendingClaimModal = useCallback(() => {
    if (!hasPendingClaimToday) return;
    setClaimModalStreakCount(pendingStreakCount);
    setClaimModalActivityTitle(todayRecord?.firstActivityTitle || '');
    setClaimModalOpen(true);
  }, [hasPendingClaimToday, pendingStreakCount, todayRecord?.firstActivityTitle]);

  const persistedTodayAppSeconds = appUsageDays[todayKey]?.appSeconds ?? 0;
  const persistedTotalAppSeconds = appUsageSummary?.totalAppSeconds ?? 0;
  const todayActiveLearningSeconds = appUsageDays[todayKey]?.activeLearningSeconds ?? 0;
  const totalActiveLearningSeconds = appUsageSummary?.totalActiveLearningSeconds ?? 0;

  const value = useMemo<StreakContextValue>(
    () => ({
      todayKey,
      currentStreak: streakProfile?.currentStreak ?? 0,
      longestStreak: streakProfile?.longestStreak ?? 0,
      totalStudyDays: streakProfile?.totalStudyDays ?? 0,
      lastQualifyingDate: streakProfile?.lastQualifyingDate ?? '',
      accountCreatedDate: streakProfile?.accountCreatedDate ?? todayKey,
      studiedToday,
      hasPendingClaimToday,
      pendingStreakCount,
      streakLoading,
      streakDays,
      studyActivities,
      activitiesLoading,
      todayAppSeconds: persistedTodayAppSeconds + liveUnsavedSeconds,
      totalAppSeconds: persistedTotalAppSeconds + liveUnsavedSeconds,
      todayActiveLearningSeconds,
      totalActiveLearningSeconds,
      appUsageDays,
      recordLearningActivity,
      openPendingClaimModal,
      claimTodayStreak,
    }),
    [
      todayKey,
      streakProfile,
      studiedToday,
      hasPendingClaimToday,
      pendingStreakCount,
      streakLoading,
      streakDays,
      studyActivities,
      activitiesLoading,
      persistedTodayAppSeconds,
      persistedTotalAppSeconds,
      liveUnsavedSeconds,
      todayActiveLearningSeconds,
      totalActiveLearningSeconds,
      appUsageDays,
      recordLearningActivity,
      openPendingClaimModal,
      claimTodayStreak,
    ]
  );

  return (
    <StreakContext.Provider value={value}>
      {children}
      <StreakClaimModal
        open={claimModalOpen}
        targetStreak={claimModalStreakCount}
        activityTitle={claimModalActivityTitle}
        claiming={claiming}
        onClaim={claimTodayStreak}
        onDismiss={() => setClaimModalOpen(false)}
      />
    </StreakContext.Provider>
  );
};

export function useStreak(): StreakContextValue {
  const ctx = useContext(StreakContext);
  if (!ctx) {
    throw new Error('useStreak must be used within StreakProvider');
  }
  return ctx;
}
