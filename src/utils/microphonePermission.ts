export type MicrophonePermissionUiState =
  | 'checking'
  | 'granted'
  | 'denied_retryable'
  | 'permanently_denied'
  | 'unavailable';

export type BrowserPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface MicrophoneAccessResult {
  status: MicrophonePermissionUiState;
  browserState: BrowserPermissionState;
  stream: MediaStream | null;
  title: string;
  message: string;
  settingsHint?: string;
}

export interface ErrorClassificationInput {
  errorName?: string;
  errorMessage?: string;
  priorBrowserState: BrowserPermissionState;
  postBrowserState: BrowserPermissionState;
  elapsedMs: number;
  attemptNumber: number;
  isSecureContext?: boolean;
}

export const DEFAULT_MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Pure classification logic for getUserMedia failures so both runtime Live AI
 * and automated unit tests use the exact same rules.
 */
export function classifyMicrophoneAccessFailure(
  input: ErrorClassificationInput
): Omit<MicrophoneAccessResult, 'stream'> {
  const name = (input.errorName || '').trim();
  const msg = (input.errorMessage || '').toLowerCase();
  const effectiveBrowserState =
    input.postBrowserState !== 'unknown'
      ? input.postBrowserState
      : input.priorBrowserState;

  if (input.isSecureContext === false) {
    return {
      status: 'unavailable',
      browserState: effectiveBrowserState,
      title: 'Secure connection required for microphone',
      message:
        'Microphone access is disabled because this page is not running in a secure HTTPS context.',
      settingsHint:
        'Open Jovibe Study over HTTPS (or localhost) to allow microphone access for Live AI.',
    };
  }

  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    msg.includes('requested device not found')
  ) {
    return {
      status: 'unavailable',
      browserState: effectiveBrowserState,
      title: 'No microphone detected',
      message:
        'Live AI needs a working microphone to hear your voice. Connect or enable a microphone on this device, then try again.',
      settingsHint:
        'Check your device audio input settings or plug in a headset with a microphone.',
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      status: 'denied_retryable',
      browserState: effectiveBrowserState,
      title: 'Microphone is busy',
      message:
        'Another app or call is currently using your microphone. Close the other audio app and tap Retry.',
    };
  }

  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError' ||
    msg.includes('permission denied') ||
    msg.includes('not allowed')
  ) {
    // Distinguish an interactive user dismissal from a silent/permanent OS or browser block:
    // - If browser Permissions API already reported 'denied' before requesting AND rejected almost immediately (< 220ms),
    //   or if repeated attempts continue rejecting immediately under 'denied', the OS/browser suppressed the dialog.
    const likelySuppressedPrompt =
      (input.priorBrowserState === 'denied' && input.elapsedMs < 220) ||
      (effectiveBrowserState === 'denied' && input.elapsedMs < 220) ||
      (effectiveBrowserState === 'denied' && input.attemptNumber >= 2);

    if (likelySuppressedPrompt) {
      return {
        status: 'permanently_denied',
        browserState: 'denied',
        title: 'Microphone permission is blocked',
        message:
          'Your browser or device settings are blocking microphone access for Jovibe Study, so the permission prompt cannot be shown automatically.',
        settingsHint:
          'Open App Settings to check microphone access, or allow Microphone in your browser site permissions / Android App info > Permissions > Microphone, then return and tap Retry.',
      };
    }

    return {
      status: 'denied_retryable',
      browserState: effectiveBrowserState,
      title: 'Microphone access is required for Live AI',
      message:
        'Jovibe Live uses real-time two-way voice. Allow microphone access when prompted so your study companion can hear you.',
    };
  }

  return {
    status: 'denied_retryable',
    browserState: effectiveBrowserState,
    title: 'Could not start microphone',
    message:
      input.errorMessage?.trim() ||
      'Microphone initialization was interrupted. Please tap Retry to request access again.',
  };
}

export async function queryMicrophonePermissionState(): Promise<BrowserPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return 'unknown';
  }
  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Checks browser microphone permission and legitimately requests access when needed.
 * Note: browsers/OS control whether a previously denied prompt can be shown again.
 */
export async function ensureLiveMicrophoneAccess(options?: {
  attemptNumber?: number;
  acquireStreamIfGranted?: boolean;
}): Promise<MicrophoneAccessResult> {
  const attemptNumber = options?.attemptNumber ?? 1;
  const acquireStreamIfGranted = options?.acquireStreamIfGranted ?? true;

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return {
      status: 'unavailable',
      browserState: 'unknown',
      stream: null,
      title: 'Secure connection required for microphone',
      message:
        'Microphone access requires HTTPS. Please open Jovibe Study over a secure HTTPS connection.',
    };
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      status: 'unavailable',
      browserState: 'unknown',
      stream: null,
      title: 'Microphone not supported on this browser',
      message:
        'This browser or WebView does not expose microphone recording APIs needed for Live AI.',
      settingsHint:
        'Open Jovibe Study in a modern browser (Chrome, Edge, or Safari) with microphone support.',
    };
  }

  const priorBrowserState = await queryMicrophonePermissionState();

  // If already granted and caller does not need an audio stream returned immediately,
  // we can still return granted quickly. When entering Live AI, acquireStreamIfGranted=true
  // obtains the live stream once and hands it to LiveVoiceClient without a duplicate prompt.
  if (priorBrowserState === 'granted' && !acquireStreamIfGranted) {
    return {
      status: 'granted',
      browserState: 'granted',
      stream: null,
      title: 'Microphone granted',
      message: 'Microphone access is enabled for Live AI.',
    };
  }

  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: DEFAULT_MIC_AUDIO_CONSTRAINTS,
    });
    const postBrowserState = await queryMicrophonePermissionState();
    return {
      status: 'granted',
      browserState: postBrowserState === 'unknown' ? 'granted' : postBrowserState,
      stream,
      title: 'Microphone ready',
      message: 'Microphone access granted.',
    };
  } catch (err) {
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsedMs = Math.max(0, endedAt - startedAt);
    const postBrowserState = await queryMicrophonePermissionState();
    const domErr = err as { name?: string; message?: string } | null;

    const classified = classifyMicrophoneAccessFailure({
      errorName: domErr?.name,
      errorMessage: domErr?.message,
      priorBrowserState,
      postBrowserState,
      elapsedMs,
      attemptNumber,
      isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : true,
    });

    return {
      ...classified,
      stream: null,
    };
  }
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      try {
        track.onended = null;
        track.stop();
      } catch {
        // Ignore track stop errors
      }
    });
  } catch {
    // Ignore stream cleanup errors
  }
}

export function subscribeMicrophonePermissionChange(
  onChange: (nextState: BrowserPermissionState) => void
): () => void {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return () => {};
  }

  let active = true;
  let statusObj: PermissionStatus | null = null;

  const handler = () => {
    if (!active || !statusObj) return;
    const s = statusObj.state;
    onChange(s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'unknown');
  };

  void navigator.permissions
    .query({ name: 'microphone' as PermissionName })
    .then((status) => {
      if (!active) return;
      statusObj = status;
      statusObj.addEventListener?.('change', handler);
    })
    .catch(() => {
      // Browser does not support querying microphone permission status
    });

  return () => {
    active = false;
    if (statusObj) {
      statusObj.removeEventListener?.('change', handler);
      statusObj = null;
    }
  };
}
