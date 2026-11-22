import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  getActiveAiActivity,
  subscribeAiActivity,
  type AiActivityEvent,
} from '../../services/ai/aiActivityBus';

interface AiModelStatusBadgeProps {
  headerHidden?: boolean;
  hidden?: boolean;
}

/**
 * Ultra-subtle, non-interactive indicator showing which AI provider/model is
 * currently serving an active operation, updating live mid-run when keys rotate
 * or a fallback provider takes over.
 */
export const AiModelStatusBadge: React.FC<AiModelStatusBadgeProps> = ({
  headerHidden = false,
  hidden = false,
}) => {
  const [activity, setActivity] = useState<AiActivityEvent | null>(() => getActiveAiActivity());

  useEffect(() => {
    return subscribeAiActivity(setActivity);
  }, []);

  const visible = !hidden && Boolean(activity);
  const isSwitching = activity?.status === 'switching';
  const isCompleted = activity?.status === 'completed';
  const isFallback = Boolean(activity?.isFallback);

  const dotClass = isCompleted
    ? isFallback
      ? 'bg-amber-500/80'
      : 'bg-emerald-500/80'
    : isSwitching || isFallback
    ? 'bg-amber-500 animate-pulse'
    : 'bg-zinc-400 dark:bg-zinc-500 animate-pulse';

  const displayKey = activity
    ? `${activity.provider}:${activity.model}:${activity.status}:${activity.isFallback ? 'fb' : 'p'}:${activity.keyLabel}`
    : 'idle';

  const showModel =
    activity &&
    activity.model &&
    activity.model.toLowerCase() !== activity.providerLabel.toLowerCase();

  return (
    <AnimatePresence>
      {visible && activity && (
        <motion.div
          key="ai-model-status-chip"
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          role="status"
          aria-live="polite"
          className={`pointer-events-none fixed left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)] ${
            headerHidden ? 'top-2.5' : 'top-[62px]'
          }`}
        >
          <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/75 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-950/80 px-2.5 py-1 text-[11px] leading-none text-zinc-500 dark:text-zinc-400 shadow-xs backdrop-blur-md">
            <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />

            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={displayKey}
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.14 }}
                className="inline-flex items-center gap-1.5 truncate max-w-[260px] sm:max-w-[360px]"
              >
                {isSwitching ? (
                  <span className="truncate text-amber-700/90 dark:text-amber-300/90">
                    {activity.note || 'Switching model…'}
                  </span>
                ) : (
                  <>
                    {isFallback && (
                      <span className="shrink-0 font-medium text-amber-700/90 dark:text-amber-300/90">
                        Fallback
                      </span>
                    )}
                    {isFallback && (
                      <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                        ·
                      </span>
                    )}
                    <span className="shrink-0 font-medium text-zinc-700 dark:text-zinc-300">
                      {activity.providerLabel}
                    </span>
                    {showModel && (
                      <>
                        <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                          ·
                        </span>
                        <span className="truncate font-mono text-[10.5px] text-zinc-500 dark:text-zinc-400">
                          {activity.model}
                        </span>
                      </>
                    )}
                    {isFallback && activity.keySource === 'byok' && activity.keyLabel && (
                      <>
                        <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                          ·
                        </span>
                        <span className="truncate text-[10.5px] text-zinc-400 dark:text-zinc-500">
                          {activity.keyLabel}
                        </span>
                      </>
                    )}
                  </>
                )}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
