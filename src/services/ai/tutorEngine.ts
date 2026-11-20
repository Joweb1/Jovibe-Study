import type {
  Course,
  SourceReference,
  StudySource,
  Topic,
  TutorMessage,
  TutorSourceMode,
} from '../../types/models';
import { defaultCourseRetriever } from '../retrieval/courseRetrieval';
import { generateText, type AiRequestMeta } from './geminiClient';

export interface TutorTurnResult {
  answer: string;
  sourceReferences: SourceReference[];
  meta: AiRequestMeta | null;
  groundedFromLibrary: boolean;
}

const MAX_HISTORY_TURNS = 10;

function buildSourceModeInstruction(params: {
  course: Course;
  topicName?: string;
  sourceMode: TutorSourceMode;
  contextText: string;
}): string {
  const courseHeader = `You are SOTAL Study's academic AI Tutor for the course "${params.course.code} — ${params.course.name}".${
    params.course.description ? ` Course description: ${params.course.description}` : ''
  }${params.topicName ? ` Active topic focus: ${params.topicName}.` : ''}`;

  const styleRules = [
    'Write clearly, accurately, and concisely in structured academic Markdown (short headings, bullet points, numbered steps, or concise comparison tables when helpful).',
    'Never fabricate page numbers, citations, or claims.',
    'Keep explanations directly useful for university/exam comprehension.',
  ].join(' ');

  if (params.sourceMode === 'materials_only') {
    return [
      courseHeader,
      'SOURCE POLICY — MY MATERIALS ONLY (STRICT):',
      'Answer STRICTLY and EXCLUSIVELY using the provided student course excerpts below.',
      'Do NOT introduce outside facts, definitions, formulas, or examples that are not supported by the provided excerpts.',
      'If the provided excerpts only partially answer the question, answer the supported part and explicitly state what is missing from the student’s uploaded materials.',
      'If the provided excerpts do not contain the answer at all, clearly state: "Your uploaded materials for this course do not cover this question yet." and suggest switching to "My Materials + AI Explanation" or uploading relevant notes.',
      'Cite the source title and section/page inline when referencing material (e.g., [Lecture 4, Page 5]).',
      styleRules,
      '\n=== STUDENT COURSE MATERIALS ===\n' + params.contextText,
    ].join('\n\n');
  }

  if (params.sourceMode === 'materials_plus_ai') {
    const contextBlock = params.contextText
      ? '\n=== STUDENT COURSE MATERIALS (PRIMARY FOUNDATION) ===\n' + params.contextText
      : '\n=== STUDENT COURSE MATERIALS ===\nNo matching excerpts were found in the student’s uploaded library for this specific question.';

    return [
      courseHeader,
      'SOURCE POLICY — MY MATERIALS + AI EXPLANATION:',
      'Use the student’s uploaded course materials below as your primary foundation.',
      'You may add clear supplementary explanations, intuitive analogies, worked examples, or missing background context from broader academic knowledge.',
      'Whenever you go beyond the uploaded notes, explicitly distinguish what comes from the course materials (citing the source title/section) versus your supplementary AI explanation (e.g., under a clear "Supplementary explanation" or "Worked example" note).',
      styleRules,
      contextBlock,
    ].join('\n\n');
  }

  return [
    courseHeader,
    'SOURCE POLICY — GENERAL AI KNOWLEDGE:',
    'Answer using rigorous general academic knowledge tailored to this course.',
    'Do not pretend to cite the student’s uploaded notes unless they explicitly pasted text into their question.',
    styleRules,
  ].join('\n\n');
}

export async function runCourseTutorTurn(params: {
  course: Course;
  topics: Topic[];
  sources: StudySource[];
  history: TutorMessage[];
  question: string;
  sourceMode: TutorSourceMode;
  selectedTopicId?: string;
  model: string;
  signal?: AbortSignal;
}): Promise<TutorTurnResult> {
  const trimmedQuestion = params.question.trim();
  const activeTopic = params.selectedTopicId
    ? params.topics.find((t) => t.id === params.selectedTopicId)
    : undefined;

  // Build retrieval query combining current question + last user prompt for follow-up coherence
  const recentUserMessages = params.history
    .filter((m) => m.role === 'user')
    .slice(-2)
    .map((m) => m.content);
  const retrievalQuery = [...recentUserMessages, trimmedQuestion].join(' ');

  let contextText = '';
  let sourceReferences: SourceReference[] = [];
  let groundedFromLibrary = false;

  if (params.sourceMode !== 'general_ai') {
    const scopedSources = params.selectedTopicId
      ? params.sources.filter((s) => s.topicId === params.selectedTopicId)
      : params.sources;

    if (params.sourceMode === 'materials_only' && scopedSources.length === 0) {
      const scopeDesc = activeTopic
        ? `the topic "${activeTopic.name}" in ${params.course.code}`
        : `${params.course.code} — ${params.course.name}`;
      return {
        answer:
          `You have not uploaded any study materials for ${scopeDesc} yet.\n\n` +
          `Because **My Materials Only** mode is active, I cannot answer from outside knowledge. ` +
          `Upload lecture notes, slides, or PDFs in the **Library**, or switch the Tutor source mode to **My Materials + AI Explanation** or **General AI Knowledge**.`,
        sourceReferences: [],
        meta: null,
        groundedFromLibrary: false,
      };
    }

    if (scopedSources.length > 0) {
      const retrieved = defaultCourseRetriever.retrieve(retrievalQuery, scopedSources, {
        maxContextChars: 18_000,
        maxChunks: 10,
      });

      const hasLexicalMatch = retrieved.chunks.some((c) => c.score > 0);
      if (params.sourceMode === 'materials_only' && !hasLexicalMatch && retrieved.chunks.length === 0) {
        return {
          answer:
            `Your uploaded materials for **${params.course.code}** do not appear to cover this question.\n\n` +
            `Try rephrasing with terminology from your notes, removing the topic filter, or switching to **My Materials + AI Explanation**.`,
          sourceReferences: [],
          meta: null,
          groundedFromLibrary: false,
        };
      }

      contextText = retrieved.contextText;
      sourceReferences = hasLexicalMatch ? retrieved.references : retrieved.references.slice(0, 3);
      groundedFromLibrary = retrieved.chunks.length > 0;
    }
  }

  const systemInstruction = buildSourceModeInstruction({
    course: params.course,
    topicName: activeTopic?.name,
    sourceMode: params.sourceMode,
    contextText,
  });

  const conversationTurns = params.history
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, text: m.content }));
  conversationTurns.push({ role: 'user', text: trimmedQuestion });

  const { text, meta } = await generateText({
    messages: conversationTurns,
    systemInstruction,
    model: params.model,
    signal: params.signal,
  });

  return {
    answer: text || 'I could not generate a response for that question. Please try again.',
    sourceReferences: params.sourceMode === 'general_ai' ? [] : sourceReferences,
    meta,
    groundedFromLibrary,
  };
}

export function deriveConversationTitle(firstQuestion: string): string {
  const clean = firstQuestion.replace(/\s+/g, ' ').trim();
  if (clean.length <= 68) return clean;
  const cut = clean.slice(0, 68);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 32 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}
