import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  CheckCircle2,
  Download,
  MoreVertical,
  PlusSquare,
  RefreshCw,
  Share,
  Smartphone,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SotalLogo } from '../components/ui/SotalLogo';
import {
  clearPwaAppCacheAndReload,
  detectRunningStandalone,
  dismissReinstallNoticeStorage,
  hasPendingReinstallNotice,
  INSTALLED_STORAGE_KEY,
} from '../utils/pwaMigration';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export type InstallPlatform = 'ios' | 'android' | 'desktop_safari' | 'desktop_chromium' | 'other';

// Module-level capture so beforeinstallprompt is NEVER missed before React mounts
let capturedDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<(event: BeforeInstallPromptEvent | null) => void>();
const installedListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    capturedDeferredPrompt = e as BeforeInstallPromptEvent;
    try {
      // Browser only fires beforeinstallprompt when the PWA is NOT currently installed
      window.localStorage.removeItem(INSTALLED_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    promptListeners.forEach((cb) => cb(capturedDeferredPrompt));
  });

  window.addEventListener('appinstalled', () => {
    capturedDeferredPrompt = null;
    try {
      window.localStorage.setItem(INSTALLED_STORAGE_KEY, 'true');
    } catch {
      // Ignore storage errors
    }
    promptListeners.forEach((cb) => cb(null));
    installedListeners.forEach((cb) => cb());
  });
}

function readPersistedInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(INSTALLED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function detectInstallPlatform(): InstallPlatform {
  if (typeof window === 'undefined') return 'other';
  const ua = window.navigator.userAgent;
  const maxTouchPoints = window.navigator.maxTouchPoints || 0;

  // Detect iOS and iPadOS 13+ (which reports Macintosh with touch points)
  const isIOS =
    (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) &&
    !(window as Window & { MSStream?: unknown }).MSStream;
  if (isIOS) return 'ios';

  if (/Android/i.test(ua)) return 'android';

  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox|CriOS|FxiOS/i.test(ua);
  if (isSafari) return 'desktop_safari';

  if (/Chrome|Chromium|Edg|OPR|Brave/i.test(ua)) return 'desktop_chromium';

  return 'other';
}

export interface PWAInstallContextValue {
  /** True when the browser's native one-click install prompt is ready */
  isInstallable: boolean;
  /** True when Jovibe Study is already installed / running as a standalone PWA */
  isInstalled: boolean;
  /** True on iPhone / iPad Safari */
  isIOS: boolean;
  /** Detected user platform for tailored install guidance */
  platform: InstallPlatform;
  /** Triggers native browser install prompt if available; otherwise opens the tailored Install Guide modal */
  triggerInstall: () => Promise<'accepted' | 'dismissed' | 'guide_opened'>;
  /** Native-only install call (returns 'unavailable' if deferredPrompt isn't ready) */
  installApp: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** Manually open or close the platform install guide modal */
  guideModalOpen: boolean;
  openInstallGuide: () => void;
  closeInstallGuide: () => void;
  /** True for users migrating from a previously installed "SOTAL Study" PWA */
  needsReinstallNotice: boolean;
  dismissReinstallNotice: () => void;
  /** Clears cached PWA shell files & service workers and reloads fresh from network */
  clearAppCacheAndReload: () => Promise<void>;
  clearingAppCache: boolean;
}

const PWAInstallContext = createContext<PWAInstallContextValue | null>(null);

export const PWAInstallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => capturedDeferredPrompt
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    const standalone = detectRunningStandalone();
    if (standalone) {
      try {
        window.localStorage.setItem(INSTALLED_STORAGE_KEY, 'true');
      } catch {
        // Ignore storage errors
      }
      return true;
    }
    if (capturedDeferredPrompt) return false;
    return readPersistedInstalled();
  });
  const [platform] = useState<InstallPlatform>(() => detectInstallPlatform());
  const [guideModalOpen, setGuideModalOpen] = useState(false);
  const [needsReinstallNotice, setNeedsReinstallNotice] = useState<boolean>(() =>
    hasPendingReinstallNotice()
  );
  const [clearingAppCache, setClearingAppCache] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePromptUpdate = (evt: BeforeInstallPromptEvent | null) => {
      setDeferredPrompt(evt);
      if (evt) {
        setIsInstalled(false);
      }
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setGuideModalOpen(false);
      dismissReinstallNoticeStorage();
      setNeedsReinstallNotice(false);
    };

    promptListeners.add(handlePromptUpdate);
    installedListeners.add(handleInstalled);

    // Sync immediately in case an event arrived between render and effect
    if (capturedDeferredPrompt) {
      setDeferredPrompt(capturedDeferredPrompt);
      setIsInstalled(false);
    }

    // Watch display-mode changes (e.g., user installs while tab is open)
    const mq = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        try {
          window.localStorage.setItem(INSTALLED_STORAGE_KEY, 'true');
        } catch {
          // Ignore
        }
        setIsInstalled(true);
        setGuideModalOpen(false);
      }
    };
    mq.addEventListener?.('change', handleDisplayModeChange);

    // Best-effort check via getInstalledRelatedApps on Chromium browsers
    const navWithRelated = window.navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; url?: string }>>;
    };
    if (typeof navWithRelated.getInstalledRelatedApps === 'function') {
      navWithRelated
        .getInstalledRelatedApps()
        .then((apps) => {
          if (Array.isArray(apps) && apps.length > 0) {
            setIsInstalled(true);
          }
        })
        .catch(() => {
          // Ignore unsupported / blocked errors
        });
    }

    return () => {
      promptListeners.delete(handlePromptUpdate);
      installedListeners.delete(handleInstalled);
      mq.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, []);

  const installApp = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const promptEvent = deferredPrompt ?? capturedDeferredPrompt;
    if (!promptEvent) return 'unavailable';
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        capturedDeferredPrompt = null;
        setDeferredPrompt(null);
        setIsInstalled(true);
        setGuideModalOpen(false);
        dismissReinstallNoticeStorage();
        setNeedsReinstallNotice(false);
        try {
          window.localStorage.setItem(INSTALLED_STORAGE_KEY, 'true');
        } catch {
          // Ignore
        }
      }
      return outcome;
    } catch {
      return 'unavailable';
    }
  }, [deferredPrompt]);

  const triggerInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'guide_opened'> => {
    const promptEvent = deferredPrompt ?? capturedDeferredPrompt;
    if (promptEvent) {
      const outcome = await installApp();
      if (outcome === 'accepted' || outcome === 'dismissed') {
        return outcome;
      }
    }
    setGuideModalOpen(true);
    return 'guide_opened';
  }, [deferredPrompt, installApp]);

  const openInstallGuide = useCallback(() => setGuideModalOpen(true), []);
  const closeInstallGuide = useCallback(() => setGuideModalOpen(false), []);

  const dismissReinstallNotice = useCallback(() => {
    dismissReinstallNoticeStorage();
    setNeedsReinstallNotice(false);
  }, []);

  const handleClearAppCacheAndReload = useCallback(async () => {
    setClearingAppCache(true);
    try {
      await clearPwaAppCacheAndReload();
    } finally {
      setClearingAppCache(false);
    }
  }, []);

  const value = useMemo<PWAInstallContextValue>(
    () => ({
      isInstallable: Boolean(deferredPrompt),
      isInstalled,
      isIOS: platform === 'ios',
      platform,
      triggerInstall,
      installApp,
      guideModalOpen,
      openInstallGuide,
      closeInstallGuide,
      needsReinstallNotice,
      dismissReinstallNotice,
      clearAppCacheAndReload: handleClearAppCacheAndReload,
      clearingAppCache,
    }),
    [
      deferredPrompt,
      isInstalled,
      platform,
      triggerInstall,
      installApp,
      guideModalOpen,
      openInstallGuide,
      closeInstallGuide,
      needsReinstallNotice,
      dismissReinstallNotice,
      handleClearAppCacheAndReload,
      clearingAppCache,
    ]
  );

  return (
    <PWAInstallContext.Provider value={value}>
      {children}
      <PWAInstallGuideModal
        open={guideModalOpen && !isInstalled}
        platform={platform}
        hasNativePrompt={Boolean(deferredPrompt)}
        onTriggerNativeInstall={() => void installApp()}
        onClose={closeInstallGuide}
      />
      <PWARebrandUpdateModal
        open={needsReinstallNotice}
        platform={platform}
        hasNativePrompt={Boolean(deferredPrompt)}
        clearingAppCache={clearingAppCache}
        onTriggerNativeInstall={() => void installApp()}
        onClearAppCache={() => void handleClearAppCacheAndReload()}
        onClose={dismissReinstallNotice}
      />
    </PWAInstallContext.Provider>
  );
};

interface PWAInstallGuideModalProps {
  open: boolean;
  platform: InstallPlatform;
  hasNativePrompt: boolean;
  onTriggerNativeInstall: () => void;
  onClose: () => void;
}

