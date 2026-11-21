import type { Timestamp } from 'firebase/firestore';

export type AppRoute =
  | '/library'
  | '/tutor'
  | '/practice'
  | '/automatic-study'
  | '/live'
  | '/history'
  | '/courses'
  | '/settings'
  | '/manage-course'
  | '/join'
  | '/streak'
  | '/dashboard';

export type TutorSourceMode = 'materials_only' | 'materials_plus_ai' | 'general_ai';

export type DifficultyLevel = 'foundational' | 'standard' | 'advanced';

export type GeminiTtsVoice = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export type MaterialType =
  | 'pdf'
  | 'slides'
  | 'textbook_photo'
  | 'handwritten_notes'
  | 'scanned_doc'
  | 'typed_notes'
  | 'pasted_text'
  | 'other';

export type ProcessingStatus = 'ready' | 'needs_review' | 'failed';

export type SavedMaterialType =
  | 'flashcards'
  | 'cbt'
  | 'fill_in_the_gap'
  | 'exam_prep'
  | 'tutor_response'
  | 'summary'
  | 'study_guide'
  | 'explanation'
  | 'custom_note';

export type StudySessionStatus = 'planning' | 'active' | 'paused' | 'completed';

export type CheckpointReason =
  | 'lesson_completed'
  | 'question_answered'
  | 'evaluation_completed'
  | 'topic_completed'
  | 'paused'
  | 'compaction';

export type StudyHistorySessionType =
  | 'tutor'
  | 'flashcards'
  | 'cbt'
  | 'fill_in_the_gap'
  | 'exam_prep'
  | 'automatic_study';

export type StudyHistoryStatus = 'in_progress' | 'paused' | 'completed';

export type FirestoreTimestamp = Timestamp | Date | number;

export interface UserPreferences {
  defaultModel: string;
  tutorSourceMode: TutorSourceMode;
  voiceEnabled: boolean;
  voiceRate: number;
  ttsVoice: GeminiTtsVoice;
  defaultDifficulty: DifficultyLevel;
}

