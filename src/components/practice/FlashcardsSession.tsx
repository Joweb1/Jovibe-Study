import React, { useEffect, useRef, useState } from 'react';
import {
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
import { Button } from '../ui/Button';

interface FlashcardsSessionProps {
  userId: string;
  course: Course;
  topicIds: string[];
  initialCards: FlashcardItem[];
  references: SourceReference[];
  voiceEnabled: boolean;
  ttsVoice: GeminiTtsVoice;
  voiceRate: number;
  onExit: () => void;
}

type CardRating = 'known' | 'difficult';

export const FlashcardsSession: React.FC<FlashcardsSessionProps> = ({
  userId,
  course,
  topicIds,
  initialCards,
  references,
  voiceEnabled,
  ttsVoice,
  voiceRate,
  onExit,
}) => {
  const [queue, setQueue] = useState<FlashcardItem[]>(initialCards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [ratings, setRatings] = useState<Record<string, CardRating>>({});
  const [finished, setFinished] = useState(false);
  const [savingDeck, setSavingDeck] = useState(false);
  const [deckSaved, setDeckSaved] = useState(false);
  const [historyLogged, setHistoryLogged] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState>(() => geminiAudioPlayer.getState());
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => geminiAudioPlayer.subscribe(setPlayback), []);
  useEffect(() => () => geminiAudioPlayer.stop(), []);

  const currentCard = queue[index];
  const knownCount = Object.values(ratings).filter((r) => r === 'known').length;
  const difficultCards = initialCards.filter((c) => ratings[c.id] === 'difficult');

  const logSession = async (finalRatings: Record<string, CardRating>) => {
    if (historyLogged) return;
    setHistoryLogged(true);
    const known = Object.values(finalRatings).filter((r) => r === 'known').length;
    const difficult = Object.values(finalRatings).filter((r) => r === 'difficult').length;
    const weaknesses = initialCards
      .filter((c) => finalRatings[c.id] === 'difficult')
      .map((c) => c.conceptTag)
      .filter(Boolean);

    try {
      await createStudyHistoryRecord(userId, course.id, {
        sessionType: 'flashcards',
        title: `Flashcards — ${course.code} (${initialCards.length} cards)`,
        topicIds,
        status: 'completed',
        score: known,
        maxScore: initialCards.length,
        correctCount: known,
        incorrectCount: difficult,
        skippedCount: Math.max(0, initialCards.length - known - difficult),
        durationSeconds: Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
        summary: `Reviewed ${initialCards.length} flashcards: ${known} mastered, ${difficult} marked difficult.`,
        weaknesses: Array.from(new Set(weaknesses)),
        details: { cardCount: initialCards.length },
      });
    } catch {
      // Non-blocking history save
    }
  };

  const handleRate = (rating: CardRating) => {
    if (!currentCard) return;
    geminiAudioPlayer.stop();
    const nextRatings = { ...ratings, [currentCard.id]: rating };
    setRatings(nextRatings);
    setFlipped(false);
    setShowHint(false);

    if (index + 1 < queue.length) {
      setIndex(index + 1);
    } else {
      setFinished(true);
      void logSession(nextRatings);
    }
  };

  const handleShuffleRemaining = () => {
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
  };

  const handleRestartAll = () => {
    setQueue(initialCards);
    setIndex(0);
    setFlipped(false);
    setShowHint(false);
    setRatings({});
    setFinished(false);
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
        <div className="border-b border-zinc-200 pb-5">
          <div className="text-xs font-mono text-zinc-500 uppercase">Deck Complete</div>
          <h2 className="mt-1 font-display text-2xl font-semibold text-zinc-950">
            {knownCount} of {initialCards.length} mastered ({pct}%)
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Session recorded to your {course.code} Study History.
          </p>
        </div>

        {difficultCards.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Cards marked difficult ({difficultCards.length})
            </h3>
            <div className="divide-y divide-zinc-200 border-y border-zinc-200">
              {difficultCards.map((c) => (
                <div key={c.id} className="py-3 space-y-1">
                  <div className="text-sm font-medium text-zinc-950">{c.front}</div>
                  <div className="text-xs text-zinc-600">{c.back}</div>
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4">
        <div>
          <div className="text-xs text-zinc-500 tabular-nums">
            Card {index + 1} of {queue.length} · Known: {knownCount} · Difficult:{' '}
            {difficultCards.length}
          </div>
          <h2 className="font-display text-lg font-semibold text-zinc-950">
            Flashcards — {course.code}
          </h2>
        </div>
        <div className="flex items-center gap-2">
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
            className="min-h-[260px] flex flex-col justify-between rounded-md border border-zinc-300 bg-white p-6 sm:p-8 cursor-pointer hover:border-zinc-500 transition-colors"
          >
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="font-mono uppercase">{flipped ? 'Answer' : 'Prompt'}</span>
              <span>{currentCard.conceptTag}</span>
            </div>

            <div className="my-6 text-base sm:text-lg leading-relaxed text-zinc-950 font-medium">
              {flipped ? currentCard.back : currentCard.front}
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-500">
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
                  className="inline-flex items-center gap-1 hover:text-zinc-950"
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
            <div className="text-xs text-zinc-600">
              {showHint ? (
                <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3.5 py-2.5">
                  <strong className="font-medium text-zinc-900">Hint:</strong> {currentCard.hint}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowHint(true)}
                  className="underline underline-offset-2 hover:text-zinc-950"
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
