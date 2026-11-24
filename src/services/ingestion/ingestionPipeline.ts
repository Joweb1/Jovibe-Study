import type { MaterialType, ProcessingStatus, StudySection } from '../../types/models';
import { extractPdfDocument } from './pdfExtractor';
import { extractPptxPresentation } from './pptxExtractor';
import {
  buildBatchImageMetadata,
  clampSectionsForFirestore,
  countUncertainMarkers,
  detectMaterialTypeFromFile,
  isSupportedImageFile,
  parseStructuredText,
  sectionsToMarkdown,
  stripFileExtension,
} from './structureParser';

export { isSupportedImageFile };
import {
  compressImageFileToBase64,
  extractImageWithVision,
  isEffectivelyEmptyVisionResult,
  type VisionExtractionMode,
} from './visionExtractor';

export interface ExtractionResult {
  title: string;
  materialType: MaterialType;
  extractedContent: string;
  sections: StudySection[];
  pageOrSlideCount: number;
  processingStatus: ProcessingStatus;
  originalFileName: string;
  uncertainCount: number;
  usedVision: boolean;
  warnings: string[];
}

export interface IngestionProgress {
  stage: string;
  percent?: number;
}

export async function ingestUploadedFile(
  file: File,
  options: {
    overrideType?: MaterialType;
    visionMode?: VisionExtractionMode;
    startPage?: number;
    endPage?: number;
    enableScannedOcr?: boolean;
    onProgress?: (progress: IngestionProgress) => void;
    signal?: AbortSignal;
  } = {}
): Promise<ExtractionResult> {
  const detectedType = options.overrideType ?? detectMaterialTypeFromFile(file);
  const defaultTitle = stripFileExtension(file.name) || 'Untitled Material';

  // 1. PDF Document (Direct text extraction first, selective vision fallback for scanned pages)
  if (detectedType === 'pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfRes = await extractPdfDocument(file, {
      startPage: options.startPage,
      endPage: options.endPage,
      enableScannedOcr: options.enableScannedOcr ?? true,
      signal: options.signal,
      onProgress: (p) =>
        options.onProgress?.({
          stage: p.stage,
          percent:
            typeof p.percent === 'number'
              ? p.percent
              : Math.round((p.currentPage / Math.max(1, p.totalPages)) * 100),
        }),
    });

    const extractedContent = sectionsToMarkdown(pdfRes.sections);
    const uncertainCount = Math.max(pdfRes.uncertainCount, countUncertainMarkers(extractedContent));

    if (!extractedContent.trim()) {
      throw new Error(
        'No readable text could be extracted from this PDF. If it is a scanned PDF, enable Scanned Page OCR and retry.'
      );
    }

    return {
      title: defaultTitle,
      materialType: pdfRes.visionPagesUsed > 0 && pdfRes.visionPagesUsed === pdfRes.processedPages ? 'scanned_doc' : 'pdf',
      extractedContent,
      sections: pdfRes.sections,
      pageOrSlideCount: pdfRes.pageCount,
      processingStatus: uncertainCount > 0 ? 'needs_review' : 'ready',
      originalFileName: file.name,
      uncertainCount,
      usedVision: pdfRes.visionPagesUsed > 0,
      warnings: pdfRes.warnings,
    };
  }

  // 2. PowerPoint (.pptx)
  if (detectedType === 'slides' || /\.pptx?$/i.test(file.name)) {
    options.onProgress?.({ stage: 'Reading PowerPoint slides...', percent: 15 });
    const pptxRes = await extractPptxPresentation(
      file,
      (curr, total) => {
        options.onProgress?.({
          stage: `Extracting slide ${curr} of ${total}...`,
          percent: Math.round((curr / Math.max(1, total)) * 100),
        });
      },
      options.signal
    );

    const extractedContent = sectionsToMarkdown(pptxRes.sections);
    const uncertainCount = Math.max(
      pptxRes.uncertainCount ?? 0,
      countUncertainMarkers(extractedContent)
    );
    return {
      title: defaultTitle,
      materialType: 'slides',
      extractedContent,
      sections: pptxRes.sections,
      pageOrSlideCount: pptxRes.slideCount,
      processingStatus: uncertainCount > 0 ? 'needs_review' : 'ready',
      originalFileName: file.name,
      uncertainCount,
      usedVision: Boolean(pptxRes.usedVision),
      warnings: pptxRes.warnings,
    };
  }

  // 3. Images (Textbook photos, handwritten notes, scanned document images)
  if (
    file.type.startsWith('image/') ||
    detectedType === 'textbook_photo' ||
    detectedType === 'handwritten_notes' ||
    detectedType === 'scanned_doc'
  ) {
    options.onProgress?.({ stage: 'Preparing image for OCR...', percent: 25 });
    const { base64, mimeType } = await compressImageFileToBase64(file);

    const mode: VisionExtractionMode =
      options.visionMode ??
      (detectedType === 'handwritten_notes'
        ? 'handwriting'
        : detectedType === 'scanned_doc'
        ? 'scanned_doc'
        : 'textbook_photo');

    options.onProgress?.({
      stage:
        mode === 'handwriting'
          ? 'Interpreting handwritten notes with AI Vision...'
          : 'Extracting structured text from image with AI Vision...',
      percent: 60,
    });

    let visionRes = await extractImageWithVision({
      imageBase64: base64,
      mimeType,
      mode,
      signal: options.signal,
    });

    // If first pass returned empty (or reported no extractable text), retry once treating it as a full-page visual image before concluding empty
    if (isEffectivelyEmptyVisionResult(visionRes.sections)) {
      options.onProgress?.({
        stage: 'No text detected on first pass — re-analyzing full image...',
        percent: 78,
      });
      const fallbackRes = await extractImageWithVision({
        imageBase64: base64,
        mimeType,
        mode: 'page_image_fallback',
        signal: options.signal,
      });
      if (!isEffectivelyEmptyVisionResult(fallbackRes.sections)) {
        visionRes = fallbackRes;
      } else {
        visionRes = {
          sections: [],
          uncertainCount: 0,
          notes: fallbackRes.notes || visionRes.notes,
        };
      }
    }

    const sections = clampSectionsForFirestore(visionRes.sections);
    const extractedContent = sectionsToMarkdown(sections);
    const uncertainCount = Math.max(visionRes.uncertainCount, countUncertainMarkers(extractedContent));

    if (!extractedContent.trim()) {
      throw new Error('No readable text was detected in this image. Try a sharper, well-lit photo.');
    }

    return {
      title: defaultTitle,
      materialType:
        mode === 'handwriting'
          ? 'handwritten_notes'
          : mode === 'scanned_doc'
          ? 'scanned_doc'
          : 'textbook_photo',
      extractedContent,
      sections,
      pageOrSlideCount: 1,
      processingStatus: uncertainCount > 0 ? 'needs_review' : 'ready',
      originalFileName: file.name,
      uncertainCount,
      usedVision: true,
      warnings: visionRes.notes ? [visionRes.notes] : [],
    };
  }

  // 4. Text / Markdown files
  options.onProgress?.({ stage: 'Reading text file...', percent: 50 });
  const rawText = await file.text();
  if (!rawText.trim()) {
    throw new Error('The uploaded file appears to be empty.');
  }

  const sections = parseStructuredText(rawText, defaultTitle);
  const extractedContent = sectionsToMarkdown(sections);

  return {
    title: defaultTitle,
    materialType: 'typed_notes',
    extractedContent,
    sections,
    pageOrSlideCount: 1,
    processingStatus: 'ready',
    originalFileName: file.name,
    uncertainCount: 0,
    usedVision: false,
    warnings: [],
  };
}

