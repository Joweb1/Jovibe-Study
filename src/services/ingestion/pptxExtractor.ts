import JSZip from 'jszip';
import type { StudySection } from '../../types/models';
import { generateDocumentId } from '../../utils/validation';
import { clampSectionsForFirestore } from './structureParser';
import {
  compressImageFileToBase64,
  extractImageWithVision,
  isEffectivelyEmptyVisionResult,
} from './visionExtractor';

export interface PptxExtractionResult {
  sections: StudySection[];
  slideCount: number;
  warnings: string[];
  usedVision?: boolean;
  uncertainCount?: number;
}

const IMAGE_MEDIA_EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

async function extractEmbeddedSlideImagesWithVision(params: {
  zip: JSZip;
  slideNum: number;
  signal?: AbortSignal;
}): Promise<{ sections: StudySection[]; uncertainCount: number }> {
  const relsPath = `ppt/slides/_rels/slide${params.slideNum}.xml.rels`;
  const relsFile = params.zip.files[relsPath];
  if (!relsFile) return { sections: [], uncertainCount: 0 };

  const relsXml = await relsFile.async('string');
  const parser = new DOMParser();
  const relsDoc = parser.parseFromString(relsXml, 'application/xml');
  const relationships = Array.from(relsDoc.getElementsByTagName('*')).filter(
    (el) => el.localName === 'Relationship'
  );

  const imagePaths: string[] = [];
  for (const rel of relationships) {
    const target = rel.getAttribute('Target') || '';
    const extMatch = target.toLowerCase().match(/\.(png|jpe?g|webp)$/);
    if (!extMatch) continue;
    const normalized = target.replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
    const fullPath = normalized.startsWith('ppt/') ? normalized : `ppt/${normalized}`;
    if (params.zip.files[fullPath] && !imagePaths.includes(fullPath)) {
      imagePaths.push(fullPath);
    }
  }

  const collectedSections: StudySection[] = [];
  let totalUncertain = 0;

  // Limit per-slide image OCR to up to 3 largest/primary embedded images
  for (const imgPath of imagePaths.slice(0, 3)) {
    if (params.signal?.aborted) {
      throw new Error('Extraction cancelled by user.');
    }
    const ext = imgPath.toLowerCase().split('.').pop() || 'png';
    const mime = IMAGE_MEDIA_EXT_TO_MIME[ext] || 'image/png';
    const rawBlob = await params.zip.files[imgPath].async('blob');
    const typedBlob = new Blob([rawBlob], { type: mime });
    try {
      const { base64, mimeType } = await compressImageFileToBase64(typedBlob);
      const visionRes = await extractImageWithVision({
        imageBase64: base64,
        mimeType,
        mode: 'page_image_fallback',
        pageNumber: params.slideNum,
        signal: params.signal,
      });
      if (!isEffectivelyEmptyVisionResult(visionRes.sections)) {
        totalUncertain += visionRes.uncertainCount;
        for (const sec of visionRes.sections) {
          collectedSections.push({
            ...sec,
            heading: sec.heading.toLowerCase().startsWith('slide ')
              ? sec.heading
              : `Slide ${params.slideNum}: ${sec.heading.replace(/^Page \d+:\s*/i, '')}`,
            pageOrSlide: params.slideNum,
          });
        }
      }
    } catch (err) {
      if (params.signal?.aborted) {
        throw new Error('Extraction cancelled by user.');
      }
      // Continue trying any remaining images on this slide
    }
  }

  return { sections: collectedSections, uncertainCount: totalUncertain };
}

function getElementsByLocalName(root: Document | Element, localName: string): Element[] {
  const all = Array.from(root.getElementsByTagName('*'));
  return all.filter((el) => el.localName === localName);
}

function extractParagraphText(pEl: Element): string {
  const texts = getElementsByLocalName(pEl, 't').map((t) => t.textContent || '');
  return texts.join('').replace(/\s+/g, ' ').trim();
}

function extractTableMarkdown(tblEl: Element): string {
  const rows = getElementsByLocalName(tblEl, 'tr');
  if (rows.length === 0) return '';

  const matrix: string[][] = rows.map((row) => {
    const cells = getElementsByLocalName(row, 'tc');
    return cells.map((cell) => {
      const paras = getElementsByLocalName(cell, 'p')
        .map(extractParagraphText)
        .filter(Boolean);
      return paras.join(' / ').replace(/\|/g, '\\|');
    });
  });

  const colCount = Math.max(...matrix.map((r) => r.length), 0);
  if (colCount === 0) return '';

  const normalized = matrix.map((r) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push('');
    return padded;
  });

  const header = `| ${normalized[0].join(' | ')} |`;
  const divider = `| ${normalized[0].map(() => '---').join(' | ')} |`;
  const bodyRows = normalized.slice(1).map((r) => `| ${r.join(' | ')} |`);

  return [header, divider, ...bodyRows].join('\n');
}

