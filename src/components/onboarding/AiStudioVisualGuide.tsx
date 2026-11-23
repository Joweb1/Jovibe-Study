import React from 'react';
import { ArrowRight, Check, Copy, ExternalLink, KeyRound, Plus } from 'lucide-react';

/**
 * Clean, honest schematic illustration of the 3 visual steps to obtain a Gemini API key
 * from Google AI Studio and paste it into SOTAL Settings.
 * Designed as an instructional diagram rather than a fabricated screenshot so it never
 * misleads users as Google AI Studio's interface evolves.
 */
export const AiStudioVisualGuide: React.FC = () => {
  return (
    <figure
      aria-label="Visual walkthrough showing how to create and copy a Gemini API key in Google AI Studio and paste it into Jovibe Settings"
      className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/60 p-3.5 sm:p-4"
    >
      <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-zinc-200/80 dark:border-zinc-800">
        <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
          Visual guide · Google AI Studio → Jovibe
        </span>
        <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-500">
          aistudio.google.com/app/apikey
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {/* Stage 1: Create Key in AI Studio */}
        <div className="flex flex-col justify-between rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3">
          <div>
            <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              <span>1. AI Studio</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </div>
            <div className="mt-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-zinc-700 dark:text-zinc-300">
                  API keys
                </span>
                <span className="h-1.5 w-8 rounded-full bg-zinc-200 dark:bg-zinc-800" />
              </div>
              <div className="inline-flex items-center gap-1 rounded bg-zinc-950 dark:bg-zinc-100 px-2 py-1 text-[10px] font-medium text-white dark:text-zinc-950 ring-2 ring-sky-500/45 ring-offset-1 ring-offset-zinc-50 dark:ring-offset-zinc-900">
                <Plus className="h-2.5 w-2.5" />
                Create API key
              </div>
            </div>
          </div>
          <p className="mt-2.5 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
            Sign in with Google and click <strong className="font-medium text-zinc-900 dark:text-zinc-200">Create API key</strong>.
          </p>
        </div>

        {/* Stage 2: Copy Generated Key */}
        <div className="flex flex-col justify-between rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3">
          <div>
            <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              <span>2. Copy key</span>
              <Copy className="h-3 w-3 shrink-0" />
            </div>
            <div className="mt-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-2 space-y-2">
              <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Generated key</div>
              <div className="flex items-center justify-between gap-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1">
                <span className="font-mono text-[10px] text-zinc-800 dark:text-zinc-200 truncate">
                  AIzaSy•••••••9kQ
                </span>
                <span className="inline-flex items-center gap-0.5 rounded bg-sky-600 dark:bg-sky-500 px-1.5 py-0.5 text-[9px] font-medium text-white shrink-0">
                  <Copy className="h-2.5 w-2.5" />
                  Copy
                </span>
              </div>
            </div>
          </div>
          <p className="mt-2.5 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
            Copy the full key starting with <span className="font-mono text-zinc-900 dark:text-zinc-200">AIza</span>.
          </p>
        </div>

        {/* Stage 3: Paste & Save in Jovibe */}
        <div className="flex flex-col justify-between rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3">
          <div>
            <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              <span>3. Save in Jovibe</span>
              <KeyRound className="h-3 w-3 shrink-0" />
            </div>
            <div className="mt-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-2 space-y-2">
              <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Jovibe Settings</div>
              <div className="flex items-center gap-1">
                <span className="flex-1 truncate rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-1.5 py-1 font-mono text-[10px] text-zinc-700 dark:text-zinc-300">
                  ••••••••••••
                </span>
                <span className="inline-flex items-center gap-0.5 rounded bg-zinc-950 dark:bg-zinc-200 px-1.5 py-1 text-[10px] font-medium text-white dark:text-zinc-950 shrink-0">
                  <Check className="h-2.5 w-2.5" />
                  Add
                </span>
              </div>
            </div>
          </div>
          <p className="mt-2.5 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
            Return here, paste into the Gemini key field, and click <strong className="font-medium text-zinc-900 dark:text-zinc-200">Add</strong>.
          </p>
        </div>
      </div>

      <figcaption className="mt-2.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <ArrowRight className="h-3 w-3 shrink-0 text-zinc-400 dark:text-zinc-500" />
        <span>
          Your progress stays saved automatically even if you leave Jovibe or reload while creating your key.
        </span>
      </figcaption>
    </figure>
  );
};
