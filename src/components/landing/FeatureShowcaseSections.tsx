import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Layers,
  LayoutGrid,
  Link2,
  MessageSquare,
  Mic,
  PenLine,
  RotateCcw,
  Users,
  Volume2,
} from 'lucide-react';
import { FlameArt } from '../streak/FlameArt';
import { Button } from '../ui/Button';

interface FeatureShowcaseSectionsProps {
  signingIn: boolean;
  onSignIn: () => void;
}

const REVEAL_VIEWPORT = { once: true, amount: 0.2 } as const;

/**
 * Architectural corner line-art illustrations directly inspired by SOTAL's PracticePage cards.
 */
const CornerCardIllustration: React.FC<{
  kind: 'flashcards' | 'cbt' | 'fill_gap' | 'oral' | 'library' | 'courses';
}> = ({ kind }) => {
  const baseClass =
    'pointer-events-none absolute -right-3 -bottom-3 h-28 w-32 sm:h-32 sm:w-36 text-zinc-900 dark:text-zinc-200 opacity-[0.08] dark:opacity-[0.11] transition-all duration-300 group-hover:opacity-[0.15] dark:group-hover:opacity-[0.19] group-hover:scale-105';

  switch (kind) {
    case 'flashcards':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <rect
            x="16"
            y="30"
            width="74"
            height="54"
            rx="8"
            transform="rotate(-10 16 30)"
            stroke="currentColor"
            strokeWidth="2.4"
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
            strokeWidth="2.4"
          />
          <line x1="56" y1="45" x2="98" y2="49" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="54" y1="57" x2="86" y2="60" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
    case 'cbt':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <rect x="24" y="14" width="92" height="94" rx="10" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="44" cy="38" r="7" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="2.4" />
          <path d="M41 38 L43.5 40.5 L48 35.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="58" y1="38" x2="100" y2="38" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
          <circle cx="44" cy="62" r="7" stroke="currentColor" strokeWidth="2.4" />
          <line x1="58" y1="62" x2="94" y2="62" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
          <circle cx="44" cy="86" r="7" stroke="currentColor" strokeWidth="2.4" />
          <line x1="58" y1="86" x2="86" y2="86" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
        </svg>
      );
    case 'fill_gap':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <line x1="20" y1="30" x2="112" y2="30" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
          <line x1="20" y1="52" x2="46" y2="52" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
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
          <line x1="106" y1="52" x2="122" y2="52" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
          <line x1="20" y1="78" x2="88" y2="78" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
        </svg>
      );
    case 'oral':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <rect x="54" y="20" width="28" height="46" rx="14" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="2.4" />
          <path d="M42 54 C42 69 54 80 68 80 C82 80 94 69 94 54" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="68" y1="80" x2="68" y2="98" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="54" y1="98" x2="82" y2="98" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M104 36 C111 43 111 55 104 62" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
    case 'courses':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <rect x="18" y="20" width="44" height="36" rx="7" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="2.4" />
          <rect x="74" y="20" width="48" height="36" rx="7" stroke="currentColor" strokeWidth="2.4" />
          <rect x="18" y="68" width="44" height="36" rx="7" stroke="currentColor" strokeWidth="2.4" />
          <rect x="74" y="68" width="48" height="36" rx="7" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="2.4" />
        </svg>
      );
    case 'library':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <path d="M22 28 C38 22 56 24 70 32 C84 24 102 22 118 28 V92 C102 86 84 88 70 96 C56 88 38 86 22 92 Z" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
          <line x1="70" y1="32" x2="70" y2="96" stroke="currentColor" strokeWidth="2.4" />
          <line x1="34" y1="48" x2="58" y2="51" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="34" y1="62" x2="56" y2="65" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="82" y1="51" x2="106" y2="48" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
  }
};

