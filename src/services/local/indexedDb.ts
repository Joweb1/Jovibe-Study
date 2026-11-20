import type { Course, MaterialType, ProcessingStatus, StudySection, StudySource, Topic } from '../../types/models';
import { timestampToMillis } from '../../utils/validation';

const DB_NAME = 'sotal_study_local_v1';
const DB_VERSION = 2;

export type LocalStoreName = 'courses' | 'topics' | 'sources' | 'studySessions' | 'drafts' | 'meta';

export interface CachedCourse {
  id: string;
  userId: string;
  code: string;
  name: string;
  description: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface CachedTopic {
  id: string;
  userId: string;
  courseId: string;
  name: string;
  description: string;
  order: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface CachedSource {
  id: string;
  userId: string;
  courseId: string;
  topicId: string;
  title: string;
  materialType: MaterialType;
  extractedContent: string;
  sections: StudySection[];
  pageOrSlideCount: number;
  processingStatus: ProcessingStatus;
  studentNotes: string;
  originalFileName: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface LocalDraft {
  key: string;
  userId: string;
  payload: Record<string, unknown>;
  updatedAtMs: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
let lastCacheSyncAt: number | null = null;
const cacheSyncListeners = new Set<() => void>();

function notifyCacheSync(): void {
  lastCacheSyncAt = Date.now();
  cacheSyncListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore subscriber errors
    }
  });
}

export function getLastCacheSyncAt(): number | null {
  return lastCacheSyncAt;
}

export function subscribeLocalCacheSync(listener: () => void): () => void {
  cacheSyncListeners.add(listener);
  return () => {
    cacheSyncListeners.delete(listener);
  };
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        const tx = request.transaction;

        if (!db.objectStoreNames.contains('courses')) {
          const store = db.createObjectStore('courses', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        }
        if (!db.objectStoreNames.contains('topics')) {
          const store = db.createObjectStore('topics', { keyPath: 'id' });
          store.createIndex('courseId', 'courseId', { unique: false });
          store.createIndex('userId', 'userId', { unique: false });
        }
        if (!db.objectStoreNames.contains('sources')) {
          const store = db.createObjectStore('sources', { keyPath: 'id' });
          store.createIndex('courseId', 'courseId', { unique: false });
          store.createIndex('userId', 'userId', { unique: false });
        } else if (tx) {
          const store = tx.objectStore('sources');
          if (!store.indexNames.contains('userId')) {
            store.createIndex('userId', 'userId', { unique: false });
          }
        }
        if (!db.objectStoreNames.contains('studySessions')) {
          const store = db.createObjectStore('studySessions', { keyPath: 'id' });
          store.createIndex('courseId', 'courseId', { unique: false });
        }
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('IndexedDB unavailable; running without local cache.');
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

export async function cacheUserCourses(userId: string, courses: Course[]): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve) => {
    const tx = db.transaction('courses', 'readwrite');
    const store = tx.objectStore('courses');
    const index = store.index('userId');
    const range = IDBKeyRange.only(userId);

    const existingReq = index.getAllKeys(range);
    existingReq.onsuccess = () => {
      for (const key of existingReq.result) {
        store.delete(key);
      }
      for (const course of courses) {
        const record: CachedCourse = {
          id: course.id,
          userId: course.userId,
          code: course.code,
          name: course.name,
          description: course.description,
          createdAtMs: timestampToMillis(course.createdAt),
          updatedAtMs: timestampToMillis(course.updatedAt),
        };
        store.put(record);
      }
    };

    tx.oncomplete = () => {
      notifyCacheSync();
      resolve();
    };
    tx.onerror = () => resolve();
  });
}

export async function getCachedCourses(userId: string): Promise<Course[]> {
  const db = await openDatabase();
  if (!db) return [];

  return new Promise((resolve) => {
    const tx = db.transaction('courses', 'readonly');
    const store = tx.objectStore('courses');
    const index = store.index('userId');
    const req = index.getAll(IDBKeyRange.only(userId));

    req.onsuccess = () => {
      const rows = (req.result as CachedCourse[]) || [];
      resolve(
        rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          code: r.code,
          name: r.name,
          description: r.description,
          createdAt: r.createdAtMs || null,
          updatedAt: r.updatedAtMs || null,
        }))
      );
    };
    req.onerror = () => resolve([]);
  });
}

export async function cacheCourseTopics(userId: string, courseId: string, topics: Topic[]): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve) => {
    const tx = db.transaction('topics', 'readwrite');
    const store = tx.objectStore('topics');
    const index = store.index('courseId');
    const existingReq = index.getAllKeys(IDBKeyRange.only(courseId));

    existingReq.onsuccess = () => {
      for (const key of existingReq.result) {
        store.delete(key);
      }
      for (const topic of topics) {
        const record: CachedTopic = {
          id: topic.id,
          userId,
          courseId: topic.courseId,
          name: topic.name,
          description: topic.description,
          order: topic.order,
          createdAtMs: timestampToMillis(topic.createdAt),
          updatedAtMs: timestampToMillis(topic.updatedAt),
        };
        store.put(record);
      }
    };

    tx.oncomplete = () => {
      notifyCacheSync();
      resolve();
    };
    tx.onerror = () => resolve();
  });
}