const PWAInstallGuideModal: React.FC<PWAInstallGuideModalProps> = ({
  open,
  platform,
  hasNativePrompt,
  onTriggerNativeInstall,
  onClose,
}) => {
  const title =
    platform === 'ios'
      ? 'Install Jovibe Study on iPhone or iPad'
      : platform === 'android'
      ? 'Install Jovibe Study on Android'
      : platform === 'desktop_safari'
      ? 'Install Jovibe Study on Mac'
      : 'Install Jovibe Study on your device';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Install the app for a clean full-screen workspace and offline access to your cached study materials."
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 p-3">
          <SotalLogo size="md" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
              Jovibe Study
            </div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <WifiOff className="h-3 w-3 shrink-0" />
              <span>Works offline with saved notes, Library &amp; chat history</span>
            </div>
          </div>
        </div>

        {hasNativePrompt ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
              Your browser supports direct installation. Tap the button below to add Jovibe Study right to your device.
            </p>
            <Button size="md" className="w-full" onClick={onTriggerNativeInstall}>
              <Download className="h-4 w-4" />
              Install Jovibe Study now
            </Button>
          </div>
        ) : platform === 'ios' ? (
          <ol className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300 list-decimal pl-5">
            <li>
              Open this page in <span className="font-medium text-zinc-950 dark:text-zinc-100">Safari</span> and tap the{' '}
              <Share className="inline h-3.5 w-3.5 mx-0.5 text-zinc-950 dark:text-zinc-100" />{' '}
              <span className="font-medium text-zinc-950 dark:text-zinc-100">Share</span> button in the toolbar.
            </li>
            <li>
              Scroll down and tap{' '}
              <PlusSquare className="inline h-3.5 w-3.5 mx-0.5 text-zinc-950 dark:text-zinc-100" />{' '}
              <span className="font-medium text-zinc-950 dark:text-zinc-100">Add to Home Screen</span>.
            </li>
            <li>
              Tap <span className="font-medium text-zinc-950 dark:text-zinc-100">Add</span> in the top-right corner to finish installing.
            </li>
          </ol>
        ) : platform === 'android' ? (
          <ol className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300 list-decimal pl-5">
            <li>
              Tap the browser menu{' '}
              <MoreVertical className="inline h-3.5 w-3.5 mx-0.5 text-zinc-950 dark:text-zinc-100" />{' '}
              in the top-right corner of Chrome or Edge.
            </li>
            <li>
              Tap <span className="font-medium text-zinc-950 dark:text-zinc-100">Install app</span> or{' '}
              <span className="font-medium text-zinc-950 dark:text-zinc-100">Add to Home screen</span>.
            </li>
            <li>
              Confirm by tapping <span className="font-medium text-zinc-950 dark:text-zinc-100">Install</span>.
            </li>
          </ol>
        ) : platform === 'desktop_safari' ? (
          <ol className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300 list-decimal pl-5">
            <li>
              Click the <Share className="inline h-3.5 w-3.5 mx-0.5 text-zinc-950 dark:text-zinc-100" />{' '}
              <span className="font-medium text-zinc-950 dark:text-zinc-100">Share</span> button in Safari&apos;s toolbar (or open the{' '}
              <span className="font-medium text-zinc-950 dark:text-zinc-100">File</span> menu).
            </li>
            <li>
              Select <span className="font-medium text-zinc-950 dark:text-zinc-100">Add to Dock</span>.
            </li>
            <li>
              Click <span className="font-medium text-zinc-950 dark:text-zinc-100">Add</span> to launch Jovibe Study as a desktop app.
            </li>
          </ol>
        ) : (
          <ol className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300 list-decimal pl-5">
            <li>
              Look for the{' '}
              <Smartphone className="inline h-3.5 w-3.5 mx-0.5 text-zinc-950 dark:text-zinc-100" />{' '}
              <span className="font-medium text-zinc-950 dark:text-zinc-100">Install</span> icon on the right side of your browser&apos;s address bar.
            </li>
            <li>
              Or open your browser menu and select{' '}
              <span className="font-medium text-zinc-950 dark:text-zinc-100">Install Jovibe Study</span> /{' '}
              <span className="font-medium text-zinc-950 dark:text-zinc-100">Save and share → Install page as app</span>.
            </li>
            <li>
              Click <span className="font-medium text-zinc-950 dark:text-zinc-100">Install</span> to add it to your desktop or home screen.
            </li>
          </ol>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Free · No app store needed
          </span>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </Modal>
  );
};

interface PWARebrandUpdateModalProps {
  open: boolean;
  platform: InstallPlatform;
  hasNativePrompt: boolean;
  clearingAppCache: boolean;
  onTriggerNativeInstall: () => void;
  onClearAppCache: () => void;
  onClose: () => void;
}

