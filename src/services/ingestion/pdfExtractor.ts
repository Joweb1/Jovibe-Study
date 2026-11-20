import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { StudySection } from '../../types/models';
import { generateDocumentId } from '../../utils/validation';
import { clampSectionsForFirestore } from './structureParser';
import { extractImageWithVision } from './visionExtractor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MIN_SELECTABLE_CHARS_PER_PAGE = 45;
const MAX_VISION_PAGES_PER_BATCH = 12;

export interface PdfExtractionProgress {
  currentPage: number;
  totalPages: number;
  stage: string;
}

export interface PdfExtractionOptions {
  startPage?: number;
  endPage?: number;
  enableScannedOcr?: boolean;
  onProgress?: (progress: PdfExtractionProgress) => void;
  signal?: AbortSignal;
}

export interface PdfExtractionResult {
  sections: StudySection[];
  pageCount: number;
  processedPages: number;
  visionPagesUsed: number;
  uncertainCount: number;
  warnings: string[];
}

interface TextRun {
  str: string;
  x: number;
  y: number;
  height: number;
}

export async function inspectPdfPageCount(file: File): Promise<number> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  try {
    return pdf.numPages;
  } finally {
    await loadingTask.destroy();
  }
}

function reconstructStructuredPageText(runs: TextRun[]): {
  heading: string | null;
  body: string;
} {
  if (runs.length === 0) return { heading: null, body: '' };

  // Group text runs into visual lines by Y-coordinate proximity
  const sorted = [...runs].sort((a, b) => {
    if (Math.abs(b.y - a.y) > 3) return b.y - a.y;
    return a.x - b.x;
  });

  const lines: Array<{ y: number; maxHeight: number; text: string }> = [];
  for (const run of sorted) {
    const text = run.str;
    if (!text) continue;
    const lastLine = lines[lines.length - 1];
    if (lastLine && Math.abs(lastLine.y - run.y) <= Math.max(3.5, run.height * 0.45)) {
      const needsSpace =
        lastLine.text.length > 0 &&
        !lastLine.text.endsWith(' ') &&
        !text.startsWith(' ') &&
        !/^[,.;:!?)]/.test(text);
      lastLine.text += (needsSpace ? ' ' : '') + text;
      lastLine.maxHeight = Math.max(lastLine.maxHeight, run.height);
    } else {
      lines.push({ y: run.y, maxHeight: run.height, text: text.trimStart() });
    }
  }

  const heights = lines.map((l) => l.maxHeight).filter((h) => h > 0);
  const sortedHeights = [...heights].sort((a, b) => a - b);
  const medianHeight = sortedHeights[Math.floor(sortedHeights.length / 2)] || 10;

  let detectedHeading: string | null = null;
  const outputLines: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const clean = line.text.replace(/\s+/g, ' ').trim();
    if (!clean) continue;

    // Skip isolated bare page numbers at very top/bottom
    if ((i === 0 || i === lines.length - 1) && /^\d{1,4}$/.test(clean)) {
      continue;
    }

    const isLargerHeading =
      line.maxHeight >= medianHeight * 1.24 && clean.length >= 3 && clean.length <= 120;

    if (isLargerHeading && !detectedHeading && i < 4) {
      detectedHeading = clean;
      continue;
    }

    if (isLargerHeading) {
      outputLines.push(`\n### ${clean}\n`);
      continue;
    }

    // Preserve bullet points and numbered lists
    if (/^[•●▪◦\-*]\s+/.test(clean)) {
      outputLines.push(`- ${clean.replace(/^[•●▪◦\-*]\s+/, '')}`);
      continue;
    }

    // Detect paragraph break via vertical gap
    const prevLine = i > 0 ? lines[i - 1] : null;
    const verticalGap = prevLine ? Math.abs(prevLine.y - line.y) : 0;
    if (prevLine && verticalGap > medianHeight * 1.75) {
      outputLines.push('');
    }
    outputLines.push(clean);
  }

  return {
    heading: detectedHeading,
    body: outputLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

async function renderPdfPageToJpegBase64(page: pdfjsLib.PDFPageProxy): Promise<string> {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.0, 1600 / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale: Math.max(1.2, scale) });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not initialize PDF render canvas.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl.split(',')[1] || '';
}