export interface UserProfile {
  userId: string;
  displayName: string;
  email: string;
  photoURL: string;
  activeCourseId: string;
  preferences: UserPreferences;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface Course {
  id: string;
  userId: string;
  code: string;
  name: string;
  description: string;
  isPublic?: boolean;
  shareToken?: string;
  authorName?: string;
  /** Derived client-side metadata distinguishing owned vs joined shared courses */
  isShared?: boolean;
  isOwner?: boolean;
  authorId?: string;
  joinedAt?: FirestoreTimestamp | null;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface CourseShare {
  shareToken: string;
  authorId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  courseDescription: string;
  authorName: string;
  active: boolean;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface CourseMember {
  memberUid: string;
  authorId: string;
  courseId: string;
  displayName: string;
  photoURL: string;
  groupId: string;
  role: 'member';
  shareToken: string;
  joinedAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface CourseGroup {
  id: string;
  authorId: string;
  courseId: string;
  name: string;
  description: string;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface JoinedCourse {
  id: string;
  userId: string;
  authorId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  courseDescription: string;
  authorName: string;
  joinedAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface PersonalSourceNote {
  id: string;
  userId: string;
  courseId: string;
  sourceId: string;
  notes: string;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface Topic {
  id: string;
  userId: string;
  courseId: string;
  name: string;
  description: string;
  order: number;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface StudySection {
  id: string;
  heading: string;
  level: number;
  content: string;
  pageOrSlide?: number;
}

export interface StudySource {
  id: string;
  userId: string;
  courseId: string;
  topicId: string;
  title: string;
  materialType: MaterialType;
  extractedContent: string;
  sections: StudySection[];
  pageOrSlideCount: number;
  processingStatus: ProcessingStatus;
  studentNotes: string;
  originalFileName: string;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface SourceReference {
  sourceId: string;
  sourceTitle: string;
  sectionHeading?: string;
  pageOrSlide?: number;
}

export interface TutorConversation {
  id: string;
  userId: string;
  courseId: string;
  title: string;
  sourceMode: TutorSourceMode;
  lastMessagePreview: string;
  messageCount: number;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface TutorMessage {
  id: string;
  userId: string;
  courseId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sourceReferences: SourceReference[];
  saved: boolean;
  createdAt: FirestoreTimestamp | null;
}

export interface SavedStudyMaterial {
  id: string;
  userId: string;
  courseId: string;
  topicId: string;
  title: string;
  type: SavedMaterialType;
  content: Record<string, unknown>;
  sourceReferences: SourceReference[];
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface StudyPlanUnit {
  unitId: string;
  index: number;
  title: string;
  topicId?: string;
  concept: string;
  objective: string;
  status: 'pending' | 'in_progress' | 'completed' | 'needs_review';
}

export interface StudyEvaluationScore {
  unitId: string;
  score: number;
  maxScore: number;
  timestampMs: number;
  topicId?: string;
}

export interface AutomaticStudySession {
  id: string;
  userId: string;
  courseId: string;
  title: string;
  selectedTopicIds: string[];
  customInstructions: string;
  difficulty: DifficultyLevel;
  status: StudySessionStatus;
  studyPlan: StudyPlanUnit[];
  currentUnitIndex: number;
  completedUnitIds: string[];
  currentObjective: string;
  currentQuestion: string;
  latestStudentAnswer: string;
  evaluationFeedback: Record<string, unknown>;
  scores: StudyEvaluationScore[];
  topicMastery: Record<string, number>;
  topicsRequiringReview: string[];
  lastCheckpointId: string;
  nextAction: string;
  activeSegmentId: string;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface StudySessionSegment {
  id: string;
  userId: string;
  courseId: string;
  sessionId: string;
  segmentIndex: number;
  summaryFromCheckpoint: string;
  entries: Array<Record<string, unknown>>;
  tokenEstimate: number;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface StudySessionCheckpoint {
  id: string;
  userId: string;
  courseId: string;
  sessionId: string;
  reason: CheckpointReason;
  summary: string;
  currentUnitIndex: number;
  completedUnitIds: string[];
  nextAction: string;
  masterySnapshot: Record<string, number>;
  weaknesses: string[];
  createdAt: FirestoreTimestamp | null;
}

export interface StudyHistoryRecord {
  id: string;
  userId: string;
  courseId: string;
  sessionType: StudyHistorySessionType;
  title: string;
  topicIds: string[];
  status: StudyHistoryStatus;
  score: number;
  maxScore: number;
  percentage: number;
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
  durationSeconds: number;
  summary: string;
  weaknesses: string[];
  details: Record<string, unknown>;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  defaultModel: 'gemini-4-hydrogen',
  tutorSourceMode: 'materials_plus_ai',
  voiceEnabled: true,
  voiceRate: 1.0,
  ttsVoice: 'Kore',
  defaultDifficulty: 'standard',
};

export type DailyStreakStatus = 'pending_claim' | 'claimed' | 'frozen' | 'missed';

export type StudyActivityType =
  | 'cbt'
  | 'flashcards'
  | 'fill_in_the_gap'
  | 'exam_prep'
  | 'automatic_study'
  | 'tutor'
  | 'live'
  | 'shared_library';

export interface StreakProfile {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  totalStudyDays: number;
  /** Internal hidden streak freeze inventory (never displayed in UI). */
  freezeBalance: number;
  lastQualifyingDate: string;
  lastEvaluatedDate: string;
  pendingClaimDate: string;
  pendingStreakCount: number;
  accountCreatedDate: string;
  timezoneOffsetMinutes: number;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface DailyStreakRecord {
  dateKey: string;
  userId: string;
  status: DailyStreakStatus;
  streakCount: number;
  qualifyingActivitiesCount: number;
  firstActivityType: StudyActivityType | '';
  firstActivityTitle: string;
  freezeAwarded: boolean;
  freezeConsumed: boolean;
  claimedAt: FirestoreTimestamp | null;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface FreezeLedgerEntry {
  id: string;
  userId: string;
  dateKey: string;
  action: 'initial_grant' | 'earned' | 'consumed';
  delta: number;
  balanceAfter: number;
  createdAt: FirestoreTimestamp | null;
}

export interface StudyActivityEvent {
  id: string;
  userId: string;
  courseId: string;
  courseCode: string;
  isSharedCourse: boolean;
  activityType: StudyActivityType;
  title: string;
  dateKey: string;
  durationSeconds: number;
  score: number | null;
  maxScore: number | null;
  summary: string;
  createdAt: FirestoreTimestamp | null;
}

export interface AppUsageSummary {
  userId: string;
  totalAppSeconds: number;
  totalActiveLearningSeconds: number;
  lastActiveDate: string;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface AppUsageDailyRecord {
  dateKey: string;
  userId: string;
  appSeconds: number;
  activeLearningSeconds: number;
  sessionsCount: number;
  createdAt: FirestoreTimestamp | null;
  updatedAt: FirestoreTimestamp | null;
}

export interface PracticeTimerConfig {
  enabled: boolean;
  durationMinutes: number;
}

export interface ActivePracticeTimerSnapshot {
  sessionId: string;
  durationMinutes: number;
  startedAtMs: number;
  expiresAtMs: number;
}

