import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Circle,
  GraduationCap,
  Layers,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Send,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import {
  DEFAULT_USER_PREFERENCES,
  type AutomaticStudySession,
  type DifficultyLevel,
  type StudyEvaluationScore,
  type StudyPlanUnit,
  type StudySessionCheckpoint,
  type StudySessionSegment,
} from '../types/models';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { useStreak } from '../context/StreakContext';
import { useWorkspaceUi } from '../context/WorkspaceUiContext';
import { useCourseSources } from '../hooks/useCourseSources';
import { useRouter } from '../router/RouterContext';
import { formatReadableError } from '../services/firebase/errors';
import {
  advanceStudySessionState,
  createAutomaticStudySession,
  createLinkedSegment,
  createSessionCheckpoint,
  deleteAutomaticStudySession,
  setStudySessionPausedState,
  subscribeCourseStudySessions,
  subscribeSessionCheckpoints,
  subscribeSessionSegments,
  updateSegmentEntries,
} from '../services/firebase/automaticStudyService';
import { createStudyHistoryRecord } from '../services/firebase/historyService';
import { createSavedStudyMaterial } from '../services/firebase/savedMaterialService';
import {
  COMPACTION_ENTRY_THRESHOLD,
  COMPACTION_TOKEN_THRESHOLD,
  deliverStudyUnitLesson,
  evaluateStudyUnitAnswer,
  formatLessonMarkdown,
  generateAutomaticStudyPlan,
  generateCompactionSummary,
  type AdaptiveEvaluationPayload,
  type StudySegmentEntry,
} from '../services/ai/automaticStudyEngine';
import { transcribeAudioWithClient } from '../services/ai/geminiClient';
import {
  geminiAudioPlayer,
  VoiceNoteRecorder,
  type PlaybackState,
} from '../services/ai/audioService';
import {
  buildConceptInfographicPrompt,
  generateAndCacheStudyImage,
} from '../services/ai/imageService';
import { isProvider, PROVIDERS } from '../services/ai/providers';
import {
  deleteCachedGeneratedImagesByScope,
  getCachedGeneratedImagesForScope,
} from '../services/local/indexedDb';
import { formatShortDate, generateDocumentId } from '../utils/validation';
import { RevokedCourseNotice } from '../components/courses/RevokedCourseNotice';
import { MarkdownMessage } from '../components/tutor/MarkdownMessage';
import { LessonAudioPlayer } from '../components/study/LessonAudioPlayer';
import { Button } from '../components/ui/Button';
import { GeneratedStudyImageCard } from '../components/ui/GeneratedStudyImageCard';
import { Modal } from '../components/ui/Modal';
import { EmptyState, ErrorBanner, LoadingSkeleton } from '../components/ui/StateViews';
import { OfflineFeatureNotice } from '../components/ui/OfflineFeatureNotice';

interface LoadedLocalImage {
  url: string;
  caption: string;
  providerLabel: string;
}

function formatImageProviderLabel(provider: string): string {
  return isProvider(provider) ? PROVIDERS[provider].shortLabel : provider;
}

function parseSegmentEntries(segment: StudySessionSegment | undefined): StudySegmentEntry[] {
  if (!segment || !Array.isArray(segment.entries)) return [];
  return segment.entries
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .map((e, idx) => ({
      id: typeof e.id === 'string' ? e.id : `entry_${idx}`,
      kind:
        e.kind === 'lesson' ||
        e.kind === 'student_answer' ||
        e.kind === 'evaluation' ||
        e.kind === 'reteach' ||
        e.kind === 'checkpoint_note'
          ? e.kind
          : 'lesson',
      unitId: typeof e.unitId === 'string' ? e.unitId : '',
      unitTitle: typeof e.unitTitle === 'string' ? e.unitTitle : '',
      markdown: typeof e.markdown === 'string' ? e.markdown : '',
      question: typeof e.question === 'string' ? e.question : undefined,
      score: typeof e.score === 'number' ? e.score : undefined,
      decision: typeof e.decision === 'string' ? e.decision : undefined,
      visualPrompt: typeof e.visualPrompt === 'string' ? e.visualPrompt : undefined,
      visualCaption: typeof e.visualCaption === 'string' ? e.visualCaption : undefined,
      timestampMs: typeof e.timestampMs === 'number' ? e.timestampMs : Date.now(),
    }));
}

