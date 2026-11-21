import type { StoredApiKey } from '../ai/keyManager';
import { listStoredApiKeys } from '../ai/keyManager';

export const GEMINI_AI_STUDIO_API_KEY_URL = 'https://aistudio.google.com/app/apikey';

export type GeminiOnboardingStatus = 'idle' | 'in_progress' | 'skipped' | 'completed';

export type GeminiOnboardingStep =
  | 'welcome'
  | 'open_profile'
  | 'open_settings'
  | 'get_key_popup'
  | 'paste_key'
  | 'completed';

export interface PersistedGeminiOnboardingState {
  version: 1;
  status: GeminiOnboardingStatus;
  step: GeminiOnboardingStep;
  returnRoute: string;
  visitedAiStudioAtMs: number | null;
  skippedAtMs: number | null;
  completedAtMs: number | null;
  updatedAtMs: number;
}

const STORAGE_PREFIX = 'sotal_gemini_onboarding_v1:';
const VALID_STATUSES: ReadonlySet<GeminiOnboardingStatus> = new Set([
  'idle',
  'in_progress',
  'skipped',
  'completed',
]);
const VALID_STEPS: ReadonlySet<GeminiOnboardingStep> = new Set([
  'welcome',
  'open_profile',
  'open_settings',
  'get_key_popup',
  'paste_key',
  'completed',
]);

export function getOnboardingStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function createDefaultOnboardingState(
  returnRoute = '/courses',
  nowMs = Date.now()
): PersistedGeminiOnboardingState {
  return {
    version: 1,
    status: 'idle',
    step: 'welcome',
    returnRoute,
    visitedAiStudioAtMs: null,
    skippedAtMs: null,
    completedAtMs: null,
    updatedAtMs: nowMs,
  };
}

/**
 * True when at least one Gemini BYOK key on this device has been verified active
 * (or is currently in temporary cooldown after working previously).
 */
export function hasVerifiedGeminiKeyInList(keys: StoredApiKey[]): boolean {
  return keys.some(
    (entry) =>
      entry.provider === 'gemini' &&
      (entry.status === 'active' ||
        entry.status === 'cooldown' ||
        entry.status === 'quota_exceeded')
  );
}

/**
 * True when any non-invalid Gemini BYOK key already exists on this device.
 * Used to avoid interrupting existing configured users on first load.
 */
export function hasUsableOrUntestedGeminiKeyInList(keys: StoredApiKey[]): boolean {
  return keys.some((entry) => entry.provider === 'gemini' && entry.status !== 'invalid');
}

export function hasVerifiedGeminiKey(): boolean {
  return hasVerifiedGeminiKeyInList(listStoredApiKeys('gemini'));
}

export function hasConfiguredGeminiKey(): boolean {
  return hasUsableOrUntestedGeminiKeyInList(listStoredApiKeys('gemini'));
}

