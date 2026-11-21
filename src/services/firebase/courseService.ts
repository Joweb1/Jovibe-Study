import {
  collection,
  deleteDoc,
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
import type { Course, Topic } from '../../types/models';
import {
  generateDocumentId,
  timestampToMillis,
  validateCourseInput,
  validateTopicInput,
} from '../../utils/validation';
import { db } from './config';
import { handleFirestoreError, OperationType } from './errors';

export function subscribeCourses(
  userId: string,
  onData: (courses: Course[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/courses`;
  const q = query(collection(db, 'users', userId, 'courses'), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: Course[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          userId: String(data.userId ?? userId),
          code: String(data.code ?? ''),
          name: String(data.name ?? ''),
          description: String(data.description ?? ''),
          isPublic: Boolean(data.isPublic),
          shareToken: typeof data.shareToken === 'string' ? data.shareToken : '',
          authorName: typeof data.authorName === 'string' ? data.authorName : '',
          isOwner: true,
          isShared: false,
          authorId: String(data.userId ?? userId),
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

export async function createCourse(
  userId: string,
  input: { code: string; name: string; description: string; authorName?: string }
): Promise<Course> {
  const { valid, error, sanitized } = validateCourseInput(input);
  if (!valid) {
    throw new Error(error || 'Invalid course details.');
  }

  const courseId = generateDocumentId('course');
  const path = `users/${userId}/courses/${courseId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId);
  const safeAuthorName = (input.authorName || '').trim().slice(0, 120);

  try {
    await setDoc(ref, {
      userId,
      code: sanitized.code,
      name: sanitized.name,
      description: sanitized.description,
      isPublic: false,
      shareToken: '',
      authorName: safeAuthorName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  return {
    id: courseId,
    userId,
    code: sanitized.code,
    name: sanitized.name,
    description: sanitized.description,
    isPublic: false,
    shareToken: '',
    authorName: safeAuthorName,
    isOwner: true,
    isShared: false,
    authorId: userId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function updateCourse(
  userId: string,
  courseId: string,
  input: { code: string; name: string; description: string }
): Promise<void> {
  const { valid, error, sanitized } = validateCourseInput(input);
  if (!valid) {
    throw new Error(error || 'Invalid course details.');
  }

  const path = `users/${userId}/courses/${courseId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId);

  try {
    await updateDoc(ref, {
      code: sanitized.code,
      name: sanitized.name,
      description: sanitized.description,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteCourse(
  userId: string,
  courseId: string,
  shareToken?: string
): Promise<void> {
  const coursePath = `users/${userId}/courses/${courseId}`;

  try {
    // Clean up nested topics, sources, sourceNotes, members, groups, saved materials, conversations/messages, history, and studySessions
    const [
      topicSnap,
      sourceSnap,
      sourceNoteSnap,
      memberSnap,
      groupSnap,
      materialSnap,
      convSnap,
      historySnap,
      sessionSnap,
    ] = await Promise.all([
      getDocs(
        query(
          collection(db, 'users', userId, 'courses', courseId, 'topics'),
          where('userId', '==', userId)
        )
      ),
      getDocs(
        query(
          collection(db, 'users', userId, 'courses', courseId, 'sources'),
          where('userId', '==', userId)
        )
      ),
      getDocs(
        query(
          collection(db, 'users', userId, 'courses', courseId, 'sourceNotes'),
          where('userId', '==', userId)
        )
      ),
      getDocs(
        query(
          collection(db, 'users', userId, 'courses', courseId, 'members'),
          where('authorId', '==', userId)
        )
      ),
      getDocs(
        query(
          collection(db, 'users', userId, 'courses', courseId, 'groups'),
          where('authorId', '==', userId)
        )
      ),
      getDocs(
        query(
          collection(db, 'users', userId, 'courses', courseId, 'studyMaterials'),
          where('userId', '==', userId)
        )
      ),
      getDocs(
        query(
          collection(db, 'users', userId, 'courses', courseId, 'conversations'),
          where('userId', '==', userId)
        )
      ),
      getDocs(
        query(
          collection(db, 'users', userId, 'courses', courseId, 'studyHistory'),
          where('userId', '==', userId)
        )
      ),
      getDocs(
        query(
          collection(db, 'users', userId, 'courses', courseId, 'studySessions'),
          where('userId', '==', userId)
        )
      ),
    ]);

    const [messageSnaps, segmentSnaps, checkpointSnaps] = await Promise.all([
      Promise.all(
        convSnap.docs.map((convDoc) =>
          getDocs(
            query(
              collection(
                db,
                'users',
                userId,
                'courses',
                courseId,
                'conversations',
                convDoc.id,
                'messages'
              ),
              where('userId', '==', userId)
            )
          )
        )
      ),
      Promise.all(
        sessionSnap.docs.map((sessDoc) =>
          getDocs(
            query(
              collection(
                db,
                'users',
                userId,
                'courses',
                courseId,
                'studySessions',
                sessDoc.id,
                'segments'
              ),
              where('userId', '==', userId)
            )
          )
        )
      ),
      Promise.all(
        sessionSnap.docs.map((sessDoc) =>
          getDocs(
            query(
              collection(
                db,
                'users',
                userId,
                'courses',
                courseId,
                'studySessions',
                sessDoc.id,
                'checkpoints'
              ),
              where('userId', '==', userId)
            )
          )
        )
      ),
    ]);

    const refsToDelete = [
      ...messageSnaps.flatMap((snap) => snap.docs.map((d) => d.ref)),
      ...segmentSnaps.flatMap((snap) => snap.docs.map((d) => d.ref)),
      ...checkpointSnaps.flatMap((snap) => snap.docs.map((d) => d.ref)),
      ...convSnap.docs.map((d) => d.ref),
      ...sessionSnap.docs.map((d) => d.ref),
      ...historySnap.docs.map((d) => d.ref),
      ...materialSnap.docs.map((d) => d.ref),
      ...sourceNoteSnap.docs.map((d) => d.ref),
      ...sourceSnap.docs.map((d) => d.ref),
      ...topicSnap.docs.map((d) => d.ref),
      ...memberSnap.docs.map((d) => d.ref),
      ...groupSnap.docs.map((d) => d.ref),
    ];

    for (let i = 0; i < refsToDelete.length; i += 400) {
      const batch = writeBatch(db);
      refsToDelete.slice(i, i + 400).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${coursePath}/subcollections`);
  }

  // Delete public share lookup doc if present
  if (shareToken && shareToken.trim()) {
    try {
      await deleteDoc(doc(db, 'courseShares', shareToken.trim()));
    } catch {
      // Ignore if already removed
    }
  }

  try {
    await deleteDoc(doc(db, 'users', userId, 'courses', courseId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, coursePath);
  }
}

export function subscribeTopics(
  userId: string,
  courseId: string,
  onData: (topics: Topic[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/courses/${courseId}/topics`;
  const q = query(
    collection(db, 'users', userId, 'courses', courseId, 'topics'),
    where('userId', '==', userId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: Topic[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          userId: String(data.userId ?? userId),
          courseId: String(data.courseId ?? courseId),
          name: String(data.name ?? ''),
          description: String(data.description ?? ''),
          order: typeof data.order === 'number' ? data.order : 0,
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null,
        };
      });

      items.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return timestampToMillis(a.createdAt) - timestampToMillis(b.createdAt);
      });
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

export async function createTopic(
  userId: string,
  courseId: string,
  input: { name: string; description: string; order: number }
): Promise<Topic> {
  const { valid, error, sanitized } = validateTopicInput(input);
  if (!valid) {
    throw new Error(error || 'Invalid topic details.');
  }

  const topicId = generateDocumentId('topic');
  const path = `users/${userId}/courses/${courseId}/topics/${topicId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'topics', topicId);
  const safeOrder = Math.max(0, Math.min(10000, Math.floor(input.order)));

  try {
    await setDoc(ref, {
      userId,
      courseId,
      name: sanitized.name,
      description: sanitized.description,
      order: safeOrder,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  return {
    id: topicId,
    userId,
    courseId,
    name: sanitized.name,
    description: sanitized.description,
    order: safeOrder,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function updateTopic(
  userId: string,
  courseId: string,
  topicId: string,
  input: { name: string; description: string; order: number }
): Promise<void> {
  const { valid, error, sanitized } = validateTopicInput(input);
  if (!valid) {
    throw new Error(error || 'Invalid topic details.');
  }

  const path = `users/${userId}/courses/${courseId}/topics/${topicId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'topics', topicId);
  const safeOrder = Math.max(0, Math.min(10000, Math.floor(input.order)));

  try {
    await updateDoc(ref, {
      name: sanitized.name,
      description: sanitized.description,
      order: safeOrder,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteTopic(
  userId: string,
  courseId: string,
  topicId: string
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/topics/${topicId}`;
  try {
    const sourcesQuery = query(
      collection(db, 'users', userId, 'courses', courseId, 'sources'),
      where('userId', '==', userId)
    );
    const snap = await getDocs(sourcesQuery);
    const matching = snap.docs.filter((d) => d.data().topicId === topicId);
    for (let i = 0; i < matching.length; i += 400) {
      const batch = writeBatch(db);
      matching.slice(i, i + 400).forEach((d) => {
        batch.update(d.ref, { topicId: '', updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }

    await deleteDoc(doc(db, 'users', userId, 'courses', courseId, 'topics', topicId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
