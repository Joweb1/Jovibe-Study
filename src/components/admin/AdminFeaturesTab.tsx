import React, { useState } from 'react';
import { Power, ShieldCheck } from 'lucide-react';
import type { PlatformFeatureFlags } from '../../context/PlatformAccessContext';
import { apiFetchJson } from '../../services/api/authHeaders';
import { FEATURE_LABELS } from './adminTypes';

interface AdminFeaturesTabProps {
  flags: PlatformFeatureFlags;
  onUpdated: (next: PlatformFeatureFlags) => void;
}

const FEATURE_DESCRIPTIONS: Record<keyof PlatformFeatureFlags['features'], string> = {
  live_voice_ai: 'Real-time conversational Gemini Live voice study companion (/live).',
  tutor: 'Course-grounded AI Tutor chat conversations (/tutor).',
  automatic_study: 'Adaptive sequential lesson plans, mini-lectures, and answer grading (/automatic-study).',
  practice_cbt: 'Multiple-choice Computer-Based Test (CBT) generation.',
  practice_flashcards: 'Active-recall flashcard deck generation.',
  practice_fill_gap: 'Fill-in-the-gap exercises and semantic answer grading.',
  practice_exam_prep: 'Oral Exam Prep questions and 10-point rubric evaluation.',
  vision_ocr: 'Multimodal Vision OCR for textbook photos, handwritten notes, and scanned PDFs.',
  tts: 'Text-to-speech audio narration for Automatic Study lessons and Tutor replies.',
  transcription: 'Voice-note audio recording transcription.',
  image_generation: 'Illustrative concept infographics and study visuals.',
};

export const AdminFeaturesTab: React.FC<AdminFeaturesTabProps> = ({ flags, onUpdated }) => {
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleGlobal = async () => {
    setSavingKey('global');
    setError(null);
    try {
      const next = await apiFetchJson<PlatformFeatureFlags>('/api/admin/feature-flags', {
        method: 'PUT',
        body: { aiGlobalEnabled: !flags.aiGlobalEnabled },
      });
      onUpdated(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update global AI setting.');
    } finally {
      setSavingKey(null);
    }
  };

  const toggleFeature = async (key: keyof PlatformFeatureFlags['features']) => {
    setSavingKey(key);
    setError(null);
    try {
      const next = await apiFetchJson<PlatformFeatureFlags>('/api/admin/feature-flags', {
        method: 'PUT',
        body: {
          features: {
            [key]: !flags.features[key],
          },
        },
      });
      onUpdated(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update feature toggle.');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Global AI Kill Switch */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                flags.aiGlobalEnabled
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
              }`}
            >
              <Power className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
                Global AI Functionality
              </h3>
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                Master switch enforced server-side across all AI routes and WebSocket bridges. Turning this off disables all AI features immediately while keeping courses and notes accessible.
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={flags.aiGlobalEnabled}
            disabled={savingKey !== null}
            onClick={() => void toggleGlobal()}
            className={`inline-flex min-h-10 max-w-full shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-center text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
              flags.aiGlobalEnabled
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            {flags.aiGlobalEnabled ? 'AI Enabled Globally' : 'AI Disabled Globally'}
          </button>
        </div>
      </div>

      {/* Individual Feature Toggles */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="border-b border-zinc-200 dark:border-zinc-800 px-5 py-3.5 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-zinc-500" />
          <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
            Individual AI Feature Controls
          </h3>
        </div>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {(Object.keys(FEATURE_DESCRIPTIONS) as Array<keyof PlatformFeatureFlags['features']>).map(
            (key) => {
              const enabled = Boolean(flags.features[key]);
              const effectivelyEnabled = flags.aiGlobalEnabled && enabled;
              return (
                <div
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-4 px-4 sm:px-5 py-3.5"
                >
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-zinc-950 dark:text-zinc-100">
                        {FEATURE_LABELS[key] || key}
                      </span>
                      {!flags.aiGlobalEnabled && (
                        <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                          Blocked by Global Off
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {FEATURE_DESCRIPTIONS[key]}
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`Toggle ${FEATURE_LABELS[key] || key}`}
                    disabled={savingKey !== null}
                    onClick={() => void toggleFeature(key)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                      effectivelyEnabled
                        ? 'bg-zinc-950 dark:bg-zinc-100'
                        : enabled
                        ? 'bg-zinc-400 dark:bg-zinc-600'
                        : 'bg-zinc-200 dark:bg-zinc-800'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                        enabled
                          ? 'translate-x-6 bg-white dark:bg-zinc-950'
                          : 'translate-x-1 bg-white dark:bg-zinc-400'
                      }`}
                    />
                  </button>
                </div>
              );
            }
          )}
        </div>
      </div>
    </div>
  );
};
