import React from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Button } from '../ui/Button';

interface PWAInstallButtonProps {
  variant?: 'menu' | 'button' | 'header' | 'hero';
  onActionComplete?: () => void;
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'button',
  onActionComplete,
  className = '',
}) => {
  const { isInstalled, triggerInstall } = usePWAInstall();

  // Only show when SOTAL Study is NOT yet installed on the user's device
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    onActionComplete?.();
    await triggerInstall();
  };

  if (variant === 'menu') {
    return (
      <button
        type="button"
        onClick={() => void handleClick()}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 cursor-pointer ${className}`}
      >
        <Download className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
        <span className="flex-1 truncate">Install app</span>
      </button>
    );
  }

  if (variant === 'header') {
    return (
      <button
        type="button"
        onClick={() => void handleClick()}
        className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-zinc-200/80 dark:border-zinc-800/80 bg-white/60 dark:bg-zinc-900/60 px-3.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 backdrop-blur-sm hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0 ${className}`}
      >
        <Download className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
        <span>Install app</span>
      </button>
    );
  }

  if (variant === 'hero') {
    return (
      <button
        type="button"
        onClick={() => void handleClick()}
        className={`inline-flex h-11 items-center justify-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-5 text-sm font-medium text-zinc-800 dark:text-zinc-200 backdrop-blur-sm hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${className}`}
      >
        <Download className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
        <span>Install app</span>
      </button>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void handleClick()}
      className={className}
    >
      <Download className="h-3.5 w-3.5" />
      Install app
    </Button>
  );
};
