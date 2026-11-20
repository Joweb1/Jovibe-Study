import type {
  Course,
  DifficultyLevel,
  StudyPlanUnit,
  StudySource,
  Topic,
} from '../../types/models';
import { buildCourseStudyContext } from '../retrieval/courseRetrieval';
import { generateStructuredJson } from './geminiClient';
import {
  asNonEmptyString,
  asNumberInRange,
  asString,
  asStringArray,
  createValidator,
  isRecord,
} from './schemaValidator';

export interface LessonDeliveryPayload {
  unitTitle: string;
  objective: string;
  overview: string;
  academicDefinition: string;
  simplifiedExplanation: string;
  realWorldApplication: string;
  commonMisconception: string;
  checkQuestion: string;
  sourceCitation: string;
}

export interface AdaptiveEvaluationPayload {
  score: number;
  decision: 'advance' | 'clarify' | 'reteach_simpler';
  strengths: string[];
  gaps: string[];
  feedbackMarkdown: string;
  reteachExplanation: string;
  followUpQuestion: string;
  weaknessTag: string;
}

export interface CompactionSummaryPayload {
  compactSummary: string;
  nextAction: string;
  keyWeaknesses: string[];
}

export interface StudySegmentEntry {
  id: string;
  kind: 'lesson' | 'student_answer' | 'evaluation' | 'reteach' | 'checkpoint_note';
  unitId: string;
  unitTitle: string;
  markdown: string;
  question?: string;
  score?: number;
  decision?: string;
  timestampMs: number;
}

export const COMPACTION_ENTRY_THRESHOLD = 10;
export const COMPACTION_TOKEN_THRESHOLD = 9000;

const planValidator = createValidator<{ sessionTitle: string; units: StudyPlanUnit[] }>((raw) => {
  if (!isRecord(raw) || !Array.isArray(raw.units) || raw.units.length === 0) {
    throw new Error('Study plan must contain at least one learning unit.');
  }
  const units: StudyPlanUnit[] = raw.units.slice(0, 12).map((u, idx) => {
    if (!isRecord(u)) throw new Error(`Unit ${idx + 1} is invalid.`);
    return {
      unitId: `unit_${idx + 1}`,
      index: idx,
      title: asNonEmptyString(u.title, `units[${idx}].title`),
      concept: asNonEmptyString(u.concept, `units[${idx}].concept`),
      objective: asNonEmptyString(u.objective, `units[${idx}].objective`),
      status: idx === 0 ? 'in_progress' : 'pending',
    };
  });
  return {
    sessionTitle: asString(raw.sessionTitle, 'Structured Study Plan'),
    units,
  };
});

export async function generateAutomaticStudyPlan(params: {
  course: Course;
  topics: Topic[];
  sources: StudySource[];
  selectedTopicIds: string[];
  difficulty: DifficultyLevel;
  customInstructions: string;
  model: string;
}): Promise<{ sessionTitle: string; units: StudyPlanUnit[] }> {
  const ctx = buildCourseStudyContext(params.sources, {
    topicIds: params.selectedTopicIds.length > 0 ? params.selectedTopicIds : undefined,
    focusQuery: params.customInstructions || params.course.name,
    maxContextChars: 24_000,
    maxChunks: 16,
  });

  if (!ctx.contextText.trim()) {
    throw new Error(
      `No study materials found for the selected scope in ${params.course.code}. Upload lecture notes or PDFs in Library first.`
    );
  }

  const topicLabels = params.selectedTopicIds
    .map((id) => params.topics.find((t) => t.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  const prompt = [
    `You are designing an adaptive personal lecture plan for "${params.course.code} — ${params.course.name}".`,
    topicLabels ? `Selected topics: ${topicLabels}.` : 'Scope: Entire course materials.',
    `Difficulty level: ${params.difficulty}.`,
    params.customInstructions ? `Student instructions: ${params.customInstructions}` : '',
    'Break the provided course materials into 4 to 7 sequential, bite-sized learning units ordered from foundational principles to advanced applications.',
    'Each unit should cover ONE coherent concept with a measurable learning objective.',
    '\n=== COURSE MATERIALS ===\n' + ctx.contextText,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { data } = await generateStructuredJson({
    prompt,
    model: params.model,
    validator: planValidator,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        sessionTitle: { type: 'STRING' },
        units: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              concept: { type: 'STRING' },
              objective: { type: 'STRING' },
            },
            required: ['title', 'concept', 'objective'],
          },
        },
      },
      required: ['sessionTitle', 'units'],
    },
  });

  return data;
}

