import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  FileSearch,
  HardDrive,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import type { BackgroundIngestionJob } from '../../context/BackgroundIngestionContext';
import {
  getActiveAiActivityForTask,
  subscribeAiActivity,
  type AiActivityEvent,
} from '../../services/ai/aiActivityBus';
import { MATERIAL_TYPE_LABELS } from '../../services/ingestion/structureParser';
import { Button } from '../ui/Button';

interface ProcessingSourceCardProps {
  job: BackgroundIngestionJob;
  topicName?: string | null;
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
  onReview?: (job: BackgroundIngestionJob) => void;
  onOpenSavedSource?: (sourceId: string, jobId: string) => void;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ProcessingSourceCard: React.FC<ProcessingSourceCardProps> = ({
  job,
  topicName,
  onCancel,
  onRetry,
  onDismiss,
  onReview,
  onOpenSavedSource,
}) => {
  const isRunning =
    job.status === 'queued' || job.status === 'extracting' || job.status === 'saving';
  const isCompleted = job.status === 'completed';
  const isReadyForReview = job.status === 'ready_for_review';
  const isFailed = job.status === 'failed';

  const [visionActivity, setVisionActivity] = useState<AiActivityEvent | null>(() =>
    job.status === 'extracting' ? getActiveAiActivityForTask('vision') : null
  );

  useEffect(() => {
    if (job.status !== 'extracting') {
      setVisionActivity(null);
      return;
    }
    setVisionActivity(getActiveAiActivityForTask('vision'));
    return subscribeAiActivity(() => {
      setVisionActivity(getActiveAiActivityForTask('vision'));
    });
  }, [job.status]);

  const clampedPercent = Math.max(0, Math.min(100, Math.round(job.progressPercent)));
  const sizeLabel = formatFileSize(job.fileSize);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      role="status"
      aria-live="polite"
      className={`relative overflow-hidden rounded-xl border px-4 py-3.5 transition-colors ${
        isFailed
          ? 'border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20'
          : isCompleted
          ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20'
          : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/85 dark:bg-zinc-900/75'
      }`}
    >
      {/* Top metadata row */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {isRunning && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-0.5 font-medium text-zinc-800 dark:text-zinc-200">
              <Loader2 className="h-3 w-3 animate-spin text-zinc-900 dark:text-zinc-100" />
              <span>
                {job.status === 'queued'
                  ? 'Queued'
                  : job.status === 'saving'
                  ? 'Saving'
                  : 'Extracting'}
              </span>
            </span>
          )}

          {isCompleted && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-100/70 dark:bg-emerald-950/70 px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="h-3 w-3" />
              <span>Saved to Library</span>
            </span>
          )}

