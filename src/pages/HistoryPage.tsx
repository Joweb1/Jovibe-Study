import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock,
  GraduationCap,
  Play,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  AutomaticStudySession,
  StudyHistoryRecord,
  StudyHistorySessionType,
} from '../types/models';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { useRouter } from '../router/RouterContext';
import { formatReadableError } from '../services/firebase/errors';
import {
  deleteStudyHistoryRecord,
  subscribeCourseHistory,
} from '../services/firebase/historyService';
import { subscribeCourseStudySessions } from '../services/firebase/automaticStudyService';
import { formatShortDate } from '../utils/validation';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EmptyState, ErrorBanner, LoadingSkeleton } from '../components/ui/StateViews';

const SESSION_TYPE_LABELS: Record<StudyHistorySessionType, string> = {
  tutor: 'AI Tutor',
  cbt: 'CBT',
  fill_in_the_gap: 'Fill in the Gap',
  flashcards: 'Flashcards',
  exam_prep: 'Exam Prep',
  automatic_study: 'Automatic Study',
};

const FILTER_OPTIONS: Array<{ value: StudyHistorySessionType | 'all'; label: string }> = [
  { value: 'all', label: 'All sessions' },
  { value: 'automatic_study', label: 'Automatic Study' },
  { value: 'cbt', label: 'CBT' },
  { value: 'fill_in_the_gap', label: 'Fill in the Gap' },
  { value: 'flashcards', label: 'Flashcards' },
  { value: 'exam_prep', label: 'Exam Prep' },
];

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe}s`;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

export const HistoryPage: React.FC = () => {
  const { user } = useAuth();
  const { activeCourse, coursesLoading, topics } = useCourses();
  const { navigate } = useRouter();

  const [records, setRecords] = useState<StudyHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [studySessions, setStudySessions] = useState<AutomaticStudySession[]>([]);

  const [typeFilter, setTypeFilter] = useState<StudyHistorySessionType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [recordToDelete, setRecordToDelete] = useState<StudyHistoryRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user?.uid || !activeCourse?.id) {
      setRecords([]);
      setStudySessions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setExpandedId(null);

    const unsubHistory = subscribeCourseHistory(
      user.uid,
      activeCourse.id,
      (list) => {
        setRecords(list);
        setLoading(false);
      },
      (err) => {
        setError(formatReadableError(err));
        setLoading(false);
      }
    );

    const unsubSessions = subscribeCourseStudySessions(
      user.uid,
      activeCourse.id,
      (list) => setStudySessions(list),
      () => {
        // Non-blocking secondary subscription
      }
    );

    return () => {
      unsubHistory();
      unsubSessions();
    };
  }, [user?.uid, activeCourse?.id]);

  const topicMap = useMemo(() => {
    const map = new Map<string, string>();
    topics.forEach((t) => map.set(t.id, t.name));
    return map;
  }, [topics]);

  const resumableSessions = useMemo(
    () => studySessions.filter((s) => s.status === 'active' || s.status === 'paused'),
    [studySessions]
  );

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records.filter((rec) => {
      if (typeFilter !== 'all' && rec.sessionType !== typeFilter) return false;
      if (q) {
        const hay = [rec.title, rec.summary, ...rec.weaknesses].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, typeFilter, searchQuery]);

  const analytics = useMemo(() => {
    const totalSessions = records.length;
    const totalSeconds = records.reduce((acc, r) => acc + (r.durationSeconds || 0), 0);
    const scoredRecords = records.filter((r) => r.maxScore > 0);
    const avgPercentage =
      scoredRecords.length > 0
        ? Math.round(
            scoredRecords.reduce((acc, r) => acc + (r.percentage || 0), 0) / scoredRecords.length
          )
        : null;

    const weaknessFreq = new Map<string, number>();
    records.forEach((rec) => {
      rec.weaknesses.forEach((w) => {
        const key = w.trim();
        if (!key) return;
        weaknessFreq.set(key, (weaknessFreq.get(key) || 0) + 1);
      });
    });

    const topWeaknesses = Array.from(weaknessFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    return { totalSessions, totalSeconds, avgPercentage, topWeaknesses };
  }, [records]);

  const handleResumeStudySession = (sessionId: string) => {
    try {
      sessionStorage.setItem('sotal_resume_study_session_id', sessionId);
    } catch {
      // Ignore storage quota errors
    }
    navigate('/automatic-study');
  };

  const handleConfirmDelete = async () => {
    if (!user || !activeCourse || !recordToDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteStudyHistoryRecord(user.uid, activeCourse.id, recordToDelete.id);
      if (expandedId === recordToDelete.id) {
        setExpandedId(null);
      }
      setRecordToDelete(null);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setDeleting(false);
    }
  };

  if (coursesLoading) {
    return <LoadingSkeleton lines={4} />;
  }

  if (!activeCourse || !user) {
    return (
      <div>
        <div className="flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-5">
          <button
            type="button"
            onClick={() => navigate('/library')}
            aria-label="Back to Library"
            title="Back to Library"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
            History
          </h1>
        </div>
        <EmptyState
          title="Select or create a course first"
          description="Study history is strictly scoped per course. Create a course in Library to start logging sessions."
          actionLabel="Go to Library"
          onAction={() => navigate('/library')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/library')}
            aria-label="Back to Library"
            title="Back to Library"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200 truncate">
            Study History & Progress
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate('/practice')}>
            Start practice
          </Button>
          <Button size="sm" onClick={() => navigate('/automatic-study')}>
            <GraduationCap className="h-3.5 w-3.5" />
            Automatic Study
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Resumable Automatic Study Sessions */}
      {resumableSessions.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              In-Progress & Paused Automatic Study
            </h2>
            <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
              {resumableSessions.length}
            </span>
          </div>
          <div className="border-t border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
            {resumableSessions.map((sess) => {
              const totalUnits = sess.studyPlan.length;
              const completedUnits = sess.completedUnitIds.length;
              return (
                <div
                  key={sess.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-medium text-zinc-900 dark:text-zinc-200 capitalize">{sess.status}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {completedUnits}/{totalUnits} units mastered
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{sess.difficulty}</span>
                      <span aria-hidden="true">·</span>
                      <span>Updated {formatShortDate(sess.updatedAt)}</span>
                    </div>
                    <h3 className="mt-1 text-base font-medium text-zinc-950 dark:text-zinc-200 truncate">
                      {sess.title}
                    </h3>
                    {sess.currentObjective && (
                      <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-1">
                        Next: {sess.currentObjective}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleResumeStudySession(sess.id)}
                    className="shrink-0"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume session
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Course Metrics Strip */}
      <section className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9.5rem),1fr))] gap-4 sm:gap-6 border-y border-zinc-200 dark:border-zinc-800 py-5 sm:grid-cols-4">
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Logged sessions</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-950 dark:text-zinc-200 tabular-nums">
            {analytics.totalSessions}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Average accuracy</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-950 dark:text-zinc-200 tabular-nums">
            {analytics.avgPercentage !== null ? `${analytics.avgPercentage}%` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Total study time</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-950 dark:text-zinc-200 tabular-nums">
            {analytics.totalSeconds > 0 ? formatDuration(analytics.totalSeconds) : '0m'}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Areas flagged for review</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-950 dark:text-zinc-200 tabular-nums">
            {analytics.topWeaknesses.length}
          </div>
        </div>
      </section>

      {/* Recurring Weaknesses (derived strictly from logged records) */}
      {analytics.topWeaknesses.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Recurring Weaknesses in {activeCourse.code}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {analytics.topWeaknesses.map(([topic, count]) => (
              <div
                key={topic}
                className="flex items-center justify-between gap-2 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-md px-3.5 py-2.5 text-sm"
              >
                <span className="text-zinc-900 dark:text-zinc-200 truncate">{topic}</span>
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
                  {count}x
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 sm:border-b-0">
          {FILTER_OPTIONS.map((opt) => {
            const active = typeFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTypeFilter(opt.value)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors cursor-pointer ${
                  active
                    ? 'bg-zinc-950 text-white dark:bg-zinc-200 dark:text-zinc-950 font-medium'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search history..."
            aria-label="Search study history"
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1.5 pl-8 pr-3 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
          />
        </div>
      </div>

      {/* History List */}
      {loading ? (
        <LoadingSkeleton lines={4} />
      ) : records.length === 0 ? (
        <EmptyState
          title={`No completed sessions in ${activeCourse.code} yet`}
          description="Complete a Flashcards deck, CBT test, Fill-in-the-Gap drill, Exam Prep rubric, or Automatic Study session to record real scores and progress here."
          actionLabel="Open Practice"
          onAction={() => navigate('/practice')}
        />
      ) : filteredRecords.length === 0 ? (
        <div className="border-t border-zinc-200 dark:border-zinc-800 py-10 text-sm text-zinc-500 dark:text-zinc-400">
          No study history records match your current filter.
        </div>
      ) : (
        <div className="border-t border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
          {filteredRecords.map((rec) => {
            const isExpanded = expandedId === rec.id;
            const topicNames = rec.topicIds
              .map((id) => topicMap.get(id))
              .filter(Boolean)
              .join(', ');

            return (
              <div key={rec.id} className="py-4">
                <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-3 sm:gap-4">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                    className="min-w-0 flex-1 basis-[220px] text-left cursor-pointer group"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1 font-medium text-zinc-900 dark:text-zinc-200">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        {SESSION_TYPE_LABELS[rec.sessionType]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{rec.status}</span>
                      {topicNames && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate max-w-full sm:max-w-xs">{topicNames}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Clock className="h-3 w-3" />
                        {formatDuration(rec.durationSeconds)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{formatShortDate(rec.updatedAt)}</span>
                    </div>

                    <h3 className="mt-1 text-base font-medium text-zinc-950 dark:text-zinc-200 break-words group-hover:underline underline-offset-4">
                      {rec.title}
                    </h3>

                    {rec.summary && (
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">{rec.summary}</p>
                    )}
                  </button>

                  <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                    <div className="text-right font-mono tabular-nums">
                      <div className="text-base font-semibold text-zinc-950 dark:text-zinc-200">
                        {rec.maxScore > 0 ? `${Math.round(rec.percentage)}%` : 'Logged'}
                      </div>
                      {rec.maxScore > 0 && (
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {rec.score}/{rec.maxScore}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setRecordToDelete(rec)}
                      aria-label={`Delete history record ${rec.title}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-700 dark:text-zinc-500 dark:hover:bg-red-950/40 dark:hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 ml-0 sm:ml-5 border-t border-zinc-100 dark:border-zinc-800 pt-4 space-y-4 text-sm">
                    <div className="grid grid-cols-1 min-[380px]:grid-cols-3 gap-3 sm:gap-4 max-w-md font-mono text-xs tabular-nums">
                      <div>
                        <span className="text-zinc-500 dark:text-zinc-400 block">Correct / Mastered</span>
                        <span className="text-zinc-950 dark:text-zinc-200 font-semibold text-sm">
                          {rec.correctCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 dark:text-zinc-400 block">Incorrect / Review</span>
                        <span className="text-zinc-950 dark:text-zinc-200 font-semibold text-sm">
                          {rec.incorrectCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 dark:text-zinc-400 block">Skipped</span>
                        <span className="text-zinc-950 dark:text-zinc-200 font-semibold text-sm">
                          {rec.skippedCount}
                        </span>
                      </div>
                    </div>

                    {rec.summary && (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          Session Summary
                        </div>
                        <p className="mt-1 text-zinc-800 dark:text-zinc-300 whitespace-pre-wrap">{rec.summary}</p>
                      </div>
                    )}

                    {rec.weaknesses.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          Weaknesses Identified
                        </div>
                        <ul className="mt-1.5 list-disc pl-5 space-y-1 text-zinc-700 dark:text-zinc-300">
                          {rec.weaknesses.map((w, idx) => (
                            <li key={`${rec.id}_w_${idx}`}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(recordToDelete)}
        title="Delete history record?"
        description={
          recordToDelete
            ? `Permanently delete "${recordToDelete.title}" from ${activeCourse.code} study history?`
            : undefined
        }
        onClose={() => setRecordToDelete(null)}
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            variant="secondary"
            onClick={() => setRecordToDelete(null)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleConfirmDelete()}
            loading={deleting}
          >
            Delete record
          </Button>
        </div>
      </Modal>
    </div>
  );
};
