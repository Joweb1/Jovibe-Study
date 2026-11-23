import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import type {
  Course,
  MaterialType,
  ProcessingStatus,
  StudySection,
} from '../../types/models';
import {
  generateDocumentId,
  sanitizeBoundedString,
  SCHEMA_LIMITS,
  timestampToMillis,
} from '../../utils/validation';
import { db } from './config';
import {
  createCourse as createCourseInFirestore,
  deleteCourse as deleteCourseInFirestore,
  updateCourse as updateCourseInFirestore,
} from './courseService';
import { handleFirestoreError, OperationType } from './errors';
import {
  regenerateCourseShareToken,
  setCoursePublicVisibility,
  syncCourseShareMetadata,
} from './sharedCourseService';
import { createStudySource } from './sourceService';

async function getDocsPreferServer(
  q: Query<DocumentData, DocumentData>
): Promise<QuerySnapshot<DocumentData, DocumentData>> {
  try {
    return await getDocsFromServer(q);
  } catch {
    return await getDocs(q);
  }
}

async function getDocPreferServer(ref: DocumentReference<DocumentData, DocumentData>) {
  try {
    return await getDocFromServer(ref);
  } catch {
    return await getDoc(ref);
  }
}

interface OwnerMeta {
  email: string;
  displayName: string;
}

function mapCourseDoc(
  docId: string,
  data: DocumentData,
  ownerUid: string,
  ownerMeta: OwnerMeta,
  currentAdminUid: string
): Course {
  const isOwner = ownerUid === currentAdminUid;
  return {
    id: docId,
    userId: ownerUid,
    code: String(data.code ?? ''),
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    isPublic: Boolean(data.isPublic),
    shareToken: String(data.shareToken ?? ''),
    authorName: String(data.authorName ?? ownerMeta.displayName ?? ''),
    authorId: ownerUid,
    ownerEmail: ownerMeta.email,
    isOwner,
    isShared: false,
    isAdminAccess: !isOwner,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

/**
 * Fetches every course across every user account in Firestore for the Admin
 * Application Courses view, enriched with owner email and public/private status.
 */
export async function fetchAllApplicationCourses(currentAdminUid: string): Promise<Course[]> {
  let usersSnap: QuerySnapshot<DocumentData>;
  try {
    usersSnap = await getDocsPreferServer(collection(db, 'users'));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }

  const userRecords = usersSnap.docs.map((userDoc) => {
    const data = userDoc.data();
    return {
      uid: userDoc.id,
      email: String(data.email ?? ''),
      displayName: String(data.displayName ?? ''),
    };
  });

  const allCourses: Course[] = [];
  const BATCH_SIZE = 8;

  for (let i = 0; i < userRecords.length; i += BATCH_SIZE) {
    const batch = userRecords.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (u) => {
        try {
          const coursesSnap = await getDocsPreferServer(
            collection(db, 'users', u.uid, 'courses')
          );
          return coursesSnap.docs.map((courseDoc) =>
            mapCourseDoc(
              courseDoc.id,
              courseDoc.data(),
              u.uid,
              { email: u.email, displayName: u.displayName },
              currentAdminUid
            )
          );
        } catch {
          return [] as Course[];
        }
      })
    );

    for (const userCourses of batchResults) {
      allCourses.push(...userCourses);
    }
  }

  allCourses.sort((a, b) => {
    const timeA = timestampToMillis(a.updatedAt) || timestampToMillis(a.createdAt);
    const timeB = timestampToMillis(b.updatedAt) || timestampToMillis(b.createdAt);
    return timeB - timeA;
  });

  return allCourses;
}

/**
 * Resolves a single Application Course by courseId (fast path when ownerUidHint is known).
 */
export async function fetchApplicationCourseById(
  courseId: string,
  currentAdminUid: string,
  ownerUidHint?: string
): Promise<Course | null> {
  if (ownerUidHint) {
    try {
      const [userSnap, courseSnap] = await Promise.all([
        getDocPreferServer(doc(db, 'users', ownerUidHint)),
        getDocPreferServer(doc(db, 'users', ownerUidHint, 'courses', courseId)),
      ]);
      if (courseSnap.exists()) {
        const userData = userSnap.exists() ? userSnap.data() : {};
        return mapCourseDoc(
          courseSnap.id,
          courseSnap.data(),
          ownerUidHint,
          {
            email: String(userData.email ?? ''),
            displayName: String(userData.displayName ?? ''),
          },
          currentAdminUid
        );
      }
    } catch {
      // Fall back to full scan below
    }
  }

  const all = await fetchAllApplicationCourses(currentAdminUid);
  return all.find((c) => c.id === courseId) ?? null;
}

/**
 * Remixes any application course into the admin's own account:
 * - Creates a brand-new private course under `users/{adminUid}/courses/{newCourseId}`
 * - Copies all topics (preserving order and building an oldTopicId -> newTopicId map)
 * - Copies all study sources/materials (remapping topicId and preserving extracted content/sections)
 */
