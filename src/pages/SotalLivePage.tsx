import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  BookOpen,
  Captions,
  ChevronDown,
  Keyboard,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  Moon,
  PhoneOff,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Smartphone,
  Square,
  Sun,
  Tablet,
  Volume2,
  Wifi,
  WifiLow,
  WifiOff,
  X,
} from 'lucide-react';
import type { StudySource } from '../types/models';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { useStreak } from '../context/StreakContext';
import { useTheme } from '../context/ThemeContext';
import { useWorkspaceUi } from '../context/WorkspaceUiContext';
import { useCourseSources } from '../hooks/useCourseSources';
import { useRouter } from '../router/RouterContext';
import { LiveVoiceClient } from '../services/live/liveVoiceClient';
import { LessonContextDrawer } from '../components/live/LessonContextDrawer';
import { LiquidGlassOrb } from '../components/live/LiquidGlassOrb';
import {
  buildSampleConversationScript,
  buildSampleSubtitleForState,
  FALLBACK_LIVE_LESSON,
  LIVE_STATE_LABELS,
  type LiveLessonContext,
  type LiveNetworkStatus,
  type LiveViewportPreview,
  type LiveVoiceState,
} from '../components/live/types';

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function buildLessonContextFromSource(
  source: StudySource,
  courseCode: string,
  courseName: string,
  topicName: string
): LiveLessonContext {
  const cleanSnippet = source.extractedContent
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  const summary =
    cleanSnippet.length > 220
      ? `${cleanSnippet.slice(0, 217).trim()}...`
      : cleanSnippet || `Exploring key ideas and intuition inside ${source.title}.`;

  const firstHeading = source.sections[0]?.heading;
  return {
    courseCode,
    courseName,
    topicName,
    lessonTitle: source.title,
    sourceId: source.id,
    summary,
    sections: source.sections,
    keyPrompts: [
      firstHeading
        ? `Break down "${firstHeading}" in super plain language`
        : 'Give me the zero-jargon version of this lesson',
      'Test me with one chill real-world scenario',
      'What is the trickiest part people usually mix up here?',
    ],
  };
}

const PREVIEW_STATES: Array<{ id: LiveVoiceState; label: string }> = [
  { id: 'idle', label: 'Idle' },
  { id: 'listening', label: 'Listening' },
  { id: 'thinking', label: 'Thinking' },
  { id: 'speaking', label: 'Speaking' },
  { id: 'interrupting', label: 'Interrupt' },
  { id: 'disconnected', label: 'Offline' },
];

