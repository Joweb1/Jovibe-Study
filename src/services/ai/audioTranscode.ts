import { AiServiceError } from './errors';

const TARGET_SAMPLE_RATE = 16_000;

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Encodes mono Float32 PCM as a 16-bit PCM WAV file. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

export function isProviderSafeAudioMime(mimeType: string): boolean {
  const clean = mimeType.split(';')[0].toLowerCase().trim();
  return clean === 'audio/wav' || clean === 'audio/x-wav' || clean === 'audio/mpeg' || clean === 'audio/mp3';
}

/**
 * NVIDIA NIM and OpenRouter audio models accept WAV/MP3 only. Browser recordings
 * are usually WebM/Opus (Chrome) or M4A/AAC (Safari), so NIM/OpenRouter fallback
 * transcription transcodes to 16 kHz mono WAV in the browser first.
 */
export async function toProviderSafeAudio(
  audioBase64: string,
  mimeType: string
): Promise<{ audioBase64: string; mimeType: string }> {
  if (isProviderSafeAudioMime(mimeType)) {
    const clean = mimeType.split(';')[0].toLowerCase().trim();
    return {
      audioBase64,
      mimeType: clean === 'audio/x-wav' ? 'audio/wav' : clean,
    };
  }

  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    throw new AiServiceError(
      'Voice-note transcoding is not available in this browser, so the fallback transcriber cannot be used.',
      'MODEL_UNAVAILABLE',
      { retryable: false }
    );
  }

  try {
    const arrayBuffer = base64ToArrayBuffer(audioBase64);
    const decodeContext = new AudioContext();
    let decoded: AudioBuffer;
    try {
      decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      void decodeContext.close();
    }

    const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const wav = encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);

    return {
      audioBase64: arrayBufferToBase64(wav),
      mimeType: 'audio/wav',
    };
  } catch (err) {
    throw new AiServiceError(
      `The voice note could not be converted to a fallback-compatible audio format: ${
        err instanceof Error ? err.message : 'unknown decoding error'
      }`,
      'MODEL_UNAVAILABLE',
      { retryable: false }
    );
  }
}