export function readPersistedOnboardingState(
  userId: string
): PersistedGeminiOnboardingState | null {
  if (!userId || typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(getOnboardingStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedGeminiOnboardingState>;
    if (!parsed || typeof parsed !== 'object') return null;

    const status: GeminiOnboardingStatus =
      parsed.status && VALID_STATUSES.has(parsed.status) ? parsed.status : 'idle';
    const step: GeminiOnboardingStep =
      parsed.step && VALID_STEPS.has(parsed.step) ? parsed.step : 'welcome';
    const returnRoute =
      typeof parsed.returnRoute === 'string' && parsed.returnRoute.startsWith('/')
        ? parsed.returnRoute
        : '/courses';

    return {
      version: 1,
      status,
      step,
      returnRoute,
      visitedAiStudioAtMs:
        typeof parsed.visitedAiStudioAtMs === 'number' ? parsed.visitedAiStudioAtMs : null,
      skippedAtMs: typeof parsed.skippedAtMs === 'number' ? parsed.skippedAtMs : null,
      completedAtMs: typeof parsed.completedAtMs === 'number' ? parsed.completedAtMs : null,
      updatedAtMs: typeof parsed.updatedAtMs === 'number' ? parsed.updatedAtMs : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writePersistedOnboardingState(
  userId: string,
  state: PersistedGeminiOnboardingState
): void {
  if (!userId || typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(getOnboardingStorageKey(userId), JSON.stringify(state));
  } catch {
    // Ignore localStorage quota errors cleanly
  }
}

/**
 * Resolves the authoritative onboarding state for a user entering or reloading SOTAL.
 * Pure & deterministic so it can be unit-tested thoroughly.
 */
export function resolveInitialOnboardingState(params: {
  persisted: PersistedGeminiOnboardingState | null;
  geminiKeys: StoredApiKey[];
  currentRoute: string;
  nowMs?: number;
}): PersistedGeminiOnboardingState {
  const nowMs = params.nowMs ?? Date.now();
  const safeReturnRoute =
    params.currentRoute && params.currentRoute !== '/settings' && params.currentRoute !== '/join'
      ? params.currentRoute
      : '/courses';

  const hasVerified = hasVerifiedGeminiKeyInList(params.geminiKeys);
  const hasAnyNonInvalid = hasUsableOrUntestedGeminiKeyInList(params.geminiKeys);

  // 1. If a user already has an in-progress resumable session, preserve their exact step!
  // (Only auto-complete if they actually verified a valid key on this device.)
  if (params.persisted?.status === 'in_progress') {
    if (hasVerified) {
      return {
        ...params.persisted,
        status: 'completed',
        step: 'completed',
        completedAtMs: params.persisted.completedAtMs ?? nowMs,
        updatedAtMs: nowMs,
      };
    }
    return params.persisted;
  }

  // 2. If user previously completed setup AND still has a non-invalid Gemini key on this device, stay completed.
  if (params.persisted?.status === 'completed' && hasAnyNonInvalid) {
    return params.persisted;
  }

  // 3. If user skipped earlier during a prior session, only mark completed if they now have a usable Gemini key.
  // Otherwise, on refresh/reload/sign-in with empty Gemini keys, fall through so the tutorial starts again.
  if (params.persisted?.status === 'skipped' && hasAnyNonInvalid) {
    return {
      ...params.persisted,
      status: 'completed',
      step: 'completed',
      completedAtMs: nowMs,
      updatedAtMs: nowMs,
    };
  }

  // 4. First time on this device (no persisted state or idle) with an existing usable Gemini key:
  if (hasAnyNonInvalid) {
    // User already configured a Gemini key -> silently mark completed
    return {
      version: 1,
      status: 'completed',
      step: 'completed',
      returnRoute: safeReturnRoute,
      visitedAiStudioAtMs: null,
      skippedAtMs: null,
      completedAtMs: nowMs,
      updatedAtMs: nowMs,
    };
  }

  // Gemini keys are empty (or only invalid) on load/refresh/sign-in -> always start tutorial at Welcome
  return {
    version: 1,
    status: 'in_progress',
    step: 'welcome',
    returnRoute: safeReturnRoute,
    visitedAiStudioAtMs: null,
    skippedAtMs: null,
    completedAtMs: null,
    updatedAtMs: nowMs,
  };
}

/**
 * Computes which route SOTAL should restore when resuming an active onboarding session
 * (e.g., after returning from Google AI Studio or refreshing the browser).
 */
export function getRequiredRouteForStep(
  step: GeminiOnboardingStep,
  currentRoute: string
): string | null {
  if (step === 'get_key_popup' || step === 'paste_key') {
    return currentRoute === '/settings' ? null : '/settings';
  }
  if (step === 'open_profile' || step === 'open_settings') {
    if (currentRoute === '/settings') return null;
    // Routes where the top header (with the Profile button) is hidden
    const headerHiddenRoutes = new Set([
      '/tutor',
      '/automatic-study',
      '/live',
      '/history',
      '/manage-course',
      '/join',
      '/streak',
      '/dashboard',
    ]);
    if (headerHiddenRoutes.has(currentRoute)) {
      return '/courses';
    }
  }
  return null;
}

export function getStepProgressMeta(step: GeminiOnboardingStep): {
  current: number;
  total: number;
  label: string;
} {
  switch (step) {
    case 'welcome':
      return { current: 1, total: 4, label: 'Welcome' };
    case 'open_profile':
      return { current: 2, total: 4, label: 'Open profile' };
    case 'open_settings':
      return { current: 3, total: 4, label: 'Open Settings' };
    case 'get_key_popup':
    case 'paste_key':
      return { current: 4, total: 4, label: 'Connect Gemini key' };
    case 'completed':
      return { current: 4, total: 4, label: 'Complete' };
  }
}
