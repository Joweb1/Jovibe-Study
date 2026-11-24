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
        onClick={handleStartStudying}
        className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/60 p-3 sm:p-4 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="free-access-welcome-title"
      >
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 360, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl"
        >
          <button
            type="button"
            onClick={handleStartStudying}
            aria-label="Close welcome notice"
            className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/70 px-5 py-4 pr-11">
            <div className="flex items-center gap-2.5">
              <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950">
                <Sparkles className="h-4 w-4" />
              </div>
              <h2
                id="free-access-welcome-title"
                className="font-display text-base sm:text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-100"
              >
                {status.freeAccess.daysTotal} Days of Free AI Access
              </h2>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Start using AI Tutor, Study, CBT, Flashcards, and Live voice right away with shared keys.
            </p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-2.5 text-sm">
            <div className="flex items-start gap-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 p-2.5">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-700 dark:text-zinc-300" />
              <div className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                  {status.freeAccess.daysRemaining} day{status.freeAccess.daysRemaining === 1 ? '' : 's'} left · {status.quota.limit} requests/day
                </div>
                <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                  Expires {expiresDate}. Resets daily at 12:00 AM (Africa/Lagos).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 p-2.5">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-zinc-700 dark:text-zinc-300" />
              <div className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                <p className="text-zinc-600 dark:text-zinc-400">
                  After {status.freeAccess.daysTotal} days, add your own free Gemini API key in <strong>Settings</strong> to continue without shared limits.
                </p>
              </div>
            </div>
          </div>

          <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 px-5 py-3">
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
