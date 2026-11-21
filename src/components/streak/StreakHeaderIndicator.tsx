import React from 'react';
import { useStreak } from '../../context/StreakContext';
import { useRouter } from '../../router/RouterContext';
import { MiniFlameIcon } from './FlameArt';

/**
 * Compact, high-contrast clickable streak indicator placed in the global header
 * (visible on Courses, Library, Shared Library, Practice).
 * Navigates to the dedicated Streak Details page (/streak) — or opens the pending claim modal if unclaimed today.
 * STRICT: Never displays freeze inventory or freeze counts.
 */
export const StreakHeaderIndicator: React.FC = () => {
  const { currentStreak, studiedToday, hasPendingClaimToday, pendingStreakCount, openPendingClaimModal } =
    useStreak();
  const { navigate } = useRouter();

  const displayCount = hasPendingClaimToday ? pendingStreakCount : currentStreak;
  const isLit = studiedToday || currentStreak > 0 || hasPendingClaimToday;

  const handleClick = () => {
    if (hasPendingClaimToday) {
      openPendingClaimModal();
      return;
    }
    navigate('/streak');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={
        hasPendingClaimToday
          ? `Claim your ${pendingStreakCount}-day streak`
          : `Study streak: ${currentStreak} ${currentStreak === 1 ? 'day' : 'days'}. Open streak details.`
      }
      title={
        hasPendingClaimToday
          ? 'Tap to claim today’s streak'
          : `${currentStreak}-day study streak`
      }
      className={`group relative inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold tabular-nums transition-all cursor-pointer ${
        hasPendingClaimToday
          ? 'border-orange-400/80 dark:border-orange-500/70 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 shadow-[0_0_12px_rgba(249,115,22,0.22)]'
          : isLit
          ? 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 hover:border-orange-300 dark:hover:border-orange-700'
          : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-500'
      }`}
    >
      <MiniFlameIcon active={isLit} className="h-4 w-4 shrink-0" />
      <span className="font-mono">{displayCount}</span>
      {hasPendingClaimToday && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-ping"
        />
      )}
    </button>
  );
};
