import type { Course, MaterialType, ProcessingStatus, StudySection, StudySource, Topic } from '../../types/models';
import { timestampToMillis } from '../../utils/validation';

const DB_NAME = 'sotal_study_local_v1';
const DB_VERSION = 4;

export type LocalStoreName =
  | 'courses'
  | 'topics'
  | 'sources'
  | 'studySessions'
  | 'drafts'
  | 'meta'
  | 'tutorAudio'
  | 'pendingIngestions';

export type BackgroundIngestionStatus =
  | 'queued'
  | 'extracting'
  | 'saving'
  | 'ready_for_review'
  | 'completed'
  | 'failed';

export interface PendingIngestionOptions {
  overrideType?: MaterialType;
  visionMode?: 'handwriting' | 'textbook_photo' | 'scanned_doc' | 'page_image_fallback' | 'general';
  startPage?: number;
  endPage?: number;
  enableScannedOcr?: boolean;
}

export interface PendingIngestionExtractedResult {
  title: string;
  materialType: MaterialType;
  extractedContent: string;
  sections: StudySection[];
  pageOrSlideCount: number;
  processingStatus: ProcessingStatus;
  originalFileName: string;
  uncertainCount: number;
  usedVision: boolean;
  warnings: string[];
}

export interface PendingIngestionRecord {
  id: string;
  userId: string;
  courseId: string;
  topicId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  title: string;
  materialType: MaterialType;
  /** Raw uploaded File/Blob temporarily persisted locally until background extraction completes or is cancelled */
  fileBlob: Blob | null;
  options: PendingIngestionOptions;
  status: BackgroundIngestionStatus;
  progressPercent: number;
  progressStage: string;
  /** When true (modal hidden/backgrounded), extraction auto-saves to Firestore and clears the temp local file */
  autoSaveWhenDone: boolean;
  extractedResult?: PendingIngestionExtractedResult | null;
  savedSourceId?: string | null;
  error?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

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

export interface CachedTutorAudio {
  messageId: string;
  userId: string;
  courseId: string;
  conversationId: string;
  voiceName: string;
  mimeType: string;
  audioBlob: Blob;
  byteLength: number;
  createdAtMs: number;
  lastAccessedAtMs: number;
}

const MAX_CACHED_AUDIO_CLIPS = 200;
const MAX_CACHED_AUDIO_BYTES = 120 * 1024 * 1024; // 120 MB browser cap with LRU pruning

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
        if (!db.objectStoreNames.contains('tutorAudio')) {
          const store = db.createObjectStore('tutorAudio', { keyPath: 'messageId' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('conversationId', 'conversationId', { unique: false });
          store.createIndex('lastAccessedAtMs', 'lastAccessedAtMs', { unique: false });
        }
        if (!db.objectStoreNames.contains('pendingIngestions')) {
          const store = db.createObjectStore('pendingIngestions', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('courseId', 'courseId', { unique: false });
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

export async function saveCachedTutorAudio(params: {
  messageId: string;
  userId: string;
  courseId: string;
  conversationId: string;
  voiceName: string;
  mimeType: string;
  audioBlob: Blob;
}): Promise<void> {
  const db = await openDatabase();
  if (!db || !params.messageId) return;

  const now = Date.now();
  const record: CachedTutorAudio = {
    messageId: params.messageId,
    userId: params.userId,
    courseId: params.courseId,
    conversationId: params.conversationId,
    voiceName: params.voiceName,
    mimeType: params.mimeType || params.audioBlob.type || 'audio/wav',
    audioBlob: params.audioBlob,
    byteLength: params.audioBlob.size,
    createdAtMs: now,
    lastAccessedAtMs: now,
  };

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction('tutorAudio', 'readwrite');
      tx.objectStore('tutorAudio').put(record);
      tx.oncomplete = () => {
        notifyCacheSync();
        resolve();
      };
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });

  void pruneCachedTutorAudio(db);
}

async function pruneCachedTutorAudio(db: IDBDatabase): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction('tutorAudio', 'readwrite');
      const store = tx.objectStore('tutorAudio');
      const req = store.getAll();

      req.onsuccess = () => {
        const rows = (req.result as CachedTutorAudio[]) || [];
        let totalBytes = rows.reduce((sum, r) => sum + (r.byteLength || r.audioBlob?.size || 0), 0);
        if (rows.length <= MAX_CACHED_AUDIO_CLIPS && totalBytes <= MAX_CACHED_AUDIO_BYTES) {
          return;
        }
        // Evict least-recently-accessed clips first
        const sorted = [...rows].sort((a, b) => (a.lastAccessedAtMs || 0) - (b.lastAccessedAtMs || 0));
        let remainingCount = rows.length;
        for (const item of sorted) {
          if (remainingCount <= MAX_CACHED_AUDIO_CLIPS && totalBytes <= MAX_CACHED_AUDIO_BYTES) {
            break;
          }
          store.delete(item.messageId);
          remainingCount -= 1;
          totalBytes -= item.byteLength || item.audioBlob?.size || 0;
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Non-fatal LRU cleanup error
  }
}

export async function getCachedTutorAudio(messageId: string): Promise<CachedTutorAudio | null> {
  const db = await openDatabase();
  if (!db || !messageId) return null;

  const record = await new Promise<CachedTutorAudio | null>((resolve) => {
    try {
      const tx = db.transaction('tutorAudio', 'readonly');
      const req = tx.objectStore('tutorAudio').get(messageId);
      req.onsuccess = () => resolve((req.result as CachedTutorAudio) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  if (record && record.audioBlob instanceof Blob && record.audioBlob.size > 0) {
    // Refresh LRU timestamp asynchronously without delaying playback
    try {
      const tx = db.transaction('tutorAudio', 'readwrite');
      tx.objectStore('tutorAudio').put({
        ...record,
        lastAccessedAtMs: Date.now(),
      });
    } catch {
      // Ignore non-fatal LRU update error
    }
    return record;
  }

  return null;
}

export async function getCachedTutorAudioIdsForConversation(
  conversationId: string
): Promise<Set<string>> {
  const db = await openDatabase();
  if (!db || !conversationId) return new Set();

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('tutorAudio', 'readonly');
      const index = tx.objectStore('tutorAudio').index('conversationId');
      const req = index.getAllKeys(IDBKeyRange.only(conversationId));
      req.onsuccess = () => {
        const keys = (req.result as string[]) || [];
        resolve(new Set(keys));
      };
      req.onerror = () => resolve(new Set());
    } catch {
      resolve(new Set());
    }
  });
}

export async function deleteCachedTutorAudioByConversation(
  conversationId: string
): Promise<void> {
  const db = await openDatabase();
  if (!db || !conversationId) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('tutorAudio', 'readwrite');
      const store = tx.objectStore('tutorAudio');
      const index = store.index('conversationId');
      const req = index.getAllKeys(IDBKeyRange.only(conversationId));
      req.onsuccess = () => {
        for (const key of req.result) {
          store.delete(key);
        }
      };
      tx.oncomplete = () => {
        notifyCacheSync();
        resolve();
      };
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getLocalCacheStats(userId: string): Promise<{
  cachedCourses: number;
  cachedTopics: number;
  cachedSources: number;
  cachedDrafts: number;
  cachedAudioClips: number;
}> {
  const db = await openDatabase();
  if (!db) {
    return {
      cachedCourses: 0,
      cachedTopics: 0,
      cachedSources: 0,
      cachedDrafts: 0,
      cachedAudioClips: 0,
    };
  }

  return new Promise((resolve) => {
    const tx = db.transaction(
      ['courses', 'topics', 'sources', 'drafts', 'tutorAudio'],
      'readonly'
    );
    let cachedCourses = 0;
    let cachedTopics = 0;
    let cachedSources = 0;
    let cachedDrafts = 0;
    let cachedAudioClips = 0;

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

    const aStore = tx.objectStore('tutorAudio');
    const aReq = aStore.indexNames.contains('userId')
      ? aStore.index('userId').count(IDBKeyRange.only(userId))
      : aStore.count();
    aReq.onsuccess = () => {
      cachedAudioClips = aReq.result;
    };

    tx.oncomplete = () =>
      resolve({ cachedCourses, cachedTopics, cachedSources, cachedDrafts, cachedAudioClips });
    tx.onerror = () =>
      resolve({
        cachedCourses: 0,
        cachedTopics: 0,
        cachedSources: 0,
        cachedDrafts: 0,
        cachedAudioClips: 0,
      });
  });
}

export async function savePendingIngestion(record: PendingIngestionRecord): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('pendingIngestions', 'readwrite');
      tx.objectStore('pendingIngestions').put(record);
      tx.oncomplete = () => {
        notifyCacheSync();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('Failed to persist temporary local file.'));
      tx.onabort = () => reject(tx.error ?? new Error('Temporary local file save was aborted.'));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function updatePendingIngestion(
  id: string,
  patch: Partial<PendingIngestionRecord>
): Promise<void> {
  const db = await openDatabase();
  if (!db || !id) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('pendingIngestions', 'readwrite');
      const store = tx.objectStore('pendingIngestions');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as PendingIngestionRecord | undefined;
        if (!existing) return;
        store.put({
          ...existing,
          ...patch,
          updatedAtMs: Date.now(),
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getPendingIngestion(id: string): Promise<PendingIngestionRecord | null> {
  const db = await openDatabase();
  if (!db || !id) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('pendingIngestions', 'readonly');
      const req = tx.objectStore('pendingIngestions').get(id);
      req.onsuccess = () => resolve((req.result as PendingIngestionRecord) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getPendingIngestionsForUser(
  userId: string
): Promise<PendingIngestionRecord[]> {
  const db = await openDatabase();
  if (!db || !userId) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('pendingIngestions', 'readonly');
      const index = tx.objectStore('pendingIngestions').index('userId');
      const req = index.getAll(IDBKeyRange.only(userId));
      req.onsuccess = () => {
        const rows = (req.result as PendingIngestionRecord[]) || [];
        resolve(rows.sort((a, b) => a.createdAtMs - b.createdAtMs));
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function deletePendingIngestion(id: string): Promise<void> {
  const db = await openDatabase();
  if (!db || !id) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('pendingIngestions', 'readwrite');
      tx.objectStore('pendingIngestions').delete(id);
      tx.oncomplete = () => {
        notifyCacheSync();
        resolve();
      };
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearLocalCache(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve) => {
    const storeNames: LocalStoreName[] = [
      'courses',
      'topics',
      'sources',
      'studySessions',
      'drafts',
      'meta',
      'tutorAudio',
      'pendingIngestions',
    ];
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
