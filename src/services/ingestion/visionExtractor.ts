import type { StudySection } from '../../types/models';
import { generateDocumentId } from '../../utils/validation';
import { extractVisionWithClient } from '../ai/geminiClient';
import { countUncertainMarkers } from './structureParser';

export type VisionExtractionMode = 'handwriting' | 'textbook_photo' | 'scanned_doc' | 'general';

export interface VisionExtractionResult {
  sections: StudySection[];
  uncertainCount: number;
  notes: string;
}

const MAX_IMAGE_DIMENSION = 2048;

/**
 * Downscales large camera photos in the browser to a sharp JPEG so OCR stays
 * fast, avoids payload limits, and discards the original raw binary after processing.
 */
export async function compressImageFileToBase64(
  file: File
): Promise<{ base64: string; mimeType: string }> {
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

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
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
