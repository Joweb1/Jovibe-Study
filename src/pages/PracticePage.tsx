import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  ClipboardCheck,
  Layers,
  Mic,
  PenLine,
} from 'lucide-react';
import {
  DEFAULT_USER_PREFERENCES,
  type DifficultyLevel,
  type SourceReference,
} from '../types/models';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { useWorkspaceUi } from '../context/WorkspaceUiContext';
import { useRouter } from '../router/RouterContext';
import { useCourseSources } from '../hooks/useCourseSources';
import {
  generateCbtQuestions,
  generateFillGapExercises,
  generateFlashcardsDeck,
  generateOralExamQuestion,
  type CbtQuestionItem,
  type FillGapItem,
  type FlashcardItem,
  type OralQuestionItem,
} from '../services/ai/practiceGenerators';
import { PracticeConfigForm, type PracticeConfig } from '../components/practice/PracticeConfigForm';
import { FlashcardsSession } from '../components/practice/FlashcardsSession';
import { CbtSession } from '../components/practice/CbtSession';
import { FillGapSession } from '../components/practice/FillGapSession';
import { ExamPrepSession } from '../components/practice/ExamPrepSession';
import { EmptyState, ErrorBanner, LoadingSkeleton } from '../components/ui/StateViews';

type PracticeMethodId = 'flashcards' | 'cbt' | 'fill_in_the_gap' | 'exam_prep';

