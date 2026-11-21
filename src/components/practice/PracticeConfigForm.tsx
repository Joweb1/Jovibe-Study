import React, { useState } from 'react';
import { ArrowLeft, Clock } from 'lucide-react';
import type { DifficultyLevel, Topic } from '../../types/models';
import { TIMER_PRESETS_MINUTES } from '../../hooks/usePersistentTimer';
import { Button } from '../ui/Button';

export interface PracticeConfig {
  topicIds: string[];
  difficulty: DifficultyLevel;
  count: number;
  customInstructions: string;
  cbtMode?: 'practice' | 'exam';
  examMinutes?: number;
  /** 0 means untimed; > 0 enables a non-bypassable countdown timer in minutes */
  timeLimitMinutes: number;
}

interface PracticeConfigFormProps {
  title: string;
  topics: Topic[];
  sourcesCount: number;
  defaultDifficulty: DifficultyLevel;
  itemLabel: string;
  defaultCount: number;
  minCount: number;
  maxCount: number;
  showCbtModeOptions?: boolean;
  loading: boolean;
  submitLabel: string;
  onBack: () => void;
  onStart: (config: PracticeConfig) => void;
}

export const PracticeConfigForm: React.FC<PracticeConfigFormProps> = ({
  title,
  topics,
  sourcesCount,
  defaultDifficulty,
  itemLabel,
  defaultCount,
  minCount,
  maxCount,
  showCbtModeOptions = false,
  loading,
  submitLabel,
  onBack,
  onStart,
}) => {
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(defaultDifficulty);
  const [count, setCount] = useState<number>(defaultCount);
  const [customInstructions, setCustomInstructions] = useState('');
  const [cbtMode, setCbtMode] = useState<'practice' | 'exam'>('practice');
  const [timeLimitEnabled, setTimeLimitEnabled] = useState<boolean>(false);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>(15);
  const [customMinutesInput, setCustomMinutesInput] = useState<string>('15');

  const toggleTopic = (id: string) => {
    setSelectedTopicIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleCbtModeChange = (nextMode: 'practice' | 'exam') => {
    setCbtMode(nextMode);
    // Preserve Exam Mode's timed default while keeping Practice Mode untimed by default
    setTimeLimitEnabled(nextMode === 'exam');
  };

  const applyMinutes = (mins: number) => {
    const safe = Math.min(180, Math.max(1, Math.round(mins)));
    setTimeLimitMinutes(safe);
    setCustomMinutesInput(String(safe));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedCustom = parseInt(customMinutesInput, 10);
    const resolvedMinutes = timeLimitEnabled
      ? Math.min(180, Math.max(1, Number.isFinite(parsedCustom) ? parsedCustom : timeLimitMinutes))
      : 0;
    onStart({
      topicIds: selectedTopicIds,
      difficulty,
      count,
      customInstructions: customInstructions.trim(),
      cbtMode: showCbtModeOptions ? cbtMode : undefined,
      examMinutes: resolvedMinutes > 0 ? resolvedMinutes : undefined,
      timeLimitMinutes: resolvedMinutes,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Practice"
          title="Back to Practice"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 shadow-2xs hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 active:scale-95 transition-all cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
            {title}
          </h2>
        </div>
      </div>

      {sourcesCount === 0 && (
        <div className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-3 text-xs text-zinc-700 dark:text-zinc-300">
          This course currently has 0 uploaded sources in Library. Upload lecture notes, PDFs, or
          slides first so generated practice items are grounded in your syllabus.
        </div>
      )}

      {/* Topic scope */}
      {topics.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-900 dark:text-zinc-200">Topic scope</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {selectedTopicIds.length === 0
                ? 'Entire course'
                : `${selectedTopicIds.length} selected`}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedTopicIds([])}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
                selectedTopicIds.length === 0
                  ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950 font-medium'
                  : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-500'
              }`}
            >
              Entire course
            </button>
            {topics.map((t) => {
              const active = selectedTopicIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTopic(t.id)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
                    active
                      ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950 font-medium'
                      : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-500'
                  }`}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Mode options for CBT */}
      {showCbtModeOptions && (
        <div>
          <label className="block text-xs font-medium text-zinc-900 dark:text-zinc-200 mb-1.5">Test mode</label>
          <select
            value={cbtMode}
            onChange={(e) => handleCbtModeChange(e.target.value as 'practice' | 'exam')}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
          >
            <option value="practice">Practice Mode (immediate feedback)</option>
            <option value="exam">Exam Mode (timed by default, hidden answers until submit)</option>
          </select>
        </div>
      )}

      {/* Optional Session Timer (all practice modes) */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
            <span className="text-xs font-medium text-zinc-900 dark:text-zinc-200">
              Session time limit
            </span>
          </div>
          <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTimeLimitEnabled(false)}
              className={`rounded px-2.5 py-1 transition-colors cursor-pointer ${
                !timeLimitEnabled
                  ? 'bg-zinc-950 text-white dark:bg-zinc-200 dark:text-zinc-950 font-medium'
                  : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              Untimed
            </button>
            <button
              type="button"
              onClick={() => setTimeLimitEnabled(true)}
              className={`rounded px-2.5 py-1 transition-colors cursor-pointer ${
                timeLimitEnabled
                  ? 'bg-zinc-950 text-white dark:bg-zinc-200 dark:text-zinc-950 font-medium'
                  : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              Timed
            </button>
          </div>
        </div>

        {timeLimitEnabled ? (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {TIMER_PRESETS_MINUTES.map((preset) => {
                const selected = timeLimitMinutes === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyMinutes(preset)}
                    className={`rounded-md px-2.5 py-1 font-mono text-xs tabular-nums transition-colors cursor-pointer ${
                      selected
                        ? 'bg-zinc-950 text-white dark:bg-zinc-200 dark:text-zinc-950 font-medium'
                        : 'border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 hover:border-zinc-400 hover:text-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200'
                    }`}
                  >
                    {preset}m
                  </button>
                );
              })}
              <div className="flex items-center gap-1.5 ml-auto">
                <label
                  htmlFor="practice-custom-minutes"
                  className="text-xs text-zinc-500 dark:text-zinc-400"
                >
                  Custom:
                </label>
                <input
                  id="practice-custom-minutes"
                  type="number"
                  min={1}
                  max={180}
                  value={customMinutesInput}
                  onChange={(e) => {
                    setCustomMinutesInput(e.target.value);
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n) && n >= 1 && n <= 180) {
                      setTimeLimitMinutes(n);
                    }
                  }}
                  onBlur={() => {
                    const n = parseInt(customMinutesInput, 10);
                    applyMinutes(Number.isFinite(n) ? n : timeLimitMinutes);
                  }}
                  className="w-16 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-center font-mono text-xs tabular-nums text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">min</span>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Countdown cannot be paused once started and auto-submits your progress when time runs out.
            </p>
          </div>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Practice at your own pace with no countdown timer.
          </p>
        )}
      </div>

      {/* Count & Difficulty */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-zinc-900 dark:text-zinc-200 mb-1.5">
            {itemLabel} ({count})
          </label>
          <input
            type="range"
            min={minCount}
            max={maxCount}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full accent-zinc-950 dark:accent-zinc-200 cursor-pointer"
          />
          <div className="flex justify-between font-mono text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums">
            <span>{minCount}</span>
            <span>{maxCount}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-900 dark:text-zinc-200 mb-1.5">Difficulty</label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as DifficultyLevel)}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
          >
            <option value="foundational">Foundational</option>
            <option value="standard">Standard</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-900 dark:text-zinc-200 mb-1.5">
          Custom focus instructions (optional)
        </label>
        <textarea
          rows={2}
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          maxLength={600}
          placeholder="e.g., Focus on formulas, edge cases, or comparisons between Chapter 2 and Chapter 3."
          className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" loading={loading} disabled={sourcesCount === 0}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Cancel
        </Button>
      </div>
    </form>
  );
};
