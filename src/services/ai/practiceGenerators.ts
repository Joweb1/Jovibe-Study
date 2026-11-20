import type { Course, DifficultyLevel, SourceReference, StudySource } from '../../types/models';
import { buildCourseStudyContext } from '../retrieval/courseRetrieval';
import { generateStructuredJson } from './geminiClient';
import {
  asBoolean,
  asNonEmptyString,
  asNumberInRange,
  asString,
  asStringArray,
  createValidator,
  isRecord,
} from './schemaValidator';

export interface FlashcardItem {
  id: string;
  front: string;
  back: string;
  hint: string;
  conceptTag: string;
  sourceCitation: string;
}

export interface CbtQuestionItem {
  id: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  conceptTag: string;
  sourceCitation: string;
}

export interface FillGapItem {
  id: string;
  sentenceWithBlank: string;
  expectedAnswer: string;
  acceptableSynonyms: string[];
  hint: string;
  explanation: string;
  conceptTag: string;
  sourceCitation: string;
}

export interface GapEvaluationResult {
  isCorrect: boolean;
  isPartiallyCorrect: boolean;
  score: number;
  feedback: string;
}

export interface OralQuestionItem {
  question: string;
  focusConcept: string;
  expectedKeyPoints: string[];
  sourceCitation: string;
}

export interface OralEvaluationResult {
  score: number;
  maxScore: number;
  verdict: 'strong' | 'developing' | 'needs_review';
  strengths: string[];
  missingPoints: string[];
  misconceptions: string[];
  modelAnswer: string;
  coachingNote: string;
  nextFocus: string;
}

function buildContextOrThrow(
  course: Course,
  sources: StudySource[],
  topicIds: string[],
  customInstructions: string
): { contextText: string; references: SourceReference[] } {
  const ctx = buildCourseStudyContext(sources, {
    topicIds: topicIds.length > 0 ? topicIds : undefined,
    focusQuery: customInstructions || course.name,
    maxContextChars: 22_000,
    maxChunks: 14,
  });

  if (!ctx.contextText.trim()) {
    throw new Error(
      `No uploaded materials were found for the selected scope in ${course.code}. Upload course notes in Library or select All Topics.`
    );
  }
  return { contextText: ctx.contextText, references: ctx.references };
}

const flashcardsValidator = createValidator<FlashcardItem[]>((raw) => {
  if (!isRecord(raw) || !Array.isArray(raw.cards) || raw.cards.length === 0) {
    throw new Error('Flashcards response must include a non-empty cards array.');
  }
  return raw.cards.map((item, idx) => {
    if (!isRecord(item)) throw new Error(`Flashcard ${idx + 1} is invalid.`);
    return {
      id: `fc_${idx + 1}`,
      front: asNonEmptyString(item.front, `cards[${idx}].front`),
      back: asNonEmptyString(item.back, `cards[${idx}].back`),
      hint: asString(item.hint, ''),
      conceptTag: asString(item.conceptTag, 'Core Concept'),
      sourceCitation: asString(item.sourceCitation, ''),
    };
  });
});

export async function generateFlashcardsDeck(params: {
  course: Course;
  sources: StudySource[];
  topicIds: string[];
  count: number;
  difficulty: DifficultyLevel;
  customInstructions: string;
  model: string;
}): Promise<{ cards: FlashcardItem[]; references: SourceReference[] }> {
  const { contextText, references } = buildContextOrThrow(
    params.course,
    params.sources,
    params.topicIds,
    params.customInstructions
  );

  const count = Math.min(25, Math.max(3, params.count));
  const prompt = [
    `Generate ${count} high-yield academic active-recall flashcards for "${params.course.code} — ${params.course.name}".`,
    `Difficulty level: ${params.difficulty}.`,
    params.customInstructions
      ? `Student instructions: ${params.customInstructions}`
      : '',
    'Every flashcard MUST be grounded in the course materials below. Focus on definitions, mechanisms, comparisons, formulas, and exam-tested distinctions.',
    'Keep each front prompt concise and specific (one clear concept per card), and each back answer accurate and crisp.',
    '\n=== COURSE MATERIALS ===\n' + contextText,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { data } = await generateStructuredJson({
    prompt,
    model: params.model,
    validator: flashcardsValidator,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        cards: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              front: { type: 'STRING' },
              back: { type: 'STRING' },
              hint: { type: 'STRING' },
              conceptTag: { type: 'STRING' },
              sourceCitation: { type: 'STRING' },
            },
            required: ['front', 'back', 'hint', 'conceptTag', 'sourceCitation'],
          },
        },
      },
      required: ['cards'],
    },
  });

  return { cards: data, references };
}

