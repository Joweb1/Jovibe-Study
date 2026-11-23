import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, KeyRound, Sparkles, X } from 'lucide-react';
import { usePlatformAccess } from '../../context/PlatformAccessContext';
import { useRouter } from '../../router/RouterContext';
import { Button } from '../ui/Button';

export const FreeAccessWelcomeModal: React.FC = () => {
  const { status, usingPersonalKey, acknowledgeFreeAccessNotice } = usePlatformAccess();
  const { navigate } = useRouter();

  const shouldShow =
    Boolean(status) &&
    status!.accountStatus === 'active' &&
    !status!.freeAccess.firstLoginNoticeSeen &&
    status!.freeAccess.active &&
    !usingPersonalKey;

  if (!shouldShow || !status) return null;

  const expiresDate = new Date(status.freeAccess.expiresAtMs).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const handleStartStudying = () => {
    void acknowledgeFreeAccessNotice();
  };

  const handleAddKeyNow = () => {
    void acknowledgeFreeAccessNotice();
    navigate('/settings');
  };

  return (
    <AnimatePresence>
      <motion.div
        key="free-access-welcome-modal"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="free-access-welcome-title"
      >
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 360, damping: 28 }}
          className="relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl"
        >
          <button
            type="button"
            onClick={handleStartStudying}
            aria-label="Close welcome notice"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/70 px-6 py-5">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 mb-3">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2
              id="free-access-welcome-title"
              className="font-display text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-100"
            >
              Welcome! You have {status.freeAccess.daysTotal} Days of Free AI Access
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Start studying right away with AI Tutor, Automatic Study, Practice CBT, Flashcards, and Jovibe Live using our shared AI keys.
            </p>
          </div>

          <div className="px-6 py-5 space-y-3.5 text-sm">
            <div className="flex items-start gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 p-3">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-700 dark:text-zinc-300" />
              <div className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                  {status.freeAccess.daysRemaining} day{status.freeAccess.daysRemaining === 1 ? '' : 's'} remaining · Expires {expiresDate}
                </div>
                <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                  Includes up to <strong className="font-mono text-zinc-900 dark:text-zinc-200">{status.quota.limit} AI requests/day</strong> (resets daily at 12:00 AM Nigerian time / Africa/Lagos).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 p-3">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-zinc-700 dark:text-zinc-300" />
              <div className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                  What happens after {status.freeAccess.daysTotal} days?
                </div>
                <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                  Shared AI access expires automatically. You&apos;ll simply add your own free API key (such as Google Gemini from AI Studio) in <strong>Settings</strong> to keep using all AI features without shared daily limits.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 px-6 py-3.5">
            <Button type="button" variant="secondary" size="sm" onClick={handleAddKeyNow}>
              Add my own API key
            </Button>
            <Button type="button" size="sm" onClick={handleStartStudying}>
              Start studying free
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
