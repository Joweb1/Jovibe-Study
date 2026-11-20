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
  SourceReference,
  TutorConversation,
  TutorMessage,
  TutorSourceMode,
} from '../../types/models';
import {
  generateDocumentId,
  sanitizeBoundedString,
  timestampToMillis,
} from '../../utils/validation';
import { db } from './config';
import { handleFirestoreError, OperationType } from './errors';

function conversationsCollection(userId: string, courseId: string) {
  return collection(db, 'users', userId, 'courses', courseId, 'conversations');
}

function messagesCollection(userId: string, courseId: string, conversationId: string) {
  return collection(
    db,
    'users',
    userId,
    'courses',
    courseId,
    'conversations',
    conversationId,
    'messages'
  );
}

export function subscribeCourseConversations(
  userId: string,
  courseId: string,
  onData: (conversations: TutorConversation[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/courses/${courseId}/conversations`;
  const q = query(conversationsCollection(userId, courseId), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: TutorConversation[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data({ serverTimestamps: 'estimate' }) as Omit<TutorConversation, 'id'>),
      }));
      list.sort((a, b) => {
        const diff = timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt);
        return diff !== 0 ? diff : b.id.localeCompare(a.id);
      });
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

export function subscribeConversationMessages(
  userId: string,
  courseId: string,
  conversationId: string,
  onData: (messages: TutorMessage[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/courses/${courseId}/conversations/${conversationId}/messages`;
  const q = query(
    messagesCollection(userId, courseId, conversationId),
    where('userId', '==', userId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: TutorMessage[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data({ serverTimestamps: 'estimate' }) as Omit<TutorMessage, 'id'>),
      }));
      list.sort((a, b) => {
        const aMs = timestampToMillis(a.createdAt) || Number.MAX_SAFE_INTEGER;
        const bMs = timestampToMillis(b.createdAt) || Number.MAX_SAFE_INTEGER;
        const diff = aMs - bMs;
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });
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

export async function createConversation(
  userId: string,
  courseId: string,
  input: { title?: string; sourceMode: TutorSourceMode }
): Promise<TutorConversation> {
  const id = generateDocumentId('conv');
  const path = `users/${userId}/courses/${courseId}/conversations/${id}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'conversations', id);
  const title = sanitizeBoundedString(input.title || 'New study conversation', 160) || 'New study conversation';

  const payload = {
    userId,
    courseId,
    title,
    sourceMode: input.sourceMode,
    lastMessagePreview: '',
    messageCount: 0,
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
    title,
    sourceMode: input.sourceMode,
    lastMessagePreview: '',
    messageCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function renameConversation(
  userId: string,
  courseId: string,
  conversationId: string,
  newTitle: string
): Promise<void> {
  const cleanTitle = sanitizeBoundedString(newTitle, 160);
  if (!cleanTitle) {
    throw new Error('Conversation title cannot be empty.');
  }

  const path = `users/${userId}/courses/${courseId}/conversations/${conversationId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'conversations', conversationId);
  try {
    await updateDoc(ref, {
      title: cleanTitle,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateConversationSourceMode(
  userId: string,
  courseId: string,
  conversationId: string,
  sourceMode: TutorSourceMode
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/conversations/${conversationId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'conversations', conversationId);
  try {
    await updateDoc(ref, {
      sourceMode,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

function sanitizeSourceReferences(refs: SourceReference[]): SourceReference[] {
  return refs.slice(0, 30).map((r) => ({
    sourceId: sanitizeBoundedString(r.sourceId || '', 128),
    sourceTitle: sanitizeBoundedString(r.sourceTitle || 'Course Material', 200),
    ...(r.sectionHeading
      ? { sectionHeading: sanitizeBoundedString(r.sectionHeading, 200) }
      : {}),
    ...(typeof r.pageOrSlide === 'number' ? { pageOrSlide: r.pageOrSlide } : {}),
  }));
}

export async function appendConversationMessage(
  userId: string,
  courseId: string,
  conversationId: string,
  input: {
    id?: string;
    role: 'user' | 'assistant';
    content: string;
    sourceReferences?: SourceReference[];
    nextMessageCount: number;
    autoTitle?: string;
  }
): Promise<TutorMessage> {
  const messageId = input.id || generateDocumentId('msg');
  const msgPath = `users/${userId}/courses/${courseId}/conversations/${conversationId}/messages/${messageId}`;
  const convPath = `users/${userId}/courses/${courseId}/conversations/${conversationId}`;

  const cleanContent = sanitizeBoundedString(input.content, 40000);
  if (!cleanContent) {
    throw new Error('Message content cannot be empty.');
  }

  const sanitizedRefs = sanitizeSourceReferences(input.sourceReferences || []);
  const msgRef = doc(
    db,
    'users',
    userId,
    'courses',
    courseId,
    'conversations',
    conversationId,
    'messages',
    messageId
  );

  try {
    await setDoc(msgRef, {
      userId,
      courseId,
      conversationId,
      role: input.role,
      content: cleanContent,
      sourceReferences: sanitizedRefs,
      saved: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, msgPath);
  }

  const preview = cleanContent.replace(/\s+/g, ' ').slice(0, 200);
  const convRef = doc(db, 'users', userId, 'courses', courseId, 'conversations', conversationId);
  const convUpdate: Record<string, unknown> = {
    lastMessagePreview: preview,
    messageCount: Math.min(5000, Math.max(1, input.nextMessageCount)),
    updatedAt: serverTimestamp(),
  };
  if (input.autoTitle && input.autoTitle.trim()) {
    convUpdate.title = sanitizeBoundedString(input.autoTitle, 160);
  }

  try {
    await updateDoc(convRef, convUpdate);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, convPath);
  }

  return {
    id: messageId,
    userId,
    courseId,
    conversationId,
    role: input.role,
    content: cleanContent,
    sourceReferences: sanitizedRefs,
    saved: false,
    createdAt: Date.now(),
  };
}

export async function markMessageSaved(
  userId: string,
  courseId: string,
  conversationId: string,
  messageId: string,
  saved: boolean
): Promise<void> {
  const path = `users/${userId}/courses/${courseId}/conversations/${conversationId}/messages/${messageId}`;
  const ref = doc(
    db,
    'users',
    userId,
    'courses',
    courseId,
    'conversations',
    conversationId,
    'messages',
    messageId
  );
  try {
    await updateDoc(ref, { saved: Boolean(saved) });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteConversation(
  userId: string,
  courseId: string,
  conversationId: string
): Promise<void> {
  const convPath = `users/${userId}/courses/${courseId}/conversations/${conversationId}`;
  const msgQuery = query(
    messagesCollection(userId, courseId, conversationId),
    where('userId', '==', userId)
  );

  try {
    const snap = await getDocs(msgQuery);
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const d of docs.slice(i, i + 400)) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }

    const convRef = doc(db, 'users', userId, 'courses', courseId, 'conversations', conversationId);
    const finalBatch = writeBatch(db);
    finalBatch.delete(convRef);
    await finalBatch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, convPath);
  }
}
