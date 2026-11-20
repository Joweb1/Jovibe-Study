import type { MaterialType, ProcessingStatus, StudySection } from '../../types/models';
import { extractPdfDocument } from './pdfExtractor';
import { extractPptxPresentation } from './pptxExtractor';
import {
  clampSectionsForFirestore,
  countUncertainMarkers,
  detectMaterialTypeFromFile,
  parseStructuredText,
  sectionsToMarkdown,
  stripFileExtension,
} from './structureParser';
import {
  compressImageFileToBase64,
  extractImageWithVision,
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
          percent: Math.round((p.currentPage / Math.max(1, p.totalPages)) * 100),
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
    const pptxRes = await extractPptxPresentation(file, (curr, total) => {
      options.onProgress?.({
        stage: `Extracting slide ${curr} of ${total}...`,
        percent: Math.round((curr / Math.max(1, total)) * 100),
      });
    });

    const extractedContent = sectionsToMarkdown(pptxRes.sections);
    return {
      title: defaultTitle,
      materialType: 'slides',
      extractedContent,
      sections: pptxRes.sections,
      pageOrSlideCount: pptxRes.slideCount,
      processingStatus: 'ready',
      originalFileName: file.name,
      uncertainCount: 0,
      usedVision: false,
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

    const visionRes = await extractImageWithVision({
      imageBase64: base64,
      mimeType,
      mode,
      signal: options.signal,
    });

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