const PWARebrandUpdateModal: React.FC<PWARebrandUpdateModalProps> = ({
  open,
  platform,
  hasNativePrompt,
  clearingAppCache,
  onTriggerNativeInstall,
  onClearAppCache,
  onClose,
}) => {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="SOTAL Study is now Jovibe Study"
      description="Your app has been automatically updated and old cached app files were cleared. Your account, courses, notes, and chat history are completely safe."
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 p-3">
          <SotalLogo size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-950 dark:text-zinc-100">
              <span>Jovibe Study</span>
              <Sparkles className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              To update your device&apos;s home screen or desktop app icon name, follow the quick step below.
            </p>
          </div>
        </div>

        {hasNativePrompt ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
              You can install the updated <span className="font-medium text-zinc-950 dark:text-zinc-100">Jovibe Study</span> app right now, and remove the old SOTAL Study icon from your device.
            </p>
            <Button size="md" className="w-full" onClick={onTriggerNativeInstall}>
              <Download className="h-4 w-4" />
              Install Jovibe Study now
            </Button>
          </div>
        ) : platform === 'ios' ? (
          <ol className="space-y-2.5 text-sm text-zinc-700 dark:text-zinc-300 list-decimal pl-5">
            <li>
              Touch and hold the old <span className="font-medium text-zinc-950 dark:text-zinc-100">SOTAL Study</span> icon on your Home Screen and tap <span className="font-medium text-zinc-950 dark:text-zinc-100">Remove App</span>.
            </li>
            <li>
              Open this site in <span className="font-medium text-zinc-950 dark:text-zinc-100">Safari</span> and tap{' '}
              <Share className="inline h-3.5 w-3.5 mx-0.5 text-zinc-950 dark:text-zinc-100" />{' '}
              <span className="font-medium text-zinc-950 dark:text-zinc-100">Share</span> →{' '}
              <PlusSquare className="inline h-3.5 w-3.5 mx-0.5 text-zinc-950 dark:text-zinc-100" />{' '}
              <span className="font-medium text-zinc-950 dark:text-zinc-100">Add to Home Screen</span>.
            </li>
            <li>
              Tap <span className="font-medium text-zinc-950 dark:text-zinc-100">Add</span> to save the new <span className="font-medium text-zinc-950 dark:text-zinc-100">Jovibe Study</span> icon.
            </li>
          </ol>
        ) : platform === 'android' ? (
          <div className="space-y-2.5 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
            <p>
              Chrome on Android automatically updates your app name to <span className="font-medium text-zinc-950 dark:text-zinc-100">Jovibe Study</span> in the background.
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Want it updated immediately? Long-press the old <span className="font-medium text-zinc-700 dark:text-zinc-300">SOTAL Study</span> icon → <span className="font-medium text-zinc-700 dark:text-zinc-300">Uninstall</span>, then open this page in Chrome and tap{' '}
              <MoreVertical className="inline h-3.5 w-3.5 mx-0.5 text-zinc-700 dark:text-zinc-300" /> → <span className="font-medium text-zinc-700 dark:text-zinc-300">Install app</span>.
            </p>
          </div>
        ) : platform === 'desktop_safari' ? (
          <ol className="space-y-2.5 text-sm text-zinc-700 dark:text-zinc-300 list-decimal pl-5">
            <li>
              Remove the old <span className="font-medium text-zinc-950 dark:text-zinc-100">SOTAL Study</span> web app from your Applications folder or Dock.
            </li>
            <li>
              In Safari, click{' '}
              <Share className="inline h-3.5 w-3.5 mx-0.5 text-zinc-950 dark:text-zinc-100" />{' '}
              <span className="font-medium text-zinc-950 dark:text-zinc-100">Share</span> → <span className="font-medium text-zinc-950 dark:text-zinc-100">Add to Dock</span> to install <span className="font-medium text-zinc-950 dark:text-zinc-100">Jovibe Study</span>.
            </li>
          </ol>
        ) : (
          <div className="space-y-2.5 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
            <p>
              Chrome and Edge will automatically prompt to update your installed app name to <span className="font-medium text-zinc-950 dark:text-zinc-100">Jovibe Study</span>.
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              To reinstall right away: open the app menu (<span className="font-medium text-zinc-700 dark:text-zinc-300">⋮ → Uninstall SOTAL Study</span>), then click the{' '}
              <Smartphone className="inline h-3.5 w-3.5 mx-0.5 text-zinc-700 dark:text-zinc-300" />{' '}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Install</span> icon in your browser&apos;s address bar.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
          <Button
            size="sm"
            variant="ghost"
            loading={clearingAppCache}
            onClick={onClearAppCache}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh app cache
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export function usePWAInstallContext(): PWAInstallContextValue {
  const ctx = useContext(PWAInstallContext);
  if (!ctx) {
    throw new Error('usePWAInstallContext must be used inside PWAInstallProvider');
  }
  return ctx;
}