const PRACTICE_PREVIEW_CARDS = [
  {
    id: 'cbt' as const,
    title: 'CBT Tests',
    detail:
      'Practice and timed exam modes generated from your course notes with clear option explanations and instant review.',
    icon: ClipboardCheck,
    accentClass: 'text-orange-600 dark:text-orange-400',
  },
  {
    id: 'flashcards' as const,
    title: 'Flashcards',
    detail:
      'Interactive recall decks with confidence tracking, speech playback, and source references on every card.',
    icon: Layers,
    accentClass: 'text-sky-600 dark:text-sky-400',
  },
  {
    id: 'fill_gap' as const,
    title: 'Fill in the Gap',
    detail:
      'Active-recall exercises that test key terminology, formulas, and definitions directly from your selected topics.',
    icon: PenLine,
    accentClass: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'oral' as const,
    title: 'Oral Exam Prep',
    detail:
      'Speak or type your explanation while Jovibe evaluates reasoning, spots gaps, and follows up like an examiner.',
    icon: Mic,
    accentClass: 'text-violet-600 dark:text-violet-400',
  },
];

const SAMPLE_FLASHCARD = {
  course: 'BIO 204 · Cell Metabolism',
  front: 'Why does oxidative phosphorylation depend directly on molecular oxygen?',
  back: 'Oxygen acts as the terminal electron acceptor at Complex IV of the electron transport chain. Without it, electron flow halts, the proton gradient collapses, and ATP synthase stops producing ATP.',
};

const SAMPLE_WEEK_DAYS = [
  { day: 'Mon', active: true },
  { day: 'Tue', active: true },
  { day: 'Wed', active: true },
  { day: 'Thu', active: true },
  { day: 'Fri', active: true },
  { day: 'Sat', active: true },
  { day: 'Today', active: true },
];

/**
 * Editorial, multi-layout feature showcase below the hero.
 * Built strictly around real SOTAL capabilities with SOTAL's Practice-card visual DNA.
 */
