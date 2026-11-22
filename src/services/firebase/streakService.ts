import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  AppUsageDailyRecord,
  AppUsageSummary,
  DailyStreakRecord,
  StreakProfile,
  StudyActivityEvent,
  StudyActivityType,
} from '../../types/models';
import {
  generateDocumentId,
  sanitizeBoundedString,
  timestampToMillis,
} from '../../utils/validation';
import {
  addDaysToDateKey,
  applyClaimDailyStreak,
  applyQualifyingActivity,
  createInitialStreakProfile,
  diffDateKeys,
  getLocalDateKey,
  INITIAL_STREAK_FREEZES,
  isValidDateKey,
  reconcileMissedDays,
} from '../streak/streakEngine';
import { auth, db } from './config';
import { handleFirestoreError, OperationType } from './errors';

function streakProfileRef(userId: string) {
  return doc(db, 'users', userId, 'streakProfile', 'current');
}

function streakDaysCollection(userId: string) {
  return collection(db, 'users', userId, 'streakDays');
}

function streakDayRef(userId: string, dateKey: string) {
  return doc(db, 'users', userId, 'streakDays', dateKey);
}

function freezeLedgerRef(userId: string, entryId: string) {
  return doc(db, 'users', userId, 'freezeLedger', entryId);
}

function studyActivitiesCollection(userId: string) {
  return collection(db, 'users', userId, 'studyActivities');
}

function studyActivityRef(userId: string, activityId: string) {
  return doc(db, 'users', userId, 'studyActivities', activityId);
}

function appUsageSummaryRef(userId: string) {
  return doc(db, 'users', userId, 'appUsage', 'summary');
}

function appUsageDaysCollection(userId: string) {
  return collection(db, 'users', userId, 'appUsageDays');
}

