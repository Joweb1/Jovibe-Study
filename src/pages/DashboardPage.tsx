import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  GraduationCap,
  Layers,
  MessageSquare,
  Mic,
  PenTool,
  Timer,
  Users,
} from 'lucide-react';
import type { StudyActivityType } from '../types/models';
import { useStreak } from '../context/StreakContext';
import { useRouter } from '../router/RouterContext';
import { addDaysToDateKey } from '../services/streak/streakEngine';
import { formatHumanDuration } from '../hooks/usePersistentTimer';
import { formatShortDate } from '../utils/validation';
import { MiniFlameIcon } from '../components/streak/FlameArt';
import { StudyTimer } from '../components/timer/StudyTimer';
import { LoadingSkeleton } from '../components/ui/StateViews';

const ACTIVITY_META: Record<
  StudyActivityType,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  cbt: { label: 'CBT & Quizzes', icon: CheckCircle2 },
  flashcards: { label: 'Flashcards', icon: Layers },
  fill_in_the_gap: { label: 'Fill in the Gap', icon: PenTool },
  exam_prep: { label: 'Oral Exam Prep', icon: Mic },
  automatic_study: { label: 'Automatic Study', icon: GraduationCap },
  tutor: { label: 'AI Tutor', icon: MessageSquare },
  live: { label: 'Jovibe Live', icon: AudioLines },
  shared_library: { label: 'Shared Library', icon: Users },
};

type ActivityFilter = 'all' | 'practice' | 'study_tutor' | 'shared';
type ChartMetric = 'time' | 'activities';

function formatLiveClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${secs}s`;
}

function shortDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey.slice(-2);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return `${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

export const DashboardPage: React.FC = () => {
  const {
    todayKey,
    currentStreak,
    longestStreak,
    totalStudyDays,
    studiedToday,
    hasPendingClaimToday,
    pendingStreakCount,
    streakLoading,
    studyActivities,
    activitiesLoading,
    todayAppSeconds,
    totalAppSeconds,
    todayActiveLearningSeconds,
    totalActiveLearningSeconds,
    appUsageDays,
    openPendingClaimModal,
  } = useStreak();
  const { navigate } = useRouter();

  const [chartMetric, setChartMetric] = useState<ChartMetric>('time');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');

  // Breakdown counts from real persisted completed activities
  const breakdown = useMemo(() => {
    const counts: Record<StudyActivityType, number> = {
      cbt: 0,
      flashcards: 0,
      fill_in_the_gap: 0,
      exam_prep: 0,
      automatic_study: 0,
      tutor: 0,
      live: 0,
      shared_library: 0,
    };
    let sharedCourseTotal = 0;

    for (const act of studyActivities) {
      if (act.activityType in counts) {
        counts[act.activityType] += 1;
      }
      if (act.isSharedCourse || act.activityType === 'shared_library') {
        sharedCourseTotal += 1;
      }
    }
    return { counts, sharedCourseTotal };
  }, [studyActivities]);

  // Last 14 calendar days chart data (strictly real persisted data)
  const last14Days = useMemo(() => {
    const activityCountsByDate: Record<string, number> = {};
    for (const act of studyActivities) {
      activityCountsByDate[act.dateKey] = (activityCountsByDate[act.dateKey] || 0) + 1;
    }

    const series: Array<{
      dateKey: string;
      shortLabel: string;
      appMinutes: number;
      activities: number;
      isToday: boolean;
    }> = [];

    for (let offset = -13; offset <= 0; offset += 1) {
      const dk = addDaysToDateKey(todayKey, offset);
      const isToday = dk === todayKey;
      const appSec = isToday ? todayAppSeconds : appUsageDays[dk]?.appSeconds ?? 0;
      series.push({
        dateKey: dk,
        shortLabel: shortDayLabel(dk),
        appMinutes: Math.round((appSec / 60) * 10) / 10,
        activities: activityCountsByDate[dk] || 0,
        isToday,
      });
    }
    return series;
  }, [todayKey, todayAppSeconds, appUsageDays, studyActivities]);

  const chartMax = useMemo(() => {
    const vals = last14Days.map((d) => (chartMetric === 'time' ? d.appMinutes : d.activities));
    return Math.max(1, ...vals);
  }, [last14Days, chartMetric]);

  const filteredActivities = useMemo(() => {
    return studyActivities.filter((act) => {
      if (activityFilter === 'all') return true;
      if (activityFilter === 'practice') {
        return (
          act.activityType === 'cbt' ||
          act.activityType === 'flashcards' ||
          act.activityType === 'fill_in_the_gap' ||
          act.activityType === 'exam_prep'
        );
      }
      if (activityFilter === 'study_tutor') {
        return (
          act.activityType === 'automatic_study' ||
          act.activityType === 'tutor' ||
          act.activityType === 'live'
        );
      }
      if (activityFilter === 'shared') {
        return act.isSharedCourse || act.activityType === 'shared_library';
      }
      return true;
    });
  }, [studyActivities, activityFilter]);

  if (streakLoading && activitiesLoading) {
    return <LoadingSkeleton lines={5} />;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
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
              Study Dashboard
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Personal learning analytics, time tracking, and focus timer
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => (hasPendingClaimToday ? openPendingClaimModal() : navigate('/streak'))}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-950 dark:text-zinc-100 hover:border-orange-400 dark:hover:border-orange-600 transition-colors cursor-pointer"
        >
          <MiniFlameIcon active={currentStreak > 0 || studiedToday || hasPendingClaimToday} className="h-4 w-4" />
          <span className="font-mono tabular-nums">
            {hasPendingClaimToday
              ? `Claim Day ${pendingStreakCount}`
              : `${currentStreak}-day streak`}
          </span>
        </button>
      </div>

      {/* Primary KPI Summary Strip (Strictly Real Persisted Data) */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Time in App (Live Foreground) */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>Time in app (today)</span>
            <Clock className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums text-zinc-950 dark:text-zinc-100">
            {formatLiveClock(todayAppSeconds)}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            Lifetime: {formatHumanDuration(totalAppSeconds)}
          </div>
        </div>

        {/* Active Learning Time (Measured Separately from Completed Sessions) */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>Active learning time</span>
            <Timer className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums text-zinc-950 dark:text-zinc-100">
            {formatHumanDuration(totalActiveLearningSeconds)}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            Today: {formatHumanDuration(todayActiveLearningSeconds)}
          </div>
        </div>

        {/* Study Streak */}
        <button
          type="button"
          onClick={() => navigate('/streak')}
          className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 text-left hover:border-orange-300 dark:hover:border-orange-700 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>Current streak</span>
            <MiniFlameIcon active={currentStreak > 0 || studiedToday} className="h-4 w-4" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-zinc-950 dark:text-zinc-100">
              {currentStreak}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {currentStreak === 1 ? 'day' : 'days'}
            </span>
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            Best: {longestStreak}d · {totalStudyDays} total study days
          </div>
        </button>

        {/* Completed Activities */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>Completed activities</span>
            <BookOpen className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums text-zinc-950 dark:text-zinc-100">
            {studyActivities.length}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            Shared library: {breakdown.sharedCourseTotal}
          </div>
        </div>
      </section>

      {/* Main 2-Column Workspace: Chart & Breakdown + Reusable Study Timer */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 space-y-6">
          {/* 14-Day Activity & Time Chart */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-100">
                  Last 14 days
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {chartMetric === 'time'
                    ? 'Daily foreground Time in app (minutes)'
                    : 'Daily completed learning activities'}
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setChartMetric('time')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                    chartMetric === 'time'
                      ? 'bg-zinc-950 text-white dark:bg-zinc-200 dark:text-zinc-950'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  Time in app
                </button>
                <button
                  type="button"
                  onClick={() => setChartMetric('activities')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                    chartMetric === 'activities'
                      ? 'bg-zinc-950 text-white dark:bg-zinc-200 dark:text-zinc-950'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  Activities
                </button>
              </div>
            </div>

            <div className="mt-6 flex h-44 items-end gap-1.5 sm:gap-2.5">
              {last14Days.map((day) => {
                const rawVal = chartMetric === 'time' ? day.appMinutes : day.activities;
                const heightPct = rawVal > 0 ? Math.max(8, Math.round((rawVal / chartMax) * 100)) : 3;
                return (
                  <div
                    key={day.dateKey}
                    className="group relative flex flex-1 flex-col items-center h-full justify-end"
                    title={`${day.shortLabel}: ${
                      chartMetric === 'time'
                        ? `${day.appMinutes} min in app`
                        : `${day.activities} ${day.activities === 1 ? 'activity' : 'activities'}`
                    }`}
                  >
                    <div className="mb-1 text-[10px] font-mono tabular-nums text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      {chartMetric === 'time' ? `${Math.round(day.appMinutes)}m` : day.activities}
                    </div>
                    <div
                      className={`w-full max-w-[26px] rounded-t-md transition-all duration-300 ${
                        rawVal === 0
                          ? 'bg-zinc-100 dark:bg-zinc-800/80'
                          : day.isToday
                          ? 'bg-gradient-to-t from-orange-500 to-amber-400'
                          : 'bg-zinc-900 dark:bg-zinc-300 group-hover:bg-orange-500 dark:group-hover:bg-amber-400'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span
                      className={`mt-2 text-[10px] tabular-nums ${
                        day.isToday
                          ? 'font-semibold text-zinc-950 dark:text-zinc-100'
                          : 'text-zinc-400 dark:text-zinc-500'
                      }`}
                    >
                      {day.dateKey.slice(-2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Activity Type Breakdown */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6">
            <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-100">
              Learning breakdown
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Completed activities recorded across your courses
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(Object.keys(ACTIVITY_META) as StudyActivityType[]).map((type) => {
                const meta = ACTIVITY_META[type];
                const Icon = meta.icon;
                const count =
                  type === 'shared_library'
                    ? breakdown.sharedCourseTotal
                    : breakdown.counts[type];

                return (
                  <div
                    key={type}
                    className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 p-3.5"
                  >
                    <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
                      <Icon className="h-4 w-4" />
                      <span className="font-mono text-lg font-semibold tabular-nums text-zinc-950 dark:text-zinc-100">
                        {count}
                      </span>
                    </div>
                    <div className="mt-2 truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {meta.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right Rail: Reusable Standalone Study Timer */}
        <aside className="lg:col-span-4 space-y-6">
          <StudyTimer
            storageKey="sotal_dashboard_study_timer_v1"
            defaultMinutes={25}
            title="Focus Study Timer"
          />
        </aside>
      </div>

      {/* Recent Activity Log */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-4">
          <div>
            <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-100">
              Recent activity
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Verified completed sessions that contribute to your study streak
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {(
              [
                { id: 'all' as const, label: 'All' },
                { id: 'practice' as const, label: 'Practice & CBT' },
                { id: 'study_tutor' as const, label: 'Study & Tutor' },
                { id: 'shared' as const, label: 'Shared Library' },
              ]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActivityFilter(tab.id)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                  activityFilter === tab.id
                    ? 'bg-zinc-950 text-white dark:bg-zinc-200 dark:text-zinc-950'
                    : 'border border-zinc-200 dark:border-zinc-700 text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredActivities.length === 0 ? (
          <div className="py-12 text-center">
            <FileText className="mx-auto h-7 w-7 text-zinc-300 dark:text-zinc-700" />
            <p className="mt-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              No completed study activities yet
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Finish a CBT test, flashcards deck, Automatic Study unit, AI Tutor exchange, or shared course session to see your real progress here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filteredActivities.slice(0, 25).map((act) => {
              const meta = ACTIVITY_META[act.activityType] || ACTIVITY_META.cbt;
              const Icon = meta.icon;
              const hasScore = act.score !== null && act.maxScore !== null && act.maxScore > 0;
              return (
                <div
                  key={act.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">
                          {meta.label}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{act.courseCode}</span>
                        {act.isSharedCourse && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-sky-600 dark:text-sky-400 font-medium">
                              Shared
                            </span>
                          </>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-sm font-medium text-zinc-950 dark:text-zinc-100">
                        {act.title}
                      </p>
                      {act.summary && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {act.summary}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-right font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                    {hasScore && (
                      <span className="font-semibold text-zinc-900 dark:text-zinc-200">
                        {act.score}/{act.maxScore}
                      </span>
                    )}
                    {act.durationSeconds > 0 && (
                      <span>{formatHumanDuration(act.durationSeconds)}</span>
                    )}
                    <span>{formatShortDate(act.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
