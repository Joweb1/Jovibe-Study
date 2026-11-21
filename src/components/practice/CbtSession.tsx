import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  Check,
  Flag,
  RotateCcw,
} from 'lucide-react';
import type { Course, SourceReference } from '../../types/models';
import type { CbtQuestionItem } from '../../services/ai/practiceGenerators';
import { createSavedStudyMaterial } from '../../services/firebase/savedMaterialService';
import { createStudyHistoryRecord } from '../../services/firebase/historyService';
import { useStreak } from '../../context/StreakContext';
import { useLockedSessionTimer } from '../../hooks/usePersistentTimer';
import { ActiveSessionTimerBar } from '../timer/StudyTimer';
import { Button } from '../ui/Button';

interface CbtSessionProps {
  userId: string;
  course: Course;
  sessionId: string;
  timeLimitMinutes: number;
  topicIds: string[];
  mode: 'practice' | 'exam';
  questions: CbtQuestionItem[];
  references: SourceReference[];
  onSessionComplete?: () => void;
  onExit: () => void;
}

export const CbtSession: React.FC<CbtSessionProps> = ({
  userId,
  course,
  sessionId,
  timeLimitMinutes,
  topicIds,
  mode,
  questions: initialQuestions,
  references,
  onSessionComplete,
  onExit,
}) => {
  const { recordLearningActivity } = useStreak();
  const [questions, setQuestions] = useState<CbtQuestionItem[]>(initialQuestions);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [attemptTimerKey, setAttemptTimerKey] = useState<string>(`sotal_timer_cbt_${sessionId}`);
  const [activeTimeLimitMinutes, setActiveTimeLimitMinutes] = useState<number>(timeLimitMinutes);
  const [savingSet, setSavingSet] = useState(false);
  const [setSaved, setSetSaved] = useState(false);

  const startedAtRef = useRef<number>(Date.now());
  const submittedRef = useRef(false);
  const answersRef = useRef<Record<string, number>>(answers);
  answersRef.current = answers;

  const finalizeExam = (currentAnswers: Record<string, number>, expiredByTimer = false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    if (expiredByTimer) {
      setTimedOut(true);
    }
    onSessionComplete?.();

    let correct = 0;
    let incorrect = 0;
    let skipped = 0;
    const missedConcepts: string[] = [];
    const missedDetails: Array<{
      question: string;
      chosen: string;
      correct: string;
      conceptTag: string;
    }> = [];

    for (const q of questions) {
      const chosen = currentAnswers[q.id];
      if (chosen === undefined) {
        skipped += 1;
        missedConcepts.push(q.conceptTag);
      } else if (chosen === q.correctIndex) {
        correct += 1;
      } else {
        incorrect += 1;
        missedConcepts.push(q.conceptTag);
        missedDetails.push({
          question: q.question,
          chosen: q.options[chosen] || '',
          correct: q.options[q.correctIndex] || '',
          conceptTag: q.conceptTag,
        });
      }
    }

    const answeredTotal = Object.keys(currentAnswers).length;
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    const pct = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
    const title = `CBT (${mode === 'exam' ? 'Exam' : 'Practice'}) — ${course.code}`;
    const summary = `Scored ${correct}/${questions.length} (${pct}%) in ${mode} mode${
      expiredByTimer ? ' (time limit reached)' : ''
    }.`;

    void createStudyHistoryRecord(userId, course.id, {
      sessionType: 'cbt',
      title,
      topicIds,
      status: 'completed',
      score: correct,
      maxScore: questions.length,
      correctCount: correct,
      incorrectCount: incorrect,
      skippedCount: skipped,
      durationSeconds,
      summary,
      weaknesses: Array.from(new Set(missedConcepts.filter(Boolean))),
      details: { mode, timedOut: expiredByTimer, missedDetails: missedDetails.slice(0, 20) },
    }).catch(() => {
      // Non-blocking history logging
    });

    // Only award streak & active learning credit if the student genuinely engaged with >= 1 question
    if (answeredTotal > 0) {
      void recordLearningActivity({
        activityType: 'cbt',
        title,
        courseId: course.id,
        courseCode: course.code,
        isSharedCourse: Boolean(course.isShared),
        durationSeconds,
        score: correct,
        maxScore: questions.length,
        summary,
      });
    }
  };

  const timer = useLockedSessionTimer({
    enabled: activeTimeLimitMinutes > 0,
    durationMinutes: activeTimeLimitMinutes,
    storageKey: attemptTimerKey,
    stopped: submitted,
    onExpire: () => finalizeExam(answersRef.current, true),
  });

  const currentQuestion = questions[currentIdx];
  const answeredCount = Object.keys(answers).length;

  const results = useMemo(() => {
    let correct = 0;
    let incorrect = 0;
    let skipped = 0;
    const missed: CbtQuestionItem[] = [];
    for (const q of questions) {
      const chosen = answers[q.id];
      if (chosen === undefined) {
        skipped += 1;
        missed.push(q);
      } else if (chosen === q.correctIndex) {
        correct += 1;
      } else {
        incorrect += 1;
        missed.push(q);
      }
    }
    return {
      correct,
      incorrect,
      skipped,
      missed,
      percentage: questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0,
      weaknesses: Array.from(new Set(missed.map((m) => m.conceptTag).filter(Boolean))),
    };
  }, [questions, answers]);

  const handleSelectOption = (questionId: string, optionIdx: number) => {
    if (submitted || timer.isExpired) return;
    if (mode === 'practice' && answers[questionId] !== undefined) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionIdx }));
  };

  const handleToggleFlag = (questionId: string) => {
    if (submitted || timer.isExpired) return;
    setFlagged((prev) => ({ ...prev, [questionId]: !prev[questionId] }));
  };

  const handleRetryMissed = () => {
    if (results.missed.length === 0) return;
    setQuestions(results.missed);
    setAnswers({});
    setFlagged({});
    setCurrentIdx(0);
    setSubmitted(false);
    setTimedOut(false);
    submittedRef.current = false;
    startedAtRef.current = Date.now();
    if (timeLimitMinutes > 0) {
      setActiveTimeLimitMinutes(Math.max(3, Math.min(timeLimitMinutes, results.missed.length * 2)));
      setAttemptTimerKey(`sotal_timer_cbt_${sessionId}_retry_${Date.now()}`);
    } else {
      setActiveTimeLimitMinutes(0);
    }
  };

  const handleSaveTest = async () => {
    setSavingSet(true);
    try {
      await createSavedStudyMaterial(userId, course.id, {
        topicId: topicIds[0] || '',
        title: `CBT Test: ${course.code} (${initialQuestions.length} questions)`,
        type: 'cbt',
        content: { questions: initialQuestions, mode },
        sourceReferences: references,
      });
      setSetSaved(true);
    } finally {
      setSavingSet(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-3xl space-y-6">
        {timedOut && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div>
              <div className="font-semibold">Time is up</div>
              <p className="text-xs opacity-90 mt-0.5">
                Your CBT session ended automatically and your answered questions were graded and saved.
              </p>
            </div>
          </div>
        )}

        <div className="border-b border-zinc-200 dark:border-zinc-800 pb-5 space-y-2">
          <div className="text-xs font-mono uppercase text-zinc-500 dark:text-zinc-400">
            CBT Results · {mode === 'exam' ? 'Exam Mode' : 'Practice Mode'}
          </div>
          <h2 className="font-display text-2xl font-semibold text-zinc-950 dark:text-zinc-200 tabular-nums">
            {results.correct} / {questions.length} ({results.percentage}%)
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
            <span>Correct: {results.correct}</span>
            <span aria-hidden="true">·</span>
            <span>Incorrect: {results.incorrect}</span>
            <span aria-hidden="true">·</span>
            <span>Skipped: {results.skipped}</span>
          </div>
        </div>

        {results.weaknesses.length > 0 && (
          <div className="border-b border-zinc-200 dark:border-zinc-800 pb-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">
              Concepts to review
            </div>
            <p className="text-sm text-zinc-800 dark:text-zinc-300">{results.weaknesses.join(' · ')}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          {results.missed.length > 0 && (
            <Button onClick={handleRetryMissed}>
              <RotateCcw className="h-3.5 w-3.5" />
              Retry missed ({results.missed.length})
            </Button>
          )}
          <Button
            variant="secondary"
            loading={savingSet}
            disabled={setSaved}
            onClick={() => void handleSaveTest()}
          >
            {setSaved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
            {setSaved ? 'Saved to Materials' : 'Save CBT set'}
          </Button>
          <Button variant="ghost" onClick={onExit}>
            Back to Practice
          </Button>
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border-t border-zinc-200 dark:border-zinc-800">
          {questions.map((q, idx) => {
            const chosen = answers[q.id];
            const isCorrect = chosen === q.correctIndex;
            return (
              <div key={q.id} className="py-5 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-200">
                    {idx + 1}. {q.question}
                  </div>
                  <span
                    className={`text-xs font-mono shrink-0 ${
                      isCorrect
                        ? 'text-zinc-900 dark:text-emerald-400 font-semibold'
                        : 'text-red-700 dark:text-red-400 font-semibold'
                    }`}
                  >
                    {isCorrect ? 'Correct' : chosen === undefined ? 'Skipped' : 'Incorrect'}
                  </span>
                </div>

                <div className="space-y-1 pl-2 text-xs">
                  {q.options.map((opt, oi) => {
                    const isRight = oi === q.correctIndex;
                    const isPicked = oi === chosen;
                    return (
                      <div
                        key={oi}
                        className={`px-2.5 py-1.5 rounded ${
                          isRight
                            ? 'bg-zinc-100 dark:bg-zinc-800 font-semibold text-zinc-950 dark:text-zinc-200'
                            : isPicked
                            ? 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
                            : 'text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        {String.fromCharCode(65 + oi)}. {opt}
                        {isRight ? ' ✓' : isPicked ? ' (Your choice)' : ''}
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{q.explanation}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const chosenForCurrent = currentQuestion ? answers[currentQuestion.id] : undefined;
  const showImmediateFeedback = mode === 'practice' && chosenForCurrent !== undefined;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            Question {currentIdx + 1} of {questions.length} · Answered {answeredCount}/{questions.length}
          </div>
          <h2 className="font-display text-lg font-semibold text-zinc-950 dark:text-zinc-200">
            CBT {mode === 'exam' ? 'Exam Mode' : 'Practice Mode'} — {course.code}
          </h2>
        </div>

        <div className="flex items-center gap-2.5">
          {activeTimeLimitMinutes > 0 && (
            <ActiveSessionTimerBar
              remainingSeconds={timer.remainingSeconds}
              isWarning={timer.isWarning}
              isUrgent={timer.isUrgent}
            />
          )}
          <Button size="sm" onClick={() => finalizeExam(answers, false)}>
            Submit test
          </Button>
          <Button variant="ghost" size="sm" onClick={onExit}>
            Exit
          </Button>
        </div>
      </div>

      {/* Question Navigator Grid */}
      <div className="flex flex-wrap gap-1.5">
        {questions.map((q, idx) => {
          const isCurrent = idx === currentIdx;
          const isAnswered = answers[q.id] !== undefined;
          const isFlagged = Boolean(flagged[q.id]);
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => setCurrentIdx(idx)}
              className={`h-8 w-8 rounded border font-mono text-xs tabular-nums transition-colors cursor-pointer ${
                isCurrent
                  ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950 font-semibold'
                  : isFlagged
                  ? 'border-zinc-900 bg-zinc-100 text-zinc-950 dark:border-zinc-400 dark:bg-zinc-800 dark:text-zinc-200 underline'
                  : isAnswered
                  ? 'border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200'
                  : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600'
              }`}
              title={isFlagged ? 'Flagged for review' : isAnswered ? 'Answered' : 'Unanswered'}
            >
              {idx + 1}
            </button>
          );
        })}
      </div>

      {currentQuestion && (
        <div className="space-y-4 border-t border-zinc-200 dark:border-zinc-800 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{currentQuestion.conceptTag}</div>
              <h3 className="text-base font-medium leading-relaxed text-zinc-950 dark:text-zinc-200">
                {currentIdx + 1}. {currentQuestion.question}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => handleToggleFlag(currentQuestion.id)}
              className={`inline-flex items-center gap-1 text-xs shrink-0 cursor-pointer ${
                flagged[currentQuestion.id]
                  ? 'font-semibold text-zinc-950 dark:text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <Flag className="h-3.5 w-3.5" />
              {flagged[currentQuestion.id] ? 'Flagged' : 'Flag'}
            </button>
          </div>

          <div className="space-y-2">
            {currentQuestion.options.map((opt, oi) => {
              const isSelected = chosenForCurrent === oi;
              const isCorrectOption = oi === currentQuestion.correctIndex;

              let styleClass =
                'border-zinc-200 bg-white text-zinc-800 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600';
              if (showImmediateFeedback) {
                if (isCorrectOption) {
                  styleClass =
                    'border-zinc-950 bg-zinc-100 text-zinc-950 dark:border-emerald-600/70 dark:bg-emerald-950/30 dark:text-emerald-200 font-medium';
                } else if (isSelected) {
                  styleClass =
                    'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300';
                }
              } else if (isSelected) {
                styleClass =
                  'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950 font-medium';
              }

              return (
                <button
                  key={oi}
                  type="button"
                  onClick={() => handleSelectOption(currentQuestion.id, oi)}
                  className={`w-full rounded-md border px-4 py-3 text-left text-sm transition-colors flex items-start gap-3 cursor-pointer ${styleClass}`}
                >
                  <span className="font-mono text-xs pt-0.5 shrink-0">
                    {String.fromCharCode(65 + oi)}.
                  </span>
                  <span className="flex-1">{opt}</span>
                  {showImmediateFeedback && isCorrectOption && (
                    <Check className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>

          {showImmediateFeedback && (
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              <div className="font-semibold text-zinc-950 dark:text-zinc-200">
                {chosenForCurrent === currentQuestion.correctIndex
                  ? 'Correct'
                  : `Incorrect — Correct option is ${String.fromCharCode(65 + currentQuestion.correctIndex)}`}
              </div>
              <p>{currentQuestion.explanation}</p>
              {currentQuestion.sourceCitation && (
                <p className="text-zinc-500 dark:text-zinc-400">Source: {currentQuestion.sourceCitation}</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={currentIdx === 0}
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
            >
              Previous
            </Button>

            {currentIdx + 1 < questions.length ? (
              <Button size="sm" onClick={() => setCurrentIdx((i) => i + 1)}>
                Next question
              </Button>
            ) : (
              <Button size="sm" onClick={() => finalizeExam(answers)}>
                Finish &amp; grade
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
