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
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  MaterialType,
  ProcessingStatus,
  StudySection,
  StudySource,
} from '../../types/models';
import {
  generateDocumentId,
  isValidId,
  sanitizeBoundedString,
  SCHEMA_LIMITS,
  timestampToMillis,
} from '../../utils/validation';
import { clampSectionsForFirestore, countUncertainMarkers } from '../ingestion/structureParser';
import { db } from './config';
import { handleFirestoreError, OperationType } from './errors';

export interface CreateStudySourceInput {
  topicId: string;
  title: string;
  materialType: MaterialType;
  extractedContent: string;
  sections: StudySection[];
  pageOrSlideCount: number;
  processingStatus?: ProcessingStatus;
  studentNotes?: string;
  originalFileName?: string;
}

export interface UpdateStudySourceInput {
  title?: string;
  topicId?: string;
  materialType?: MaterialType;
  extractedContent?: string;
  sections?: StudySection[];
  processingStatus?: ProcessingStatus;
  studentNotes?: string;
}

export function subscribeCourseSources(
  userId: string,
  courseId: string,
  onData: (sources: StudySource[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/courses/${courseId}/sources`;
  const q = query(
    collection(db, 'users', userId, 'courses', courseId, 'sources'),
    where('userId', '==', userId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: StudySource[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          userId: String(data.userId ?? userId),
          courseId: String(data.courseId ?? courseId),
          topicId: String(data.topicId ?? ''),
          title: String(data.title ?? ''),
          materialType: (data.materialType as MaterialType) || 'other',
          extractedContent: String(data.extractedContent ?? ''),
          sections: Array.isArray(data.sections) ? (data.sections as StudySection[]) : [],
          pageOrSlideCount: typeof data.pageOrSlideCount === 'number' ? data.pageOrSlideCount : 0,
          processingStatus: (data.processingStatus as ProcessingStatus) || 'ready',
          studentNotes: String(data.studentNotes ?? ''),
          originalFileName: String(data.originalFileName ?? ''),
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null,
        };
      });

      items.sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));
      onData(items);
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

export async function createStudySource(
  userId: string,
  courseId: string,
  input: CreateStudySourceInput
): Promise<StudySource> {
  const title = sanitizeBoundedString(input.title, SCHEMA_LIMITS.SOURCE_TITLE_MAX);
  if (!title) {
    throw new Error('Material title is required.');
  }

  const safeTopicId = input.topicId && isValidId(input.topicId) ? input.topicId : '';
  const safeContent = input.extractedContent.slice(0, SCHEMA_LIMITS.SOURCE_CONTENT_MAX);
  const safeSections = clampSectionsForFirestore(input.sections);
  const safeNotes = (input.studentNotes ?? '').slice(0, SCHEMA_LIMITS.SOURCE_NOTES_MAX);
  const safeFileName = sanitizeBoundedString(input.originalFileName ?? '', 260);
  const safePageCount = Math.max(0, Math.min(2000, Math.floor(input.pageOrSlideCount || 0)));
  const status: ProcessingStatus =
    input.processingStatus ?? (countUncertainMarkers(safeContent) > 0 ? 'needs_review' : 'ready');

  const sourceId = generateDocumentId('src');
  const path = `users/${userId}/courses/${courseId}/sources/${sourceId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'sources', sourceId);

  try {
    await setDoc(ref, {
      userId,
      courseId,
      topicId: safeTopicId,
      title,
      materialType: input.materialType,
      extractedContent: safeContent,
      sections: safeSections,
      pageOrSlideCount: safePageCount,
      processingStatus: status,
      studentNotes: safeNotes,
      originalFileName: safeFileName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  return {
    id: sourceId,
    userId,
    courseId,
    topicId: safeTopicId,
    title,
    materialType: input.materialType,
    extractedContent: safeContent,
    sections: safeSections,
    pageOrSlideCount: safePageCount,
    processingStatus: status,
    studentNotes: safeNotes,
    originalFileName: safeFileName,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function updateStudySource(
  userId: string,
  courseId: string,
  sourceId: string,
  updates: UpdateStudySourceInput
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/sources/${sourceId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'sources', sourceId);

  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (updates.title !== undefined) {
    const cleanTitle = sanitizeBoundedString(updates.title, SCHEMA_LIMITS.SOURCE_TITLE_MAX);
    if (!cleanTitle) throw new Error('Material title cannot be empty.');
    payload.title = cleanTitle;
  }

  if (updates.topicId !== undefined) {
    payload.topicId = updates.topicId && isValidId(updates.topicId) ? updates.topicId : '';
  }

  if (updates.materialType !== undefined) {
    payload.materialType = updates.materialType;
  }

  if (updates.extractedContent !== undefined) {
    payload.extractedContent = updates.extractedContent.slice(0, SCHEMA_LIMITS.SOURCE_CONTENT_MAX);
  }

  if (updates.sections !== undefined) {
    payload.sections = clampSectionsForFirestore(updates.sections);
  }

  if (updates.processingStatus !== undefined) {
    payload.processingStatus = updates.processingStatus;
  }

  if (updates.studentNotes !== undefined) {
    payload.studentNotes = updates.studentNotes.slice(0, SCHEMA_LIMITS.SOURCE_NOTES_MAX);
  }

  try {
    await updateDoc(ref, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * Moves a study source within the same course (changing topic) OR across courses
 * atomically using a Firestore writeBatch.
 */
export async function moveStudySource(params: {
  userId: string;
  source: StudySource;
  targetCourseId: string;
  targetTopicId: string;
}): Promise<string> {
  const { userId, source, targetCourseId, targetTopicId } = params;
  const safeTopicId = targetTopicId && isValidId(targetTopicId) ? targetTopicId : '';

  if (source.courseId === targetCourseId) {
    await updateStudySource(userId, source.courseId, source.id, { topicId: safeTopicId });
    return source.id;
  }

  const newSourceId = generateDocumentId('src');
  const targetRef = doc(db, 'users', userId, 'courses', targetCourseId, 'sources', newSourceId);
  const oldRef = doc(db, 'users', userId, 'courses', source.courseId, 'sources', source.id);
  const targetPath = `users/${userId}/courses/${targetCourseId}/sources/${newSourceId}`;

  try {
    const batch = writeBatch(db);
    batch.set(targetRef, {
      userId,
      courseId: targetCourseId,
      topicId: safeTopicId,
      title: sanitizeBoundedString(source.title, SCHEMA_LIMITS.SOURCE_TITLE_MAX),
      materialType: source.materialType,
      extractedContent: source.extractedContent.slice(0, SCHEMA_LIMITS.SOURCE_CONTENT_MAX),
      sections: clampSectionsForFirestore(source.sections),
      pageOrSlideCount: Math.max(0, Math.min(2000, Math.floor(source.pageOrSlideCount || 0))),
      processingStatus: source.processingStatus,
      studentNotes: source.studentNotes.slice(0, SCHEMA_LIMITS.SOURCE_NOTES_MAX),
      originalFileName: sanitizeBoundedString(source.originalFileName, 260),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.delete(oldRef);
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, targetPath);
  }

  return newSourceId;
}

export async function deleteStudySource(
  userId: string,
  courseId: string,
  sourceId: string
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/sources/${sourceId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'courses', courseId, 'sources', sourceId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
