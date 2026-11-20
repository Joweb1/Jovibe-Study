import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Check,
  Clock,
  Flag,
  RotateCcw,
} from 'lucide-react';
import type { Course, SourceReference } from '../../types/models';
import type { CbtQuestionItem } from '../../services/ai/practiceGenerators';
import { createSavedStudyMaterial } from '../../services/firebase/savedMaterialService';
import { createStudyHistoryRecord } from '../../services/firebase/historyService';
import { Button } from '../ui/Button';

interface CbtSessionProps {
  userId: string;
  course: Course;
  topicIds: string[];
  mode: 'practice' | 'exam';
  examMinutes: number;
  questions: CbtQuestionItem[];
  references: SourceReference[];
  onExit: () => void;
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const CbtSession: React.FC<CbtSessionProps> = ({
  userId,
  course,
  topicIds,
  mode,
  examMinutes,
  questions: initialQuestions,
  references,
  onExit,
}) => {
  const [questions, setQuestions] = useState<CbtQuestionItem[]>(initialQuestions);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(examMinutes * 60);
  const [savingSet, setSavingSet] = useState(false);
  const [setSaved, setSetSaved] = useState(false);

  const startedAtRef = useRef<number>(Date.now());
  const submittedRef = useRef(false);

  const finalizeExam = (currentAnswers: Record<string, number>) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);

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

    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    const pct = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;

