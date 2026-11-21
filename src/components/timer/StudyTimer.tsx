import React, { useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Clock, Pause, Play, RotateCcw } from 'lucide-react';
import {
  formatCountdownSeconds,
  TIMER_PRESETS_MINUTES,
  usePersistentStudyTimer,
} from '../../hooks/usePersistentTimer';
import { Button } from '../ui/Button';

interface StudyTimerProps {
  storageKey?: string;
  defaultMinutes?: number;
  title?: string;
  compact?: boolean;
}

export const StudyTimer: React.FC<StudyTimerProps> = ({
  storageKey = 'sotal_study_timer_v1',
  defaultMinutes = 25,
  title = 'Study Timer',
  compact = false,
}) => {
  const timer = usePersistentStudyTimer(storageKey, defaultMinutes);
  const [customMinutes, setCustomMinutes] = useState(String(timer.durationMinutes));

  const isWarning =
    !timer.untimed &&
    timer.status !== 'idle' &&
    timer.remainingSeconds > 15 &&
    (timer.remainingSeconds <= 60 || timer.progressPercent >= 80);
  const isUrgent =
    !timer.untimed && timer.status === 'running' && timer.remainingSeconds <= 15;

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(customMinutes, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    const clamped = Math.min(180, Math.max(1, parsed));
    setCustomMinutes(String(clamped));
    timer.setDurationMinutes(clamped);
  };

  return (
    <div
      className={`rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 ${
        compact ? 'p-4' : 'p-5 sm:p-6'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock
            className={`h-4 w-4 ${
              isUrgent
                ? 'text-red-500'
                : isWarning
                ? 'text-amber-500'
                : 'text-zinc-700 dark:text-zinc-300'
            }`}
          />
          <h3 className="font-display text-sm font-semibold text-zinc-950 dark:text-zinc-200">
            {title}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => timer.setUntimedMode(!timer.untimed)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
            timer.untimed
              ? 'bg-zinc-950 text-white dark:bg-zinc-200 dark:text-zinc-950'
              : 'border border-zinc-200 dark:border-zinc-700 text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          {timer.untimed ? 'Untimed active' : 'Untimed'}
        </button>
      </div>

      {/* Main Digital Display */}
      <div className="mt-5 flex flex-col items-center text-center">
        {timer.status === 'completed' ? (
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center gap-2 py-2"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <div className="font-display text-2xl font-semibold text-zinc-950 dark:text-zinc-100">
              Time is up
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Your {timer.durationMinutes}-minute focus timer completed.
            </p>
          </motion.div>
        ) : (
          <>
            <div
              className={`font-mono text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums transition-colors ${
                isUrgent
                  ? 'text-red-600 dark:text-red-400'
                  : isWarning
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-zinc-950 dark:text-zinc-100'
              }`}
            >
              {timer.untimed
                ? formatCountdownSeconds(timer.elapsedUntimedSec)
                : formatCountdownSeconds(timer.remainingSeconds)}
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {timer.untimed
                ? timer.status === 'running'
                  ? 'Untimed session elapsed'
                  : timer.status === 'paused'
                  ? 'Untimed session paused'
                  : 'Study at your own pace'
                : timer.status === 'running'
                ? 'Remaining'
                : timer.status === 'paused'
                ? 'Paused'
                : `${timer.durationMinutes} min focus session`}
            </p>
          </>
        )}

        {/* Thin Progress Bar (Timed Mode Only) */}
        {!timer.untimed && (
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                timer.status === 'completed' || isUrgent
                  ? 'bg-red-500'
                  : isWarning
                  ? 'bg-amber-500'
                  : 'bg-gradient-to-r from-orange-500 to-amber-400'
              }`}
              style={{ width: `${timer.status === 'completed' ? 100 : timer.progressPercent}%` }}
            />
          </div>
        )}

        {/* Controls: Start / Pause / Resume / Reset */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {timer.status === 'idle' || timer.status === 'completed' ? (
            <Button size="sm" onClick={timer.start}>
              <Play className="h-3.5 w-3.5" />
              {timer.status === 'completed' ? 'Start again' : 'Start timer'}
            </Button>
          ) : timer.status === 'running' ? (
            <Button variant="secondary" size="sm" onClick={timer.pause}>
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          ) : (
            <Button size="sm" onClick={timer.resume}>
              <Play className="h-3.5 w-3.5" />
              Resume
            </Button>
          )}

          {timer.status !== 'idle' && (
            <Button variant="ghost" size="sm" onClick={timer.reset}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Presets & Custom Duration (when idle or completed and not untimed) */}
      {!timer.untimed && (timer.status === 'idle' || timer.status === 'completed') && (
        <div className="mt-5 space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-4">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {TIMER_PRESETS_MINUTES.map((preset) => {
              const selected = timer.durationMinutes === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    timer.setDurationMinutes(preset);
                    setCustomMinutes(String(preset));
                  }}
                  className={`rounded-md px-2.5 py-1 font-mono text-xs tabular-nums transition-colors cursor-pointer ${
                    selected
                      ? 'bg-zinc-950 text-white dark:bg-zinc-200 dark:text-zinc-950 font-medium'
                      : 'border border-zinc-200 dark:border-zinc-700 text-zinc-600 hover:border-zinc-400 hover:text-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200'
                  }`}
                >
                  {preset}m
                </button>
              );
            })}
          </div>

          <form onSubmit={handleApplyCustom} className="flex items-center justify-center gap-2">
            <label htmlFor={`${storageKey}-custom`} className="text-xs text-zinc-500 dark:text-zinc-400">
              Custom (min):
            </label>
            <input
              id={`${storageKey}-custom`}
              type="number"
              min={1}
              max={180}
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              className="w-16 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-center font-mono text-xs tabular-nums text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 transition-colors cursor-pointer"
            >
              Set
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

/**
 * Compact inline non-bypassable countdown badge for timed CBT & Practice sessions.
 */
export const ActiveSessionTimerBar: React.FC<{
  remainingSeconds: number;
  isWarning: boolean;
  isUrgent: boolean;
}> = ({ remainingSeconds, isWarning, isUrgent }) => {
  return (
    <span
      role="timer"
      aria-live="off"
      aria-label={`Time remaining ${formatCountdownSeconds(remainingSeconds)}`}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs font-semibold tabular-nums transition-colors ${
        isUrgent
          ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 animate-pulse'
          : isWarning
          ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
          : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200'
      }`}
    >
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>{formatCountdownSeconds(remainingSeconds)}</span>
    </span>
  );
};
