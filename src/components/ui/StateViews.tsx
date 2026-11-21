import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { formatReadableError } from '../../services/firebase/errors';
import { Button } from './Button';

export const LoadingSkeleton: React.FC<{ lines?: number }> = ({ lines = 3 }) => (
  <div className="space-y-4 py-4" aria-busy="true" aria-label="Loading content">
    <div className="h-6 w-48 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
    <div className="space-y-2.5">
      {Array.from({ length: lines }).map((_, idx) => (
        <div
          key={idx}
          className="h-12 w-full animate-pulse rounded border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900"
        />
      ))}
    </div>
  </div>
);

export const EmptyState: React.FC<{
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
  <div className="border-t border-zinc-200 dark:border-zinc-800 py-14 text-left">
    <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">{title}</h2>
    <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{description}</p>
    {actionLabel && onAction && (
      <div className="mt-5">
        <Button onClick={onAction}>{actionLabel}</Button>
      </div>
    )}
  </div>
);

export const ErrorBanner: React.FC<{
  message: string;
  onDismiss?: () => void;
}> = ({ message, onDismiss }) => (
  <div
    role="alert"
    className="flex items-start justify-between gap-4 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
  >
    <div className="flex items-start gap-2.5">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" />
      <span>{message}</span>
    </div>
    {onDismiss && (
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs font-medium text-red-700 dark:text-red-400 underline underline-offset-2 hover:text-red-900 dark:hover:text-red-300 whitespace-nowrap shrink-0 cursor-pointer"
      >
        Dismiss
      </button>
    )}
  </div>
);

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: formatReadableError(error),
    };
  }

  componentDidCatch(error: Error): void {
    console.error('Application ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-50 px-6">
          <div className="w-full max-w-md border-t border-zinc-900 dark:border-zinc-100 pt-6">
            <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Something went wrong</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {this.state.errorMessage || 'An unexpected runtime error interrupted the workspace.'}
            </p>
            <div className="mt-6">
              <Button
                onClick={() => {
                  this.setState({ hasError: false, errorMessage: '' });
                  window.location.reload();
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Reload workspace
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