const cbtValidator = createValidator<CbtQuestionItem[]>((raw) => {
  if (!isRecord(raw) || !Array.isArray(raw.questions) || raw.questions.length === 0) {
    throw new Error('CBT response must include a non-empty questions array.');
  }
  return raw.questions.map((item, idx) => {
    if (!isRecord(item)) throw new Error(`Question ${idx + 1} is invalid.`);
    const opts = asStringArray(item.options, 4);
    if (opts.length !== 4) {
      throw new Error(`Question ${idx + 1} must have exactly 4 distinct options.`);
    }
    const correctIndex = asNumberInRange(item.correctIndex, 0, 3, `questions[${idx}].correctIndex`);
    return {
      id: `cbt_${idx + 1}`,
      question: asNonEmptyString(item.question, `questions[${idx}].question`),
      options: [opts[0], opts[1], opts[2], opts[3]],
      correctIndex: Math.floor(correctIndex),
      explanation: asNonEmptyString(item.explanation, `questions[${idx}].explanation`),
      conceptTag: asString(item.conceptTag, 'Concept'),
      sourceCitation: asString(item.sourceCitation, ''),
    };
  });
});

export async function generateCbtQuestions(params: {
  course: Course;
  sources: StudySource[];
  topicIds: string[];
  count: number;
  difficulty: DifficultyLevel;
  customInstructions: string;
  model: string;
}): Promise<{ questions: CbtQuestionItem[]; references: SourceReference[] }> {
  const { contextText, references } = buildContextOrThrow(
    params.course,
    params.sources,
    params.topicIds,
    params.customInstructions
  );

  const count = Math.min(25, Math.max(3, params.count));
  const prompt = [
    `Create ${count} rigorous multiple-choice CBT exam questions for "${params.course.code} — ${params.course.name}".`,
    `Difficulty: ${params.difficulty}.`,
    params.customInstructions ? `Student instructions: ${params.customInstructions}` : '',
    'Rules:',
    '- Every question must have EXACTLY 4 plausible options (no "All of the above" laziness unless academically essential) and exactly 1 unambiguously correct answer (correctIndex 0-3).',
    '- Ground all questions and explanations strictly in the provided course materials.',
    '- Do NOT leak the answer inside the question text.',
    '- Explain clearly why the correct option is right and briefly clarify the key distinction.',
    '\n=== COURSE MATERIALS ===\n' + contextText,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { data } = await generateStructuredJson({
    prompt,
    model: params.model,
    validator: cbtValidator,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        questions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              question: { type: 'STRING' },
              options: { type: 'ARRAY', items: { type: 'STRING' } },
              correctIndex: { type: 'INTEGER' },
              explanation: { type: 'STRING' },
              conceptTag: { type: 'STRING' },
              sourceCitation: { type: 'STRING' },
            },
            required: ['question', 'options', 'correctIndex', 'explanation', 'conceptTag', 'sourceCitation'],
          },
        },
      },
      required: ['questions'],
    },
  });

  return { questions: data, references };
}

const fillGapValidator = createValidator<FillGapItem[]>((raw) => {
  if (!isRecord(raw) || !Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error('Fill-in-the-gap response must include a non-empty items array.');
  }
  return raw.items.map((item, idx) => {
    if (!isRecord(item)) throw new Error(`Item ${idx + 1} is invalid.`);
    let sentence = asNonEmptyString(item.sentenceWithBlank, `items[${idx}].sentenceWithBlank`);
    if (!sentence.includes('_____')) {
      sentence = `${sentence} (_____)`;
    }
    return {
      id: `gap_${idx + 1}`,
      sentenceWithBlank: sentence,
      expectedAnswer: asNonEmptyString(item.expectedAnswer, `items[${idx}].expectedAnswer`),
      acceptableSynonyms: asStringArray(item.acceptableSynonyms, 10),
      hint: asString(item.hint, ''),
      explanation: asNonEmptyString(item.explanation, `items[${idx}].explanation`),
      conceptTag: asString(item.conceptTag, 'Concept'),
      sourceCitation: asString(item.sourceCitation, ''),
    };
  });
});

