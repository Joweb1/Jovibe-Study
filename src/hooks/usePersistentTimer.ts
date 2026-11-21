import { useCallback, useEffect, useRef, useState } from 'react';

export const TIMER_PRESETS_MINUTES = [5, 10, 15, 20, 30, 45, 60] as const;

export type PersistentTimerStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface PersistentTimerState {
  status: PersistentTimerStatus;
  durationMinutes: number;
  untimed: boolean;
  /** Target wall-clock timestamp when status === 'running' */
  expiresAtMs: number | null;
  /** Remaining ms frozen when status === 'paused' */
  remainingMsWhenPaused: number;
  /** Timestamp when untimed session started (for elapsed stopwatch if desired) */
  startedAtMs: number | null;
}

export function computeRemainingMs(
  state: Pick<PersistentTimerState, 'status' | 'durationMinutes' | 'expiresAtMs' | 'remainingMsWhenPaused'>,
  nowMs: number = Date.now()
): number {
  if (state.status === 'completed') return 0;
  if (state.status === 'idle') return Math.max(0, Math.round(state.durationMinutes * 60_000));
  if (state.status === 'paused') return Math.max(0, Math.round(state.remainingMsWhenPaused));
  if (state.status === 'running' && state.expiresAtMs !== null) {
    return Math.max(0, state.expiresAtMs - nowMs);
  }
  return 0;
}

export function formatCountdownSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatHumanDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  if (safe < 60) return `${safe}s`;
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return secs > 0 && mins < 10 ? `${mins}m ${secs}s` : `${mins}m`;
}

/**
 * Plays a gentle two-tone harmonic chime using Web Audio API on timer completion.
 */
export function playTimerCompletionChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [587.33, 880.0]; // D5 -> A5 calm academic chime
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.16);
      gain.gain.setValueAtTime(0.0001, now + idx * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.16 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.16 + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.16);
      osc.stop(now + idx * 0.16 + 0.6);
    });

    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 1000);
  } catch {
    // Audio playback blocked or unavailable; visual completion indicator still fires
  }
}

function loadStoredTimer(storageKey: string, defaultMinutes: number): PersistentTimerState {
  const fallback: PersistentTimerState = {
    status: 'idle',
    durationMinutes: defaultMinutes,
    untimed: false,
    expiresAtMs: null,
    remainingMsWhenPaused: defaultMinutes * 60_000,
    startedAtMs: null,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistentTimerState>;
    const durationMinutes =
      typeof parsed.durationMinutes === 'number' && parsed.durationMinutes >= 1 && parsed.durationMinutes <= 180
        ? Math.round(parsed.durationMinutes)
        : defaultMinutes;
    const untimed = Boolean(parsed.untimed);
    const status: PersistentTimerStatus =
      parsed.status === 'running' || parsed.status === 'paused' || parsed.status === 'completed'
        ? parsed.status
        : 'idle';
    const expiresAtMs = typeof parsed.expiresAtMs === 'number' ? parsed.expiresAtMs : null;
    const remainingMsWhenPaused =
      typeof parsed.remainingMsWhenPaused === 'number'
        ? Math.max(0, parsed.remainingMsWhenPaused)
        : durationMinutes * 60_000;
    const startedAtMs = typeof parsed.startedAtMs === 'number' ? parsed.startedAtMs : null;

    if (!untimed && status === 'running' && expiresAtMs !== null && expiresAtMs <= Date.now()) {
      return {
        status: 'completed',
        durationMinutes,
        untimed: false,
        expiresAtMs: null,
        remainingMsWhenPaused: 0,
        startedAtMs,
      };
    }

    return {
      status,
      durationMinutes,
      untimed,
      expiresAtMs,
      remainingMsWhenPaused,
      startedAtMs,
    };
  } catch {
    return fallback;
  }
}

