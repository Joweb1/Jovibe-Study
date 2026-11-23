import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Download, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Button } from '../ui/Button';
import { SotalLogo } from '../ui/SotalLogo';

const PROMPT_STORAGE_KEY = 'jovibe_pwa_install_popup_v2';
const SHORT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days for "Maybe later" / close
const LONG_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days for "Don't remind me for a while"
const INITIAL_DWELL_MS = 14_000; // Wait 14s so user settles in first

interface PersistedPromptState {
  snoozedUntil: number;
  dismissCount: number;
}

function readPromptState(): PersistedPromptState {
  if (typeof window === 'undefined') {
    return { snoozedUntil: 0, dismissCount: 0 };
  }
  try {
    const raw = window.localStorage.getItem(PROMPT_STORAGE_KEY);
    if (!raw) return { snoozedUntil: 0, dismissCount: 0 };
    const parsed = JSON.parse(raw) as Partial<PersistedPromptState>;
    return {
      snoozedUntil: typeof parsed.snoozedUntil === 'number' ? parsed.snoozedUntil : 0,
      dismissCount: typeof parsed.dismissCount === 'number' ? parsed.dismissCount : 0,
    };
  } catch {
    return { snoozedUntil: 0, dismissCount: 0 };
  }
}

function writePromptState(state: PersistedPromptState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

function isCompetingOverlayVisible(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return true;
  // Never interrupt active SOTAL Live voice sessions
  if (window.location.pathname.startsWith('/live')) return true;
  // Never stack on top of Gemini onboarding tutorial or another modal dialog
  if (document.querySelector('[data-onboarding-tooltip="true"]')) return true;
  if (document.querySelector('[role="dialog"]')) return true;
  return false;
}

/**
 * Calm, occasional floating popup inviting non-installed users to install
 * SOTAL Study on their device for faster launch and offline study access.
 */
export const PWAInstallPromptPopup: React.FC = () => {
  const { isInstalled, isInstallable, guideModalOpen, needsReinstallNotice, triggerInstall } =
    usePWAInstall();
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isInstalled || guideModalOpen || needsReinstallNotice) {
      setVisible(false);
      return;
    }

    const stored = readPromptState();
    if (Date.now() < stored.snoozedUntil) {
      return;
    }

    let retryTimer: number | null = null;
    const tryShow = () => {
      if (isInstalled || guideModalOpen || needsReinstallNotice) return;
      if (isCompetingOverlayVisible()) {
        // Check again calmly after 20s if an onboarding tour or modal was open
        retryTimer = window.setTimeout(tryShow, 20_000);
        return;
      }
      setVisible(true);
    };

    const initialTimer = window.setTimeout(tryShow, INITIAL_DWELL_MS);
    return () => {
      window.clearTimeout(initialTimer);
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [isInstalled, guideModalOpen, needsReinstallNotice]);

  const handleSnooze = (longSnooze = false) => {
    const prev = readPromptState();
    const nextDismissCount = prev.dismissCount + 1;
    // Escalate snooze gently if dismissed multiple times
    const duration =
      longSnooze || nextDismissCount >= 3 ? LONG_SNOOZE_MS : SHORT_SNOOZE_MS;
    writePromptState({
      snoozedUntil: Date.now() + duration,
      dismissCount: nextDismissCount,
    });
    setVisible(false);
  };

  const handleInstallClick = async () => {
    setVisible(false);
    const outcome = await triggerInstall();
    if (outcome === 'dismissed') {
      handleSnooze(false);
    } else if (outcome === 'guide_opened') {
      // Snooze briefly so closing the guide doesn't re-show the popup immediately
      const prev = readPromptState();
      writePromptState({
        snoozedUntil: Date.now() + SHORT_SNOOZE_MS,
        dismissCount: prev.dismissCount,
      });
    }
  };

  if (isInstalled) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          key="pwa-install-occasional-popup"
          role="region"
          aria-label="Install Jovibe Study app"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.96 }}
          animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-20 left-4 right-4 z-40 mx-auto max-w-[360px] md:bottom-6 md:left-auto md:right-6 md:mx-0"
        >
          <div className="relative overflow-hidden rounded-2xl border border-zinc-200/90 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 p-4 shadow-xl shadow-zinc-950/10 dark:shadow-black/50 backdrop-blur-md">
            {/* Subtle top accent shimmer */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-cyan-400/70 via-sky-500/80 to-indigo-500/70"
            />

            <button
              type="button"
              onClick={() => handleSnooze(false)}
              aria-label="Dismiss install prompt"
              className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <div className="flex items-start gap-3 pr-6">
              <div className="mt-0.5 shrink-0">
                <SotalLogo size="md" />
              </div>
              <div className="min-w-0 space-y-1">
                <h2 className="font-display text-sm font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
                  Install Jovibe Study
                </h2>
                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Add Jovibe Study to your device for full-screen focus, faster launch, and offline study with your cached library and chat history.
                </p>
              </div>
            </div>

            <div className="mt-3.5 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                <WifiOff className="h-3 w-3 text-sky-600 dark:text-sky-400 shrink-0" />
                <span>Offline study ready</span>
              </span>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleSnooze(false)}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  Later
                </button>
                <Button
                  size="sm"
                  onClick={() => void handleInstallClick()}
                  className="rounded-lg px-3"
                >
                  <Download className="h-3.5 w-3.5" />
                  {isInstallable ? 'Install app' : 'Install'}
                </Button>
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};
