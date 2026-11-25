import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  AutomaticStudySession,
  CheckpointReason,
  DifficultyLevel,
  StudyEvaluationScore,
  StudyPlanUnit,
  StudySessionCheckpoint,
  StudySessionSegment,
  StudySessionStatus,
} from '../../types/models';
import {
  generateDocumentId,
  sanitizeBoundedString,
  stripUndefinedDeep,
  timestampToMillis,
} from '../../utils/validation';
import { db } from './config';
import { handleFirestoreError, OperationType } from './errors';

function sessionsCol(userId: string, courseId: string) {
  return collection(db, 'users', userId, 'courses', courseId, 'studySessions');
}

function segmentsCol(userId: string, courseId: string, sessionId: string) {
  return collection(
    db,
    'users',
    userId,
    'courses',
    courseId,
    'studySessions',
    sessionId,
    'segments'
  );
}

function checkpointsCol(userId: string, courseId: string, sessionId: string) {
  return collection(
    db,
    'users',
    userId,
    'courses',
    courseId,
    'studySessions',
    sessionId,
    'checkpoints'
  );
}

export function subscribeCourseStudySessions(
  userId: string,
  courseId: string,
  onData: (sessions: AutomaticStudySession[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/courses/${courseId}/studySessions`;
  const q = query(sessionsCol(userId, courseId), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: AutomaticStudySession[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AutomaticStudySession, 'id'>),
      }));
      list.sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeSessionSegments(
  userId: string,
  courseId: string,
  sessionId: string,
  onData: (segments: StudySessionSegment[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/courses/${courseId}/studySessions/${sessionId}/segments`;
  const q = query(segmentsCol(userId, courseId, sessionId), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: StudySessionSegment[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<StudySessionSegment, 'id'>),
      }));
      list.sort((a, b) => a.segmentIndex - b.segmentIndex);
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeSessionCheckpoints(
  userId: string,
  courseId: string,
  sessionId: string,
  onData: (checkpoints: StudySessionCheckpoint[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/courses/${courseId}/studySessions/${sessionId}/checkpoints`;
  const q = query(checkpointsCol(userId, courseId, sessionId), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: StudySessionCheckpoint[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<StudySessionCheckpoint, 'id'>),
      }));
      list.sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function createAutomaticStudySession(
  userId: string,
  courseId: string,
  input: {
    title: string;
    selectedTopicIds: string[];
    customInstructions: string;
    difficulty: DifficultyLevel;
    studyPlan: StudyPlanUnit[];
    initialEntries: Array<Record<string, unknown>>;
    currentObjective: string;
    currentQuestion: string;
  }
): Promise<{ session: AutomaticStudySession; segment: StudySessionSegment }> {
  const sessionId = generateDocumentId('study');
  const segmentId = generateDocumentId('seg');

  const sessionPath = `users/${userId}/courses/${courseId}/studySessions/${sessionId}`;
  const segmentPath = `${sessionPath}/segments/${segmentId}`;

  const cleanTitle = sanitizeBoundedString(input.title, 200) || 'Automatic Study Session';
  const safePlan = stripUndefinedDeep(input.studyPlan.slice(0, 100));
  const safeInitialEntries = stripUndefinedDeep(input.initialEntries.slice(0, 120));
  const tokenEstimate = Math.ceil(JSON.stringify(safeInitialEntries).length / 4);

  const sessionPayload = {
    userId,
    courseId,
    title: cleanTitle,
    selectedTopicIds: input.selectedTopicIds.slice(0, 50),
    customInstructions: sanitizeBoundedString(input.customInstructions, 2000),
    difficulty: input.difficulty,
    status: 'active' as StudySessionStatus,
    studyPlan: safePlan,
    currentUnitIndex: 0,
    completedUnitIds: [] as string[],
    currentObjective: sanitizeBoundedString(input.currentObjective, 600),
    currentQuestion: sanitizeBoundedString(input.currentQuestion, 2000),
    latestStudentAnswer: '',
    evaluationFeedback: {},
    scores: [] as StudyEvaluationScore[],
    topicMastery: {} as Record<string, number>,
    topicsRequiringReview: [] as string[],
    lastCheckpointId: '',
    nextAction: 'awaiting_student_answer',
    activeSegmentId: segmentId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', userId, 'courses', courseId, 'studySessions', sessionId), sessionPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, sessionPath);
  }

  const segmentPayload = {
    userId,
    courseId,
    sessionId,
    segmentIndex: 0,
    summaryFromCheckpoint: '',
    entries: safeInitialEntries,
    tokenEstimate,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(
      doc(db, 'users', userId, 'courses', courseId, 'studySessions', sessionId, 'segments', segmentId),
      segmentPayload
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, segmentPath);
  }

  return {
    session: {
      id: sessionId,
      ...sessionPayload,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    segment: {
      id: segmentId,
      ...segmentPayload,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}

export async function updateSegmentEntries(
  userId: string,
  courseId: string,
  sessionId: string,
  segmentId: string,
  entries: Array<Record<string, unknown>>
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/studySessions/${sessionId}/segments/${segmentId}`;
  const ref = doc(
    db,
    'users',
    userId,
    'courses',
    courseId,
    'studySessions',
    sessionId,
    'segments',
    segmentId
  );
  const boundedEntries = stripUndefinedDeep(entries.slice(-120));
  const tokenEstimate = Math.min(500000, Math.ceil(JSON.stringify(boundedEntries).length / 4));

  try {
    await updateDoc(ref, {
      entries: boundedEntries,
      tokenEstimate,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createLinkedSegment(
  userId: string,
  courseId: string,
  sessionId: string,
  input: {
    segmentIndex: number;
    summaryFromCheckpoint: string;
    initialEntries?: Array<Record<string, unknown>>;
  }
): Promise<StudySessionSegment> {
  const segmentId = generateDocumentId('seg');
  const path = `users/${userId}/courses/${courseId}/studySessions/${sessionId}/segments/${segmentId}`;
  const ref = doc(
    db,
    'users',
    userId,
    'courses',
    courseId,
    'studySessions',
    sessionId,
    'segments',
    segmentId
  );
  const summary = sanitizeBoundedString(input.summaryFromCheckpoint, 15000);
  const entries = stripUndefinedDeep((input.initialEntries || []).slice(0, 120));
  const tokenEstimate = Math.min(
    500000,
    Math.ceil((summary.length + JSON.stringify(entries).length) / 4)
  );

  try {
    await setDoc(ref, {
      userId,
      courseId,
      sessionId,
      segmentIndex: Math.min(500, Math.max(0, input.segmentIndex)),
      summaryFromCheckpoint: summary,
      entries,
      tokenEstimate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id: segmentId,
    userId,
    courseId,
    sessionId,
    segmentIndex: input.segmentIndex,
    summaryFromCheckpoint: summary,
    entries,
    tokenEstimate,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function createSessionCheckpoint(
  userId: string,
  courseId: string,
  sessionId: string,
  input: {
    reason: CheckpointReason;
    summary: string;
    currentUnitIndex: number;
    completedUnitIds: string[];
    nextAction: string;
    masterySnapshot: Record<string, number>;
    weaknesses: string[];
  }
): Promise<StudySessionCheckpoint> {
  const checkpointId = generateDocumentId('ckpt');
  const path = `users/${userId}/courses/${courseId}/studySessions/${sessionId}/checkpoints/${checkpointId}`;
  const ref = doc(
    db,
    'users',
    userId,
    'courses',
    courseId,
    'studySessions',
    sessionId,
    'checkpoints',
    checkpointId
  );

  const payload = {
    userId,
    courseId,
    sessionId,
    reason: input.reason,
    summary: sanitizeBoundedString(input.summary, 15000),
    currentUnitIndex: Math.min(100, Math.max(0, input.currentUnitIndex)),
    completedUnitIds: input.completedUnitIds.slice(0, 100),
    nextAction: sanitizeBoundedString(input.nextAction, 300),
    masterySnapshot: stripUndefinedDeep(input.masterySnapshot || {}),
    weaknesses: input.weaknesses.map((w) => sanitizeBoundedString(w, 200)).filter(Boolean).slice(0, 50),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id: checkpointId,
    ...payload,
    createdAt: Date.now(),
  };
}

export async function advanceStudySessionState(
  userId: string,
  courseId: string,
  sessionId: string,
  state: {
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
  }
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/studySessions/${sessionId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'studySessions', sessionId);

  try {
    await updateDoc(ref, {
      status: state.status,
      studyPlan: stripUndefinedDeep(state.studyPlan.slice(0, 100)),
      currentUnitIndex: Math.min(100, Math.max(0, state.currentUnitIndex)),
      completedUnitIds: state.completedUnitIds.slice(0, 100),
      currentObjective: sanitizeBoundedString(state.currentObjective || '', 600),
      currentQuestion: sanitizeBoundedString(state.currentQuestion || '', 2000),
      latestStudentAnswer: sanitizeBoundedString(state.latestStudentAnswer || '', 10000),
      evaluationFeedback: stripUndefinedDeep(state.evaluationFeedback || {}),
      scores: stripUndefinedDeep(state.scores.slice(-200)),
      topicMastery: stripUndefinedDeep(state.topicMastery || {}),
      topicsRequiringReview: state.topicsRequiringReview.slice(0, 50),
      lastCheckpointId: state.lastCheckpointId || '',
      nextAction: sanitizeBoundedString(state.nextAction || '', 300),
      activeSegmentId: state.activeSegmentId || '',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function setStudySessionPausedState(
  userId: string,
  courseId: string,
  sessionId: string,
  status: 'active' | 'paused',
  lastCheckpointId: string,
  nextAction: string
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/studySessions/${sessionId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'studySessions', sessionId);
  try {
    await updateDoc(ref, {
      status,
      lastCheckpointId: lastCheckpointId || '',
      nextAction: sanitizeBoundedString(nextAction, 300),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAutomaticStudySession(
  userId: string,
  courseId: string,
  sessionId: string
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/studySessions/${sessionId}`;
  try {
    const [segSnap, ckptSnap] = await Promise.all([
      getDocs(query(segmentsCol(userId, courseId, sessionId), where('userId', '==', userId))),
      getDocs(query(checkpointsCol(userId, courseId, sessionId), where('userId', '==', userId))),
    ]);

    const refs = [
      ...segSnap.docs.map((d) => d.ref),
      ...ckptSnap.docs.map((d) => d.ref),
      doc(db, 'users', userId, 'courses', courseId, 'studySessions', sessionId),
    ];

    for (let i = 0; i < refs.length; i += 400) {
      const batch = writeBatch(db);
      refs.slice(i, i + 400).forEach((r) => batch.delete(r));
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
