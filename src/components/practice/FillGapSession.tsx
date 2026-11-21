import React, { useRef, useState } from 'react';
import { AlertCircle, Bookmark, BookmarkCheck, Check, RotateCcw } from 'lucide-react';
import type { Course, SourceReference } from '../../types/models';
import {
  evaluateFillGapAnswer,
  type FillGapItem,
  type GapEvaluationResult,
} from '../../services/ai/practiceGenerators';
import { createSavedStudyMaterial } from '../../services/firebase/savedMaterialService';
import { createStudyHistoryRecord } from '../../services/firebase/historyService';
import { useStreak } from '../../context/StreakContext';
import { useLockedSessionTimer } from '../../hooks/usePersistentTimer';
import { ActiveSessionTimerBar } from '../timer/StudyTimer';
import { Button } from '../ui/Button';

interface FillGapSessionProps {
  userId: string;
  course: Course;
  sessionId: string;
  timeLimitMinutes: number;
  topicIds: string[];
  model: string;
  items: FillGapItem[];
  references: SourceReference[];
  onSessionComplete?: () => void;
  onExit: () => void;
}

export const FillGapSession: React.FC<FillGapSessionProps> = ({
  userId,
  course,
  sessionId,
  timeLimitMinutes,
  topicIds,
  model,
  items: initialItems,
  references,
  onSessionComplete,
  onExit,
}) => {
  const { recordLearningActivity } = useStreak();
  const [items, setItems] = useState<FillGapItem[]>(initialItems);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<
    Record<string, { answer: string; evaluation: GapEvaluationResult }>
  >({});
  const [finished, setFinished] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [attemptTimerKey, setAttemptTimerKey] = useState<string>(`sotal_timer_fg_${sessionId}`);
  const [activeTimeLimitMinutes, setActiveTimeLimitMinutes] = useState<number>(timeLimitMinutes);
  const [savingSet, setSavingSet] = useState(false);
  const [setSaved, setSetSaved] = useState(false);

  const startedAtRef = useRef<number>(Date.now());
  const historyLoggedRef = useRef(false);
  const resultsRef = useRef(results);
  resultsRef.current = results;

  const currentItem = items[index];
  const currentResult = currentItem ? results[currentItem.id] : undefined;

  const logHistory = async (
    finalResults: Record<string, { answer: string; evaluation: GapEvaluationResult }>,
    expiredByTimer = false
  ) => {
    if (historyLoggedRef.current) return;
    historyLoggedRef.current = true;
    onSessionComplete?.();

    const checkedTotal = Object.keys(finalResults).length;
    let score = 0;
    let correct = 0;
    let incorrect = 0;
    const weaknesses: string[] = [];

    for (const item of items) {
      const r = finalResults[item.id];
      if (!r) {
        incorrect += 1;
        weaknesses.push(item.conceptTag);
      } else {
        score += r.evaluation.score;
        if (r.evaluation.isCorrect) {
          correct += 1;
        } else {
          incorrect += 1;
          weaknesses.push(item.conceptTag);
        }
      }
    }

    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    const title = `Fill in the Gap — ${course.code} (${items.length} items)`;
    const summary = `Completed ${checkedTotal}/${items.length} fill-in-the-gap drills: ${correct} correct, ${incorrect} needing review${
      expiredByTimer ? ' (time limit reached)' : ''
    }.`;

    try {
      await createStudyHistoryRecord(userId, course.id, {
        sessionType: 'fill_in_the_gap',
        title,
        topicIds,
        status: 'completed',
        score,
        maxScore: items.length,
        correctCount: correct,
        incorrectCount: incorrect,
        skippedCount: Math.max(0, items.length - checkedTotal),
        durationSeconds,
        summary,
        weaknesses: Array.from(new Set(weaknesses.filter(Boolean))),
        details: { itemCount: items.length, timedOut: expiredByTimer },
      });
    } catch {
      // Non-blocking history save
    }

    if (checkedTotal > 0) {
      void recordLearningActivity({
        activityType: 'fill_in_the_gap',
        title,
        courseId: course.id,
        courseCode: course.code,
        isSharedCourse: Boolean(course.isShared),
        durationSeconds,
        score: Math.round(score * 10) / 10,
        maxScore: items.length,
        summary,
      });
    }
  };

  const timer = useLockedSessionTimer({
    enabled: activeTimeLimitMinutes > 0,
    durationMinutes: activeTimeLimitMinutes,
    storageKey: attemptTimerKey,
    stopped: finished,
    onExpire: () => {
      setTimedOut(true);
      setFinished(true);
      void logHistory(resultsRef.current, true);
    },
  });

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentItem || checking || finished || timer.isExpired) return;
    setChecking(true);
    try {
      const evaluation = await evaluateFillGapAnswer({
        item: currentItem,
        studentAnswer: input,
        model,
      });
      setResults((prev) => ({
        ...prev,
        [currentItem.id]: { answer: input.trim(), evaluation },
      }));
    } finally {
      setChecking(false);
    }
  };

  const handleNext = () => {
    if (finished || timer.isExpired) return;
    setInput('');
    setShowHint(false);
    if (index + 1 < items.length) {
      setIndex(index + 1);
    } else {
      setFinished(true);
      void logHistory(results, false);
    }
  };

  const missedItems = items.filter((item) => !results[item.id]?.evaluation.isCorrect);
  const totalScore = items.reduce((sum, item) => sum + (results[item.id]?.evaluation.score ?? 0), 0);

  const handleRetryMissed = () => {
    if (missedItems.length === 0) return;
    setItems(missedItems);
    setIndex(0);
    setInput('');
    setShowHint(false);
    setResults({});
    setFinished(false);
    setTimedOut(false);
    historyLoggedRef.current = false;
    startedAtRef.current = Date.now();
    if (timeLimitMinutes > 0) {
      setActiveTimeLimitMinutes(timeLimitMinutes);
      setAttemptTimerKey(`sotal_timer_fg_${sessionId}_retry_${Date.now()}`);
    }
  };

  const handleSaveSet = async () => {
    setSavingSet(true);
    try {
      await createSavedStudyMaterial(userId, course.id, {
        topicId: topicIds[0] || '',
        title: `Fill in the Gap: ${course.code} (${initialItems.length} items)`,
        type: 'fill_in_the_gap',
        content: { items: initialItems },
        sourceReferences: references,
      });
      setSetSaved(true);
    } finally {
      setSavingSet(false);
    }
  };

  if (finished) {
    const pct = items.length > 0 ? Math.round((totalScore / items.length) * 100) : 0;
    return (
      <div className="max-w-2xl space-y-6">
        {timedOut && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div>
              <div className="font-semibold">Time is up</div>
              <p className="text-xs opacity-90 mt-0.5">
                Your timed gap-fill session ended automatically and your completed answers were saved.
              </p>
            </div>
          </div>
        )}

        <div className="border-b border-zinc-200 dark:border-zinc-800 pb-5">
          <div className="text-xs font-mono uppercase text-zinc-500 dark:text-zinc-400">Fill in the Gap Complete</div>
          <h2 className="mt-1 font-display text-2xl font-semibold text-zinc-950 dark:text-zinc-200 tabular-nums">
            {totalScore.toFixed(1)} / {items.length} ({pct}%)
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Recorded in your {course.code} Study History.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {missedItems.length > 0 && (
            <Button onClick={handleRetryMissed}>
              <RotateCcw className="h-3.5 w-3.5" />
              Retry missed ({missedItems.length})
            </Button>
          )}
          <Button
            variant="secondary"
            loading={savingSet}
            disabled={setSaved}
            onClick={() => void handleSaveSet()}
          >
            {setSaved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
            {setSaved ? 'Saved' : 'Save set'}
          </Button>
          <Button variant="ghost" onClick={onExit}>
            Back to Practice
          </Button>
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border-t border-zinc-200 dark:border-zinc-800">
          {items.map((item, idx) => {
            const res = results[item.id];
            return (
              <div key={item.id} className="py-4 space-y-1.5">
                <div className="text-sm text-zinc-950 dark:text-zinc-200">
                  {idx + 1}. {item.sentenceWithBlank}
                </div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  Your answer:{' '}
                  <span className="font-medium text-zinc-900 dark:text-zinc-200">{res?.answer || '(blank)'}</span> ·
                  Expected:{' '}
                  <span className="font-semibold text-zinc-950 dark:text-zinc-200">{item.expectedAnswer}</span>
                </div>
                {res && <p className="text-xs text-zinc-600 dark:text-zinc-400">{res.evaluation.feedback}</p>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            Item {index + 1} of {items.length}
          </div>
          <h2 className="font-display text-lg font-semibold text-zinc-950 dark:text-zinc-200">
            Fill in the Gap — {course.code}
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
          <Button variant="ghost" size="sm" onClick={onExit}>
            Exit
          </Button>
        </div>
      </div>

      {currentItem && (
        <div className="space-y-5">
          <div className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 space-y-3">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{currentItem.conceptTag}</div>
            <p className="text-base leading-relaxed text-zinc-950 dark:text-zinc-200">
              {currentItem.sentenceWithBlank}
            </p>
            {currentItem.sourceCitation && (
              <div className="text-xs text-zinc-400 dark:text-zinc-500">{currentItem.sourceCitation}</div>
            )}
          </div>

          {!currentResult ? (
            <form onSubmit={handleCheck} className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={checking || timer.isExpired}
                  placeholder="Type the missing concept or term..."
                  autoFocus
                  className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                />
                <Button type="submit" loading={checking} disabled={!input.trim() || timer.isExpired}>
                  Check answer
                </Button>
              </div>
              {currentItem.hint && (
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  {showHint ? (
                    <span>Hint: {currentItem.hint}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowHint(true)}
                      className="underline underline-offset-2 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      Show hint
                    </button>
                  )}
                </div>
              )}
            </form>
          ) : (
            <div className="space-y-4">
              <div
                className={`rounded-md border p-4 space-y-1.5 text-sm ${
                  currentResult.evaluation.isCorrect
                    ? 'border-zinc-300 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
                    : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                }`}
              >
                <div className="font-semibold flex items-center gap-1.5">
                  {currentResult.evaluation.isCorrect && <Check className="h-4 w-4" />}
                  {currentResult.evaluation.isCorrect
                    ? 'Correct'
                    : currentResult.evaluation.isPartiallyCorrect
                    ? 'Partially correct (0.5 pts)'
                    : 'Incorrect'}
                </div>
                <p className="text-xs leading-relaxed">{currentResult.evaluation.feedback}</p>
                <div className="text-xs pt-1">
                  <strong>Expected:</strong> {currentItem.expectedAnswer}
                  {currentItem.acceptableSynonyms.length > 0 && (
                    <span className="opacity-80">
                      {' '}
                      (Also accepted: {currentItem.acceptableSynonyms.join(', ')})
                    </span>
                  )}
                </div>
              </div>

              <Button onClick={handleNext}>
                {index + 1 < items.length ? 'Next exercise' : 'View summary'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