export const SotalLivePage: React.FC = () => {
  const { profile, isOnline } = useAuth();
  const { recordLearningActivity } = useStreak();
  const { theme, toggleTheme } = useTheme();
  const { activeCourse, activeContentOwnerId, topics } = useCourses();
  const { routeParams, navigate } = useRouter();
  const { setMinimizedLiveSession } = useWorkspaceUi();

  const { sources, loading: sourcesLoading } = useCourseSources(
    activeContentOwnerId,
    activeCourse?.id
  );

  const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>(
    routeParams.sourceId
  );

  useEffect(() => {
    if (routeParams.sourceId) {
      setSelectedSourceId(routeParams.sourceId);
    }
  }, [routeParams.sourceId]);

  useEffect(() => {
    setMinimizedLiveSession(null);
  }, [setMinimizedLiveSession]);

  const lesson: LiveLessonContext = useMemo(() => {
    const matchedSource =
      (selectedSourceId ? sources.find((s) => s.id === selectedSourceId) : undefined) ||
      sources[0];

    if (matchedSource && activeCourse) {
      const topicName =
        topics.find((t) => t.id === matchedSource.topicId)?.name || 'Course Library';
      return buildLessonContextFromSource(
        matchedSource,
        activeCourse.code,
        activeCourse.name,
        topicName
      );
    }

    if (activeCourse) {
      return {
        ...FALLBACK_LIVE_LESSON,
        courseCode: activeCourse.code,
        courseName: activeCourse.name,
        topicName: topics[0]?.name || FALLBACK_LIVE_LESSON.topicName,
        lessonTitle: activeCourse.name,
      };
    }

    return FALLBACK_LIVE_LESSON;
  }, [selectedSourceId, sources, activeCourse, topics]);

  const preferredVoice = profile?.preferences?.ttsVoice || 'Zephyr';

  const [voiceState, setVoiceState] = useState<LiveVoiceState>('thinking');
  const [micMuted, setMicMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0.2);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [subtitle, setSubtitle] = useState<{
    speaker: 'companion' | 'student' | 'system';
    text: string;
  }>({
    speaker: 'system',
    text: 'Opening your Jovibe Live space...',
  });

  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<LiveNetworkStatus>(() => ({
    quality: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'good',
    rttMs: null,
  }));

  const [contextOpen, setContextOpen] = useState(false);
  const [textInputOpen, setTextInputOpen] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Discreet collapsible design preview panel (collapsed by default)
  const [previewTrayOpen, setPreviewTrayOpen] = useState(false);
  const [previewOverrideMode, setPreviewOverrideMode] = useState(false);
  const [viewportPreview, setViewportPreview] = useState<LiveViewportPreview>('responsive');
  const [walkthroughPlaying, setWalkthroughPlaying] = useState(false);

  const liveClientRef = useRef<LiveVoiceClient | null>(null);
  const previewOverrideRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const textInputRef = useRef<HTMLInputElement>(null);
  const studentEngagedInLiveRef = useRef(false);
  const liveSessionQualifiedKeyRef = useRef<string>('');
  const activeCourseRef = useRef(activeCourse);
  activeCourseRef.current = activeCourse;
  const elapsedSecondsRef = useRef(elapsedSeconds);
  elapsedSecondsRef.current = elapsedSeconds;
  const recordLearningActivityRef = useRef(recordLearningActivity);
  recordLearningActivityRef.current = recordLearningActivity;

  previewOverrideRef.current = previewOverrideMode;

  const clearScheduledTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearScheduledTimers();
  }, [clearScheduledTimers]);

  // Create and manage the real-time Gemini Live voice session
  const connectLiveSession = useCallback(
    async (targetLesson: LiveLessonContext, voiceName: string) => {
      clearScheduledTimers();
      studentEngagedInLiveRef.current = false;
      setWalkthroughPlaying(false);
      setPreviewOverrideMode(false);

      if (liveClientRef.current) {
        liveClientRef.current.disconnect(true);
        liveClientRef.current = null;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setVoiceState('disconnected');
        setAudioLevel(0.08);
        setStatusDetail('Offline');
        setNetworkStatus({ quality: 'offline', rttMs: null });
        setErrorMessage(
          'Jovibe Live needs an internet connection for real-time voice conversations. Turn on your internet to reconnect, or study your cached notes and chat history in Library and Tutor.'
        );
        setSubtitle({
          speaker: 'system',
          text: 'You are currently offline. Turn on your internet connection to start Jovibe Live.',
        });
        return;
      }

      setErrorMessage(null);
      setStatusDetail('Connecting...');
      setSubtitle({
        speaker: 'system',
        text: `Joining Jovibe Live for "${targetLesson.lessonTitle}"...`,
      });

      const sessionQualificationKey = `${targetLesson.courseCode}:${targetLesson.sourceId || targetLesson.lessonTitle}`;

      const client = new LiveVoiceClient({
        onStateChange: (nextState) => {
          if (!previewOverrideRef.current) {
            setVoiceState(nextState);
          }
        },
        onAudioLevel: (level) => {
          if (!previewOverrideRef.current) {
            setAudioLevel(level);
          }
        },
        onTranscript: (speaker, text) => {
          if (!previewOverrideRef.current) {
            setSubtitle({ speaker, text });
            if (speaker === 'student' && text.trim().length >= 3) {
              studentEngagedInLiveRef.current = true;
            } else if (
              speaker === 'companion' &&
              text.trim().length >= 15 &&
              studentEngagedInLiveRef.current &&
              liveSessionQualifiedKeyRef.current !== sessionQualificationKey
            ) {
              liveSessionQualifiedKeyRef.current = sessionQualificationKey;
              void recordLearningActivityRef.current({
                activityType: 'live',
                title: targetLesson.lessonTitle,
                courseId: activeCourseRef.current?.id || 'live',
                courseCode: targetLesson.courseCode,
                isSharedCourse: Boolean(activeCourseRef.current?.isShared),
                durationSeconds: Math.max(45, elapsedSecondsRef.current),
                summary: `Completed live voice discussion on ${targetLesson.lessonTitle}.`,
              });
            }
          }
        },
        onStatusDetail: (detail) => {
          setStatusDetail(detail);
        },
        onNeedsAudioUnlock: (needs) => {
          setNeedsAudioUnlock(needs);
        },
        onNetworkStatus: (status) => {
          setNetworkStatus(status);
        },
        onError: (err) => {
          setErrorMessage(err);
          if (err) {
            setSubtitle({ speaker: 'system', text: err });
          }
        },
      });

      liveClientRef.current = client;
      const connected = await client.connect({
        lesson: targetLesson,
        voiceName,
        sendGreeting: true,
      });

      if (connected) {
        setMicMuted(!client.hasMicrophone);
      }
    },
    [clearScheduledTimers]
  );

  // Wait until sources finish initial load (if activeCourse exists) so we connect with the real lesson
  const waitingForInitialSources = Boolean(activeCourse && sourcesLoading && sources.length === 0);
  const lessonSessionKey = `${lesson.courseCode}:${lesson.sourceId || lesson.lessonTitle}:${preferredVoice}`;
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;

  useEffect(() => {
    if (waitingForInitialSources) {
      return;
    }
    void connectLiveSession(lessonRef.current, preferredVoice);

    return () => {
      liveClientRef.current?.disconnect(true);
      liveClientRef.current = null;
    };
  }, [lessonSessionKey, waitingForInitialSources, preferredVoice, isOnline, connectLiveSession]);

  // Automatically resume suspended input/output AudioContexts on the first pointer or key gesture
  useEffect(() => {
    if (!needsAudioUnlock) return;
    const handleUnlockGesture = () => {
      void liveClientRef.current?.unlockAudio();
    };
    window.addEventListener('pointerdown', handleUnlockGesture, { passive: true });
    window.addEventListener('keydown', handleUnlockGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleUnlockGesture);
      window.removeEventListener('keydown', handleUnlockGesture);
    };
  }, [needsAudioUnlock]);

  // Elapsed conversation timer (pauses gently if disconnected)
  useEffect(() => {
    if (voiceState === 'disconnected') return;
    const id = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [voiceState]);

  // Focus inline text input when opened
  useEffect(() => {
    if (textInputOpen) {
      const id = window.setTimeout(() => textInputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [textInputOpen]);

  const stopWalkthrough = useCallback(() => {
    clearScheduledTimers();
    setWalkthroughPlaying(false);
  }, [clearScheduledTimers]);

  const exitPreviewOverride = useCallback(() => {
    stopWalkthrough();
    setPreviewOverrideMode(false);
    if (!liveClientRef.current?.connected) {
      void connectLiveSession(lesson, preferredVoice);
    } else {
      setVoiceState(micMuted ? 'idle' : 'listening');
      setAudioLevel(0.14);
    }
  }, [stopWalkthrough, connectLiveSession, lesson, preferredVoice, micMuted]);

  const applyManualPreviewState = useCallback(
    (nextState: LiveVoiceState) => {
      stopWalkthrough();
      setPreviewOverrideMode(true);
      liveClientRef.current?.stopPlayback(false);
      setVoiceState(nextState);
      setSubtitle(buildSampleSubtitleForState(nextState, lesson.lessonTitle));

      if (nextState === 'disconnected') {
        setAudioLevel(0);
      } else if (nextState === 'idle') {
        setAudioLevel(0.14);
      } else if (nextState === 'thinking') {
        setAudioLevel(0.28);
      } else if (nextState === 'listening') {
        setAudioLevel((prev) => (prev < 0.35 ? 0.62 : prev));
      } else if (nextState === 'speaking') {
        setAudioLevel((prev) => (prev < 0.4 ? 0.72 : prev));
      } else if (nextState === 'interrupting') {
        setAudioLevel(0.74);
        const t = window.setTimeout(() => {
          setVoiceState('listening');
        }, 720);
        timersRef.current.push(t);
      }
    },
    [lesson.lessonTitle, stopWalkthrough]
  );

  const handleToggleWalkthrough = useCallback(() => {
    if (walkthroughPlaying) {
      exitPreviewOverride();
      return;
    }

    clearScheduledTimers();
    setPreviewOverrideMode(true);
    liveClientRef.current?.stopPlayback(false);
    setWalkthroughPlaying(true);

    const script = buildSampleConversationScript(lesson.lessonTitle);
    let offsetMs = 0;

    script.forEach((step, idx) => {
      const id = window.setTimeout(() => {
        setVoiceState(step.state);
        setAudioLevel(step.simulatedLevel);
        if (step.subtitle) {
          setSubtitle({ speaker: step.speaker, text: step.subtitle });
        }
        if (idx === script.length - 1) {
          setWalkthroughPlaying(false);
        }
      }, offsetMs);
      timersRef.current.push(id);
      offsetMs += step.durationMs;
    });
  }, [walkthroughPlaying, exitPreviewOverride, clearScheduledTimers, lesson.lessonTitle]);

  const handleOrbTap = useCallback(() => {
    void liveClientRef.current?.unlockAudio();

    if (previewOverrideMode) {
      exitPreviewOverride();
      return;
    }

    if (voiceState === 'disconnected' || !liveClientRef.current?.connected) {
      void connectLiveSession(lesson, preferredVoice);
      return;
    }

    if (voiceState === 'speaking') {
      // Smoothly interrupt the AI mid-sentence and hand the floor back to the student
      liveClientRef.current.handleBargeIn();
      return;
    }

    if (!liveClientRef.current.hasMicrophone) {
      void liveClientRef.current.enableMicrophone().then((enabled) => {
        setMicMuted(!enabled);
      });
      return;
    }

    if (micMuted) {
      setMicMuted(false);
      liveClientRef.current.setMuted(false);
      setVoiceState('listening');
    }
  }, [
    previewOverrideMode,
    exitPreviewOverride,
    voiceState,
    connectLiveSession,
    lesson,
    preferredVoice,
    micMuted,
  ]);

  const handleMicToggle = useCallback(() => {
    void liveClientRef.current?.unlockAudio();

    if (previewOverrideMode) {
      exitPreviewOverride();
      return;
    }

    if (voiceState === 'disconnected' || !liveClientRef.current?.connected) {
      void connectLiveSession(lesson, preferredVoice);
      return;
    }

    if (!liveClientRef.current.hasMicrophone) {
      // Enable microphone in-place without disconnecting the active Live voice session
      void liveClientRef.current.enableMicrophone().then((enabled) => {
        setMicMuted(!enabled);
      });
      return;
    }

    const nextMuted = !micMuted;
    setMicMuted(nextMuted);
    liveClientRef.current.setMuted(nextMuted);

    if (!nextMuted && voiceState === 'speaking') {
      liveClientRef.current.handleBargeIn();
    } else if (!nextMuted) {
      setVoiceState('listening');
    }
  }, [
    previewOverrideMode,
    exitPreviewOverride,
    voiceState,
    connectLiveSession,
    lesson,
    preferredVoice,
    micMuted,
  ]);

  const handleSendTextToLive = useCallback(
    (message: string) => {
      const cleaned = message.trim();
      if (!cleaned) return;
      if (previewOverrideMode) {
        stopWalkthrough();
        setPreviewOverrideMode(false);
      }
      studentEngagedInLiveRef.current = true;
      if (!liveClientRef.current?.connected) {
        void connectLiveSession(lesson, preferredVoice).then(() => {
          liveClientRef.current?.sendText(cleaned);
        });
        return;
      }
      liveClientRef.current.sendText(cleaned);
    },
    [previewOverrideMode, stopWalkthrough, connectLiveSession, lesson, preferredVoice]
  );

  const handleSubmitText = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = draftText.trim();
    if (!cleaned) return;
    setDraftText('');
    setTextInputOpen(false);
    handleSendTextToLive(cleaned);
  };

  const handleMinimize = () => {
    liveClientRef.current?.disconnect(true);
    setMinimizedLiveSession({
      sourceId: lesson.sourceId,
      lessonTitle: lesson.lessonTitle,
      courseCode: lesson.courseCode,
    });
    navigate('/library');
  };

  const handleEndSession = () => {
    stopWalkthrough();
    liveClientRef.current?.disconnect(true);
    setMinimizedLiveSession(null);
    navigate('/library');
  };

  const isDark = theme === 'dark';
  const isFramed = viewportPreview !== 'responsive';
  const isMobileFrame = viewportPreview === 'mobile';
  const statusLabel = statusDetail
    ? statusDetail
    : micMuted && voiceState === 'idle'
    ? 'Mic muted'
    : LIVE_STATE_LABELS[voiceState];

  const ambientBackdropStyle = useMemo<React.CSSProperties>(() => {
    if (voiceState === 'disconnected') {
      return {
        background: isDark
          ? 'radial-gradient(circle at 50% 44%, rgba(63, 68, 82, 0.16) 0%, rgba(9, 11, 16, 1) 68%)'
          : 'radial-gradient(circle at 50% 44%, rgba(148, 163, 184, 0.14) 0%, rgba(246, 248, 251, 1) 68%)',
      };
    }
    if (isDark) {
      return {
        background:
          voiceState === 'thinking'
            ? 'radial-gradient(circle at 50% 44%, rgba(99, 102, 241, 0.16) 0%, rgba(14, 165, 233, 0.06) 36%, rgba(9, 11, 16, 1) 74%)'
            : 'radial-gradient(circle at 50% 44%, rgba(34, 211, 238, 0.14) 0%, rgba(99, 102, 241, 0.07) 38%, rgba(9, 11, 16, 1) 74%)',
      };
    }
    return {
      background:
        voiceState === 'thinking'
          ? 'radial-gradient(circle at 50% 44%, rgba(165, 180, 252, 0.24) 0%, rgba(186, 230, 253, 0.12) 40%, rgba(246, 248, 251, 1) 76%)'
          : 'radial-gradient(circle at 50% 44%, rgba(125, 211, 252, 0.22) 0%, rgba(196, 181, 253, 0.12) 40%, rgba(246, 248, 251, 1) 76%)',
    };
  }, [isDark, voiceState]);

  const frameWrapperClasses =
    viewportPreview === 'mobile'
      ? 'md:my-5 md:h-[min(844px,calc(100dvh-2.5rem))] md:w-[390px] md:rounded-[34px] md:border md:border-zinc-300/80 md:dark:border-zinc-800 md:shadow-[0_28px_80px_rgba(0,0,0,0.22)] md:dark:shadow-[0_28px_90px_rgba(0,0,0,0.75)]'
      : viewportPreview === 'tablet'
      ? 'md:my-5 md:h-[min(920px,calc(100dvh-2.5rem))] md:w-[min(768px,calc(100vw-3rem))] md:rounded-[28px] md:border md:border-zinc-300/80 md:dark:border-zinc-800 md:shadow-[0_28px_80px_rgba(0,0,0,0.2)] md:dark:shadow-[0_28px_90px_rgba(0,0,0,0.72)]'
      : 'h-full w-full';

  return (
    <div
      className={`relative flex h-full w-full flex-1 items-center justify-center overflow-hidden transition-colors duration-300 ${
        isFramed
          ? 'bg-zinc-200/85 dark:bg-[#050608]'
          : 'bg-[#F6F8FB] dark:bg-[#090B10]'
      }`}
    >
      {/* Main Immersive Stage */}
      <div
        style={ambientBackdropStyle}
        className={`relative flex flex-col overflow-hidden text-zinc-900 dark:text-zinc-100 transition-all duration-300 ${frameWrapperClasses}`}
      >
        {/* TOP BAR */}
        <header className="relative z-20 flex shrink-0 items-center justify-between gap-3 px-4 sm:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-baseline gap-1.5 shrink-0 select-none">
              <span className="font-display text-[15px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
                Jovibe
              </span>
              <span className="font-display text-[15px] font-normal tracking-tight text-sky-600 dark:text-cyan-300/90">
                Live
              </span>
            </div>

            {!isMobileFrame && (
              <span
                aria-hidden="true"
                className="hidden sm:inline-block h-3.5 w-px bg-zinc-300 dark:bg-zinc-800 shrink-0"
              />
            )}

            {!isMobileFrame && (
              <button
                type="button"
                onClick={() => setContextOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 min-w-0 max-w-[340px] rounded-lg px-2 py-1 text-left text-xs text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100 transition-colors cursor-pointer"
                title="View lesson context"
              >
                <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0">
                  {lesson.courseCode}
                </span>
                <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                  ·
                </span>
                <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">
                  {lesson.lessonTitle}
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Live Network Quality Indicator */}
            <div
              role="status"
              aria-live="polite"
              title={
                networkStatus.quality === 'offline'
                  ? 'Offline — no internet connection'
                  : networkStatus.quality === 'poor'
                  ? `Very slow network${networkStatus.rttMs ? ` (${networkStatus.rttMs}ms)` : ''}${
                      networkStatus.reason ? ` — ${networkStatus.reason}` : ''
                    }`
                  : networkStatus.quality === 'slow'
                  ? `Slow network${networkStatus.rttMs ? ` (${networkStatus.rttMs}ms)` : ''}${
                      networkStatus.reason ? ` — ${networkStatus.reason}` : ''
                    }`
                  : `Network good${networkStatus.rttMs ? ` (${networkStatus.rttMs}ms)` : ''}`
              }
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium select-none transition-colors ${
                networkStatus.quality === 'offline'
                  ? 'border border-rose-300/80 bg-rose-500/10 text-rose-700 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-300'
                  : networkStatus.quality === 'poor'
                  ? 'border border-rose-300/80 bg-rose-500/10 text-rose-700 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-300'
                  : networkStatus.quality === 'slow'
                  ? 'border border-amber-300/80 bg-amber-500/12 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-300'
                  : 'text-emerald-700/90 dark:text-emerald-400/90'
              }`}
            >
              {networkStatus.quality === 'offline' ? (
                <>
                  <WifiOff className="h-3.5 w-3.5 shrink-0" />
                  <span>Offline</span>
                </>
              ) : networkStatus.quality === 'poor' ? (
                <>
                  <WifiLow className="h-3.5 w-3.5 shrink-0" />
                  <span>Very slow</span>
                  {networkStatus.rttMs !== null && !isMobileFrame && (
                    <span className="hidden sm:inline font-mono text-[10px] opacity-80 tabular-nums">
                      · {networkStatus.rttMs}ms
                    </span>
                  )}
                </>
              ) : networkStatus.quality === 'slow' ? (
                <>
                  <WifiLow className="h-3.5 w-3.5 shrink-0" />
                  <span>Slow network</span>
                  {networkStatus.rttMs !== null && !isMobileFrame && (
                    <span className="hidden sm:inline font-mono text-[10px] opacity-80 tabular-nums">
                      · {networkStatus.rttMs}ms
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Wifi className="h-3.5 w-3.5 shrink-0" />
                  {networkStatus.rttMs !== null && !isMobileFrame && (
                    <span className="hidden sm:inline font-mono text-[10px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                      {networkStatus.rttMs}ms
                    </span>
                  )}
                </>
              )}
            </div>

            <span
              aria-label={`Session duration ${formatElapsed(elapsedSeconds)}`}
              className="mr-1 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400 select-none"
            >
              {formatElapsed(elapsedSeconds)}
            </span>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-900/6 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/8 dark:hover:text-zinc-100 transition-colors cursor-pointer"
            >
              {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </button>

            <button
              type="button"
              onClick={handleMinimize}
              aria-label="Minimize Jovibe Live"
              title="Minimize to Library"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-900/6 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/8 dark:hover:text-zinc-100 transition-colors cursor-pointer"
            >
              <Minimize2 className="h-[17px] w-[17px]" />
            </button>

            <button
              type="button"
              onClick={handleEndSession}
              aria-label="Close Jovibe Live"
              title="Close"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-900/6 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/8 dark:hover:text-zinc-100 transition-colors cursor-pointer"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        {/* Mobile-Only Lesson Context Strip */}
        <div
          className={`relative z-20 flex justify-center px-5 pt-0.5 ${
            isMobileFrame ? '' : 'sm:hidden'
          }`}
        >
          <button
            type="button"
            onClick={() => setContextOpen(true)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100 transition-colors cursor-pointer"
          >
            <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0">
              {lesson.courseCode}
            </span>
            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
              ·
            </span>
            <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">
              {lesson.lessonTitle}
            </span>
          </button>
        </div>

        {/* CENTER STAGE — 3D Liquid-Glass Orb + Dynamic Status + Live Subtitle */}
        <section
          aria-label="Voice companion stage"
          className="relative flex flex-1 min-h-0 flex-col items-center justify-center px-5 sm:px-8"
        >
          <div
            className={`relative flex w-full items-center justify-center ${
              isMobileFrame
                ? 'h-[290px] max-w-[320px]'
                : 'h-[min(46dvh,390px)] min-h-[250px] max-w-[440px]'
            }`}
          >
            <LiquidGlassOrb
              voiceState={voiceState}
              audioLevel={micMuted && voiceState === 'listening' ? 0.08 : audioLevel}
              isDark={isDark}
              onOrbTap={handleOrbTap}
              className="h-full w-full"
            />
          </div>

          <div className="relative z-10 mt-1 flex w-full max-w-[540px] flex-col items-center text-center min-h-[104px]">
            <AnimatePresence mode="wait">
              <motion.p
                key={statusLabel}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className={`font-display text-sm sm:text-[15px] font-medium tracking-wide ${
                  voiceState === 'disconnected'
                    ? 'text-zinc-500 dark:text-zinc-400'
                    : voiceState === 'speaking'
                    ? 'text-sky-700 dark:text-cyan-200'
                    : voiceState === 'listening' || voiceState === 'interrupting'
                    ? 'text-teal-700 dark:text-teal-200'
                    : 'text-zinc-800 dark:text-zinc-200'
                }`}
              >
                {statusLabel}
              </motion.p>
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {showSubtitles && subtitle.text && (
                <motion.p
                  key={`${subtitle.speaker}:${subtitle.text.slice(0, 40)}`}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                  className={`mt-2.5 max-w-[46ch] text-[13.5px] sm:text-[14.5px] leading-relaxed line-clamp-3 ${
                    subtitle.speaker === 'student'
                      ? 'italic text-zinc-600 dark:text-zinc-400'
                      : subtitle.speaker === 'system'
                      ? 'text-zinc-500 dark:text-zinc-400'
                      : 'text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {subtitle.text}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Slow / Poor Network Gentle Notice */}
            <AnimatePresence>
              {(networkStatus.quality === 'slow' || networkStatus.quality === 'poor') &&
                voiceState !== 'disconnected' && (
                  <motion.p
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className={`mt-2 text-xs ${
                      networkStatus.quality === 'poor'
                        ? 'text-rose-600 dark:text-rose-300'
                        : 'text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {networkStatus.quality === 'poor'
                      ? 'Very slow connection — voice replies may pause or lag.'
                      : 'Slow network detected — replies may take a few extra seconds.'}
                  </motion.p>
                )}
            </AnimatePresence>

            {/* Browser Audio Autoplay Unlock Prompt (shown only if browser suspended AudioContext) */}
            <AnimatePresence>
              {needsAudioUnlock && voiceState !== 'disconnected' && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="mt-3.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      void liveClientRef.current?.unlockAudio();
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-zinc-900 px-4 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white transition-colors cursor-pointer"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    Tap to enable mic &amp; sound
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Reconnection Action when Disconnected */}
            <AnimatePresence>
              {voiceState === 'disconnected' && !previewOverrideMode && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.2 }}
                  className="mt-4 flex flex-wrap items-center justify-center gap-2.5"
                >
                  <button
                    type="button"
                    onClick={() => void connectLiveSession(lesson, preferredVoice)}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-zinc-900 px-5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white transition-colors cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reconnect
                  </button>
                  {errorMessage && /key|settings/i.test(errorMessage) && (
                    <button
                      type="button"
                      onClick={() => navigate('/settings')}
                      className="inline-flex h-10 items-center rounded-full border border-zinc-300 dark:border-zinc-700 px-4 text-xs font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-100 transition-colors cursor-pointer"
                    >
                      Check Settings
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* BOTTOM DOCK */}
        <footer className="relative z-20 shrink-0 px-4 sm:px-6 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-2">
          <AnimatePresence>
            {textInputOpen && (
              <motion.form
                onSubmit={handleSubmitText}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="mx-auto mb-3.5 flex w-full max-w-[440px] items-center gap-2 rounded-full border border-zinc-300/90 dark:border-zinc-800 bg-white/95 dark:bg-[#13161E]/95 pl-4 pr-1.5 py-1.5 shadow-sm"
              >
                <input
                  ref={textInputRef}
                  type="text"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Ask or joke about this lesson..."
                  aria-label="Send a note to Jovibe Live"
                  className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!draftText.trim()}
                  aria-label="Send message"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-35 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </motion.form>
            )}
          </AnimatePresence>

          <div className="mx-auto flex max-w-[360px] items-center justify-between gap-2">
            {/* 1. Lesson Context */}
            <button
              type="button"
              onClick={() => setContextOpen(true)}
              aria-label="Open lesson context"
              title="Lesson context"
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors cursor-pointer ${
                contextOpen
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950'
                  : 'border-zinc-200/90 bg-white/90 text-zinc-700 hover:border-zinc-400 hover:text-zinc-950 dark:border-zinc-800 dark:bg-[#141720]/90 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100'
              }`}
            >
              <BookOpen className="h-[18px] w-[18px]" />
            </button>

            {/* 2. Optional Text Input Toggle */}
            <button
              type="button"
              onClick={() => setTextInputOpen((prev) => !prev)}
              aria-label={textInputOpen ? 'Hide text input' : 'Type a message'}
              aria-pressed={textInputOpen}
              title="Type instead"
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors cursor-pointer ${
                textInputOpen
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950'
                  : 'border-zinc-200/90 bg-white/90 text-zinc-700 hover:border-zinc-400 hover:text-zinc-950 dark:border-zinc-800 dark:bg-[#141720]/90 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100'
              }`}
            >
              <Keyboard className="h-[18px] w-[18px]" />
            </button>

            {/* 3. Central Microphone Mute / Unmute */}
            <button
              type="button"
              onClick={handleMicToggle}
              aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
              aria-pressed={micMuted}
              title={micMuted ? 'Unmute microphone' : 'Mute microphone'}
              className={`inline-flex h-14 w-14 items-center justify-center rounded-full transition-all duration-200 cursor-pointer ${
                voiceState === 'disconnected'
                  ? 'border border-zinc-300 dark:border-zinc-700 bg-zinc-200/80 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400'
                  : micMuted
                  ? 'border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  : 'bg-zinc-950 text-white shadow-[0_10px_28px_rgba(14,165,233,0.22)] hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:shadow-[0_10px_30px_rgba(56,189,248,0.24)] dark:hover:bg-white'
              }`}
            >
              {micMuted || voiceState === 'disconnected' ? (
                <MicOff className="h-5 w-5" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </button>

            {/* 4. Subtitles Toggle */}
            <button
              type="button"
              onClick={() => setShowSubtitles((prev) => !prev)}
              aria-label={showSubtitles ? 'Hide live transcript' : 'Show live transcript'}
              aria-pressed={showSubtitles}
              title={showSubtitles ? 'Hide transcript' : 'Show transcript'}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors cursor-pointer ${
                showSubtitles
                  ? 'border-zinc-300 bg-white/95 text-zinc-900 hover:border-zinc-400 dark:border-zinc-700 dark:bg-[#191D29]/95 dark:text-zinc-100 dark:hover:border-zinc-600'
                  : 'border-zinc-200/80 bg-white/75 text-zinc-400 hover:text-zinc-700 dark:border-zinc-800/90 dark:bg-[#141720]/75 dark:text-zinc-500 dark:hover:text-zinc-300'
              }`}
            >
              <Captions className="h-[18px] w-[18px]" />
            </button>

            {/* 5. End Conversation */}
            <button
              type="button"
              onClick={handleEndSession}
              aria-label="End Jovibe Live session"
              title="End conversation"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-rose-200/90 bg-rose-50/90 text-rose-600 hover:bg-rose-600 hover:border-rose-600 hover:text-white dark:border-rose-950/80 dark:bg-rose-950/45 dark:text-rose-300 dark:hover:bg-rose-600 dark:hover:border-rose-500 dark:hover:text-white transition-colors cursor-pointer"
            >
              <PhoneOff className="h-[18px] w-[18px]" />
            </button>
          </div>

          {/* Discreet Bottom-Edge Design Preview Trigger */}
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => setPreviewTrayOpen((prev) => !prev)}
              aria-expanded={previewTrayOpen}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors cursor-pointer"
            >
              {previewTrayOpen ? (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Hide preview controls
                </>
              ) : (
                <>
                  <SlidersHorizontal className="h-3 w-3" />
                  Preview states &amp; layouts
                </>
              )}
            </button>
          </div>
        </footer>

        {/* DISCREET COLLAPSIBLE PREVIEW TRAY */}
        <AnimatePresence>
          {previewTrayOpen && (
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-30 shrink-0 border-t border-zinc-200/90 dark:border-zinc-800/90 bg-[#FAFBFC]/98 dark:bg-[#10131A]/98 px-4 sm:px-6 py-3.5"
            >
              <div className="mx-auto max-w-[680px] space-y-3">
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {previewOverrideMode && (
                    <button
                      type="button"
                      onClick={exitPreviewOverride}
                      className="rounded-full bg-sky-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-sky-700 dark:bg-cyan-400 dark:text-zinc-950 transition-colors cursor-pointer"
                    >
                      Return to live voice
                    </button>
                  )}
                  {PREVIEW_STATES.map((st) => {
                    const active = voiceState === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => applyManualPreviewState(st.id)}
                        className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                          active
                            ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                            : 'bg-zinc-200/70 text-zinc-700 hover:bg-zinc-300/80 dark:bg-zinc-800/90 dark:text-zinc-300 dark:hover:bg-zinc-700'
                        }`}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                  <label className="flex items-center gap-2 min-w-[165px] flex-1 max-w-[240px]">
                    <span className="shrink-0">Voice level</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(audioLevel * 100)}
                      onChange={(e) => {
                        setPreviewOverrideMode(true);
                        setAudioLevel(Number(e.target.value) / 100);
                      }}
                      aria-label="Simulated voice volume"
                      className="h-1 flex-1 accent-zinc-900 dark:accent-cyan-300 cursor-pointer"
                    />
                    <span className="w-7 text-right font-mono tabular-nums text-[10px]">
                      {Math.round(audioLevel * 100)}%
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={handleToggleWalkthrough}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-colors cursor-pointer ${
                      walkthroughPlaying
                        ? 'border-sky-600 bg-sky-600 text-white dark:border-cyan-400 dark:bg-cyan-400 dark:text-zinc-950'
                        : 'border-zinc-300 bg-white text-zinc-800 hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500'
                    }`}
                  >
                    {walkthroughPlaying ? (
                      <>
                        <Square className="h-2.5 w-2.5 fill-current" />
                        Stop demo
                      </>
                    ) : (
                      <>
                        <Play className="h-2.5 w-2.5 fill-current" />
                        Play state demo
                      </>
                    )}
                  </button>

                  <div className="hidden md:inline-flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-0.5">
                    {(
                      [
                        { id: 'responsive' as const, label: 'Full', icon: Monitor },
                        { id: 'tablet' as const, label: 'Tablet', icon: Tablet },
                        { id: 'mobile' as const, label: 'Mobile', icon: Smartphone },
                      ]
                    ).map((vp) => {
                      const Icon = vp.icon;
                      const active = viewportPreview === vp.id;
                      return (
                        <button
                          key={vp.id}
                          type="button"
                          onClick={() => setViewportPreview(vp.id)}
                          aria-label={`Preview ${vp.label} layout`}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                            active
                              ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                              : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                          }`}
                        >
                          <Icon className="h-3 w-3" />
                          <span>{vp.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* LESSON CONTEXT DRAWER */}
        <LessonContextDrawer
          open={contextOpen}
          onClose={() => setContextOpen(false)}
          lesson={lesson}
          availableSources={sources}
          onSelectSource={(src) => {
            setSelectedSourceId(src.id);
          }}
          onPromptSelect={(prompt) => {
            handleSendTextToLive(prompt);
          }}
          containedInFrame={isFramed}
          forceMobileSheet={isMobileFrame}
        />
      </div>
    </div>
  );
};
