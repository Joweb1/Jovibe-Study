import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import type { Course, CourseMember, JoinedCourse, Topic } from '../types/models';
import { db } from '../services/firebase/config';
import {
  createCourse as createCourseInFirestore,
  createTopic as createTopicInFirestore,
  deleteCourse as deleteCourseInFirestore,
  deleteTopic as deleteTopicInFirestore,
  subscribeCourses,
  subscribeTopics,
  updateCourse as updateCourseInFirestore,
  updateTopic as updateTopicInFirestore,
} from '../services/firebase/courseService';
import {
  fetchCourseGroup,
  getCourseContentOwnerId,
  leaveSharedCourse,
  regenerateCourseShareToken,
  setCoursePublicVisibility,
  subscribeJoinedCourses,
  subscribeLiveSharedCourseMeta,
  subscribeMemberStatus,
  syncCourseShareMetadata,
  syncJoinedCourseCache,
} from '../services/firebase/sharedCourseService';
import { formatReadableError } from '../services/firebase/errors';
import {
  cacheCourseTopics,
  cacheUserCourses,
  getCachedCourses,
  getCachedTopics,
  getLocalMeta,
  setLocalMeta,
} from '../services/local/indexedDb';
import { timestampToMillis } from '../utils/validation';
import { useAuth } from './AuthContext';

interface CourseContextValue {
  courses: Course[];
  ownedCourses: Course[];
  sharedCourses: Course[];
  externalActiveCourse: Course | null;
  activeCourse: Course | null;
  activeContentOwnerId: string | undefined;
  activeCourseAccessRevoked: boolean;
  activeMemberGroupName: string | null;
  topics: Topic[];
  coursesLoading: boolean;
  topicsLoading: boolean;
  courseError: string | null;
  selectCourse: (courseId: string) => Promise<void>;
  selectExternalCourse: (course: Course) => Promise<void>;
  updateExternalCourseState: (updater: (prev: Course | null) => Course | null) => void;
  clearExternalCourse: () => void;
  createCourse: (input: { code: string; name: string; description: string }) => Promise<Course>;
  updateCourse: (courseId: string, input: { code: string; name: string; description: string }) => Promise<void>;
  deleteCourse: (courseId: string) => Promise<void>;
  leaveCourse: (courseId: string) => Promise<void>;
  setCourseVisibility: (courseId: string, isPublic: boolean) => Promise<{ isPublic: boolean; shareToken: string }>;
  rotateCourseShareLink: (courseId: string) => Promise<string>;
  createTopic: (input: { name: string; description: string }) => Promise<Topic>;
  updateTopic: (topicId: string, input: { name: string; description: string; order: number }) => Promise<void>;
  deleteTopic: (topicId: string) => Promise<void>;
  clearCourseError: () => void;
}

const CourseContext = createContext<CourseContextValue | null>(null);

function joinedCourseToCourse(j: JoinedCourse): Course {
  return {
    id: j.courseId,
    userId: j.authorId,
    authorId: j.authorId,
    code: j.courseCode,
    name: j.courseName,
    description: j.courseDescription,
    authorName: j.authorName,
    isPublic: true,
    isShared: true,
    isOwner: false,
    joinedAt: j.joinedAt,
    createdAt: j.joinedAt,
    updatedAt: j.updatedAt,
  };
}

const EXTERNAL_COURSE_STORAGE_PREFIX = 'sotal:adminActiveCourse:';

function readStoredExternalCourse(uid: string): Course | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${EXTERNAL_COURSE_STORAGE_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Course>;
    if (!parsed || !parsed.id || !parsed.userId) return null;
    return {
      id: String(parsed.id),
      userId: String(parsed.userId),
      authorId: String(parsed.authorId || parsed.userId),
      code: String(parsed.code ?? ''),
      name: String(parsed.name ?? ''),
      description: String(parsed.description ?? ''),
      isPublic: Boolean(parsed.isPublic),
      shareToken: String(parsed.shareToken ?? ''),
      authorName: String(parsed.authorName ?? ''),
      ownerEmail: String(parsed.ownerEmail ?? ''),
      isOwner: false,
      isShared: false,
      isAdminAccess: true,
      createdAt: null,
      updatedAt: null,
    };
  } catch {
    return null;
  }
}