export const FeatureShowcaseSections: React.FC<FeatureShowcaseSectionsProps> = ({
  signingIn,
  onSignIn,
}) => {
  const reducedMotion = useReducedMotion();
  const [cardFlipped, setCardFlipped] = useState(false);

  const revealInitial = reducedMotion ? false : { opacity: 0, y: 20 };
  const revealAnimate = { opacity: 1, y: 0 };

  return (
    <div id="workspace" className="relative z-10 scroll-mt-20">
      {/* ── Transition Bridge: From Core to Academic Workspace ───────────────── */}
      <section className="mx-auto max-w-[1120px] px-5 sm:px-6 pt-12 pb-20 sm:pt-16 sm:pb-28">
        <motion.div
          initial={revealInitial}
          whileInView={revealAnimate}
          viewport={REVEAL_VIEWPORT}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="border-t border-zinc-200 dark:border-zinc-800/90 pt-14 sm:pt-16"
        >
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                01. Unified Academic Environment
              </p>
              <h2 className="mt-3 font-display text-2xl sm:text-3xl lg:text-[2.25rem] font-semibold tracking-tight text-zinc-950 dark:text-zinc-100 leading-[1.15]">
                Every study tool works from the same course knowledge base.
              </h2>
            </div>
            <div className="lg:col-span-5">
              <p className="text-sm sm:text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                Upload lecture slides, PDFs, handwritten notes, or voice recordings once. Jovibe connects them across your AI Tutor, Jovibe Live voice sessions, structured practice, and daily progress tracking.
              </p>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── Section 1: AI Tutor & Jovibe Live Voice (Blue + Cyan Accents) ─────── */}
      <section
        id="tutor"
        className="mx-auto max-w-[1120px] scroll-mt-24 px-5 sm:px-6 pb-24 sm:pb-32"
      >
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center">
          {/* Editorial description */}
          <motion.div
            initial={revealInitial}
            whileInView={revealAnimate}
            viewport={REVEAL_VIEWPORT}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-5 space-y-5"
          >
            <div className="flex items-center gap-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              <span>02. AI Tutor & Jovibe Live</span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100 leading-[1.18]">
              Ask deep questions in chat, or talk through tough concepts aloud.
            </h2>
            <p className="text-sm sm:text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
              Your AI Tutor answers with clear traceability back to your uploaded course materials. Switch between Library Only, Library First, or General modes, listen to cached voice replies, or enter Jovibe Live for natural, interruptible voice conversations.
            </p>
            <div className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-5 text-sm text-zinc-700 dark:text-zinc-300">
              <div className="flex items-start gap-3">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                <span>Course-grounded explanations with source references and saved voice playback.</span>
              </div>
              <div className="flex items-start gap-3">
                <AudioLines className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
                <span>Real-time Jovibe Live voice companion that adapts to your pace and topic.</span>
              </div>
            </div>
          </motion.div>

          {/* Practice-card styled authentic Tutor conversation preview */}
          <motion.div
            initial={revealInitial}
            whileInView={revealAnimate}
            viewport={REVEAL_VIEWPORT}
            transition={{ duration: 0.55, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-7"
          >
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm overflow-hidden shadow-xs">
              {/* Minimal conversation header */}
              <div className="flex items-center justify-between gap-3 border-b border-zinc-200/80 dark:border-zinc-800 px-5 py-3.5 text-xs">
                <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-200 font-medium">
                  <MessageSquare className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                  <span>AI Tutor</span>
                  <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-zinc-500 dark:text-zinc-400 font-normal">
                    CSC 301 · Library First
                  </span>
                </div>
                <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                  Source-grounded
                </span>
              </div>

              {/* Conversation transcript */}
              <div className="p-5 sm:p-6 space-y-5">
                {/* Student message */}
                <div className="flex justify-end">
                  <div className="max-w-[86%] rounded-2xl rounded-br-sm bg-zinc-950 dark:bg-zinc-200 px-4 py-3 text-sm leading-relaxed text-white dark:text-zinc-950">
                    Why does Dijkstra&apos;s algorithm fail when a graph contains negative edge weights?
                  </div>
                </div>

                {/* Tutor response */}
                <div className="space-y-3">
                  <div className="rounded-2xl rounded-bl-sm border border-zinc-200/90 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/70 px-4 py-3.5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 space-y-2.5">
                    <p>
                      Dijkstra&apos;s algorithm commits greedily to the unvisited vertex with the smallest tentative distance, assuming no future path can lower it further.
                    </p>
                    <p className="text-zinc-600 dark:text-zinc-400">
                      With a negative edge, a longer path explored later can reduce the total cost to an already finalized vertex — breaking that greedy invariant. Use Bellman-Ford when negative weights are possible.
                    </p>
                  </div>

                  {/* Quiet source traceability & audio playback bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                      <span>Lecture 06: Shortest Path Algorithms · Slide 14</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                      <Volume2 className="h-3.5 w-3.5" />
                      <span>Saved audio ready</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Section 2: Courses & Automatic Study (Green Accent) ──────────────── */}
      <section className="mx-auto max-w-[1120px] px-5 sm:px-6 pb-24 sm:pb-32">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
          {/* Course Organization Card (Practice card style) */}
          <motion.div
            initial={revealInitial}
            whileInView={revealAnimate}
            viewport={REVEAL_VIEWPORT}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="group relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 lg:col-span-7 flex flex-col justify-between"
          >
            <CornerCardIllustration kind="courses" />
            <div className="relative z-10 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-950 dark:bg-zinc-200 text-white dark:text-zinc-950">
                  <LayoutGrid className="h-5 w-5" />
                </span>
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  03. Courses & Structure
                </span>
              </div>
              <h3 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
                Organize every semester by course and topic.
              </h3>
              <p className="max-w-xl text-sm sm:text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                Keep each subject isolated in its own workspace so your uploaded notes, AI Tutor context, practice history, and revision decks never bleed across courses.
              </p>
            </div>

            {/* Clean unboxed course index preview */}
            <div className="relative z-10 mt-8 divide-y divide-zinc-100 dark:divide-zinc-800/80 border-t border-zinc-200 dark:border-zinc-800 text-sm">
              {[
                { code: 'CSC 301', name: 'Data Structures & Algorithms', meta: '6 topics · 14 sources' },
                { code: 'BIO 204', name: 'Cellular Metabolism', meta: '4 topics · 9 sources' },
                { code: 'MTH 212', name: 'Linear Algebra', meta: '5 topics · 11 sources' },
              ].map((course) => (
                <div
                  key={course.code}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="flex items-baseline gap-3 min-w-0">
                    <span className="font-mono text-xs font-medium text-emerald-700 dark:text-emerald-400 shrink-0">
                      {course.code}
                    </span>
                    <span className="truncate font-medium text-zinc-900 dark:text-zinc-200">
                      {course.name}
                    </span>
                  </div>
                  <span className="hidden sm:inline text-xs text-zinc-500 dark:text-zinc-400 shrink-0 tabular-nums">
                    {course.meta}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Automatic Study Card */}
          <motion.div
            initial={revealInitial}
            whileInView={revealAnimate}
            viewport={REVEAL_VIEWPORT}
            transition={{ duration: 0.55, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/60 p-6 sm:p-8 lg:col-span-5 flex flex-col justify-between"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-emerald-600 dark:text-emerald-400">
                  <GraduationCap className="h-5 w-5" />
                </span>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Guided mastery
                </span>
              </div>
              <h3 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
                Automatic Study with saved checkpoints.
              </h3>
              <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Step through your course topic by topic. Jovibe teaches each unit, checks your understanding with adaptive questions, and saves your exact progress so you can close the tab and resume seamlessly later.
              </p>
            </div>

            <div className="mt-8 space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-5 text-xs">
              {[
                { step: 'Unit 01', label: 'Core concepts & examples', state: 'Completed' },
                { step: 'Unit 02', label: 'Checkpoint evaluation', state: 'In progress' },
                { step: 'Unit 03', label: 'Applied problem walkthrough', state: 'Up next' },
              ].map((u) => (
                <div key={u.step} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono text-zinc-400 dark:text-zinc-500 shrink-0">
                      {u.step}
                    </span>
                    <span className="truncate text-zinc-800 dark:text-zinc-200 font-medium">
                      {u.label}
                    </span>
                  </div>
                  <span
                    className={
                      u.state === 'Completed'
                        ? 'text-emerald-700 dark:text-emerald-400 font-medium shrink-0'
                        : 'text-zinc-500 dark:text-zinc-400 shrink-0'
                    }
                  >
                    {u.state}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Section 3: Practice, CBT & Interactive Flashcards (Orange Accent) ── */}
      <section
        id="practice"
        className="mx-auto max-w-[1120px] scroll-mt-24 px-5 sm:px-6 pb-24 sm:pb-32"
      >
        <motion.div
          initial={revealInitial}
          whileInView={revealAnimate}
          viewport={REVEAL_VIEWPORT}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-2xl space-y-3 mb-10"
        >
          <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
            04. Active Practice & Revision
          </p>
          <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100 leading-[1.18]">
            Four deliberate practice modes built for real retention.
          </h2>
          <p className="text-sm sm:text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            Configure difficulty, topic scope, question count, and optional countdown timers — then test yourself under calm study mode or timed CBT exam conditions.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
          {/* 2x2 Practice-card grid directly echoing PracticePage.tsx */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:col-span-7">
            {PRACTICE_PREVIEW_CARDS.map((card, idx) => {
              const Icon = card.icon;
              return (
                <motion.div
                  key={card.id}
                  initial={revealInitial}
                  whileInView={revealAnimate}
                  viewport={REVEAL_VIEWPORT}
                  transition={{
                    duration: 0.45,
                    delay: idx * 0.06,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="group relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6 min-h-[188px] flex flex-col justify-between transition-all duration-200 hover:border-zinc-400 dark:hover:border-zinc-600 hover:-translate-y-0.5 hover:shadow-md dark:hover:shadow-black/30"
                >
                  <CornerCardIllustration kind={card.id} />

                  <div className="relative z-10 flex items-start justify-between gap-2">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-950 text-white dark:bg-zinc-200 dark:text-zinc-950 transition-transform duration-200 group-hover:scale-105">
                      <Icon className="h-5 w-5" />
                    </span>
                    <ArrowUpRight
                      className={`h-4 w-4 opacity-50 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${card.accentClass}`}
                    />
                  </div>

                  <div className="relative z-10 mt-6 space-y-1.5">
                    <h3 className="font-display text-base sm:text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
                      {card.title}
                    </h3>
                    <p className="text-xs sm:text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {card.detail}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Interactive Flashcard Preview (real clickable revision card) */}
          <motion.div
            initial={revealInitial}
            whileInView={revealAnimate}
            viewport={REVEAL_VIEWPORT}
            transition={{ duration: 0.55, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-5 flex flex-col"
          >
            <button
              type="button"
              onClick={() => setCardFlipped((prev) => !prev)}
              aria-pressed={cardFlipped}
              className="group relative flex flex-1 min-h-[280px] w-full flex-col justify-between rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/75 p-6 sm:p-7 text-left transition-all duration-200 hover:border-zinc-400 dark:hover:border-zinc-600 cursor-pointer"
            >
              <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                <span>{SAMPLE_FLASHCARD.course}</span>
                <span className="font-medium text-orange-700 dark:text-orange-400">
                  {cardFlipped ? 'Answer' : 'Flashcard preview'}
                </span>
              </div>

              <div className="my-6">
                <motion.div
                  key={cardFlipped ? 'back' : 'front'}
                  initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                >
                  {cardFlipped ? (
                    <p className="text-sm sm:text-base leading-relaxed text-zinc-800 dark:text-zinc-200">
                      {SAMPLE_FLASHCARD.back}
                    </p>
                  ) : (
                    <p className="font-display text-lg sm:text-xl font-semibold tracking-tight leading-snug text-zinc-950 dark:text-zinc-100">
                      {SAMPLE_FLASHCARD.front}
                    </p>
                  )}
                </motion.div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-zinc-200/80 dark:border-zinc-800 pt-4 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="inline-flex items-center gap-1.5 font-medium text-zinc-900 dark:text-zinc-200">
                  <RotateCcw className="h-3.5 w-3.5" />
                  {cardFlipped ? 'Tap to show question' : 'Tap to flip and test recall'}
                </span>
                <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                  1 / 10
                </span>
              </div>
            </button>
          </motion.div>
        </div>
      </section>

      {/* ── Section 4: Personal Library, Shared Library & Course Sharing (Violet) */}
      <section
        id="library"
        className="mx-auto max-w-[1120px] scroll-mt-24 px-5 sm:px-6 pb-24 sm:pb-32"
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
          {/* Personal Library */}
          <motion.div
            initial={revealInitial}
            whileInView={revealAnimate}
            viewport={REVEAL_VIEWPORT}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="group relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 lg:col-span-6 flex flex-col justify-between"
          >
            <CornerCardIllustration kind="library" />
            <div className="relative z-10 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-950 dark:bg-zinc-200 text-white dark:text-zinc-950">
                  <BookOpen className="h-5 w-5" />
                </span>
                <span className="text-xs font-medium text-violet-700 dark:text-violet-400">
                  05. Personal Library
                </span>
              </div>
              <h3 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
                Turn raw slides, PDFs, photos, and audio into structured notes.
              </h3>
              <p className="text-sm sm:text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                Import lecture handouts, textbook chapters, DOCX/PPTX files, photographed board notes via OCR extraction, or recorded voice memos. Everything stays cleanly searchable and synced across your devices.
              </p>
            </div>

            <div className="relative z-10 mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-200 dark:border-zinc-800 pt-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span>PDF & DOCX</span>
              <span aria-hidden="true">·</span>
              <span>PowerPoint slides</span>
              <span aria-hidden="true">·</span>
              <span>Vision OCR</span>
              <span aria-hidden="true">·</span>
              <span>Voice transcription</span>
            </div>
          </motion.div>

          {/* Shared Library & Collaborative Course Sharing */}
          <motion.div
            initial={revealInitial}
            whileInView={revealAnimate}
            viewport={REVEAL_VIEWPORT}
            transition={{ duration: 0.55, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/60 p-6 sm:p-8 lg:col-span-6 flex flex-col justify-between"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-violet-600 dark:text-violet-400">
                  <Users className="h-5 w-5" />
                </span>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Shared Library & Courses
                </span>
              </div>
              <h3 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
                Share a course link. Keep your own private study space.
              </h3>
              <p className="text-sm sm:text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                Share curated course libraries with classmates or study circles via an invite link. Authors manage access and named groups, while every joined student gets their own private AI Tutor, Practice sessions, personal notes, and study history.
              </p>
            </div>

            <div className="mt-7 space-y-2.5 border-t border-zinc-200 dark:border-zinc-800 pt-4 text-xs text-zinc-700 dark:text-zinc-300">
              <div className="flex items-center gap-2.5">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                <span>Instant invite links with author member controls and named groups.</span>
              </div>
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                <span>Shared course materials with completely private Tutor, Practice, and Notes.</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Section 5: Streaks & Daily Consistency (Warm Fire Accent) ────────── */}
      <section
        id="consistency"
        className="mx-auto max-w-[1120px] scroll-mt-24 px-5 sm:px-6 pb-24 sm:pb-32"
      >
        <motion.div
          initial={revealInitial}
          whileInView={revealAnimate}
          viewport={REVEAL_VIEWPORT}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-10"
        >
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-7 space-y-4">
              <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
                06. Consistency & Study Dashboard
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100 leading-[1.18]">
                Build a daily study rhythm that compounds over the semester.
              </h2>
              <p className="max-w-xl text-sm sm:text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                Complete a real study session — a quiz, flashcard deck, timed CBT, Automatic Study unit, or focused Tutor session — to advance your daily streak and log your study time in your personal dashboard.
              </p>

              {/* Calm 7-day consistency rhythm strip */}
              <div className="pt-3">
                <div className="grid grid-cols-7 gap-2 max-w-md">
                  {SAMPLE_WEEK_DAYS.map((item) => (
                    <div
                      key={item.day}
                      className="flex flex-col items-center gap-1.5 rounded-xl bg-zinc-100/70 dark:bg-zinc-950/60 py-2.5"
                    >
                      <CheckCircle2 className="h-4 w-4 text-orange-500 dark:text-orange-400" />
                      <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                        {item.day}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* SOTAL's actual FlameArt visual */}
            <div className="lg:col-span-5 flex flex-col items-center justify-center rounded-xl bg-zinc-50 dark:bg-zinc-950/65 py-8 px-6 text-center">
              <FlameArt mode="active" size="lg" />
              <div className="mt-3 font-display text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
                Daily study streaks
              </div>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Earned through real learning across your personal courses and shared libraries.
              </p>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── Final Call to Action ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1120px] px-5 sm:px-6 pb-20 sm:pb-28">
        <motion.div
          initial={revealInitial}
          whileInView={revealAnimate}
          viewport={REVEAL_VIEWPORT}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 dark:bg-zinc-900 px-6 py-14 sm:px-12 sm:py-16 text-center text-white"
        >
          {/* Subtle ambient radial glow echoing the hero centerpiece */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 h-56 w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[90px] opacity-35"
            style={{
              background:
                'radial-gradient(ellipse, rgba(56,189,248,0.65) 0%, rgba(139,92,246,0.45) 50%, transparent 80%)',
            }}
          />

          <div className="relative z-10 mx-auto max-w-xl space-y-5">
            <h2 className="font-display text-2xl sm:text-4xl font-semibold tracking-tight text-white leading-[1.12]">
              Step into a calmer, smarter way to study.
            </h2>
            <p className="text-sm sm:text-base leading-relaxed text-zinc-400">
              Sign in with Google to organize your courses, connect your Gemini key, and start studying across devices.
            </p>
            <div className="pt-2 flex justify-center">
              <Button
                size="md"
                onClick={onSignIn}
                loading={signingIn}
                className="h-11 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 px-7"
              >
                Sign in with Google
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </motion.div>
      </section>
    </div>
  );
};