async function runVisionOcrForImageFile(
  file: File,
  options: {
    mode: VisionExtractionMode;
    pageNumber?: number;
    signal?: AbortSignal;
    onProgress?: (progress: IngestionProgress) => void;
    labelPrefix?: string;
    progressBase?: number;
    progressSpan?: number;
  }
): Promise<{ sections: StudySection[]; uncertainCount: number; notes: string }> {
  const base = options.progressBase ?? 0;
  const span = options.progressSpan ?? 100;
  const prefix = options.labelPrefix ? `${options.labelPrefix} ` : '';

  if (options.signal?.aborted) {
    throw new DOMException('Extraction cancelled', 'AbortError');
  }

  options.onProgress?.({
    stage: `${prefix}Preparing image for OCR...`,
    percent: Math.round(base + span * 0.25),
  });
  const { base64, mimeType } = await compressImageFileToBase64(file);

  if (options.signal?.aborted) {
    throw new DOMException('Extraction cancelled', 'AbortError');
  }

  options.onProgress?.({
    stage:
      options.mode === 'handwriting'
        ? `${prefix}Interpreting handwritten notes with AI Vision...`
        : `${prefix}Extracting structured text from image with AI Vision...`,
    percent: Math.round(base + span * 0.6),
  });

  let visionRes = await extractImageWithVision({
    imageBase64: base64,
    mimeType,
    mode: options.mode,
    pageNumber: options.pageNumber,
    signal: options.signal,
  });

  if (isEffectivelyEmptyVisionResult(visionRes.sections)) {
    options.onProgress?.({
      stage: `${prefix}No text detected on first pass — re-analyzing full image...`,
      percent: Math.round(base + span * 0.8),
    });
    const fallbackRes = await extractImageWithVision({
      imageBase64: base64,
      mimeType,
      mode: 'page_image_fallback',
      pageNumber: options.pageNumber,
      signal: options.signal,
    });
    if (!isEffectivelyEmptyVisionResult(fallbackRes.sections)) {
      visionRes = fallbackRes;
    } else {
      visionRes = {
        sections: [],
        uncertainCount: 0,
        notes: fallbackRes.notes || visionRes.notes,
      };
    }
  }

  return visionRes;
}

