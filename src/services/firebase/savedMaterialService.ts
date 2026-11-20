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
  SavedMaterialType,
  SavedStudyMaterial,
  SourceReference,
  TutorSourceMode,
} from '../../types/models';
import {
  generateDocumentId,
  sanitizeBoundedString,
  timestampToMillis,
} from '../../utils/validation';
import { db } from './config';
import { handleFirestoreError, OperationType } from './errors';

function studyMaterialsCollection(userId: string, courseId: string) {
  return collection(db, 'users', userId, 'courses', courseId, 'studyMaterials');
}

export function subscribeCourseSavedMaterials(
  userId: string,
  courseId: string,
  onData: (materials: SavedStudyMaterial[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/courses/${courseId}/studyMaterials`;
  const q = query(studyMaterialsCollection(userId, courseId), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SavedStudyMaterial[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SavedStudyMaterial, 'id'>),
      }));
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

export async function createSavedStudyMaterial(
  userId: string,
  courseId: string,
  input: {
    topicId?: string;
    title: string;
    type: SavedMaterialType;
    content: Record<string, unknown>;
    sourceReferences?: SourceReference[];
  }
): Promise<SavedStudyMaterial> {
  const id = generateDocumentId('mat');
  const path = `users/${userId}/courses/${courseId}/studyMaterials/${id}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'studyMaterials', id);

  const cleanTitle = sanitizeBoundedString(input.title, 200);
  if (!cleanTitle) {
    throw new Error('Material title is required.');
  }

  const sanitizedRefs = (input.sourceReferences || []).slice(0, 50).map((r) => ({
    sourceId: sanitizeBoundedString(r.sourceId || '', 128),
    sourceTitle: sanitizeBoundedString(r.sourceTitle || 'Course Material', 200),
    ...(r.sectionHeading
      ? { sectionHeading: sanitizeBoundedString(r.sectionHeading, 200) }
      : {}),
    ...(typeof r.pageOrSlide === 'number' ? { pageOrSlide: r.pageOrSlide } : {}),
  }));

  const payload = {
    userId,
    courseId,
    topicId: input.topicId || '',
    title: cleanTitle,
    type: input.type,
    content: input.content,
    sourceReferences: sanitizedRefs,
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
    userId,
    courseId,
    topicId: input.topicId || '',
    title: cleanTitle,
    type: input.type,
    content: input.content,
    sourceReferences: sanitizedRefs,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function saveTutorResponseAsMaterial(
  userId: string,
  courseId: string,
  input: {
    topicId?: string;
    title: string;
    type: 'tutor_response' | 'explanation' | 'summary' | 'study_guide';
    answerMarkdown: string;
    questionPrompt?: string;
    sourceMode: TutorSourceMode;
    sourceReferences: SourceReference[];
    conversationId: string;
    messageId: string;
  }
): Promise<SavedStudyMaterial> {
  return createSavedStudyMaterial(userId, courseId, {
    topicId: input.topicId || '',
    title: input.title,
    type: input.type,
    content: {
      markdown: input.answerMarkdown,
      questionPrompt: input.questionPrompt || '',
      sourceMode: input.sourceMode,
      conversationId: input.conversationId,
      messageId: input.messageId,
    },
    sourceReferences: input.sourceReferences,
  });
}

export async function updateSavedMaterial(
  userId: string,
  courseId: string,
  materialId: string,
  updates: { title: string; topicId: string; content?: Record<string, unknown> }
): Promise<void> {
  const cleanTitle = sanitizeBoundedString(updates.title, 200);
  if (!cleanTitle) throw new Error('Title cannot be empty.');
  const path = `users/${userId}/courses/${courseId}/studyMaterials/${materialId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'studyMaterials', materialId);

  const payload: Record<string, unknown> = {
    title: cleanTitle,
    topicId: updates.topicId || '',
    updatedAt: serverTimestamp(),
  };
  if (updates.content) {
    payload.content = updates.content;
  }

  try {
    await updateDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSavedMaterial(
  userId: string,
  courseId: string,
  materialId: string
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/studyMaterials/${materialId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'studyMaterials', materialId);
  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
