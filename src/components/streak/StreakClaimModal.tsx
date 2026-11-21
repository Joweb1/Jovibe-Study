import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Loader2, X } from 'lucide-react';
import { FlameArt, type FlameVisualMode } from './FlameArt';

interface StreakClaimModalProps {
  open: boolean;
  targetStreak: number;
  activityTitle?: string;
  claiming: boolean;
  onClaim: () => Promise<void>;
  onDismiss: () => void;
}

type RevealStage = 'frozen' | 'cracking' | 'shattering' | 'revealed' | 'claimed_burst';

export const StreakClaimModal: React.FC<StreakClaimModalProps> = ({
  open,
  targetStreak,
  activityTitle,
  claiming,
  onClaim,
  onDismiss,
}) => {
  const reducedMotion = useReducedMotion();
  const [stage, setStage] = useState<RevealStage>('frozen');

  // Orchestrate the ice -> crack -> shatter -> 3D flame reveal sequence
  useEffect(() => {
    if (!open) {
      setStage('frozen');
      return;
    }

    if (reducedMotion) {
      setStage('revealed');
      return;
    }

    setStage('frozen');
    const t1 = window.setTimeout(() => setStage('cracking'), 420);
    const t2 = window.setTimeout(() => setStage('shattering'), 1050);
    const t3 = window.setTimeout(() => setStage('revealed'), 1600);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [open, reducedMotion]);

  const flameMode: FlameVisualMode =
    stage === 'frozen'
      ? 'frozen'
      : stage === 'cracking'
      ? 'cracking'
      : stage === 'shattering'
      ? 'shattering'
      : 'active';

  const isRevealed = stage === 'revealed' || stage === 'claimed_burst';

  const handleConfirmClick = async () => {
    if (claiming || stage === 'claimed_burst') return;
    setStage('claimed_burst');
    await onClaim();
  };

  const milestoneHeadline =
    targetStreak === 1
      ? 'Streak started'
      : targetStreak % 100 === 0
      ? `${targetStreak}-day century milestone`
      : targetStreak % 30 === 0
      ? `${targetStreak}-day streak milestone`
      : targetStreak % 7 === 0
      ? `${targetStreak / 7}-week streak unlocked`
      : 'Streak unlocked';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="streak-claim-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/65 dark:bg-black/75 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="streak-claim-title"
        >
          <motion.div
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-6 pb-6 pt-8 text-center shadow-2xl"
          >
            {/* Subtle top fire rim */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 via-orange-500 to-red-500"
            />

            {/* Discreet close button (keeps streak pending so user can still claim anytime today) */}
            {!claiming && stage !== 'claimed_burst' && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Close streak modal"
                className="absolute right-3.5 top-3.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            {/* Animated Centerpiece: Frozen -> Cracks -> Shatter -> 3D Flame */}
            <div className="flex flex-col items-center justify-center pt-1">
              <FlameArt
                mode={flameMode}
                size="xl"
                bursting={stage === 'claimed_burst' || stage === 'shattering'}
              />

              {/* Streak Count Reveal */}
              <motion.div
                initial={false}
                animate={
                  isRevealed
                    ? { opacity: 1, y: 0, scale: 1 }
                    : { opacity: 0.3, y: 8, scale: 0.92 }
                }
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="mt-4"
              >
                <div className="font-display text-5xl font-bold tracking-tight tabular-nums bg-gradient-to-b from-amber-500 via-orange-500 to-red-600 bg-clip-text text-transparent">
                  {targetStreak}
                </div>
                <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                  {targetStreak === 1 ? 'Day streak' : 'Day streak'}
                </p>
              </motion.div>

              {/* Title & Encouraging Message */}
              <motion.div
                initial={false}
                animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0.5, y: 4 }}
                transition={{ duration: 0.3, delay: 0.05 }}
                className="mt-4 space-y-1.5"
              >
                <h2
                  id="streak-claim-title"
                  className="font-display text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100"
                >
                  {stage === 'frozen'
                    ? 'Breaking the ice...'
                    : stage === 'cracking'
                    ? 'Igniting your streak...'
                    : milestoneHeadline}
                </h2>
                <p className="mx-auto max-w-[34ch] text-sm text-zinc-600 dark:text-zinc-400">
                  {isRevealed
                    ? 'You studied today! Keep your momentum going one focused session at a time.'
                    : 'Your study session qualified for today.'}
                </p>
                {activityTitle && isRevealed && (
                  <p className="mx-auto max-w-[36ch] truncate pt-1 text-xs text-zinc-500 dark:text-zinc-500">
                    Completed: {activityTitle}
                  </p>
                )}
              </motion.div>
            </div>

            {/* Primary Claim CTA */}
            <div className="mt-7">
              <button
                type="button"
                disabled={!isRevealed || claiming}
                onClick={() => void handleConfirmClick()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 via-amber-500 to-red-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(249,115,22,0.34)] hover:brightness-105 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                {claiming ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Claiming streak...
                  </>
                ) : stage === 'claimed_burst' ? (
                  <>
                    <Check className="h-4 w-4" />
                    Streak claimed
                  </>
                ) : (
                  'Claim Your Streak'
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
