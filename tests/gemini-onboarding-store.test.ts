import assert from 'node:assert/strict';
import test from 'node:test';
import type { StoredApiKey } from '../src/services/ai/keyManager.ts';
import {
  createDefaultOnboardingState,
  resolveInitialOnboardingState,
  SETUP_REMINDER_COOLDOWN_MS,
} from '../src/services/onboarding/geminiOnboardingStore.ts';

const activeGeminiKey: StoredApiKey = {
  id: 'key_1',
  provider: 'gemini',
  label: 'Personal Key',
  key: 'AIzaTestKey123456',
  maskedKey: 'AIza••••3456',
  status: 'active',
  cooldownUntilMs: null,
  lastTestedAtMs: null,
  lastError: null,
  createdAtMs: 1_000_000,
};

test('resolveInitialOnboardingState does not re-show setup popup on page refresh within cooldown after skipping', () => {
  const skippedAt = 1_700_000_000_000;
  const skippedState = {
    ...createDefaultOnboardingState('/courses', skippedAt),
    status: 'skipped' as const,
    skippedAtMs: skippedAt,
    updatedAtMs: skippedAt,
  };

  // Refresh 5 seconds later -> stays skipped
  const refreshSoon = resolveInitialOnboardingState({
    persisted: skippedState,
    geminiKeys: [],
    currentRoute: '/courses',
    nowMs: skippedAt + 5_000,
  });
  assert.equal(refreshSoon.status, 'skipped');

  // Refresh 12 hours later -> still stays skipped
  const refreshHalfDay = resolveInitialOnboardingState({
    persisted: skippedState,
    geminiKeys: [],
    currentRoute: '/tutor',
    nowMs: skippedAt + 12 * 60 * 60 * 1000,
  });
  assert.equal(refreshHalfDay.status, 'skipped');
});

test('resolveInitialOnboardingState occasionally re-prompts once cooldown elapses when no key is configured', () => {
  const skippedAt = 1_700_000_000_000;
  const skippedState = {
    ...createDefaultOnboardingState('/courses', skippedAt),
    status: 'skipped' as const,
    skippedAtMs: skippedAt,
    updatedAtMs: skippedAt,
  };

  const afterCooldown = resolveInitialOnboardingState({
    persisted: skippedState,
    geminiKeys: [],
    currentRoute: '/courses',
    nowMs: skippedAt + SETUP_REMINDER_COOLDOWN_MS + 1,
  });
  assert.equal(afterCooldown.status, 'in_progress');
  assert.equal(afterCooldown.step, 'welcome');
});

test('resolveInitialOnboardingState marks skipped users completed once a usable Gemini key is added', () => {
  const skippedAt = 1_700_000_000_000;
  const skippedState = {
    ...createDefaultOnboardingState('/courses', skippedAt),
    status: 'skipped' as const,
    skippedAtMs: skippedAt,
    updatedAtMs: skippedAt,
  };

  const resolved = resolveInitialOnboardingState({
    persisted: skippedState,
    geminiKeys: [activeGeminiKey],
    currentRoute: '/courses',
    nowMs: skippedAt + 1_000,
  });
  assert.equal(resolved.status, 'completed');
  assert.equal(resolved.step, 'completed');
});

test('resolveInitialOnboardingState preserves mid-tutorial steps across refreshes', () => {
  const now = 1_700_000_000_000;
  const midGuide = {
    ...createDefaultOnboardingState('/courses', now),
    status: 'in_progress' as const,
    step: 'get_key_popup' as const,
  };

  const resumed = resolveInitialOnboardingState({
    persisted: midGuide,
    geminiKeys: [],
    currentRoute: '/settings',
    nowMs: now + 30_000,
  });
  assert.equal(resumed.status, 'in_progress');
  assert.equal(resumed.step, 'get_key_popup');
});
