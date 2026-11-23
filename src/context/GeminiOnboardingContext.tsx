import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from './AuthContext';
import { usePlatformAccess } from './PlatformAccessContext';
import { useRouter } from '../router/RouterContext';
import { listStoredApiKeys } from '../services/ai/keyManager';
import {
  createDefaultOnboardingState,
  getRequiredRouteForStep,
  hasConfiguredGeminiKey,
  hasVerifiedGeminiKey,
  readPersistedOnboardingState,
  resolveInitialOnboardingState,
  writePersistedOnboardingState,
  type GeminiOnboardingStep,
  type PersistedGeminiOnboardingState,
} from '../services/onboarding/geminiOnboardingStore';

interface GeminiOnboardingContextValue {
  state: PersistedGeminiOnboardingState;
  hydrated: boolean;
  hasVerifiedKey: boolean;
  hasConfiguredKey: boolean;
  /** True when user has not configured a Gemini key on this device and is not actively in the tutorial */
  needsSetupReminder: boolean;
  reminderDismissedThisSession: boolean;
  showCompletionModal: boolean;
  /** Increments when the user returns from background/external tab or requests Settings focus */
  focusRequestTick: number;
  startGuidedSetup: () => void;
  openSettingsKeyGuide: () => void;
  skipGuide: () => void;
  markVisitedAiStudio: () => void;
  confirmHaveApiKey: () => void;
  reopenKeyInstructions: () => void;
  notifyProfileMenuChange: (isOpen: boolean) => void;
  notifyGeminiKeyVerified: (keyLabel?: string) => void;
  notifyGeminiKeysChanged: () => void;
  finishCompletion: (destination: 'return' | 'stay') => void;
  dismissReminderForSession: () => void;
  verifiedKeyLabel: string;
}

const GeminiOnboardingContext = createContext<GeminiOnboardingContextValue | null>(null);