function writeStoredExternalCourse(uid: string, course: Course | null): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `${EXTERNAL_COURSE_STORAGE_PREFIX}${uid}`;
    if (!course) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({
        id: course.id,
        userId: course.userId,
        authorId: course.authorId || course.userId,
        code: course.code,
        name: course.name,
        description: course.description,
        isPublic: Boolean(course.isPublic),
        shareToken: course.shareToken || '',
        authorName: course.authorName || '',
        ownerEmail: course.ownerEmail || '',
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

export const CourseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, authReady, persistActiveCourseId } = useAuth();
  const [ownedCourses, setOwnedCourses] = useState<Course[]>([]);
  const [joinedRaw, setJoinedRaw] = useState<JoinedCourse[]>([]);
  const [cachedFallbackCourses, setCachedFallbackCourses] = useState<Course[]>([]);
  const [externalActiveCourse, setExternalActiveCourse] = useState<Course | null>(null);
  const [ownedLoaded, setOwnedLoaded] = useState(false);
  const [joinedLoaded, setJoinedLoaded] = useState(false);

  const [activeCourseId, setActiveCourseId] = useState<string>('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);

  // Live status for an active joined shared course
  const [activeMembership, setActiveMembership] = useState<CourseMember | null>(null);
  const [membershipChecked, setMembershipChecked] = useState(false);
  const [activeMemberGroupName, setActiveMemberGroupName] = useState<string | null>(null);
  const [liveSharedMeta, setLiveSharedMeta] = useState<{
    courseId: string;
    code: string;
    name: string;
    description: string;
    authorName: string;
  } | null>(null);

  const coursesLoading = !ownedLoaded || !joinedLoaded;

  // Hydrate from IndexedDB first, then subscribe to live owned + joined Firestore updates
  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setOwnedCourses([]);
      setJoinedRaw([]);
      setCachedFallbackCourses([]);
      setExternalActiveCourse(null);
      setTopics([]);
      setActiveCourseId('');
      setOwnedLoaded(true);
      setJoinedLoaded(true);
      setCourseError(null);
      return;
    }

    let cancelled = false;
    setOwnedLoaded(false);
    setJoinedLoaded(false);
    setCourseError(null);

    const storedExternal = readStoredExternalCourse(user.uid);
    setExternalActiveCourse(storedExternal);
    if (storedExternal) {
      setActiveCourseId(storedExternal.id);
    }

    void (async () => {
      const [cached, cachedActiveId] = await Promise.all([
        getCachedCourses(user.uid),
        getLocalMeta<string>(`activeCourseId:${user.uid}`),
      ]);
      if (!cancelled && cached.length > 0) {
        setCachedFallbackCourses(cached);
        if (!storedExternal && cachedActiveId && cached.some((c) => c.id === cachedActiveId)) {
          setActiveCourseId(cachedActiveId);
        }
      }
    })();

    const unsubOwned = subscribeCourses(
      user.uid,
      (liveCourses) => {
        if (cancelled) return;
        setOwnedCourses(liveCourses);
        setOwnedLoaded(true);
        setCourseError(null);
      },
      (err) => {
        if (cancelled) return;
        setCourseError(formatReadableError(err));
        setOwnedLoaded(true);
      }
    );

    const unsubJoined = subscribeJoinedCourses(
      user.uid,
      (liveJoined) => {
        if (cancelled) return;
        setJoinedRaw(liveJoined);
        setJoinedLoaded(true);
      },
      (err) => {
        if (cancelled) return;
        setCourseError(formatReadableError(err));
        setJoinedLoaded(true);
      }
    );

    return () => {
      cancelled = true;
      unsubOwned();
      unsubJoined();
    };
  }, [authReady, user]);

  const sharedCourses = useMemo(() => {
    const ownedIds = new Set(ownedCourses.map((c) => c.id));
    return joinedRaw
      .filter((j) => !ownedIds.has(j.courseId))
      .map((j) => {
        const mapped = joinedCourseToCourse(j);
        if (liveSharedMeta && liveSharedMeta.courseId === mapped.id) {
          return {
            ...mapped,
            code: liveSharedMeta.code || mapped.code,
            name: liveSharedMeta.name || mapped.name,
            description: liveSharedMeta.description,
            authorName: liveSharedMeta.authorName || mapped.authorName,
          };
        }
        return mapped;
      });
  }, [ownedCourses, joinedRaw, liveSharedMeta]);

  const courses = useMemo(() => {
    if (coursesLoading && ownedCourses.length === 0 && joinedRaw.length === 0) {
      return cachedFallbackCourses;
    }
    const merged = [...ownedCourses, ...sharedCourses];
    merged.sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));
    return merged;
  }, [coursesLoading, ownedCourses, joinedRaw.length, sharedCourses, cachedFallbackCourses]);

  // Cache combined courses to IndexedDB once live snapshots arrive
  useEffect(() => {
    if (!user || coursesLoading) return;
    void cacheUserCourses(user.uid, courses);
  }, [user, coursesLoading, courses]);

  // Keep activeCourseId synchronized with cloud profile and available courses
  useEffect(() => {
    if (!user || coursesLoading) return;

    // Preserve an active admin-accessed Application Course across refreshes
    if (externalActiveCourse && activeCourseId === externalActiveCourse.id) {
      return;
    }

    if (courses.length === 0) {
      if (externalActiveCourse) {
        setActiveCourseId(externalActiveCourse.id);
        return;
      }
      if (activeCourseId !== '') {
        setActiveCourseId('');
      }
      return;
    }

    if (activeCourseId && courses.some((c) => c.id === activeCourseId)) {
      return;
    }

    const preferredId = profile?.activeCourseId || '';
    if (preferredId && courses.some((c) => c.id === preferredId)) {
      setActiveCourseId(preferredId);
      void setLocalMeta(`activeCourseId:${user.uid}`, preferredId);
      return;
    }

    const fallbackId = courses[0].id;
    setActiveCourseId(fallbackId);
    void setLocalMeta(`activeCourseId:${user.uid}`, fallbackId);
  }, [user, profile?.activeCourseId, courses, coursesLoading, activeCourseId, externalActiveCourse]);

  // Keep live Firestore metadata synced when an admin is viewing an external Application Course
  useEffect(() => {
    if (!user || !externalActiveCourse) return;
    const ownerUid = externalActiveCourse.authorId || externalActiveCourse.userId;
    if (!ownerUid || ownerUid === user.uid) return;

    const ref = doc(db, 'users', ownerUid, 'courses', externalActiveCourse.id);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setExternalActiveCourse(null);
          writeStoredExternalCourse(user.uid, null);
          return;
        }
        const data = snap.data();
        setExternalActiveCourse((prev) => {
          if (!prev || prev.id !== snap.id) return prev;
          const next: Course = {
            ...prev,
            code: String(data.code ?? prev.code),
            name: String(data.name ?? prev.name),
            description: String(data.description ?? prev.description),
            isPublic: Boolean(data.isPublic),
            shareToken: String(data.shareToken ?? ''),
            authorName: String(data.authorName ?? prev.authorName ?? ''),
            updatedAt: data.updatedAt ?? prev.updatedAt,
          };
          writeStoredExternalCourse(user.uid, next);
          return next;
        });
      },
      () => {
        // Ignore transient offline or permission errors; leave cached metadata intact
      }
    );

    return () => unsub();
  }, [user, externalActiveCourse?.id, externalActiveCourse?.authorId, externalActiveCourse?.userId]);

  const activeCourse = useMemo(() => {
    if (externalActiveCourse && activeCourseId === externalActiveCourse.id) {
      return externalActiveCourse;
    }
    if (courses.length === 0) return externalActiveCourse ?? null;
    return courses.find((c) => c.id === activeCourseId) ?? courses[0] ?? null;
  }, [courses, activeCourseId, externalActiveCourse]);

  const activeContentOwnerId = useMemo(
    () => getCourseContentOwnerId(activeCourse, user?.uid),
    [activeCourse, user?.uid]
  );

  // Monitor membership + live course details when active course is a shared course
  useEffect(() => {
    if (!user || !activeCourse || !activeCourse.isShared || !activeCourse.authorId) {
      setActiveMembership(null);
      setMembershipChecked(false);
      setActiveMemberGroupName(null);
      setLiveSharedMeta(null);
      return;
    }

    let cancelled = false;
    setMembershipChecked(false);
    setActiveMemberGroupName(null);

    const authorId = activeCourse.authorId;
    const courseId = activeCourse.id;

    const unsubMember = subscribeMemberStatus(authorId, courseId, user.uid, (member) => {
      if (cancelled) return;
      setActiveMembership(member);
      setMembershipChecked(true);
      if (member?.groupId) {
        void fetchCourseGroup(authorId, courseId, member.groupId).then((grp) => {
          if (!cancelled) setActiveMemberGroupName(grp?.name || null);
        });
      } else {
        setActiveMemberGroupName(null);
      }
    });

    const unsubMeta = subscribeLiveSharedCourseMeta(authorId, courseId, (meta) => {
      if (cancelled || !meta) return;
      setLiveSharedMeta({ courseId, ...meta });
      const cachedJoined = joinedRaw.find((j) => j.courseId === courseId);
      if (
        cachedJoined &&
        (cachedJoined.courseCode !== meta.code ||
          cachedJoined.courseName !== meta.name ||
          cachedJoined.courseDescription !== meta.description ||
          (meta.authorName && cachedJoined.authorName !== meta.authorName))
      ) {
        void syncJoinedCourseCache({
          memberUid: user.uid,
          courseId,
          courseCode: meta.code || cachedJoined.courseCode,
          courseName: meta.name || cachedJoined.courseName,
          courseDescription: meta.description,
          authorName: meta.authorName || cachedJoined.authorName,
        });
      }
    });

    return () => {
      cancelled = true;
      unsubMember();
      unsubMeta();
    };
  }, [user, activeCourse?.id, activeCourse?.isShared, activeCourse?.authorId]);

  const activeCourseAccessRevoked = Boolean(
    activeCourse?.isShared && membershipChecked && !activeMembership
  );

  // Subscribe to topics of the active course (using author's UID for shared courses)
  useEffect(() => {
    if (!user || !activeCourse?.id || !activeContentOwnerId) {
      setTopics([]);
      setTopicsLoading(false);
      return;
    }

    if (activeCourseAccessRevoked) {
      setTopics([]);
      setTopicsLoading(false);
      return;
    }

    let cancelled = false;
    setTopicsLoading(true);

    void getCachedTopics(activeCourse.id).then((cached) => {
      if (!cancelled && cached.length > 0) {
        setTopics(cached);
      }
    });

    const unsub = subscribeTopics(
      activeContentOwnerId,
      activeCourse.id,
      (liveTopics) => {
        if (cancelled) return;
        setTopics(liveTopics);
        setTopicsLoading(false);
        void cacheCourseTopics(activeContentOwnerId, activeCourse.id, liveTopics);
      },
      (err) => {
        if (cancelled) return;
        // Suppress permission noise if revocation was just detected
        if (!activeCourse.isShared) {
          setCourseError(formatReadableError(err));
        }
        setTopicsLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [user, activeCourse?.id, activeCourse?.isShared, activeContentOwnerId, activeCourseAccessRevoked]);

  const selectCourse = useCallback(
    async (courseId: string) => {
      if (!user) return;
      setExternalActiveCourse(null);
      writeStoredExternalCourse(user.uid, null);
      setActiveCourseId(courseId);
      await setLocalMeta(`activeCourseId:${user.uid}`, courseId);
      try {
        await persistActiveCourseId(courseId);
      } catch (err) {
        setCourseError(formatReadableError(err));
      }
    },
    [user, persistActiveCourseId]
  );

  const selectExternalCourse = useCallback(
    async (course: Course) => {
      if (!user) return;
      const ownerUid = course.authorId || course.userId;
      if (ownerUid === user.uid) {
        await selectCourse(course.id);
        return;
      }
      const normalized: Course = {
        ...course,
        userId: ownerUid,
        authorId: ownerUid,
        isOwner: false,
        isShared: false,
        isAdminAccess: true,
      };
      setExternalActiveCourse(normalized);
      writeStoredExternalCourse(user.uid, normalized);
      setActiveCourseId(normalized.id);
    },
    [user, selectCourse]
  );

  const updateExternalCourseState = useCallback(
    (updater: (prev: Course | null) => Course | null) => {
      setExternalActiveCourse((prev) => {
        const next = updater(prev);
        if (user) {
          writeStoredExternalCourse(user.uid, next);
        }
        return next;
      });
    },
    [user]
  );

  const clearExternalCourse = useCallback(() => {
    setExternalActiveCourse(null);
    if (user) {
      writeStoredExternalCourse(user.uid, null);
    }
  }, [user]);

  const createCourse = useCallback(
    async (input: { code: string; name: string; description: string }) => {
      if (!user) throw new Error('You must be signed in to create a course.');
      const authorName = profile?.displayName || user.displayName || 'Course Author';
      const created = await createCourseInFirestore(user.uid, { ...input, authorName });
      setExternalActiveCourse(null);
      writeStoredExternalCourse(user.uid, null);
      setActiveCourseId(created.id);
      await setLocalMeta(`activeCourseId:${user.uid}`, created.id);
      void persistActiveCourseId(created.id).catch(() => {});
      return created;
    },
    [user, profile?.displayName, persistActiveCourseId]
  );

  const updateCourse = useCallback(
    async (courseId: string, input: { code: string; name: string; description: string }) => {
      if (!user) throw new Error('You must be signed in to update a course.');
      const target = ownedCourses.find((c) => c.id === courseId);
      if (!target) {
        throw new Error('Only the course author can edit course details.');
      }
      await updateCourseInFirestore(user.uid, courseId, input);
      if (target.shareToken) {
        void syncCourseShareMetadata({
          shareToken: target.shareToken,
          courseCode: input.code,
          courseName: input.name,
          courseDescription: input.description,
          authorName: profile?.displayName || user.displayName || target.authorName || 'Course Author',
        });
      }
    },
    [user, ownedCourses, profile?.displayName]
  );

  const deleteCourse = useCallback(
    async (courseId: string) => {
      if (!user) throw new Error('You must be signed in to delete a course.');
      const target = ownedCourses.find((c) => c.id === courseId);
      if (!target) {
        throw new Error('Only the course author can delete this course.');
      }
      await deleteCourseInFirestore(user.uid, courseId, target.shareToken);
      if (activeCourseId === courseId) {
        const remaining = courses.filter((c) => c.id !== courseId);
        const nextId = remaining[0]?.id ?? '';
        setActiveCourseId(nextId);
        await setLocalMeta(`activeCourseId:${user.uid}`, nextId);
        void persistActiveCourseId(nextId).catch(() => {});
      }
    },
    [user, ownedCourses, activeCourseId, courses, persistActiveCourseId]
  );

  const leaveCourse = useCallback(
    async (courseId: string) => {
      if (!user) throw new Error('You must be signed in to leave a course.');
      const target = sharedCourses.find((c) => c.id === courseId);
      if (!target || !target.authorId) {
        throw new Error('Shared course not found.');
      }
      await leaveSharedCourse({
        memberUid: user.uid,
        authorId: target.authorId,
        courseId,
      });
      if (activeCourseId === courseId) {
        const remaining = courses.filter((c) => c.id !== courseId);
        const nextId = remaining[0]?.id ?? '';
        setActiveCourseId(nextId);
        await setLocalMeta(`activeCourseId:${user.uid}`, nextId);
        void persistActiveCourseId(nextId).catch(() => {});
      }
    },
    [user, sharedCourses, activeCourseId, courses, persistActiveCourseId]
  );

  const setCourseVisibility = useCallback(
    async (courseId: string, isPublic: boolean) => {
      if (!user) throw new Error('You must be signed in to manage course sharing.');
      const target = ownedCourses.find((c) => c.id === courseId);
      if (!target) throw new Error('Only the course author can change visibility.');
      return setCoursePublicVisibility({
        authorId: user.uid,
        authorName: profile?.displayName || user.displayName || 'Course Author',
        course: target,
        isPublic,
      });
    },
    [user, ownedCourses, profile?.displayName]
  );

  const rotateCourseShareLink = useCallback(
    async (courseId: string) => {
      if (!user) throw new Error('You must be signed in to manage course sharing.');
      const target = ownedCourses.find((c) => c.id === courseId);
      if (!target) throw new Error('Only the course author can regenerate the invite link.');
      return regenerateCourseShareToken({
        authorId: user.uid,
        authorName: profile?.displayName || user.displayName || 'Course Author',
        course: target,
      });
    },
    [user, ownedCourses, profile?.displayName]
  );

  const createTopic = useCallback(
    async (input: { name: string; description: string }) => {
      if (!user || !activeCourse) {
        throw new Error('Select a course before creating a topic.');
      }
      if (activeCourse.isShared || activeCourse.isAdminAccess) {
        throw new Error('Only the course author can add topics here.');
      }
      return createTopicInFirestore(user.uid, activeCourse.id, {
        ...input,
        order: topics.length,
      });
    },
    [user, activeCourse, topics.length]
  );

  const updateTopic = useCallback(
    async (topicId: string, input: { name: string; description: string; order: number }) => {
      if (!user || !activeCourse) {
        throw new Error('Select a course before editing a topic.');
      }
      if (activeCourse.isShared || activeCourse.isAdminAccess) {
        throw new Error('Only the course author can edit topics here.');
      }
      await updateTopicInFirestore(user.uid, activeCourse.id, topicId, input);
    },
    [user, activeCourse]
  );

  const deleteTopic = useCallback(
    async (topicId: string) => {
      if (!user || !activeCourse) {
        throw new Error('Select a course before deleting a topic.');
      }
      if (activeCourse.isShared || activeCourse.isAdminAccess) {
        throw new Error('Only the course author can delete topics here.');
      }
      await deleteTopicInFirestore(user.uid, activeCourse.id, topicId);
    },
    [user, activeCourse]
  );

  const clearCourseError = useCallback(() => {
    setCourseError(null);
  }, []);

  return (
    <CourseContext.Provider
      value={{
        courses,
        ownedCourses,
        sharedCourses,
        externalActiveCourse,
        activeCourse,
        activeContentOwnerId,
        activeCourseAccessRevoked,
        activeMemberGroupName,
        topics,
        coursesLoading,
        topicsLoading,
        courseError,
        selectCourse,
        selectExternalCourse,
        updateExternalCourseState,
        clearExternalCourse,
        createCourse,
        updateCourse,
        deleteCourse,
        leaveCourse,
        setCourseVisibility,
        rotateCourseShareLink,
        createTopic,
        updateTopic,
        deleteTopic,
        clearCourseError,
      }}
    >
      {children}
    </CourseContext.Provider>
  );
};

export function useCourses(): CourseContextValue {
  const ctx = useContext(CourseContext);
  if (!ctx) {
    throw new Error('useCourses must be used within CourseProvider');
  }
  return ctx;
}
