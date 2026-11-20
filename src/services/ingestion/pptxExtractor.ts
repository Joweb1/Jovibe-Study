import JSZip from 'jszip';
import type { StudySection } from '../../types/models';
import { generateDocumentId } from '../../utils/validation';
import { clampSectionsForFirestore } from './structureParser';

export interface PptxExtractionResult {
  sections: StudySection[];
  slideCount: number;
  warnings: string[];
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
  onProgress?: (current: number, total: number) => void
): Promise<PptxExtractionResult> {
  if (file.name.toLowerCase().endsWith('.ppt') && !file.name.toLowerCase().endsWith('.pptx')) {
    throw new Error(
      'Legacy binary .ppt files cannot be parsed directly in the browser. Please export or save as .pptx or .pdf first.'
    );
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

  for (let i = 0; i < slideEntries.length; i += 1) {
    const { filePath, slideNum } = slideEntries[i];
    onProgress?.(i + 1, slideEntries.length);

    const slideXml = await zip.files[filePath].async('string');
    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    const notesXml = zip.files[notesPath] ? await zip.files[notesPath].async('string') : undefined;

    const section = parseSlideXml(slideXml, slideNum, notesXml);
    if (section) {
      sections.push(section);
    } else {
      emptySlides += 1;
    }
  }

  if (emptySlides > 0) {
    warnings.push(
      `${emptySlides} ${emptySlides === 1 ? 'slide contained' : 'slides contained'} no selectable text (for example, image-only slides).`
    );
  }

  return {
    sections: clampSectionsForFirestore(sections),
    slideCount: slideEntries.length,
    warnings,
  };
}
