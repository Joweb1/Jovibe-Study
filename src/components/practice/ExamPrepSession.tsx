import React, { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Mic,
  Pause,
  Play,
  Send,
  Square,
  Volume2,
} from 'lucide-react';
import type {
  Course,
  DifficultyLevel,
  GeminiTtsVoice,
  SourceReference,
  StudySource,
} from '../../types/models';
import {
  evaluateOralExamAnswer,
  generateOralExamQuestion,
  type OralEvaluationResult,
  type OralQuestionItem,
} from '../../services/ai/practiceGenerators';
import { transcribeAudioWithClient } from '../../services/ai/geminiClient';
import {
  geminiAudioPlayer,
  VoiceNoteRecorder,
  type PlaybackState,
} from '../../services/ai/audioService';
import { createSavedStudyMaterial } from '../../services/firebase/savedMaterialService';
import { createStudyHistoryRecord } from '../../services/firebase/historyService';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/StateViews';

interface ExamPrepSessionProps {
  userId: string;
  course: Course;
  sources: StudySource[];
  topicIds: string[];
  difficulty: DifficultyLevel;
  totalQuestions: number;
  customInstructions: string;
  model: string;
  voiceEnabled: boolean;
  ttsVoice: GeminiTtsVoice;
  voiceRate: number;
  firstQuestion: OralQuestionItem;
  references: SourceReference[];
  onExit: () => void;
}

interface CompletedOralTurn {
  question: OralQuestionItem;
  studentAnswer: string;
  evaluation: OralEvaluationResult;
}

