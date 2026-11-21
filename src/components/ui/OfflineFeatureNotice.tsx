import React from 'react';
import { WifiOff } from 'lucide-react';
import { Button } from './Button';

interface OfflineFeatureNoticeProps {
  title?: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  className?: string;
}

export const OfflineFeatureNotice: React.FC<OfflineFeatureNoticeProps> = ({
  title = 'Internet connection required',
  description,
  actionLabel,
  onAction,
  compact = false,
  className = '',
}) => {
  if (compact) {
    return (
      <div
        role="status"
        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/90 dark:bg-amber-950/35 px-3 py-2 text-xs text-amber-950 dark:text-amber-100 ${className}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <span>{description}</span>
        </div>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="shrink-0 font-medium underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-200 cursor-pointer"
          >
            {actionLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="status"
      className={`rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 p-4 sm:p-5 ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300">
          <WifiOff className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">{title}</h3>
          <p className="text-xs sm:text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {description}
          </p>
          {actionLabel && onAction && (
            <div className="pt-1.5">
              <Button variant="secondary" size="sm" onClick={onAction}>
                {actionLabel}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
