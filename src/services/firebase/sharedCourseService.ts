import {
  collection,
  deleteDoc,
  doc,
  getDoc,
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
  Course,
  CourseGroup,
  CourseMember,
  CourseShare,
  JoinedCourse,
  PersonalSourceNote,
} from '../../types/models';
import {
  generateDocumentId,
  isValidId,
  sanitizeBoundedString,
  SCHEMA_LIMITS,
  timestampToMillis,
} from '../../utils/validation';
import { db } from './config';
import { handleFirestoreError, OperationType } from './errors';

/**
 * Resolves the UID that owns the course's canonical topics & sources.
 * Owned courses resolve to the current user; joined shared courses resolve to the author.
 */
export function getCourseContentOwnerId(
  course: Course | null | undefined,
  fallbackUserId?: string
): string | undefined {
  if (!course) return fallbackUserId;
  return course.authorId || course.userId || fallbackUserId;
}

/**
 * Extracts a clean shareToken from either a full invite URL or a raw token string.
 */
export function extractShareToken(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/\/join\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Builds the full browser invite URL for a given shareToken.
 */
export function buildCourseInviteUrl(shareToken: string): string {
  if (typeof window === 'undefined' || !shareToken) return '';
  return `${window.location.origin}/join/${shareToken}`;
}

/**
 * Toggles a course between Public and Private.
 * When enabling public sharing for the first time, generates a fresh shareToken
 * and creates the PII-free `/courseShares/{shareToken}` lookup record atomically.
 */
export async function setCoursePublicVisibility(params: {
  authorId: string;
  authorName: string;
  course: Course;
  isPublic: boolean;
}): Promise<{ isPublic: boolean; shareToken: string }> {
  const { authorId, course, isPublic } = params;
  const safeAuthorName = sanitizeBoundedString(params.authorName || 'Course Author', SCHEMA_LIMITS.DISPLAY_NAME_MAX);
  const existingToken = course.shareToken && isValidId(course.shareToken) ? course.shareToken : '';
  const nextToken = isPublic ? existingToken || generateDocumentId('shr') : existingToken;

  const courseRef = doc(db, 'users', authorId, 'courses', course.id);
  const batch = writeBatch(db);

  batch.update(courseRef, {
    isPublic,
    shareToken: nextToken,
    authorName: safeAuthorName,
    updatedAt: serverTimestamp(),
  });

  if (nextToken) {
    const shareRef = doc(db, 'courseShares', nextToken);
    if (existingToken && existingToken === nextToken) {
      // Check if share doc exists; if not, create it, otherwise update active flag & metadata
      const existingSnap = await getDoc(shareRef).catch(() => null);
      if (existingSnap && existingSnap.exists()) {
        batch.update(shareRef, {
          courseCode: sanitizeBoundedString(course.code, SCHEMA_LIMITS.COURSE_CODE_MAX),
          courseName: sanitizeBoundedString(course.name, SCHEMA_LIMITS.COURSE_NAME_MAX),
          courseDescription: sanitizeBoundedString(course.description, SCHEMA_LIMITS.COURSE_DESC_MAX),
          authorName: safeAuthorName,
          active: isPublic,
          updatedAt: serverTimestamp(),
        });
      } else if (isPublic) {
        batch.set(shareRef, {
          shareToken: nextToken,
          authorId,
          courseId: course.id,
          courseCode: sanitizeBoundedString(course.code, SCHEMA_LIMITS.COURSE_CODE_MAX),
          courseName: sanitizeBoundedString(course.name, SCHEMA_LIMITS.COURSE_NAME_MAX),
          courseDescription: sanitizeBoundedString(course.description, SCHEMA_LIMITS.COURSE_DESC_MAX),
          authorName: safeAuthorName,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } else if (isPublic) {
      batch.set(shareRef, {
        shareToken: nextToken,
        authorId,
        courseId: course.id,
        courseCode: sanitizeBoundedString(course.code, SCHEMA_LIMITS.COURSE_CODE_MAX),
        courseName: sanitizeBoundedString(course.name, SCHEMA_LIMITS.COURSE_NAME_MAX),
        courseDescription: sanitizeBoundedString(course.description, SCHEMA_LIMITS.COURSE_DESC_MAX),
        authorName: safeAuthorName,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${authorId}/courses/${course.id}`);
  }

  return { isPublic, shareToken: nextToken };
}

/**
 * Rotates (regenerates) a public course's invite link atomically.
 * Deletes the old `/courseShares/{oldToken}` record so old links immediately stop working,
 * while keeping existing joined members unaffected.
 */
export async function regenerateCourseShareToken(params: {
  authorId: string;
  authorName: string;
  course: Course;
}): Promise<string> {
  const { authorId, course } = params;
  const safeAuthorName = sanitizeBoundedString(params.authorName || 'Course Author', SCHEMA_LIMITS.DISPLAY_NAME_MAX);
  const oldToken = course.shareToken && isValidId(course.shareToken) ? course.shareToken : '';
  const newToken = generateDocumentId('shr');

  const courseRef = doc(db, 'users', authorId, 'courses', course.id);
  const newShareRef = doc(db, 'courseShares', newToken);
  const batch = writeBatch(db);

  batch.update(courseRef, {
    isPublic: true,
    shareToken: newToken,
    authorName: safeAuthorName,
    updatedAt: serverTimestamp(),
  });

  batch.set(newShareRef, {
    shareToken: newToken,
    authorId,
    courseId: course.id,
    courseCode: sanitizeBoundedString(course.code, SCHEMA_LIMITS.COURSE_CODE_MAX),
    courseName: sanitizeBoundedString(course.name, SCHEMA_LIMITS.COURSE_NAME_MAX),
    courseDescription: sanitizeBoundedString(course.description, SCHEMA_LIMITS.COURSE_DESC_MAX),
    authorName: safeAuthorName,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (oldToken && oldToken !== newToken) {
    const oldShareRef = doc(db, 'courseShares', oldToken);
    const oldSnap = await getDoc(oldShareRef).catch(() => null);
    if (oldSnap && oldSnap.exists()) {
      batch.delete(oldShareRef);
    }
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `courseShares/${newToken}`);
  }

  return newToken;
}

/**
 * Keeps the public `/courseShares/{shareToken}` preview metadata in sync
 * whenever the author renames or edits their course.
 */
export async function syncCourseShareMetadata(params: {
  shareToken: string;
  courseCode: string;
  courseName: string;
  courseDescription: string;
  authorName: string;
}): Promise<void> {
  if (!params.shareToken || !isValidId(params.shareToken)) return;
  const shareRef = doc(db, 'courseShares', params.shareToken);
  try {
    const snap = await getDoc(shareRef);
    if (!snap.exists()) return;
    await updateDoc(shareRef, {
      courseCode: sanitizeBoundedString(params.courseCode, SCHEMA_LIMITS.COURSE_CODE_MAX),
      courseName: sanitizeBoundedString(params.courseName, SCHEMA_LIMITS.COURSE_NAME_MAX),
      courseDescription: sanitizeBoundedString(params.courseDescription, SCHEMA_LIMITS.COURSE_DESC_MAX),
      authorName: sanitizeBoundedString(params.authorName || 'Course Author', SCHEMA_LIMITS.DISPLAY_NAME_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal metadata sync
  }
}

/**
 * Looks up a public course share invite by token.
 */
export async function fetchCourseShareByToken(shareToken: string): Promise<CourseShare | null> {
  const clean = extractShareToken(shareToken);
  if (!clean || !isValidId(clean)) return null;

  const path = `courseShares/${clean}`;
  try {
    const snap = await getDoc(doc(db, 'courseShares', clean));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      shareToken: String(data.shareToken ?? clean),
      authorId: String(data.authorId ?? ''),
      courseId: String(data.courseId ?? ''),
      courseCode: String(data.courseCode ?? ''),
      courseName: String(data.courseName ?? ''),
      courseDescription: String(data.courseDescription ?? ''),
      authorName: String(data.authorName ?? 'Course Author'),
      active: Boolean(data.active),
      createdAt: data.createdAt ?? null,
      updatedAt: data.updatedAt ?? null,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

/**
 * Instant-joins a public shared course atomically via writeBatch:
 * 1. Creates `/users/{authorId}/courses/{courseId}/members/{memberUid}`
 * 2. Creates `/users/{memberUid}/joinedCourses/{courseId}`
 */
export async function joinSharedCourse(params: {
  share: CourseShare;
  memberUid: string;
  displayName: string;
  photoURL: string;
}): Promise<void> {
  const { share, memberUid } = params;
  if (!share.active) {
    throw new Error('This shared course link is no longer active.');
  }
  if (share.authorId === memberUid) {
    throw new Error('You are already the author of this course.');
  }

  const memberRef = doc(db, 'users', share.authorId, 'courses', share.courseId, 'members', memberUid);
  const joinedRef = doc(db, 'users', memberUid, 'joinedCourses', share.courseId);

  const safeName = sanitizeBoundedString(params.displayName || 'Student', SCHEMA_LIMITS.DISPLAY_NAME_MAX);
  const safePhoto = sanitizeBoundedString(params.photoURL || '', SCHEMA_LIMITS.PHOTO_URL_MAX);

  const batch = writeBatch(db);
  batch.set(memberRef, {
    memberUid,
    authorId: share.authorId,
    courseId: share.courseId,
    displayName: safeName,
    photoURL: safePhoto,
    groupId: '',
    role: 'member',
    shareToken: share.shareToken,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(joinedRef, {
    userId: memberUid,
    authorId: share.authorId,
    courseId: share.courseId,
    courseCode: sanitizeBoundedString(share.courseCode, SCHEMA_LIMITS.COURSE_CODE_MAX),
    courseName: sanitizeBoundedString(share.courseName, SCHEMA_LIMITS.COURSE_NAME_MAX),
    courseDescription: sanitizeBoundedString(share.courseDescription, SCHEMA_LIMITS.COURSE_DESC_MAX),
    authorName: sanitizeBoundedString(share.authorName || 'Course Author', SCHEMA_LIMITS.DISPLAY_NAME_MAX),
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.CREATE,
      `users/${share.authorId}/courses/${share.courseId}/members/${memberUid}`
    );
  }
}

/**
 * Leaves a shared course as a member (deletes membership + joinedCourses pointer).
 * Tolerates the case where the author already removed the member or deleted the course.
 */
export async function leaveSharedCourse(params: {
  memberUid: string;
  authorId: string;
  courseId: string;
}): Promise<void> {
  const { memberUid, authorId, courseId } = params;
  // Best-effort remove membership doc under author's course
  try {
    await deleteDoc(doc(db, 'users', authorId, 'courses', courseId, 'members', memberUid));
  } catch {
    // Ignore if already removed by author or course deleted
  }

  // Always remove the user's own joinedCourses pointer
  const joinedPath = `users/${memberUid}/joinedCourses/${courseId}`;
  try {
    await deleteDoc(doc(db, 'users', memberUid, 'joinedCourses', courseId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, joinedPath);
  }
}

/**
 * Subscribes to the signed-in user's joined shared courses list.
 */
export function subscribeJoinedCourses(
  userId: string,
  onData: (joined: JoinedCourse[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/joinedCourses`;
  const q = query(collection(db, 'users', userId, 'joinedCourses'), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: JoinedCourse[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          userId: String(data.userId ?? userId),
          authorId: String(data.authorId ?? ''),
          courseId: String(data.courseId ?? docSnap.id),
          courseCode: String(data.courseCode ?? ''),
          courseName: String(data.courseName ?? ''),
          courseDescription: String(data.courseDescription ?? ''),
          authorName: String(data.authorName ?? 'Course Author'),
          joinedAt: data.joinedAt ?? null,
          updatedAt: data.updatedAt ?? null,
        };
      });
      items.sort((a, b) => timestampToMillis(b.joinedAt) - timestampToMillis(a.joinedAt));
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

/**
 * Subscribes to a member's active membership doc to detect instant revocation
 * and learn their assigned study group ID.
 */
export function subscribeMemberStatus(
  authorId: string,
  courseId: string,
  memberUid: string,
  onStatus: (member: CourseMember | null) => void
): Unsubscribe {
  const ref = doc(db, 'users', authorId, 'courses', courseId, 'members', memberUid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onStatus(null);
        return;
      }
      const data = snap.data();
      onStatus({
        memberUid: String(data.memberUid ?? memberUid),
        authorId: String(data.authorId ?? authorId),
        courseId: String(data.courseId ?? courseId),
        displayName: String(data.displayName ?? 'Student'),
        photoURL: String(data.photoURL ?? ''),
        groupId: String(data.groupId ?? ''),
        role: 'member',
        shareToken: String(data.shareToken ?? ''),
        joinedAt: data.joinedAt ?? null,
        updatedAt: data.updatedAt ?? null,
      });
    },
    () => {
      onStatus(null);
    }
  );
}

/**
 * Subscribes to the live course metadata document on the author's workspace
 * so joined members immediately see renames or description edits.
 */
export function subscribeLiveSharedCourseMeta(
  authorId: string,
  courseId: string,
  onMeta: (meta: { code: string; name: string; description: string; authorName: string } | null) => void
): Unsubscribe {
  const ref = doc(db, 'users', authorId, 'courses', courseId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onMeta(null);
        return;
      }
      const data = snap.data();
      onMeta({
        code: String(data.code ?? ''),
        name: String(data.name ?? ''),
        description: String(data.description ?? ''),
        authorName: String(data.authorName ?? ''),
      });
    },
    () => {
      onMeta(null);
    }
  );
}

/**
 * Updates cached metadata on the user's `joinedCourses/{courseId}` bookmark doc.
 */
export async function syncJoinedCourseCache(params: {
  memberUid: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  courseDescription: string;
  authorName: string;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', params.memberUid, 'joinedCourses', params.courseId), {
      courseCode: sanitizeBoundedString(params.courseCode, SCHEMA_LIMITS.COURSE_CODE_MAX),
      courseName: sanitizeBoundedString(params.courseName, SCHEMA_LIMITS.COURSE_NAME_MAX),
      courseDescription: sanitizeBoundedString(params.courseDescription, SCHEMA_LIMITS.COURSE_DESC_MAX),
      authorName: sanitizeBoundedString(params.authorName || 'Course Author', SCHEMA_LIMITS.DISPLAY_NAME_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal cache sync
  }
}

/**
 * Fetches a single named group doc (used so a member can display their assigned group name).
 */
export async function fetchCourseGroup(
  authorId: string,
  courseId: string,
  groupId: string
): Promise<CourseGroup | null> {
  if (!groupId || !isValidId(groupId)) return null;
  try {
    const snap = await getDoc(doc(db, 'users', authorId, 'courses', courseId, 'groups', groupId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      id: snap.id,
      authorId: String(data.authorId ?? authorId),
      courseId: String(data.courseId ?? courseId),
      name: String(data.name ?? ''),
      description: String(data.description ?? ''),
      createdAt: data.createdAt ?? null,
      updatedAt: data.updatedAt ?? null,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Author Management: Members & Named Study Groups
// =============================================================================

export function subscribeCourseMembers(
  authorId: string,
  courseId: string,
  onData: (members: CourseMember[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${authorId}/courses/${courseId}/members`;
  const q = query(
    collection(db, 'users', authorId, 'courses', courseId, 'members'),
    where('authorId', '==', authorId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: CourseMember[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          memberUid: String(data.memberUid ?? docSnap.id),
          authorId: String(data.authorId ?? authorId),
          courseId: String(data.courseId ?? courseId),
          displayName: String(data.displayName ?? 'Student'),
          photoURL: String(data.photoURL ?? ''),
          groupId: String(data.groupId ?? ''),
          role: 'member',
          shareToken: String(data.shareToken ?? ''),
          joinedAt: data.joinedAt ?? null,
          updatedAt: data.updatedAt ?? null,
        };
      });
      items.sort((a, b) => timestampToMillis(b.joinedAt) - timestampToMillis(a.joinedAt));
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

export async function removeCourseMember(
  authorId: string,
  courseId: string,
  memberUid: string
): Promise<void> {
  const path = `users/${authorId}/courses/${courseId}/members/${memberUid}`;
  try {
    await deleteDoc(doc(db, 'users', authorId, 'courses', courseId, 'members', memberUid));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function assignMemberToGroup(params: {
  authorId: string;
  courseId: string;
  memberUid: string;
  groupId: string;
}): Promise<void> {
  const safeGroupId = params.groupId && isValidId(params.groupId) ? params.groupId : '';
  const path = `users/${params.authorId}/courses/${params.courseId}/members/${params.memberUid}`;
  try {
    await updateDoc(
      doc(db, 'users', params.authorId, 'courses', params.courseId, 'members', params.memberUid),
      {
        groupId: safeGroupId,
        updatedAt: serverTimestamp(),
      }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeCourseGroups(
  authorId: string,
  courseId: string,
  onData: (groups: CourseGroup[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${authorId}/courses/${courseId}/groups`;
  const q = query(
    collection(db, 'users', authorId, 'courses', courseId, 'groups'),
    where('authorId', '==', authorId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: CourseGroup[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          authorId: String(data.authorId ?? authorId),
          courseId: String(data.courseId ?? courseId),
          name: String(data.name ?? ''),
          description: String(data.description ?? ''),
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null,
        };
      });
      items.sort((a, b) => a.name.localeCompare(b.name));
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

export async function createCourseGroup(params: {
  authorId: string;
  courseId: string;
  name: string;
  description?: string;
}): Promise<CourseGroup> {
  const name = sanitizeBoundedString(params.name, SCHEMA_LIMITS.GROUP_NAME_MAX);
  if (!name) {
    throw new Error('Group name is required.');
  }
  const description = sanitizeBoundedString(params.description || '', SCHEMA_LIMITS.GROUP_DESC_MAX);
  const groupId = generateDocumentId('grp');
  const path = `users/${params.authorId}/courses/${params.courseId}/groups/${groupId}`;

  try {
    await setDoc(doc(db, 'users', params.authorId, 'courses', params.courseId, 'groups', groupId), {
      authorId: params.authorId,
      courseId: params.courseId,
      name,
      description,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  return {
    id: groupId,
    authorId: params.authorId,
    courseId: params.courseId,
    name,
    description,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function updateCourseGroup(params: {
  authorId: string;
  courseId: string;
  groupId: string;
  name: string;
  description?: string;
}): Promise<void> {
  const name = sanitizeBoundedString(params.name, SCHEMA_LIMITS.GROUP_NAME_MAX);
  if (!name) {
    throw new Error('Group name is required.');
  }
  const description = sanitizeBoundedString(params.description || '', SCHEMA_LIMITS.GROUP_DESC_MAX);
  const path = `users/${params.authorId}/courses/${params.courseId}/groups/${params.groupId}`;

  try {
    await updateDoc(
      doc(db, 'users', params.authorId, 'courses', params.courseId, 'groups', params.groupId),
      {
        name,
        description,
        updatedAt: serverTimestamp(),
      }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteCourseGroup(params: {
  authorId: string;
  courseId: string;
  groupId: string;
}): Promise<void> {
  const { authorId, courseId, groupId } = params;
  const path = `users/${authorId}/courses/${courseId}/groups/${groupId}`;

  try {
    const membersSnap = await getDocs(
      query(
        collection(db, 'users', authorId, 'courses', courseId, 'members'),
        where('authorId', '==', authorId)
      )
    );
    const affected = membersSnap.docs.filter((d) => d.data().groupId === groupId);
    for (let i = 0; i < affected.length; i += 400) {
      const batch = writeBatch(db);
      affected.slice(i, i + 400).forEach((d) => {
        batch.update(d.ref, { groupId: '', updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }
    await deleteDoc(doc(db, 'users', authorId, 'courses', courseId, 'groups', groupId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// =============================================================================
// Private Member Personal Annotations on Shared Course Sources
// =============================================================================

export function subscribePersonalSourceNote(
  userId: string,
  courseId: string,
  sourceId: string,
  onData: (note: PersonalSourceNote | null) => void
): Unsubscribe {
  const ref = doc(db, 'users', userId, 'courses', courseId, 'sourceNotes', sourceId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      onData({
        id: snap.id,
        userId: String(data.userId ?? userId),
        courseId: String(data.courseId ?? courseId),
        sourceId: String(data.sourceId ?? sourceId),
        notes: String(data.notes ?? ''),
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
      });
    },
    () => {
      onData(null);
    }
  );
}

export async function savePersonalSourceNote(params: {
  userId: string;
  courseId: string;
  sourceId: string;
  notes: string;
}): Promise<void> {
  const { userId, courseId, sourceId } = params;
  const safeNotes = params.notes.slice(0, SCHEMA_LIMITS.SOURCE_NOTES_MAX);
  const path = `users/${userId}/courses/${courseId}/sourceNotes/${sourceId}`;
  const ref = doc(db, 'users', userId, 'courses', courseId, 'sourceNotes', sourceId);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        notes: safeNotes,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        userId,
        courseId,
        sourceId,
        notes: safeNotes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}
