import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  Check,
  RotateCcw,
  Shuffle,
  Volume2,
} from 'lucide-react';
import type { Course, GeminiTtsVoice, SourceReference } from '../../types/models';
import type { FlashcardItem } from '../../services/ai/practiceGenerators';
import { geminiAudioPlayer, type PlaybackState } from '../../services/ai/audioService';
import { createSavedStudyMaterial } from '../../services/firebase/savedMaterialService';
import { createStudyHistoryRecord } from '../../services/firebase/historyService';
import { useStreak } from '../../context/StreakContext';
import { useLockedSessionTimer } from '../../hooks/usePersistentTimer';
import { ActiveSessionTimerBar } from '../timer/StudyTimer';
import { Button } from '../ui/Button';

interface FlashcardsSessionProps {
  userId: string;
  course: Course;
  sessionId: string;
  timeLimitMinutes: number;
  topicIds: string[];
  initialCards: FlashcardItem[];
  references: SourceReference[];
  voiceEnabled: boolean;
  ttsVoice: GeminiTtsVoice;
  voiceRate: number;
  onSessionComplete?: () => void;
  onExit: () => void;
}

type CardRating = 'known' | 'difficult';

export const FlashcardsSession: React.FC<FlashcardsSessionProps> = ({
  userId,
  course,
  sessionId,
  timeLimitMinutes,
  topicIds,
  initialCards,
  references,
  voiceEnabled,
  ttsVoice,
  voiceRate,
  onSessionComplete,
  onExit,
}) => {
  const { recordLearningActivity } = useStreak();
  const [queue, setQueue] = useState<FlashcardItem[]>(initialCards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [ratings, setRatings] = useState<Record<string, CardRating>>({});
  const [finished, setFinished] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [attemptTimerKey, setAttemptTimerKey] = useState<string>(`sotal_timer_fc_${sessionId}`);
  const [activeTimeLimitMinutes, setActiveTimeLimitMinutes] = useState<number>(timeLimitMinutes);
  const [savingDeck, setSavingDeck] = useState(false);
  const [deckSaved, setDeckSaved] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState>(() => geminiAudioPlayer.getState());
  const startedAtRef = useRef<number>(Date.now());
  const historyLoggedRef = useRef(false);
  const ratingsRef = useRef<Record<string, CardRating>>(ratings);
  ratingsRef.current = ratings;

  useEffect(() => geminiAudioPlayer.subscribe(setPlayback), []);
  useEffect(() => () => geminiAudioPlayer.stop(), []);

  const currentCard = queue[index];
  const knownCount = Object.values(ratings).filter((r) => r === 'known').length;
  const difficultCards = initialCards.filter((c) => ratings[c.id] === 'difficult');

  const logSession = async (finalRatings: Record<string, CardRating>, expiredByTimer = false) => {
    if (historyLoggedRef.current) return;
    historyLoggedRef.current = true;
    onSessionComplete?.();

    const ratedTotal = Object.keys(finalRatings).length;
    const known = Object.values(finalRatings).filter((r) => r === 'known').length;
    const difficult = Object.values(finalRatings).filter((r) => r === 'difficult').length;
    const weaknesses = initialCards
      .filter((c) => finalRatings[c.id] === 'difficult')
      .map((c) => c.conceptTag)
      .filter(Boolean);
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    const title = `Flashcards — ${course.code} (${initialCards.length} cards)`;
    const summary = `Reviewed ${ratedTotal}/${initialCards.length} flashcards: ${known} mastered, ${difficult} marked difficult${
      expiredByTimer ? ' (time limit reached)' : ''
    }.`;

    try {
      await createStudyHistoryRecord(userId, course.id, {
        sessionType: 'flashcards',
        title,
        topicIds,
        status: 'completed',
        score: known,
        maxScore: initialCards.length,
        correctCount: known,
        incorrectCount: difficult,
        skippedCount: Math.max(0, initialCards.length - known - difficult),
        durationSeconds,
        summary,
        weaknesses: Array.from(new Set(weaknesses)),
        details: { cardCount: initialCards.length, timedOut: expiredByTimer },
      });
    } catch {
      // Non-blocking history save
    }

    if (ratedTotal > 0) {
      void recordLearningActivity({
        activityType: 'flashcards',
        title,
        courseId: course.id,
        courseCode: course.code,
        isSharedCourse: Boolean(course.isShared),
        durationSeconds,
        score: known,
        maxScore: initialCards.length,
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
      geminiAudioPlayer.stop();
      setTimedOut(true);
      setFinished(true);
      void logSession(ratingsRef.current, true);
    },
  });

  const handleRate = (rating: CardRating) => {
    if (!currentCard || finished || timer.isExpired) return;
    geminiAudioPlayer.stop();
    const nextRatings = { ...ratings, [currentCard.id]: rating };
    setRatings(nextRatings);
    setFlipped(false);
    setShowHint(false);

    if (index + 1 < queue.length) {
      setIndex(index + 1);
    } else {
      setFinished(true);
      void logSession(nextRatings, false);
    }
  };

  const handleShuffleRemaining = () => {
    if (finished || timer.isExpired) return;
    const remaining = [...queue.slice(index)];
    for (let i = remaining.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    setQueue([...queue.slice(0, index), ...remaining]);
    setFlipped(false);
    setShowHint(false);
  };

  const handleRepeatDifficult = () => {
    if (difficultCards.length === 0) return;
    setQueue(difficultCards);
    setIndex(0);
    setFlipped(false);
    setShowHint(false);
    setFinished(false);
    setTimedOut(false);
    historyLoggedRef.current = false;
    startedAtRef.current = Date.now();
    if (timeLimitMinutes > 0) {
      setActiveTimeLimitMinutes(timeLimitMinutes);
      setAttemptTimerKey(`sotal_timer_fc_${sessionId}_repeat_${Date.now()}`);
    }
  };

  const handleRestartAll = () => {
    setQueue(initialCards);
    setIndex(0);
    setFlipped(false);
    setShowHint(false);
    setRatings({});
    setFinished(false);
    setTimedOut(false);
    historyLoggedRef.current = false;
    startedAtRef.current = Date.now();
    if (timeLimitMinutes > 0) {
      setActiveTimeLimitMinutes(timeLimitMinutes);
      setAttemptTimerKey(`sotal_timer_fc_${sessionId}_restart_${Date.now()}`);
    }
  };

  const handleSaveDeck = async () => {
    setSavingDeck(true);
    try {
      await createSavedStudyMaterial(userId, course.id, {
        topicId: topicIds[0] || '',
        title: `Flashcards: ${course.code} (${initialCards.length} cards)`,
        type: 'flashcards',
        content: { cards: initialCards },
        sourceReferences: references,
      });
      setDeckSaved(true);
    } finally {
      setSavingDeck(false);
    }
  };

  if (finished) {
    const pct = initialCards.length > 0 ? Math.round((knownCount / initialCards.length) * 100) : 0;
    return (
      <div className="max-w-2xl space-y-6">
        {timedOut && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div>
              <div className="font-semibold">Time is up</div>
              <p className="text-xs opacity-90 mt-0.5">
                Your timed flashcard session ended automatically and your rated cards were saved.
              </p>
            </div>
          </div>
        )}

        <div className="border-b border-zinc-200 dark:border-zinc-800 pb-5">
          <div className="text-xs font-mono text-zinc-500 dark:text-zinc-400 uppercase">Deck Complete</div>
          <h2 className="mt-1 font-display text-2xl font-semibold text-zinc-950 dark:text-zinc-200">
            {knownCount} of {initialCards.length} mastered ({pct}%)
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Session recorded to your {course.code} Study History.
          </p>
        </div>

        {difficultCards.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Cards marked difficult ({difficultCards.length})
            </h3>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border-y border-zinc-200 dark:border-zinc-800">
              {difficultCards.map((c) => (
                <div key={c.id} className="py-3 space-y-1">
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-200">{c.front}</div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">{c.back}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          {difficultCards.length > 0 && (
            <Button onClick={handleRepeatDifficult}>
              <RotateCcw className="h-3.5 w-3.5" />
              Repeat difficult ({difficultCards.length})
            </Button>
          )}
          <Button variant="secondary" onClick={handleRestartAll}>
            Restart full deck
          </Button>
          <Button
            variant="secondary"
            loading={savingDeck}
            disabled={deckSaved}
            onClick={() => void handleSaveDeck()}
          >
            {deckSaved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
            {deckSaved ? 'Deck saved' : 'Save deck'}
          </Button>
          <Button variant="ghost" onClick={onExit}>
            Back to Practice
          </Button>
        </div>
      </div>
    );
  }

  const audioId = currentCard ? `fc_${currentCard.id}_${flipped ? 'back' : 'front'}` : '';

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            Card {index + 1} of {queue.length} · Known: {knownCount} · Difficult:{' '}
            {difficultCards.length}
          </div>
          <h2 className="font-display text-lg font-semibold text-zinc-950 dark:text-zinc-200">
            Flashcards — {course.code}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {activeTimeLimitMinutes > 0 && (
            <ActiveSessionTimerBar
              remainingSeconds={timer.remainingSeconds}
              isWarning={timer.isWarning}
              isUrgent={timer.isUrgent}
            />
          )}
          <Button variant="ghost" size="sm" onClick={handleShuffleRemaining}>
            <Shuffle className="h-3.5 w-3.5" />
            Shuffle
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={savingDeck}
            disabled={deckSaved}
            onClick={() => void handleSaveDeck()}
          >
            {deckSaved ? <Check className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
            {deckSaved ? 'Saved' : 'Save deck'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onExit}>
            Exit
          </Button>
        </div>
      </div>

      {currentCard && (
        <div className="space-y-4">
          <div
            onClick={() => setFlipped((prev) => !prev)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setFlipped((prev) => !prev);
              }
            }}
            className="min-h-[260px] flex flex-col justify-between rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 sm:p-8 cursor-pointer hover:border-zinc-500 dark:hover:border-zinc-500 transition-colors"
          >
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-mono uppercase">{flipped ? 'Answer' : 'Prompt'}</span>
              <span>{currentCard.conceptTag}</span>
            </div>

            <div className="my-6 text-base sm:text-lg leading-relaxed text-zinc-950 dark:text-zinc-200 font-medium">
              {flipped ? currentCard.back : currentCard.front}
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>{flipped ? currentCard.sourceCitation || 'Click to view prompt' : 'Click card to reveal answer'}</span>
              {voiceEnabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void geminiAudioPlayer.playMessage({
                      id: audioId,
                      text: flipped ? currentCard.back : currentCard.front,
                      voiceName: ttsVoice,
                      playbackRate: voiceRate,
                    });
                  }}
                  className="inline-flex items-center gap-1 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>
                    {playback.activeId === audioId && playback.status === 'loading'
                      ? 'Loading...'
                      : playback.activeId === audioId && playback.status === 'playing'
                      ? 'Pause'
                      : 'Listen'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {!flipped && currentCard.hint && (
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              {showHint ? (
                <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2.5">
                  <strong className="font-medium text-zinc-900 dark:text-zinc-200">Hint:</strong> {currentCard.hint}
                </div>
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

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            {!flipped ? (
              <Button onClick={() => setFlipped(true)}>Reveal answer</Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5">
                <Button variant="secondary" onClick={() => handleRate('difficult')}>
                  Still difficult (repeat later)
                </Button>
                <Button onClick={() => handleRate('known')}>
                  <Check className="h-3.5 w-3.5" />
                  I knew this
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
