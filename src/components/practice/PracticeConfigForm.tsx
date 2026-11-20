import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { DifficultyLevel, Topic } from '../../types/models';
import { Button } from '../ui/Button';

export interface PracticeConfig {
  topicIds: string[];
  difficulty: DifficultyLevel;
  count: number;
  customInstructions: string;
  cbtMode?: 'practice' | 'exam';
  examMinutes?: number;
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
  const [examMinutes, setExamMinutes] = useState<number>(15);

  const toggleTopic = (id: string) => {
    setSelectedTopicIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStart({
      topicIds: selectedTopicIds,
      difficulty,
      count,
      customInstructions: customInstructions.trim(),
      cbtMode: showCbtModeOptions ? cbtMode : undefined,
      examMinutes: showCbtModeOptions && cbtMode === 'exam' ? examMinutes : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3 border-b border-zinc-200 pb-5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Practice"
          title="Back to Practice"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-2xs hover:border-zinc-400 hover:bg-zinc-50 active:scale-95 transition-all cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold tracking-tight text-zinc-950">
            {title}
          </h2>
        </div>
      </div>

      {sourcesCount === 0 && (
        <div className="rounded-md border border-zinc-300 bg-zinc-50 px-4 py-3 text-xs text-zinc-700">
          This course currently has 0 uploaded sources in Library. Upload lecture notes, PDFs, or
          slides first so generated practice items are grounded in your syllabus.
        </div>
      )}

      {/* Topic scope */}
      {topics.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-900">Topic scope</span>
            <span className="text-xs text-zinc-500">
              {selectedTopicIds.length === 0
                ? 'Entire course'
                : `${selectedTopicIds.length} selected`}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedTopicIds([])}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                selectedTopicIds.length === 0
                  ? 'border-zinc-950 bg-zinc-950 text-white font-medium'
                  : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500'
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
                  className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    active
                      ? 'border-zinc-950 bg-zinc-950 text-white font-medium'
                      : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500'
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-zinc-900 mb-1.5">Test mode</label>
            <select
              value={cbtMode}
              onChange={(e) => setCbtMode(e.target.value as 'practice' | 'exam')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
            >
              <option value="practice">Practice Mode (immediate feedback)</option>
              <option value="exam">Exam Mode (timed, hidden answers until submit)</option>
            </select>
          </div>

          {cbtMode === 'exam' && (
            <div>
              <label className="block text-xs font-medium text-zinc-900 mb-1.5">
                Time limit (minutes)
              </label>
              <input
                type="number"
                min={3}
                max={120}
                value={examMinutes}
                onChange={(e) => setExamMinutes(Math.min(120, Math.max(3, Number(e.target.value) || 15)))}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 tabular-nums focus:border-zinc-950 focus:outline-none"
              />
            </div>
          )}
        </div>
      )}

      {/* Count & Difficulty */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-zinc-900 mb-1.5">
            {itemLabel} ({count})
          </label>
          <input
            type="range"
            min={minCount}
            max={maxCount}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full accent-zinc-950 cursor-pointer"
          />
          <div className="flex justify-between font-mono text-[11px] text-zinc-400 tabular-nums">
            <span>{minCount}</span>
            <span>{maxCount}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-900 mb-1.5">Difficulty</label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as DifficultyLevel)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
          >
            <option value="foundational">Foundational</option>
            <option value="standard">Standard</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-900 mb-1.5">
          Custom focus instructions (optional)
        </label>
        <textarea
          rows={2}
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          maxLength={600}
          placeholder="e.g., Focus on formulas, edge cases, or comparisons between Chapter 2 and Chapter 3."
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-950 focus:outline-none"
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