export async function generateFillGapExercises(params: {
  course: Course;
  sources: StudySource[];
  topicIds: string[];
  count: number;
  difficulty: DifficultyLevel;
  customInstructions: string;
  model: string;
}): Promise<{ items: FillGapItem[]; references: SourceReference[] }> {
  const { contextText, references } = buildContextOrThrow(
    params.course,
    params.sources,
    params.topicIds,
    params.customInstructions
  );

  const count = Math.min(20, Math.max(3, params.count));
  const prompt = [
    `Create ${count} concept-focused Fill-in-the-Gap exercises for "${params.course.code} — ${params.course.name}".`,
    `Difficulty: ${params.difficulty}.`,
    params.customInstructions ? `Student instructions: ${params.customInstructions}` : '',
    'Rules:',
    '- Each sentenceWithBlank MUST contain exactly one blank represented as "_____" testing a crucial academic term, mechanism, formula name, or concept (never trivial stopwords).',
    '- expectedAnswer should be concise (1–4 words).',
    '- acceptableSynonyms should list valid alternate phrasings, abbreviations, or equivalent academic terms.',
    '- Ground every item in the course materials below.',
    '\n=== COURSE MATERIALS ===\n' + contextText,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { data } = await generateStructuredJson({
    prompt,
    model: params.model,
    validator: fillGapValidator,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              sentenceWithBlank: { type: 'STRING' },
              expectedAnswer: { type: 'STRING' },
              acceptableSynonyms: { type: 'ARRAY', items: { type: 'STRING' } },
              hint: { type: 'STRING' },
              explanation: { type: 'STRING' },
              conceptTag: { type: 'STRING' },
              sourceCitation: { type: 'STRING' },
            },
            required: [
              'sentenceWithBlank',
              'expectedAnswer',
              'acceptableSynonyms',
              'hint',
              'explanation',
              'conceptTag',
              'sourceCitation',
            ],
          },
        },
      },
      required: ['items'],
    },
  });

  return { items: data, references };
}

function normalizeAnswerToken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const gapEvalValidator = createValidator<GapEvaluationResult>((raw) => {
  if (!isRecord(raw)) throw new Error('Invalid gap evaluation.');
  return {
    isCorrect: asBoolean(raw.isCorrect, false),
    isPartiallyCorrect: asBoolean(raw.isPartiallyCorrect, false),
    score: asNumberInRange(raw.score, 0, 1, 'score'),
    feedback: asNonEmptyString(raw.feedback, 'feedback'),
  };
});

export async function evaluateFillGapAnswer(params: {
  item: FillGapItem;
  studentAnswer: string;
  model: string;
}): Promise<GapEvaluationResult> {
  const normStudent = normalizeAnswerToken(params.studentAnswer);
  if (!normStudent) {
    return {
      isCorrect: false,
      isPartiallyCorrect: false,
      score: 0,
      feedback: `No answer provided. Expected: "${params.item.expectedAnswer}".`,
    };
  }

  const exactCandidates = [
    params.item.expectedAnswer,
    ...params.item.acceptableSynonyms,
  ].map(normalizeAnswerToken);

  if (exactCandidates.includes(normStudent)) {
    return {
      isCorrect: true,
      isPartiallyCorrect: false,
      score: 1,
      feedback: `Correct. ${params.item.explanation}`,
    };
  }

  // Semantic & synonym evaluation via Gemini for paraphrased or minor-spelling responses
  const prompt = [
    'Evaluate whether the student fill-in-the-blank answer is semantically equivalent to the expected academic answer.',
    `Sentence: ${params.item.sentenceWithBlank}`,
    `Expected answer: ${params.item.expectedAnswer}`,
    `Known acceptable synonyms: ${params.item.acceptableSynonyms.join(', ') || 'None listed'}`,
    `Student answer: ${params.studentAnswer.trim()}`,
    'Be fair about minor spelling slips or accurate synonyms, but strict about conceptually wrong terms.',
    'Return score = 1 if fully correct, 0.5 if partially correct, 0 if incorrect.',
  ].join('\n');

  const { data } = await generateStructuredJson({
    prompt,
    model: params.model,
    validator: gapEvalValidator,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        isCorrect: { type: 'BOOLEAN' },
        isPartiallyCorrect: { type: 'BOOLEAN' },
        score: { type: 'NUMBER' },
        feedback: { type: 'STRING' },
      },
      required: ['isCorrect', 'isPartiallyCorrect', 'score', 'feedback'],
    },
  });

  return data;
}

const oralQuestionValidator = createValidator<OralQuestionItem>((raw) => {
  if (!isRecord(raw)) throw new Error('Invalid oral question object.');
  return {
    question: asNonEmptyString(raw.question, 'question'),
    focusConcept: asNonEmptyString(raw.focusConcept, 'focusConcept'),
    expectedKeyPoints: asStringArray(raw.expectedKeyPoints, 8),
    sourceCitation: asString(raw.sourceCitation, ''),
  };
});

