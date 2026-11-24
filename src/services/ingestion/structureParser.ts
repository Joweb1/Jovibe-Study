import type { MaterialType, StudySection } from '../../types/models';
import { generateDocumentId, SCHEMA_LIMITS } from '../../utils/validation';

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  pdf: 'PDF Document',
  slides: 'PowerPoint Slides',
  textbook_photo: 'Textbook Photo',
  handwritten_notes: 'Handwritten Notes',
  scanned_doc: 'Scanned Document',
  typed_notes: 'Typed Notes',
  pasted_text: 'Pasted Text',
  other: 'Other Material',
};

const UNCERTAIN_REGEX = /\[(?:unclear(?::[^\]]*)?|illegible)\]/gi;

export function countUncertainMarkers(text: string): number {
  const matches = text.match(UNCERTAIN_REGEX);
  return matches ? matches.length : 0;
}

export function isSupportedImageFile(file: { name?: string; type?: string }): boolean {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(file.name || '');
}

export function detectMaterialTypeFromFile(file: File): MaterialType {
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();

  if (name.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (
    name.endsWith('.pptx') ||
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return 'slides';
  }
  if (isSupportedImageFile({ name, type: mime })) {
    return 'textbook_photo';
  }
  if (name.endsWith('.md') || name.endsWith('.txt') || mime.startsWith('text/')) {
    return 'typed_notes';
  }
  return 'other';
}

export function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

export function buildBatchImageMetadata(fileNames: string[]): {
  title: string;
  originalFileName: string;
  pageOrSlideCount: number;
} {
  if (fileNames.length === 0) {
    return {
      title: 'Study Notes',
      originalFileName: '',
      pageOrSlideCount: 0,
    };
  }
  const firstBaseTitle = stripFileExtension(fileNames[0]) || 'Study Notes';
  const title =
    fileNames.length === 1
      ? firstBaseTitle.slice(0, SCHEMA_LIMITS.SOURCE_TITLE_MAX)
      : `${firstBaseTitle} (+${fileNames.length - 1} more)`.slice(0, SCHEMA_LIMITS.SOURCE_TITLE_MAX);
  const originalFileName = fileNames.join(', ').slice(0, 260);
  return {
    title,
    originalFileName,
    pageOrSlideCount: fileNames.length,
  };
}

/**
 * Parses plain or markdown-structured text into StudySection blocks while
 * preserving headings, subheadings, lists, definitions, examples, and tables.
 */
export function parseStructuredText(
  rawText: string,
  fallbackHeading = 'Study Notes',
  pageOrSlide?: number
): StudySection[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const sections: StudySection[] = [];
  let currentHeading = fallbackHeading;
  let currentLevel = 1;
  let currentPageOrSlide = pageOrSlide;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (!content) return;
    sections.push({
      id: generateDocumentId('sec'),
      heading: currentHeading.slice(0, 180),
      level: currentLevel,
      content,
      ...(typeof currentPageOrSlide === 'number' ? { pageOrSlide: currentPageOrSlide } : {}),
    });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // Markdown heading (#, ##, ###)
    const mdHeading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (mdHeading) {
      flush();
      currentLevel = mdHeading[1].length;
      const headingText = mdHeading[2].trim();
      const pageRefMatch = headingText.match(/^(?:Page|Slide)\s+(\d+)(?:\s*[:\-–—]\s*(.*))?$/i);
      if (pageRefMatch) {
        currentPageOrSlide = Number(pageRefMatch[1]);
        currentHeading = headingText;
      } else {
        currentHeading = headingText;
      }
      continue;
    }

    // Explicit Slide/Page boundary marker like "--- Slide 4 ---" or "Page 12:"
    const boundaryMatch = trimmed.match(/^(?:---+\s*)?(Page|Slide)\s+(\d+)(?:\s*[:\-–—]\s*(.+?))?(?:\s*---+)?$/i);
    if (boundaryMatch && trimmed.length <= 120) {
      flush();
      currentPageOrSlide = Number(boundaryMatch[2]);
      currentLevel = 2;
      currentHeading = boundaryMatch[3]
        ? `${boundaryMatch[1]} ${boundaryMatch[2]}: ${boundaryMatch[3].trim()}`
        : `${boundaryMatch[1]} ${boundaryMatch[2]}`;
      continue;
    }

    // Numbered chapter/section heading (e.g. "1. Introduction to Demand" or "CHAPTER 2: COST")
    const numberedHeading = trimmed.match(
      /^(?:(?:Chapter|Unit|Section|Module|Topic|Part)\s+\d+[:.\-–]?\s+.+|\d+(?:\.\d+)?\s+[A-Z][A-Za-z0-9 ,:&()'/-]{2,70})$/
    );
    const prevBlank = i === 0 || lines[i - 1].trim() === '';
    const nextBlankOrText = i === lines.length - 1 || lines[i + 1].trim() !== '';
    if (numberedHeading && prevBlank && nextBlankOrText && !trimmed.endsWith('.') && trimmed.length <= 90) {
      flush();
      currentLevel = trimmed.match(/^\d+\.\d+/) ? 3 : 2;
      currentHeading = trimmed;
      continue;
    }

    buffer.push(line);
  }

  flush();

  if (sections.length === 0) {
    return [
      {
        id: generateDocumentId('sec'),
        heading: fallbackHeading.slice(0, 180),
        level: 1,
        content: normalized,
        ...(typeof pageOrSlide === 'number' ? { pageOrSlide } : {}),
      },
    ];
  }

  return clampSectionsForFirestore(sections);
}

/**
 * Serializes structured sections into clean, readable, editable Markdown text.
 */
export function sectionsToMarkdown(sections: StudySection[]): string {
  return sections
    .map((sec) => {
      const hashes = '#'.repeat(Math.min(3, Math.max(1, sec.level || 2)));
      const headingLine =
        sec.pageOrSlide && !sec.heading.toLowerCase().includes(`page ${sec.pageOrSlide}`) && !sec.heading.toLowerCase().includes(`slide ${sec.pageOrSlide}`)
          ? `${hashes} ${sec.heading} (p. ${sec.pageOrSlide})`
          : `${hashes} ${sec.heading}`;
      return `${headingLine}\n\n${sec.content.trim()}`;
    })
    .join('\n\n')
    .trim();
}

/**
 * Ensures sections and extractedContent respect Firestore 1MB and schema limits.
 */
export function clampSectionsForFirestore(sections: StudySection[]): StudySection[] {
  const MAX_SECTIONS = 300;
  const bounded = sections.slice(0, MAX_SECTIONS).map((sec, idx) => ({
    id: sec.id || generateDocumentId(`sec${idx}`),
    heading: (sec.heading || `Section ${idx + 1}`).trim().slice(0, 180),
    level: Math.min(3, Math.max(1, Math.floor(sec.level || 2))),
    content: (sec.content || '').trim(),
    ...(typeof sec.pageOrSlide === 'number' && Number.isFinite(sec.pageOrSlide)
      ? { pageOrSlide: Math.max(1, Math.floor(sec.pageOrSlide)) }
      : {}),
  }));

  // Guard combined character footprint under SCHEMA_LIMITS.SOURCE_CONTENT_MAX
  let totalChars = 0;
  const result: StudySection[] = [];
  for (const sec of bounded) {
    const remaining = SCHEMA_LIMITS.SOURCE_CONTENT_MAX - 10_000 - totalChars;
    if (remaining <= 0) break;
    if (sec.content.length > remaining) {
      result.push({
        ...sec,
        content: `${sec.content.slice(0, Math.max(0, remaining - 40)).trim()}\n\n[Truncated to fit document size limit]`,
      });
      break;
    }
    totalChars += sec.content.length + sec.heading.length + 20;
    result.push(sec);
  }
  return result;
}
