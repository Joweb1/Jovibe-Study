import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Course, CourseMember, JoinedCourse, Topic } from '../types/models';
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
  activeCourse: Course | null;
  activeContentOwnerId: string | undefined;
  activeCourseAccessRevoked: boolean;
  activeMemberGroupName: string | null;
  topics: Topic[];
  coursesLoading: boolean;
  topicsLoading: boolean;
  courseError: string | null;
  selectCourse: (courseId: string) => Promise<void>;
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

export const CourseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, authReady, persistActiveCourseId } = useAuth();
  const [ownedCourses, setOwnedCourses] = useState<Course[]>([]);
  const [joinedRaw, setJoinedRaw] = useState<JoinedCourse[]>([]);
  const [cachedFallbackCourses, setCachedFallbackCourses] = useState<Course[]>([]);
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

    void (async () => {
      const [cached, cachedActiveId] = await Promise.all([
        getCachedCourses(user.uid),
        getLocalMeta<string>(`activeCourseId:${user.uid}`),
      ]);
      if (!cancelled && cached.length > 0) {
        setCachedFallbackCourses(cached);
        if (cachedActiveId && cached.some((c) => c.id === cachedActiveId)) {
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

    if (courses.length === 0) {
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
  }, [user, profile?.activeCourseId, courses, coursesLoading, activeCourseId]);

  const activeCourse = useMemo(() => {
    if (courses.length === 0) return null;
    return courses.find((c) => c.id === activeCourseId) ?? courses[0] ?? null;
  }, [courses, activeCourseId]);

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

  const createCourse = useCallback(
    async (input: { code: string; name: string; description: string }) => {
      if (!user) throw new Error('You must be signed in to create a course.');
      const authorName = profile?.displayName || user.displayName || 'Course Author';
      const created = await createCourseInFirestore(user.uid, { ...input, authorName });
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
      if (activeCourse.isShared) {
        throw new Error('Only the course author can add topics to a shared course.');
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
      if (activeCourse.isShared) {
        throw new Error('Only the course author can edit topics in a shared course.');
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
      if (activeCourse.isShared) {
        throw new Error('Only the course author can delete topics in a shared course.');
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
        activeCourse,
        activeContentOwnerId,
        activeCourseAccessRevoked,
        activeMemberGroupName,
        topics,
        coursesLoading,
        topicsLoading,
        courseError,
        selectCourse,
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