const PracticeCardIllustration: React.FC<{ id: PracticeMethodId }> = ({ id }) => {
  switch (id) {
    case 'flashcards':
      return (
        <svg
          viewBox="0 0 140 120"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute -right-3 -bottom-3 h-28 w-32 sm:h-32 sm:w-36 text-zinc-900 opacity-[0.09] transition-all duration-300 group-hover:opacity-[0.16] group-hover:scale-105"
        >
          <rect
            x="16"
            y="30"
            width="74"
            height="54"
            rx="8"
            transform="rotate(-10 16 30)"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <rect
            x="40"
            y="24"
            width="78"
            height="56"
            rx="8"
            transform="rotate(6 40 24)"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <line x1="56" y1="45" x2="98" y2="49" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="54" y1="57" x2="86" y2="60" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path
            d="M96 92 C108 92 116 84 116 74"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M100 87 L95 92 L100 97"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'cbt':
      return (
        <svg
          viewBox="0 0 140 120"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute -right-3 -bottom-3 h-28 w-32 sm:h-32 sm:w-36 text-zinc-900 opacity-[0.09] transition-all duration-300 group-hover:opacity-[0.16] group-hover:scale-105"
        >
          <rect x="24" y="14" width="92" height="94" rx="10" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="44" cy="38" r="7" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="2.5" />
          <path d="M41 38 L43.5 40.5 L48 35.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="58" y1="38" x2="100" y2="38" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle cx="44" cy="62" r="7" stroke="currentColor" strokeWidth="2.5" />
          <line x1="58" y1="62" x2="94" y2="62" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle cx="44" cy="86" r="7" stroke="currentColor" strokeWidth="2.5" />
          <line x1="58" y1="86" x2="86" y2="86" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case 'fill_in_the_gap':
      return (
        <svg
          viewBox="0 0 140 120"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute -right-3 -bottom-3 h-28 w-32 sm:h-32 sm:w-36 text-zinc-900 opacity-[0.09] transition-all duration-300 group-hover:opacity-[0.16] group-hover:scale-105"
        >
          <line x1="20" y1="30" x2="112" y2="30" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <line x1="20" y1="52" x2="46" y2="52" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <rect
            x="54"
            y="40"
            width="44"
            height="22"
            rx="5"
            fill="currentColor"
            fillOpacity="0.14"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeDasharray="4 3"
          />
          <line x1="106" y1="52" x2="122" y2="52" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <line x1="20" y1="78" x2="88" y2="78" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path
            d="M96 94 L118 72 L126 80 L104 102 L93 105 L96 94 Z"
            fill="currentColor"
            fillOpacity="0.14"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'exam_prep':
      return (
        <svg
          viewBox="0 0 140 120"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute -right-3 -bottom-3 h-28 w-32 sm:h-32 sm:w-36 text-zinc-900 opacity-[0.09] transition-all duration-300 group-hover:opacity-[0.16] group-hover:scale-105"
        >
          <rect
            x="54"
            y="20"
            width="28"
            height="46"
            rx="14"
            fill="currentColor"
            fillOpacity="0.14"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <path
            d="M42 54 C42 69 54 80 68 80 C82 80 94 69 94 54"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <line x1="68" y1="80" x2="68" y2="98" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="54" y1="98" x2="82" y2="98" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M104 36 C111 43 111 55 104 62" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M114 28 C125 39 125 59 114 70" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M32 36 C25 43 25 55 32 62" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
  }
};

const PRACTICE_METHODS: Array<{
  id: PracticeMethodId;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  itemLabel: string;
  defaultCount: number;
  minCount: number;
  maxCount: number;
  submitLabel: string;
}> = [
  {
    id: 'flashcards',
    title: 'Flashcards',
    icon: Layers,
    itemLabel: 'Number of flashcards',
    defaultCount: 10,
    minCount: 4,
    maxCount: 25,
    submitLabel: 'Generate flashcards deck',
  },
  {
    id: 'cbt',
    title: 'CBT',
    icon: ClipboardCheck,
    itemLabel: 'Number of questions',
    defaultCount: 10,
    minCount: 4,
    maxCount: 25,
    submitLabel: 'Start CBT test',
  },
  {
    id: 'fill_in_the_gap',
    title: 'Fill in the Gap',
    icon: PenLine,
    itemLabel: 'Number of exercises',
    defaultCount: 8,
    minCount: 4,
    maxCount: 20,
    submitLabel: 'Generate gap-fill drills',
  },
  {
    id: 'exam_prep',
    title: 'Exam Prep',
    icon: Mic,
    itemLabel: 'Number of oral questions',
    defaultCount: 5,
    minCount: 3,
    maxCount: 12,
    submitLabel: 'Begin oral examination',
  },
];

type ActiveSessionState =
  | {
      kind: 'flashcards';
      topicIds: string[];
      cards: FlashcardItem[];
      references: SourceReference[];
    }
  | {
      kind: 'cbt';
      topicIds: string[];
      mode: 'practice' | 'exam';
      examMinutes: number;
      questions: CbtQuestionItem[];
      references: SourceReference[];
    }
  | {
      kind: 'fill_in_the_gap';
      topicIds: string[];
      items: FillGapItem[];
      references: SourceReference[];
    }
  | {
      kind: 'exam_prep';
      topicIds: string[];
      difficulty: DifficultyLevel;
      totalQuestions: number;
      customInstructions: string;
      firstQuestion: OralQuestionItem;
      references: SourceReference[];
    };

export const PracticePage: React.FC = () => {
  const { user, profile } = useAuth();
  const { activeCourse, topics, coursesLoading } = useCourses();
  const { navigate } = useRouter();
  const { setHideHeader, setHideBottomNav } = useWorkspaceUi();
  const { sources } = useCourseSources(user?.uid, activeCourse?.id);

  const prefs = profile?.preferences ?? DEFAULT_USER_PREFERENCES;

  const [selectedMethod, setSelectedMethod] = useState<PracticeMethodId | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSessionState | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasBackNavView =
    !coursesLoading && Boolean(activeCourse) && Boolean(user) && Boolean(selectedMethod || activeSession);

  useEffect(() => {
    setHideHeader(hasBackNavView);
    setHideBottomNav(hasBackNavView);
    return () => {
      setHideHeader(false);
      setHideBottomNav(false);
    };
  }, [hasBackNavView, setHideHeader, setHideBottomNav]);

  if (coursesLoading) {
    return <LoadingSkeleton lines={4} />;
  }

  if (!activeCourse || !user) {
    return (
      <div>
        <div className="border-b border-zinc-200 pb-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950">
            Practice
          </h1>
          <p className="mt-1.5 text-sm text-zinc-600">
            Four focused learning methods grounded in your course materials.
          </p>
        </div>
        <EmptyState
          title="Select or create a course first"
          description="Practice drills are generated from your active course and optional topics. Create a course to set up your study workspace."
          actionLabel="Go to Courses"
          onAction={() => navigate('/courses')}
        />
      </div>
    );
  }

  const handleStartPractice = async (methodId: PracticeMethodId, config: PracticeConfig) => {
    setGenerating(true);
    setError(null);
    try {
      if (methodId === 'flashcards') {
        const res = await generateFlashcardsDeck({
          course: activeCourse,
          sources,
          topicIds: config.topicIds,
          count: config.count,
          difficulty: config.difficulty,
          customInstructions: config.customInstructions,
          model: prefs.defaultModel,
        });
        setActiveSession({
          kind: 'flashcards',
          topicIds: config.topicIds,
          cards: res.cards,
          references: res.references,
        });
      } else if (methodId === 'cbt') {
        const res = await generateCbtQuestions({
          course: activeCourse,
          sources,
          topicIds: config.topicIds,
          count: config.count,
          difficulty: config.difficulty,
          customInstructions: config.customInstructions,
          model: prefs.defaultModel,
        });
        setActiveSession({
          kind: 'cbt',
          topicIds: config.topicIds,
          mode: config.cbtMode || 'practice',
          examMinutes: config.examMinutes || 15,
          questions: res.questions,
          references: res.references,
        });
      } else if (methodId === 'fill_in_the_gap') {
        const res = await generateFillGapExercises({
          course: activeCourse,
          sources,
          topicIds: config.topicIds,
          count: config.count,
          difficulty: config.difficulty,
          customInstructions: config.customInstructions,
          model: prefs.defaultModel,
        });
        setActiveSession({
          kind: 'fill_in_the_gap',
          topicIds: config.topicIds,
          items: res.items,
          references: res.references,
        });
      } else if (methodId === 'exam_prep') {
        const res = await generateOralExamQuestion({
          course: activeCourse,
          sources,
          topicIds: config.topicIds,
          difficulty: config.difficulty,
          customInstructions: config.customInstructions,
          questionNumber: 1,
          totalQuestions: config.count,
          priorQuestions: [],
          model: prefs.defaultModel,
        });
        setActiveSession({
          kind: 'exam_prep',
          topicIds: config.topicIds,
          difficulty: config.difficulty,
          totalQuestions: config.count,
          customInstructions: config.customInstructions,
          firstQuestion: res.item,
          references: res.references,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate practice session.');
    } finally {
      setGenerating(false);
    }
  };

  if (activeSession) {
    if (activeSession.kind === 'flashcards') {
      return (
        <FlashcardsSession
          userId={user.uid}
          course={activeCourse}
          topicIds={activeSession.topicIds}
          initialCards={activeSession.cards}
          references={activeSession.references}
          voiceEnabled={prefs.voiceEnabled}
          ttsVoice={prefs.ttsVoice}
          voiceRate={prefs.voiceRate}
          onExit={() => {
            setActiveSession(null);
            setSelectedMethod(null);
          }}
        />
      );
    }
    if (activeSession.kind === 'cbt') {
      return (
        <CbtSession
          userId={user.uid}
          course={activeCourse}
          topicIds={activeSession.topicIds}
          mode={activeSession.mode}
          examMinutes={activeSession.examMinutes}
          questions={activeSession.questions}
          references={activeSession.references}
          onExit={() => {
            setActiveSession(null);
            setSelectedMethod(null);
          }}
        />
      );
    }
    if (activeSession.kind === 'fill_in_the_gap') {
      return (
        <FillGapSession
          userId={user.uid}
          course={activeCourse}
          topicIds={activeSession.topicIds}
          model={prefs.defaultModel}
          items={activeSession.items}
          references={activeSession.references}
          onExit={() => {
            setActiveSession(null);
            setSelectedMethod(null);
          }}
        />
      );
    }
    return (
      <ExamPrepSession
        userId={user.uid}
        course={activeCourse}
        sources={sources}
        topicIds={activeSession.topicIds}
        difficulty={activeSession.difficulty}
        totalQuestions={activeSession.totalQuestions}
        customInstructions={activeSession.customInstructions}
        model={prefs.defaultModel}
        voiceEnabled={prefs.voiceEnabled}
        ttsVoice={prefs.ttsVoice}
        voiceRate={prefs.voiceRate}
        firstQuestion={activeSession.firstQuestion}
        references={activeSession.references}
        onExit={() => {
          setActiveSession(null);
          setSelectedMethod(null);
        }}
      />
    );
  }

  if (selectedMethod) {
    const methodMeta = PRACTICE_METHODS.find((m) => m.id === selectedMethod)!;
    return (
      <div className="space-y-6">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <PracticeConfigForm
          title={`${methodMeta.title} — ${activeCourse.code}`}
          topics={topics}
          sourcesCount={sources.length}
          defaultDifficulty={prefs.defaultDifficulty}
          itemLabel={methodMeta.itemLabel}
          defaultCount={methodMeta.defaultCount}
          minCount={methodMeta.minCount}
          maxCount={methodMeta.maxCount}
          showCbtModeOptions={selectedMethod === 'cbt'}
          loading={generating}
          submitLabel={methodMeta.submitLabel}
          onBack={() => {
            setSelectedMethod(null);
            setError(null);
          }}
          onStart={(config) => void handleStartPractice(selectedMethod, config)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-zinc-200 pb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950">
          Practice
        </h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid grid-cols-2 gap-4 sm:gap-5 max-w-3xl">
        {PRACTICE_METHODS.map((method) => {
          const Icon = method.icon;
          return (
            <button
              key={method.id}
              type="button"
              onClick={() => setSelectedMethod(method.id)}
              className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 min-h-[152px] sm:min-h-[176px] flex flex-col justify-between text-left transition-all duration-200 hover:border-zinc-900 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.99] cursor-pointer"
            >
              <PracticeCardIllustration id={method.id} />

              <div className="relative z-10 flex items-start justify-between gap-2">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-xs transition-transform duration-200 group-hover:scale-105">
                  <Icon className="h-5 w-5" />
                </span>
                <ArrowUpRight className="h-4 w-4 text-zinc-300 transition-all duration-200 group-hover:text-zinc-950 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>

              <h2 className="relative z-10 mt-6 font-display text-base sm:text-lg font-semibold tracking-tight text-zinc-950">
                {method.title}
              </h2>
            </button>
          );
        })}
      </div>
    </div>
  );
};
