import React, { useEffect, useLayoutEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useGeminiOnboarding } from '../../context/GeminiOnboardingContext';
import { useRouter } from '../../router/RouterContext';
import {
  GEMINI_AI_STUDIO_API_KEY_URL,
  getStepProgressMeta,
} from '../../services/onboarding/geminiOnboardingStore';
import { Button } from '../ui/Button';
import { AiStudioVisualGuide } from './AiStudioVisualGuide';

interface RectBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PADDING = 6;

const StepProgressRow: React.FC<{ current: number; total: number; label: string }> = ({
  current,
  total,
  label,
}) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 tabular-nums">
      Step {current} of {total} · {label}
    </span>
    <div className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: total }).map((_, idx) => (
        <span
          key={idx}
          className={`h-1.5 rounded-full transition-all duration-200 ${
            idx + 1 <= current
              ? 'w-5 bg-zinc-950 dark:bg-zinc-200'
              : 'w-2 bg-zinc-200 dark:bg-zinc-800'
          }`}
        />
      ))}
    </div>
  </div>
);

interface SpotlightTourProps {
  selector: string;
  stepCurrent: number;
  stepTotal: number;
  stepLabel: string;
  title: string;
  description: string;
  fallbackActionLabel?: string;
  onFallbackAction?: () => void;
  onSkip: () => void;
}