export async function remixCourseToOwnAccount(params: {
  adminUid: string;
  adminDisplayName: string;
  sourceCourse: Course;
}): Promise<{ course: Course; topicsCopied: number; sourcesCopied: number }> {
  const { adminUid, adminDisplayName, sourceCourse } = params;
  const sourceOwnerUid = sourceCourse.authorId || sourceCourse.userId;

  // 1. Read source topics & study sources first so we know everything is readable before creating the copy
  const [topicsSnap, sourcesSnap] = await Promise.all([
    getDocsPreferServer(
      query(
        collection(db, 'users', sourceOwnerUid, 'courses', sourceCourse.id, 'topics'),
        where('userId', '==', sourceOwnerUid)
      )
    ),
    getDocsPreferServer(
      query(
        collection(db, 'users', sourceOwnerUid, 'courses', sourceCourse.id, 'sources'),
        where('userId', '==', sourceOwnerUid)
      )
    ),
  ]);

  // 2. Create the new private course in the admin's own account
  const newCourse = await createCourseInFirestore(adminUid, {
    code: sourceCourse.code || 'COURSE',
    name: sourceCourse.name || 'Remixed Course',
    description: sourceCourse.description || '',
    authorName: adminDisplayName || 'Admin',
  });

  // 3. Copy topics in order and record oldTopicId -> newTopicId mapping
  const topicIdMap = new Map<string, string>();
  const sortedTopics = topicsSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        oldId: d.id,
        name: sanitizeBoundedString(String(data.name ?? 'Untitled Topic'), SCHEMA_LIMITS.TOPIC_NAME_MAX) || 'Untitled Topic',
        description: sanitizeBoundedString(String(data.description ?? ''), SCHEMA_LIMITS.TOPIC_DESC_MAX),
        order: typeof data.order === 'number' ? Math.max(0, Math.min(10000, Math.floor(data.order))) : 0,
      };
    })
    .sort((a, b) => a.order - b.order);

  const TOPIC_BATCH_SIZE = 400;
  for (let i = 0; i < sortedTopics.length; i += TOPIC_BATCH_SIZE) {
    const chunk = sortedTopics.slice(i, i + TOPIC_BATCH_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((topic, idx) => {
      const newTopicId = generateDocumentId('top');
      topicIdMap.set(topic.oldId, newTopicId);
      const ref = doc(db, 'users', adminUid, 'courses', newCourse.id, 'topics', newTopicId);
      batch.set(ref, {
        userId: adminUid,
        courseId: newCourse.id,
        name: topic.name,
        description: topic.description,
        order: i + idx,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }

  // 4. Copy study sources in small parallel chunks (each source may carry up to 450KB extractedContent)
  const validMaterialTypes = new Set<MaterialType>([
    'pdf',
    'slides',
    'textbook_photo',
    'handwritten_notes',
    'scanned_doc',
    'typed_notes',
    'pasted_text',
    'other',
  ]);
  const validStatuses = new Set<ProcessingStatus>(['ready', 'needs_review', 'failed']);

  const sourcePayloads = sourcesSnap.docs.map((d) => {
    const data = d.data();
    const oldTopicId = String(data.topicId ?? '');
    const mappedTopicId = oldTopicId ? topicIdMap.get(oldTopicId) ?? '' : '';
    const rawType = String(data.materialType ?? 'other') as MaterialType;
    const rawStatus = String(data.processingStatus ?? 'ready') as ProcessingStatus;
    return {
      topicId: mappedTopicId,
      title: String(data.title ?? 'Untitled Material') || 'Untitled Material',
      materialType: validMaterialTypes.has(rawType) ? rawType : 'other',
      extractedContent: String(data.extractedContent ?? ''),
      sections: Array.isArray(data.sections) ? (data.sections as StudySection[]) : [],
      pageOrSlideCount: typeof data.pageOrSlideCount === 'number' ? data.pageOrSlideCount : 0,
      processingStatus: validStatuses.has(rawStatus) ? rawStatus : 'ready',
      studentNotes: String(data.studentNotes ?? ''),
      originalFileName: String(data.originalFileName ?? ''),
    };
  });

  const SOURCE_CONCURRENCY = 4;
  let sourcesCopied = 0;
  for (let i = 0; i < sourcePayloads.length; i += SOURCE_CONCURRENCY) {
    const chunk = sourcePayloads.slice(i, i + SOURCE_CONCURRENCY);
    await Promise.all(
      chunk.map(async (payload) => {
        await createStudySource(adminUid, newCourse.id, payload);
        sourcesCopied += 1;
      })
    );
  }

  return {
    course: newCourse,
    topicsCopied: sortedTopics.length,
    sourcesCopied,
  };
}

/**
 * Admin update for any application course (code, name, description) + public share metadata sync.
 */
export async function adminUpdateApplicationCourse(
  course: Course,
  updates: { code?: string; name?: string; description?: string }
): Promise<void> {
  const ownerUid = course.authorId || course.userId;
  const nextValues = {
    code: updates.code ?? course.code,
    name: updates.name ?? course.name,
    description: updates.description ?? course.description,
  };
  await updateCourseInFirestore(ownerUid, course.id, nextValues);

  if (course.shareToken) {
    await syncCourseShareMetadata({
      shareToken: course.shareToken,
      courseCode: nextValues.code,
      courseName: nextValues.name,
      courseDescription: nextValues.description,
      authorName: course.authorName || 'Course Author',
    });
  }
}

/**
 * Admin visibility toggle (Public / Private) for any application course.
 */
export async function adminSetApplicationCourseVisibility(
  course: Course,
  isPublic: boolean
): Promise<{ isPublic: boolean; shareToken: string }> {
  const ownerUid = course.authorId || course.userId;
  return setCoursePublicVisibility({
    authorId: ownerUid,
    authorName: course.authorName || course.ownerEmail || 'Course Author',
    course,
    isPublic,
  });
}

/**
 * Admin invite link rotation for any application course.
 */
export async function adminRegenerateApplicationCourseShareToken(
  course: Course
): Promise<string> {
  const ownerUid = course.authorId || course.userId;
  return regenerateCourseShareToken({
    authorId: ownerUid,
    authorName: course.authorName || course.ownerEmail || 'Course Author',
    course,
  });
}

/**
 * Admin delete for any application course (cascades subcollections and share token).
 */
export async function adminDeleteApplicationCourse(course: Course): Promise<void> {
  const ownerUid = course.authorId || course.userId;
  await deleteCourseInFirestore(ownerUid, course.id, course.shareToken);
}