function saveStoredTimer(storageKey: string, state: PersistentTimerState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function usePersistentStudyTimer(
  storageKey: string = 'sotal_study_timer_v1',
  defaultMinutes: number = 25
) {
  const [state, setState] = useState<PersistentTimerState>(() =>
    loadStoredTimer(storageKey, defaultMinutes)
  );
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    computeRemainingMs(loadStoredTimer(storageKey, defaultMinutes))
  );
  const [elapsedUntimedSec, setElapsedUntimedSec] = useState<number>(0);

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    saveStoredTimer(storageKey, state);
  }, [storageKey, state]);

  useEffect(() => {
    const syncTick = () => {
      const cur = stateRef.current;
      if (cur.untimed) {
        if (cur.status === 'running' && cur.startedAtMs) {
          setElapsedUntimedSec(Math.max(0, Math.floor((Date.now() - cur.startedAtMs) / 1000)));
        }
        return;
      }

      const rem = computeRemainingMs(cur, Date.now());
      setRemainingMs(rem);

      if (cur.status === 'running' && rem <= 0) {
        playTimerCompletionChime();
        setState((prev) => ({
          ...prev,
          status: 'completed',
          expiresAtMs: null,
          remainingMsWhenPaused: 0,
        }));
      }
    };

    syncTick();
    const interval = window.setInterval(syncTick, 250);
    const handleVis = () => {
      if (document.visibilityState === 'visible') syncTick();
    };
    document.addEventListener('visibilitychange', handleVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVis);
    };
  }, []);

  const setDurationMinutes = useCallback((mins: number) => {
    const safe = Math.min(180, Math.max(1, Math.round(mins)));
    setState({
      status: 'idle',
      durationMinutes: safe,
      untimed: false,
      expiresAtMs: null,
      remainingMsWhenPaused: safe * 60_000,
      startedAtMs: null,
    });
    setRemainingMs(safe * 60_000);
    setElapsedUntimedSec(0);
  }, []);

  const setUntimedMode = useCallback((untimed: boolean) => {
    setState((prev) => ({
      ...prev,
      status: 'idle',
      untimed,
      expiresAtMs: null,
      remainingMsWhenPaused: prev.durationMinutes * 60_000,
      startedAtMs: null,
    }));
    setElapsedUntimedSec(0);
  }, []);

  const start = useCallback(() => {
    const cur = stateRef.current;
    const now = Date.now();
    if (cur.untimed) {
      setState((prev) => ({
        ...prev,
        status: 'running',
        startedAtMs: now,
        expiresAtMs: null,
      }));
      setElapsedUntimedSec(0);
      return;
    }
    const baseMs =
      cur.status === 'paused' && cur.remainingMsWhenPaused > 0
        ? cur.remainingMsWhenPaused
        : cur.durationMinutes * 60_000;
    setState((prev) => ({
      ...prev,
      status: 'running',
      expiresAtMs: now + baseMs,
      remainingMsWhenPaused: baseMs,
      startedAtMs: prev.startedAtMs ?? now,
    }));
    setRemainingMs(baseMs);
  }, []);

  const pause = useCallback(() => {
    const cur = stateRef.current;
    if (cur.status !== 'running') return;
    if (cur.untimed) {
      setState((prev) => ({ ...prev, status: 'paused' }));
      return;
    }
    const rem = computeRemainingMs(cur, Date.now());
    setState((prev) => ({
      ...prev,
      status: 'paused',
      expiresAtMs: null,
      remainingMsWhenPaused: rem,
    }));
    setRemainingMs(rem);
  }, []);

  const resume = useCallback(() => {
    const cur = stateRef.current;
    if (cur.status !== 'paused') return;
    const now = Date.now();
    if (cur.untimed) {
      setState((prev) => ({
        ...prev,
        status: 'running',
        startedAtMs: now - elapsedUntimedSec * 1000,
      }));
      return;
    }
    const rem = Math.max(1000, cur.remainingMsWhenPaused);
    setState((prev) => ({
      ...prev,
      status: 'running',
      expiresAtMs: now + rem,
    }));
    setRemainingMs(rem);
  }, [elapsedUntimedSec]);

  const reset = useCallback(() => {
    const cur = stateRef.current;
    setState({
      status: 'idle',
      durationMinutes: cur.durationMinutes,
      untimed: cur.untimed,
      expiresAtMs: null,
      remainingMsWhenPaused: cur.durationMinutes * 60_000,
      startedAtMs: null,
    });
    setRemainingMs(cur.durationMinutes * 60_000);
    setElapsedUntimedSec(0);
  }, []);

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const totalSeconds = state.durationMinutes * 60;
  const progressPercent =
    totalSeconds > 0
      ? Math.min(100, Math.max(0, Math.round(((totalSeconds - remainingSeconds) / totalSeconds) * 100)))
      : 0;

  return {
    status: state.status,
    durationMinutes: state.durationMinutes,
    untimed: state.untimed,
    remainingMs,
    remainingSeconds,
    elapsedUntimedSec,
    progressPercent,
    setDurationMinutes,
    setUntimedMode,
    start,
    pause,
    resume,
    reset,
  };
}

