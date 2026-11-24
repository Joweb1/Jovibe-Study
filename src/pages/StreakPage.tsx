import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Snowflake,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { useStreak } from '../context/StreakContext';
import { useRouter } from '../router/RouterContext';
import {
  buildMonthCalendarGrid,
  getNextStreakMilestone,
  type CalendarDayCell,
} from '../services/streak/streakEngine';
import { FlameArt, MiniFlameIcon } from '../components/streak/FlameArt';
import { Button } from '../components/ui/Button';
import { LoadingSkeleton } from '../components/ui/StateViews';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatDateKeyReadable(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

export const StreakPage: React.FC = () => {
  const {
    todayKey,
    currentStreak,
    longestStreak,
    totalStudyDays,
    accountCreatedDate,
    studiedToday,
    hasPendingClaimToday,
    pendingStreakCount,
    streakLoading,
    streakDays,
    openPendingClaimModal,
  } = useStreak();
  const { navigate } = useRouter();

  const [todayYear, todayMonth] = useMemo(() => {
    const [y, m] = todayKey.split('-').map(Number);
    return [y || new Date().getFullYear(), (m || new Date().getMonth() + 1) - 1];
  }, [todayKey]);

  const [viewYear, setViewYear] = useState(todayYear);
  const [viewMonth, setViewMonth] = useState(todayMonth);
  const [selectedCell, setSelectedCell] = useState<CalendarDayCell | null>(null);

  const calendarCells = useMemo(
    () =>
      buildMonthCalendarGrid(
        viewYear,
        viewMonth,
        todayKey,
        streakDays,
        accountCreatedDate
      ),
    [viewYear, viewMonth, todayKey, streakDays, accountCreatedDate]
  );

  const monthStats = useMemo(() => {
    let studied = 0;
    let frozen = 0;
    for (const cell of calendarCells) {
      if (!cell.inCurrentMonth) continue;
      if (cell.visualState === 'studied') studied += 1;
      else if (cell.visualState === 'frozen') frozen += 1;
    }
    return { studied, frozen };
  }, [calendarCells]);

  const milestone = useMemo(() => getNextStreakMilestone(currentStreak), [currentStreak]);

  const goPrevMonth = () => {
    setSelectedCell(null);
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    setSelectedCell(null);
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const isViewingCurrentMonth = viewYear === todayYear && viewMonth === todayMonth;

  const motivationalMessage = useMemo(() => {
    if (hasPendingClaimToday) {
      return 'You completed a qualifying study session today — claim your streak now!';
    }
    if (studiedToday) {
      if (currentStreak >= 100) return 'Extraordinary consistency. Your daily study habit is rock solid.';
      if (currentStreak >= 30) return 'A full month of discipline and counting. Keep the momentum alive.';
      if (currentStreak >= 7) return 'Strong weekly rhythm — today’s streak is secured.';
      return 'Today is locked in. Come back tomorrow to keep your flame burning.';
    }
    if (currentStreak > 0) {
      return 'Complete a quiz, flashcards deck, CBT drill, Automatic Study session, or AI Tutor exchange today to extend your streak.';
    }
    return 'Complete your first meaningful study session today to ignite Day 1 of your learning streak.';
  }, [hasPendingClaimToday, studiedToday, currentStreak]);

  if (streakLoading) {
    return <LoadingSkeleton lines={5} />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      {/* Top Back Navigation Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/courses')}
            aria-label="Back to Courses"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
              Study Streak
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Consistent daily learning across all your private &amp; shared courses
            </p>
          </div>
        </div>

        <Button variant="secondary" size="sm" onClick={() => navigate('/dashboard')}>
          <BarChart3 className="h-3.5 w-3.5" />
          Study Dashboard
        </Button>
      </div>

      {/* Hero Flame & Current Streak Card */}
      <section className="relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 opacity-85"
        />

        <div className="flex flex-col items-center text-center sm:flex-row sm:items-center sm:text-left sm:gap-8">
          <div className="shrink-0">
            <FlameArt
              mode={currentStreak > 0 || studiedToday || hasPendingClaimToday ? 'active' : 'dormant'}
              size="xl"
            />
          </div>

          <div className="mt-4 sm:mt-0 flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline justify-center sm:justify-start gap-2.5">
              <span className="font-display text-5xl sm:text-6xl font-bold tracking-tight tabular-nums bg-gradient-to-b from-amber-500 via-orange-500 to-red-600 bg-clip-text text-transparent">
                {currentStreak}
              </span>
              <span className="font-display text-lg font-medium text-zinc-700 dark:text-zinc-300">
                Day streak
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs font-medium">
              {hasPendingClaimToday ? (
                <span className="inline-flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  Day {pendingStreakCount} ready to claim
                </span>
              ) : studiedToday ? (
                <span className="inline-flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
                  <MiniFlameIcon active className="h-3.5 w-3.5" />
                  Studied today
                </span>
              ) : (
                <span className="text-zinc-500 dark:text-zinc-400">
                  {currentStreak > 0 ? 'Active · Study today to extend' : 'No active streak yet'}
                </span>
              )}
            </div>

            <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {motivationalMessage}
            </p>

            {hasPendingClaimToday && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={openPendingClaimModal}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 via-amber-500 to-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_6px_20px_rgba(249,115,22,0.3)] hover:brightness-105 transition-all cursor-pointer"
                >
                  Claim Day {pendingStreakCount} Streak
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Records & Milestone Progress */}
        <div className="mt-7 grid grid-cols-1 gap-4 border-t border-zinc-100 dark:border-zinc-800 pt-6 sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
              <Trophy className="h-5 w-5" />
            </span>
            <div>
              <div className="font-mono text-xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-100">
                {longestStreak}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">Longest streak</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
              <CalendarIcon className="h-5 w-5" />
            </span>
            <div>
              <div className="font-mono text-xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-100">
                {totalStudyDays}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">Total study days</div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                Next milestone: {milestone.target}d
              </span>
              <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                {milestone.daysRemaining}d left
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 transition-all duration-500"
                style={{ width: `${milestone.progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Monthly Streak Calendar */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              {monthStats.studied} studied {monthStats.studied === 1 ? 'day' : 'days'}
              {monthStats.frozen > 0
                ? ` · ${monthStats.frozen} protected ${monthStats.frozen === 1 ? 'day' : 'days'}`
                : ''}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {!isViewingCurrentMonth && (
              <button
                type="button"
                onClick={() => {
                  setViewYear(todayYear);
                  setViewMonth(todayMonth);
                  setSelectedCell(null);
                }}
                className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Today
              </button>
            )}
            <button
              type="button"
              onClick={goPrevMonth}
              aria-label="Previous month"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goNextMonth}
              aria-label="Next month"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Weekday Headers */}
        <div className="mt-4 grid grid-cols-7 gap-1 sm:gap-1.5 text-center">
          {WEEKDAY_LABELS.map((day) => (
            <div
              key={day}
              className="py-1 text-[10px] sm:text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="mt-1.5 grid grid-cols-7 gap-1 sm:gap-2">
          {calendarCells.map((cell) => {
            const isSelected = selectedCell?.dateKey === cell.dateKey;
            const isStudied = cell.visualState === 'studied';
            const isPending = cell.visualState === 'pending_claim';
            const isFrozen = cell.visualState === 'frozen';
            const isMissed = cell.visualState === 'missed';
            const isFuture = cell.visualState === 'future' || cell.visualState === 'pre_account';

            let cellStyle =
              'border-transparent bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-400 dark:text-zinc-600';

            if (!cell.inCurrentMonth) {
              cellStyle = 'border-transparent bg-transparent text-zinc-300 dark:text-zinc-700 opacity-45';
            } else if (isStudied) {
              cellStyle =
                'border-orange-200 dark:border-orange-900/70 bg-gradient-to-b from-amber-50 to-orange-50/90 dark:from-orange-950/50 dark:to-amber-950/30 text-orange-950 dark:text-orange-200';
            } else if (isPending) {
              cellStyle =
                'border-orange-400 dark:border-orange-600 bg-orange-50 dark:bg-orange-950/50 text-orange-900 dark:text-orange-200';
            } else if (isFrozen) {
              cellStyle =
                'border-sky-200 dark:border-sky-800/80 bg-gradient-to-b from-sky-50 to-cyan-50/90 dark:from-sky-950/55 dark:to-cyan-950/35 text-sky-900 dark:text-sky-200';
            } else if (isMissed) {
              cellStyle =
                'border-zinc-200/70 dark:border-zinc-800/80 bg-zinc-100/70 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-500';
            } else if (cell.isToday) {
              cellStyle =
                'border-zinc-900 dark:border-zinc-200 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100';
            } else if (isFuture) {
              cellStyle =
                'border-transparent bg-zinc-50/50 dark:bg-zinc-950/40 text-zinc-400 dark:text-zinc-600';
            }

            return (
              <button
                key={cell.dateKey}
                type="button"
                onClick={() => setSelectedCell(cell)}
                aria-label={`${formatDateKeyReadable(cell.dateKey)} — ${
                  isStudied
                    ? 'Studied'
                    : isPending
                    ? 'Ready to claim'
                    : isFrozen
                    ? 'Protected day'
                    : isMissed
                    ? 'Missed day'
                    : cell.isToday
                    ? 'Today'
                    : 'Upcoming'
                }`}
                className={`relative flex min-h-12 sm:min-h-14 py-1 flex-col items-center justify-center rounded-xl border text-xs transition-all cursor-pointer ${cellStyle} ${
                  cell.isToday
                    ? 'ring-2 ring-zinc-950/85 dark:ring-zinc-200/85 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900'
                    : ''
                } ${isSelected ? 'scale-[0.98] shadow-inner' : 'hover:brightness-97 dark:hover:brightness-110'}`}
              >
                <span className="font-mono text-[11px] sm:text-xs font-medium tabular-nums">
                  {cell.dayOfMonth}
                </span>
                <div className="mt-0.5 flex h-4 items-center justify-center">
                  {cell.inCurrentMonth && isStudied && (
                    <MiniFlameIcon active className="h-3.5 w-3.5" />
                  )}
                  {cell.inCurrentMonth && isPending && (
                    <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
                  )}
                  {cell.inCurrentMonth && isFrozen && (
                    <Snowflake className="h-3.5 w-3.5 text-sky-500 dark:text-sky-400" />
                  )}
                  {cell.inCurrentMonth && isMissed && (
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Day Detail Line */}
        {selectedCell && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-4 py-3 text-xs">
            <div className="font-medium text-zinc-900 dark:text-zinc-200">
              {formatDateKeyReadable(selectedCell.dateKey)}
              {selectedCell.isToday ? ' (Today)' : ''}
            </div>
            <div className="text-zinc-600 dark:text-zinc-400">
              {selectedCell.visualState === 'studied' && selectedCell.record ? (
                <span>
                  Studied · {selectedCell.record.qualifyingActivitiesCount}{' '}
                  {selectedCell.record.qualifyingActivitiesCount === 1 ? 'activity' : 'activities'}
                  {selectedCell.record.streakCount > 0
                    ? ` · Streak Day ${selectedCell.record.streakCount}`
                    : ''}
                </span>
              ) : selectedCell.visualState === 'pending_claim' ? (
                <button
                  type="button"
                  onClick={openPendingClaimModal}
                  className="font-medium text-orange-600 dark:text-orange-400 hover:underline cursor-pointer"
                >
                  Qualifying session completed — Claim streak
                </button>
              ) : selectedCell.visualState === 'frozen' ? (
                <span className="text-sky-600 dark:text-sky-400">
                  Protected day · Streak preserved
                </span>
              ) : selectedCell.visualState === 'missed' ? (
                <span>No qualifying study activity recorded</span>
              ) : selectedCell.visualState === 'today_open' ? (
                <span>Complete a study session today to light up this day</span>
              ) : (
                <span>Upcoming calendar day</span>
              )}
            </div>
          </div>
        )}

        {/* Clean Visual Legend */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-zinc-100 dark:border-zinc-800 pt-4 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <MiniFlameIcon active className="h-3.5 w-3.5" />
            Studied
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Snowflake className="h-3.5 w-3.5 text-sky-500 dark:text-sky-400" />
            Protected
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            Missed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border-2 border-zinc-900 dark:border-zinc-200" />
            Today
          </span>
        </div>
      </section>
    </div>
  );
};
