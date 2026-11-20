import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Course, Topic } from '../types/models';
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
import { formatReadableError } from '../services/firebase/errors';
import {
  cacheCourseTopics,
  cacheUserCourses,
  getCachedCourses,
  getCachedTopics,
  getLocalMeta,
  setLocalMeta,
} from '../services/local/indexedDb';
import { useAuth } from './AuthContext';

interface CourseContextValue {
  courses: Course[];
  activeCourse: Course | null;
  topics: Topic[];
  coursesLoading: boolean;
  topicsLoading: boolean;
  courseError: string | null;
  selectCourse: (courseId: string) => Promise<void>;
  createCourse: (input: { code: string; name: string; description: string }) => Promise<Course>;
  updateCourse: (courseId: string, input: { code: string; name: string; description: string }) => Promise<void>;
  deleteCourse: (courseId: string) => Promise<void>;
  createTopic: (input: { name: string; description: string }) => Promise<Topic>;
  updateTopic: (topicId: string, input: { name: string; description: string; order: number }) => Promise<void>;
  deleteTopic: (topicId: string) => Promise<void>;
  clearCourseError: () => void;
}

const CourseContext = createContext<CourseContextValue | null>(null);

export const CourseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, authReady, persistActiveCourseId } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [activeCourseId, setActiveCourseId] = useState<string>('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);

  // Hydrate from IndexedDB first, then subscribe to live Firestore updates
  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setCourses([]);
      setTopics([]);
      setActiveCourseId('');
      setCoursesLoading(false);
      setCourseError(null);
      return;
    }

    let cancelled = false;
    setCoursesLoading(true);
    setCourseError(null);

    void (async () => {
      const [cached, cachedActiveId] = await Promise.all([
        getCachedCourses(user.uid),
        getLocalMeta<string>(`activeCourseId:${user.uid}`),
      ]);
      if (!cancelled && cached.length > 0) {
        setCourses(cached);
        if (cachedActiveId && cached.some((c) => c.id === cachedActiveId)) {
          setActiveCourseId(cachedActiveId);
        }
      }
    })();

    const unsub = subscribeCourses(
      user.uid,
      (liveCourses) => {
        if (cancelled) return;
        setCourses(liveCourses);
        setCoursesLoading(false);
        setCourseError(null);
        void cacheUserCourses(user.uid, liveCourses);
      },
      (err) => {
        if (cancelled) return;
        setCourseError(formatReadableError(err));
        setCoursesLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [authReady, user]);

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

  // Subscribe to topics of the active course with IndexedDB hydration
  useEffect(() => {
    if (!user || !activeCourseId) {
      setTopics([]);
      setTopicsLoading(false);
      return;
    }

    let cancelled = false;
    setTopicsLoading(true);

    void getCachedTopics(activeCourseId).then((cached) => {
      if (!cancelled && cached.length > 0) {
        setTopics(cached);
      }
    });

    const unsub = subscribeTopics(
      user.uid,
      activeCourseId,
      (liveTopics) => {
        if (cancelled) return;
        setTopics(liveTopics);
        setTopicsLoading(false);
        void cacheCourseTopics(user.uid, activeCourseId, liveTopics);
      },
      (err) => {
        if (cancelled) return;
        setCourseError(formatReadableError(err));
        setTopicsLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [user, activeCourseId]);

  const activeCourse = useMemo(() => {
    if (courses.length === 0) return null;
    return courses.find((c) => c.id === activeCourseId) ?? courses[0] ?? null;
  }, [courses, activeCourseId]);

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
      const created = await createCourseInFirestore(user.uid, input);
      setActiveCourseId(created.id);
      await setLocalMeta(`activeCourseId:${user.uid}`, created.id);
      void persistActiveCourseId(created.id).catch(() => {});
      return created;
    },
    [user, persistActiveCourseId]
  );

  const updateCourse = useCallback(
    async (courseId: string, input: { code: string; name: string; description: string }) => {
      if (!user) throw new Error('You must be signed in to update a course.');
      await updateCourseInFirestore(user.uid, courseId, input);
    },
    [user]
  );

  const deleteCourse = useCallback(
    async (courseId: string) => {
      if (!user) throw new Error('You must be signed in to delete a course.');
      await deleteCourseInFirestore(user.uid, courseId);
      if (activeCourseId === courseId) {
        const remaining = courses.filter((c) => c.id !== courseId);
        const nextId = remaining[0]?.id ?? '';
        setActiveCourseId(nextId);
        await setLocalMeta(`activeCourseId:${user.uid}`, nextId);
        void persistActiveCourseId(nextId).catch(() => {});
      }
    },
    [user, activeCourseId, courses, persistActiveCourseId]
  );

  const createTopic = useCallback(
    async (input: { name: string; description: string }) => {
      if (!user || !activeCourseId) {
        throw new Error('Select a course before creating a topic.');
      }
      return createTopicInFirestore(user.uid, activeCourseId, {
        ...input,
        order: topics.length,
      });
    },
    [user, activeCourseId, topics.length]
  );

  const updateTopic = useCallback(
    async (topicId: string, input: { name: string; description: string; order: number }) => {
      if (!user || !activeCourseId) {
        throw new Error('Select a course before editing a topic.');
      }
      await updateTopicInFirestore(user.uid, activeCourseId, topicId, input);
    },
    [user, activeCourseId]
  );

  const deleteTopic = useCallback(
    async (topicId: string) => {
      if (!user || !activeCourseId) {
        throw new Error('Select a course before deleting a topic.');
      }
      await deleteTopicInFirestore(user.uid, activeCourseId, topicId);
    },
    [user, activeCourseId]
  );

  const clearCourseError = useCallback(() => {
    setCourseError(null);
  }, []);

  return (
    <CourseContext.Provider
      value={{
        courses,
        activeCourse,
        topics,
        coursesLoading,
        topicsLoading,
        courseError,
        selectCourse,
        createCourse,
        updateCourse,
        deleteCourse,
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