/**
 * Non-bypassable, timestamp-based countdown hook for timed CBT and Practice sessions.
 * - Persists `expiresAtMs` by `storageKey` so refreshing or reopening cannot reset or bypass timeout.
 * - Provides NO pause capability during timed exams/practice.
 * - Fires `onExpire` immediately if expired (including after sleep/reopen).
 */
export function useLockedSessionTimer(options: {
  enabled: boolean;
  durationMinutes: number;
  storageKey: string;
  stopped: boolean;
  onExpire: () => void;
}) {
  const { enabled, durationMinutes, storageKey, stopped, onExpire } = options;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const expiredFiredRef = useRef(false);

  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(() => {
    if (!enabled || durationMinutes <= 0) return null;
    if (typeof window !== 'undefined' && storageKey) {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { expiresAtMs?: number };
          if (typeof parsed.expiresAtMs === 'number' && Number.isFinite(parsed.expiresAtMs)) {
            return parsed.expiresAtMs;
          }
        }
      } catch {
        // Ignore storage read error
      }
    }
    const target = Date.now() + Math.round(durationMinutes * 60_000);
    if (typeof window !== 'undefined' && storageKey) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ expiresAtMs: target }));
      } catch {
        // Ignore storage write error
      }
    }
    return target;
  });

  // Sync storage when storageKey / enabled / duration changes
  useEffect(() => {
    expiredFiredRef.current = false;
    if (!enabled || durationMinutes <= 0) {
      setExpiresAtMs(null);
      return;
    }
    if (typeof window !== 'undefined' && storageKey) {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { expiresAtMs?: number };
          if (typeof parsed.expiresAtMs === 'number' && Number.isFinite(parsed.expiresAtMs)) {
            setExpiresAtMs(parsed.expiresAtMs);
            return;
          }
        }
      } catch {
        // Ignore
      }
    }
    const target = Date.now() + Math.round(durationMinutes * 60_000);
    setExpiresAtMs(target);
    if (typeof window !== 'undefined' && storageKey) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ expiresAtMs: target }));
      } catch {
        // Ignore
      }
    }
  }, [enabled, durationMinutes, storageKey]);

  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    if (!enabled || !expiresAtMs) return Math.round(durationMinutes * 60);
    return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
  });

  // Clean up persisted expiry once session is intentionally stopped/finished
  useEffect(() => {
    if (stopped && storageKey && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Ignore
      }
    }
  }, [stopped, storageKey]);

  useEffect(() => {
    if (!enabled || stopped || !expiresAtMs) return;

    const checkTick = () => {
      const rem = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
      setRemainingSeconds(rem);
      if (rem <= 0 && !expiredFiredRef.current) {
        expiredFiredRef.current = true;
        playTimerCompletionChime();
        if (storageKey && typeof window !== 'undefined') {
          try {
            window.localStorage.removeItem(storageKey);
          } catch {
            // Ignore
          }
        }
        onExpireRef.current();
      }
    };

    checkTick();
    const interval = window.setInterval(checkTick, 250);
    const handleVis = () => {
      if (document.visibilityState === 'visible') checkTick();
    };
    document.addEventListener('visibilitychange', handleVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVis);
    };
  }, [enabled, stopped, expiresAtMs, storageKey]);

  const totalSeconds = Math.max(1, Math.round(durationMinutes * 60));
  const isWarning = enabled && remainingSeconds > 15 && (remainingSeconds <= 60 || remainingSeconds / totalSeconds <= 0.2);
  const isUrgent = enabled && remainingSeconds <= 15;

  return {
    remainingSeconds,
    totalSeconds,
    isWarning,
    isUrgent,
    isExpired: enabled && remainingSeconds <= 0,
  };
}
