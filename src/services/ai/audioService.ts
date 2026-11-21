import type { GeminiTtsVoice } from '../../types/models';
import { getCachedTutorAudio, saveCachedTutorAudio } from '../local/indexedDb';
import { synthesizeSpeechWithClient } from './geminiClient';

export interface AudioPersistenceMeta {
  userId: string;
  courseId: string;
  conversationId: string;
}

const MAX_SPEECH_CHARS = 3200;

/**
 * Strips heavy Markdown formatting so Gemini 3.8 TTS reads natural academic prose
 * cleanly without speaking raw asterisks, hashes, or code fences.
 */
export function prepareTextForSpeech(markdown: string): string {
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, ' (code snippet omitted for audio) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\|/g, ', ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (cleaned.length <= MAX_SPEECH_CHARS) {
    return cleaned;
  }
  const truncated = cleaned.slice(0, MAX_SPEECH_CHARS);
  const lastPeriod = truncated.lastIndexOf('.');
  return lastPeriod > MAX_SPEECH_CHARS * 0.7
    ? `${truncated.slice(0, lastPeriod + 1)}`
    : `${truncated}...`;
}

function base64ToBlob(base64: string, mimeType = 'audio/wav'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused';

export interface PlaybackState {
  activeId: string | null;
  status: PlaybackStatus;
  voiceName: GeminiTtsVoice | null;
  error: string | null;
}

type PlaybackListener = (state: PlaybackState) => void;

/**
 * Single-active audio playback controller for Gemini 3.8 TTS WAV clips.
 * Caches generated Blob URLs in session memory keyed by (id, voiceName) so
 * replaying a reply is instant without re-generating audio.
 */
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

function probeBlobDuration(blobUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = 'metadata';
    let settled = false;
    const finish = (val: number | null) => {
      if (settled) return;
      settled = true;
      probe.onloadedmetadata = null;
      probe.onerror = null;
      probe.src = '';
      resolve(val);
    };
    const timer = window.setTimeout(() => finish(null), 1500);
    probe.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null);
    };
    probe.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    probe.src = blobUrl;
  });
}

class GeminiAudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private unlockedAudio: HTMLAudioElement | null = null;
  private cache = new Map<string, string>();
  private listeners = new Set<PlaybackListener>();
  private abortController: AbortController | null = null;
  private playbackToken = 0;
  private state: PlaybackState = {
    activeId: null,
    status: 'idle',
    voiceName: null,
    error: null,
  };

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): PlaybackState {
    return this.state;
  }

  /**
   * Synchronously primes a reusable HTMLAudioElement inside a user interaction
   * handler so subsequent async TTS playback auto-plays cleanly across browsers.
   */
  unlockForAutoplay(): void {
    try {
      if (!this.unlockedAudio) {
        this.unlockedAudio = new Audio();
      }
      if (this.audio === this.unlockedAudio && !this.unlockedAudio.paused) {
        return;
      }
      const el = this.unlockedAudio;
      el.muted = true;
      el.src = SILENT_WAV_DATA_URI;
      const playPromise = el.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (this.audio !== el) {
              el.pause();
              el.currentTime = 0;
              el.muted = false;
            }
          })
          .catch(() => {
            el.muted = false;
          });
      }
    } catch {
      // Ignore browser audio priming errors
    }
  }

  getAudioProgress(id: string): { currentTime: number; duration: number; playing: boolean } | null {
    if (this.state.activeId !== id || !this.audio) return null;
    const duration =
      Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : 0;
    return {
      currentTime: this.audio.currentTime || 0,
      duration,
      playing: this.state.status === 'playing' && !this.audio.paused,
    };
  }

  private emit(patch: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  stop(): void {
    this.playbackToken += 1;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio = null;
    }
    this.emit({ activeId: null, status: 'idle', error: null });
  }

  togglePause(): void {
    if (!this.audio) return;
    if (this.audio.paused) {
      void this.audio.play();
      this.emit({ status: 'playing', error: null });
    } else {
      this.audio.pause();
      this.emit({ status: 'paused' });
    }
  }

  clearMemoryCache(): void {
    this.stop();
    for (const url of this.cache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revoke errors
      }
    }
    this.cache.clear();
  }

  /**
   * Pre-synthesizes TTS audio for a message and caches its Blob URL (and optionally
   * persists the audio Blob in IndexedDB mapped to `params.id`) without starting playback yet.
   */
  async preloadMessage(params: {
    id: string;
    text: string;
    voiceName: GeminiTtsVoice;
    style?: string;
    signal?: AbortSignal;
    persist?: AudioPersistenceMeta;
  }): Promise<{ blobUrl: string; durationSeconds: number | null }> {
    const speechText = prepareTextForSpeech(params.text);
    if (!speechText) {
      throw new Error('There is no readable text in this response.');
    }

    const cacheKey = params.persist ? params.id : `${params.id}::${params.voiceName}`;
    let blobUrl = this.cache.get(cacheKey);

    if (!blobUrl && params.persist) {
      const persisted = await getCachedTutorAudio(params.id);
      if (params.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (persisted?.audioBlob) {
        blobUrl = URL.createObjectURL(persisted.audioBlob);
        this.cache.set(cacheKey, blobUrl);
      }
    }

    if (!blobUrl) {
      const res = await synthesizeSpeechWithClient({
        text: speechText,
        voiceName: params.voiceName,
        style: params.style || 'Clear, calm, articulate academic tutor',
        signal: params.signal,
      });

      if (params.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const blob = base64ToBlob(res.audioBase64, res.mimeType);
      blobUrl = URL.createObjectURL(blob);
      this.cache.set(cacheKey, blobUrl);

      if (params.persist) {
        void saveCachedTutorAudio({
          messageId: params.id,
          userId: params.persist.userId,
          courseId: params.persist.courseId,
          conversationId: params.persist.conversationId,
          voiceName: params.voiceName,
          mimeType: res.mimeType || 'audio/wav',
          audioBlob: blob,
        });
      }
    }

    const durationSeconds = await probeBlobDuration(blobUrl);
    return { blobUrl, durationSeconds };
  }

  async playMessage(params: {
    id: string;
    text: string;
    voiceName: GeminiTtsVoice;
    playbackRate?: number;
    style?: string;
    persist?: AudioPersistenceMeta;
  }): Promise<boolean> {
    // Toggle pause/resume if clicking the currently active item
    if (
      this.state.activeId === params.id &&
      (Boolean(params.persist) || this.state.voiceName === params.voiceName)
    ) {
      if (this.state.status === 'playing' || this.state.status === 'paused') {
        this.togglePause();
        return this.state.status === 'playing';
      }
      if (this.state.status === 'loading') {
        this.stop();
        return false;
      }
    }

    this.stop();
    const currentToken = this.playbackToken;

    const cacheKey = params.persist ? params.id : `${params.id}::${params.voiceName}`;
    let blobUrl = this.cache.get(cacheKey);
    let resolvedVoice: GeminiTtsVoice = params.voiceName;

    // Prime audio element synchronously inside the user click gesture before any async work
    if (!blobUrl) {
      this.unlockForAutoplay();
    }

    // Check browser-local IndexedDB cache first so refreshed pages replay instantly without regenerating
    if (!blobUrl && params.persist) {
      const persisted = await getCachedTutorAudio(params.id);
      if (currentToken !== this.playbackToken) return false;
      if (persisted?.audioBlob) {
        blobUrl = URL.createObjectURL(persisted.audioBlob);
        this.cache.set(cacheKey, blobUrl);
        if (persisted.voiceName) {
          resolvedVoice = persisted.voiceName as GeminiTtsVoice;
        }
      }
    }

    if (!blobUrl) {
      const speechText = prepareTextForSpeech(params.text);
      if (!speechText) {
        this.emit({
          activeId: params.id,
          status: 'idle',
          voiceName: params.voiceName,
          error: 'There is no readable text in this response.',
        });
        return false;
      }

      const controller = new AbortController();
      this.abortController = controller;
      this.emit({
        activeId: params.id,
        status: 'loading',
        voiceName: params.voiceName,
        error: null,
      });

      try {
        const res = await synthesizeSpeechWithClient({
          text: speechText,
          voiceName: params.voiceName,
          style: params.style || 'Clear, calm, articulate academic tutor',
          signal: controller.signal,
        });

        if (controller.signal.aborted) return false;

        const blob = base64ToBlob(res.audioBase64, res.mimeType);
        blobUrl = URL.createObjectURL(blob);
        this.cache.set(cacheKey, blobUrl);

        if (params.persist) {
          void saveCachedTutorAudio({
            messageId: params.id,
            userId: params.persist.userId,
            courseId: params.persist.courseId,
            conversationId: params.persist.conversationId,
            voiceName: params.voiceName,
            mimeType: res.mimeType || 'audio/wav',
            audioBlob: blob,
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return false;
        const message =
          err instanceof Error ? err.message : 'Unable to generate voice playback.';
        this.emit({
          activeId: params.id,
          status: 'idle',
          voiceName: params.voiceName,
          error: message,
        });
        return false;
      } finally {
        if (this.abortController === controller) {
          this.abortController = null;
        }
      }
    }

    const audio = this.unlockedAudio || new Audio();
    audio.muted = false;
    audio.src = blobUrl;
    audio.currentTime = 0;
    audio.playbackRate = Math.min(2.0, Math.max(0.5, params.playbackRate ?? 1.0));
    audio.onended = () => {
      this.audio = null;
      this.emit({ activeId: null, status: 'idle', error: null });
    };
    audio.onerror = () => {
      this.audio = null;
      this.emit({
        activeId: params.id,
        status: 'idle',
        error: 'Audio playback failed in this browser.',
      });
    };

    this.audio = audio;
    try {
      await audio.play();
      this.emit({
        activeId: params.id,
        status: 'playing',
        voiceName: resolvedVoice,
        error: null,
      });
      return true;
    } catch (err) {
      this.audio = null;
      this.emit({
        activeId: params.id,
        status: 'idle',
        error: err instanceof Error ? err.message : 'Browser blocked audio playback.',
      });
      return false;
    }
  }
}

export const geminiAudioPlayer = new GeminiAudioPlayer();

export interface RecordedAudioPayload {
  audioBase64: string;
  mimeType: string;
  durationSeconds: number;
}

function pickSupportedAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'audio/webm';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to encode recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Browser MediaRecorder wrapper for recording study voice notes and exporting
 * base64 audio ready for Gemini 3.5 Transcribe.
 */
export class VoiceNoteRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAtMs = 0;
  private mimeType = 'audio/webm';

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  async start(): Promise<void> {
    if (!VoiceNoteRecorder.isSupported()) {
      throw new Error('Voice recording is not supported in this browser.');
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw new Error(
        'Microphone access was denied or unavailable. Allow microphone permission to record voice notes.'
      );
    }

    this.mimeType = pickSupportedAudioMime();
    this.chunks = [];
    this.startedAtMs = Date.now();

    const recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.recorder = recorder;
    recorder.start(250);
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // Ignore stop errors during cancel
      }
    }
    this.cleanupTracks();
    this.chunks = [];
  }

  async stop(): Promise<RecordedAudioPayload> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      this.cleanupTracks();
      throw new Error('No active voice recording.');
    }

    const durationSeconds = Math.max(1, Math.round((Date.now() - this.startedAtMs) / 1000));

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const cleanMime = this.mimeType.split(';')[0] || 'audio/webm';
        resolve(new Blob(this.chunks, { type: cleanMime }));
      };
      recorder.onerror = () => reject(new Error('Voice recording encountered an error.'));
      recorder.stop();
    });

    this.cleanupTracks();

    if (blob.size < 200) {
      throw new Error('Recording was too short. Hold and speak clearly, then stop to transcribe.');
    }

    const audioBase64 = await blobToBase64(blob);
    const cleanMime = (blob.type || this.mimeType).split(';')[0] || 'audio/webm';

    return {
      audioBase64,
      mimeType: cleanMime,
      durationSeconds,
    };
  }

  private cleanupTracks(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    this.recorder = null;
  }
}