export async function getCachedTopics(courseId: string): Promise<Topic[]> {
  const db = await openDatabase();
  if (!db) return [];

  return new Promise((resolve) => {
    const tx = db.transaction('topics', 'readonly');
    const store = tx.objectStore('topics');
    const index = store.index('courseId');
    const req = index.getAll(IDBKeyRange.only(courseId));

    req.onsuccess = () => {
      const rows = (req.result as CachedTopic[]) || [];
      resolve(
        rows
          .sort((a, b) => a.order - b.order)
          .map((r) => ({
            id: r.id,
            userId: r.userId,
            courseId: r.courseId,
            name: r.name,
            description: r.description,
            order: r.order,
            createdAt: r.createdAtMs || null,
            updatedAt: r.updatedAtMs || null,
          }))
      );
    };
    req.onerror = () => resolve([]);
  });
}

export async function cacheCourseSources(
  userId: string,
  courseId: string,
  sources: StudySource[]
): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve) => {
    const tx = db.transaction('sources', 'readwrite');
    const store = tx.objectStore('sources');
    const index = store.index('courseId');
    const existingReq = index.getAllKeys(IDBKeyRange.only(courseId));

    existingReq.onsuccess = () => {
      for (const key of existingReq.result) {
        store.delete(key);
      }
      for (const src of sources) {
        const record: CachedSource = {
          id: src.id,
          userId,
          courseId: src.courseId,
          topicId: src.topicId,
          title: src.title,
          materialType: src.materialType,
          extractedContent: src.extractedContent,
          sections: src.sections,
          pageOrSlideCount: src.pageOrSlideCount,
          processingStatus: src.processingStatus,
          studentNotes: src.studentNotes,
          originalFileName: src.originalFileName,
          createdAtMs: timestampToMillis(src.createdAt),
          updatedAtMs: timestampToMillis(src.updatedAt),
        };
        store.put(record);
      }
    };

    tx.oncomplete = () => {
      notifyCacheSync();
      resolve();
    };
    tx.onerror = () => resolve();
  });
}

export async function getCachedSources(courseId: string): Promise<StudySource[]> {
  const db = await openDatabase();
  if (!db) return [];

  return new Promise((resolve) => {
    const tx = db.transaction('sources', 'readonly');
    const store = tx.objectStore('sources');
    const index = store.index('courseId');
    const req = index.getAll(IDBKeyRange.only(courseId));

    req.onsuccess = () => {
      const rows = (req.result as CachedSource[]) || [];
      resolve(
        rows
          .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
          .map((r) => ({
            id: r.id,
            userId: r.userId,
            courseId: r.courseId,
            topicId: r.topicId,
            title: r.title,
            materialType: r.materialType,
            extractedContent: r.extractedContent,
            sections: r.sections || [],
            pageOrSlideCount: r.pageOrSlideCount || 0,
            processingStatus: r.processingStatus || 'ready',
            studentNotes: r.studentNotes || '',
            originalFileName: r.originalFileName || '',
            createdAt: r.createdAtMs || null,
            updatedAt: r.updatedAtMs || null,
          }))
      );
    };
    req.onerror = () => resolve([]);
  });
}

export async function setLocalMeta(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value, updatedAtMs: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function getLocalMeta<T>(key: string): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = () => {
      const row = req.result as { key: string; value: T } | undefined;
      resolve(row ? row.value : null);
    };
    req.onerror = () => resolve(null);
  });
}

export async function saveLocalDraft(draft: LocalDraft): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve) => {
    const tx = db.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').put(draft);
    tx.oncomplete = () => {
      notifyCacheSync();
      resolve();
    };
    tx.onerror = () => resolve();
  });
}

export async function getLocalDraft(key: string): Promise<LocalDraft | null> {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    const tx = db.transaction('drafts', 'readonly');
    const req = tx.objectStore('drafts').get(key);
    req.onsuccess = () => resolve((req.result as LocalDraft) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function deleteLocalDraft(key: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve) => {
    const tx = db.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').delete(key);
    tx.oncomplete = () => {
      notifyCacheSync();
      resolve();
    };
    tx.onerror = () => resolve();
  });
}

export async function getLocalCacheStats(userId: string): Promise<{
  cachedCourses: number;
  cachedTopics: number;
  cachedSources: number;
  cachedDrafts: number;
}> {
  const db = await openDatabase();
  if (!db) return { cachedCourses: 0, cachedTopics: 0, cachedSources: 0, cachedDrafts: 0 };

  return new Promise((resolve) => {
    const tx = db.transaction(['courses', 'topics', 'sources', 'drafts'], 'readonly');
    let cachedCourses = 0;
    let cachedTopics = 0;
    let cachedSources = 0;
    let cachedDrafts = 0;

    const cReq = tx.objectStore('courses').index('userId').count(IDBKeyRange.only(userId));
    cReq.onsuccess = () => {
      cachedCourses = cReq.result;
    };

    const tReq = tx.objectStore('topics').index('userId').count(IDBKeyRange.only(userId));
    tReq.onsuccess = () => {
      cachedTopics = tReq.result;
    };

    const sStore = tx.objectStore('sources');
    const sReq = sStore.indexNames.contains('userId')
      ? sStore.index('userId').count(IDBKeyRange.only(userId))
      : sStore.count();
    sReq.onsuccess = () => {
      cachedSources = sReq.result;
    };

    const dReq = tx.objectStore('drafts').count();
    dReq.onsuccess = () => {
      cachedDrafts = dReq.result;
    };

    tx.oncomplete = () => resolve({ cachedCourses, cachedTopics, cachedSources, cachedDrafts });
    tx.onerror = () => resolve({ cachedCourses: 0, cachedTopics: 0, cachedSources: 0, cachedDrafts: 0 });
  });
}

export async function clearLocalCache(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve) => {
    const storeNames: LocalStoreName[] = ['courses', 'topics', 'sources', 'studySessions', 'drafts', 'meta'];
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => {
      notifyCacheSync();
      resolve();
    };
    tx.onerror = () => resolve();
  });
}
