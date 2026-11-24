import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyMicrophoneAccessFailure,
  ensureLiveMicrophoneAccess,
  queryMicrophonePermissionState,
  stopMediaStream,
} from '../src/utils/microphonePermission.ts';

function withMockedGlobals(
  overrides: {
    window?: unknown;
    navigator?: unknown;
  },
  fn: () => Promise<void> | void
): Promise<void> {
  const prevWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const prevNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  if ('window' in overrides) {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: overrides.window,
    });
  }
  if ('navigator' in overrides) {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: overrides.navigator,
    });
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevWindow) {
        Object.defineProperty(globalThis, 'window', prevWindow);
      } else {
        delete (globalThis as Record<string, unknown>).window;
      }
      if (prevNavigator) {
        Object.defineProperty(globalThis, 'navigator', prevNavigator);
      } else {
        delete (globalThis as Record<string, unknown>).navigator;
      }
    });
}

test('classifyMicrophoneAccessFailure identifies interactive denial vs permanent suppression', () => {
  const interactiveDenial = classifyMicrophoneAccessFailure({
    errorName: 'NotAllowedError',
    errorMessage: 'Permission denied',
    priorBrowserState: 'prompt',
    postBrowserState: 'denied',
    elapsedMs: 1100,
    attemptNumber: 1,
    isSecureContext: true,
  });
  assert.equal(interactiveDenial.status, 'denied_retryable');
  assert.equal(interactiveDenial.title, 'Microphone access is required for Live AI');

  const suppressedDenial = classifyMicrophoneAccessFailure({
    errorName: 'NotAllowedError',
    errorMessage: 'Permission denied',
    priorBrowserState: 'denied',
    postBrowserState: 'denied',
    elapsedMs: 8,
    attemptNumber: 1,
    isSecureContext: true,
  });
  assert.equal(suppressedDenial.status, 'permanently_denied');
  assert.ok(suppressedDenial.settingsHint && suppressedDenial.settingsHint.length > 0);

  const repeatedDenial = classifyMicrophoneAccessFailure({
    errorName: 'NotAllowedError',
    errorMessage: 'Permission denied by user',
    priorBrowserState: 'prompt',
    postBrowserState: 'denied',
    elapsedMs: 450,
    attemptNumber: 2,
    isSecureContext: true,
  });
  assert.equal(repeatedDenial.status, 'permanently_denied');
});

test('classifyMicrophoneAccessFailure handles missing hardware, busy mic, and insecure context', () => {
  const noMic = classifyMicrophoneAccessFailure({
    errorName: 'NotFoundError',
    errorMessage: 'Requested device not found',
    priorBrowserState: 'prompt',
    postBrowserState: 'prompt',
    elapsedMs: 20,
    attemptNumber: 1,
    isSecureContext: true,
  });
  assert.equal(noMic.status, 'unavailable');

  const busyMic = classifyMicrophoneAccessFailure({
    errorName: 'NotReadableError',
    errorMessage: 'Could not start audio source',
    priorBrowserState: 'granted',
    postBrowserState: 'granted',
    elapsedMs: 40,
    attemptNumber: 1,
    isSecureContext: true,
  });
  assert.equal(busyMic.status, 'denied_retryable');

  const insecure = classifyMicrophoneAccessFailure({
    errorName: 'NotAllowedError',
    errorMessage: 'Only secure origins are allowed',
    priorBrowserState: 'unknown',
    postBrowserState: 'unknown',
    elapsedMs: 5,
    attemptNumber: 1,
    isSecureContext: false,
  });
  assert.equal(insecure.status, 'unavailable');
});

test('ensureLiveMicrophoneAccess checks permission and respects acquireStreamIfGranted', async () => {
  let getUserMediaCalls = 0;
  const fakeStream = { getTracks: () => [] } as unknown as MediaStream;

  await withMockedGlobals(
    {
      window: { isSecureContext: true },
      navigator: {
        permissions: {
          query: async () => ({ state: 'granted' }),
        },
        mediaDevices: {
          getUserMedia: async () => {
            getUserMediaCalls += 1;
            return fakeStream;
          },
        },
      },
    },
    async () => {
      assert.equal(await queryMicrophonePermissionState(), 'granted');

      const checkOnly = await ensureLiveMicrophoneAccess({ acquireStreamIfGranted: false });
      assert.equal(checkOnly.status, 'granted');
      assert.equal(checkOnly.stream, null);
      assert.equal(getUserMediaCalls, 0);

      const withStream = await ensureLiveMicrophoneAccess({ acquireStreamIfGranted: true });
      assert.equal(withStream.status, 'granted');
      assert.equal(withStream.stream, fakeStream);
      assert.equal(getUserMediaCalls, 1);
    }
  );
});

test('ensureLiveMicrophoneAccess retries legitimately when previously denied and handles suppression', async () => {
  let permState: 'denied' | 'granted' = 'denied';
  let calls = 0;

  await withMockedGlobals(
    {
      window: { isSecureContext: true },
      navigator: {
        permissions: {
          query: async () => ({ state: permState }),
        },
        mediaDevices: {
          getUserMedia: async () => {
            calls += 1;
            if (permState === 'denied') {
              const err = new Error('Permission denied');
              err.name = 'NotAllowedError';
              throw err;
            }
            return { getTracks: () => [] } as unknown as MediaStream;
          },
        },
      },
    },
    async () => {
      // Even when prior state is 'denied', Live AI calls getUserMedia legitimately
      const suppressed = await ensureLiveMicrophoneAccess({ attemptNumber: 1 });
      assert.equal(calls, 1);
      assert.equal(suppressed.status, 'permanently_denied');
      assert.equal(suppressed.stream, null);

      // If user enables permission in Settings and retries, Live AI proceeds seamlessly
      permState = 'granted';
      const recovered = await ensureLiveMicrophoneAccess({ attemptNumber: 2 });
      assert.equal(calls, 2);
      assert.equal(recovered.status, 'granted');
      assert.ok(recovered.stream);
    }
  );
});

test('ensureLiveMicrophoneAccess degrades gracefully when mediaDevices is absent & stopMediaStream cleans tracks', async () => {
  await withMockedGlobals(
    {
      window: { isSecureContext: true },
      navigator: {},
    },
    async () => {
      const res = await ensureLiveMicrophoneAccess();
      assert.equal(res.status, 'unavailable');
      assert.equal(res.stream, null);
    }
  );

  let stopped = 0;
  const mockStream = {
    getTracks: () => [
      { onended: () => {}, stop: () => { stopped += 1; } },
      { onended: () => {}, stop: () => { stopped += 1; } },
    ],
  } as unknown as MediaStream;
  stopMediaStream(mockStream);
  assert.equal(stopped, 2);
});
