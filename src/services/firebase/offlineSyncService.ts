import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import type { Course, StudySource, Topic } from '../../types/models';
import { cacheCourseSources, cacheCourseTopics, cacheUserCourses } from '../local/indexedDb';
import { db } from './config';
import { getCourseContentOwnerId } from './sharedCourseService';

export interface OfflineSyncResult {
  coursesSynced: number;
  sourcesSynced: number;
  savedResourcesSynced: number;
  conversationsSynced: number;
  historySynced: number;
}

/**
 * Actively fetches all course library content, saved study resources, recent Tutor chats,
 * and study history so Firestore's persistent IndexedDB cache (and local IDB mirror)
 * holds a complete offline snapshot ready for studying without internet.
 */
export async function syncCoursesForOffline(
  userId: string,
  courses: Course[],
  onProgress?: (label: string) => void
): Promise<OfflineSyncResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Connect to the internet to sync your courses for offline study.');
  }

  let sourcesSynced = 0;
  let savedResourcesSynced = 0;
  let conversationsSynced = 0;
  let historySynced = 0;

  await cacheUserCourses(userId, courses);

  for (let i = 0; i < courses.length; i += 1) {
    const course = courses[i];
    const contentOwnerId = getCourseContentOwnerId(course, userId) || userId;
    onProgress?.(`Syncing ${course.code} (${i + 1}/${courses.length})...`);

    try {
      // 1. Topics (owned or shared course content owner)
      const topicsSnap = await getDocs(
        query(
          collection(db, 'users', contentOwnerId, 'courses', course.id, 'topics'),
          where('userId', '==', contentOwnerId)
        )
      );
      const topics = topicsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Topic, 'id'>) }));
      await cacheCourseTopics(contentOwnerId, course.id, topics);
    } catch {
      // Continue syncing remaining data even if one subcollection fails
    }

    try {
      // 2. Library Sources (full extracted notes & sections)
      const sourcesSnap = await getDocs(
        query(
          collection(db, 'users', contentOwnerId, 'courses', course.id, 'sources'),
          where('userId', '==', contentOwnerId)
        )
      );
      const sources = sourcesSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<StudySource, 'id'>),
      }));
      sourcesSynced += sources.length;
      await cacheCourseSources(contentOwnerId, course.id, sources);
    } catch {
      // Continue
    }

    try {
      // 3. Personal Saved Materials (flashcards, CBT sets, summaries, custom notes)
      const savedSnap = await getDocs(
        query(
          collection(db, 'users', userId, 'courses', course.id, 'savedMaterials'),
          where('userId', '==', userId)
        )
      );
      savedResourcesSynced += savedSnap.size;
    } catch {
      // Continue
    }

    try {
      // 4. Tutor Conversations + recent messages for each thread
      const convSnap = await getDocs(
        query(
          collection(db, 'users', userId, 'courses', course.id, 'conversations'),
          where('userId', '==', userId),
          orderBy('updatedAt', 'desc'),
          limit(15)
        )
      );
      conversationsSynced += convSnap.size;

      for (const convDoc of convSnap.docs.slice(0, 10)) {
        try {
          await getDocs(
            query(
              collection(
                db,
                'users',
                userId,
                'courses',
                course.id,
                'conversations',
                convDoc.id,
                'messages'
              ),
              where('userId', '==', userId),
              orderBy('createdAt', 'asc')
            )
          );
        } catch {
          // Continue
        }
      }
    } catch {
      // Continue
    }

    try {
      // 5. Study History records
      const historySnap = await getDocs(
        query(
          collection(db, 'users', userId, 'courses', course.id, 'studyHistory'),
          where('userId', '==', userId)
        )
      );
      historySynced += historySnap.size;
    } catch {
      // Continue
    }

    try {
      // 6. Automatic Study sessions + active segments so past guided lessons are readable offline
      const sessionsSnap = await getDocs(
        query(
          collection(db, 'users', userId, 'courses', course.id, 'studySessions'),
          where('userId', '==', userId)
        )
      );
      for (const sessionDoc of sessionsSnap.docs.slice(0, 5)) {
        try {
          await getDocs(
            query(
              collection(
                db,
                'users',
                userId,
                'courses',
                course.id,
                'studySessions',
                sessionDoc.id,
                'segments'
              ),
              where('userId', '==', userId)
            )
          );
        } catch {
          // Continue
        }
      }
    } catch {
      // Continue
    }
  }

  return {
    coursesSynced: courses.length,
    sourcesSynced,
    savedResourcesSynced,
    conversationsSynced,
    historySynced,
  };
}
