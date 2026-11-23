import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  Cloud,
  Cpu,
  ExternalLink,
  KeyRound,
  Layers,
  Mic,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useRouter } from '../../router/RouterContext';
import {
  subscribeApiKeyLimitReached,
  type ApiKeyLimitEvent,
} from '../../services/ai/keyLimitBus';
import { PROVIDERS } from '../../services/ai/providers';
import { Button } from '../ui/Button';

interface ProviderQuickLink {
  id: 'gemini' | 'openrouter' | 'cerebras' | 'groq' | 'cloudflare' | 'nvidia_nim';
  title: string;
  subtitle: string;
  cta: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeClass: string;
  borderHoverClass: string;
  ctaClass: string;
}

const PROVIDER_QUICK_LINKS: ProviderQuickLink[] = [
  {
    id: 'gemini',
    title: 'Another Google Account (Gemini)',
    subtitle: 'Create a key with a 2nd Google account for fresh quota & automatic rotation.',
    cta: 'Google AI Studio',
    url: PROVIDERS.gemini.docsUrl,
    icon: Sparkles,
    badgeClass:
      'bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sm shadow-sky-500/25',
    borderHoverClass:
      'hover:border-sky-300 dark:hover:border-sky-700/80 hover:bg-sky-50/50 dark:hover:bg-sky-950/25',
    ctaClass: 'text-sky-700 dark:text-sky-400',
  },
  {
    id: 'openrouter',
    title: 'OpenRouter',
    subtitle: '2nd fallback for chat, practice, automatic study & vision OCR.',
    cta: 'Get OpenRouter key',
    url: PROVIDERS.openrouter.docsUrl,
    icon: Layers,
    badgeClass:
      'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm shadow-amber-500/25',
    borderHoverClass:
      'hover:border-amber-300 dark:hover:border-amber-700/80 hover:bg-amber-50/50 dark:hover:bg-amber-950/25',
    ctaClass: 'text-amber-700 dark:text-amber-400',
  },
  {
    id: 'cerebras',
    title: 'Cerebras',
    subtitle: 'Blazing-fast fallback for AI Tutor, Practice & Automatic Study.',
    cta: 'Get Cerebras key',
    url: PROVIDERS.cerebras.docsUrl,
    icon: Zap,
    badgeClass:
      'bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-sm shadow-violet-500/25',
    borderHoverClass:
      'hover:border-violet-300 dark:hover:border-violet-700/80 hover:bg-violet-50/50 dark:hover:bg-violet-950/25',
    ctaClass: 'text-violet-700 dark:text-violet-400',
  },
  {
    id: 'groq',
    title: 'Groq',
    subtitle: 'Ultra-fast speech playback (TTS), transcription, chat & practice fallback.',
    cta: 'Get Groq key',
    url: PROVIDERS.groq.docsUrl,
    icon: Mic,
    badgeClass:
      'bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-sm shadow-rose-500/25',
    borderHoverClass:
      'hover:border-rose-300 dark:hover:border-rose-700/80 hover:bg-rose-50/50 dark:hover:bg-rose-950/25',
    ctaClass: 'text-rose-700 dark:text-rose-400',
  },
  {
    id: 'cloudflare',
    title: 'Cloudflare Workers AI',
    subtitle: 'Fast edge REST API fallback (format: ACCOUNT_ID:API_TOKEN).',
    cta: 'Workers AI docs',
    url: PROVIDERS.cloudflare.docsUrl,
    icon: Cloud,
    badgeClass:
      'bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-sm shadow-orange-500/25',
    borderHoverClass:
      'hover:border-orange-300 dark:hover:border-orange-700/80 hover:bg-orange-50/50 dark:hover:bg-orange-950/25',
    ctaClass: 'text-orange-700 dark:text-orange-400',
  },
  {
    id: 'nvidia_nim',
    title: 'NVIDIA NIM',
    subtitle: 'Last-resort fallback for chat, OCR, quizzes & transcription.',
    cta: 'Get NIM key',
    url: PROVIDERS.nvidia_nim.docsUrl,
    icon: Cpu,
    badgeClass:
      'bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-sm shadow-emerald-500/25',
    borderHoverClass:
      'hover:border-emerald-300 dark:hover:border-emerald-700/80 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/25',
    ctaClass: 'text-emerald-700 dark:text-emerald-400',
  },
];