const lessonValidator = createValidator<LessonDeliveryPayload>((raw) => {
  if (!isRecord(raw)) throw new Error('Invalid lesson response.');
  return {
    unitTitle: asNonEmptyString(raw.unitTitle, 'unitTitle'),
    objective: asNonEmptyString(raw.objective, 'objective'),
    overview: asNonEmptyString(raw.overview, 'overview'),
    academicDefinition: asNonEmptyString(raw.academicDefinition, 'academicDefinition'),
    simplifiedExplanation: asNonEmptyString(raw.simplifiedExplanation, 'simplifiedExplanation'),
    realWorldApplication: asNonEmptyString(raw.realWorldApplication, 'realWorldApplication'),
    commonMisconception: asNonEmptyString(raw.commonMisconception, 'commonMisconception'),
    checkQuestion: asNonEmptyString(raw.checkQuestion, 'checkQuestion'),
    sourceCitation: asString(raw.sourceCitation, ''),
  };
});

export async function deliverStudyUnitLesson(params: {
  course: Course;
  sources: StudySource[];
  selectedTopicIds: string[];
  unit: StudyPlanUnit;
  completedUnitTitles: string[];
  checkpointSummary: string;
  difficulty: DifficultyLevel;
  customInstructions: string;
  model: string;
}): Promise<LessonDeliveryPayload> {
  const ctx = buildCourseStudyContext(params.sources, {
    topicIds: params.selectedTopicIds.length > 0 ? params.selectedTopicIds : undefined,
    focusQuery: `${params.unit.title} ${params.unit.concept} ${params.unit.objective}`,
    maxContextChars: 16_000,
    maxChunks: 8,
  });

  const prompt = [
    `You are SOTAL Study's adaptive personal lecturer for "${params.course.code} — ${params.course.name}" (${params.difficulty} level).`,
    `Teach Unit ${params.unit.index + 1}: "${params.unit.title}".`,
    `Core concept: ${params.unit.concept}`,
    `Learning objective: ${params.unit.objective}`,
    params.completedUnitTitles.length > 0
      ? `Already completed units (do NOT re-teach these): ${params.completedUnitTitles.join(', ')}`
      : '',
    params.checkpointSummary
      ? `Prior session checkpoint summary:\n${params.checkpointSummary}`
      : '',
    params.customInstructions ? `Student instructions: ${params.customInstructions}` : '',
    'Deliver a crisp, structured mini-lecture grounded in the course materials below:',
    '1. overview: 2-3 clear sentences introducing the concept and why it matters.',
    '2. academicDefinition: Accurate formal definition or principle from the materials.',
    '3. simplifiedExplanation: Plain-language breakdown using an intuitive mental model.',
    '4. realWorldApplication: Concrete worked example or real-world application.',
    '5. commonMisconception: One frequent student mistake or exam pitfall and how to avoid it.',
    '6. checkQuestion: ONE targeted comprehension question requiring the student to explain or apply this unit in their own words.',
    '\n=== RELEVANT COURSE EXCERPTS ===\n' + ctx.contextText,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { data } = await generateStructuredJson({
    prompt,
    model: params.model,
    validator: lessonValidator,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        unitTitle: { type: 'STRING' },
        objective: { type: 'STRING' },
        overview: { type: 'STRING' },
        academicDefinition: { type: 'STRING' },
        simplifiedExplanation: { type: 'STRING' },
        realWorldApplication: { type: 'STRING' },
        commonMisconception: { type: 'STRING' },
        checkQuestion: { type: 'STRING' },
        sourceCitation: { type: 'STRING' },
      },
      required: [
        'unitTitle',
        'objective',
        'overview',
        'academicDefinition',
        'simplifiedExplanation',
        'realWorldApplication',
        'commonMisconception',
        'checkQuestion',
        'sourceCitation',
      ],
    },
  });

  return data;
}

export function formatLessonMarkdown(lesson: LessonDeliveryPayload): string {
  const parts = [
    `## ${lesson.unitTitle}`,
    `**Objective:** ${lesson.objective}`,
    lesson.overview,
    `### Academic Definition\n${lesson.academicDefinition}`,
    `### Simplified Breakdown\n${lesson.simplifiedExplanation}`,
    `### Application / Example\n${lesson.realWorldApplication}`,
    `### Common Misconception\n${lesson.commonMisconception}`,
    `### Check Your Understanding\n**${lesson.checkQuestion}**`,
  ];
  if (lesson.sourceCitation) {
    parts.push(`*Grounded in: ${lesson.sourceCitation}*`);
  }
  return parts.join('\n\n');
}

const evalValidator = createValidator<AdaptiveEvaluationPayload>((raw) => {
  if (!isRecord(raw)) throw new Error('Invalid evaluation response.');
  const score = Math.round(asNumberInRange(raw.score, 0, 10, 'score') * 10) / 10;
  const rawDecision = asString(raw.decision, '');
  let decision: AdaptiveEvaluationPayload['decision'];
  if (rawDecision === 'advance' || rawDecision === 'clarify' || rawDecision === 'reteach_simpler') {
    decision = rawDecision;
  } else {
    decision = score >= 7 ? 'advance' : score >= 4.5 ? 'clarify' : 'reteach_simpler';
  }
  return {
    score,
    decision,
    strengths: asStringArray(raw.strengths, 5),
    gaps: asStringArray(raw.gaps, 5),
    feedbackMarkdown: asNonEmptyString(raw.feedbackMarkdown, 'feedbackMarkdown'),
    reteachExplanation: asString(raw.reteachExplanation, ''),
    followUpQuestion: asString(raw.followUpQuestion, ''),
    weaknessTag: asString(raw.weaknessTag, ''),
  };
});

