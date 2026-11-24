import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Check, ChevronRight, X } from 'lucide-react';
import type { StudySource } from '../../types/models';
import type { LiveLessonContext } from './types';

interface LessonContextDrawerProps {
  open: boolean;
  onClose: () => void;
  lesson: LiveLessonContext;
  availableSources: StudySource[];
  onSelectSource?: (source: StudySource) => void;
  onPromptSelect?: (prompt: string) => void;
  containedInFrame?: boolean;
  forceMobileSheet?: boolean;
}

export const LessonContextDrawer: React.FC<LessonContextDrawerProps> = ({
  open,
  onClose,
  lesson,
  availableSources,
  onSelectSource,
  onPromptSelect,
  containedInFrame = false,
  forceMobileSheet = false,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const positionMode = containedInFrame ? 'absolute' : 'fixed';

  return (
    <AnimatePresence>
      {open && (
        <div
          className={`${positionMode} inset-0 z-50 flex items-end ${
            forceMobileSheet ? '' : 'md:items-stretch md:justify-end'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Current lesson context"
        >
          {/* Scrim (solid translucent rgba — no backdrop-filter over WebGL) */}
          <motion.button
            type="button"
            aria-label="Close lesson context"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-zinc-950/45 dark:bg-black/60 cursor-pointer"
          />

          {/* Responsive Drawer: Bottom sheet on mobile, refined right sheet on tablet/desktop */}
          <motion.aside
            initial={{ y: 36, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 28, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className={`relative z-10 flex max-h-[82%] w-full flex-col rounded-t-3xl border-t border-zinc-200 bg-[#FAFBFC] text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-[#111318] dark:text-zinc-200 ${
              forceMobileSheet
                ? ''
                : 'md:max-h-full md:h-full md:w-[min(390px,92vw)] md:rounded-t-none md:rounded-l-2xl md:border-t-0 md:border-l'
            }`}
          >
            {/* Mobile grab handle */}
            <div
              className={`flex justify-center pt-3 pb-1 ${forceMobileSheet ? '' : 'md:hidden'}`}
              aria-hidden="true"
            >
              <span className="h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            </div>

            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200/80 dark:border-zinc-800/90 px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-mono">{lesson.courseCode}</span>
                  <span aria-hidden="true">·</span>
                  <span className="break-words">{lesson.topicName}</span>
                </div>
                <h2 className="mt-1 font-display text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-100 break-words">
                  {lesson.lessonTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close lesson context"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Lesson Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-6 scrollbar-hide">
              {lesson.summary && (
                <div>
                  <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    What we&apos;re exploring
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {lesson.summary}
                  </p>
                </div>
              )}

              {/* Conversation Starters */}
              {lesson.keyPrompts.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Easy ways to jump in
                  </h3>
                  <div className="mt-2.5 space-y-1.5">
                    {lesson.keyPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => {
                          onPromptSelect?.(prompt);
                          onClose();
                        }}
                        className="group flex w-full items-center justify-between gap-2 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 px-3.5 py-2.5 text-left text-sm text-zinc-800 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors cursor-pointer"
                      >
                        <span className="leading-snug">&ldquo;{prompt}&rdquo;</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Lesson Outline / Sections */}
              {lesson.sections.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Lesson outline
                  </h3>
                  <div className="mt-3 divide-y divide-zinc-200/70 dark:divide-zinc-800/80 border-t border-zinc-200/70 dark:border-zinc-800/80">
                    {lesson.sections.slice(0, 6).map((sec, idx) => (
                      <div key={sec.id || idx} className="py-3">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-200">
                            {sec.heading}
                          </h4>
                        </div>
                        {sec.content && (
                          <p className="mt-1 pl-6 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 break-words">
                            {sec.content}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Switch Lesson within Current Course */}
              {availableSources.length > 1 && onSelectSource && (
                <div className="border-t border-zinc-200/80 dark:border-zinc-800 pt-5">
                  <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Switch lesson in {lesson.courseCode}
                  </h3>
                  <div className="mt-2.5 space-y-1">
                    {availableSources.slice(0, 8).map((src) => {
                      const active = src.id === lesson.sourceId;
                      return (
                        <button
                          key={src.id}
                          type="button"
                          onClick={() => {
                            onSelectSource(src);
                            onClose();
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                            active
                              ? 'bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-950 font-medium'
                              : 'text-zinc-700 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <BookOpen className="h-3.5 w-3.5 shrink-0 opacity-70" />
                            <span className="truncate">{src.title}</span>
                          </span>
                          {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
};