export const ExamPrepSession: React.FC<ExamPrepSessionProps> = ({
  userId,
  course,
  sources,
  topicIds,
  difficulty,
  totalQuestions,
  customInstructions,
  model,
  voiceEnabled,
  ttsVoice,
  voiceRate,
  firstQuestion,
  references,
  onExit,
}) => {
  const [questionNumber, setQuestionNumber] = useState(1);
  const [currentQuestion, setCurrentQuestion] = useState<OralQuestionItem>(firstQuestion);
  const [answer, setAnswer] = useState('');
  const [latestEvaluation, setLatestEvaluation] = useState<OralEvaluationResult | null>(null);
  const [turns, setTurns] = useState<CompletedOralTurn[]>([]);
  const [grading, setGrading] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [savingTranscript, setSavingTranscript] = useState(false);
  const [transcriptSaved, setTranscriptSaved] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState>(() => geminiAudioPlayer.getState());

  const recorderRef = useRef<VoiceNoteRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => geminiAudioPlayer.subscribe(setPlayback), []);
  useEffect(() => {
    return () => {
      geminiAudioPlayer.stop();
      if (timerRef.current) window.clearInterval(timerRef.current);
      recorderRef.current?.cancel();
    };
  }, []);

  const handleSubmitAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim() || grading) return;
    setGrading(true);
    setError(null);
    geminiAudioPlayer.stop();
    try {
      const evaluation = await evaluateOralExamAnswer({
        course,
        question: currentQuestion,
        studentAnswer: answer.trim(),
        difficulty,
        model,
      });
      setLatestEvaluation(evaluation);
      setTurns((prev) => [
        ...prev,
        { question: currentQuestion, studentAnswer: answer.trim(), evaluation },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to grade oral response.');
    } finally {
      setGrading(false);
    }
  };

  const handleNextOrFinish = async () => {
    geminiAudioPlayer.stop();
    if (questionNumber >= totalQuestions) {
      setFinished(true);
      const totalScore = turns.reduce((sum, t) => sum + t.evaluation.score, 0);
      const maxScore = turns.length * 10;
      const strongCount = turns.filter((t) => t.evaluation.score >= 7).length;
      const weaknesses = turns
        .filter((t) => t.evaluation.score < 7)
        .map((t) => t.question.focusConcept);

      void createStudyHistoryRecord(userId, course.id, {
        sessionType: 'exam_prep',
        title: `Oral Exam Prep — ${course.code} (${turns.length} questions)`,
        topicIds,
        status: 'completed',
        score: totalScore,
        maxScore,
        correctCount: strongCount,
        incorrectCount: turns.length - strongCount,
        skippedCount: 0,
        durationSeconds: Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
        summary: `Averaged ${(totalScore / Math.max(1, turns.length)).toFixed(1)}/10 across ${turns.length} oral exam questions.`,
        weaknesses: Array.from(new Set(weaknesses.filter(Boolean))),
        details: {
          difficulty,
          turnSummaries: turns.map((t) => ({
            concept: t.question.focusConcept,
            score: t.evaluation.score,
          })),
        },
      }).catch(() => {});
      return;
    }

    setLoadingNext(true);
    setError(null);
    try {
      const nextNum = questionNumber + 1;
      const { item } = await generateOralExamQuestion({
        course,
        sources,
        topicIds,
        difficulty,
        customInstructions,
        questionNumber: nextNum,
        totalQuestions,
        priorQuestions: turns.map((t) => ({
          question: t.question.question,
          focusConcept: t.question.focusConcept,
          score: t.evaluation.score,
        })),
        model,
      });
      setCurrentQuestion(item);
      setQuestionNumber(nextNum);
      setAnswer('');
      setLatestEvaluation(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate next oral exam question.');
    } finally {
      setLoadingNext(false);
    }
  };

  const handleToggleRecording = async () => {
    if (isRecording) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      setIsRecording(false);
      setRecordingSec(0);
      if (!recorder) return;

      setTranscribing(true);
      setError(null);
      try {
        const audio = await recorder.stop();
        const res = await transcribeAudioWithClient({
          audioBase64: audio.audioBase64,
          mimeType: audio.mimeType,
          courseContextHint: `${course.code} ${course.name} ${currentQuestion.focusConcept}`,
        });
        if (res.text) {
          setAnswer((prev) => (prev.trim() ? `${prev.trim()} ${res.text}` : res.text));
        } else {
          setError('No clear speech detected. Please speak clearly and try again.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Transcription failed.');
      } finally {
        setTranscribing(false);
      }
      return;
    }

    setError(null);
    geminiAudioPlayer.stop();
    try {
      const recorder = new VoiceNoteRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSec(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSec((s) => s + 1);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not access microphone.');
    }
  };

  const handleSaveTranscript = async () => {
    setSavingTranscript(true);
    try {
      const markdown = turns
        .map(
          (t, i) =>
            `## Question ${i + 1}: ${t.question.focusConcept} (${t.evaluation.score}/10)\n\n` +
            `**Examiner:** ${t.question.question}\n\n` +
            `**Your response:** ${t.studentAnswer}\n\n` +
            `**Coaching note:** ${t.evaluation.coachingNote}\n\n` +
            `**Model answer:** ${t.evaluation.modelAnswer}`
        )
        .join('\n\n---\n\n');

      await createSavedStudyMaterial(userId, course.id, {
        topicId: topicIds[0] || '',
        title: `Oral Exam Prep: ${course.code} (${turns.length} questions)`,
        type: 'exam_prep',
        content: { markdown, difficulty },
        sourceReferences: references,
      });
      setTranscriptSaved(true);
    } finally {
      setSavingTranscript(false);
    }
  };

  if (finished) {
    const avg = turns.length > 0
      ? turns.reduce((s, t) => s + t.evaluation.score, 0) / turns.length
      : 0;
    return (
      <div className="max-w-3xl space-y-6">
        <div className="border-b border-zinc-200 pb-5">
          <div className="text-xs font-mono uppercase text-zinc-500">Oral Examination Complete</div>
          <h2 className="mt-1 font-display text-2xl font-semibold text-zinc-950 tabular-nums">
            Average Rubric Score: {avg.toFixed(1)} / 10
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Completed {turns.length} oral exam questions and logged to your {course.code} Study History.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="secondary"
            loading={savingTranscript}
            disabled={transcriptSaved}
            onClick={() => void handleSaveTranscript()}
          >
            {transcriptSaved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
            {transcriptSaved ? 'Saved to Materials' : 'Save rubrics & model answers'}
          </Button>
          <Button variant="ghost" onClick={onExit}>
            Back to Practice
          </Button>
        </div>

        <div className="divide-y divide-zinc-200 border-t border-zinc-200">
          {turns.map((t, i) => (
            <div key={i} className="py-5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-zinc-950">
                  Q{i + 1}: {t.question.focusConcept}
                </div>
                <span className="font-mono text-xs font-semibold text-zinc-950 tabular-nums">
                  {t.evaluation.score}/10
                </span>
              </div>
              <p className="text-xs text-zinc-700">{t.question.question}</p>
              <p className="text-xs text-zinc-600">
                <strong>Model answer:</strong> {t.evaluation.modelAnswer}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const qAudioId = `oral_q_${questionNumber}`;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4">
        <div>
          <div className="text-xs text-zinc-500 tabular-nums">
            Question {questionNumber} of {totalQuestions} · {difficulty}
          </div>
          <h2 className="font-display text-lg font-semibold text-zinc-950">
            Exam Prep Oral Examiner — {course.code}
          </h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onExit}>
          Exit
        </Button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Examiner Question Box */}
      <div className="rounded-md border border-zinc-300 bg-white p-6 space-y-3">
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
          <span>Focus: {currentQuestion.focusConcept}</span>
          {voiceEnabled && (
            <button
              type="button"
              onClick={() =>
                void geminiAudioPlayer.playMessage({
                  id: qAudioId,
                  text: currentQuestion.question,
                  voiceName: ttsVoice,
                  playbackRate: voiceRate,
                  style: 'Measured, formal university oral examiner',
                })
              }
              className="inline-flex items-center gap-1 hover:text-zinc-950"
            >
              {playback.activeId === qAudioId && playback.status === 'playing' ? (
                <>
                  <Pause className="h-3.5 w-3.5" />
                  <span>Pause</span>
                </>
              ) : playback.activeId === qAudioId && playback.status === 'paused' ? (
                <>
                  <Play className="h-3.5 w-3.5" />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>
                    {playback.activeId === qAudioId && playback.status === 'loading'
                      ? 'Generating audio...'
                      : `Listen (${ttsVoice})`}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
        <p className="text-base leading-relaxed font-medium text-zinc-950">
          {currentQuestion.question}
        </p>
        {currentQuestion.sourceCitation && (
          <div className="text-xs text-zinc-400">{currentQuestion.sourceCitation}</div>
        )}
      </div>

      {!latestEvaluation ? (
        <form onSubmit={handleSubmitAnswer} className="space-y-3">
          {isRecording && (
            <div className="flex items-center justify-between rounded-md bg-zinc-950 px-3.5 py-2 text-xs text-white">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Recording spoken answer ({recordingSec}s)
              </span>
              <button
                type="button"
                onClick={() => void handleToggleRecording()}
                className="rounded bg-white px-2.5 py-1 font-medium text-zinc-950"
              >
                Stop &amp; transcribe
              </button>
            </div>
          )}

          {transcribing && (
            <div className="text-xs text-zinc-600">
              Transcribing your spoken answer with Gemini 3.5 Transcribe...
            </div>
          )}

          <textarea
            rows={5}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={grading || isRecording || transcribing}
            placeholder="Explain your answer thoroughly as if speaking to an examiner, or record a voice note..."
            className="w-full rounded-md border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-950 focus:outline-none"
          />

          <div className="flex flex-wrap items-center gap-2.5">
            <Button type="submit" loading={grading} disabled={!answer.trim() || isRecording || transcribing}>
              <Send className="h-3.5 w-3.5" />
              Submit for 10-point rubric grading
            </Button>
            {VoiceNoteRecorder.isSupported() && (
              <Button
                type="button"
                variant={isRecording ? 'danger' : 'secondary'}
                onClick={() => void handleToggleRecording()}
                disabled={grading || transcribing}
              >
                {isRecording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                {isRecording ? 'Stop recording' : 'Answer by voice'}
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="space-y-5 border-t border-zinc-200 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-mono uppercase text-zinc-500">Rubric Assessment</div>
              <div className="font-display text-2xl font-semibold text-zinc-950 tabular-nums">
                {latestEvaluation.score} / 10
              </div>
            </div>

            {voiceEnabled && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void geminiAudioPlayer.playMessage({
                    id: `oral_fb_${questionNumber}`,
                    text: `Score ${latestEvaluation.score} out of 10. ${latestEvaluation.coachingNote}. Model answer: ${latestEvaluation.modelAnswer}`,
                    voiceName: ttsVoice,
                    playbackRate: voiceRate,
                  })
                }
              >
                <Volume2 className="h-3.5 w-3.5" />
                Listen to feedback
              </Button>
            )}
          </div>

          <p className="text-sm leading-relaxed text-zinc-800">{latestEvaluation.coachingNote}</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
            {latestEvaluation.strengths.length > 0 && (
              <div className="space-y-1.5 border-t border-zinc-200 pt-3">
                <div className="font-semibold text-zinc-950">Strengths</div>
                <ul className="list-disc pl-4 space-y-1 text-zinc-700">
                  {latestEvaluation.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {latestEvaluation.missingPoints.length > 0 && (
              <div className="space-y-1.5 border-t border-zinc-200 pt-3">
                <div className="font-semibold text-zinc-950">Missing key points</div>
                <ul className="list-disc pl-4 space-y-1 text-zinc-700">
                  {latestEvaluation.missingPoints.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {latestEvaluation.misconceptions.length > 0 && (
            <div className="border-t border-zinc-200 pt-3 text-xs space-y-1">
              <div className="font-semibold text-red-800">Misconceptions to correct</div>
              <ul className="list-disc pl-4 space-y-1 text-red-700">
                {latestEvaluation.misconceptions.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 space-y-1">
            <div className="text-xs font-semibold text-zinc-950">Model academic answer</div>
            <p className="text-xs leading-relaxed text-zinc-700">{latestEvaluation.modelAnswer}</p>
          </div>

          <Button loading={loadingNext} onClick={() => void handleNextOrFinish()}>
            {questionNumber >= totalQuestions ? 'Complete oral exam' : 'Next oral question'}
          </Button>
        </div>
      )}
    </div>
  );
};
