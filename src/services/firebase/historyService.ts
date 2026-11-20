import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  StudyHistoryRecord,
  StudyHistorySessionType,
  StudyHistoryStatus,
} from '../../types/models';
import {
  generateDocumentId,
  sanitizeBoundedString,
  timestampToMillis,
} from '../../utils/validation';
import { db } from './config';
import { handleFirestoreError, OperationType } from './errors';

function historyCollection(userId: string, courseId: string) {
  return collection(db, 'users', userId, 'courses', courseId, 'studyHistory');
}

export function subscribeCourseHistory(
  userId: string,
  courseId: string,
  onData: (records: StudyHistoryRecord[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/courses/${courseId}/studyHistory`;
  const q = query(historyCollection(userId, courseId), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const records: StudyHistoryRecord[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<StudyHistoryRecord, 'id'>),
      }));
      records.sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));
      onData(records);
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

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

export async function createStudyHistoryRecord(
  userId: string,
  courseId: string,
  input: {
    sessionType: StudyHistorySessionType;
    title: string;
    topicIds?: string[];
    status: StudyHistoryStatus;
    score: number;
    maxScore: number;
    correctCount: number;
    incorrectCount: number;
    skippedCount?: number;
    durationSeconds: number;
    summary: string;
    weaknesses?: string[];
    details?: Record<string, unknown>;
  }
): Promise<StudyHistoryRecord> {
  const id = generateDocumentId('hist');
  const path = `users/${userId}/courses/${courseId}/studyHistory/${id}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'studyHistory', id);

  const safeScore = clampNumber(input.score, 0, 10000);
  const safeMax = clampNumber(input.maxScore, 0, 10000);
  const percentage = safeMax > 0 ? clampNumber((safeScore / safeMax) * 100, 0, 100) : 0;

  const cleanTitle = sanitizeBoundedString(input.title, 200) || 'Study Session';
  const cleanTopicIds = (input.topicIds || [])
    .filter((t) => typeof t === 'string' && t.trim().length > 0)
    .slice(0, 50);
  const cleanWeaknesses = (input.weaknesses || [])
    .map((w) => sanitizeBoundedString(w, 200))
    .filter(Boolean)
    .slice(0, 50);

  const payload = {
    userId,
    courseId,
    sessionType: input.sessionType,
    title: cleanTitle,
    topicIds: cleanTopicIds,
    status: input.status,
    score: safeScore,
    maxScore: safeMax,
    percentage,
    correctCount: Math.round(clampNumber(input.correctCount, 0, 10000)),
    incorrectCount: Math.round(clampNumber(input.incorrectCount, 0, 10000)),
    skippedCount: Math.round(clampNumber(input.skippedCount ?? 0, 0, 10000)),
    durationSeconds: Math.round(clampNumber(input.durationSeconds, 0, 864000)),
    summary: sanitizeBoundedString(input.summary, 4000),
    weaknesses: cleanWeaknesses,
    details: input.details ?? {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id,
    ...payload,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function updateStudyHistoryRecord(
  userId: string,
  courseId: string,
  historyId: string,
  updates: {
    status: StudyHistoryStatus;
    score: number;
    maxScore: number;
    correctCount: number;
    incorrectCount: number;
    skippedCount: number;
    durationSeconds: number;
    summary: string;
    weaknesses: string[];
    details: Record<string, unknown>;
  }
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/studyHistory/${historyId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'studyHistory', historyId);

  const safeScore = clampNumber(updates.score, 0, 10000);
  const safeMax = clampNumber(updates.maxScore, 0, 10000);
  const percentage = safeMax > 0 ? clampNumber((safeScore / safeMax) * 100, 0, 100) : 0;

  try {
    await updateDoc(ref, {
      status: updates.status,
      score: safeScore,
      maxScore: safeMax,
      percentage,
      correctCount: Math.round(clampNumber(updates.correctCount, 0, 10000)),
      incorrectCount: Math.round(clampNumber(updates.incorrectCount, 0, 10000)),
      skippedCount: Math.round(clampNumber(updates.skippedCount, 0, 10000)),
      durationSeconds: Math.round(clampNumber(updates.durationSeconds, 0, 864000)),
      summary: sanitizeBoundedString(updates.summary, 4000),
      weaknesses: updates.weaknesses
        .map((w) => sanitizeBoundedString(w, 200))
        .filter(Boolean)
        .slice(0, 50),
      details: updates.details,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteStudyHistoryRecord(
  userId: string,
  courseId: string,
  historyId: string
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/studyHistory/${historyId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'studyHistory', historyId);
  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
