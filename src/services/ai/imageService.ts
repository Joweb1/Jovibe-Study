import { generateStudyImageWithClient } from './geminiClient';
import { saveCachedGeneratedImage } from '../local/indexedDb';

const IMAGE_NOUN =
  '(?:image|picture|photo|photograph|illustration|infographic|diagram|visual(?:ization)?|drawing|sketch|poster|graphic|schematic|mind\\s*map|flowchart|concept\\s*map)';

const GENERATE_VERB =
  '(?:generate|create|make|draw|sketch|design|produce|render|paint|build|craft)';

const SHOW_GIVE_VERB = '(?:show|give|send|provide)';

const EXPLICIT_GENERATE_RE = new RegExp(
  `\\b${GENERATE_VERB}\\b[^.!?\\n]{0,60}\\b${IMAGE_NOUN}s?\\b`,
  'i'
);

const EXPLICIT_SHOW_RE = new RegExp(
  `\\b${SHOW_GIVE_VERB}\\s+(?:me\\s+)?(?:an?\\s+|some\\s+)?(?:[a-z-]+\\s+){0,3}${IMAGE_NOUN}\\b`,
  'i'
);

const EXPLICIT_AS_VISUAL_RE = new RegExp(
  `\\b(?:as|into)\\s+an?\\s+(?:[a-z-]+\\s+){0,2}${IMAGE_NOUN}\\b`,
  'i'
);

const LEADING_IMAGE_COMMAND_RE = new RegExp(
  `^\\s*(?:please\\s+)?(?:an?\\s+)?${IMAGE_NOUN}\\s+(?:of|for|about|showing|explaining|illustrating|depicting)\\b`,
  'i'
);

const VISUALLY_ILLUSTRATE_RE =
  /\b(?:visually\s+illustrate|illustrate\s+(?:this|that|it|the\s+[a-z0-9\s-]{1,35})?\s*(?:visually|with\s+an?\s+(?:image|diagram|infographic|visual|picture|drawing)))\b/i;

/**
 * Strict intent detector for Tutor Chat.
 *
 * Returns `true` ONLY when the user explicitly asks to generate, create, draw,
 * or show an image / infographic / diagram / illustration / picture.
 *
 * Deliberately returns `false` for normal conceptual questions that merely
 * mention words like "image" or "diagram" (e.g., "what is a virtual image in
 * optics?", "explain the diagram in my lecture notes", "draw a conclusion").
 */
export function detectExplicitImageRequest(question: string): boolean {
  const q = (question || '').trim();
  if (!q) return false;

  if (
    EXPLICIT_GENERATE_RE.test(q) ||
    EXPLICIT_SHOW_RE.test(q) ||
    EXPLICIT_AS_VISUAL_RE.test(q) ||
    LEADING_IMAGE_COMMAND_RE.test(q) ||
    VISUALLY_ILLUSTRATE_RE.test(q)
  ) {
    return true;
  }

  return false;
}

/**
 * Crafts a clean academic infographic/illustration prompt for Automatic Study units.
 */
export function buildConceptInfographicPrompt(params: {
  courseCode: string;
  courseName: string;
  unitTitle: string;
  conceptSummary: string;
  customVisualPrompt?: string;
}): string {
  const coreScene = (params.customVisualPrompt || '').trim();
  const cleanSummary = params.conceptSummary
    .replace(/[#*_`>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 420);

  return [
    'Clean modern university textbook educational infographic and illustrative concept diagram.',
    `Course: ${params.courseCode} — ${params.courseName}.`,
    `Concept: ${params.unitTitle}.`,
    coreScene
      ? `Visual composition: ${coreScene}`
      : `Illustrate the core mechanism and structure clearly: ${cleanSummary}`,
    'Style: crisp flat vector editorial illustration on a clean light neutral background, clear spatial hierarchy, distinct color-coded components, clear visual flow arrows, balanced minimalist layout, high legibility, no cluttered tiny paragraphs, no watermarks.',
  ].join(' ');
}

/**
 * Crafts an educational visual prompt for an explicit Tutor Chat image request.
 */
export function buildChatImagePrompt(params: {
  courseCode: string;
  courseName: string;
  userRequest: string;
  answerExcerpt: string;
}): string {
  const cleanRequest = params.userRequest.replace(/\s+/g, ' ').trim().slice(0, 320);
  const cleanAnswer = params.answerExcerpt
    .replace(/[#*_`>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 380);

  return [
    'Clean modern academic educational illustration / infographic diagram.',
    `Course context: ${params.courseCode} — ${params.courseName}.`,
    `Student visual request: ${cleanRequest}`,
    cleanAnswer ? `Key accurate details to depict: ${cleanAnswer}` : '',
    'Style: crisp textbook diagram / infographic on a clean light background, clear visual structure, high contrast, accurate scientific/academic depiction, no watermarks.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const normalized = base64.replace(/^data:[^;]+;base64,/, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'image/jpeg' });
}

export interface GeneratedStudyImageResult {
  blob: Blob;
  mimeType: string;
  caption: string;
  prompt: string;
  provider: string;
  model: string;
}

/**
 * Generates an educational study visual using the configured provider fallback chain
 * and stores it ONLY in device-local offline cache (coupled to `localStorage`).
 * Never uploads or persists image data to Firestore or cloud storage.
 */
export async function generateAndCacheStudyImage(params: {
  id: string;
  userId: string;
  courseId: string;
  scopeId: string;
  feature: 'automatic_study' | 'tutor';
  prompt: string;
  caption: string;
  aspectRatio?: '16:9' | '4:3' | '1:1' | '3:4';
  signal?: AbortSignal;
}): Promise<GeneratedStudyImageResult> {
  const generated = await generateStudyImageWithClient({
    prompt: params.prompt,
    aspectRatio: params.aspectRatio || '16:9',
    signal: params.signal,
  });

  const blob = base64ToBlob(generated.imageBase64, generated.mimeType);

  await saveCachedGeneratedImage({
    id: params.id,
    userId: params.userId,
    courseId: params.courseId,
    scopeId: params.scopeId,
    feature: params.feature,
    prompt: params.prompt,
    caption: params.caption,
    mimeType: generated.mimeType,
    imageBlob: blob,
    model: generated.meta.model,
    provider: generated.meta.provider,
  });

  return {
    blob,
    mimeType: generated.mimeType,
    caption: params.caption,
    prompt: params.prompt,
    provider: generated.meta.provider,
    model: generated.meta.model,
  };
}