    void createStudyHistoryRecord(userId, course.id, {
      sessionType: 'cbt',
      title: `CBT (${mode === 'exam' ? 'Exam' : 'Practice'}) — ${course.code}`,
      topicIds,
      status: 'completed',
      score: correct,
      maxScore: questions.length,
      correctCount: correct,
      incorrectCount: incorrect,
      skippedCount: skipped,
      durationSeconds,
      summary: `Scored ${correct}/${questions.length} (${pct}%) in ${mode} mode.`,
      weaknesses: Array.from(new Set(missedConcepts.filter(Boolean))),
      details: { mode, missedDetails: missedDetails.slice(0, 20) },
    }).catch(() => {
      // Non-blocking history logging
    });
  };

  // Countdown timer strictly in Exam Mode
  useEffect(() => {
    if (mode !== 'exam' || submitted) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          finalizeExam(answers);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, submitted]);

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
    if (submitted) return;
    if (mode === 'practice' && answers[questionId] !== undefined) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionIdx }));
  };

  const handleToggleFlag = (questionId: string) => {
    setFlagged((prev) => ({ ...prev, [questionId]: !prev[questionId] }));
  };

  const handleRetryMissed = () => {
    if (results.missed.length === 0) return;
    setQuestions(results.missed);
    setAnswers({});
    setFlagged({});
    setCurrentIdx(0);
    setSubmitted(false);
    submittedRef.current = false;
    startedAtRef.current = Date.now();
    setRemainingSeconds(Math.max(5, results.missed.length * 2) * 60);
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
        <div className="border-b border-zinc-200 pb-5 space-y-2">
          <div className="text-xs font-mono uppercase text-zinc-500">
            CBT Results · {mode === 'exam' ? 'Exam Mode' : 'Practice Mode'}
          </div>
          <h2 className="font-display text-2xl font-semibold text-zinc-950 tabular-nums">
            {results.correct} / {questions.length} ({results.percentage}%)
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600 tabular-nums">
            <span>Correct: {results.correct}</span>
            <span aria-hidden="true">·</span>
            <span>Incorrect: {results.incorrect}</span>
            <span aria-hidden="true">·</span>
            <span>Skipped: {results.skipped}</span>
          </div>
        </div>

        {results.weaknesses.length > 0 && (
          <div className="border-b border-zinc-200 pb-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Concepts to review
            </div>
            <p className="text-sm text-zinc-800">{results.weaknesses.join(' · ')}</p>
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

        <div className="divide-y divide-zinc-200 border-t border-zinc-200">
          {questions.map((q, idx) => {
            const chosen = answers[q.id];
            const isCorrect = chosen === q.correctIndex;
            return (
              <div key={q.id} className="py-5 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-medium text-zinc-950">
                    {idx + 1}. {q.question}
                  </div>
                  <span
                    className={`text-xs font-mono shrink-0 ${
                      isCorrect ? 'text-zinc-900 font-semibold' : 'text-red-700 font-semibold'
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
                            ? 'bg-zinc-100 font-semibold text-zinc-950'
                            : isPicked
                            ? 'bg-red-50 text-red-800'
                            : 'text-zinc-600'
                        }`}
                      >
                        {String.fromCharCode(65 + oi)}. {opt}
                        {isRight ? ' ✓' : isPicked ? ' (Your choice)' : ''}
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs leading-relaxed text-zinc-600">{q.explanation}</p>
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4">
        <div>
          <div className="text-xs text-zinc-500 tabular-nums">
            Question {currentIdx + 1} of {questions.length} · Answered {answeredCount}/{questions.length}
          </div>
          <h2 className="font-display text-lg font-semibold text-zinc-950">
            CBT {mode === 'exam' ? 'Exam Mode' : 'Practice Mode'} — {course.code}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {mode === 'exam' && (
            <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-zinc-950 tabular-nums">
              <Clock className="h-3.5 w-3.5" />
              {formatClock(remainingSeconds)}
            </span>
          )}
          <Button size="sm" onClick={() => finalizeExam(answers)}>
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
              className={`h-8 w-8 rounded border font-mono text-xs tabular-nums transition-colors ${
                isCurrent
                  ? 'border-zinc-950 bg-zinc-950 text-white font-semibold'
                  : isFlagged
                  ? 'border-zinc-900 bg-zinc-100 text-zinc-950 underline'
                  : isAnswered
                  ? 'border-zinc-400 bg-zinc-100 text-zinc-900'
                  : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400'
              }`}
              title={isFlagged ? 'Flagged for review' : isAnswered ? 'Answered' : 'Unanswered'}
            >
              {idx + 1}
            </button>
          );
        })}
      </div>

      {currentQuestion && (
        <div className="space-y-4 border-t border-zinc-200 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs text-zinc-500">{currentQuestion.conceptTag}</div>
              <h3 className="text-base font-medium leading-relaxed text-zinc-950">
                {currentIdx + 1}. {currentQuestion.question}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => handleToggleFlag(currentQuestion.id)}
              className={`inline-flex items-center gap-1 text-xs shrink-0 ${
                flagged[currentQuestion.id]
                  ? 'font-semibold text-zinc-950'
                  : 'text-zinc-500 hover:text-zinc-900'
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

              let styleClass = 'border-zinc-200 bg-white text-zinc-800 hover:border-zinc-400';
              if (showImmediateFeedback) {
                if (isCorrectOption) {
                  styleClass = 'border-zinc-950 bg-zinc-100 text-zinc-950 font-medium';
                } else if (isSelected) {
                  styleClass = 'border-red-300 bg-red-50 text-red-900';
                }
              } else if (isSelected) {
                styleClass = 'border-zinc-950 bg-zinc-950 text-white font-medium';
              }

              return (
                <button
                  key={oi}
                  type="button"
                  onClick={() => handleSelectOption(currentQuestion.id, oi)}
                  className={`w-full rounded-md border px-4 py-3 text-left text-sm transition-colors flex items-start gap-3 ${styleClass}`}
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
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 space-y-1 text-xs leading-relaxed text-zinc-700">
              <div className="font-semibold text-zinc-950">
                {chosenForCurrent === currentQuestion.correctIndex
                  ? 'Correct'
                  : `Incorrect — Correct option is ${String.fromCharCode(65 + currentQuestion.correctIndex)}`}
              </div>
              <p>{currentQuestion.explanation}</p>
              {currentQuestion.sourceCitation && (
                <p className="text-zinc-500">Source: {currentQuestion.sourceCitation}</p>
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
