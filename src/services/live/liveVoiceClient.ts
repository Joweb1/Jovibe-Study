import type {
  LiveLessonContext,
  LiveNetworkQuality,
  LiveNetworkStatus,
  LiveVoiceState,
} from '../../components/live/types';
import {
  buildProviderCandidates,
  canUseServerFallbackKey,
  hasUserEnteredOwnKey,
  recordApiKeyFailure,
  recordApiKeySuccess,
  type ExecutionCandidate,
} from '../ai/keyManager';
import { emitApiKeyLimitReached } from '../ai/keyLimitBus';
import { emitQuotaSnapshot, getFirebaseIdToken } from '../api/authHeaders';

export interface LiveVoiceCallbacks {
  onStateChange: (state: LiveVoiceState) => void;
  onAudioLevel: (level: number) => void;
  onTranscript: (speaker: 'companion' | 'student' | 'system', text: string) => void;
  onStatusDetail?: (detail: string | null) => void;
  onNeedsAudioUnlock?: (needsUnlock: boolean) => void;
  onNetworkStatus?: (status: LiveNetworkStatus) => void;
  onError?: (message: string | null) => void;
}

export interface LiveConnectOptions {
  lesson: LiveLessonContext;
  voiceName?: string;
  sendGreeting?: boolean;
}

interface ServerLiveMessage {
  type:
    | 'ready'
    | 'audio'
    | 'interimInputTranscript'
    | 'inputTranscript'
    | 'outputTranscript'
    | 'interrupted'
    | 'turnComplete'
    | 'error'
    | 'closed'
    | 'pong';
  data?: string;
  mimeType?: string;
  text?: string;
  message?: string;
  code?: string | number;
  shouldRotateKey?: boolean;
  cooldownMs?: number;
  reason?: string;
  ts?: number;
}

interface NavigatorConnectionLike {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

const TARGET_INPUT_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

const MIC_WORKLET_PROCESSOR_NAME = 'sotal-live-mic-processor';
const MIC_WORKLET_CODE = `
class SotalLiveMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 4096;
    this._buffer = new Float32Array(this._bufferSize);
    this._offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    let readIdx = 0;
    while (readIdx < channel.length) {
      const remaining = this._bufferSize - this._offset;
      const toCopy = Math.min(remaining, channel.length - readIdx);
      this._buffer.set(channel.subarray(readIdx, readIdx + toCopy), this._offset);
      this._offset += toCopy;
      readIdx += toCopy;
      if (this._offset >= this._bufferSize) {
        const chunk = this._buffer;
        this.port.postMessage(chunk, [chunk.buffer]);
        this._buffer = new Float32Array(this._bufferSize);
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('${MIC_WORKLET_PROCESSOR_NAME}', SotalLiveMicProcessor);
`;

function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_INPUT_RATE) return input;
  const ratio = sourceRate / TARGET_INPUT_RATE;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLength);

  if (ratio > 1) {
    // Box-averaging decimation prevents high-frequency aliasing when downsampling 44.1/48kHz -> 16kHz
    for (let i = 0; i < outLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += input[j];
      }
      out[i] = sum / (end - start);
    }
    return out;
  }

  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

function float32ToBase64Pcm16(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    view.setInt16(i * 2, int16, true);
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const byteLen = binary.length;
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const sampleCount = Math.floor(byteLen / 2);
  const floats = new Float32Array(new ArrayBuffer(sampleCount * 4));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < sampleCount; i++) {
    floats[i] = view.getInt16(i * 2, true) / 32768;
  }
  return floats;
}

function parseSampleRateFromMime(mimeType?: string): number {
  if (!mimeType) return OUTPUT_SAMPLE_RATE;
  const match = mimeType.match(/rate=(\d+)/i);
  if (match && match[1]) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed >= 8000 && parsed <= 48000) {
      return parsed;
    }
  }
  return OUTPUT_SAMPLE_RATE;
}

function buildWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/live`;
}

export class LiveVoiceClient {
  private callbacks: LiveVoiceCallbacks;
  private ws: WebSocket | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private outputTimeData: Uint8Array<ArrayBuffer> | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micWorkletNode: AudioWorkletNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;

  private activeOutputSources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private outputMeterRaf = 0;
  private interruptTimer = 0;
  private keepAliveTimer = 0;

  private muted = false;
  private disposed = false;
  private isConnected = false;
  private modelTurnComplete = true;
  private userSpeakingHoldUntil = 0;
  private micAvailable = false;
  private micErrorDetail: string | null = null;

  // Adaptive client-side noise gate to suppress distant background chatter/noise
  private ambientNoiseFloor = 0.006;
  private noiseGateOpenUntil = 0;

  // Real-time network quality monitoring (WebSocket RTT + upload backpressure + browser signals)
  private lastPingSentAt = 0;
  private awaitingPong = false;
  private smoothedRttMs: number | null = null;
  private lastNetworkQuality: LiveNetworkQuality = 'good';
  private lastEmittedRttMs: number | null = null;
  private networkListenersBound = false;

  private currentSpeaker: 'companion' | 'student' | 'system' = 'companion';
  private companionTranscriptBuffer = '';
  private studentTranscriptBuffer = '';

  constructor(callbacks: LiveVoiceCallbacks) {
    this.callbacks = callbacks;
  }

  public get connected(): boolean {
    return this.isConnected;
  }

  public get hasMicrophone(): boolean {
    return this.micAvailable;
  }

  public async connect(options: LiveConnectOptions): Promise<boolean> {
    this.disconnect(true);
    this.disposed = false;
    this.muted = false;
    this.micErrorDetail = null;
    this.callbacks.onError?.(null);
    this.callbacks.onStatusDetail?.('Connecting...');
    this.callbacks.onStateChange('thinking');
    this.callbacks.onAudioLevel(0.24);

    // Prepare output AudioContext immediately (inside user gesture if possible)
    this.ensureOutputAudioContext();

    // Request microphone access (gracefully continue in text/listen-only mode if denied)
    await this.setupMicrophone();
    if (this.disposed) return false;

    const candidates = buildProviderCandidates('gemini');
    const attemptList: ExecutionCandidate[] =
      candidates.length > 0
        ? candidates
        : canUseServerFallbackKey()
        ? [
            {
              provider: 'gemini',
              kind: 'server_fallback',
              keyId: null,
              label: 'Server GEMINI_API_KEY',
              apiKey: null,
            },
          ]
        : [];

    if (attemptList.length === 0) {
      const limitMsg =
        'Your Gemini API key has reached its limit. Add another Google account Gemini key or a fallback key in Settings to continue.';
      if (hasUserEnteredOwnKey()) {
        emitApiKeyLimitReached({
          provider: 'gemini',
          task: 'live',
          reason: 'all_keys_cooling_down',
          message: limitMsg,
        });
      }
      if (!this.disposed) {
        this.callbacks.onStatusDetail?.(null);
        this.callbacks.onError?.(limitMsg);
        this.callbacks.onStateChange('disconnected');
        this.callbacks.onAudioLevel(0);
      }
      return false;
    }

    let lastErrorMessage = 'Could not connect to Jovibe Live right now.';
    let sawLimitFailure = false;
    const idToken = await getFirebaseIdToken(false);
    const liveRequestId = `live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    for (const candidate of attemptList) {
      if (this.disposed) return false;
      const result = await this.openSocketWithCandidate(candidate, options, idToken, liveRequestId);
      if (result.ok) {
        this.isConnected = true;
        if (candidate.keyId) {
          recordApiKeySuccess(candidate.keyId);
        }
        // Preserve any mic error detail rather than erasing it on socket connect
        this.callbacks.onStatusDetail?.(this.micErrorDetail);
        this.callbacks.onError?.(null);
        this.emitAudioUnlockState();
        this.smoothedRttMs = null;
        this.awaitingPong = false;
        this.lastPingSentAt = 0;
        this.bindNetworkListeners();
        this.evaluateNetworkQuality();
        if (!options.sendGreeting) {
          this.callbacks.onStateChange(this.micAvailable && !this.muted ? 'listening' : 'idle');
          this.callbacks.onAudioLevel(this.micAvailable && !this.muted ? 0.18 : 0.14);
        }
        this.startKeepAlive();
        return true;
      }

      lastErrorMessage = result.errorMessage || lastErrorMessage;
      if (result.code === 'FREE_TRIAL_EXPIRED') {
        emitApiKeyLimitReached({
          provider: 'gemini',
          task: 'live',
          reason: 'free_trial_expired',
          message: lastErrorMessage,
        });
        break;
      }
      if (result.code === 'SHARED_QUOTA_EXHAUSTED') {
        emitApiKeyLimitReached({
          provider: 'gemini',
          task: 'live',
          reason: 'shared_quota_exhausted',
          message: lastErrorMessage,
        });
        break;
      }
      if (candidate.keyId && result.shouldRotateKey) {
        recordApiKeyFailure(
          candidate.keyId,
          result.code || 'RATE_LIMIT',
          lastErrorMessage,
          result.cooldownMs ?? 60_000
        );
      }
      if (
        candidate.kind === 'byok' &&
        (result.code === 'RATE_LIMIT' ||
          result.code === 'QUOTA_EXHAUSTED' ||
          result.shouldRotateKey)
      ) {
        sawLimitFailure = true;
      }

      if (!result.shouldRotateKey) {
        break;
      }
    }

    if (sawLimitFailure && hasUserEnteredOwnKey()) {
      emitApiKeyLimitReached({
        provider: 'gemini',
        task: 'live',
        reason: 'quota_exhausted',
        message: lastErrorMessage,
      });
    }

    if (!this.disposed) {
      this.callbacks.onStatusDetail?.(null);
      this.callbacks.onError?.(lastErrorMessage);
      this.callbacks.onStateChange('disconnected');
      this.callbacks.onAudioLevel(0);
    }
    return false;
  }

  private emitAudioUnlockState(): void {
    const outputSuspended = this.outputCtx?.state === 'suspended';
    const inputSuspended = this.micAvailable && !this.muted && this.inputCtx?.state === 'suspended';
    this.callbacks.onNeedsAudioUnlock?.(Boolean(outputSuspended || inputSuspended));
  }

  private ensureOutputAudioContext(): void {
    if (this.outputCtx) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.outputCtx = new AudioCtx({ sampleRate: OUTPUT_SAMPLE_RATE });
    } catch {
      this.outputCtx = new AudioCtx();
    }

    this.outputCtx.onstatechange = () => {
      if (!this.disposed) {
        this.emitAudioUnlockState();
      }
    };

    const analyser = this.outputCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    analyser.connect(this.outputCtx.destination);
    this.outputAnalyser = analyser;
    this.outputTimeData = new Uint8Array(new ArrayBuffer(analyser.fftSize));

    if (this.outputCtx.state === 'suspended') {
      void this.outputCtx
        .resume()
        .then(() => this.emitAudioUnlockState())
        .catch(() => this.emitAudioUnlockState());
    } else {
      this.emitAudioUnlockState();
    }
  }

  public async unlockAudio(): Promise<void> {
    this.ensureOutputAudioContext();
    if (this.outputCtx && this.outputCtx.state === 'suspended') {
      try {
        await this.outputCtx.resume();
      } catch {
        // Ignore resume failure
      }
    }
    if (this.inputCtx && this.inputCtx.state === 'suspended') {
      try {
        await this.inputCtx.resume();
      } catch {
        // Ignore resume failure
      }
    }
    this.emitAudioUnlockState();
  }

  public async enableMicrophone(): Promise<boolean> {
    if (this.disposed) return false;
    this.cleanupMicrophone();
    await this.setupMicrophone();
    if (this.micAvailable) {
      this.muted = false;
      this.micErrorDetail = null;
      this.callbacks.onStatusDetail?.(null);
      await this.unlockAudio();
      if (this.isConnected && this.activeOutputSources.size === 0) {
        this.callbacks.onStateChange('listening');
        this.callbacks.onAudioLevel(0.18);
      }
      return true;
    }
    return false;
  }

  private cleanupMicrophone(): void {
    if (this.micWorkletNode) {
      this.micWorkletNode.port.onmessage = null;
      try {
        this.micWorkletNode.disconnect();
      } catch {
        // Ignore
      }
      this.micWorkletNode = null;
    }

    if (this.micProcessor) {
      this.micProcessor.onaudioprocess = null;
      try {
        this.micProcessor.disconnect();
      } catch {
        // Ignore
      }
      this.micProcessor = null;
    }

    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {
        // Ignore
      }
      this.micSource = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      this.micStream = null;
    }

    this.micAvailable = false;

    if (this.inputCtx) {
      const ctx = this.inputCtx;
      this.inputCtx = null;
      ctx.onstatechange = null;
      void ctx.close().catch(() => {});
    }
  }

  private processMicSamples(raw: Float32Array, actualSampleRate: number): void {
    if (
      this.disposed ||
      this.muted ||
      !this.isConnected ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    // Compute RMS energy for adaptive background noise suppression and orb reactivity
    let sumSq = 0;
    for (let i = 0; i < raw.length; i++) {
      sumSq += raw[i] * raw[i];
    }
    const rms = Math.sqrt(sumSq / raw.length);
    const now = performance.now();

    // Gently track room ambient floor when signal is quiet; ignore loud foreground speech
    const speechGateThreshold = Math.max(0.011, this.ambientNoiseFloor * 1.95);
    if (rms < speechGateThreshold) {
      this.ambientNoiseFloor = this.ambientNoiseFloor * 0.94 + rms * 0.06;
      this.ambientNoiseFloor = Math.min(0.025, Math.max(0.003, this.ambientNoiseFloor));
    } else {
      // Keep gate open for 480ms after speech drops so word endings & soft syllables stay intact
      this.noiseGateOpenUntil = now + 480;
    }

    const gateOpen = now <= this.noiseGateOpenUntil;
    const effectiveRms = gateOpen ? Math.max(0, rms - this.ambientNoiseFloor * 0.6) : 0;
    const normalizedLevel = Math.min(1, Math.max(0, effectiveRms * 11.0));

    if (this.activeOutputSources.size === 0) {
      if (gateOpen && normalizedLevel > 0.05) {
        this.userSpeakingHoldUntil = now + 520;
        this.callbacks.onStateChange('listening');
        this.callbacks.onAudioLevel(Math.max(0.22, normalizedLevel));
      } else if (now < this.userSpeakingHoldUntil) {
        this.callbacks.onAudioLevel(Math.max(0.16, normalizedLevel));
      }
    }

    // Protect slow networks from building a multi-second audio upload backlog
    if (this.ws.bufferedAmount > 96_000) {
      this.evaluateNetworkQuality();
      return;
    }

    // Downsample native mic audio to 16kHz; send clean silence when below noise gate so background chatter never stalls VAD
    const pcm16k = downsampleTo16k(raw, actualSampleRate);
    if (!gateOpen) {
      pcm16k.fill(0);
    }
    const base64 = float32ToBase64Pcm16(pcm16k);
    try {
      this.ws.send(JSON.stringify({ type: 'audio', data: base64 }));
    } catch {
      // Ignore transient send failure
    }
  }

  private async setupMicrophone(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.micAvailable = false;
      this.micErrorDetail = 'Microphone unavailable — type below to talk.';
      this.callbacks.onStatusDetail?.(this.micErrorDetail);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.disposed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.micStream = stream;
      this.micAvailable = true;
      this.micErrorDetail = null;

      // Detect if the OS or browser stops the mic track mid-session
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (this.disposed) return;
          this.micAvailable = false;
          this.micErrorDetail = 'Microphone disconnected — tap mic to reconnect.';
          this.callbacks.onStatusDetail?.(this.micErrorDetail);
          this.emitAudioUnlockState();
        };
      });

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // Always use the device's native hardware sample rate for capture (forcing 16kHz can produce silent buffers on many browsers/headsets)
      const inputCtx = new AudioCtx();
      this.inputCtx = inputCtx;

      inputCtx.onstatechange = () => {
        if (!this.disposed) {
          this.emitAudioUnlockState();
        }
      };

      if (inputCtx.state === 'suspended') {
        await Promise.race([
          inputCtx.resume().catch(() => {}),
          new Promise<void>((resolve) => window.setTimeout(resolve, 350)),
        ]);
      }
      if (this.disposed) return;

      const source = inputCtx.createMediaStreamSource(stream);
      this.micSource = source;
      const actualSampleRate = inputCtx.sampleRate;

      // Prefer AudioWorkletNode (runs on dedicated audio thread, immune to main-thread/zero-gain culling)
      let workletAttached = false;
      if (typeof AudioWorkletNode !== 'undefined' && inputCtx.audioWorklet) {
        let blobUrl: string | null = null;
        try {
          blobUrl = URL.createObjectURL(
            new Blob([MIC_WORKLET_CODE], { type: 'application/javascript' })
          );
          await inputCtx.audioWorklet.addModule(blobUrl);
          if (!this.disposed && this.inputCtx === inputCtx) {
            const workletNode = new AudioWorkletNode(inputCtx, MIC_WORKLET_PROCESSOR_NAME, {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              outputChannelCount: [1],
            });
            workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
              if (event.data instanceof Float32Array) {
                this.processMicSamples(event.data, actualSampleRate);
              }
            };
            source.connect(workletNode);
            // Connecting to destination keeps the WebAudio pull graph active while outputting pure silence
            workletNode.connect(inputCtx.destination);
            this.micWorkletNode = workletNode;
            workletAttached = true;
          }
        } catch {
          workletAttached = false;
        } finally {
          if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
          }
        }
      }

      if (!workletAttached && !this.disposed && this.inputCtx === inputCtx) {
        // Fallback: ScriptProcessorNode connected directly to destination with explicitly zeroed output buffer
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(inputCtx.destination);
        this.micProcessor = processor;

        processor.onaudioprocess = (event: AudioProcessingEvent) => {
          // Zero the output buffer so connecting directly to destination never causes speaker feedback
          if (event.outputBuffer && event.outputBuffer.numberOfChannels > 0) {
            event.outputBuffer.getChannelData(0).fill(0);
          }
          const raw = event.inputBuffer.getChannelData(0);
          this.processMicSamples(raw, actualSampleRate);
        };
      }

      this.emitAudioUnlockState();
    } catch {
      this.micAvailable = false;
      this.micErrorDetail = 'Mic permission blocked — tap mic to allow or type below.';
      this.callbacks.onStatusDetail?.(this.micErrorDetail);
      this.emitAudioUnlockState();
    }
  }

  private openSocketWithCandidate(
    candidate: ExecutionCandidate,
    options: LiveConnectOptions,
    idToken: string | null,
    requestId: string
  ): Promise<{
    ok: boolean;
    errorMessage?: string;
    code?: string;
    shouldRotateKey?: boolean;
    cooldownMs?: number;
  }> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (res: {
        ok: boolean;
        errorMessage?: string;
        code?: string;
        shouldRotateKey?: boolean;
        cooldownMs?: number;
      }) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(handshakeTimeout);
        resolve(res);
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(buildWebSocketUrl());
      } catch (err) {
        finish({
          ok: false,
          errorMessage: err instanceof Error ? err.message : 'Unable to open live voice connection.',
          shouldRotateKey: false,
        });
        return;
      }

      this.ws = ws;

      const handshakeTimeout = window.setTimeout(() => {
        if (!settled) {
          try {
            ws.close();
          } catch {
            // Ignore
          }
          finish({
            ok: false,
            errorMessage: 'Connection to Jovibe Live timed out. Please try again.',
            code: 'TIMEOUT',
            shouldRotateKey: false,
          });
        }
      }, 15_000);

      ws.onopen = () => {
        if (this.disposed) {
          ws.close();
          finish({ ok: false });
          return;
        }
        ws.send(
          JSON.stringify({
            type: 'init',
            idToken: idToken || undefined,
            requestId,
            apiKey: candidate.apiKey || undefined,
            byokOnly: hasUserEnteredOwnKey(),
            voiceName: options.voiceName || 'Zephyr',
            sendGreeting: options.sendGreeting ?? true,
            lesson: {
              courseCode: options.lesson.courseCode,
              courseName: options.lesson.courseName,
              topicName: options.lesson.topicName,
              lessonTitle: options.lesson.lessonTitle,
              summary: options.lesson.summary,
              sections: options.lesson.sections.map((s) => ({
                heading: s.heading,
                content: s.content,
              })),
            },
          })
        );
      };

      ws.onmessage = (event) => {
        if (this.disposed) return;
        let msg: ServerLiveMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerLiveMessage;
        } catch {
          return;
        }

        if (msg.type === 'pong') {
          if (typeof msg.ts === 'number') {
            const sampleRtt = Math.max(1, Date.now() - msg.ts);
            this.smoothedRttMs =
              this.smoothedRttMs === null
                ? sampleRtt
                : Math.round(this.smoothedRttMs * 0.6 + sampleRtt * 0.4);
          }
          this.awaitingPong = false;
          this.evaluateNetworkQuality();
          return;
        }

        if (msg.type === 'ready') {
          const maybeQuota = (msg as unknown as { quota?: { used?: number; limit?: number; remaining?: number; resetAtIso?: string } }).quota;
          if (maybeQuota && typeof maybeQuota.used === 'number' && typeof maybeQuota.limit === 'number') {
            emitQuotaSnapshot({
              used: maybeQuota.used,
              limit: maybeQuota.limit,
              remaining: typeof maybeQuota.remaining === 'number' ? maybeQuota.remaining : Math.max(0, maybeQuota.limit - maybeQuota.used),
              resetAtIso: maybeQuota.resetAtIso,
            });
          }
          finish({ ok: true });
          return;
        }

        if (msg.type === 'error') {
          const errMsg = msg.message || 'Jovibe Live encountered an AI service error.';
          if (!settled) {
            try {
              ws.close();
            } catch {
              // Ignore
            }
            finish({
              ok: false,
              errorMessage: errMsg,
              code: typeof msg.code === 'string' ? msg.code : undefined,
              shouldRotateKey: Boolean(msg.shouldRotateKey),
              cooldownMs: typeof msg.cooldownMs === 'number' ? msg.cooldownMs : 0,
            });
          } else {
            this.isConnected = false;
            this.stopPlayback(false);
            this.callbacks.onError?.(errMsg);
            this.callbacks.onStateChange('disconnected');
            this.callbacks.onAudioLevel(0);
          }
          return;
        }

        if (msg.type === 'audio' && msg.data) {
          this.modelTurnComplete = false;
          this.enqueueOutputAudio(msg.data, parseSampleRateFromMime(msg.mimeType));
          return;
        }

        if (msg.type === 'interimInputTranscript' && msg.text) {
          const cleanInterim = msg.text.trim();
          if (cleanInterim) {
            this.callbacks.onTranscript('student', `"${cleanInterim}"`);
            if (this.activeOutputSources.size === 0) {
              this.callbacks.onStateChange('listening');
            }
          }
          return;
        }

        if (msg.type === 'inputTranscript' && msg.text) {
          if (this.currentSpeaker !== 'student') {
            this.studentTranscriptBuffer = '';
            this.currentSpeaker = 'student';
          }
          this.studentTranscriptBuffer = this.appendTranscriptChunk(
            this.studentTranscriptBuffer,
            msg.text
          );
          this.callbacks.onTranscript('student', `"${this.studentTranscriptBuffer}"`);
          if (this.activeOutputSources.size === 0) {
            this.callbacks.onStateChange('listening');
          }
          return;
        }

        if (msg.type === 'outputTranscript' && msg.text) {
          if (this.currentSpeaker !== 'companion') {
            this.companionTranscriptBuffer = '';
            this.currentSpeaker = 'companion';
          }
          this.companionTranscriptBuffer = this.appendTranscriptChunk(
            this.companionTranscriptBuffer,
            msg.text
          );
          this.callbacks.onTranscript('companion', this.companionTranscriptBuffer);
          return;
        }

        if (msg.type === 'interrupted') {
          this.handleBargeIn();
          return;
        }

        if (msg.type === 'turnComplete') {
          this.modelTurnComplete = true;
          if (this.activeOutputSources.size === 0) {
            const canListen = this.micAvailable && !this.muted;
            this.callbacks.onStateChange(canListen ? 'listening' : 'idle');
            this.callbacks.onAudioLevel(canListen ? 0.18 : 0.12);
          }
          return;
        }

        if (msg.type === 'closed') {
          if (!settled) {
            finish({
              ok: false,
              errorMessage: msg.reason || 'Live voice session closed unexpectedly.',
              shouldRotateKey: false,
            });
          } else if (!this.disposed) {
            this.isConnected = false;
            this.stopPlayback(false);
            this.callbacks.onStateChange('disconnected');
            this.callbacks.onAudioLevel(0);
            this.callbacks.onTranscript(
              'system',
              'Connection paused. Tap Reconnect whenever you want to keep talking.'
            );
          }
        }
      };

      ws.onerror = () => {
        if (!settled) {
          finish({
            ok: false,
            errorMessage: 'Unable to reach the Jovibe Live voice server.',
            code: 'NETWORK_ERROR',
            shouldRotateKey: false,
          });
        }
      };

      ws.onclose = () => {
        if (!settled) {
          finish({
            ok: false,
            errorMessage: 'Connection closed before Jovibe Live was ready.',
            shouldRotateKey: false,
          });
        } else if (!this.disposed && this.isConnected) {
          this.isConnected = false;
          this.stopPlayback(false);
          this.callbacks.onStateChange('disconnected');
          this.callbacks.onAudioLevel(0);
          this.callbacks.onTranscript(
            'system',
            'Connection paused. Tap Reconnect whenever you want to pick right back up.'
          );
        }
      };
    });
  }

  private appendTranscriptChunk(existing: string, incoming: string): string {
    const cleanIncoming = incoming.replace(/\s+/g, ' ');
    if (!existing) return cleanIncoming.trim();
    if (cleanIncoming.startsWith(' ') || existing.endsWith(' ')) {
      return `${existing}${cleanIncoming}`.trim().slice(-260);
    }
    // Live API transcription chunks sometimes include leading spaces or subword tokens
    if (/^[.,!?;:'")\]-]/.test(cleanIncoming)) {
      return `${existing}${cleanIncoming}`.trim().slice(-260);
    }
    return `${existing}${cleanIncoming}`.trim().slice(-260);
  }

  private enqueueOutputAudio(base64Pcm: string, sampleRate: number): void {
    this.ensureOutputAudioContext();
    const ctx = this.outputCtx;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx
        .resume()
        .then(() => this.emitAudioUnlockState())
        .catch(() => this.emitAudioUnlockState());
    } else {
      this.emitAudioUnlockState();
    }

    const floats = base64Pcm16ToFloat32(base64Pcm);
    if (floats.length === 0) return;

    const audioBuffer = ctx.createBuffer(1, floats.length, sampleRate);
    audioBuffer.copyToChannel(floats, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    if (this.outputAnalyser) {
      source.connect(this.outputAnalyser);
    } else {
      source.connect(ctx.destination);
    }

    const now = ctx.currentTime;
    if (this.nextStartTime < now + 0.02) {
      this.nextStartTime = now + 0.03;
    }

    source.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;
    this.activeOutputSources.add(source);

    this.callbacks.onStateChange('speaking');
    this.startOutputLevelMeter();

    source.onended = () => {
      this.activeOutputSources.delete(source);
      if (this.activeOutputSources.size === 0) {
        this.stopOutputLevelMeter();
        if (!this.disposed && this.isConnected && this.modelTurnComplete) {
          const canListen = this.micAvailable && !this.muted;
          this.callbacks.onStateChange(canListen ? 'listening' : 'idle');
          this.callbacks.onAudioLevel(canListen ? 0.18 : 0.12);
        }
      }
    };
  }

  private startOutputLevelMeter(): void {
    if (this.outputMeterRaf || !this.outputAnalyser || !this.outputTimeData) return;

    const sampleMeter = () => {
      if (this.disposed || this.activeOutputSources.size === 0 || !this.outputAnalyser || !this.outputTimeData) {
        this.outputMeterRaf = 0;
        return;
      }

      this.outputAnalyser.getByteTimeDomainData(this.outputTimeData);
      let sumSq = 0;
      for (let i = 0; i < this.outputTimeData.length; i++) {
        const centered = (this.outputTimeData[i] - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / this.outputTimeData.length);
      const level = Math.min(1, Math.max(0.18, rms * 4.8));
      this.callbacks.onAudioLevel(level);

      this.outputMeterRaf = window.requestAnimationFrame(sampleMeter);
    };

    this.outputMeterRaf = window.requestAnimationFrame(sampleMeter);
  }

  private stopOutputLevelMeter(): void {
    if (this.outputMeterRaf) {
      window.cancelAnimationFrame(this.outputMeterRaf);
      this.outputMeterRaf = 0;
    }
  }

  public handleBargeIn(): void {
    this.stopPlayback(true);
    this.callbacks.onStateChange('interrupting');
    this.callbacks.onAudioLevel(0.68);
    window.clearTimeout(this.interruptTimer);
    this.interruptTimer = window.setTimeout(() => {
      if (!this.disposed && this.isConnected && this.activeOutputSources.size === 0) {
        this.callbacks.onStateChange(this.muted ? 'idle' : 'listening');
        this.callbacks.onAudioLevel(this.muted ? 0.12 : 0.32);
      }
    }, 520);
  }

  public stopPlayback(resetTranscript = false): void {
    this.stopOutputLevelMeter();
    this.activeOutputSources.forEach((src) => {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
    });
    this.activeOutputSources.clear();
    this.nextStartTime = 0;
    this.modelTurnComplete = true;
    if (resetTranscript) {
      this.companionTranscriptBuffer = '';
    }
  }

  public setMuted(nextMuted: boolean): void {
    this.muted = nextMuted;
    if (nextMuted && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'audioStreamEnd' }));
      } catch {
        // Ignore
      }
    } else if (!nextMuted) {
      void this.unlockAudio();
    }
    this.emitAudioUnlockState();
    if (!this.disposed && this.isConnected && this.activeOutputSources.size === 0) {
      const canListen = this.micAvailable && !nextMuted;
      this.callbacks.onStateChange(canListen ? 'listening' : 'idle');
      this.callbacks.onAudioLevel(canListen ? 0.18 : 0.12);
    }
  }

  public sendText(text: string): boolean {
    const clean = text.trim();
    if (!clean || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;

    void this.unlockAudio();
    this.stopPlayback(true);
    this.currentSpeaker = 'student';
    this.studentTranscriptBuffer = clean;
    this.callbacks.onTranscript('student', `"${clean}"`);
    this.callbacks.onStateChange('thinking');
    this.callbacks.onAudioLevel(0.28);

    try {
      this.ws.send(JSON.stringify({ type: 'text', text: clean }));
      return true;
    } catch {
      return false;
    }
  }

  private getNavigatorConnection(): NavigatorConnectionLike | null {
    const nav = navigator as Navigator & {
      connection?: NavigatorConnectionLike;
      mozConnection?: NavigatorConnectionLike;
      webkitConnection?: NavigatorConnectionLike;
    };
    return nav.connection || nav.mozConnection || nav.webkitConnection || null;
  }

  private handleBrowserNetworkEvent = (): void => {
    if (!this.disposed) {
      this.evaluateNetworkQuality();
    }
  };

  private bindNetworkListeners(): void {
    if (this.networkListenersBound) return;
    this.networkListenersBound = true;
    window.addEventListener('online', this.handleBrowserNetworkEvent);
    window.addEventListener('offline', this.handleBrowserNetworkEvent);
    this.getNavigatorConnection()?.addEventListener?.('change', this.handleBrowserNetworkEvent);
  }

  private unbindNetworkListeners(): void {
    if (!this.networkListenersBound) return;
    this.networkListenersBound = false;
    window.removeEventListener('online', this.handleBrowserNetworkEvent);
    window.removeEventListener('offline', this.handleBrowserNetworkEvent);
    this.getNavigatorConnection()?.removeEventListener?.('change', this.handleBrowserNetworkEvent);
  }

  private evaluateNetworkQuality(): void {
    if (this.disposed) return;

    let quality: LiveNetworkQuality = 'good';
    let reason: string | undefined;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      quality = 'offline';
      reason = 'No internet connection';
    } else {
      const now = Date.now();
      const pendingPingAge =
        this.awaitingPong && this.lastPingSentAt > 0 ? now - this.lastPingSentAt : 0;
      const buffered = this.ws?.bufferedAmount ?? 0;
      const conn = this.getNavigatorConnection();
      const effectiveType = conn?.effectiveType || '';
      const rtt = this.smoothedRttMs;

      if (
        buffered > 96_000 ||
        pendingPingAge > 9_000 ||
        (rtt !== null && rtt >= 1100) ||
        effectiveType === 'slow-2g' ||
        effectiveType === '2g'
      ) {
        quality = 'poor';
        reason =
          buffered > 96_000
            ? 'Voice upload is heavily congested'
            : pendingPingAge > 9_000
            ? 'Server response is stalled'
            : 'Very high latency detected';
      } else if (
        buffered > 32_000 ||
        pendingPingAge > 4_200 ||
        (rtt !== null && rtt >= 380) ||
        effectiveType === '3g' ||
        (typeof conn?.rtt === 'number' && conn.rtt >= 400)
      ) {
        quality = 'slow';
        reason =
          buffered > 32_000
            ? 'Slow voice upload speed'
            : 'Elevated network latency';
      }
    }

    const roundedRtt = this.smoothedRttMs !== null ? Math.round(this.smoothedRttMs) : null;
    const rttChangedSignificantly =
      roundedRtt !== this.lastEmittedRttMs &&
      (this.lastEmittedRttMs === null ||
        roundedRtt === null ||
        Math.abs(roundedRtt - this.lastEmittedRttMs) >= 25);

    if (quality !== this.lastNetworkQuality || rttChangedSignificantly) {
      this.lastNetworkQuality = quality;
      this.lastEmittedRttMs = roundedRtt;
      this.callbacks.onNetworkStatus?.({
        quality,
        rttMs: roundedRtt,
        reason,
      });
    }
  }

  private sendNetworkPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // If previous ping is still unanswered, evaluate degraded state first
    if (this.awaitingPong) {
      this.evaluateNetworkQuality();
    }
    try {
      this.lastPingSentAt = Date.now();
      this.awaitingPong = true;
      this.ws.send(JSON.stringify({ type: 'ping', ts: this.lastPingSentAt }));
    } catch {
      // Ignore
    }
  }

  private startKeepAlive(): void {
    window.clearInterval(this.keepAliveTimer);
    // Measure latency promptly after connect, then every 4 seconds
    window.setTimeout(() => {
      if (!this.disposed && this.isConnected) {
        this.sendNetworkPing();
      }
    }, 600);
    this.keepAliveTimer = window.setInterval(() => {
      this.sendNetworkPing();
      this.evaluateNetworkQuality();
    }, 4_000);
  }

  public disconnect(silent = false): void {
    this.disposed = true;
    this.isConnected = false;
    this.unbindNetworkListeners();
    window.clearTimeout(this.interruptTimer);
    window.clearInterval(this.keepAliveTimer);
    this.stopPlayback(true);

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Ignore
      }
    }

    this.cleanupMicrophone();
    this.micErrorDetail = null;

    if (this.outputCtx) {
      const ctx = this.outputCtx;
      this.outputCtx = null;
      ctx.onstatechange = null;
      this.outputAnalyser = null;
      this.outputTimeData = null;
      void ctx.close().catch(() => {});
    }

    if (!silent) {
      this.callbacks.onStateChange('disconnected');
      this.callbacks.onAudioLevel(0);
    }
  }
}