export const AutomaticStudyPage: React.FC = () => {
  const { user, profile, isOnline } = useAuth();
  const { recordLearningActivity } = useStreak();
  const {
    activeCourse,
    activeContentOwnerId,
    activeCourseAccessRevoked,
    topics,
    coursesLoading,
  } = useCourses();
  const { sources, loading: sourcesLoading } = useCourseSources(
    activeContentOwnerId,
    activeCourse?.id
  );
  const { navigate } = useRouter();
  const { setHideHeader, setHideBottomNav } = useWorkspaceUi();

  const prefs = profile?.preferences ?? DEFAULT_USER_PREFERENCES;

  // Sessions list state
  const [sessions, setSessions] = useState<AutomaticStudySession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Active session live subcollections
  const [segments, setSegments] = useState<StudySessionSegment[]>([]);
  const [checkpoints, setCheckpoints] = useState<StudySessionCheckpoint[]>([]);

  // Launcher form state
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(prefs.defaultDifficulty);
  const [customInstructions, setCustomInstructions] = useState('');
  const [creating, setCreating] = useState(false);
  const [creationPhase, setCreationPhase] = useState('');

  // Classroom interaction state
  const [answerText, setAnswerText] = useState('');
  const [busyAction, setBusyAction] = useState<
    null | 'evaluating' | 'next_unit' | 'pausing' | 'compacting' | 'completing' | 'saving'
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPriorSummary, setShowPriorSummary] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<AutomaticStudySession | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);

  // Voice recording & TTS playback
  const [playback, setPlayback] = useState<PlaybackState>(() => geminiAudioPlayer.getState());
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<VoiceNoteRecorder | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number>(Date.now());
  const streamEndRef = useRef<HTMLDivElement>(null);

  // Device-local cached concept visuals (never stored in cloud; wiped if localStorage is cleared)
  const [cachedImages, setCachedImages] = useState<Record<string, LoadedLocalImage>>({});
  const cachedImagesRef = useRef<Record<string, LoadedLocalImage>>({});
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(() => new Set());
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  useEffect(() => {
    return geminiAudioPlayer.subscribe(setPlayback);
  }, []);

  useEffect(() => {
    setDifficulty(prefs.defaultDifficulty);
  }, [prefs.defaultDifficulty]);

  // Cleanup recorder, playback & local image object URLs on unmount
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      geminiAudioPlayer.stop();
      for (const item of Object.values(cachedImagesRef.current)) {
        URL.revokeObjectURL(item.url);
      }
      cachedImagesRef.current = {};
    };
  }, []);

  // Load device-local offline concept visuals whenever the active session changes
  useEffect(() => {
    for (const item of Object.values(cachedImagesRef.current)) {
      URL.revokeObjectURL(item.url);
    }
    cachedImagesRef.current = {};
    setCachedImages({});
    setImageErrors({});

    if (!activeSessionId) return;

    let cancelled = false;
    const scopeId = activeSessionId;
    void getCachedGeneratedImagesForScope(scopeId).then((rows) => {
      if (cancelled || activeSessionIdRef.current !== scopeId) return;
      if (rows.length === 0) return;

      setCachedImages((prev) => {
        const next: Record<string, LoadedLocalImage> = { ...prev };
        for (const row of rows) {
          if (next[row.id]) continue;
          next[row.id] = {
            url: URL.createObjectURL(row.imageBlob),
            caption: row.caption,
            providerLabel: formatImageProviderLabel(row.provider),
          };
        }
        cachedImagesRef.current = next;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  const triggerEntryImageGeneration = async (entry: StudySegmentEntry, sessionId: string) => {
    if (!user || !activeCourse || !sessionId || !isOnline) return;

    setGeneratingImageIds((prev) => {
      const next = new Set(prev);
      next.add(entry.id);
      return next;
    });
    setImageErrors((prev) => {
      if (!(entry.id in prev)) return prev;
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });

    const prompt = buildConceptInfographicPrompt({
      courseCode: activeCourse.code,
      courseName: activeCourse.name,
      unitTitle: entry.unitTitle || activeCourse.name,
      conceptSummary: entry.markdown,
      customVisualPrompt: entry.visualPrompt,
    });
    const caption =
      entry.visualCaption?.trim() ||
      `Concept infographic: ${entry.unitTitle || activeCourse.code}`;

    try {
      const result = await generateAndCacheStudyImage({
        id: entry.id,
        userId: user.uid,
        courseId: activeCourse.id,
        scopeId: sessionId,
        feature: 'automatic_study',
        prompt,
        caption,
        aspectRatio: '16:9',
      });

      if (activeSessionIdRef.current !== sessionId) return;

      const objectUrl = URL.createObjectURL(result.blob);
      setCachedImages((prev) => {
        if (prev[entry.id]) {
          URL.revokeObjectURL(prev[entry.id].url);
        }
        const next: Record<string, LoadedLocalImage> = {
          ...prev,
          [entry.id]: {
            url: objectUrl,
            caption: result.caption,
            providerLabel: formatImageProviderLabel(result.provider),
          },
        };
        cachedImagesRef.current = next;
        return next;
      });
    } catch (err) {
      if (activeSessionIdRef.current !== sessionId) return;
      setImageErrors((prev) => ({
        ...prev,
        [entry.id]: formatReadableError(err),
      }));
    } finally {
      setGeneratingImageIds((prev) => {
        if (!prev.has(entry.id)) return prev;
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  };

  // Subscribe to course sessions
  useEffect(() => {
    if (!user?.uid || !activeCourse?.id) {
      setSessions([]);
      setActiveSessionId(null);
      setSessionsLoading(false);
      return;
    }

    setSessionsLoading(true);
    setActiveSessionId(null);
    setSelectedTopicIds([]);
    setLauncherOpen(false);
    setError(null);

    const unsub = subscribeCourseStudySessions(
      user.uid,
      activeCourse.id,
      (list) => {
        setSessions(list);
        setSessionsLoading(false);

        // Check if navigated from HistoryPage with a resume target
        try {
          const targetId = sessionStorage.getItem('sotal_resume_study_session_id');
          if (targetId && list.some((s) => s.id === targetId)) {
            sessionStorage.removeItem('sotal_resume_study_session_id');
            setActiveSessionId(targetId);
            sessionStartRef.current = Date.now();
          }
        } catch {
          // Ignore storage errors
        }
      },
      (err) => {
        setError(formatReadableError(err));
        setSessionsLoading(false);
      }
    );

    return () => unsub();
  }, [user?.uid, activeCourse?.id]);

  // Subscribe to active session segments & checkpoints
  useEffect(() => {
    if (!user?.uid || !activeCourse?.id || !activeSessionId) {
      setSegments([]);
      setCheckpoints([]);
      return;
    }

    const unsubSeg = subscribeSessionSegments(
      user.uid,
      activeCourse.id,
      activeSessionId,
      setSegments,
      (err) => setError(formatReadableError(err))
    );
    const unsubCkpt = subscribeSessionCheckpoints(
      user.uid,
      activeCourse.id,
      activeSessionId,
      setCheckpoints,
      (err) => setError(formatReadableError(err))
    );

    return () => {
      unsubSeg();
      unsubCkpt();
    };
  }, [user?.uid, activeCourse?.id, activeSessionId]);

  const activeSession = useMemo(
    () => (activeSessionId ? sessions.find((s) => s.id === activeSessionId) ?? null : null),
    [sessions, activeSessionId]
  );

  const hasBackNavView =
    !coursesLoading &&
    !sourcesLoading &&
    Boolean(activeCourse) &&
    Boolean(user) &&
    sources.length > 0 &&
    Boolean(activeSession);

  useEffect(() => {
    setHideHeader(hasBackNavView);
    setHideBottomNav(hasBackNavView);
    return () => {
      setHideHeader(false);
      setHideBottomNav(false);
    };
  }, [hasBackNavView, setHideHeader, setHideBottomNav]);

  const activeSegment = useMemo(() => {
    if (!activeSession || segments.length === 0) return undefined;
    return (
      segments.find((s) => s.id === activeSession.activeSegmentId) ??
      segments[segments.length - 1]
    );
  }, [activeSession, segments]);

  const activeEntries = useMemo(() => parseSegmentEntries(activeSegment), [activeSegment]);

  const currentUnit: StudyPlanUnit | null = useMemo(() => {
    if (!activeSession) return null;
    return activeSession.studyPlan[activeSession.currentUnitIndex] ?? null;
  }, [activeSession]);

  const latestEvaluation = useMemo(() => {
    const raw = activeSession?.evaluationFeedback;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.decision !== 'string') return null;
    return raw as unknown as AdaptiveEvaluationPayload;
  }, [activeSession?.evaluationFeedback]);

  const isUnitReadyToAdvance =
    activeSession?.nextAction === 'ready_for_next_unit' ||
    activeSession?.nextAction === 'ready_to_complete';

  const hasMoreUnits =
    Boolean(activeSession) &&
    (activeSession?.currentUnitIndex ?? 0) < (activeSession?.studyPlan.length ?? 0) - 1;

  useEffect(() => {
    if (activeEntries.length > 0) {
      streamEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [activeEntries.length]);

  const toggleTopicSelection = (topicId: string) => {
    setSelectedTopicIds((prev) =>
      prev.includes(topicId) ? prev.filter((id) => id !== topicId) : [...prev, topicId]
    );
  };

  const startLessonAudioNarration = (
    entryId: string,
    markdown: string,
    sessionId: string
  ) => {
    if (!user || !activeCourse || !isOnline) return;
    void geminiAudioPlayer.playMessage({
      id: entryId,
      text: markdown,
      voiceName: prefs.ttsVoice,
      playbackRate: prefs.voiceRate,
      style: 'Clear, engaging, well-paced university lecturer narrating a study lesson',
      persist: {
        userId: user.uid,
        courseId: activeCourse.id,
        conversationId: `auto_study_${sessionId}`,
      },
    });
  };

  const handleTogglePlay = async (entryId: string, markdown: string) => {
    if (playback.activeId === entryId) {
      if (playback.status === 'playing' || playback.status === 'paused') {
        geminiAudioPlayer.togglePause();
        return;
      }
      if (playback.status === 'loading') {
        geminiAudioPlayer.stop();
        return;
      }
    }
    if (!isOnline) {
      setError(
        "You're offline. Turn on your internet connection to generate voice playback. You can continue reading your cached lessons offline."
      );
      return;
    }
    await geminiAudioPlayer.playMessage({
      id: entryId,
      text: markdown,
      voiceName: prefs.ttsVoice,
      playbackRate: prefs.voiceRate,
      style: 'Clear, engaging, well-paced university lecturer narrating a study lesson',
      persist:
        user && activeCourse && activeSessionId
          ? {
              userId: user.uid,
              courseId: activeCourse.id,
              conversationId: `auto_study_${activeSessionId}`,
            }
          : undefined,
    });
  };

  const handleStartVoiceAnswer = async () => {
    if (!isOnline && !recording) {
      setError(
        "You're offline. Turn on your internet connection to record and transcribe voice answers."
      );
      return;
    }
    setError(null);
    if (recording) {
      // Stop and transcribe
      if (recordTimerRef.current) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      setRecording(false);
      setTranscribing(true);
      try {
        const recorded = await recorderRef.current?.stop();
        if (recorded) {
          const result = await transcribeAudioWithClient({
            audioBase64: recorded.audioBase64,
            mimeType: recorded.mimeType,
            courseContextHint: activeCourse
              ? `${activeCourse.code} ${activeCourse.name} ${currentUnit?.title || ''}`
              : undefined,
          });
          if (result.text.trim()) {
            setAnswerText((prev) => (prev.trim() ? `${prev.trim()} ${result.text.trim()}` : result.text.trim()));
          }
        }
      } catch (err) {
        setError(formatReadableError(err));
      } finally {
        setTranscribing(false);
        setRecordingSeconds(0);
      }
      return;
    }

    try {
      const rec = new VoiceNoteRecorder();
      recorderRef.current = rec;
      await rec.start();
      setRecording(true);
      setRecordingSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      setError(formatReadableError(err));
      setRecording(false);
    }
  };

  const handleCancelRecording = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    recorderRef.current?.cancel();
    setRecording(false);
    setRecordingSeconds(0);
  };

  // Start a new Automatic Study session
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeCourse) return;
    if (!isOnline) {
      setError(
        "You're offline. Turn on your internet connection to generate a new Automatic Study plan. Previously started sessions below can still be opened and read offline."
      );
      return;
    }
    setCreating(true);
    setError(null);
    setNotice(null);
    // Synchronously unlock browser audio element inside the submit gesture so narration auto-plays immediately when ready
    geminiAudioPlayer.unlockForAutoplay();

    try {
      setCreationPhase('Designing sequential study plan from your course materials...');
      const plan = await generateAutomaticStudyPlan({
        course: activeCourse,
        topics,
        sources,
        selectedTopicIds,
        difficulty,
        customInstructions: customInstructions.trim(),
        model: prefs.defaultModel,
      });

      const firstUnit = plan.units[0];
      setCreationPhase(`Preparing Unit 1: ${firstUnit.title}...`);
      const firstLesson = await deliverStudyUnitLesson({
        course: activeCourse,
        sources,
        selectedTopicIds,
        unit: firstUnit,
        completedUnitTitles: [],
        checkpointSummary: '',
        difficulty,
        customInstructions: customInstructions.trim(),
        model: prefs.defaultModel,
      });

      const initialEntry: StudySegmentEntry = {
        id: generateDocumentId('ent'),
        kind: 'lesson',
        unitId: firstUnit.unitId,
        unitTitle: firstUnit.title,
        markdown: formatLessonMarkdown(firstLesson),
        question: firstLesson.checkQuestion,
        ...(firstLesson.visualPrompt ? { visualPrompt: firstLesson.visualPrompt } : {}),
        ...(firstLesson.visualCaption ? { visualCaption: firstLesson.visualCaption } : {}),
        timestampMs: Date.now(),
      };

      const { session } = await createAutomaticStudySession(user.uid, activeCourse.id, {
        title: plan.sessionTitle || `${activeCourse.code} Guided Study`,
        selectedTopicIds,
        customInstructions: customInstructions.trim(),
        difficulty,
        studyPlan: plan.units,
        initialEntries: [initialEntry as unknown as Record<string, unknown>],
        currentObjective: firstUnit.objective,
        currentQuestion: firstLesson.checkQuestion,
      });

      sessionStartRef.current = Date.now();
      activeSessionIdRef.current = session.id;
      setActiveSessionId(session.id);
      setLauncherOpen(false);
      setCustomInstructions('');
      setAnswerText('');

      // Generate illustrative concept visual in the background & cache locally on device
      void triggerEntryImageGeneration(initialEntry, session.id);

      // Automatically generate and begin playing audio narration for the newly generated lesson
      startLessonAudioNarration(initialEntry.id, initialEntry.markdown, session.id);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setCreating(false);
      setCreationPhase('');
    }
  };

  // Run context compaction into a new linked Firestore segment + immutable checkpoint
  const runContextCompaction = async (
    session: AutomaticStudySession,
    segment: StudySessionSegment,
    entries: StudySegmentEntry[],
    updatedState: {
      status: AutomaticStudySession['status'];
      studyPlan: StudyPlanUnit[];
      currentUnitIndex: number;
      completedUnitIds: string[];
      currentObjective: string;
      currentQuestion: string;
      latestStudentAnswer: string;
      evaluationFeedback: Record<string, unknown>;
      scores: StudyEvaluationScore[];
      topicMastery: Record<string, number>;
      topicsRequiringReview: string[];
      nextAction: string;
    },
    isManual: boolean
  ) => {
    if (!user || !activeCourse) return;

    const completedTitles = updatedState.studyPlan
      .filter((u) => updatedState.completedUnitIds.includes(u.unitId))
      .map((u) => u.title);
    const activeUnitTitle =
      updatedState.studyPlan[updatedState.currentUnitIndex]?.title || session.title;

    const compact = await generateCompactionSummary({
      course: activeCourse,
      sessionTitle: session.title,
      priorSummary: segment.summaryFromCheckpoint || '',
      entries,
      completedUnits: completedTitles,
      currentUnitTitle: activeUnitTitle,
      currentQuestion: updatedState.currentQuestion,
      model: prefs.defaultModel,
    });

    const mergedWeaknesses = Array.from(
      new Set([...updatedState.topicsRequiringReview, ...compact.keyWeaknesses])
    ).slice(0, 40);

    const checkpoint = await createSessionCheckpoint(user.uid, activeCourse.id, session.id, {
      reason: 'compaction',
      summary: compact.compactSummary,
      currentUnitIndex: updatedState.currentUnitIndex,
      completedUnitIds: updatedState.completedUnitIds,
      nextAction: compact.nextAction || updatedState.nextAction,
      masterySnapshot: updatedState.topicMastery,
      weaknesses: mergedWeaknesses,
    });

    const carryEntry: StudySegmentEntry = {
      id: generateDocumentId('ent'),
      kind: 'checkpoint_note',
      unitId: updatedState.studyPlan[updatedState.currentUnitIndex]?.unitId || '',
      unitTitle: activeUnitTitle,
      markdown: `### Session Context Compacted (Segment ${segment.segmentIndex + 2})\n${compact.compactSummary}${
        updatedState.currentQuestion ? `\n\n**Active Question:** ${updatedState.currentQuestion}` : ''
      }`,
      question: updatedState.currentQuestion || undefined,
      timestampMs: Date.now(),
    };

    const nextSegment = await createLinkedSegment(user.uid, activeCourse.id, session.id, {
      segmentIndex: segment.segmentIndex + 1,
      summaryFromCheckpoint: compact.compactSummary,
      initialEntries: [carryEntry as unknown as Record<string, unknown>],
    });

    await advanceStudySessionState(user.uid, activeCourse.id, session.id, {
      ...updatedState,
      topicsRequiringReview: mergedWeaknesses,
      lastCheckpointId: checkpoint.id,
      activeSegmentId: nextSegment.id,
    });

    setNotice(
      isManual
        ? `Compacted segment ${segment.segmentIndex + 1} into linked segment ${nextSegment.segmentIndex + 1} with an immutable checkpoint.`
        : `Long study session automatically compacted into linked segment ${nextSegment.segmentIndex + 1} to keep context crisp.`
    );
  };

  // Submit student comprehension answer (or quick scaffold prompt)
  const handleSubmitAnswer = async (overrideAnswer?: string) => {
    const submitted = (overrideAnswer ?? answerText).trim();
    if (!user || !activeCourse || !activeSession || !activeSegment || !currentUnit || !submitted) {
      return;
    }
    if (activeSession.status === 'completed') return;
    if (!isOnline) {
      setError(
        "You're offline. Turn on your internet connection to submit answers for AI evaluation. You can still review all delivered lessons in this session offline."
      );
      return;
    }

    setBusyAction('evaluating');
    setError(null);
    setNotice(null);

    try {
      // If session was paused, automatically resume it cleanly
      const attemptsOnUnit =
        activeSession.scores.filter((s) => s.unitId === currentUnit.unitId).length + 1;

      const recentContext = activeEntries
        .slice(-4)
        .map((e) => `[${e.kind}]: ${e.markdown.slice(0, 700)}`)
        .join('\n\n');

      const evaluation = await evaluateStudyUnitAnswer({
        course: activeCourse,
        unit: currentUnit,
        questionAsked: activeSession.currentQuestion || currentUnit.objective,
        studentAnswer: submitted,
        attemptNumberOnUnit: attemptsOnUnit,
        recentEntriesSummary: recentContext,
        difficulty: activeSession.difficulty,
        model: prefs.defaultModel,
      });

      const studentEntry: StudySegmentEntry = {
        id: generateDocumentId('ent'),
        kind: 'student_answer',
        unitId: currentUnit.unitId,
        unitTitle: currentUnit.title,
        markdown: submitted,
        timestampMs: Date.now(),
      };

      const evalParts = [
        `### Evaluation — ${evaluation.score}/10 (${
          evaluation.decision === 'advance'
            ? 'Ready to Advance'
            : evaluation.decision === 'clarify'
            ? 'Clarify & Retry'
            : 'Reteach Simpler'
        })`,
        evaluation.feedbackMarkdown,
      ];
      if (evaluation.strengths.length > 0) {
        evalParts.push(`**Strengths:** ${evaluation.strengths.join(' · ')}`);
      }
      if (evaluation.gaps.length > 0) {
        evalParts.push(`**Gaps to tighten:** ${evaluation.gaps.join(' · ')}`);
      }
      if (evaluation.decision !== 'advance' && evaluation.reteachExplanation) {
        evalParts.push(`### Guided Explanation\n${evaluation.reteachExplanation}`);
      }
      if (evaluation.decision !== 'advance' && evaluation.followUpQuestion) {
        evalParts.push(`### Follow-Up Check\n**${evaluation.followUpQuestion}**`);
      }

      const evalEntry: StudySegmentEntry = {
        id: generateDocumentId('ent'),
        kind: evaluation.decision === 'reteach_simpler' ? 'reteach' : 'evaluation',
        unitId: currentUnit.unitId,
        unitTitle: currentUnit.title,
        markdown: evalParts.join('\n\n'),
        question:
          evaluation.decision !== 'advance'
            ? evaluation.followUpQuestion || activeSession.currentQuestion
            : undefined,
        score: evaluation.score,
        decision: evaluation.decision,
        timestampMs: Date.now() + 1,
      };

      const nextEntries = [...activeEntries, studentEntry, evalEntry];
      const nextScoreRecord: StudyEvaluationScore = {
        unitId: currentUnit.unitId,
        score: evaluation.score,
        maxScore: 10,
        timestampMs: Date.now(),
      };
      const nextScores = [...activeSession.scores, nextScoreRecord];
      const nextMastery = {
        ...activeSession.topicMastery,
        [currentUnit.title]: Math.max(
          activeSession.topicMastery[currentUnit.title] ?? 0,
          Math.round((evaluation.score / 10) * 100)
        ),
      };

      const nextWeaknesses = evaluation.weaknessTag
        ? Array.from(new Set([...activeSession.topicsRequiringReview, evaluation.weaknessTag]))
        : activeSession.topicsRequiringReview;

      let nextCompletedIds = [...activeSession.completedUnitIds];
      let nextPlan = activeSession.studyPlan.map((u) => ({ ...u }));
      let nextAction = 'awaiting_student_answer';
      let nextQuestion = activeSession.currentQuestion;

      if (evaluation.decision === 'advance') {
        if (!nextCompletedIds.includes(currentUnit.unitId)) {
          nextCompletedIds.push(currentUnit.unitId);
        }
        nextPlan = nextPlan.map((u, idx) =>
          idx === activeSession.currentUnitIndex ? { ...u, status: 'completed' } : u
        );
        const isLastUnit = activeSession.currentUnitIndex >= activeSession.studyPlan.length - 1;
        nextAction = isLastUnit ? 'ready_to_complete' : 'ready_for_next_unit';
      } else {
        nextQuestion = evaluation.followUpQuestion || activeSession.currentQuestion;
        nextAction =
          evaluation.decision === 'reteach_simpler'
            ? 'awaiting_scaffolded_retry'
            : 'awaiting_clarification_retry';
      }

      const serializedEntries = nextEntries as unknown as Array<Record<string, unknown>>;
      await updateSegmentEntries(
        user.uid,
        activeCourse.id,
        activeSession.id,
        activeSegment.id,
        serializedEntries
      );

      const estimatedTokens = Math.ceil(JSON.stringify(nextEntries).length / 4);
      const shouldCompact =
        nextEntries.length >= COMPACTION_ENTRY_THRESHOLD ||
        estimatedTokens >= COMPACTION_TOKEN_THRESHOLD;

      const updatedSessionState = {
        status: 'active' as const,
        studyPlan: nextPlan,
        currentUnitIndex: activeSession.currentUnitIndex,
        completedUnitIds: nextCompletedIds,
        currentObjective: currentUnit.objective,
        currentQuestion: nextQuestion,
        latestStudentAnswer: submitted,
        evaluationFeedback: evaluation as unknown as Record<string, unknown>,
        scores: nextScores,
        topicMastery: nextMastery,
        topicsRequiringReview: nextWeaknesses,
        nextAction,
      };

      if (shouldCompact) {
        await runContextCompaction(activeSession, activeSegment, nextEntries, updatedSessionState, false);
      } else {
        await advanceStudySessionState(user.uid, activeCourse.id, activeSession.id, {
          ...updatedSessionState,
          lastCheckpointId: activeSession.lastCheckpointId || '',
          activeSegmentId: activeSegment.id,
        });
      }

      setAnswerText('');

      if (evaluation.decision === 'advance') {
        void recordLearningActivity({
          activityType: 'automatic_study',
          title: `${activeSession.title}: ${currentUnit.title}`,
          courseId: activeCourse.id,
          courseCode: activeCourse.code,
          isSharedCourse: Boolean(activeCourse.isShared),
          durationSeconds: 90,
          score: evaluation.score,
          maxScore: 10,
          summary: `Completed unit "${currentUnit.title}" (${evaluation.score}/10).`,
        });
      }
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setBusyAction(null);
    }
  };

  // Advance to the next sequential unit in the study plan
  const handleAdvanceToNextUnit = async () => {
    if (!user || !activeCourse || !activeSession || !activeSegment || !hasMoreUnits) return;
    if (!isOnline) {
      setError(
        "You're offline. Turn on your internet connection to generate and deliver the next lesson unit."
      );
      return;
    }
    setBusyAction('next_unit');
    setError(null);
    setNotice(null);
    // Unlock audio element synchronously inside user click gesture for immediate playback
    geminiAudioPlayer.unlockForAutoplay();

    try {
      const nextIdx = activeSession.currentUnitIndex + 1;
      const nextUnit = activeSession.studyPlan[nextIdx];
      const completedIds = activeSession.completedUnitIds.includes(
        activeSession.studyPlan[activeSession.currentUnitIndex].unitId
      )
        ? activeSession.completedUnitIds
        : [...activeSession.completedUnitIds, activeSession.studyPlan[activeSession.currentUnitIndex].unitId];

      const completedTitles = activeSession.studyPlan
        .filter((u) => completedIds.includes(u.unitId))
        .map((u) => u.title);

      const lesson = await deliverStudyUnitLesson({
        course: activeCourse,
        sources,
        selectedTopicIds: activeSession.selectedTopicIds,
        unit: nextUnit,
        completedUnitTitles: completedTitles,
        checkpointSummary: activeSegment.summaryFromCheckpoint || '',
        difficulty: activeSession.difficulty,
        customInstructions: activeSession.customInstructions,
        model: prefs.defaultModel,
      });

      const lessonEntry: StudySegmentEntry = {
        id: generateDocumentId('ent'),
        kind: 'lesson',
        unitId: nextUnit.unitId,
        unitTitle: nextUnit.title,
        markdown: formatLessonMarkdown(lesson),
        question: lesson.checkQuestion,
        ...(lesson.visualPrompt ? { visualPrompt: lesson.visualPrompt } : {}),
        ...(lesson.visualCaption ? { visualCaption: lesson.visualCaption } : {}),
        timestampMs: Date.now(),
      };

      const nextPlan: StudyPlanUnit[] = activeSession.studyPlan.map((u, idx) => {
        if (completedIds.includes(u.unitId)) return { ...u, status: 'completed' };
        if (idx === nextIdx) return { ...u, status: 'in_progress' };
        return u;
      });

      const nextEntries = [...activeEntries, lessonEntry];
      await updateSegmentEntries(
        user.uid,
        activeCourse.id,
        activeSession.id,
        activeSegment.id,
        nextEntries as unknown as Array<Record<string, unknown>>
      );

      await advanceStudySessionState(user.uid, activeCourse.id, activeSession.id, {
        status: 'active',
        studyPlan: nextPlan,
        currentUnitIndex: nextIdx,
        completedUnitIds: completedIds,
        currentObjective: nextUnit.objective,
        currentQuestion: lesson.checkQuestion,
        latestStudentAnswer: '',
        evaluationFeedback: {},
        scores: activeSession.scores,
        topicMastery: activeSession.topicMastery,
        topicsRequiringReview: activeSession.topicsRequiringReview,
        lastCheckpointId: activeSession.lastCheckpointId || '',
        nextAction: 'awaiting_student_answer',
        activeSegmentId: activeSegment.id,
      });

      // Generate illustrative concept visual in the background & cache locally on device
      void triggerEntryImageGeneration(lessonEntry, activeSession.id);

      // Automatically generate and begin playing audio narration for the newly generated unit lesson
      startLessonAudioNarration(lessonEntry.id, lessonEntry.markdown, activeSession.id);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setBusyAction(null);
    }
  };

  // Manual context compaction button
  const handleManualCompact = async () => {
    if (!activeSession || !activeSegment || activeEntries.length === 0) return;
    if (!isOnline) {
      setError("You're offline. Turn on your internet connection to compact session context.");
      return;
    }
    setBusyAction('compacting');
    setError(null);
    setNotice(null);
    try {
      await runContextCompaction(
        activeSession,
        activeSegment,
        activeEntries,
        {
          status: activeSession.status,
          studyPlan: activeSession.studyPlan,
          currentUnitIndex: activeSession.currentUnitIndex,
          completedUnitIds: activeSession.completedUnitIds,
          currentObjective: activeSession.currentObjective,
          currentQuestion: activeSession.currentQuestion,
          latestStudentAnswer: activeSession.latestStudentAnswer,
          evaluationFeedback: activeSession.evaluationFeedback,
          scores: activeSession.scores,
          topicMastery: activeSession.topicMastery,
          topicsRequiringReview: activeSession.topicsRequiringReview,
          nextAction: activeSession.nextAction,
        },
        true
      );
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setBusyAction(null);
    }
  };

  // Pause & Checkpoint
  const handlePauseAndCheckpoint = async () => {
    if (!user || !activeCourse || !activeSession || !activeSegment) return;
    if (!isOnline) {
      setError(
        "You're offline. Turn on your internet connection to generate an AI checkpoint summary, or simply go back — your session progress is already saved locally."
      );
      return;
    }
    setBusyAction('pausing');
    setError(null);
    setNotice(null);
    try {
      const completedTitles = activeSession.studyPlan
        .filter((u) => activeSession.completedUnitIds.includes(u.unitId))
        .map((u) => u.title);
      const compact = await generateCompactionSummary({
        course: activeCourse,
        sessionTitle: activeSession.title,
        priorSummary: activeSegment.summaryFromCheckpoint || '',
        entries: activeEntries,
        completedUnits: completedTitles,
        currentUnitTitle: currentUnit?.title || activeSession.title,
        currentQuestion: activeSession.currentQuestion,
        model: prefs.defaultModel,
      });

      const ckpt = await createSessionCheckpoint(user.uid, activeCourse.id, activeSession.id, {
        reason: 'paused',
        summary: compact.compactSummary,
        currentUnitIndex: activeSession.currentUnitIndex,
        completedUnitIds: activeSession.completedUnitIds,
        nextAction: compact.nextAction || activeSession.nextAction,
        masterySnapshot: activeSession.topicMastery,
        weaknesses: Array.from(
          new Set([...activeSession.topicsRequiringReview, ...compact.keyWeaknesses])
        ),
      });

      await setStudySessionPausedState(
        user.uid,
        activeCourse.id,
        activeSession.id,
        'paused',
        ckpt.id,
        compact.nextAction || activeSession.nextAction
      );

      setNotice('Checkpoint saved. You can resume this exact unit anytime from Automatic Study or History.');
      setActiveSessionId(null);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setBusyAction(null);
    }
  };

  // Save lesson notes to Saved Materials
  const handleSaveToMaterials = async () => {
    if (!user || !activeCourse || !activeSession) return;
    setBusyAction('saving');
    setError(null);
    try {
      const allLessonsMarkdown = segments
        .flatMap((seg) => parseSegmentEntries(seg))
        .filter((e) => e.kind === 'lesson' || e.kind === 'reteach' || e.kind === 'checkpoint_note')
        .map((e) => e.markdown)
        .join('\n\n---\n\n');

      await createSavedStudyMaterial(user.uid, activeCourse.id, {
        title: `${activeSession.title} — Study Notes`,
        type: 'summary',
        topicId: activeSession.selectedTopicIds[0] || '',
        content: {
          markdown: allLessonsMarkdown || activeSession.title,
          sessionId: activeSession.id,
          mastery: activeSession.topicMastery,
        },
        sourceReferences: [
          {
            sourceId: activeSession.id,
            sourceTitle: `Automatic Study (${activeSession.completedUnitIds.length}/${activeSession.studyPlan.length} units)`,
          },
        ],
      });
      setNotice('Saved lesson notes to Library → Saved Materials.');
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setBusyAction(null);
    }
  };

  // Complete session & log final summary into Study History
  const handleCompleteSession = async () => {
    if (!user || !activeCourse || !activeSession || !activeSegment) return;
    setBusyAction('completing');
    setError(null);
    try {
      const completedIds = Array.from(
        new Set([
          ...activeSession.completedUnitIds,
          ...(currentUnit && isUnitReadyToAdvance ? [currentUnit.unitId] : []),
        ])
      );
      const finalPlan: StudyPlanUnit[] = activeSession.studyPlan.map((u) =>
        completedIds.includes(u.unitId) ? { ...u, status: 'completed' } : u
      );

      const totalScore = activeSession.scores.reduce((sum, s) => sum + s.score, 0);
      const maxScore = activeSession.scores.reduce((sum, s) => sum + s.maxScore, 0);
      const passedChecks = activeSession.scores.filter((s) => s.score >= 7).length;
      const reviewChecks = activeSession.scores.length - passedChecks;
      const durationSeconds = Math.max(
        30,
        Math.round((Date.now() - sessionStartRef.current) / 1000)
      );

      const summaryText = `Completed Automatic Study "${activeSession.title}": ${completedIds.length}/${finalPlan.length} units covered across ${segments.length} linked segment(s).${
        activeSession.topicsRequiringReview.length > 0
          ? ` Flagged for review: ${activeSession.topicsRequiringReview.join(', ')}.`
          : ' All checked units demonstrated solid mastery.'
      }`;

      const ckpt = await createSessionCheckpoint(user.uid, activeCourse.id, activeSession.id, {
        reason: 'topic_completed',
        summary: summaryText,
        currentUnitIndex: activeSession.currentUnitIndex,
        completedUnitIds: completedIds,
        nextAction: 'completed',
        masterySnapshot: activeSession.topicMastery,
        weaknesses: activeSession.topicsRequiringReview,
      });

      await advanceStudySessionState(user.uid, activeCourse.id, activeSession.id, {
        status: 'completed',
        studyPlan: finalPlan,
        currentUnitIndex: activeSession.currentUnitIndex,
        completedUnitIds: completedIds,
        currentObjective: activeSession.currentObjective,
        currentQuestion: '',
        latestStudentAnswer: activeSession.latestStudentAnswer,
        evaluationFeedback: activeSession.evaluationFeedback,
        scores: activeSession.scores,
        topicMastery: activeSession.topicMastery,
        topicsRequiringReview: activeSession.topicsRequiringReview,
        lastCheckpointId: ckpt.id,
        nextAction: 'completed',
        activeSegmentId: activeSegment.id,
      });

      await createStudyHistoryRecord(user.uid, activeCourse.id, {
        sessionType: 'automatic_study',
        title: activeSession.title,
        topicIds: activeSession.selectedTopicIds,
        status: 'completed',
        score: totalScore,
        maxScore,
        correctCount: passedChecks,
        incorrectCount: reviewChecks,
        skippedCount: 0,
        durationSeconds,
        summary: summaryText,
        weaknesses: activeSession.topicsRequiringReview,
        details: {
          sessionId: activeSession.id,
          unitsCompleted: completedIds.length,
          totalUnits: finalPlan.length,
          segmentsCount: segments.length,
          checkpointsCount: checkpoints.length + 1,
          topicMastery: activeSession.topicMastery,
        },
      });

      setNotice('Automatic Study session completed and logged to Study History.');

      void recordLearningActivity({
        activityType: 'automatic_study',
        title: activeSession.title,
        courseId: activeCourse.id,
        courseCode: activeCourse.code,
        isSharedCourse: Boolean(activeCourse.isShared),
        durationSeconds,
        score: totalScore,
        maxScore,
        summary: summaryText,
      });
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmDeleteSession = async () => {
    if (!user || !activeCourse || !sessionToDelete) return;
    setDeletingSession(true);
    setError(null);
    try {
      await deleteAutomaticStudySession(user.uid, activeCourse.id, sessionToDelete.id);
      void deleteCachedGeneratedImagesByScope(sessionToDelete.id);
      if (activeSessionId === sessionToDelete.id) {
        setActiveSessionId(null);
      }
      setSessionToDelete(null);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setDeletingSession(false);
    }
  };

  if (coursesLoading || sourcesLoading) {
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
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
            Automatic Study
          </h1>
        </div>
        <EmptyState
          title="Select or create a course first"
          description="Automatic Study builds structured unit-by-unit lessons directly from your course materials."
          actionLabel="Go to Library"
          onAction={() => navigate('/library')}
        />
      </div>
    );
  }

  if (activeCourseAccessRevoked) {
    return <RevokedCourseNotice course={activeCourse} pageTitle="Automatic Study" />;
  }

  if (sources.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-5">
          <button
            type="button"
            onClick={() => navigate('/library')}
            aria-label="Back to Library"
            title="Back to Library"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
            Automatic Study
          </h1>
        </div>
        <EmptyState
          title={`Upload study materials in ${activeCourse.code} first`}
          description="Add lecture slides, PDFs, textbook photos, or typed notes in Library so your personal AI lecturer can construct an accurate course syllabus."
          actionLabel="Add materials in Library"
          onAction={() => navigate('/library')}
        />
      </div>
    );
  }

  // ACTIVE CLASSROOM VIEW
  if (activeSession) {
    const completedCount = activeSession.completedUnitIds.length;
    const totalUnits = activeSession.studyPlan.length;
    const isCompleted = activeSession.status === 'completed';
    const currentTokens = activeSegment?.tokenEstimate ?? 0;

    return (
      <div className="space-y-6">
        {/* Top Classroom Bar */}
        <div className="flex flex-col gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                geminiAudioPlayer.stop();
                setActiveSessionId(null);
              }}
              aria-label="Back to all Automatic Study sessions"
              title="All Automatic Study sessions"
              className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200 truncate">
                {activeSession.title}
              </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
              <span>{activeCourse.code}</span>
              <span aria-hidden="true">·</span>
              <span>
                Unit {Math.min(activeSession.currentUnitIndex + 1, totalUnits)}/{totalUnits}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Segment {(activeSegment?.segmentIndex ?? 0) + 1}/{Math.max(1, segments.length)}
              </span>
              <span aria-hidden="true">·</span>
              <span>{checkpoints.length} checkpoints</span>
            </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleSaveToMaterials()}
              loading={busyAction === 'saving'}
              disabled={busyAction !== null}
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save notes
            </Button>
            {!isCompleted && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleManualCompact()}
                  loading={busyAction === 'compacting'}
                  disabled={!isOnline || busyAction !== null || activeEntries.length === 0}
                  title="Compact current conversation into a clean checkpoint and linked segment"
                >
                  <Layers className="h-3.5 w-3.5" />
                  Compact
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handlePauseAndCheckpoint()}
                  loading={busyAction === 'pausing'}
                  disabled={!isOnline || busyAction !== null}
                >
                  <Pause className="h-3.5 w-3.5" />
                  Pause & Checkpoint
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleCompleteSession()}
                  loading={busyAction === 'completing'}
                  disabled={busyAction !== null}
                >
                  <Check className="h-3.5 w-3.5" />
                  Finish
                </Button>
              </>
            )}
          </div>
        </div>

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        {notice && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-800 dark:text-zinc-200">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Two-column Classroom Layout */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Syllabus Progress Rail */}
          <aside className="lg:col-span-4 space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Study Plan
                </span>
                <span className="font-mono text-zinc-600 dark:text-zinc-400 tabular-nums">
                  {completedCount}/{totalUnits} mastered
                </span>
              </div>

              <div className="h-1 w-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-zinc-950 dark:bg-zinc-200 transition-all duration-300"
                  style={{
                    width: `${totalUnits > 0 ? Math.round((completedCount / totalUnits) * 100) : 0}%`,
                  }}
                />
              </div>

              <ol className="divide-y divide-zinc-200 dark:divide-zinc-800 border-y border-zinc-200 dark:border-zinc-800">
                {activeSession.studyPlan.map((unit, idx) => {
                  const done = activeSession.completedUnitIds.includes(unit.unitId);
                  const current = idx === activeSession.currentUnitIndex && !isCompleted;
                  const mastery = activeSession.topicMastery[unit.title];
                  return (
                    <li
                      key={unit.unitId}
                      className={`py-3 flex items-start gap-2.5 ${
                        current ? 'text-zinc-950 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {done ? (
                        <CheckCircle2 className="h-4 w-4 text-zinc-950 dark:text-zinc-200 shrink-0 mt-0.5" />
                      ) : (
                        <Circle
                          className={`h-4 w-4 shrink-0 mt-0.5 ${
                            current ? 'text-zinc-950 dark:text-zinc-200' : 'text-zinc-300 dark:text-zinc-700'
                          }`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={`text-sm ${
                              current
                                ? 'font-semibold text-zinc-950 dark:text-zinc-200'
                                : done
                                ? 'text-zinc-800 dark:text-zinc-300'
                                : ''
                            }`}
                          >
                            {idx + 1}. {unit.title}
                          </span>
                          {typeof mastery === 'number' && (
                            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
                              {mastery}%
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                          {unit.objective}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* Segment & Compaction Info */}
            <div className="space-y-2 border-t border-zinc-200 dark:border-zinc-800 pt-4 text-xs text-zinc-600 dark:text-zinc-400">
              <div className="font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Session Continuity
              </div>
              <div className="flex justify-between font-mono tabular-nums">
                <span>Active segment entries</span>
                <span>
                  {activeEntries.length}/{COMPACTION_ENTRY_THRESHOLD}
                </span>
              </div>
              <div className="flex justify-between font-mono tabular-nums">
                <span>Estimated context tokens</span>
                <span>
                  ~{currentTokens.toLocaleString()}/{COMPACTION_TOKEN_THRESHOLD.toLocaleString()}
                </span>
              </div>
              {activeSession.topicsRequiringReview.length > 0 && (
                <div className="pt-2">
                  <div className="font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">
                    Flagged for Review
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-zinc-700 dark:text-zinc-300">
                    {activeSession.topicsRequiringReview.map((w, i) => (
                      <li key={`rev_${i}`}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </aside>

          {/* Main Lecturer Stream + Student Response Composer */}
          <section className="lg:col-span-8 border-t border-zinc-200 dark:border-zinc-800 pt-6 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0 flex flex-col">
            {/* Prior Checkpoint Carry-Over Summary (if segmentIndex > 0) */}
            {activeSegment?.summaryFromCheckpoint && (
              <div className="mb-5 border border-zinc-200 dark:border-zinc-800 rounded-md bg-zinc-50 dark:bg-zinc-900 px-4 py-3 text-xs">
                <button
                  type="button"
                  onClick={() => setShowPriorSummary((v) => !v)}
                  className="flex w-full items-center justify-between font-medium text-zinc-900 dark:text-zinc-200 cursor-pointer"
                >
                  <span>
                    Carried forward from Checkpoint (Segment {activeSegment.segmentIndex})
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400">{showPriorSummary ? 'Hide' : 'View'}</span>
                </button>
                {showPriorSummary && (
                  <p className="mt-2 text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                    {activeSegment.summaryFromCheckpoint}
                  </p>
                )}
              </div>
            )}

            {/* Lecture & Adaptive Feedback Stream */}
            <div className="space-y-6 flex-1">
              {activeEntries.map((entry) => {
                const isStudent = entry.kind === 'student_answer';
                const isPlayingThis =
                  playback.activeId === entry.id && playback.status === 'playing';
                const isLoadingAudio =
                  playback.activeId === entry.id && playback.status === 'loading';
                const isPausedThis =
                  playback.activeId === entry.id && playback.status === 'paused';

                if (isStudent) {
                  return (
                    <div key={entry.id} className="flex justify-end">
                      <div className="max-w-xl rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-200 whitespace-pre-wrap">
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          Your Answer
                        </div>
                        {entry.markdown}
                      </div>
                    </div>
                  );
                }

                return (
                  <article key={entry.id} className="border-b border-zinc-200 dark:border-zinc-800 pb-6 last:border-b-0">
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-900 dark:text-zinc-200">
                          {entry.kind === 'lesson'
                            ? 'Lecturer'
                            : entry.kind === 'reteach'
                            ? 'Simplified Reteach'
                            : entry.kind === 'checkpoint_note'
                            ? 'Context Checkpoint'
                            : 'Adaptive Evaluation'}
                        </span>
                        {entry.unitTitle && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{entry.unitTitle}</span>
                          </>
                        )}
                      </div>

                      {entry.kind !== 'lesson' && prefs.voiceEnabled && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleTogglePlay(entry.id, entry.markdown)}
                            disabled={isLoadingAudio}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer disabled:opacity-50"
                          >
                            {isLoadingAudio ? (
                              <>Generating audio...</>
                            ) : isPlayingThis ? (
                              <>
                                <Pause className="h-3.5 w-3.5" />
                                Pause
                              </>
                            ) : isPausedThis ? (
                              <>
                                <Play className="h-3.5 w-3.5" />
                                Resume
                              </>
                            ) : (
                              <>
                                <Volume2 className="h-3.5 w-3.5" />
                                Listen
                              </>
                            )}
                          </button>
                          {(isPlayingThis || isPausedThis) && (
                            <button
                              type="button"
                              onClick={() => geminiAudioPlayer.stop()}
                              aria-label="Stop playback"
                              className="inline-flex items-center rounded p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
                            >
                              <Square className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {entry.kind === 'lesson' && (
                      <LessonAudioPlayer
                        entryId={entry.id}
                        title={entry.unitTitle}
                        playback={playback}
                        isOnline={isOnline}
                        onPlayOrToggle={() => void handleTogglePlay(entry.id, entry.markdown)}
                        onRetry={() => {
                          geminiAudioPlayer.stop();
                          startLessonAudioNarration(entry.id, entry.markdown, activeSession.id);
                        }}
                      />
                    )}

                    <MarkdownMessage content={entry.markdown} />

                    {(entry.kind === 'lesson' ||
                      Boolean(cachedImages[entry.id]) ||
                      generatingImageIds.has(entry.id) ||
                      Boolean(imageErrors[entry.id])) && (
                      <GeneratedStudyImageCard
                        imageUrl={cachedImages[entry.id]?.url}
                        caption={cachedImages[entry.id]?.caption || entry.visualCaption}
                        providerLabel={cachedImages[entry.id]?.providerLabel}
                        loading={generatingImageIds.has(entry.id)}
                        error={imageErrors[entry.id] ?? null}
                        canGenerate={entry.kind === 'lesson'}
                        isOnline={isOnline}
                        onGenerate={() => void triggerEntryImageGeneration(entry, activeSession.id)}
                        onRegenerate={() =>
                          void triggerEntryImageGeneration(entry, activeSession.id)
                        }
                      />
                    )}
                  </article>
                );
              })}
              <div ref={streamEndRef} />
            </div>

            {/* Action / Answer Composer */}
            <div className="mt-6 border-t border-zinc-200 dark:border-zinc-800 pt-5 space-y-3">
              {!isOnline && !isCompleted && (
                <OfflineFeatureNotice
                  compact
                  description="You're offline. Read previously delivered lessons above freely, and turn on your internet connection when you're ready to submit answers or load the next unit."
                />
              )}
              {isCompleted ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-3 text-sm">
                  <span className="text-zinc-800 dark:text-zinc-200">
                    This Automatic Study session is completed and logged in Study History.
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => navigate('/history')}>
                    View in History
                  </Button>
                </div>
              ) : isUnitReadyToAdvance ? (
                <div className="flex flex-col gap-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <div className="font-medium text-zinc-950 dark:text-zinc-200">
                      Unit mastered{latestEvaluation ? ` (${latestEvaluation.score}/10)` : ''}.
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                      {hasMoreUnits
                        ? `Ready for Unit ${activeSession.currentUnitIndex + 2}: ${
                            activeSession.studyPlan[activeSession.currentUnitIndex + 1]?.title
                          }`
                        : 'All planned units are complete. Finish to log your session in History.'}
                    </p>
                  </div>
                  {hasMoreUnits ? (
                    <Button
                      onClick={() => void handleAdvanceToNextUnit()}
                      loading={busyAction === 'next_unit'}
                      disabled={!isOnline || busyAction !== null}
                    >
                      Continue to Unit {activeSession.currentUnitIndex + 2}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      onClick={() => void handleCompleteSession()}
                      loading={busyAction === 'completing'}
                      disabled={busyAction !== null}
                    >
                      <Check className="h-4 w-4" />
                      Finish & Log to History
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {activeSession.currentQuestion && (
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-200">Active check: </span>
                      {activeSession.currentQuestion}
                    </div>
                  )}

                  {/* Quick pedagogical helper actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!isOnline || busyAction !== null}
                      onClick={() =>
                        void handleSubmitAnswer(
                          "I'm not fully confident yet—please explain this concept more simply with an everyday analogy."
                        )
                      }
                      className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer disabled:opacity-50"
                    >
                      Explain simpler
                    </button>
                    <button
                      type="button"
                      disabled={!isOnline || busyAction !== null}
                      onClick={() =>
                        void handleSubmitAnswer(
                          'Could you walk me through a different concrete worked example before I try again?'
                        )
                      }
                      className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer disabled:opacity-50"
                    >
                      Different example
                    </button>
                    {hasMoreUnits && (
                      <button
                        type="button"
                        disabled={!isOnline || busyAction !== null}
                        onClick={() => void handleAdvanceToNextUnit()}
                        className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer disabled:opacity-50 ml-auto"
                      >
                        Skip to next unit
                      </button>
                    )}
                  </div>

                  {/* Typed + Voice Answer Form */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSubmitAnswer();
                    }}
                    className="space-y-2.5"
                  >
                    <textarea
                      rows={3}
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      placeholder={
                        isOnline
                          ? 'Explain your answer in your own words, or record a voice answer...'
                          : 'Offline — reconnect to submit answers for AI evaluation...'
                      }
                      disabled={!isOnline || busyAction !== null || transcribing}
                      className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none resize-y disabled:opacity-60"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {VoiceNoteRecorder.isSupported() && (
                          <>
                            <Button
                              type="button"
                              variant={recording ? 'danger' : 'secondary'}
                              size="sm"
                              onClick={() => void handleStartVoiceAnswer()}
                              disabled={(!isOnline && !recording) || busyAction !== null || transcribing}
                            >
                              {recording ? (
                                <>
                                  <Square className="h-3.5 w-3.5" />
                                  Stop & Transcribe ({recordingSeconds}s)
                                </>
                              ) : transcribing ? (
                                <>
                                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  Transcribing...
                                </>
                              ) : (
                                <>
                                  <Mic className="h-3.5 w-3.5" />
                                  Voice answer
                                </>
                              )}
                            </Button>
                            {recording && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleCancelRecording}
                              >
                                Cancel
                              </Button>
                            )}
                          </>
                        )}
                      </div>

                      <Button
                        type="submit"
                        size="sm"
                        loading={busyAction === 'evaluating'}
                        disabled={!isOnline || !answerText.trim() || busyAction !== null || recording || transcribing}
                      >
                        <Send className="h-3.5 w-3.5" />
                        Submit answer
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  // SESSION LAUNCHER & RESUMABLE SESSIONS OVERVIEW
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/library')}
            aria-label="Back to Library"
            title="Back to Library"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200 truncate">
            Automatic Study
          </h1>
        </div>
        <Button size="sm" onClick={() => setLauncherOpen((prev) => !prev)}>
          <GraduationCap className="h-3.5 w-3.5" />
          {launcherOpen ? 'Close setup' : 'New study session'}
        </Button>
      </div>

      {!isOnline && (
        <OfflineFeatureNotice
          title="You're offline — review previous study sessions"
          description="Starting a new AI-guided Automatic Study plan requires an internet connection. You can still open and review any previously cached study sessions below."
        />
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-800 dark:text-zinc-200">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* New Study Session Form */}
      {(launcherOpen || sessions.length === 0) && (
        <form
          onSubmit={handleCreateSession}
          className="space-y-5 border border-zinc-200 dark:border-zinc-800 rounded-md p-5 sm:p-6 bg-white dark:bg-zinc-900"
        >
          <div>
            <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-200">
              Start an Automatic Study session
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Grounded in {sources.length} uploaded {sources.length === 1 ? 'material' : 'materials'} in {activeCourse.code}.
            </p>
          </div>

          {topics.length > 0 && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Topics to cover (leave unselected for entire course)
              </label>
              <div className="flex flex-wrap gap-2">
                {topics.map((topic) => {
                  const selected = selectedTopicIds.includes(topic.id);
                  return (
                    <button
                      key={topic.id}
                      type="button"
                      onClick={() => toggleTopicSelection(topic.id)}
                      className={`rounded-md border px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                        selected
                          ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950 font-medium'
                          : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:border-zinc-500 dark:hover:border-zinc-500'
                      }`}
                    >
                      {topic.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="as-difficulty" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Teaching depth
              </label>
              <select
                id="as-difficulty"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as DifficultyLevel)}
                className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
              >
                <option value="foundational">Foundational — gentle intuition first</option>
                <option value="standard">Standard — university lecture level</option>
                <option value="advanced">Advanced — rigorous derivations & edge cases</option>
              </select>
            </div>
            <div>
              <label htmlFor="as-instructions" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Focus instructions (optional)
              </label>
              <input
                id="as-instructions"
                type="text"
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="e.g., Focus on formulas and common exam pitfalls"
                className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" loading={creating} disabled={!isOnline}>
              <GraduationCap className="h-4 w-4" />
              Begin guided study
            </Button>
            {creationPhase && <span className="text-xs text-zinc-600 dark:text-zinc-400">{creationPhase}</span>}
          </div>
        </form>
      )}

      {/* Existing Course Sessions */}
      {sessionsLoading ? (
        <LoadingSkeleton lines={3} />
      ) : sessions.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Your {activeCourse.code} Study Sessions
            </h2>
            <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">{sessions.length}</span>
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
            {sessions.map((sess) => {
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
                      <span>{formatShortDate(sess.updatedAt)}</span>
                    </div>
                    <h3 className="mt-1 text-base font-medium text-zinc-950 dark:text-zinc-200 truncate">
                      {sess.title}
                    </h3>
                    {sess.currentObjective && sess.status !== 'completed' && (
                      <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-1">
                        Current objective: {sess.currentObjective}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant={sess.status === 'completed' ? 'secondary' : 'primary'}
                      onClick={() => {
                        sessionStartRef.current = Date.now();
                        setActiveSessionId(sess.id);
                      }}
                    >
                      <Play className="h-3.5 w-3.5" />
                      {sess.status === 'completed' ? 'Review' : 'Resume'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setSessionToDelete(sess)}
                      aria-label={`Delete ${sess.title}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 dark:text-zinc-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <Modal
        open={Boolean(sessionToDelete)}
        title="Delete Automatic Study session?"
        description={
          sessionToDelete
            ? `Permanently delete "${sessionToDelete.title}" along with all its linked segments and checkpoints?`
            : undefined
        }
        onClose={() => setSessionToDelete(null)}
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            variant="secondary"
            onClick={() => setSessionToDelete(null)}
            disabled={deletingSession}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleConfirmDeleteSession()}
            loading={deletingSession}
          >
            Delete session
          </Button>
        </div>
      </Modal>
    </div>
  );
};