function appUsageDayRef(userId: string, dateKey: string) {
  return doc(db, 'users', userId, 'appUsageDays', dateKey);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const inFlightReconcile = new Map<string, Promise<StreakProfile>>();

/**
 * Ensures the user's StreakProfile exists (initializing internal freezeBalance = 10)
 * and reconciles any missed days strictly before `todayKey` atomically inside a transaction.
 */
export async function ensureAndReconcileStreak(
  userId: string,
  todayKey: string = getLocalDateKey()
): Promise<StreakProfile> {
  const dedupeKey = `${userId}:${todayKey}`;
  const existingPromise = inFlightReconcile.get(dedupeKey);
  if (existingPromise) {
    return existingPromise;
  }

  const run = ensureAndReconcileStreakInternal(userId, todayKey).finally(() => {
    inFlightReconcile.delete(dedupeKey);
  });
  inFlightReconcile.set(dedupeKey, run);
  return run;
}

async function ensureAndReconcileStreakInternal(
  userId: string,
  todayKey: string
): Promise<StreakProfile> {
  const path = `users/${userId}/streakProfile/current`;
  const tzOffset = new Date().getTimezoneOffset();

  try {
    let resultProfile: StreakProfile | null = null;
    let needsAnotherPass = false;

    // Loop up to 6 passes only if someone returns after >60 missed days with large freeze balance
    for (let pass = 0; pass < 6; pass += 1) {
      needsAnotherPass = false;

      resultProfile = await runTransaction(db, async (tx) => {
        const profRef = streakProfileRef(userId);
        const initGrantRef = freezeLedgerRef(userId, 'init_grant');
        const [profSnap, initGrantSnap] = await Promise.all([
          tx.get(profRef),
          tx.get(initGrantRef),
        ]);

        if (!profSnap.exists()) {
          const initial = createInitialStreakProfile(userId, todayKey, tzOffset);
          tx.set(profRef, {
            ...initial,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          if (!initGrantSnap.exists()) {
            tx.set(initGrantRef, {
              userId,
              dateKey: todayKey,
              action: 'initial_grant',
              delta: INITIAL_STREAK_FREEZES,
              balanceAfter: INITIAL_STREAK_FREEZES,
              createdAt: serverTimestamp(),
            });
          }
          return initial;
        }

        const existingProfile = profSnap.data() as StreakProfile;

        // Compute bounded target date for this pass (max 60 days per transaction to stay well below Firestore's 500-op limit)
        let anchorDate = existingProfile.lastQualifyingDate || existingProfile.lastEvaluatedDate || todayKey;
        if (
          existingProfile.lastEvaluatedDate &&
          isValidDateKey(existingProfile.lastEvaluatedDate) &&
          isValidDateKey(anchorDate) &&
          diffDateKeys(anchorDate, existingProfile.lastEvaluatedDate) > 0
        ) {
          anchorDate = existingProfile.lastEvaluatedDate;
        }

        const fullGap = isValidDateKey(anchorDate) ? diffDateKeys(anchorDate, todayKey) : 0;
        const passTargetDate =
          fullGap > 60 ? addDaysToDateKey(anchorDate, 60) : todayKey;
        if (fullGap > 60) {
          needsAnotherPass = true;
        }

        // Collect all dateKeys we need to read BEFORE writing
        const datesToRead = new Set<string>();
        if (
          existingProfile.pendingClaimDate &&
          isValidDateKey(existingProfile.pendingClaimDate) &&
          diffDateKeys(existingProfile.pendingClaimDate, passTargetDate) > 0
        ) {
          datesToRead.add(existingProfile.pendingClaimDate);
        }

        const gapForPass = isValidDateKey(anchorDate)
          ? Math.max(0, diffDateKeys(anchorDate, passTargetDate))
          : 0;
        if (gapForPass > 1 && existingProfile.currentStreak > 0) {
          for (let offset = 1; offset < gapForPass; offset += 1) {
            datesToRead.add(addDaysToDateKey(anchorDate, offset));
          }
        }

        const existingDays: Record<string, DailyStreakRecord> = {};
        if (datesToRead.size > 0) {
          const dateList = Array.from(datesToRead);
          const snaps = await Promise.all(
            dateList.map((d) => tx.get(streakDayRef(userId, d)))
          );
          snaps.forEach((snap, idx) => {
            if (snap.exists()) {
              existingDays[dateList[idx]] = {
                dateKey: dateList[idx],
                ...(snap.data() as Omit<DailyStreakRecord, 'dateKey'>),
              };
            }
          });
        }

        const reconciled = reconcileMissedDays(
          existingProfile,
          existingDays,
          passTargetDate
        );

        if (!reconciled.changed) {
          return existingProfile;
        }

        // Write daily records
        for (const dayRec of reconciled.createdOrUpdatedDays) {
          const dayRef = streakDayRef(userId, dayRec.dateKey);
          const prev = existingDays[dayRec.dateKey];
          if (prev) {
            tx.update(dayRef, {
              status: dayRec.status,
              streakCount: dayRec.streakCount,
              qualifyingActivitiesCount: dayRec.qualifyingActivitiesCount,
              freezeAwarded: dayRec.freezeAwarded,
              freezeConsumed: dayRec.freezeConsumed,
              claimedAt: dayRec.status === 'claimed' ? serverTimestamp() : null,
              updatedAt: serverTimestamp(),
            });
          } else {
            tx.set(dayRef, {
              dateKey: dayRec.dateKey,
              userId,
              status: dayRec.status,
              streakCount: dayRec.streakCount,
              qualifyingActivitiesCount: dayRec.qualifyingActivitiesCount,
              firstActivityType: dayRec.firstActivityType,
              firstActivityTitle: sanitizeBoundedString(dayRec.firstActivityTitle, 140),
              freezeAwarded: dayRec.freezeAwarded,
              freezeConsumed: dayRec.freezeConsumed,
              claimedAt: dayRec.status === 'claimed' ? serverTimestamp() : null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }

        // Write deterministic append-only freeze ledger entries
        for (const entry of reconciled.newLedgerEntries) {
          tx.set(freezeLedgerRef(userId, entry.id), {
            userId,
            dateKey: entry.dateKey,
            action: entry.action,
            delta: entry.delta,
            balanceAfter: entry.balanceAfter,
            createdAt: serverTimestamp(),
          });
        }

        // Update StreakProfile
        tx.update(profRef, {
          currentStreak: reconciled.profile.currentStreak,
          longestStreak: reconciled.profile.longestStreak,
          totalStudyDays: reconciled.profile.totalStudyDays,
          freezeBalance: reconciled.profile.freezeBalance,
          lastQualifyingDate: reconciled.profile.lastQualifyingDate,
          lastEvaluatedDate: reconciled.profile.lastEvaluatedDate,
          pendingClaimDate: reconciled.profile.pendingClaimDate,
          pendingStreakCount: reconciled.profile.pendingStreakCount,
          timezoneOffsetMinutes: tzOffset,
          updatedAt: serverTimestamp(),
        });

        return reconciled.profile;
      });

      if (!needsAnotherPass) break;
    }

    return resultProfile ?? createInitialStreakProfile(userId, todayKey, tzOffset);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface RegisterActivityResult {
  shouldShowClaimModal: boolean;
  alreadyClaimedToday: boolean;
  pendingStreakCount: number;
  todayKey: string;
}

/**
 * Logs a genuine completed learning activity globally across courses (including Shared Library),
 * updates active learning time, and atomically evaluates today's streak qualification.
 */
export async function recordQualifyingLearningActivity(
  userId: string,
  input: {
    activityType: StudyActivityType;
    title: string;
    courseId: string;
    courseCode: string;
    isSharedCourse: boolean;
    durationSeconds?: number;
    score?: number | null;
    maxScore?: number | null;
    summary?: string;
    todayKey?: string;
  }
): Promise<RegisterActivityResult> {
  const todayKey = input.todayKey || getLocalDateKey();
  const tzOffset = new Date().getTimezoneOffset();
  const cleanTitle = sanitizeBoundedString(input.title, 180) || 'Study session';
  const cleanSummary = sanitizeBoundedString(input.summary || '', 500);
  const cleanCourseCode = sanitizeBoundedString(input.courseCode || 'COURSE', 40) || 'COURSE';
  const cleanCourseId = sanitizeBoundedString(input.courseId || 'global', 120) || 'global';
  const durationSeconds = clampInt(input.durationSeconds ?? 0, 0, 86400);
  const safeScore =
    typeof input.score === 'number' && Number.isFinite(input.score)
      ? Math.max(0, Math.min(10000, Math.round(input.score * 100) / 100))
      : null;
  const safeMaxScore =
    typeof input.maxScore === 'number' && Number.isFinite(input.maxScore)
      ? Math.max(0, Math.min(10000, Math.round(input.maxScore * 100) / 100))
      : null;

  // 1. Write immutable StudyActivityEvent for the Study Dashboard
  const activityId = generateDocumentId('act');
  const activityPath = `users/${userId}/studyActivities/${activityId}`;
  try {
    await setDoc(studyActivityRef(userId, activityId), {
      userId,
      courseId: cleanCourseId,
      courseCode: cleanCourseCode,
      isSharedCourse: Boolean(input.isSharedCourse),
      activityType: input.activityType,
      title: cleanTitle,
      dateKey: todayKey,
      durationSeconds,
      score: safeScore,
      maxScore: safeMaxScore,
      summary: cleanSummary,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, activityPath);
  }

  // 2. Credit active learning seconds (if > 0) to daily & lifetime app usage records
  if (durationSeconds > 0) {
    void addActiveLearningSeconds(userId, durationSeconds, todayKey).catch(() => {
      // Non-blocking secondary telemetry update
    });
  }

  // 3. Ensure profile exists & reconcile any missed days first
  await ensureAndReconcileStreak(userId, todayKey);

  // 4. Atomically register today's qualification in a transaction
  const path = `users/${userId}/streakDays/${todayKey}`;
  try {
    return await runTransaction(db, async (tx) => {
      const profRef = streakProfileRef(userId);
      const dayRef = streakDayRef(userId, todayKey);
      const initGrantRef = freezeLedgerRef(userId, 'init_grant');

      const [profSnap, daySnap, initGrantSnap] = await Promise.all([
        tx.get(profRef),
        tx.get(dayRef),
        tx.get(initGrantRef),
      ]);
      const currentProfile = profSnap.exists()
        ? (profSnap.data() as StreakProfile)
        : createInitialStreakProfile(userId, todayKey, tzOffset);

      const existingDays: Record<string, DailyStreakRecord> = {};
      if (daySnap.exists()) {
        existingDays[todayKey] = {
          dateKey: todayKey,
          ...(daySnap.data() as Omit<DailyStreakRecord, 'dateKey'>),
        };
      }

      const outcome = applyQualifyingActivity(currentProfile, existingDays, todayKey, {
        activityType: input.activityType,
        title: cleanTitle,
      });

      if (!profSnap.exists()) {
        tx.set(profRef, {
          ...outcome.profile,
          timezoneOffsetMinutes: tzOffset,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (!initGrantSnap.exists()) {
          tx.set(initGrantRef, {
            userId,
            dateKey: todayKey,
            action: 'initial_grant',
            delta: INITIAL_STREAK_FREEZES,
            balanceAfter: INITIAL_STREAK_FREEZES,
            createdAt: serverTimestamp(),
          });
        }
      } else {
        tx.update(profRef, {
          pendingClaimDate: outcome.profile.pendingClaimDate,
          pendingStreakCount: outcome.profile.pendingStreakCount,
          lastEvaluatedDate: outcome.profile.lastEvaluatedDate,
          timezoneOffsetMinutes: tzOffset,
          updatedAt: serverTimestamp(),
        });
      }

      if (daySnap.exists()) {
        tx.update(dayRef, {
          qualifyingActivitiesCount: outcome.todayRecord.qualifyingActivitiesCount,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(dayRef, {
          dateKey: todayKey,
          userId,
          status: outcome.todayRecord.status,
          streakCount: outcome.todayRecord.streakCount,
          qualifyingActivitiesCount: outcome.todayRecord.qualifyingActivitiesCount,
          firstActivityType: outcome.todayRecord.firstActivityType,
          firstActivityTitle: sanitizeBoundedString(outcome.todayRecord.firstActivityTitle, 140),
          freezeAwarded: false,
          freezeConsumed: false,
          claimedAt: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      return {
        shouldShowClaimModal: outcome.shouldShowClaimModal,
        alreadyClaimedToday: outcome.alreadyClaimedToday,
        pendingStreakCount: outcome.pendingStreakCount,
        todayKey,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Confirms today's pending streak claim inside an atomic Firestore transaction.
 * Strictly idempotent: calling twice on the same day never double-increments or double-awards freezes.
 */
export async function claimTodayStreakTransaction(
  userId: string,
  todayKey: string = getLocalDateKey()
): Promise<{ alreadyClaimed: boolean; committedStreak: number }> {
  const path = `users/${userId}/streakDays/${todayKey}`;
  try {
    return await runTransaction(db, async (tx) => {
      const profRef = streakProfileRef(userId);
      const dayRef = streakDayRef(userId, todayKey);
      const earnRef = freezeLedgerRef(userId, `earn_${todayKey}`);

      const [profSnap, daySnap, earnSnap] = await Promise.all([
        tx.get(profRef),
        tx.get(dayRef),
        tx.get(earnRef),
      ]);

      if (!profSnap.exists() || !daySnap.exists()) {
        return { alreadyClaimed: true, committedStreak: 0 };
      }

      const currentProfile = profSnap.data() as StreakProfile;
      const existingToday: DailyStreakRecord = {
        dateKey: todayKey,
        ...(daySnap.data() as Omit<DailyStreakRecord, 'dateKey'>),
      };

      const result = applyClaimDailyStreak(currentProfile, existingToday, todayKey);
      if (result.alreadyClaimed || !result.todayRecord) {
        if (currentProfile.pendingClaimDate === todayKey) {
          tx.update(profRef, {
            pendingClaimDate: '',
            pendingStreakCount: 0,
            updatedAt: serverTimestamp(),
          });
        }
        return { alreadyClaimed: true, committedStreak: result.committedStreak };
      }

      // Guard against duplicate ledger entry if somehow already created
      const finalFreezeBalance = earnSnap.exists()
        ? currentProfile.freezeBalance
        : result.profile.freezeBalance;

      tx.update(profRef, {
        currentStreak: result.profile.currentStreak,
        longestStreak: result.profile.longestStreak,
        totalStudyDays: result.profile.totalStudyDays,
        freezeBalance: finalFreezeBalance,
        lastQualifyingDate: result.profile.lastQualifyingDate,
        lastEvaluatedDate: result.profile.lastEvaluatedDate,
        pendingClaimDate: '',
        pendingStreakCount: 0,
        updatedAt: serverTimestamp(),
      });

      tx.update(dayRef, {
        status: 'claimed',
        streakCount: result.todayRecord.streakCount,
        freezeAwarded: true,
        claimedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (result.earnedLedgerEntry && !earnSnap.exists()) {
        tx.set(earnRef, {
          userId,
          dateKey: todayKey,
          action: 'earned',
          delta: 1,
          balanceAfter: finalFreezeBalance,
          createdAt: serverTimestamp(),
        });
      }

      return {
        alreadyClaimed: false,
        committedStreak: result.committedStreak,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Adds foreground "Time in app" seconds atomically to today's record and lifetime summary.
 */
export async function flushAppTimeSeconds(
  userId: string,
  deltaSeconds: number,
  todayKey: string = getLocalDateKey()
): Promise<void> {
  const safeDelta = clampInt(deltaSeconds, 0, 3600);
  if (safeDelta <= 0) return;
  if (!auth.currentUser || auth.currentUser.uid !== userId) return;

  const path = `users/${userId}/appUsage/summary`;
  try {
    await runTransaction(db, async (tx) => {
      const sumRef = appUsageSummaryRef(userId);
      const dayRef = appUsageDayRef(userId, todayKey);
      const [sumSnap, daySnap] = await Promise.all([tx.get(sumRef), tx.get(dayRef)]);

      if (sumSnap.exists()) {
        const prev = sumSnap.data() as AppUsageSummary;
        tx.update(sumRef, {
          totalAppSeconds: clampInt((prev.totalAppSeconds || 0) + safeDelta, 0, 1_000_000_000),
          lastActiveDate: todayKey,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(sumRef, {
          userId,
          totalAppSeconds: safeDelta,
          totalActiveLearningSeconds: 0,
          lastActiveDate: todayKey,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (daySnap.exists()) {
        const prevDay = daySnap.data() as AppUsageDailyRecord;
        tx.update(dayRef, {
          appSeconds: clampInt((prevDay.appSeconds || 0) + safeDelta, 0, 86400),
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(dayRef, {
          dateKey: todayKey,
          userId,
          appSeconds: safeDelta,
          activeLearningSeconds: 0,
          sessionsCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    // If the user signed out while the background timer flush was in-flight, abort quietly
    if (!auth.currentUser || auth.currentUser.uid !== userId) return;
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Credits actual active learning duration (e.g., completed practice, tutor, study session)
 * separately from general foreground "Time in app".
 */
export async function addActiveLearningSeconds(
  userId: string,
  deltaSeconds: number,
  todayKey: string = getLocalDateKey()
): Promise<void> {
  const safeDelta = clampInt(deltaSeconds, 0, 86400);
  if (safeDelta <= 0) return;
  if (!auth.currentUser || auth.currentUser.uid !== userId) return;

  const path = `users/${userId}/appUsageDays/${todayKey}`;
  try {
    await runTransaction(db, async (tx) => {
      const sumRef = appUsageSummaryRef(userId);
      const dayRef = appUsageDayRef(userId, todayKey);
      const [sumSnap, daySnap] = await Promise.all([tx.get(sumRef), tx.get(dayRef)]);

      if (sumSnap.exists()) {
        const prev = sumSnap.data() as AppUsageSummary;
        tx.update(sumRef, {
          totalActiveLearningSeconds: clampInt(
            (prev.totalActiveLearningSeconds || 0) + safeDelta,
            0,
            1_000_000_000
          ),
          lastActiveDate: todayKey,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(sumRef, {
          userId,
          totalAppSeconds: 0,
          totalActiveLearningSeconds: safeDelta,
          lastActiveDate: todayKey,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (daySnap.exists()) {
        const prevDay = daySnap.data() as AppUsageDailyRecord;
        tx.update(dayRef, {
          activeLearningSeconds: clampInt(
            (prevDay.activeLearningSeconds || 0) + safeDelta,
            0,
            86400
          ),
          sessionsCount: clampInt((prevDay.sessionsCount || 0) + 1, 0, 10000),
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(dayRef, {
          dateKey: todayKey,
          userId,
          appSeconds: 0,
          activeLearningSeconds: safeDelta,
          sessionsCount: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeStreakProfile(
  userId: string,
  onData: (profile: StreakProfile | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/streakProfile/current`;
  return onSnapshot(
    streakProfileRef(userId),
    (snap) => {
      onData(snap.exists() ? (snap.data() as StreakProfile) : null);
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

export function subscribeStreakDays(
  userId: string,
  onData: (days: Record<string, DailyStreakRecord>) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/streakDays`;
  const q = query(streakDaysCollection(userId), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const map: Record<string, DailyStreakRecord> = {};
      snapshot.docs.forEach((d) => {
        map[d.id] = {
          dateKey: d.id,
          ...(d.data() as Omit<DailyStreakRecord, 'dateKey'>),
        };
      });
      onData(map);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeStudyActivities(
  userId: string,
  onData: (events: StudyActivityEvent[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/studyActivities`;
  const q = query(studyActivitiesCollection(userId), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: StudyActivityEvent[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<StudyActivityEvent, 'id'>),
      }));
      list.sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeAppUsageSummary(
  userId: string,
  onData: (summary: AppUsageSummary | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/appUsage/summary`;
  return onSnapshot(
    appUsageSummaryRef(userId),
    (snap) => {
      onData(snap.exists() ? (snap.data() as AppUsageSummary) : null);
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

export function subscribeAppUsageDays(
  userId: string,
  onData: (days: Record<string, AppUsageDailyRecord>) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/appUsageDays`;
  const q = query(appUsageDaysCollection(userId), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const map: Record<string, AppUsageDailyRecord> = {};
      snapshot.docs.forEach((d) => {
        map[d.id] = {
          dateKey: d.id,
          ...(d.data() as Omit<AppUsageDailyRecord, 'dateKey'>),
        };
      });
      onData(map);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}