/**
 * Smooth, colorful orbital graphic illustrating multi-key / multi-provider recharge.
 */
const AnimatedLimitGraphic: React.FC = () => (
  <div
    aria-hidden="true"
    className="relative flex h-32 w-full items-center justify-center overflow-hidden bg-gradient-to-br from-sky-50 via-violet-50/75 to-amber-50/90 dark:from-sky-950/50 dark:via-violet-950/40 dark:to-amber-950/35"
  >
    {/* Soft ambient radial color blooms */}
    <motion.div
      animate={{ scale: [1, 1.14, 1], opacity: [0.45, 0.7, 0.45] }}
      transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
      className="pointer-events-none absolute -left-8 -top-8 h-36 w-36 rounded-full bg-sky-400/25 blur-2xl dark:bg-sky-500/20"
    />
    <motion.div
      animate={{ scale: [1.08, 0.96, 1.08], opacity: [0.4, 0.65, 0.4] }}
      transition={{ duration: 5.4, repeat: Infinity, ease: 'easeInOut' }}
      className="pointer-events-none absolute -bottom-10 right-2 h-40 w-40 rounded-full bg-amber-400/25 blur-2xl dark:bg-amber-500/20"
    />
    <motion.div
      animate={{ scale: [0.96, 1.1, 0.96], opacity: [0.35, 0.6, 0.35] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      className="pointer-events-none absolute top-2 right-1/3 h-28 w-28 rounded-full bg-violet-400/25 blur-2xl dark:bg-violet-500/20"
    />

    {/* Smoothly rotating orbital ring with 5 colorful provider nodes */}
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
      className="relative h-24 w-24 rounded-full border border-dashed border-zinc-400/40 dark:border-zinc-500/35"
    >
      {/* Sky - Gemini */}
      <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 ring-2 ring-white dark:ring-zinc-900 shadow-sm" />
      {/* Emerald - NVIDIA NIM */}
      <span className="absolute top-[28%] -right-1.5 h-3.5 w-3.5 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 ring-2 ring-white dark:ring-zinc-900 shadow-sm" />
      {/* Violet - Cerebras */}
      <span className="absolute bottom-[6%] right-[12%] h-3.5 w-3.5 rounded-full bg-gradient-to-br from-violet-400 to-purple-600 ring-2 ring-white dark:ring-zinc-900 shadow-sm" />
      {/* Amber - OpenRouter */}
      <span className="absolute bottom-[6%] left-[12%] h-3.5 w-3.5 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 ring-2 ring-white dark:ring-zinc-900 shadow-sm" />
      {/* Rose - Groq */}
      <span className="absolute top-[28%] -left-1.5 h-3.5 w-3.5 rounded-full bg-gradient-to-br from-rose-400 to-pink-600 ring-2 ring-white dark:ring-zinc-900 shadow-sm" />
    </motion.div>

    {/* Gentle breathing central glowing key emblem */}
    <motion.div
      animate={{ scale: [1, 1.06, 1], y: [0, -2, 0] }}
      transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      className="absolute flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 via-violet-500 to-amber-500 p-[2px] shadow-lg shadow-violet-500/20"
    >
      <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-white/95 dark:bg-zinc-950/95">
        <KeyRound className="h-6 w-6 text-violet-600 dark:text-sky-400" />
      </div>
    </motion.div>
  </div>
);

export const ApiKeyLimitModal: React.FC = () => {
  const { navigate } = useRouter();
  const [limitEvent, setLimitEvent] = useState<ApiKeyLimitEvent | null>(null);

  useEffect(() => {
    return subscribeApiKeyLimitReached((event) => {
      setLimitEvent(event);
    });
  }, []);

  useEffect(() => {
    if (!limitEvent) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLimitEvent(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [limitEvent]);

  const handleOpenSettings = () => {
    setLimitEvent(null);
    navigate('/settings');
  };

  return (
    <AnimatePresence>
      {limitEvent && (
        <motion.div
          key="api-key-limit-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => setLimitEvent(null)}
          className="fixed inset-0 z-[85] flex items-center justify-center bg-zinc-950/60 p-3 sm:p-4 backdrop-blur-[3px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="api-key-limit-title"
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200/90 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl"
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => setLimitEvent(null)}
              aria-label="Close API key limit notice"
              className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/85 dark:bg-zinc-900/85 text-zinc-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-100 shadow-sm backdrop-blur transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Colorful smooth animated top graphic */}
            <div className="shrink-0 border-b border-zinc-200/70 dark:border-zinc-800">
              <AnimatedLimitGraphic />
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-4">
              <div className="text-center space-y-1.5">
                <h2
                  id="api-key-limit-title"
                  className="font-display text-lg sm:text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100"
                >
                  {limitEvent.reason === 'free_trial_expired'
                    ? 'Your 7-day free AI access has expired'
                    : limitEvent.reason === 'shared_quota_exhausted'
                    ? 'Daily shared AI quota reached'
                    : 'Your API key reached its limit'}
                </h2>
                <p className="text-xs sm:text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {limitEvent.reason === 'free_trial_expired'
                    ? 'Add your own free API key in Settings to continue using AI Tutor, Automatic Study, Practice, and Live Voice AI without interruption.'
                    : limitEvent.reason === 'shared_quota_exhausted'
                    ? limitEvent.message ||
                      'You have used all of your shared AI requests for today (resets at 12:00 AM WAT / Africa/Lagos). Add your own free API key in Settings to continue right away.'
                    : 'Add another Gemini API key from a different Google account, or grab a free fallback key from any provider below so SOTAL rotates automatically.'}
                </p>
                {limitEvent.reason === 'shared_quota_exhausted' && limitEvent.quota && (
                  <div className="mt-2 inline-flex flex-wrap items-center justify-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200 font-mono tabular-nums">
                    <span>
                      {limitEvent.quota.used}/{limitEvent.quota.limit} requests used ·{' '}
                      {limitEvent.quota.remaining} remaining
                    </span>
                    {limitEvent.quota.resetLabel && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{limitEvent.quota.resetLabel}</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Colorful provider direct links */}
              <div className="space-y-2">
                {PROVIDER_QUICK_LINKS.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <motion.a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.2,
                        delay: 0.04 * idx,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className={`group flex items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 px-3.5 py-2.5 transition-all ${item.borderHoverClass}`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.badgeClass}`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                            {item.title}
                          </div>
                          <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {item.subtitle}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${item.ctaClass} group-hover:translate-x-0.5 transition-transform`}
                      >
                        {item.cta}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </span>
                    </motion.a>
                  );
                })}
              </div>

              <p className="text-center text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {limitEvent.reason === 'free_trial_expired'
                  ? 'Shared keys are disabled once your 7-day free access ends. Your personal keys are stored locally on your device.'
                  : limitEvent.reason === 'shared_quota_exhausted'
                  ? 'Personal API keys bypass shared daily limits and stay stored privately on your device.'
                  : 'Personal key mode is active — SOTAL will not switch back to the app’s default key once you add your own.'}
              </p>
            </div>

            {/* Footer actions */}
            <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 px-5 sm:px-6 py-3.5">
              <button
                type="button"
                onClick={() => setLimitEvent(null)}
                className="inline-flex h-9 items-center justify-center rounded-md px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
              >
                Close
              </button>
              <Button type="button" onClick={handleOpenSettings}>
                Open Settings to add key
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
