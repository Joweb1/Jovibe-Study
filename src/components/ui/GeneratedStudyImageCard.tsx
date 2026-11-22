import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Download,
  HardDrive,
  Image as ImageIcon,
  Maximize2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';

export interface GeneratedStudyImageCardProps {
  imageUrl?: string | null;
  caption?: string;
  providerLabel?: string;
  loading?: boolean;
  error?: string | null;
  canGenerate?: boolean;
  isOnline?: boolean;
  onGenerate?: () => void;
  onRegenerate?: () => void;
  className?: string;
}

export const GeneratedStudyImageCard: React.FC<GeneratedStudyImageCardProps> = ({
  imageUrl,
  caption,
  providerLabel,
  loading = false,
  error = null,
  canGenerate = false,
  isOnline = true,
  onGenerate,
  onRegenerate,
  className = '',
}) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen]);

  const handleDownload = () => {
    if (!imageUrl) return;
    const slug = (caption || 'sotal-concept-visual')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `${slug || 'sotal-concept-visual'}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (loading) {
    return (
      <div
        className={`mt-4 max-w-xl overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 ${className}`}
      >
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900">
          <div className="absolute inset-0 animate-sotal-shimmer bg-gradient-to-r from-transparent via-white/50 dark:via-zinc-700/25 to-transparent" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-400 dark:text-zinc-500">
            <ImageIcon className="h-6 w-6 animate-pulse" />
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Generating concept visual...
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-zinc-200/80 dark:border-zinc-800/80 px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>Creating illustrative diagram for offline viewing</span>
          <RefreshCw className="h-3 w-3 animate-spin" />
        </div>
      </div>
    );
  }

  if (imageUrl) {
    return (
      <>
        <figure
          className={`mt-4 max-w-xl overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 ${className}`}
        >
          <div className="group relative bg-zinc-50 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="block w-full cursor-zoom-in focus:outline-none"
              aria-label="Expand concept visual"
            >
              <img
                src={imageUrl}
                alt={caption || 'Generated educational concept visual'}
                className="w-full max-h-[380px] object-contain bg-zinc-50 dark:bg-zinc-900"
                loading="lazy"
              />
            </button>
            <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                aria-label="Full screen"
                title="View larger"
                className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-950/75 text-white hover:bg-zinc-950 transition-colors cursor-pointer"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleDownload}
                aria-label="Download image"
                title="Download image"
                className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-950/75 text-white hover:bg-zinc-950 transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/80 dark:border-zinc-800/80 px-3 py-2 text-xs">
            <div className="min-w-0 flex-1 space-y-0.5">
              {caption && (
                <p className="text-zinc-700 dark:text-zinc-300 leading-snug line-clamp-2">
                  {caption}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                <span
                  className="inline-flex items-center gap-1"
                  title="Cached locally on this device only (never stored in the cloud). Clearing browser local storage removes cached visuals."
                >
                  <HardDrive className="h-3 w-3" />
                  Saved offline on device
                </span>
                {providerLabel && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{providerLabel}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                title="Download visual"
              >
                <Download className="h-3 w-3" />
                Save
              </button>
              {onRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={!isOnline}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title={isOnline ? 'Regenerate visual' : 'Reconnect to regenerate visual'}
                >
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </button>
              )}
            </div>
          </figcaption>
        </figure>

        {lightboxOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={caption || 'Concept visual preview'}
            onClick={() => setLightboxOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/85 p-4 backdrop-blur-xs"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[92vh] max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2.5 text-xs text-zinc-300">
                <span className="truncate font-medium">
                  {caption || 'Educational concept visual'}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </button>
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(false)}
                    aria-label="Close preview"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="overflow-auto p-3 flex items-center justify-center bg-zinc-900/60">
                <img
                  src={imageUrl}
                  alt={caption || 'Generated educational concept visual'}
                  className="max-h-[78vh] w-auto max-w-full rounded object-contain"
                />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (error) {
    const retryHandler = onRegenerate || onGenerate;
    return (
      <div
        className={`mt-3 max-w-xl flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 ${className}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="truncate">Visual could not be generated: {error}</span>
        </div>
        {retryHandler && (
          <button
            type="button"
            onClick={retryHandler}
            disabled={!isOnline}
            className="inline-flex items-center gap-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:border-zinc-500 cursor-pointer disabled:opacity-40"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        )}
      </div>
    );
  }

  if (canGenerate && onGenerate) {
    return (
      <div className={`mt-3 ${className}`}>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!isOnline}
          title={
            isOnline
              ? 'Generate an illustrative infographic for this unit (cached offline on device)'
              : 'Reconnect to generate concept visual'
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generate concept visual
        </button>
      </div>
    );
  }

  return null;
};