export async function ingestImageBatch(
  files: File[],
  options: {
    overrideType?: MaterialType;
    visionMode?: VisionExtractionMode;
    onProgress?: (progress: IngestionProgress) => void;
    signal?: AbortSignal;
  } = {}
): Promise<ExtractionResult> {
  if (files.length === 0) {
    throw new Error('Select at least one image before extracting.');
  }
  if (files.length === 1) {
    return ingestUploadedFile(files[0], options);
  }

  const detectedType = options.overrideType ?? detectMaterialTypeFromFile(files[0]);
  const mode: VisionExtractionMode =
    options.visionMode ??
    (detectedType === 'handwritten_notes'
      ? 'handwriting'
      : detectedType === 'scanned_doc'
      ? 'scanned_doc'
      : 'textbook_photo');

  const resolvedMaterialType: MaterialType =
    mode === 'handwriting'
      ? 'handwritten_notes'
      : mode === 'scanned_doc'
      ? 'scanned_doc'
      : 'textbook_photo';

  const allSections: StudySection[] = [];
  const warnings: string[] = [];
  let maxUncertainFromModel = 0;
  let succeededCount = 0;

  for (let i = 0; i < files.length; i += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('Extraction cancelled', 'AbortError');
    }

    const file = files[i];
    const pageNum = i + 1;
    const progressBase = (i / files.length) * 100;
    const progressSpan = 100 / files.length;

    try {
      const visionRes = await runVisionOcrForImageFile(file, {
        mode,
        pageNumber: pageNum,
        signal: options.signal,
        onProgress: options.onProgress,
        labelPrefix: `Image ${pageNum} of ${files.length}:`,
        progressBase,
        progressSpan,
      });

      if (visionRes.sections.length > 0) {
        succeededCount += 1;
        allSections.push(...visionRes.sections);
        maxUncertainFromModel += visionRes.uncertainCount;
        if (visionRes.notes) {
          warnings.push(`Image ${pageNum} (${file.name}): ${visionRes.notes}`);
        }
      } else {
        warnings.push(`Image ${pageNum} (${file.name}): No readable text was detected.`);
      }
    } catch (err) {
      if (options.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : 'Vision OCR failed.';
      warnings.push(`Image ${pageNum} (${file.name}): ${msg}`);
    }
  }

  const sections = clampSectionsForFirestore(allSections);
  const extractedContent = sectionsToMarkdown(sections);
  const uncertainCount = Math.max(maxUncertainFromModel, countUncertainMarkers(extractedContent));

  if (succeededCount === 0 || !extractedContent.trim()) {
    throw new Error(
      'No readable text could be extracted from the selected images. Try clearer, well-lit photos.'
    );
  }

  const { title: combinedTitle, originalFileName: combinedFileName } = buildBatchImageMetadata(
    files.map((f) => f.name)
  );

  return {
    title: combinedTitle,
    materialType: resolvedMaterialType,
    extractedContent,
    sections,
    pageOrSlideCount: files.length,
    processingStatus: uncertainCount > 0 ? 'needs_review' : 'ready',
    originalFileName: combinedFileName,
    uncertainCount,
    usedVision: true,
    warnings,
  };
}

export function ingestTextInput(params: {
  title: string;
  rawText: string;
  materialType: 'typed_notes' | 'pasted_text';
}): ExtractionResult {
  const cleanTitle = params.title.trim() || 'Untitled Notes';
  const sections = parseStructuredText(params.rawText, cleanTitle);
  const extractedContent = sectionsToMarkdown(sections);
  const uncertainCount = countUncertainMarkers(extractedContent);

  return {
    title: cleanTitle,
    materialType: params.materialType,
    extractedContent,
    sections,
    pageOrSlideCount: 1,
    processingStatus: uncertainCount > 0 ? 'needs_review' : 'ready',
    originalFileName: '',
    uncertainCount,
    usedVision: false,
    warnings: [],
  };
}