function parseSlideXml(slideXml: string, slideNum: number, notesXml?: string): StudySection | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(slideXml, 'application/xml');

  let slideTitle = '';
  const bodyBlocks: string[] = [];

  // Extract shape text boxes while detecting title placeholders
  const shapes = getElementsByLocalName(doc, 'sp');
  for (const sp of shapes) {
    const placeholders = getElementsByLocalName(sp, 'ph');
    const phType = placeholders[0]?.getAttribute('type') || '';
    const isTitle = phType === 'title' || phType === 'ctrTitle';
    const isFooterNoise = phType === 'sldNum' || phType === 'ftr' || phType === 'dt';
    if (isFooterNoise) continue;

    const paragraphs = getElementsByLocalName(sp, 'p');
    const lines: string[] = [];

    for (const p of paragraphs) {
      const text = extractParagraphText(p);
      if (!text) continue;

      if (isTitle && !slideTitle) {
        slideTitle = text;
        continue;
      }

      const pPr = getElementsByLocalName(p, 'pPr')[0];
      const lvl = Number(pPr?.getAttribute('lvl') || '0');
      const hasBullet =
        getElementsByLocalName(p, 'buChar').length > 0 ||
        getElementsByLocalName(p, 'buAutoNum').length > 0 ||
        lvl > 0;

      if (hasBullet) {
        const indent = '  '.repeat(Math.min(3, Math.max(0, lvl)));
        lines.push(`${indent}- ${text}`);
      } else {
        lines.push(text);
      }
    }

    if (lines.length > 0) {
      bodyBlocks.push(lines.join('\n'));
    }
  }

  // Extract tables cleanly as Markdown tables
  const tables = getElementsByLocalName(doc, 'tbl');
  for (const tbl of tables) {
    const mdTable = extractTableMarkdown(tbl);
    if (mdTable) {
      bodyBlocks.push(mdTable);
    }
  }

  // Extract presenter speaker notes when present
  if (notesXml) {
    const notesDoc = parser.parseFromString(notesXml, 'application/xml');
    const notesShapes = getElementsByLocalName(notesDoc, 'sp');
    const noteLines: string[] = [];
    for (const sp of notesShapes) {
      const phType = getElementsByLocalName(sp, 'ph')[0]?.getAttribute('type') || '';
      if (phType === 'sldNum' || phType === 'sldImg') continue;
      for (const p of getElementsByLocalName(sp, 'p')) {
        const txt = extractParagraphText(p);
        if (txt && txt !== String(slideNum)) {
          noteLines.push(txt);
        }
      }
    }
    if (noteLines.length > 0) {
      bodyBlocks.push(`**Speaker Notes:**\n${noteLines.join('\n')}`);
    }
  }

  const content = bodyBlocks.join('\n\n').trim();
  if (!slideTitle && !content) {
    return null;
  }

  return {
    id: generateDocumentId(`slide${slideNum}`),
    heading: slideTitle ? `Slide ${slideNum}: ${slideTitle}` : `Slide ${slideNum}`,
    level: 2,
    content: content || slideTitle,
    pageOrSlide: slideNum,
  };
}

export async function extractPptxPresentation(
  file: File,
  onProgress?: (current: number, total: number) => void,
  signal?: AbortSignal
): Promise<PptxExtractionResult> {
  if (file.name.toLowerCase().endsWith('.ppt') && !file.name.toLowerCase().endsWith('.pptx')) {
    throw new Error(
      'Legacy binary .ppt files cannot be parsed directly in the browser. Please export or save as .pptx or .pdf first.'
    );
  }

  if (signal?.aborted) {
    throw new Error('Extraction cancelled by user.');
  }

  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const slideEntries = Object.keys(zip.files)
    .map((filePath) => {
      const match = filePath.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
      return match ? { filePath, slideNum: Number(match[1]) } : null;
    })
    .filter((entry): entry is { filePath: string; slideNum: number } => entry !== null)
    .sort((a, b) => a.slideNum - b.slideNum);

  if (slideEntries.length === 0) {
    throw new Error('No slides were found inside this PowerPoint file.');
  }

  const sections: StudySection[] = [];
  const warnings: string[] = [];
  let emptySlides = 0;
  let usedVision = false;
  let uncertainCount = 0;

  for (let i = 0; i < slideEntries.length; i += 1) {
    if (signal?.aborted) {
      throw new Error('Extraction cancelled by user.');
    }

    const { filePath, slideNum } = slideEntries[i];
    onProgress?.(i + 1, slideEntries.length);

    const slideXml = await zip.files[filePath].async('string');
    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    const notesXml = zip.files[notesPath] ? await zip.files[notesPath].async('string') : undefined;

    const section = parseSlideXml(slideXml, slideNum, notesXml);
    if (section) {
      sections.push(section);
    } else {
      // Slide had no selectable XML text — inspect embedded slide images and run Vision OCR before marking empty
      const imgRes = await extractEmbeddedSlideImagesWithVision({
        zip,
        slideNum,
        signal,
      });
      if (imgRes.sections.length > 0) {
        usedVision = true;
        uncertainCount += imgRes.uncertainCount;
        sections.push(...imgRes.sections);
      } else {
        emptySlides += 1;
      }
    }

    if (i % 3 === 2) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  if (emptySlides > 0) {
    warnings.push(
      `${emptySlides} ${emptySlides === 1 ? 'slide appeared' : 'slides appeared'} empty even after checking embedded images.`
    );
  }

  return {
    sections: clampSectionsForFirestore(sections),
    slideCount: slideEntries.length,
    warnings,
    usedVision,
    uncertainCount,
  };
}