export async function extractPdfDocument(
  file: File,
  options: PdfExtractionOptions = {}
): Promise<PdfExtractionResult> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const totalPagesInPdf = pdf.numPages;
  const startPage = Math.max(1, Math.min(totalPagesInPdf, options.startPage ?? 1));
  const endPage = Math.max(startPage, Math.min(totalPagesInPdf, options.endPage ?? totalPagesInPdf));
  const pagesToProcess = endPage - startPage + 1;
  const enableScannedOcr = options.enableScannedOcr ?? true;

  const sections: StudySection[] = [];
  const warnings: string[] = [];
  let visionPagesUsed = 0;
  let uncertainCount = 0;
  let skippedScannedPages = 0;

  try {
    for (let pageNum = startPage; pageNum <= endPage; pageNum += 1) {
      if (options.signal?.aborted) {
        throw new Error('Extraction cancelled by user.');
      }

      options.onProgress?.({
        currentPage: pageNum - startPage + 1,
        totalPages: pagesToProcess,
        stage: `Reading page ${pageNum} of ${endPage}...`,
      });

      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const runs: TextRun[] = [];
      for (const item of textContent.items) {
        if ('str' in item && typeof item.str === 'string') {
          const transform = item.transform as number[];
          const height = Math.abs(transform[3]) || item.height || 10;
          runs.push({
            str: item.str,
            x: transform[4] || 0,
            y: transform[5] || 0,
            height,
          });
        }
      }

      const { heading, body } = reconstructStructuredPageText(runs);
      const meaningfulChars = body.replace(/\s+/g, '').length;

      if (meaningfulChars >= MIN_SELECTABLE_CHARS_PER_PAGE) {
        sections.push({
          id: generateDocumentId(`pdfp${pageNum}`),
          heading: heading ? `Page ${pageNum}: ${heading}` : `Page ${pageNum}`,
          level: 2,
          content: body,
          pageOrSlide: pageNum,
        });
      } else if (enableScannedOcr && visionPagesUsed < MAX_VISION_PAGES_PER_BATCH) {
        options.onProgress?.({
          currentPage: pageNum - startPage + 1,
          totalPages: pagesToProcess,
          stage: `Scanned page ${pageNum} detected — running AI Vision OCR...`,
        });

        try {
          const base64 = await renderPdfPageToJpegBase64(page);
          const visionResult = await extractImageWithVision({
            imageBase64: base64,
            mimeType: 'image/jpeg',
            mode: 'scanned_doc',
            pageNumber: pageNum,
            signal: options.signal,
          });

          visionPagesUsed += 1;
          uncertainCount += visionResult.uncertainCount;

          if (visionResult.sections.length > 0) {
            sections.push(...visionResult.sections);
          } else if (body.trim()) {
            sections.push({
              id: generateDocumentId(`pdfp${pageNum}`),
              heading: `Page ${pageNum}`,
              level: 2,
              content: body,
              pageOrSlide: pageNum,
            });
          }
          if (visionResult.notes) {
            warnings.push(`Page ${pageNum}: ${visionResult.notes}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Page ${pageNum} OCR skipped: ${msg}`);
          if (body.trim()) {
            sections.push({
              id: generateDocumentId(`pdfp${pageNum}`),
              heading: `Page ${pageNum} (partial text)`,
              level: 2,
              content: body,
              pageOrSlide: pageNum,
            });
          }
        }
      } else if (meaningfulChars > 0) {
        sections.push({
          id: generateDocumentId(`pdfp${pageNum}`),
          heading: heading ? `Page ${pageNum}: ${heading}` : `Page ${pageNum}`,
          level: 2,
          content: body,
          pageOrSlide: pageNum,
        });
      } else {
        skippedScannedPages += 1;
      }

      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  if (skippedScannedPages > 0) {
    warnings.push(
      `${skippedScannedPages} scanned/image-only ${skippedScannedPages === 1 ? 'page was' : 'pages were'} skipped (OCR batch limit is ${MAX_VISION_PAGES_PER_BATCH} scanned pages per import). Select a smaller page range to OCR remaining scanned pages.`
    );
  }

  return {
    sections: clampSectionsForFirestore(sections),
    pageCount: totalPagesInPdf,
    processedPages: pagesToProcess,
    visionPagesUsed,
    uncertainCount,
    warnings,
  };
}