          {isReadyForReview && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-0.5 font-medium text-zinc-900 dark:text-zinc-100">
              <Sparkles className="h-3 w-3" />
              <span>Ready to review</span>
            </span>
          )}

          {isFailed && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 dark:border-red-800 bg-red-100/70 dark:bg-red-950/70 px-2 py-0.5 font-medium text-red-800 dark:text-red-200">
              <AlertCircle className="h-3 w-3" />
              <span>Extraction paused</span>
            </span>
          )}

          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {MATERIAL_TYPE_LABELS[job.materialType]}
          </span>

          {topicName && (
            <>
              <span aria-hidden="true" className="text-zinc-400">
                ·
              </span>
              <span className="text-zinc-500 dark:text-zinc-400 truncate max-w-[140px]">
                {topicName}
              </span>
            </>
          )}

          {sizeLabel && (
            <>
              <span aria-hidden="true" className="text-zinc-400">
                ·
              </span>
              <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                {sizeLabel}
              </span>
            </>
          )}

          {isRunning && job.hasLocalFile && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span aria-hidden="true">·</span>
              <HardDrive className="h-3 w-3" />
              <span>Temp local cache</span>
            </span>
          )}
        </div>

        {/* Right completion percentage & compact actions */}
        <div className="flex items-center gap-2 shrink-0">
          {(isRunning || isCompleted || isReadyForReview) && (
            <span
              className={`font-mono text-xs font-semibold tabular-nums ${
                isCompleted
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-zinc-900 dark:text-zinc-100'
              }`}
            >
              {clampedPercent}%
            </span>
          )}

          {isRunning && (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              aria-label={`Cancel extraction for ${job.title}`}
              title="Cancel extraction"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {(isCompleted || isFailed || isReadyForReview) && (
            <button
              type="button"
              onClick={() => onDismiss(job.id)}
              aria-label={`Dismiss status for ${job.title}`}
              title="Dismiss"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Document Title */}
      <div className="mt-2 flex items-center justify-between gap-3">
        <h3 className="text-sm sm:text-base font-medium text-zinc-950 dark:text-zinc-100 truncate">
          {job.title || job.fileName}
        </h3>

        {isCompleted && job.savedSourceId && onOpenSavedSource && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onOpenSavedSource(job.savedSourceId!, job.id)}
            className="shrink-0 h-7 px-2.5 text-xs"
          >
            Open
          </Button>
        )}

        {isReadyForReview && onReview && (
          <Button
            size="sm"
            onClick={() => onReview(job)}
            className="shrink-0 h-7 px-2.5 text-xs"
          >
            <FileSearch className="h-3 w-3" />
            Review &amp; save
          </Button>
        )}
      </div>

      {/* Animated Skeleton Lines while extracting */}
      {isRunning && (
        <div className="mt-2.5 space-y-2" aria-hidden="true">
          <div className="h-2.5 w-11/12 rounded-full bg-zinc-200/85 dark:bg-zinc-800/90 animate-sotal-shimmer" />
          <div className="h-2.5 w-7/12 rounded-full bg-zinc-200/70 dark:bg-zinc-800/70 animate-sotal-shimmer" />
        </div>
      )}

      {/* Progress Track & Live Stage */}
      {(isRunning || isCompleted) && (
        <div className="mt-3 space-y-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/90 dark:bg-zinc-800">
            <motion.div
              initial={{ width: '4%' }}
              animate={{ width: `${Math.max(4, clampedPercent)}%` }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className={`h-full rounded-full ${
                isCompleted
                  ? 'bg-emerald-600 dark:bg-emerald-400'
                  : 'bg-zinc-950 dark:bg-zinc-100 animate-sotal-shimmer'
              }`}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="truncate">{job.progressStage}</span>
            {isRunning && visionActivity ? (
              <span className="inline-flex items-center gap-1 shrink-0 font-mono text-[10.5px] text-zinc-400 dark:text-zinc-500">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    visionActivity.isFallback ? 'bg-amber-500' : 'bg-zinc-400 dark:bg-zinc-500'
                  }`}
                />
                <span>
                  {visionActivity.isFallback ? 'Fallback · ' : ''}
                  {visionActivity.providerLabel}
                  {visionActivity.model &&
                  visionActivity.model.toLowerCase() !== visionActivity.providerLabel.toLowerCase()
                    ? ` · ${visionActivity.model}`
                    : ''}
                </span>
              </span>
            ) : (
              isRunning && (
                <span className="hidden sm:inline shrink-0 text-zinc-400 dark:text-zinc-500">
                  Processing in background — feel free to keep studying
                </span>
              )
            )}
          </div>
        </div>
      )}

      {/* Failed state with one-click retry from locally cached file */}
      {isFailed && (
        <div className="mt-2.5 space-y-2.5">
          <p className="text-xs leading-relaxed text-red-700 dark:text-red-300">
            {job.error || 'Could not complete background extraction.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {(job.hasLocalFile || job.extractedResult) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onRetry(job.id)}
                className="h-7 px-2.5 text-xs"
              >
                <RefreshCw className="h-3 w-3" />
                {job.extractedResult ? 'Retry save' : 'Retry extraction'}
              </Button>
            )}
            {job.extractedResult && onReview && (
              <Button
                size="sm"
                onClick={() => onReview(job)}
                className="h-7 px-2.5 text-xs"
              >
                <FileSearch className="h-3 w-3" />
                Review &amp; save
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDismiss(job.id)}
              className="h-7 px-2.5 text-xs"
            >
              Discard
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
};
