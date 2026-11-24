import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Check,
  Copy,
  Loader2,
  Menu,
  Mic,
  Pause,
  Play,
  Send,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import {
  DEFAULT_USER_PREFERENCES,
  type GeminiTtsVoice,
  type TutorConversation,
  type TutorMessage,
  type TutorSourceMode,
} from '../types/models';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { useStreak } from '../context/StreakContext';
import { useWorkspaceUi } from '../context/WorkspaceUiContext';
import { useRouter } from '../router/RouterContext';
import { useCourseSources } from '../hooks/useCourseSources';
import { formatReadableError } from '../services/firebase/errors';
import {
  appendConversationMessage,
  createConversation,
  deleteConversation,
  markMessageSaved,
  renameConversation,
  subscribeConversationMessages,
  subscribeCourseConversations,
  updateConversationSourceMode,
} from '../services/firebase/tutorService';
import { saveTutorResponseAsMaterial } from '../services/firebase/savedMaterialService';
import { deriveConversationTitle, runCourseTutorTurn } from '../services/ai/tutorEngine';
import {
  AVAILABLE_AI_MODELS,
  AVAILABLE_TTS_VOICES,
  transcribeAudioWithClient,
} from '../services/ai/geminiClient';
import {
  geminiAudioPlayer,
  VoiceNoteRecorder,
  type PlaybackState,
} from '../services/ai/audioService';
import {
  buildChatImagePrompt,
  detectExplicitImageRequest,
  generateAndCacheStudyImage,
} from '../services/ai/imageService';
import { isProvider, PROVIDERS } from '../services/ai/providers';
import {
  deleteCachedGeneratedImagesByScope,
  deleteCachedTutorAudioByConversation,
  getCachedGeneratedImagesForScope,
  getCachedTutorAudioIdsForConversation,
} from '../services/local/indexedDb';
import { generateDocumentId } from '../utils/validation';
import { RevokedCourseNotice } from '../components/courses/RevokedCourseNotice';
import { Button } from '../components/ui/Button';
import { GeneratedStudyImageCard } from '../components/ui/GeneratedStudyImageCard';
import { OfflineFeatureNotice } from '../components/ui/OfflineFeatureNotice';
import { EmptyState, ErrorBanner, LoadingSkeleton } from '../components/ui/StateViews';
import { ConversationSidebar } from '../components/tutor/ConversationSidebar';
import { MarkdownMessage } from '../components/tutor/MarkdownMessage';
import { SaveResponseModal } from '../components/tutor/SaveResponseModal';

const SOURCE_MODE_OPTIONS: Array<{
  value: TutorSourceMode;
  label: string;
}> = [
  { value: 'materials_only', label: 'My Materials Only' },
  { value: 'materials_plus_ai', label: 'My Materials + AI Explanation' },
  { value: 'general_ai', label: 'General AI Knowledge' },
];

const QUICK_FOLLOWUPS = [
  'Explain this more simply',
  'Give a worked example',
  'Summarize key exam points',
];

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

interface LoadedChatImage {
  url: string;
  caption: string;
  providerLabel: string;
  prompt: string;
}

function formatChatImageProviderLabel(provider: string): string {
  return isProvider(provider) ? PROVIDERS[provider].shortLabel : provider;
}

