import React, { useState } from 'react';
import { Download, Share } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface PWAInstallButtonProps {
  variant?: 'menu' | 'button';
  onActionComplete?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'button',
  onActionComplete,
}) => {
  const { isInstallable, isInstalled, isIOS, installApp } = usePWAInstall();
  const [iosGuideOpen, setIosGuideOpen] = useState(false);

  if (isInstalled || (!isInstallable && !isIOS)) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await installApp();
      onActionComplete?.();
    } else if (isIOS) {
      setIosGuideOpen(true);
    }
  };

  return (
    <>
      {variant === 'menu' ? (
        <button
          type="button"
          onClick={() => void handleClick()}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
        >
          <Download className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
          Install SOTAL Study
        </button>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => void handleClick()}>
          <Download className="h-3.5 w-3.5" />
          Install app
        </Button>
      )}

      <Modal
        open={iosGuideOpen}
        title="Install SOTAL Study on iOS"
        description="Add SOTAL Study to your Home Screen for a full-screen, app-like experience."
        onClose={() => {
          setIosGuideOpen(false);
          onActionComplete?.();
        }}
      >
        <ol className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300 list-decimal pl-5">
          <li>
            Tap the <Share className="inline h-3.5 w-3.5 mx-0.5 text-zinc-950 dark:text-zinc-200" />{' '}
            <span className="font-medium text-zinc-950 dark:text-zinc-200">Share</span> button in Safari.
          </li>
          <li>
            Scroll down and tap <span className="font-medium text-zinc-950 dark:text-zinc-200">Add to Home Screen</span>.
          </li>
          <li>
            Tap <span className="font-medium text-zinc-950 dark:text-zinc-200">Add</span> in the top-right corner.
          </li>
        </ol>
        <div className="mt-5 flex justify-end">
          <Button
            size="sm"
            onClick={() => {
              setIosGuideOpen(false);
              onActionComplete?.();
            }}
          >
            Done
          </Button>
        </div>
      </Modal>
    </>
  );
};
