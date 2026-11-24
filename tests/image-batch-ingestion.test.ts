import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBatchImageMetadata,
  clampSectionsForFirestore,
  detectMaterialTypeFromFile,
  isSupportedImageFile,
  sectionsToMarkdown,
} from '../src/services/ingestion/structureParser.ts';
import { SCHEMA_LIMITS } from '../src/utils/validation.ts';

test('isSupportedImageFile accepts image MIME types and common mobile/gallery extensions even without MIME type', () => {
  assert.equal(isSupportedImageFile({ name: 'page1.jpg', type: 'image/jpeg' }), true);
  assert.equal(isSupportedImageFile({ name: 'diagram.webp', type: 'image/webp' }), true);
  assert.equal(isSupportedImageFile({ name: 'camera_shot', type: 'image/png' }), true);

  // Mobile pickers sometimes leave file.type empty for HEIC/HEIF/AVIF/JPG
  assert.equal(isSupportedImageFile({ name: 'IMG_20261124.HEIC', type: '' }), true);
  assert.equal(isSupportedImageFile({ name: 'scan_02.heif', type: '' }), true);
  assert.equal(isSupportedImageFile({ name: 'chart.avif', type: '' }), true);
  assert.equal(isSupportedImageFile({ name: 'notes.JPEG', type: '' }), true);

  // Non-images must be rejected
  assert.equal(isSupportedImageFile({ name: 'syllabus.pdf', type: 'application/pdf' }), false);
  assert.equal(isSupportedImageFile({ name: 'slides.pptx', type: '' }), false);
  assert.equal(isSupportedImageFile({ name: 'notes.txt', type: 'text/plain' }), false);
});

test('detectMaterialTypeFromFile classifies HEIC/AVIF/JPEG images as textbook_photo', () => {
  const heicFile = { name: 'IMG_001.heic', type: '' } as File;
  const pdfFile = { name: 'chapter1.pdf', type: 'application/pdf' } as File;
  assert.equal(detectMaterialTypeFromFile(heicFile), 'textbook_photo');
  assert.equal(detectMaterialTypeFromFile(pdfFile), 'pdf');
});

test('buildBatchImageMetadata formats single and multi-image titles & bounds to schema limits', () => {
  const empty = buildBatchImageMetadata([]);
  assert.equal(empty.pageOrSlideCount, 0);
  assert.equal(empty.originalFileName, '');

  const single = buildBatchImageMetadata(['biology_chapter-4.png']);
  assert.equal(single.title, 'biology chapter 4');
  assert.equal(single.originalFileName, 'biology_chapter-4.png');
  assert.equal(single.pageOrSlideCount, 1);

  const batch = buildBatchImageMetadata(['page_1.jpg', 'page_2.jpg', 'page_3.png']);
  assert.equal(batch.title, 'page 1 (+2 more)');
  assert.equal(batch.originalFileName, 'page_1.jpg, page_2.jpg, page_3.png');
  assert.equal(batch.pageOrSlideCount, 3);

  const longNames = Array.from({ length: 25 }, (_, i) => `very_long_lecture_slide_photo_capture_number_${i + 1}.jpeg`);
  const bounded = buildBatchImageMetadata(longNames);
  assert.equal(bounded.pageOrSlideCount, 25);
  assert.ok(bounded.title.length <= SCHEMA_LIMITS.SOURCE_TITLE_MAX);
  assert.ok(bounded.originalFileName.length <= 260);
});

test('multi-page image sections keep pageOrSlide labels when serialized and clamped', () => {
  const sections = clampSectionsForFirestore([
    { id: 's1', heading: 'Cell Membrane', level: 2, content: 'Phospholipid bilayer structure.', pageOrSlide: 1 },
    { id: 's2', heading: 'Active Transport', level: 2, content: 'Requires ATP to move solutes.', pageOrSlide: 2 },
  ]);
  const markdown = sectionsToMarkdown(sections);
  assert.match(markdown, /## Cell Membrane \(p\. 1\)/);
  assert.match(markdown, /## Active Transport \(p\. 2\)/);
});
