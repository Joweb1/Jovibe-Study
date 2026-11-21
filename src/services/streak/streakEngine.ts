import type {
  DailyStreakRecord,
  FreezeLedgerEntry,
  StreakProfile,
  StudyActivityType,
} from '../../types/models';

export const INITIAL_STREAK_FREEZES = 10;

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Formats a JS Date into the user's local calendar date key `YYYY-MM-DD`.
 */
export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_REGEX.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Pure UTC-noon calendar math so DST transitions never cause off-by-one day shifts.
 */
function dateKeyToUtcNoonMs(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const ms = dateKeyToUtcNoonMs(dateKey) + deltaDays * 86_400_000;
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function diffDateKeys(fromKey: string, toKey: string): number {
  return Math.round((dateKeyToUtcNoonMs(toKey) - dateKeyToUtcNoonMs(fromKey)) / 86_400_000);
}

export function createInitialStreakProfile(
  userId: string,
  todayKey: string,
  timezoneOffsetMinutes: number = new Date().getTimezoneOffset()
): StreakProfile {
  return {
    userId,
    currentStreak: 0,
    longestStreak: 0,
    totalStudyDays: 0,
    freezeBalance: INITIAL_STREAK_FREEZES,
    lastQualifyingDate: '',
    lastEvaluatedDate: todayKey,
    pendingClaimDate: '',
    pendingStreakCount: 0,
    accountCreatedDate: todayKey,
    timezoneOffsetMinutes,
    createdAt: null,
    updatedAt: null,
  };
}

export interface ReconcileResult {
  profile: StreakProfile;
  createdOrUpdatedDays: DailyStreakRecord[];
  newLedgerEntries: FreezeLedgerEntry[];
  freezesConsumedCount: number;
  streakWasReset: boolean;
  autoClaimedStaleDay: boolean;
  changed: boolean;
}

/**
 * Reconciles missed calendar days between the last known evaluated/qualifying date
 * and `todayKey` (exclusive of `todayKey` — today is still in progress!).
 *
 * Rules:
 * - Never marks `todayKey` or future dates as missed.
 * - Handles backward timezone jumps safely (no history corruption).
 * - If a prior day (< todayKey) was left in `pending_claim`, auto-commits it cleanly
 *   so genuine study is never unfairly lost when a user closes the tab before tapping Claim.
 * - For each missed calendar day strictly before `todayKey`:
 *   - If `currentStreak > 0` and `freezeBalance > 0`: consumes 1 freeze (never negative),
 *     marks day `'frozen'`, preserves `currentStreak` without incrementing it.
 *   - Else: marks day `'missed'` and resets `currentStreak` to 0.
 */
export function reconcileMissedDays(
  rawProfile: StreakProfile,
  existingDays: Record<string, DailyStreakRecord>,
  todayKey: string,
  nowMs: number = Date.now()
): ReconcileResult {
  const profile: StreakProfile = {
    ...rawProfile,
    freezeBalance: Math.max(0, Math.floor(rawProfile.freezeBalance)),
  };

  const createdOrUpdatedDays: DailyStreakRecord[] = [];
  const newLedgerEntries: FreezeLedgerEntry[] = [];
  let freezesConsumedCount = 0;
  let streakWasReset = false;
  let autoClaimedStaleDay = false;
  let changed = false;

  // 1. If a previous day (< todayKey) was left unclaimed after genuine study, finalize it first.
  if (
    profile.pendingClaimDate &&
    isValidDateKey(profile.pendingClaimDate) &&
    diffDateKeys(profile.pendingClaimDate, todayKey) > 0
  ) {
    const staleDate = profile.pendingClaimDate;
    const staleRec = existingDays[staleDate];
    if (!staleRec || staleRec.status === 'pending_claim') {
      const committedStreak = Math.max(
        1,
        staleRec?.streakCount || profile.pendingStreakCount || profile.currentStreak + 1
      );
      const shouldGrantFreeze = !staleRec?.freezeAwarded;
      const nextFreezeBalance = shouldGrantFreeze
        ? profile.freezeBalance + 1
        : profile.freezeBalance;

      const finalizedDay: DailyStreakRecord = {
        dateKey: staleDate,
        userId: profile.userId,
        status: 'claimed',
        streakCount: committedStreak,
        qualifyingActivitiesCount: Math.max(1, staleRec?.qualifyingActivitiesCount || 1),
        firstActivityType: staleRec?.firstActivityType || '',
        firstActivityTitle: staleRec?.firstActivityTitle || 'Study session',
        freezeAwarded: true,
        freezeConsumed: false,
        claimedAt: nowMs,
        createdAt: staleRec?.createdAt ?? nowMs,
        updatedAt: nowMs,
      };
      createdOrUpdatedDays.push(finalizedDay);
      existingDays = { ...existingDays, [staleDate]: finalizedDay };

      if (shouldGrantFreeze) {
        newLedgerEntries.push({
          id: `earn_${staleDate}`,
          userId: profile.userId,
          dateKey: staleDate,
          action: 'earned',
          delta: 1,
          balanceAfter: nextFreezeBalance,
          createdAt: nowMs,
        });
      }

      profile.currentStreak = committedStreak;
      profile.longestStreak = Math.max(profile.longestStreak, committedStreak);
      profile.totalStudyDays += 1;
      profile.freezeBalance = nextFreezeBalance;
      profile.lastQualifyingDate = staleDate;
      profile.lastEvaluatedDate =
        !profile.lastEvaluatedDate || diffDateKeys(profile.lastEvaluatedDate, staleDate) > 0
          ? staleDate
          : profile.lastEvaluatedDate;
      profile.pendingClaimDate = '';
      profile.pendingStreakCount = 0;
      autoClaimedStaleDay = true;
      changed = true;
    } else {
      profile.pendingClaimDate = '';
      profile.pendingStreakCount = 0;
      changed = true;
    }
  }

  // 2. Determine anchor date to scan forward from
  let anchorDate = '';
  if (profile.lastQualifyingDate && isValidDateKey(profile.lastQualifyingDate)) {
    anchorDate = profile.lastQualifyingDate;
  }
  if (
    profile.lastEvaluatedDate &&
    isValidDateKey(profile.lastEvaluatedDate) &&
    (!anchorDate || diffDateKeys(anchorDate, profile.lastEvaluatedDate) > 0)
  ) {
    anchorDate = profile.lastEvaluatedDate;
  }

  if (!anchorDate) {
    if (profile.lastEvaluatedDate !== todayKey) {
      profile.lastEvaluatedDate = todayKey;
      changed = true;
    }
    return {
      profile,
      createdOrUpdatedDays,
      newLedgerEntries,
      freezesConsumedCount,
      streakWasReset,
      autoClaimedStaleDay,
      changed,
    };
  }

  const gapDays = diffDateKeys(anchorDate, todayKey);

  // If user moved west across timezones (gapDays < 0) or it's still the same day (gapDays === 0),
  // never corrupt prior history.
  if (gapDays <= 0) {
    return {
      profile,
      createdOrUpdatedDays,
      newLedgerEntries,
      freezesConsumedCount,
      streakWasReset,
      autoClaimedStaleDay,
      changed,
    };
  }

  // Only days strictly BEFORE todayKey can be missed: (anchorDate + 1) ... (todayKey - 1)
  const missedWindowCount = gapDays - 1;

  if (missedWindowCount > 0 && profile.currentStreak > 0) {
    // Process missed days chronologically so freezes protect consecutive missed days first.
    // Cap explicit missed-day document writes after streak hits 0 to avoid huge batch writes
    // if a user returns after many months; calendar still renders unrecorded past dates as missed.
    let explicitMissedWritesAfterReset = 0;
    const MAX_MISSED_WRITES_AFTER_RESET = 35;

    for (let offset = 1; offset <= missedWindowCount; offset += 1) {
      const dateKey = addDaysToDateKey(anchorDate, offset);
      const existing = existingDays[dateKey];

      // Idempotent guard: never overwrite an already-recorded day
      if (existing && (existing.status === 'claimed' || existing.status === 'frozen' || existing.status === 'missed')) {
        if (existing.status === 'missed') {
          profile.currentStreak = 0;
        }
        continue;
      }

      if (profile.currentStreak > 0 && profile.freezeBalance > 0) {
        profile.freezeBalance = Math.max(0, profile.freezeBalance - 1);
        freezesConsumedCount += 1;
        changed = true;

        const frozenRecord: DailyStreakRecord = {
          dateKey,
          userId: profile.userId,
          status: 'frozen',
          streakCount: profile.currentStreak,
          qualifyingActivitiesCount: 0,
          firstActivityType: '',
          firstActivityTitle: '',
          freezeAwarded: false,
          freezeConsumed: true,
          claimedAt: null,
          createdAt: nowMs,
          updatedAt: nowMs,
        };
        createdOrUpdatedDays.push(frozenRecord);
        newLedgerEntries.push({
          id: `consume_${dateKey}`,
          userId: profile.userId,
          dateKey,
          action: 'consumed',
          delta: -1,
          balanceAfter: profile.freezeBalance,
          createdAt: nowMs,
        });
      } else {
        if (profile.currentStreak > 0) {
          profile.currentStreak = 0;
          streakWasReset = true;
          changed = true;
        }

        // Write missed records near the break and near today for clear history without bloating writes
        const isNearToday = missedWindowCount - offset < MAX_MISSED_WRITES_AFTER_RESET;
        if (explicitMissedWritesAfterReset < 3 || isNearToday) {
          explicitMissedWritesAfterReset += 1;
          changed = true;
          createdOrUpdatedDays.push({
            dateKey,
            userId: profile.userId,
            status: 'missed',
            streakCount: 0,
            qualifyingActivitiesCount: 0,
            firstActivityType: '',
            firstActivityTitle: '',
            freezeAwarded: false,
            freezeConsumed: false,
            claimedAt: null,
            createdAt: nowMs,
            updatedAt: nowMs,
          });
        }
      }
    }
  }

  // Advance lastEvaluatedDate to yesterday (so today remains open until studied or midnight passes)
  const yesterdayKey = addDaysToDateKey(todayKey, -1);
  if (
    !profile.lastEvaluatedDate ||
    diffDateKeys(profile.lastEvaluatedDate, yesterdayKey) > 0
  ) {
    profile.lastEvaluatedDate = yesterdayKey;
    changed = true;
  }

  return {
    profile,
    createdOrUpdatedDays,
    newLedgerEntries,
    freezesConsumedCount,
    streakWasReset,
    autoClaimedStaleDay,
    changed,
  };
}

export interface QualifyingActivityResult {
  reconcile: ReconcileResult;
  profile: StreakProfile;
  todayRecord: DailyStreakRecord;
  shouldShowClaimModal: boolean;
  alreadyClaimedToday: boolean;
  isNewQualificationToday: boolean;
  pendingStreakCount: number;
}

/**
 * Evaluates a genuine completed learning activity for `todayKey`.
 *
 * - Runs missed-day reconciliation first.
 * - If today is already `'claimed'`: increments activity counter only (strictly idempotent).
 * - If today is already `'pending_claim'`: increments activity counter, preserves pending streak,
 *   and allows the claim modal to finish without duplicating rewards.
 * - If first qualifying activity of `todayKey`: prepares `'pending_claim'` with
 *   `nextStreak = currentStreak + 1` and triggers the animated Streak Claim modal.
 */
export function applyQualifyingActivity(
  rawProfile: StreakProfile,
  existingDays: Record<string, DailyStreakRecord>,
  todayKey: string,
  activity: {
    activityType: StudyActivityType;
    title: string;
  },
  nowMs: number = Date.now()
): QualifyingActivityResult {
  const reconcile = reconcileMissedDays(rawProfile, existingDays, todayKey, nowMs);
  const profile: StreakProfile = { ...reconcile.profile };

  const existingToday = existingDays[todayKey];

  // Case A: Already claimed today -> count extra activity, never increment streak or freeze again
  if (existingToday && existingToday.status === 'claimed') {
    const updatedToday: DailyStreakRecord = {
      ...existingToday,
      qualifyingActivitiesCount: existingToday.qualifyingActivitiesCount + 1,
      updatedAt: nowMs,
    };
    return {
      reconcile,
      profile,
      todayRecord: updatedToday,
      shouldShowClaimModal: false,
      alreadyClaimedToday: true,
      isNewQualificationToday: false,
      pendingStreakCount: profile.currentStreak,
    };
  }

  // Case B: Already qualified today and awaiting Claim tap -> keep exact pending streak
  if (existingToday && existingToday.status === 'pending_claim') {
    const pendingCount = Math.max(
      1,
      existingToday.streakCount || profile.pendingStreakCount || profile.currentStreak + 1
    );
    const updatedToday: DailyStreakRecord = {
      ...existingToday,
      qualifyingActivitiesCount: existingToday.qualifyingActivitiesCount + 1,
      updatedAt: nowMs,
    };
    profile.pendingClaimDate = todayKey;
    profile.pendingStreakCount = pendingCount;
    return {
      reconcile,
      profile,
      todayRecord: updatedToday,
      shouldShowClaimModal: true,
      alreadyClaimedToday: false,
      isNewQualificationToday: false,
      pendingStreakCount: pendingCount,
    };
  }

  // Case C: First qualifying learning activity of today
  const nextStreak = profile.currentStreak + 1;
  const newTodayRecord: DailyStreakRecord = {
    dateKey: todayKey,
    userId: profile.userId,
    status: 'pending_claim',
    streakCount: nextStreak,
    qualifyingActivitiesCount: 1,
    firstActivityType: activity.activityType,
    firstActivityTitle: activity.title.slice(0, 140),
    freezeAwarded: false,
    freezeConsumed: false,
    claimedAt: null,
    createdAt: nowMs,
    updatedAt: nowMs,
  };

  profile.pendingClaimDate = todayKey;
  profile.pendingStreakCount = nextStreak;
  profile.lastEvaluatedDate = todayKey;

  return {
    reconcile,
    profile,
    todayRecord: newTodayRecord,
    shouldShowClaimModal: true,
    alreadyClaimedToday: false,
    isNewQualificationToday: true,
    pendingStreakCount: nextStreak,
  };
}

export interface ClaimStreakResult {
  profile: StreakProfile;
  todayRecord: DailyStreakRecord | null;
  earnedLedgerEntry: FreezeLedgerEntry | null;
  alreadyClaimed: boolean;
  committedStreak: number;
}

/**
 * Confirms today's pending streak claim idempotently.
 * - Commits `currentStreak`, updates `longestStreak` and `totalStudyDays`.
 * - Awards strictly +1 internal streak freeze per qualifying calendar day (no upper cap).
 * - Duplicate calls for the same day are a safe no-op.
 */
export function applyClaimDailyStreak(
  rawProfile: StreakProfile,
  todayRecord: DailyStreakRecord | null,
  todayKey: string,
  nowMs: number = Date.now()
): ClaimStreakResult {
  if (!todayRecord || todayRecord.status === 'claimed') {
    const cleanedProfile: StreakProfile = {
      ...rawProfile,
      pendingClaimDate: rawProfile.pendingClaimDate === todayKey ? '' : rawProfile.pendingClaimDate,
      pendingStreakCount: rawProfile.pendingClaimDate === todayKey ? 0 : rawProfile.pendingStreakCount,
    };
    return {
      profile: cleanedProfile,
      todayRecord,
      earnedLedgerEntry: null,
      alreadyClaimed: true,
      committedStreak: rawProfile.currentStreak,
    };
  }

  if (todayRecord.status !== 'pending_claim') {
    return {
      profile: rawProfile,
      todayRecord,
      earnedLedgerEntry: null,
      alreadyClaimed: true,
      committedStreak: rawProfile.currentStreak,
    };
  }

  const nextStreak = Math.max(
    1,
    todayRecord.streakCount || rawProfile.pendingStreakCount || rawProfile.currentStreak + 1
  );
  const shouldAwardFreeze = !todayRecord.freezeAwarded;
  const nextFreezeBalance = Math.max(0, rawProfile.freezeBalance) + (shouldAwardFreeze ? 1 : 0);

  const updatedProfile: StreakProfile = {
    ...rawProfile,
    currentStreak: nextStreak,
    longestStreak: Math.max(rawProfile.longestStreak, nextStreak),
    totalStudyDays: rawProfile.totalStudyDays + 1,
    freezeBalance: nextFreezeBalance,
    lastQualifyingDate: todayKey,
    lastEvaluatedDate: todayKey,
    pendingClaimDate: '',
    pendingStreakCount: 0,
    updatedAt: nowMs,
  };

  const updatedToday: DailyStreakRecord = {
    ...todayRecord,
    status: 'claimed',
    streakCount: nextStreak,
    freezeAwarded: true,
    claimedAt: nowMs,
    updatedAt: nowMs,
  };

  const earnedLedgerEntry: FreezeLedgerEntry | null = shouldAwardFreeze
    ? {
        id: `earn_${todayKey}`,
        userId: rawProfile.userId,
        dateKey: todayKey,
        action: 'earned',
        delta: 1,
        balanceAfter: nextFreezeBalance,
        createdAt: nowMs,
      }
    : null;

  return {
    profile: updatedProfile,
    todayRecord: updatedToday,
    earnedLedgerEntry,
    alreadyClaimed: false,
    committedStreak: nextStreak,
  };
}

export type CalendarDayVisualState =
  | 'studied'
  | 'pending_claim'
  | 'frozen'
  | 'missed'
  | 'today_open'
  | 'future'
  | 'pre_account';

export interface CalendarDayCell {
  dateKey: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  visualState: CalendarDayVisualState;
  record: DailyStreakRecord | null;
}

/**
 * Builds a complete Sunday-through-Saturday month grid reflecting real persisted
 * historical daily records (never inferred from currentStreak).
 */
export function buildMonthCalendarGrid(
  year: number,
  monthIndex: number, // 0..11
  todayKey: string,
  dayRecords: Record<string, DailyStreakRecord>,
  accountCreatedDateKey: string
): CalendarDayCell[] {
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1, 12, 0, 0));
  const startWeekday = firstOfMonth.getUTCDay(); // 0=Sun..6=Sat
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0)).getUTCDate();

  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const cells: CalendarDayCell[] = [];

  const effectiveAccountStart =
    accountCreatedDateKey && isValidDateKey(accountCreatedDateKey)
      ? accountCreatedDateKey
      : todayKey;

  for (let i = 0; i < totalCells; i += 1) {
    const dayOffset = i - startWeekday;
    const dt = new Date(Date.UTC(year, monthIndex, 1 + dayOffset, 12, 0, 0));
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth();
    const d = dt.getUTCDate();
    const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const inCurrentMonth = m === monthIndex;
    const isToday = dateKey === todayKey;
    const record = dayRecords[dateKey] ?? null;

    let visualState: CalendarDayVisualState;
    const diffFromToday = diffDateKeys(todayKey, dateKey);

    if (record?.status === 'claimed') {
      visualState = 'studied';
    } else if (record?.status === 'pending_claim') {
      visualState = 'pending_claim';
    } else if (record?.status === 'frozen') {
      visualState = 'frozen';
    } else if (diffFromToday > 0) {
      visualState = 'future';
    } else if (isToday) {
      visualState = 'today_open';
    } else if (record?.status === 'missed') {
      visualState = 'missed';
    } else if (diffDateKeys(effectiveAccountStart, dateKey) < 0) {
      visualState = 'pre_account';
    } else {
      visualState = 'missed';
    }

    cells.push({
      dateKey,
      dayOfMonth: d,
      inCurrentMonth,
      isToday,
      visualState,
      record,
    });
  }

  return cells;
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

export function getNextStreakMilestone(currentStreak: number): {
  target: number;
  previous: number;
  progressPercent: number;
  daysRemaining: number;
} {
  for (let i = 0; i < STREAK_MILESTONES.length; i += 1) {
    const target = STREAK_MILESTONES[i];
    if (currentStreak < target) {
      const previous = i === 0 ? 0 : STREAK_MILESTONES[i - 1];
      const span = Math.max(1, target - previous);
      const progressPercent = Math.min(
        100,
        Math.max(0, Math.round(((currentStreak - previous) / span) * 100))
      );
      return {
        target,
        previous,
        progressPercent,
        daysRemaining: target - currentStreak,
      };
    }
  }
  // Beyond 365: next 100-day century mark
  const nextCentury = Math.ceil((currentStreak + 1) / 100) * 100;
  const prevCentury = nextCentury - 100;
  return {
    target: nextCentury,
    previous: prevCentury,
    progressPercent: Math.round(((currentStreak - prevCentury) / 100) * 100),
    daysRemaining: nextCentury - currentStreak,
  };
}
