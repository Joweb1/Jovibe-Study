import type { StudySection } from '../../types/models';
import { generateDocumentId } from '../../utils/validation';
import { extractVisionWithClient } from '../ai/geminiClient';
import { countUncertainMarkers } from './structureParser';

export type VisionExtractionMode =
  | 'handwriting'
  | 'textbook_photo'
  | 'scanned_doc'
  | 'page_image_fallback'
  | 'general';

export interface VisionExtractionResult {
  sections: StudySection[];
  uncertainCount: number;
  notes: string;
}

const EMPTY_REPORT_PATTERN =
  /^(?:no\s+(?:readable|extractable|visible|academic|detectable)?\s*(?:text|content)|(?:this\s+)?(?:page|slide|image)\s+(?:is|appears\s+to\s+be|looks)\s+(?:blank|empty)|blank\s+(?:page|slide)|empty\s+(?:page|slide)|nothing\s+to\s+extract|none|n\/a)[\s.!?:;-]*$/i;

/**
 * Detects when Vision OCR returned either zero sections or only a short
 * placeholder stating that the page is empty / has no extractable text.
 */
export function isEffectivelyEmptyVisionResult(sections: StudySection[]): boolean {
  if (!Array.isArray(sections) || sections.length === 0) return true;
  const combined = sections
    .map((s) => (s.content || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!combined) return true;
  if (combined.length <= 160 && EMPTY_REPORT_PATTERN.test(combined)) {
    return true;
  }
  return false;
}

const MAX_IMAGE_DIMENSION = 2048;
const JPEG_QUALITY = 0.88;

let compressWorkerRequestId = 0;

function compressImageInWorker(
  file: Blob
): Promise<{ base64: string; mimeType: string } | null> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./imageCompressWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      resolve(null);
      return;
    }

    const reqId = ++compressWorkerRequestId;
    const cleanup = () => {
      if (worker) {
        worker.terminate();
        worker = null;
      }
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 20_000);

    worker.onmessage = (
      event: MessageEvent<{ id: number; ok: boolean; base64?: string; mimeType?: string }>
    ) => {
      if (event.data?.id !== reqId) return;
      window.clearTimeout(timeout);
      cleanup();
      if (event.data.ok && event.data.base64) {
        resolve({ base64: event.data.base64, mimeType: event.data.mimeType || 'image/jpeg' });
      } else {
        resolve(null);
      }
    };

    worker.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve(null);
    };

    worker.postMessage({
      id: reqId,
      blob: file,
      maxDimension: MAX_IMAGE_DIMENSION,
      quality: JPEG_QUALITY,
    });
  });
}

/**
 * Downscales large camera photos off the main thread (via Web Worker + OffscreenCanvas
 * when available, falling back to browser canvas) so background OCR never blocks UI interactions.
 */
export async function compressImageFileToBase64(
  file: File | Blob
): Promise<{ base64: string; mimeType: string }> {
  const workerResult = await compressImageInWorker(file);
  if (workerResult) {
    return workerResult;
  }

  const bitmap = await createImageBitmap(file);
  try {
    let targetWidth = bitmap.width;
    let targetHeight = bitmap.height;

    if (targetWidth > MAX_IMAGE_DIMENSION || targetHeight > MAX_IMAGE_DIMENSION) {
      const ratio = Math.min(
        MAX_IMAGE_DIMENSION / targetWidth,
        MAX_IMAGE_DIMENSION / targetHeight
      );
      targetWidth = Math.round(targetWidth * ratio);
      targetHeight = Math.round(targetHeight * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize image processing canvas.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const base64 = dataUrl.split(',')[1] || '';
    return { base64, mimeType: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}

export async function extractImageWithVision(params: {
  imageBase64: string;
  mimeType: string;
  mode: VisionExtractionMode;
  pageNumber?: number;
  signal?: AbortSignal;
}): Promise<VisionExtractionResult> {
  const payload = await extractVisionWithClient({
    imageBase64: params.imageBase64,
    mimeType: params.mimeType,
    mode: params.mode,
    pageNumber: params.pageNumber,
    signal: params.signal,
  });

  const sections: StudySection[] = payload.sections.map((s, idx) => ({
    id: generateDocumentId(`vis${idx}`),
    heading: s.heading || (params.pageNumber ? `Page ${params.pageNumber}` : `Section ${idx + 1}`),
    level: s.level || 2,
    content: s.content || '',
    ...(typeof params.pageNumber === 'number'
      ? { pageOrSlide: params.pageNumber }
      : typeof s.pageOrSlide === 'number'
      ? { pageOrSlide: s.pageOrSlide }
      : {}),
  }));

  const combinedText = sections.map((s) => `${s.heading}\n${s.content}`).join('\n');
  const detectedMarkers = countUncertainMarkers(combinedText);
  const uncertainCount = Math.max(payload.uncertainCount ?? 0, detectedMarkers);

  return {
    sections,
    uncertainCount,
    notes: payload.notes || '',
  };
}
