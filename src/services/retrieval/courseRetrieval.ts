import type { SourceReference, StudySource } from '../../types/models';

export interface RetrievedChunk {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  topicId: string;
  sectionHeading: string;
  pageOrSlide?: number;
  content: string;
  score: number;
}

export interface GroundedContextResult {
  contextText: string;
  references: SourceReference[];
  chunks: RetrievedChunk[];
  totalChunksEvaluated: number;
  estimatedTokens: number;
}

export interface RetrievalOptions {
  topicIds?: string[];
  sourceIds?: string[];
  maxChunks?: number;
  maxContextChars?: number;
}

export interface CourseRetriever {
  retrieve(query: string, sources: StudySource[], options?: RetrievalOptions): GroundedContextResult;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'could', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'how', 'i', 'in', 'into', 'is', 'it', 'its', 'me',
  'my', 'of', 'on', 'or', 'our', 'please', 'should', 'so', 'tell', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'to', 'us', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
  'explain', 'define', 'summarize', 'describe', 'give', 'example', 'examples', 'difference',
  'between', 'about', 'mean', 'means',
]);

const MAX_CHUNK_CHARS = 1400;
const CHUNK_OVERLAP_CHARS = 160;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function splitLongText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHUNK_CHARS) return [trimmed];

  const paragraphs = trimmed.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length <= MAX_CHUNK_CHARS) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      if (current) {
        chunks.push(current);
        const tail = current.slice(-CHUNK_OVERLAP_CHARS).trim();
        current = tail ? `${tail}\n\n${para}` : para;
      } else {
        // Single giant paragraph fallback split
        for (let i = 0; i < para.length; i += MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS) {
          chunks.push(para.slice(i, i + MAX_CHUNK_CHARS));
        }
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Converts StudySources into traceable structural chunks preserving
 * sourceId, title, section heading, page/slide number, and personal notes.
 */
export function chunkStudySources(sources: StudySource[]): Omit<RetrievedChunk, 'score'>[] {
  const chunks: Omit<RetrievedChunk, 'score'>[] = [];

  for (const source of sources) {
    if (source.sections && source.sections.length > 0) {
      source.sections.forEach((sec, secIdx) => {
        const pieces = splitLongText(sec.content || '');
        pieces.forEach((piece, pieceIdx) => {
          if (!piece.trim()) return;
          chunks.push({
            chunkId: `${source.id}_s${secIdx}_p${pieceIdx}`,
            sourceId: source.id,
            sourceTitle: source.title,
            topicId: source.topicId,
            sectionHeading: sec.heading || `Section ${secIdx + 1}`,
            pageOrSlide: sec.pageOrSlide,
            content: piece.trim(),
          });
        });
      });
    } else if (source.extractedContent && source.extractedContent.trim()) {
      const pieces = splitLongText(source.extractedContent);
      pieces.forEach((piece, pieceIdx) => {
        chunks.push({
          chunkId: `${source.id}_raw_${pieceIdx}`,
          sourceId: source.id,
          sourceTitle: source.title,
          topicId: source.topicId,
          sectionHeading: source.title,
          content: piece.trim(),
        });
      });
    }

    if (source.studentNotes && source.studentNotes.trim()) {
      chunks.push({
        chunkId: `${source.id}_notes`,
        sourceId: source.id,
        sourceTitle: source.title,
        topicId: source.topicId,
        sectionHeading: 'Student Annotations',
        content: source.studentNotes.trim().slice(0, MAX_CHUNK_CHARS),
      });
    }
  }

  return chunks;
}

/**
 * Lexical BM25-inspired retriever that ranks relevant chunks within the active
 * course without dumping the entire library into every AI prompt.
 * Designed behind CourseRetriever so vector/embedding search can plug in later.
 */
export class LexicalCourseRetriever implements CourseRetriever {
  retrieve(
    query: string,
    sources: StudySource[],
    options: RetrievalOptions = {}
  ): GroundedContextResult {
    const maxChunks = options.maxChunks ?? 8;
    const maxContextChars = options.maxContextChars ?? 16_000;

    // Filter sources by optional topicIds / sourceIds
    const scopedSources = sources.filter((src) => {
      if (options.sourceIds && options.sourceIds.length > 0) {
        if (!options.sourceIds.includes(src.id)) return false;
      }
      if (options.topicIds && options.topicIds.length > 0) {
        if (!options.topicIds.includes(src.topicId)) return false;
      }
      return true;
    });

    const allChunks = chunkStudySources(scopedSources);
    if (allChunks.length === 0) {
      return {
        contextText: '',
        references: [],
        chunks: [],
        totalChunksEvaluated: 0,
        estimatedTokens: 0,
      };
    }

    const queryTokens = tokenize(query);
    const normalizedQuery = query.trim().toLowerCase();

    // If query is empty or broad (e.g., generating course-wide practice or overview),
    // sample evenly across sources up to the budget.
    if (queryTokens.length === 0) {
      return packChunksIntoContext(
        allChunks.map((c, idx) => ({ ...c, score: 1 / (idx + 1) })),
        allChunks.length,
        maxChunks,
        maxContextChars
      );
    }

    // Compute document frequencies for IDF weighting
    const docFreq = new Map<string, number>();
    const chunkTokenLists = allChunks.map((chunk) => {
      const tokens = tokenize(`${chunk.sourceTitle} ${chunk.sectionHeading} ${chunk.content}`);
      const unique = new Set(tokens);
      unique.forEach((t) => docFreq.set(t, (docFreq.get(t) ?? 0) + 1));
      return tokens;
    });

    const N = allChunks.length;
    const avgLen =
      chunkTokenLists.reduce((sum, list) => sum + list.length, 0) / Math.max(1, N);
    const k1 = 1.5;
    const b = 0.75;

    const scored: RetrievedChunk[] = allChunks.map((chunk, idx) => {
      const tokens = chunkTokenLists[idx];
      const len = tokens.length || 1;
      const tfMap = new Map<string, number>();
      for (const t of tokens) {
        tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
      }

      let score = 0;
      const headingLower = `${chunk.sourceTitle} ${chunk.sectionHeading}`.toLowerCase();
      const contentLower = chunk.content.toLowerCase();

      for (const qt of queryTokens) {
        const df = docFreq.get(qt) ?? 0;
        if (df === 0) continue;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const tf = tfMap.get(qt) ?? 0;
        if (tf > 0) {
          score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (len / avgLen))));
        }
        // Boost direct matches in headings / titles
        if (headingLower.includes(qt)) {
          score += idf * 1.4;
        }
      }

      // Boost exact phrase presence
      if (normalizedQuery.length >= 6 && contentLower.includes(normalizedQuery)) {
        score += 4.0;
      }
      if (normalizedQuery.length >= 4 && headingLower.includes(normalizedQuery)) {
        score += 3.0;
      }

      return { ...chunk, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const positiveMatches = scored.filter((c) => c.score > 0);
    const selectedPool = positiveMatches.length > 0 ? positiveMatches : scored.slice(0, Math.min(3, maxChunks));

    return packChunksIntoContext(selectedPool, allChunks.length, maxChunks, maxContextChars);
  }
}

function packChunksIntoContext(
  rankedChunks: RetrievedChunk[],
  totalChunksEvaluated: number,
  maxChunks: number,
  maxContextChars: number
): GroundedContextResult {
  const chosen: RetrievedChunk[] = [];
  const blocks: string[] = [];
  const refKeySet = new Set<string>();
  const references: SourceReference[] = [];
  let charCount = 0;

  for (const chunk of rankedChunks) {
    if (chosen.length >= maxChunks) break;

    const locationLabel = chunk.pageOrSlide ? ` | Page/Slide ${chunk.pageOrSlide}` : '';
    const block = `[Source ${chosen.length + 1}: ${chunk.sourceTitle} — ${chunk.sectionHeading}${locationLabel}]\n${chunk.content}`;

    if (charCount + block.length > maxContextChars && chosen.length > 0) {
      break;
    }

    chosen.push(chunk);
    blocks.push(block);
    charCount += block.length + 2;

    const refKey = `${chunk.sourceId}::${chunk.sectionHeading}::${chunk.pageOrSlide ?? ''}`;
    if (!refKeySet.has(refKey)) {
      refKeySet.add(refKey);
      references.push({
        sourceId: chunk.sourceId,
        sourceTitle: chunk.sourceTitle,
        sectionHeading: chunk.sectionHeading,
        ...(typeof chunk.pageOrSlide === 'number' ? { pageOrSlide: chunk.pageOrSlide } : {}),
      });
    }
  }

  const contextText = blocks.join('\n\n---\n\n');
  return {
    contextText,
    references,
    chunks: chosen,
    totalChunksEvaluated,
    estimatedTokens: Math.ceil(contextText.length / 4),
  };
}

export const defaultCourseRetriever: CourseRetriever = new LexicalCourseRetriever();

/**
 * Convenience helper for Practice & Automatic Study generators that need broad,
 * representative coverage of selected topics (or whole course) within a token budget.
 */
export function buildCourseStudyContext(
  sources: StudySource[],
  options: {
    topicIds?: string[];
    focusQuery?: string;
    maxContextChars?: number;
    maxChunks?: number;
  } = {}
): GroundedContextResult {
  return defaultCourseRetriever.retrieve(options.focusQuery || '', sources, {
    topicIds: options.topicIds,
    maxContextChars: options.maxContextChars ?? 22_000,
    maxChunks: options.maxChunks ?? 14,
  });
}