export const TutorPage: React.FC = () => {
  const { user, profile, isOnline, savePreferences } = useAuth();
  const {
    activeCourse,
    activeContentOwnerId,
    activeCourseAccessRevoked,
    topics,
    coursesLoading,
  } = useCourses();
  const { recordLearningActivity } = useStreak();
  const { setHideHeader, setHideBottomNav, setLockViewport } = useWorkspaceUi();
  const { navigate } = useRouter();
  const { sources, loading: sourcesLoading } = useCourseSources(
    activeContentOwnerId,
    activeCourse?.id
  );

  const prefs = profile?.preferences ?? DEFAULT_USER_PREFERENCES;

  // Conversations & messages state
  const [conversations, setConversations] = useState<TutorConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  // Tutor controls state
  const [sourceMode, setSourceMode] = useState<TutorSourceMode>(prefs.tutorSourceMode);
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [savingPref, setSavingPref] = useState(false);

  // Composer & generation state
  const [input, setInput] = useState('');
  const [composerFocused, setComposerFocused] = useState(false);
  const [sendPhase, setSendPhase] = useState<'idle' | 'thinking' | 'generating_audio'>('idle');
  const sending = sendPhase !== 'idle';
  const [streamingReply, setStreamingReply] = useState<{
    messageId: string;
    fullText: string;
    revealedLength: number;
    durationSeconds: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Save response modal state
  const [saveTargetMessage, setSaveTargetMessage] = useState<TutorMessage | null>(null);

  // Gemini 3.8 TTS audio playback state
  const [playback, setPlayback] = useState<PlaybackState>(() => geminiAudioPlayer.getState());
  const [cachedAudioIds, setCachedAudioIds] = useState<Set<string>>(() => new Set());

  // Device-local generated images (ONLY created when the user explicitly requests an image in chat; never stored in cloud)
  const [cachedImages, setCachedImages] = useState<Record<string, LoadedChatImage>>({});
  const cachedImagesRef = useRef<Record<string, LoadedChatImage>>({});
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(() => new Set());
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  // Gemini 3.5 Transcribe voice-note recorder state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);

  const recorderRef = useRef<VoiceNoteRecorder | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const explicitNewThreadRef = useRef(false);
  const inputRef = useRef(input);
  inputRef.current = input;

  const lastConvStorageKey =
    user?.uid && activeCourse?.id ? `sotal:last_tutor_conv:${user.uid}:${activeCourse.id}` : '';

  const readStoredConversationId = (key: string): string | null => {
    if (!key || typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key) || null;
    } catch {
      return null;
    }
  };

  const writeStoredConversationId = (key: string, conversationId: string | null) => {
    if (!key || typeof window === 'undefined') return;
    try {
      if (conversationId) {
        window.localStorage.setItem(key, conversationId);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore storage quota errors
    }
  };

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  // Tutor page never displays the global application header
  useEffect(() => {
    setHideHeader(true);
    return () => setHideHeader(false);
  }, [setHideHeader]);

  // Lock outer page viewport when in the chat workspace so ONLY messages scroll
  const isChatWorkspace = !coursesLoading && Boolean(activeCourse);
  useEffect(() => {
    setLockViewport(isChatWorkspace);
    return () => setLockViewport(false);
  }, [isChatWorkspace, setLockViewport]);

  // Hide mobile bottom pill navigation while the chat input is focused
  useEffect(() => {
    setHideBottomNav(composerFocused);
    return () => setHideBottomNav(false);
  }, [composerFocused, setHideBottomNav]);

  // Dismiss settings tooltip popup on outside click or Escape
  useEffect(() => {
    if (!settingsMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setSettingsMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [settingsMenuOpen]);

  // Subscribe to global Gemini 3.8 audio playback state
  useEffect(() => {
    const unsubscribe = geminiAudioPlayer.subscribe(setPlayback);
    return () => {
      unsubscribe();
      geminiAudioPlayer.stop();
    };
  }, []);

  // Load IDs of messages in the active conversation that already have saved local audio & local images
  useEffect(() => {
    for (const item of Object.values(cachedImagesRef.current)) {
      URL.revokeObjectURL(item.url);
    }
    cachedImagesRef.current = {};
    setCachedImages({});
    setImageErrors({});

    if (!activeConversationId) {
      setCachedAudioIds(new Set());
      return;
    }
    let cancelled = false;
    const convId = activeConversationId;

    void getCachedTutorAudioIdsForConversation(convId).then((ids) => {
      if (!cancelled) {
        setCachedAudioIds(ids);
      }
    });

    void getCachedGeneratedImagesForScope(convId).then((rows) => {
      if (cancelled || activeConversationIdRef.current !== convId) return;
      if (rows.length === 0) return;

      setCachedImages((prev) => {
        const next: Record<string, LoadedChatImage> = { ...prev };
        for (const row of rows) {
          if (next[row.id]) continue;
          next[row.id] = {
            url: URL.createObjectURL(row.imageBlob),
            caption: row.caption,
            providerLabel: formatChatImageProviderLabel(row.provider),
            prompt: row.prompt,
          };
        }
        cachedImagesRef.current = next;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeConversationId]);

  // Cleanup recorder, inflight requests & local image object URLs on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }
      recorderRef.current?.cancel();
      generationAbortRef.current?.abort();
      for (const item of Object.values(cachedImagesRef.current)) {
        URL.revokeObjectURL(item.url);
      }
      cachedImagesRef.current = {};
    };
  }, []);

  const triggerChatImageGeneration = async (params: {
    messageId: string;
    conversationId: string;
    userPrompt: string;
    answerText: string;
    customPrompt?: string;
  }) => {
    if (!user || !activeCourse || !params.conversationId || !isOnline) return;

    setGeneratingImageIds((prev) => {
      const next = new Set(prev);
      next.add(params.messageId);
      return next;
    });
    setImageErrors((prev) => {
      if (!(params.messageId in prev)) return prev;
      const next = { ...prev };
      delete next[params.messageId];
      return next;
    });

    const prompt =
      params.customPrompt ||
      buildChatImagePrompt({
        courseCode: activeCourse.code,
        courseName: activeCourse.name,
        userRequest: params.userPrompt,
        answerExcerpt: params.answerText,
      });
    const caption = params.userPrompt.trim().slice(0, 110);

    try {
      const result = await generateAndCacheStudyImage({
        id: params.messageId,
        userId: user.uid,
        courseId: activeCourse.id,
        scopeId: params.conversationId,
        feature: 'tutor',
        prompt,
        caption,
        aspectRatio: '16:9',
      });

      if (activeConversationIdRef.current !== params.conversationId) return;

      const objectUrl = URL.createObjectURL(result.blob);
      setCachedImages((prev) => {
        if (prev[params.messageId]) {
          URL.revokeObjectURL(prev[params.messageId].url);
        }
        const next: Record<string, LoadedChatImage> = {
          ...prev,
          [params.messageId]: {
            url: objectUrl,
            caption: result.caption,
            providerLabel: formatChatImageProviderLabel(result.provider),
            prompt: result.prompt,
          },
        };
        cachedImagesRef.current = next;
        return next;
      });
    } catch (err) {
      if (activeConversationIdRef.current !== params.conversationId) return;
      setImageErrors((prev) => ({
        ...prev,
        [params.messageId]: formatReadableError(err),
      }));
    } finally {
      setGeneratingImageIds((prev) => {
        if (!prev.has(params.messageId)) return prev;
        const next = new Set(prev);
        next.delete(params.messageId);
        return next;
      });
    }
  };

  // Reset state when active course changes and restore stored conversation id immediately
  useEffect(() => {
    geminiAudioPlayer.stop();
    explicitNewThreadRef.current = false;
    const restoredId = readStoredConversationId(lastConvStorageKey);
    setActiveConversationId(restoredId);
    setMessages([]);
    setStreamingReply(null);
    setSelectedTopicId('');
    setSettingsMenuOpen(false);
    setError(null);
  }, [activeCourse?.id, lastConvStorageKey]);

  // Keep default source mode synced only when no existing conversation is active
  useEffect(() => {
    if (!activeConversationId) {
      setSourceMode(prefs.tutorSourceMode);
    }
  }, [prefs.tutorSourceMode, activeConversationId]);

  const userId = user?.uid ?? '';
  const courseId = activeCourse?.id ?? '';

  // Subscribe to course-scoped conversations and resume the last conversation automatically
  useEffect(() => {
    if (!userId || !courseId) {
      setConversations([]);
      setConversationsLoading(false);
      return;
    }

    let cancelled = false;
    setConversationsLoading(true);
    const unsub = subscribeCourseConversations(
      userId,
      courseId,
      (list) => {
        if (cancelled) return;
        setConversations(list);
        setConversationsLoading(false);
        setActiveConversationId((prev) => {
          if (prev && list.some((c) => c.id === prev)) {
            return prev;
          }
          if (explicitNewThreadRef.current) {
            return null;
          }
          if (list.length === 0) {
            writeStoredConversationId(lastConvStorageKey, null);
            return null;
          }
          const storedId = readStoredConversationId(lastConvStorageKey);
          const resumedId =
            storedId && list.some((c) => c.id === storedId) ? storedId : list[0].id;
          writeStoredConversationId(lastConvStorageKey, resumedId);
          return resumedId;
        });
      },
      (err) => {
        if (cancelled) return;
        setError(formatReadableError(err));
        setConversationsLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [userId, courseId, lastConvStorageKey]);

  // Sync sourceMode when selecting an existing conversation
  const activeConversationSourceMode = activeConversation?.sourceMode;
  useEffect(() => {
    if (activeConversationSourceMode) {
      setSourceMode(activeConversationSourceMode);
    }
  }, [activeConversation?.id, activeConversationSourceMode]);

  // Subscribe to messages for the active conversation
  useEffect(() => {
    if (!userId || !courseId || !activeConversationId) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }

    let cancelled = false;
    setMessagesLoading(true);
    const unsub = subscribeConversationMessages(
      userId,
      courseId,
      activeConversationId,
      (list) => {
        if (cancelled) return;
        setMessages(list);
        setMessagesLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(formatReadableError(err));
        setMessagesLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [userId, courseId, activeConversationId]);

  // Scroll to newest message smoothly
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sendPhase]);

  // Synchronize streamed reply text with live Gemini 3.8 audio playback progress
  const streamingMessageId = streamingReply?.messageId ?? null;
  const streamingFullText = streamingReply?.fullText ?? '';
  const streamingDuration = streamingReply?.durationSeconds ?? null;

  useEffect(() => {
    if (!streamingMessageId || !streamingFullText) return;

    let rafId = 0;
    let lastFrameMs = performance.now();
    let currentChars = 0;
    let sawAudioPlaying = false;
    let lastScrollMs = 0;

    const snapToWordBoundary = (text: string, idx: number): number => {
      if (idx >= text.length) return text.length;
      if (idx <= 0) return 0;
      // Avoid tearing words in half when streaming prose
      const nextSpace = text.indexOf(' ', idx);
      if (nextSpace !== -1 && nextSpace - idx <= 12) {
        return nextSpace + 1;
      }
      return idx;
    };

    const tick = (now: number) => {
      const dtSec = Math.min(0.1, Math.max(0.008, (now - lastFrameMs) / 1000));
      lastFrameMs = now;

      const progress = geminiAudioPlayer.getAudioProgress(streamingMessageId);
      let nextChars = currentChars;

      if (progress?.playing) {
        sawAudioPlaying = true;
        const effectiveDuration =
          progress.duration > 0 ? progress.duration : streamingDuration || 0;
        if (effectiveDuration > 0) {
          const ratio = Math.min(1, (progress.currentTime / effectiveDuration) * 1.03);
          const audioTarget = Math.ceil(streamingFullText.length * ratio);
          nextChars = Math.max(currentChars, audioTarget);
        } else {
          nextChars = Math.min(streamingFullText.length, currentChars + dtSec * 65);
        }
      } else if (sawAudioPlaying && !progress) {
        // Audio playback finished — reveal any remaining text immediately
        nextChars = streamingFullText.length;
      } else {
        // Fallback smooth stream when audio is paused, blocked, or starting
        nextChars = Math.min(streamingFullText.length, currentChars + dtSec * 58);
      }

      const snapped = snapToWordBoundary(streamingFullText, Math.floor(nextChars));
      if (snapped !== Math.floor(currentChars) || snapped >= streamingFullText.length) {
        currentChars = Math.max(currentChars, snapped);
        setStreamingReply((prev) =>
          prev && prev.messageId === streamingMessageId
            ? { ...prev, revealedLength: Math.min(streamingFullText.length, Math.floor(currentChars)) }
            : prev
        );
      } else {
        currentChars = nextChars;
      }

      if (now - lastScrollMs > 180) {
        lastScrollMs = now;
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }

      if (currentChars >= streamingFullText.length) {
        setStreamingReply((prev) =>
          prev && prev.messageId === streamingMessageId ? null : prev
        );
        return;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [streamingMessageId, streamingFullText, streamingDuration]);

  const scopedSourcesCount = useMemo(() => {
    if (!selectedTopicId) return sources.length;
    return sources.filter((s) => s.topicId === selectedTopicId).length;
  }, [sources, selectedTopicId]);

  const starterPrompts = useMemo(() => {
    if (!activeCourse) return [];
    const prompts: string[] = [];
    if (sources.length > 0) {
      const firstSource = sources[0];
      prompts.push(`Summarize the core concepts in "${firstSource.title}".`);
    }
    if (topics.length > 0) {
      prompts.push(`Explain the foundational principles of ${topics[0].name} clearly.`);
    }
    prompts.push(`What are the most important concepts to master in ${activeCourse.name}?`);
    prompts.push(`Compare key definitions and common exam pitfalls in ${activeCourse.code}.`);
    return prompts.slice(0, 3);
  }, [activeCourse, sources, topics]);

  const handleQuickPrefUpdate = async (patch: Partial<typeof prefs>) => {
    setSavingPref(true);
    try {
      await savePreferences({ ...prefs, ...patch });
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setSavingPref(false);
    }
  };

  const handleSourceModeChange = async (nextMode: TutorSourceMode) => {
    setSourceMode(nextMode);
    if (user && activeCourse && activeConversationId) {
      try {
        await updateConversationSourceMode(user.uid, activeCourse.id, activeConversationId, nextMode);
      } catch (err) {
        setError(formatReadableError(err));
      }
    }
  };

  const handleNewConversation = () => {
    geminiAudioPlayer.stop();
    generationAbortRef.current?.abort();
    explicitNewThreadRef.current = true;
    setSendPhase('idle');
    setStreamingReply(null);
    setActiveConversationId(null);
    setMessages([]);
    setSourceMode(prefs.tutorSourceMode);
    setError(null);
    setMobileDrawerOpen(false);
  };

  const handleSelectConversation = (id: string) => {
    geminiAudioPlayer.stop();
    explicitNewThreadRef.current = false;
    setStreamingReply(null);
    setActiveConversationId(id);
    writeStoredConversationId(lastConvStorageKey, id);
    setMobileDrawerOpen(false);
    setError(null);
  };

  const handleRenameConversation = async (id: string, title: string) => {
    if (!user || !activeCourse) return;
    try {
      await renameConversation(user.uid, activeCourse.id, id, title);
    } catch (err) {
      setError(formatReadableError(err));
    }
  };

  const handleDeleteConversation = async (id: string) => {
    if (!user || !activeCourse) return;
    try {
      await deleteConversation(user.uid, activeCourse.id, id);
      void deleteCachedTutorAudioByConversation(id);
      void deleteCachedGeneratedImagesByScope(id);
      if (activeConversationId === id) {
        explicitNewThreadRef.current = false;
        writeStoredConversationId(lastConvStorageKey, null);
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      setError(formatReadableError(err));
    }
  };

  const handleSendQuestion = async (overrideText?: string) => {
    if (!user || !activeCourse || messagesLoading) return;
    if (!isOnline) {
      setError(
        "You're offline. Turn on your internet connection to ask the AI Tutor a new question. Your previous conversations remain readable below."
      );
      return;
    }
    const questionText = (overrideText ?? inputRef.current).trim();
    if (!questionText || sending) return;

    // Unlock browser audio playback synchronously inside the user gesture when voice is on
    if (prefs.voiceEnabled) {
      geminiAudioPlayer.unlockForAutoplay();
    }

    setError(null);
    setInput('');
    setStreamingReply(null);
    setSendPhase('thinking');

    const abortController = new AbortController();
    generationAbortRef.current = abortController;

    let conversationId = activeConversationId;
    let baseCount = messages.length;
    const priorHistory = [...messages];

    try {
      if (!conversationId) {
        const created = await createConversation(user.uid, activeCourse.id, {
          title: deriveConversationTitle(questionText),
          sourceMode,
        });
        conversationId = created.id;
        baseCount = 0;
        explicitNewThreadRef.current = false;
        writeStoredConversationId(lastConvStorageKey, created.id);
        setActiveConversationId(created.id);
      } else {
        explicitNewThreadRef.current = false;
        writeStoredConversationId(lastConvStorageKey, conversationId);
      }

      const isFirstMessage = baseCount === 0;
      await appendConversationMessage(user.uid, activeCourse.id, conversationId, {
        role: 'user',
        content: questionText,
        sourceReferences: [],
        nextMessageCount: baseCount + 1,
        autoTitle: isFirstMessage ? deriveConversationTitle(questionText) : undefined,
      });

      const turn = await runCourseTutorTurn({
        course: activeCourse,
        topics,
        sources,
        history: priorHistory,
        question: questionText,
        sourceMode,
        selectedTopicId: selectedTopicId || undefined,
        model: prefs.defaultModel,
        signal: abortController.signal,
      });

      const assistantMsgId = generateDocumentId('msg');
      const wantsImage = detectExplicitImageRequest(questionText);

      const persistMeta = {
        userId: user.uid,
        courseId: activeCourse.id,
        conversationId,
      };

      if (prefs.voiceEnabled) {
        // Show "Generating audio..." BEFORE revealing the reply text in chat
        setSendPhase('generating_audio');
        let preloadedDuration: number | null = null;
        let audioReady = false;

        try {
          const preloaded = await geminiAudioPlayer.preloadMessage({
            id: assistantMsgId,
            text: turn.answer,
            voiceName: prefs.ttsVoice,
            style: 'Clear, calm, articulate academic tutor',
            signal: abortController.signal,
            persist: persistMeta,
          });
          preloadedDuration = preloaded.durationSeconds;
          audioReady = true;
          setCachedAudioIds((prev) => {
            const next = new Set(prev);
            next.add(assistantMsgId);
            return next;
          });
        } catch (audioErr) {
          if (abortController.signal.aborted) {
            throw audioErr;
          }
          // Fall back gracefully to text streaming if TTS fails
          setError(
            audioErr instanceof Error
              ? `Audio generation failed (${audioErr.message}). Showing reply text.`
              : 'Audio generation failed. Showing reply text.'
          );
        }

        if (abortController.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        // Start streaming the reply text in chat simultaneously with automatic audio playback
        setStreamingReply({
          messageId: assistantMsgId,
          fullText: turn.answer,
          revealedLength: 0,
          durationSeconds: preloadedDuration,
        });

        await appendConversationMessage(user.uid, activeCourse.id, conversationId, {
          id: assistantMsgId,
          role: 'assistant',
          content: turn.answer,
          sourceReferences: turn.sourceReferences,
          nextMessageCount: baseCount + 2,
        });

        setSendPhase('idle');

        if (audioReady) {
          void geminiAudioPlayer.playMessage({
            id: assistantMsgId,
            text: turn.answer,
            voiceName: prefs.ttsVoice,
            playbackRate: prefs.voiceRate,
            style: 'Clear, calm, articulate academic tutor',
            persist: persistMeta,
          });
        }
      } else {
        await appendConversationMessage(user.uid, activeCourse.id, conversationId, {
          id: assistantMsgId,
          role: 'assistant',
          content: turn.answer,
          sourceReferences: turn.sourceReferences,
          nextMessageCount: baseCount + 2,
        });
      }

      // Generate & cache an image locally ONLY if the student explicitly asked for an image in chat
      if (wantsImage) {
        activeConversationIdRef.current = conversationId;
        void triggerChatImageGeneration({
          messageId: assistantMsgId,
          conversationId,
          userPrompt: questionText,
          answerText: turn.answer,
        });
      }

      // Record genuine completed AI Tutor exchange for daily streak & study dashboard
      if (questionText.trim().length >= 4 && turn.answer.trim().length >= 20) {
        void recordLearningActivity({
          activityType: 'tutor',
          title: activeConversation?.title || deriveConversationTitle(questionText),
          courseId: activeCourse.id,
          courseCode: activeCourse.code,
          isSharedCourse: Boolean(activeCourse.isShared),
          durationSeconds: 45,
          summary: questionText.trim().slice(0, 140),
        });
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        setError('Response generation stopped.');
      } else {
        setError(formatReadableError(err));
      }
    } finally {
      if (generationAbortRef.current === abortController) {
        generationAbortRef.current = null;
      }
      setSendPhase('idle');
    }
  };

  const handleStartVoiceNote = async () => {
    if (!isOnline) {
      setError(
        "You're offline. Turn on your internet connection to record and transcribe voice questions. You can still read your previous chat history offline."
      );
      return;
    }
    setError(null);
    geminiAudioPlayer.stop();
    try {
      const recorder = new VoiceNoteRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 119) {
            void handleStopAndSendVoiceNote();
            return 120;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start voice recording.');
    }
  };

  const handleCancelVoiceNote = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const handleStopAndSendVoiceNote = async () => {
    if (prefs.voiceEnabled) {
      geminiAudioPlayer.unlockForAutoplay();
    }
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);

    if (!recorder) return;

    setTranscribing(true);
    setError(null);
    let transcribedText = '';
    try {
      const recorded = await recorder.stop();
      const hint = activeCourse ? `${activeCourse.code} ${activeCourse.name}` : undefined;
      const result = await transcribeAudioWithClient({
        audioBase64: recorded.audioBase64,
        mimeType: recorded.mimeType,
        courseContextHint: hint,
      });

      if (!result.text) {
        setError('No clear speech was detected in your voice note. Try speaking closer to the microphone.');
      } else {
        const draftPrefix = inputRef.current.trim();
        transcribedText = draftPrefix ? `${draftPrefix} ${result.text}` : result.text;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice note transcription failed.');
    } finally {
      setTranscribing(false);
    }

    if (transcribedText) {
      await handleSendQuestion(transcribedText);
    }
  };

  const handlePlayReply = async (msg: TutorMessage) => {
    if (!isOnline && !cachedAudioIds.has(msg.id)) {
      setError(
        "You're offline. Connect to the internet to generate voice audio for this reply (previously played clips remain playable offline)."
      );
      return;
    }
    const persistMeta =
      user && activeCourse && activeConversationId
        ? {
            userId: user.uid,
            courseId: activeCourse.id,
            conversationId: activeConversationId,
          }
        : undefined;

    const played = await geminiAudioPlayer.playMessage({
      id: msg.id,
      text: msg.content,
      voiceName: prefs.ttsVoice,
      playbackRate: prefs.voiceRate,
      style: 'Clear, calm, articulate academic tutor',
      persist: persistMeta,
    });

    if (played && persistMeta) {
      setCachedAudioIds((prev) => {
        if (prev.has(msg.id)) return prev;
        const next = new Set(prev);
        next.add(msg.id);
        return next;
      });
    }
  };

  const handleCopyMessage = async (msg: TutorMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId((prev) => (prev === msg.id ? null : prev)), 2000);
    } catch {
      setError('Unable to copy to clipboard in this browser.');
    }
  };

  const getPrecedingQuestion = (target: TutorMessage | null): string => {
    if (!target) return '';
    const idx = messages.findIndex((m) => m.id === target.id);
    if (idx <= 0) return '';
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return messages[i].content;
    }
    return '';
  };

  const handleSaveResponse = async (payload: {
    title: string;
    topicId: string;
    type: 'tutor_response' | 'explanation' | 'summary' | 'study_guide';
  }) => {
    if (!user || !activeCourse || !activeConversationId || !saveTargetMessage) return;

    await saveTutorResponseAsMaterial(user.uid, activeCourse.id, {
      topicId: payload.topicId,
      title: payload.title,
      type: payload.type,
      answerMarkdown: saveTargetMessage.content,
      questionPrompt: getPrecedingQuestion(saveTargetMessage),
      sourceMode,
      sourceReferences: saveTargetMessage.sourceReferences || [],
      conversationId: activeConversationId,
      messageId: saveTargetMessage.id,
    });

    await markMessageSaved(
      user.uid,
      activeCourse.id,
      activeConversationId,
      saveTargetMessage.id,
      true
    );

    setSavedNotice(`Saved "${payload.title}" to your course study materials.`);
    setTimeout(() => setSavedNotice(null), 4000);
  };

  if (coursesLoading) {
    return <LoadingSkeleton lines={4} />;
  }

  if (!activeCourse) {
    return (
      <div>
        <div className="border-b border-zinc-200 dark:border-zinc-800 pb-6">
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-200">
            Jovibe AI Tutor
          </h1>
        </div>
        <EmptyState
          title="Select or create a course first"
          description="The AI Tutor operates within the context of your active course so retrieval and explanations stay aligned with your syllabus."
          actionLabel="Go to Courses"
          onAction={() => navigate('/courses')}
        />
      </div>
    );
  }

  if (activeCourseAccessRevoked) {
    return <RevokedCourseNotice course={activeCourse} pageTitle="Jovibe AI Tutor" />;
  }

  const isBusy = sending || transcribing;

  return (
    <div className="flex h-full flex-col flex-1 min-h-0 overflow-hidden">
      {/* Fixed Top Tutor Header Row (no breadcrumbs, never scrolls) */}
      <div className="shrink-0 flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label="Open conversations"
            className="lg:hidden inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-200 dark:text-zinc-950 dark:hover:bg-zinc-300 transition-colors cursor-pointer"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-lg sm:text-xl font-bold leading-tight tracking-tight text-zinc-950 dark:text-zinc-200 truncate">
              Jovibe AI Tutor
            </h1>
            {activeConversation?.title && (
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {activeConversation.title}
              </p>
            )}
          </div>
        </div>

        {/* Right Side: Settings Icon + Tooltip Popup Menu */}
        <div ref={settingsMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setSettingsMenuOpen((prev) => !prev)}
            aria-haspopup="dialog"
            aria-expanded={settingsMenuOpen}
            aria-label="Tutor settings"
            title="Tutor settings"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors cursor-pointer ${
              settingsMenuOpen
                ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950'
                : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <SettingsIcon className="h-4 w-4" />
          </button>

          <AnimatePresence>
            {settingsMenuOpen && (
              <motion.div
                role="dialog"
                aria-label="Tutor settings"
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                className="absolute right-0 top-full z-40 mt-2.5 w-72 sm:w-80 max-w-[calc(100vw-1.5rem)] max-h-[75dvh] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-lg dark:shadow-black/40"
              >
                {/* Tooltip Caret Pointer */}
                <span
                  aria-hidden="true"
                  className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-l border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                />

                <div className="relative space-y-4">
                  <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Tutor Settings
                    </span>
                    {savingPref && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Saving
                      </span>
                    )}
                  </div>

                  {/* AI Source Mode */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="tutor-popup-source-mode"
                      className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Source Mode
                    </label>
                    <select
                      id="tutor-popup-source-mode"
                      value={sourceMode}
                      onChange={(e) => void handleSourceModeChange(e.target.value as TutorSourceMode)}
                      className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-2 text-xs font-medium text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                    >
                      {SOURCE_MODE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Choose Topic */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="tutor-popup-topic"
                      className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Topic Focus
                    </label>
                    <select
                      id="tutor-popup-topic"
                      value={selectedTopicId}
                      onChange={(e) => setSelectedTopicId(e.target.value)}
                      disabled={sourceMode === 'general_ai'}
                      className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none disabled:bg-zinc-50 dark:disabled:bg-zinc-900 disabled:text-zinc-400 dark:disabled:text-zinc-600"
                    >
                      <option value="">All course topics</option>
                      {topics.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Voice Selection & Toggle */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="tutor-popup-voice"
                        className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
                      >
                        Voice (Gemini 3.8)
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={prefs.voiceEnabled}
                          onChange={(e) =>
                            void handleQuickPrefUpdate({ voiceEnabled: e.target.checked })
                          }
                          className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700 accent-zinc-950 dark:accent-zinc-200 cursor-pointer"
                        />
                        Enabled
                      </label>
                    </div>
                    <select
                      id="tutor-popup-voice"
                      value={prefs.ttsVoice}
                      onChange={(e) =>
                        void handleQuickPrefUpdate({
                          ttsVoice: e.target.value as GeminiTtsVoice,
                        })
                      }
                      className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                    >
                      {AVAILABLE_TTS_VOICES.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* AI Model Configuration */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="tutor-popup-model"
                      className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      AI Model
                    </label>
                    <select
                      id="tutor-popup-model"
                      value={prefs.defaultModel}
                      onChange={(e) =>
                        void handleQuickPrefUpdate({ defaultModel: e.target.value })
                      }
                      className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                    >
                      {AVAILABLE_AI_MODELS.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Footer Shortcuts */}
                  <div className="flex items-center justify-between gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsMenuOpen(false);
                        navigate('/library');
                      }}
                      className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      <span className="tabular-nums">
                        {sourcesLoading
                          ? 'Library'
                          : `${scopedSourcesCount} ${scopedSourcesCount === 1 ? 'source' : 'sources'}`}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSettingsMenuOpen(false);
                        navigate('/settings');
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-950 dark:text-zinc-200 hover:underline underline-offset-2 cursor-pointer"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      All AI Settings
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Main Split Workspace (non-scrolling outer wrapper) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] gap-0 lg:gap-8 pt-3 overflow-hidden">
        {/* Desktop Conversation Sidebar */}
        <aside className="hidden lg:block h-full border-r border-zinc-200 dark:border-zinc-800 pr-5 min-h-0 overflow-hidden">
          <ConversationSidebar
            conversations={conversations}
            activeConversationId={activeConversationId}
            loading={conversationsLoading}
            onSelect={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onRename={handleRenameConversation}
            onDelete={handleDeleteConversation}
          />
        </aside>

        {/* Mobile Slide-Over Conversation Drawer */}
        <AnimatePresence>
          {mobileDrawerOpen && (
            <motion.div
              key="mobile-drawer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="fixed inset-0 z-50 flex lg:hidden"
            >
              <div
                className="fixed inset-0 bg-zinc-950/35 dark:bg-black/65 backdrop-blur-[2px]"
                onClick={() => setMobileDrawerOpen(false)}
              />
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 400, damping: 36 }}
                className="relative z-10 flex w-72 max-w-[85vw] flex-col bg-white dark:bg-zinc-950 p-4 shadow-xl border-r border-zinc-200 dark:border-zinc-800"
              >
                <div className="flex items-center justify-between pb-3 mb-2 border-b border-zinc-200 dark:border-zinc-800">
                  <span className="font-display text-sm font-semibold text-zinc-950 dark:text-zinc-200">
                    {activeCourse.code} Threads
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobileDrawerOpen(false)}
                    aria-label="Close conversations"
                    className="p-1 text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <ConversationSidebar
                    conversations={conversations}
                    activeConversationId={activeConversationId}
                    loading={conversationsLoading}
                    onSelect={handleSelectConversation}
                    onNewConversation={handleNewConversation}
                    onRename={handleRenameConversation}
                    onDelete={handleDeleteConversation}
                  />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat Stream & Fixed Composer Column */}
        <div className="flex h-full min-w-0 flex-col min-h-0 overflow-hidden">
          {error && (
            <div className="mb-3 shrink-0">
              <ErrorBanner message={error} onDismiss={() => setError(null)} />
            </div>
          )}

          {savedNotice && (
            <div className="mb-3 shrink-0 flex items-center justify-between rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs text-zinc-900 dark:text-zinc-200">
              <span className="inline-flex items-center gap-2">
                <Check className="h-3.5 w-3.5" />
                {savedNotice}
              </span>
              <button
                type="button"
                onClick={() => setSavedNotice(null)}
                className="text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* ONLY THIS SECTION SCROLLS: Messages Stream (scrollbar hidden) */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-hide space-y-6 pb-4">
            {messagesLoading ? (
              <LoadingSkeleton lines={4} />
            ) : messages.length === 0 ? (
              <div className="py-6 max-w-2xl space-y-6">
                <div>
                  <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-200">
                    Study {activeCourse.code} with grounded explanations
                  </h2>
                </div>

                {sourceMode === 'materials_only' && scopedSourcesCount === 0 && (
                  <div className="border-y border-zinc-200 dark:border-zinc-800 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                      <strong className="font-medium text-zinc-900 dark:text-zinc-200">My Materials Only</strong> is
                      active, but no sources match your current scope yet.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate('/library')}
                    >
                      Upload materials
                    </Button>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Suggested starting prompts</div>
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border-y border-zinc-200 dark:border-zinc-800">
                    {starterPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => void handleSendQuestion(prompt)}
                        className="w-full py-3 text-left text-sm text-zinc-800 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors flex items-center justify-between gap-3 px-2 cursor-pointer"
                      >
                        <span>{prompt}</span>
                        <Send className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isUser = msg.role === 'user';
                const isThisPlaying =
                  playback.activeId === msg.id && playback.status === 'playing';
                const isThisPaused =
                  playback.activeId === msg.id && playback.status === 'paused';
                const isThisLoadingAudio =
                  playback.activeId === msg.id && playback.status === 'loading';
                const audioErrorForMsg =
                  playback.activeId === msg.id ? playback.error : null;

                const hasCachedAudio = cachedAudioIds.has(msg.id);

                return (
                  <article
                    key={msg.id}
                    className={`border-b border-zinc-200/80 dark:border-zinc-800/80 pb-5 last:border-b-0 ${
                      isUser ? 'bg-zinc-50/70 dark:bg-zinc-900/90 px-3 py-3 rounded-md border-b-0' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-semibold text-zinc-950 dark:text-zinc-200">
                        {isUser ? 'You' : 'Jovibe AI Tutor'}
                      </span>
                      {!isUser && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                          {(prefs.voiceEnabled || hasCachedAudio) && (
                            <button
                              type="button"
                              onClick={() => void handlePlayReply(msg)}
                              className="inline-flex items-center gap-1 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                              title={
                                hasCachedAudio
                                  ? 'Play saved audio from this device'
                                  : `Generate and play audio (${prefs.ttsVoice})`
                              }
                            >
                              {isThisLoadingAudio ? (
                                <>
                                  <Volume2 className="h-3.5 w-3.5 animate-pulse text-zinc-900 dark:text-zinc-200" />
                                  <span className="text-zinc-900 dark:text-zinc-200">Generating audio...</span>
                                </>
                              ) : isThisPlaying ? (
                                <>
                                  <Pause className="h-3.5 w-3.5 text-zinc-950 dark:text-zinc-200" />
                                  <span className="text-zinc-950 dark:text-zinc-200 font-medium">Pause</span>
                                </>
                              ) : isThisPaused ? (
                                <>
                                  <Play className="h-3.5 w-3.5 text-zinc-950 dark:text-zinc-200" />
                                  <span className="text-zinc-950 dark:text-zinc-200 font-medium">Resume</span>
                                </>
                              ) : (
                                <>
                                  <Volume2 className="h-3.5 w-3.5" />
                                  <span>Listen</span>
                                </>
                              )}
                            </button>
                          )}

                          {(isThisPlaying || isThisPaused) && (
                            <button
                              type="button"
                              onClick={() => geminiAudioPlayer.stop()}
                              className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
                            >
                              <Square className="h-3 w-3" />
                              <span>Stop</span>
                            </button>
                          )}

                          {(prefs.voiceEnabled || hasCachedAudio) && <span aria-hidden="true">·</span>}

                          <button
                            type="button"
                            onClick={() => setSaveTargetMessage(msg)}
                            className="inline-flex items-center gap-1 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                          >
                            {msg.saved ? (
                              <>
                                <BookmarkCheck className="h-3.5 w-3.5 text-zinc-950 dark:text-zinc-200" />
                                <span className="text-zinc-950 dark:text-zinc-200 font-medium">Saved</span>
                              </>
                            ) : (
                              <>
                                <Bookmark className="h-3.5 w-3.5" />
                                <span>Save</span>
                              </>
                            )}
                          </button>

                          <span aria-hidden="true">·</span>

                          <button
                            type="button"
                            onClick={() => void handleCopyMessage(msg)}
                            className="inline-flex items-center gap-1 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-zinc-950 dark:text-zinc-200" />
                                <span className="text-zinc-950 dark:text-zinc-200">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {(() => {
                      const safeContent = typeof msg.content === 'string' ? msg.content : '';
                      if (isUser) {
                        return (
                          <p className="text-sm leading-relaxed text-zinc-900 dark:text-zinc-200 whitespace-pre-wrap">
                            {safeContent}
                          </p>
                        );
                      }
                      if (streamingReply && streamingReply.messageId === msg.id) {
                        return (
                          <div className="space-y-1">
                            <MarkdownMessage
                              content={safeContent.slice(0, streamingReply.revealedLength)}
                            />
                            <span
                              aria-hidden="true"
                              className="inline-block h-3.5 w-1.5 rounded-sm bg-zinc-900 dark:bg-zinc-200 animate-pulse align-middle"
                            />
                          </div>
                        );
                      }
                      return <MarkdownMessage content={safeContent} />;
                    })()}

                    {audioErrorForMsg && (
                      <p className="mt-2 text-xs text-red-700 dark:text-red-400">{audioErrorForMsg}</p>
                    )}

                    {!isUser &&
                      (Boolean(cachedImages[msg.id]) ||
                        generatingImageIds.has(msg.id) ||
                        Boolean(imageErrors[msg.id])) && (
                        <GeneratedStudyImageCard
                          imageUrl={cachedImages[msg.id]?.url}
                          caption={cachedImages[msg.id]?.caption}
                          providerLabel={cachedImages[msg.id]?.providerLabel}
                          loading={generatingImageIds.has(msg.id)}
                          error={imageErrors[msg.id] ?? null}
                          canGenerate={false}
                          isOnline={isOnline}
                          onRegenerate={
                            activeConversationId
                              ? () =>
                                  void triggerChatImageGeneration({
                                    messageId: msg.id,
                                    conversationId: activeConversationId,
                                    userPrompt:
                                      getPrecedingQuestion(msg) ||
                                      cachedImages[msg.id]?.caption ||
                                      'Concept visual',
                                    answerText: typeof msg.content === 'string' ? msg.content : '',
                                    customPrompt: cachedImages[msg.id]?.prompt,
                                  })
                              : undefined
                          }
                        />
                      )}

                    {!isUser &&
                      (!streamingReply || streamingReply.messageId !== msg.id) &&
                      Array.isArray(msg.sourceReferences) &&
                      msg.sourceReferences.length > 0 && (
                        <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-2.5">
                          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">
                            Referenced course materials
                          </div>
                          <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                            {msg.sourceReferences.map((ref, idx) => (
                              <li
                                key={`${ref.sourceId}_${idx}`}
                                className="flex flex-wrap items-center gap-1.5"
                              >
                                <button
                                  type="button"
                                  onClick={() => navigate('/library')}
                                  className="font-medium text-zinc-900 dark:text-zinc-200 hover:underline underline-offset-2 text-left cursor-pointer"
                                >
                                  {ref.sourceTitle}
                                </button>
                                {ref.sectionHeading && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{ref.sectionHeading}</span>
                                  </>
                                )}
                                {typeof ref.pageOrSlide === 'number' && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono text-[11px] tabular-nums">
                                      p.{ref.pageOrSlide}
                                    </span>
                                  </>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </article>
                );
              })
            )}

            {sending && (
              <div className="py-3 space-y-2.5">
                <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-semibold text-zinc-950 dark:text-zinc-200">Jovibe AI Tutor</span>
                  <button
                    type="button"
                    onClick={() => generationAbortRef.current?.abort()}
                    className="underline underline-offset-2 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    Stop
                  </button>
                </div>
                {sendPhase === 'generating_audio' ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                    <Volume2 className="h-3.5 w-3.5 animate-pulse text-zinc-950 dark:text-zinc-200" />
                    <span>Generating audio...</span>
                    <Loader2 className="h-3 w-3 animate-spin text-zinc-500 dark:text-zinc-400" />
                  </div>
                ) : (
                  <div className="space-y-2 max-w-xl">
                    <div className="h-3 w-3/4 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                    <div className="h-3 w-1/2 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                  </div>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Fixed Quick Follow-ups when thread has replies */}
          {messages.length > 0 && !sending && isOnline && (
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-2.5 pb-2 shrink-0 bg-white dark:bg-zinc-950">
              {QUICK_FOLLOWUPS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void handleSendQuestion(prompt)}
                  className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {/* Fixed Composer & Voice Note Input Row (never scrolls, clears mobile bottom pill nav) */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 pt-3 shrink-0">
            {!isOnline && (
              <OfflineFeatureNotice
                compact
                className="mb-2.5"
                description="You're offline. Browse past conversations freely — turn on internet to send new AI questions."
              />
            )}

            {isRecording && (
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-900 dark:border-zinc-700 bg-zinc-950 dark:bg-zinc-900 px-3.5 py-2 text-xs text-white dark:text-zinc-200">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-red-500 animate-pulse" />
                  <span>Recording voice note</span>
                  <span className="font-mono tabular-nums text-zinc-300 dark:text-zinc-400">
                    {formatTimer(recordingSeconds)}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCancelVoiceNote}
                    className="text-zinc-300 hover:text-white dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStopAndSendVoiceNote()}
                    className="rounded bg-white dark:bg-zinc-200 px-2.5 py-1 font-medium text-zinc-950 hover:bg-zinc-200 dark:hover:bg-zinc-300 cursor-pointer"
                  >
                    Stop &amp; send
                  </button>
                </div>
              </div>
            )}

            {transcribing && (
              <div className="mb-2.5 flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2 text-xs text-zinc-700 dark:text-zinc-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-900 dark:text-zinc-200 shrink-0" />
                <span>Transcribing and sending voice note...</span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSendQuestion();
              }}
              className="flex items-center gap-1.5 sm:gap-2 min-w-0"
            >
              <div className="relative min-w-0 flex-1">
                <label htmlFor="tutor-composer" className="sr-only">
                  Ask your questions
                </label>
                <textarea
                  id="tutor-composer"
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onFocus={() => setComposerFocused(true)}
                  onBlur={() => setComposerFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendQuestion();
                    }
                  }}
                  disabled={isBusy || isRecording || !isOnline}
                  placeholder={
                    isOnline
                      ? 'Ask your questions...'
                      : 'Offline — turn on internet to ask new questions'
                  }
                  className="block min-h-11 max-h-28 w-full resize-none rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 sm:px-3.5 py-2.5 text-sm leading-5 text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none disabled:bg-zinc-50 dark:disabled:bg-zinc-900/60 scrollbar-hide"
                />
              </div>

              {VoiceNoteRecorder.isSupported() && (
                <Button
                  type="button"
                  variant={isRecording ? 'danger' : 'secondary'}
                  onClick={() => {
                    if (isRecording) {
                      void handleStopAndSendVoiceNote();
                    } else {
                      void handleStartVoiceNote();
                    }
                  }}
                  disabled={isBusy || !isOnline}
                  aria-label={isRecording ? 'Stop and send voice note' : 'Record voice note'}
                  title={
                    !isOnline
                      ? 'Turn on internet to use voice notes'
                      : isRecording
                      ? 'Stop and send voice note'
                      : 'Record voice note (auto-sends on stop)'
                  }
                  className="min-h-11 px-3 shrink-0"
                >
                  {isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}

              <Button
                type="submit"
                disabled={isBusy || messagesLoading || isRecording || !isOnline || !input.trim()}
                aria-label={isBusy ? 'Sending message' : 'Send message'}
                className="min-h-11 px-3 sm:px-4 shrink-0"
              >
                {isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{isBusy ? 'Sending' : 'Send'}</span>
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Save Response Modal */}
      <SaveResponseModal
        open={Boolean(saveTargetMessage)}
        message={saveTargetMessage}
        questionPrompt={getPrecedingQuestion(saveTargetMessage)}
        sourceMode={sourceMode}
        topics={topics}
        defaultTopicId={selectedTopicId}
        onClose={() => setSaveTargetMessage(null)}
        onSave={handleSaveResponse}
      />
    </div>
  );
};