export const GeminiOnboardingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { status: platformStatus } = usePlatformAccess();
  const { route, navigate } = useRouter();
  const userId = user?.uid ?? '';

  const [state, setState] = useState<PersistedGeminiOnboardingState>(() =>
    createDefaultOnboardingState('/courses')
  );
  const [hydrated, setHydrated] = useState(false);
  const [hasVerifiedKey, setHasVerifiedKey] = useState<boolean>(() => hasVerifiedGeminiKey());
  const [hasConfiguredKey, setHasConfiguredKey] = useState<boolean>(() => hasConfiguredGeminiKey());
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [verifiedKeyLabel, setVerifiedKeyLabel] = useState('');
  const [reminderDismissedThisSession, setReminderDismissedThisSession] = useState(false);
  const [focusRequestTick, setFocusRequestTick] = useState(0);

  const routeRef = useRef(route);
  routeRef.current = route;
  const stateRef = useRef(state);
  stateRef.current = state;

  const commitState = useCallback(
    (
      updater:
        | PersistedGeminiOnboardingState
        | ((prev: PersistedGeminiOnboardingState) => PersistedGeminiOnboardingState)
    ) => {
      setState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (userId) {
          writePersistedOnboardingState(userId, next);
        }
        return next;
      });
    },
    [userId]
  );

  // Hydrate resumable onboarding state for the active user
  useEffect(() => {
    if (!userId) {
      setState(createDefaultOnboardingState('/courses'));
      setHydrated(false);
      setShowCompletionModal(false);
      return;
    }

    const keys = listStoredApiKeys('gemini');
    setHasVerifiedKey(hasVerifiedGeminiKey());
    setHasConfiguredKey(hasConfiguredGeminiKey());

    const persisted = readPersistedOnboardingState(userId);
    const resolved = resolveInitialOnboardingState({
      persisted,
      geminiKeys: keys,
      currentRoute: routeRef.current,
    });

    // Newly onboarded users receive 7 days of free AI access via shared keys, so do not force
    // the immediate BYOK tutorial overlay on welcome while free trial is active (they see the 7-day welcome popup instead).
    if (
      resolved.status === 'in_progress' &&
      resolved.step === 'welcome' &&
      !persisted
    ) {
      const deferred = {
        ...resolved,
        status: 'skipped' as const,
        skippedAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      setState(deferred);
      writePersistedOnboardingState(userId, deferred);
    } else {
      setState(resolved);
      writePersistedOnboardingState(userId, resolved);
    }
    setHydrated(true);
    setReminderDismissedThisSession(false);
  }, [userId]);

  // Restore exact tutorial location & route across reloads, navigation, and returning from Google AI Studio
  useEffect(() => {
    if (!hydrated || !userId) return;
    if (state.status !== 'in_progress') return;

    // Never hijack an active shared-course invite acceptance at the welcome step
    if (state.step === 'welcome' && route === '/join') return;

    // Detecting actual navigation to /settings advances profile/settings steps straight to the API key guide
    if (
      (state.step === 'open_profile' || state.step === 'open_settings') &&
      route === '/settings'
    ) {
      commitState((prev) => ({
        ...prev,
        step: 'get_key_popup',
        updatedAtMs: Date.now(),
      }));
      setFocusRequestTick((t) => t + 1);
      return;
    }

    // Ensure the user is on the route required by their current resumable step
    const requiredRoute = getRequiredRouteForStep(state.step, route);
    if (requiredRoute && requiredRoute !== route) {
      navigate(requiredRoute);
    }
  }, [hydrated, userId, state.status, state.step, route, navigate, commitState]);

  // Handle returning to SOTAL after switching apps/tabs to Google AI Studio (visibilitychange / focus / pageshow)
  useEffect(() => {
    if (!hydrated || !userId || typeof window === 'undefined') return;

    const handleResumeCheck = () => {
      if (document.visibilityState === 'hidden') return;
      const persisted = readPersistedOnboardingState(userId);
      const current = persisted ?? stateRef.current;

      setHasVerifiedKey(hasVerifiedGeminiKey());
      setHasConfiguredKey(hasConfiguredGeminiKey());

      if (current.status === 'in_progress') {
        if (persisted && persisted.updatedAtMs > stateRef.current.updatedAtMs) {
          setState(persisted);
        }
        const requiredRoute = getRequiredRouteForStep(current.step, routeRef.current);
        if (requiredRoute && requiredRoute !== routeRef.current) {
          navigate(requiredRoute);
        }
        if (current.step === 'get_key_popup' || current.step === 'paste_key') {
          setFocusRequestTick((t) => t + 1);
        }
      }
    };

    const handleStorageSync = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key.includes('sotal_study_byok_keys_v1') || event.key.includes(userId)) {
        handleResumeCheck();
      }
    };

    document.addEventListener('visibilitychange', handleResumeCheck);
    window.addEventListener('focus', handleResumeCheck);
    window.addEventListener('pageshow', handleResumeCheck);
    window.addEventListener('storage', handleStorageSync);

    return () => {
      document.removeEventListener('visibilitychange', handleResumeCheck);
      window.removeEventListener('focus', handleResumeCheck);
      window.removeEventListener('pageshow', handleResumeCheck);
      window.removeEventListener('storage', handleStorageSync);
    };
  }, [hydrated, userId, navigate]);

  const startGuidedSetup = useCallback(() => {
    const safeReturn =
      routeRef.current && routeRef.current !== '/settings' && routeRef.current !== '/join'
        ? routeRef.current
        : stateRef.current.returnRoute || '/courses';

    // If user is already inside Settings, take them directly to the Gemini API key instructions
    const nextStep: GeminiOnboardingStep =
      routeRef.current === '/settings' ? 'get_key_popup' : 'open_profile';

    commitState((prev) => ({
      ...prev,
      status: 'in_progress',
      step: nextStep,
      returnRoute: safeReturn,
      skippedAtMs: null,
      updatedAtMs: Date.now(),
    }));

    const requiredRoute = getRequiredRouteForStep(nextStep, routeRef.current);
    if (requiredRoute && requiredRoute !== routeRef.current) {
      navigate(requiredRoute);
    }
    if (nextStep === 'get_key_popup') {
      setFocusRequestTick((t) => t + 1);
    }
  }, [commitState, navigate]);

  const openSettingsKeyGuide = useCallback(() => {
    const safeReturn =
      routeRef.current && routeRef.current !== '/settings' && routeRef.current !== '/join'
        ? routeRef.current
        : stateRef.current.returnRoute || '/courses';

    commitState((prev) => ({
      ...prev,
      status: 'in_progress',
      step: 'get_key_popup',
      returnRoute: safeReturn,
      skippedAtMs: null,
      updatedAtMs: Date.now(),
    }));

    if (routeRef.current !== '/settings') {
      navigate('/settings');
    }
    setFocusRequestTick((t) => t + 1);
  }, [commitState, navigate]);

  const skipGuide = useCallback(() => {
    // If the user already has a verified Gemini key (e.g. reopened the guide to add a 2nd key),
    // closing the guide preserves their completed status. Otherwise, skipping never marks setup complete.
    if (hasVerifiedGeminiKey()) {
      commitState((prev) => ({
        ...prev,
        status: 'completed',
        step: 'completed',
        completedAtMs: prev.completedAtMs ?? Date.now(),
        updatedAtMs: Date.now(),
      }));
      return;
    }
    commitState((prev) => ({
      ...prev,
      status: 'skipped',
      skippedAtMs: Date.now(),
      updatedAtMs: Date.now(),
    }));
  }, [commitState]);

  const markVisitedAiStudio = useCallback(() => {
    commitState((prev) => ({
      ...prev,
      visitedAiStudioAtMs: Date.now(),
      updatedAtMs: Date.now(),
    }));
  }, [commitState]);

  const confirmHaveApiKey = useCallback(() => {
    commitState((prev) => ({
      ...prev,
      status: 'in_progress',
      step: 'paste_key',
      updatedAtMs: Date.now(),
    }));
    if (routeRef.current !== '/settings') {
      navigate('/settings');
    }
    setFocusRequestTick((t) => t + 1);
  }, [commitState, navigate]);

  const reopenKeyInstructions = useCallback(() => {
    commitState((prev) => ({
      ...prev,
      status: 'in_progress',
      step: 'get_key_popup',
      updatedAtMs: Date.now(),
    }));
    if (routeRef.current !== '/settings') {
      navigate('/settings');
    }
    setFocusRequestTick((t) => t + 1);
  }, [commitState, navigate]);

  const notifyProfileMenuChange = useCallback(
    (isOpen: boolean) => {
      const current = stateRef.current;
      if (current.status !== 'in_progress') return;

      if (isOpen && current.step === 'open_profile') {
        commitState((prev) => ({
          ...prev,
          step: 'open_settings',
          updatedAtMs: Date.now(),
        }));
      } else if (!isOpen && current.step === 'open_settings' && routeRef.current !== '/settings') {
        // User closed the menu before clicking Settings -> gracefully step back so spotlight re-attaches
        commitState((prev) => ({
          ...prev,
          step: 'open_profile',
          updatedAtMs: Date.now(),
        }));
      }
    },
    [commitState]
  );

  const notifyGeminiKeyVerified = useCallback(
    (keyLabel?: string) => {
      setHasVerifiedKey(true);
      setHasConfiguredKey(true);
      setReminderDismissedThisSession(false);

      const wasNotCompleted = stateRef.current.status !== 'completed';
      if (wasNotCompleted) {
        commitState((prev) => ({
          ...prev,
          status: 'completed',
          step: 'completed',
          completedAtMs: Date.now(),
          updatedAtMs: Date.now(),
        }));
        setVerifiedKeyLabel(keyLabel || 'Gemini API key');
        setShowCompletionModal(true);
      }
    },
    [commitState]
  );

  const notifyGeminiKeysChanged = useCallback(() => {
    const verified = hasVerifiedGeminiKey();
    const configured = hasConfiguredGeminiKey();
    setHasVerifiedKey(verified);
    setHasConfiguredKey(configured);

    if (!configured && stateRef.current.status === 'completed') {
      commitState((prev) => ({
        ...prev,
        status: 'skipped',
        step: 'get_key_popup',
        completedAtMs: null,
        updatedAtMs: Date.now(),
      }));
    }
  }, [commitState]);

  const finishCompletion = useCallback(
    (destination: 'return' | 'stay') => {
      setShowCompletionModal(false);
      if (destination === 'return') {
        const target =
          stateRef.current.returnRoute && stateRef.current.returnRoute !== '/settings'
            ? stateRef.current.returnRoute
            : '/courses';
        navigate(target);
      } else {
        setFocusRequestTick((t) => t + 1);
      }
    },
    [navigate]
  );

  const dismissReminderForSession = useCallback(() => {
    setReminderDismissedThisSession(true);
  }, []);

  const needsSetupReminder =
    hydrated &&
    Boolean(userId) &&
    !hasConfiguredKey &&
    state.status !== 'in_progress' &&
    state.status !== 'completed' &&
    Boolean(platformStatus?.freeAccess.expired);

  const value = useMemo<GeminiOnboardingContextValue>(
    () => ({
      state,
      hydrated,
      hasVerifiedKey,
      hasConfiguredKey,
      needsSetupReminder,
      reminderDismissedThisSession,
      showCompletionModal,
      focusRequestTick,
      startGuidedSetup,
      openSettingsKeyGuide,
      skipGuide,
      markVisitedAiStudio,
      confirmHaveApiKey,
      reopenKeyInstructions,
      notifyProfileMenuChange,
      notifyGeminiKeyVerified,
      notifyGeminiKeysChanged,
      finishCompletion,
      dismissReminderForSession,
      verifiedKeyLabel,
    }),
    [
      state,
      hydrated,
      hasVerifiedKey,
      hasConfiguredKey,
      needsSetupReminder,
      reminderDismissedThisSession,
      showCompletionModal,
      focusRequestTick,
      startGuidedSetup,
      openSettingsKeyGuide,
      skipGuide,
      markVisitedAiStudio,
      confirmHaveApiKey,
      reopenKeyInstructions,
      notifyProfileMenuChange,
      notifyGeminiKeyVerified,
      notifyGeminiKeysChanged,
      finishCompletion,
      dismissReminderForSession,
      verifiedKeyLabel,
    ]
  );

  return (
    <GeminiOnboardingContext.Provider value={value}>{children}</GeminiOnboardingContext.Provider>
  );
};

export function useGeminiOnboarding(): GeminiOnboardingContextValue {
  const ctx = useContext(GeminiOnboardingContext);
  if (!ctx) {
    throw new Error('useGeminiOnboarding must be used within GeminiOnboardingProvider');
  }
  return ctx;
}