export async function evaluateStudyUnitAnswer(params: {
  course: Course;
  unit: StudyPlanUnit;
  questionAsked: string;
  studentAnswer: string;
  attemptNumberOnUnit: number;
  recentEntriesSummary: string;
  difficulty: DifficultyLevel;
  model: string;
}): Promise<AdaptiveEvaluationPayload> {
  const prompt = [
    `You are SOTAL Study's adaptive lecturer evaluating a student's comprehension check for "${params.course.code} — ${params.course.name}" (${params.difficulty} level).`,
    `Current unit: "${params.unit.title}" — ${params.unit.objective}`,
    `Attempt #${params.attemptNumberOnUnit} on this unit.`,
    `Question asked: ${params.questionAsked}`,
    `Student answer: ${params.studentAnswer.trim()}`,
    params.recentEntriesSummary ? `Recent lesson context:\n${params.recentEntriesSummary}` : '',
    'Grading & Adaptive Routing Rules:',
    '- Score strictly out of 10 (0 to 10).',
    '- If score >= 7: set decision = "advance". Praise specific accurate points, briefly tighten any minor gap, and confirm readiness for the next unit.',
    '- If score is 4.5 to 6.9: set decision = "clarify". Highlight what the student got right, clarify the missing mechanism concisely in reteachExplanation, and ask a focused followUpQuestion.',
    '- If score < 4.5 (or student says "I don\'t know"): set decision = "reteach_simpler". Do NOT repeat the original wording—provide a genuinely simpler explanation with a fresh everyday analogy in reteachExplanation and ask an approachable scaffolded followUpQuestion.',
    '- Set weaknessTag to a concise 2–5 word topic gap if score < 7 (empty string if mastered).',
  ]
    .filter(Boolean)
    .join('\n\n');

  const { data } = await generateStructuredJson({
    prompt,
    model: params.model,
    validator: evalValidator,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        score: { type: 'NUMBER' },
        decision: { type: 'STRING' },
        strengths: { type: 'ARRAY', items: { type: 'STRING' } },
        gaps: { type: 'ARRAY', items: { type: 'STRING' } },
        feedbackMarkdown: { type: 'STRING' },
        reteachExplanation: { type: 'STRING' },
        followUpQuestion: { type: 'STRING' },
        weaknessTag: { type: 'STRING' },
      },
      required: [
        'score',
        'decision',
        'strengths',
        'gaps',
        'feedbackMarkdown',
        'reteachExplanation',
        'followUpQuestion',
        'weaknessTag',
      ],
    },
  });

  return data;
}

const compactionValidator = createValidator<CompactionSummaryPayload>((raw) => {
  if (!isRecord(raw)) throw new Error('Invalid compaction summary.');
  return {
    compactSummary: asNonEmptyString(raw.compactSummary, 'compactSummary'),
    nextAction: asNonEmptyString(raw.nextAction, 'nextAction'),
    keyWeaknesses: asStringArray(raw.keyWeaknesses, 15),
  };
});

export async function generateCompactionSummary(params: {
  course: Course;
  sessionTitle: string;
  priorSummary: string;
  entries: StudySegmentEntry[];
  completedUnits: string[];
  currentUnitTitle: string;
  currentQuestion: string;
  model: string;
}): Promise<CompactionSummaryPayload> {
  const transcriptText = params.entries
    .map((e) => `[${e.kind} | ${e.unitTitle}${e.score !== undefined ? ` | ${e.score}/10` : ''}]: ${e.markdown.slice(0, 600)}`)
    .join('\n\n');

  const prompt = [
    `Compact this Automatic Study session segment for "${params.course.code} — ${params.course.name}" ("${params.sessionTitle}") so the next linked segment can resume with zero loss of pedagogical state.`,
    params.priorSummary ? `Previous checkpoint summary:\n${params.priorSummary}` : '',
    `Completed units: ${params.completedUnits.join(', ') || 'None yet'}`,
    `Current unit: ${params.currentUnitTitle}`,
    `Active question: ${params.currentQuestion || 'None'}`,
    'Segment transcript:\n' + transcriptText,
    'Produce a dense, accurate compactSummary capturing: mastered concepts, analogies that worked, unresolved misconceptions/weaknesses, and exact stopping point.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const { data } = await generateStructuredJson({
    prompt,
    model: params.model,
    validator: compactionValidator,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        compactSummary: { type: 'STRING' },
        nextAction: { type: 'STRING' },
        keyWeaknesses: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['compactSummary', 'nextAction', 'keyWeaknesses'],
    },
  });

  return data;
}