export async function generateOralExamQuestion(params: {
  course: Course;
  sources: StudySource[];
  topicIds: string[];
  difficulty: DifficultyLevel;
  customInstructions: string;
  questionNumber: number;
  totalQuestions: number;
  priorQuestions: Array<{ question: string; focusConcept: string; score: number }>;
  model: string;
}): Promise<{ item: OralQuestionItem; references: SourceReference[] }> {
  const { contextText, references } = buildContextOrThrow(
    params.course,
    params.sources,
    params.topicIds,
    params.customInstructions
  );

  const priorSummary =
    params.priorQuestions.length > 0
      ? params.priorQuestions
          .map(
            (q, i) =>
              `Q${i + 1} [${q.focusConcept}] (Score ${q.score}/10): ${q.question}`
          )
          .join('\n')
      : 'None yet (opening question).';

  const prompt = [
    `You are a rigorous yet supportive university oral examiner for "${params.course.code} — ${params.course.name}".`,
    `Generate Question ${params.questionNumber} of ${params.totalQuestions}. Difficulty: ${params.difficulty}.`,
    params.customInstructions ? `Focus instructions: ${params.customInstructions}` : '',
    'Prior questions asked in this exam:\n' + priorSummary,
    'Rules:',
    '- Ask ONE clear, thought-provoking oral exam question grounded strictly in the course materials below.',
    '- Do NOT repeat concepts already strongly mastered (score >= 8). Progress logically or probe deeper into related principles.',
    '- Provide 3–5 expectedKeyPoints that an excellent answer should cover.',
    '\n=== COURSE MATERIALS ===\n' + contextText,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { data } = await generateStructuredJson({
    prompt,
    model: params.model,
    validator: oralQuestionValidator,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        question: { type: 'STRING' },
        focusConcept: { type: 'STRING' },
        expectedKeyPoints: { type: 'ARRAY', items: { type: 'STRING' } },
        sourceCitation: { type: 'STRING' },
      },
      required: ['question', 'focusConcept', 'expectedKeyPoints', 'sourceCitation'],
    },
  });

  return { item: data, references };
}

const oralEvalValidator = createValidator<OralEvaluationResult>((raw) => {
  if (!isRecord(raw)) throw new Error('Invalid oral evaluation.');
  const score = Math.round(asNumberInRange(raw.score, 0, 10, 'score') * 10) / 10;
  const verdict: OralEvaluationResult['verdict'] =
    score >= 7.5 ? 'strong' : score >= 4.5 ? 'developing' : 'needs_review';
  return {
    score,
    maxScore: 10,
    verdict,
    strengths: asStringArray(raw.strengths, 6),
    missingPoints: asStringArray(raw.missingPoints, 6),
    misconceptions: asStringArray(raw.misconceptions, 6),
    modelAnswer: asNonEmptyString(raw.modelAnswer, 'modelAnswer'),
    coachingNote: asNonEmptyString(raw.coachingNote, 'coachingNote'),
    nextFocus: asString(raw.nextFocus, ''),
  };
});

export async function evaluateOralExamAnswer(params: {
  course: Course;
  question: OralQuestionItem;
  studentAnswer: string;
  difficulty: DifficultyLevel;
  model: string;
}): Promise<OralEvaluationResult> {
  const prompt = [
    `Grade this oral examination response for "${params.course.code} — ${params.course.name}" (${params.difficulty} level) on a strict 10-point academic rubric.`,
    `Question: ${params.question.question}`,
    `Focus concept: ${params.question.focusConcept}`,
    `Expected key points: ${params.question.expectedKeyPoints.join('; ')}`,
    `Student response: ${params.studentAnswer.trim()}`,
    'Rubric guidelines:',
    '- 9–10: Accurate, complete, well-structured, addresses core principles with precision.',
    '- 7–8: Solid understanding with minor omissions.',
    '- 4–6: Partial grasp; misses critical mechanisms or contains imprecise reasoning.',
    '- 0–3: Major misconceptions, off-topic, or insufficient explanation.',
    'Be honest, specific, and constructive. Provide a concise modelAnswer.',
  ].join('\n');

  const { data } = await generateStructuredJson({
    prompt,
    model: params.model,
    validator: oralEvalValidator,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        score: { type: 'NUMBER' },
        strengths: { type: 'ARRAY', items: { type: 'STRING' } },
        missingPoints: { type: 'ARRAY', items: { type: 'STRING' } },
        misconceptions: { type: 'ARRAY', items: { type: 'STRING' } },
        modelAnswer: { type: 'STRING' },
        coachingNote: { type: 'STRING' },
        nextFocus: { type: 'STRING' },
      },
      required: [
        'score',
        'strengths',
        'missingPoints',
        'misconceptions',
        'modelAnswer',
        'coachingNote',
        'nextFocus',
      ],
    },
  });

  return data;
}
