export const CURRENT_BRAND_VERSION = 'jovibe-study-v2';
export const BRAND_VERSION_STORAGE_KEY = 'jovibe_pwa_brand_version';
export const INSTALLED_STORAGE_KEY = 'jovibe_pwa_installed_v2';
export const REINSTALL_NOTICE_KEY = 'jovibe_pwa_reinstall_notice_v2';

const LEGACY_INSTALLED_KEY = 'sotal_pwa_installed_v1';
const LEGACY_POPUP_KEY = 'sotal_pwa_install_popup_v1';
const MIGRATION_RELOAD_SESSION_KEY = 'jovibe_pwa_migrated_reload_v2';

export function detectRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    nav.standalone === true ||
    document.referrer.startsWith('android-app://')
  );
}

export function hasPendingReinstallNotice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(REINSTALL_NOTICE_KEY) === 'pending';
  } catch {
    return false;
  }
}

export function dismissReinstallNoticeStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REINSTALL_NOTICE_KEY, 'dismissed');
  } catch {
    // Ignore storage errors
  }
}

async function purgeAppShellCachesAndServiceWorkers(): Promise<boolean> {
  let clearedAnything = false;

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cacheNames = await window.caches.keys();
      if (cacheNames.length > 0) {
        await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
        clearedAnything = true;
      }
    } catch {
      // Ignore Cache Storage errors
    }
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      if (registrations.length > 0) {
        const results = await Promise.all(registrations.map((reg) => reg.unregister()));
        if (results.some(Boolean)) {
          clearedAnything = true;
        }
      }
    } catch {
      // Ignore Service Worker errors
    }
  }

  return clearedAnything;
}

/**
 * Automatically migrates returning users from the previous "SOTAL Study" PWA
 * build to "Jovibe Study":
 * - Clears legacy PWA install/snooze flags while preserving user study data
 *   (IndexedDB, Firebase auth, theme, and API keys).
 * - Purges stale Cache Storage & unregisters old Service Workers when online,
 *   then reloads once so the fresh Jovibe Study manifest and SW register cleanly.
 * - Flags previously installed users so the app shows a one-time reinstall /
 *   icon-update notice (required on platforms like iOS that freeze home-screen names).
 */
export function runAutomaticPwaBrandMigration(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    if (window.localStorage.getItem(BRAND_VERSION_STORAGE_KEY) === CURRENT_BRAND_VERSION) {
      return false;
    }
  } catch {
    return false;
  }

  // Never purge caches while offline or we could strand an offline user
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }

  let hadLegacyInstall = detectRunningStandalone();
  try {
    if (window.localStorage.getItem(LEGACY_INSTALLED_KEY) === 'true') {
      hadLegacyInstall = true;
    }
    window.localStorage.removeItem(LEGACY_INSTALLED_KEY);
    window.localStorage.removeItem(LEGACY_POPUP_KEY);

    if (hadLegacyInstall) {
      window.localStorage.setItem(REINSTALL_NOTICE_KEY, 'pending');
    }
    window.localStorage.setItem(BRAND_VERSION_STORAGE_KEY, CURRENT_BRAND_VERSION);
  } catch {
    // Ignore storage errors
  }

  let alreadyReloadedThisSession = false;
  try {
    alreadyReloadedThisSession =
      window.sessionStorage.getItem(MIGRATION_RELOAD_SESSION_KEY) === '1';
  } catch {
    // Ignore sessionStorage errors
  }

  void purgeAppShellCachesAndServiceWorkers().then((clearedAnything) => {
    if (!clearedAnything || alreadyReloadedThisSession) {
      return;
    }
    try {
      window.sessionStorage.setItem(MIGRATION_RELOAD_SESSION_KEY, '1');
    } catch {
      // Ignore sessionStorage errors
    }
    window.location.reload();
  });

  return true;
}

/**
 * Listens for a newly activated Service Worker taking over from an older one
 * and refreshes the page cleanly so installed users never remain stuck on an
 * outdated cached shell.
 */
export function attachServiceWorkerAutoRefresh(skipInitialUpdateCheck = false): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  // Proactively check for SW updates on startup when online
  if (!skipInitialUpdateCheck && navigator.onLine !== false) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((reg) => reg.update())))
      .catch(() => {
        // Ignore update errors
      });
  }
}

/**
 * Manual/guided reset that clears cached PWA shell files and service workers
 * (preserving Firestore/IndexedDB study data) and reloads the latest Jovibe Study
 * manifest & bundle from the network.
 */
export async function clearPwaAppCacheAndReload(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }

  try {
    window.localStorage.removeItem(LEGACY_INSTALLED_KEY);
    window.localStorage.removeItem(LEGACY_POPUP_KEY);
    window.localStorage.removeItem(INSTALLED_STORAGE_KEY);
    window.localStorage.setItem(BRAND_VERSION_STORAGE_KEY, CURRENT_BRAND_VERSION);
  } catch {
    // Ignore storage errors
  }

  await purgeAppShellCachesAndServiceWorkers();
  window.location.reload();
}