const SpotlightTour: React.FC<SpotlightTourProps> = ({
  selector,
  stepCurrent,
  stepTotal,
  stepLabel,
  title,
  description,
  fallbackActionLabel,
  onFallbackAction,
  onSkip,
}) => {
  const [rect, setRect] = useState<RectBox | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  useLayoutEffect(() => {
    let rafId = 0;

    const measure = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) {
        const box = el.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          setRect({
            top: Math.max(0, box.top - SPOTLIGHT_PADDING),
            left: Math.max(0, box.left - SPOTLIGHT_PADDING),
            width: box.width + SPOTLIGHT_PADDING * 2,
            height: box.height + SPOTLIGHT_PADDING * 2,
          });
          return;
        }
      }
      setRect(null);
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(measure);
    };

    measure();
    // Re-measure briefly while dropdown/route animations settle
    const settleTimer1 = window.setTimeout(measure, 90);
    const settleTimer2 = window.setTimeout(measure, 220);

    const observer = new MutationObserver(scheduleMeasure);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', scheduleMeasure, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleTimer1);
      window.clearTimeout(settleTimer2);
      observer.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', scheduleMeasure, true);
    };
  }, [selector]);

  // Compute non-overlapping tooltip coordinates clamped safely inside the viewport
  const tooltipWidth = Math.min(320, viewport.width - 24);
  let tooltipTop = Math.min(viewport.height - 190, 96);
  let tooltipLeft = Math.max(12, viewport.width - tooltipWidth - 16);

  if (rect) {
    const spaceBelow = viewport.height - (rect.top + rect.height);
    const spaceLeft = rect.left;

    if (stepLabel === 'Open Settings' && spaceLeft >= tooltipWidth + 24 && viewport.width >= 640) {
      // Position to the left of the open profile dropdown on desktop so nothing covers the menu
      tooltipTop = Math.max(16, Math.min(viewport.height - 190, rect.top - 12));
      tooltipLeft = Math.max(12, rect.left - tooltipWidth - 16);
    } else if (spaceBelow >= 176) {
      tooltipTop = Math.min(viewport.height - 196, rect.top + rect.height + 14);
      tooltipLeft = Math.max(
        12,
        Math.min(viewport.width - tooltipWidth - 12, rect.left + rect.width - tooltipWidth)
      );
    } else {
      tooltipTop = Math.max(16, rect.top - 176);
      tooltipLeft = Math.max(
        12,
        Math.min(viewport.width - tooltipWidth - 12, rect.left + rect.width - tooltipWidth)
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] pointer-events-none"
      role="dialog"
      aria-modal="false"
      aria-label={title}
    >
      {/* 4-panel non-blocking backdrop cutout around the real UI element so clicks pass through directly */}
      {rect ? (
        <>
          <div
            aria-hidden="true"
            className="fixed left-0 right-0 top-0 bg-zinc-950/55 transition-opacity duration-150 pointer-events-none"
            style={{ height: rect.top }}
          />
          <div
            aria-hidden="true"
            className="fixed left-0 right-0 bottom-0 bg-zinc-950/55 transition-opacity duration-150 pointer-events-none"
            style={{ top: rect.top + rect.height }}
          />
          <div
            aria-hidden="true"
            className="fixed left-0 bg-zinc-950/55 transition-opacity duration-150 pointer-events-none"
            style={{ top: rect.top, height: rect.height, width: rect.left }}
          />
          <div
            aria-hidden="true"
            className="fixed right-0 bg-zinc-950/55 transition-opacity duration-150 pointer-events-none"
            style={{
              top: rect.top,
              height: rect.height,
              left: rect.left + rect.width,
            }}
          />

          {/* Crisp highlight ring around the real target control */}
          <div
            aria-hidden="true"
            className="fixed rounded-lg ring-2 ring-sky-500 dark:ring-sky-400 shadow-[0_0_0_4px_rgba(14,165,233,0.18)] pointer-events-none transition-all duration-150"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            }}
          />
        </>
      ) : (
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-zinc-950/45 pointer-events-none"
        />
      )}

      {/* Contextual instructional tooltip card */}
      <motion.div
        data-onboarding-tooltip="true"
        initial={{ opacity: 0, y: 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.98 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        style={{
          top: tooltipTop,
          left: tooltipLeft,
          width: tooltipWidth,
        }}
        className="fixed z-[75] pointer-events-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 shadow-2xl"
      >
        <StepProgressRow current={stepCurrent} total={stepTotal} label={stepLabel} />
        <h3 className="mt-2.5 font-display text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
          {title}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          {description}
        </p>

        <div className="mt-3.5 flex items-center justify-between gap-2 pt-2.5 border-t border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
          >
            Skip for now
          </button>
          {fallbackActionLabel && onFallbackAction && !rect && (
            <Button type="button" size="sm" onClick={onFallbackAction}>
              {fallbackActionLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export const GeminiOnboardingOverlay: React.FC = () => {
  const { route } = useRouter();
  const {
    state,
    hydrated,
    showCompletionModal,
    verifiedKeyLabel,
    startGuidedSetup,
    openSettingsKeyGuide,
    skipGuide,
    markVisitedAiStudio,
    confirmHaveApiKey,
    finishCompletion,
  } = useGeminiOnboarding();

  // Allow Escape to skip the modal steps cleanly
  useEffect(() => {
    const isModalOpen =
      (hydrated &&
        state.status === 'in_progress' &&
        (state.step === 'welcome' || (state.step === 'get_key_popup' && route === '/settings'))) ||
      showCompletionModal;

    if (!isModalOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showCompletionModal) {
          finishCompletion('stay');
        } else {
          skipGuide();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hydrated, state.status, state.step, route, showCompletionModal, finishCompletion, skipGuide]);

  if (!hydrated) return null;

  const progress = getStepProgressMeta(state.step);
  const showWelcomeModal =
    state.status === 'in_progress' && state.step === 'welcome' && route !== '/join';
  const showOpenProfileSpotlight =
    state.status === 'in_progress' && state.step === 'open_profile' && route !== '/settings';
  const showOpenSettingsSpotlight =
    state.status === 'in_progress' && state.step === 'open_settings' && route !== '/settings';
  const showGetKeyPopup =
    state.status === 'in_progress' && state.step === 'get_key_popup' && route === '/settings';

  return (
    <>
      {/* STEP 1 — CONCISE SETUP REMINDER MODAL */}
      <AnimatePresence>
        {showWelcomeModal && (
          <motion.div
            key="onboarding-welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={skipGuide}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/60 p-3 sm:p-4 backdrop-blur-[2px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gemini-onboarding-welcome-title"
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="shrink-0 flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 px-4 sm:px-5 py-3">
                <div className="min-w-0 flex-1">
                  <StepProgressRow
                    current={progress.current}
                    total={progress.total}
                    label={progress.label}
                  />
                </div>
                <button
                  type="button"
                  onClick={skipGuide}
                  aria-label="Skip setup guide"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 space-y-3.5">
                <div className="flex items-start gap-3">
                  <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2
                      id="gemini-onboarding-welcome-title"
                      className="font-display text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-100 [text-wrap:balance]"
                    >
                      Add your free Gemini API key
                    </h2>
                    <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                      Power AI Tutor, quizzes, OCR notes, and Jovibe Live without shared daily limits.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 p-3 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-700 dark:text-zinc-300" />
                  <span>
                    <strong className="font-medium text-zinc-950 dark:text-zinc-100">
                      Free &amp; saved on this device only.
                    </strong>{' '}
                    Takes under a minute with your Google account, and you can add extra keys later.
                  </span>
                </div>
              </div>

              {/* Pinned Footer */}
              <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 px-4 sm:px-5 py-3">
                <button
                  type="button"
                  onClick={skipGuide}
                  className="inline-flex h-9 items-center justify-center rounded-md px-3 text-xs sm:text-sm font-medium text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  Skip for now
                </button>
                <Button type="button" size="sm" onClick={startGuidedSetup} className="sm:px-4">
                  Set up API key
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* STEP 2 — SPOTLIGHT ON PROFILE ICON */}
      <AnimatePresence>
        {showOpenProfileSpotlight && (
          <SpotlightTour
            key="spotlight-profile"
            selector='[data-onboarding="profile-button"]'
            stepCurrent={2}
            stepTotal={4}
            stepLabel="Open profile"
            title="First, open your profile menu."
            description="Tap your profile icon in the top-right corner of Jovibe to open your account menu."
            fallbackActionLabel="Go to Settings"
            onFallbackAction={openSettingsKeyGuide}
            onSkip={skipGuide}
          />
        )}
      </AnimatePresence>

      {/* STEP 3 — SPOTLIGHT ON SETTINGS INSIDE PROFILE MENU */}
      <AnimatePresence>
        {showOpenSettingsSpotlight && (
          <SpotlightTour
            key="spotlight-settings"
            selector='[data-onboarding="settings-menu-item"]'
            stepCurrent={3}
            stepTotal={4}
            stepLabel="Open Settings"
            title="Now select Settings."
            description="Click Settings inside your profile menu to open Jovibe's Gemini API key section."
            fallbackActionLabel="Open Settings"
            onFallbackAction={openSettingsKeyGuide}
            onSkip={skipGuide}
          />
        )}
      </AnimatePresence>

      {/* STEP 4 — GET YOUR GEMINI API KEY POP-UP (ON SETTINGS PAGE) */}
      <AnimatePresence>
        {showGetKeyPopup && (
          <motion.div
            key="onboarding-get-key-popup"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/60 p-3 sm:p-4 backdrop-blur-[2px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gemini-key-help-title"
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-4 sm:px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <StepProgressRow current={4} total={4} label="Get your Gemini API key" />
                    <h2
                      id="gemini-key-help-title"
                      className="font-display text-base sm:text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-100"
                    >
                      Get your free Gemini API key
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={skipGuide}
                    aria-label="Close setup guide"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
                {state.visitedAiStudioAtMs && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-200 dark:border-sky-800/70 bg-sky-50/80 dark:bg-sky-950/35 px-3.5 py-2 text-xs text-sky-950 dark:text-sky-200">
                    <span>
                      <strong className="font-medium">Welcome back!</strong> Click{' '}
                      <strong>I have my API key</strong> below to paste and save it.
                    </span>
                  </div>
                )}

                {/* Direct external link to official Google AI Studio API Key page */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-medium text-zinc-950 dark:text-zinc-100">
                      Google AI Studio · API Keys
                    </div>
                    <div className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {GEMINI_AI_STUDIO_API_KEY_URL}
                    </div>
                  </div>
                  <a
                    href={GEMINI_AI_STUDIO_API_KEY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={markVisitedAiStudio}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white transition-colors shrink-0"
                  >
                    Open AI Studio
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>

                {/* Concise numbered steps */}
                <ol className="space-y-1.5 text-xs sm:text-sm text-zinc-700 dark:text-zinc-300">
                  {[
                    'Open Google AI Studio above and sign in with Google.',
                    'Click Create API key and copy the generated key.',
                    'Return here and click I have my API key below.',
                    'Paste the key into the Gemini field and click Add.',
                  ].map((stepText, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono text-[11px] font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">
                        {idx + 1}
                      </span>
                      <span className="leading-snug">{stepText}</span>
                    </li>
                  ))}
                </ol>

                {/* Visual Instructional Diagram */}
                <AiStudioVisualGuide />
              </div>

              {/* Footer Actions */}
              <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 px-4 sm:px-5 py-3">
                <button
                  type="button"
                  onClick={skipGuide}
                  className="inline-flex h-9 items-center justify-center rounded-md px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  Skip for now
                </button>
                <Button type="button" size="sm" onClick={confirmHaveApiKey}>
                  I have my API key
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* COMPLETION CONFIRMATION MODAL (AFTER VALID VERIFIED SAVE) */}
      <AnimatePresence>
        {showCompletionModal && (
          <motion.div
            key="onboarding-completed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/60 p-3 sm:p-4 backdrop-blur-[2px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gemini-onboarding-complete-title"
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl"
            >
              <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <button
                    type="button"
                    onClick={() => finishCompletion('stay')}
                    aria-label="Close confirmation"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div>
                  <h2
                    id="gemini-onboarding-complete-title"
                    className="font-display text-lg sm:text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100"
                  >
                    Your Gemini AI is ready
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    <strong className="font-medium text-zinc-900 dark:text-zinc-200">
                      {verifiedKeyLabel}
                    </strong>{' '}
                    has been verified and saved on this device. All AI study tools are ready.
                  </p>
                </div>
              </div>

              <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 px-5 py-3">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => finishCompletion('stay')}
                >
                  Add another key
                </Button>
                <Button type="button" size="sm" onClick={() => finishCompletion('return')}>
                  Start studying
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
