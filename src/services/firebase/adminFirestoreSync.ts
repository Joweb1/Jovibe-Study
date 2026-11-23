import {
  collection,
  getDocsFromServer,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';
import type { FirebaseSyncStatus } from '../../components/admin/adminTypes';
import { apiFetchJson } from '../api/authHeaders';
import { db } from './config';

interface SnapshotUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  createdAtMs: number;
  updatedAtMs: number;
}

interface SnapshotCourse {
  uid: string;
  courseId: string;
  code: string;
  name: string;
  description: string;
  isPublic: boolean;
  shareToken: string;
  authorName: string;
  createdAtMs: number;
  updatedAtMs: number;
}

interface SnapshotMaterial {
  uid: string;
  courseId: string;
  sourceId: string;
  title: string;
  materialType: string;
  pageCount: number;
  originalFileName: string;
  contentPreview: string;
  createdAtMs: number;
  updatedAtMs: number;
}

interface SnapshotGroup {
  id: string;
  authorUid: string;
  authorEmail: string;
  authorName: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  name: string;
  description: string;
  shareToken: string;
  createdAtMs: number;
  updatedAtMs: number;
  members: Array<{
    uid: string;
    displayName: string;
    photoURL: string;
    joinedAtMs: number;
  }>;
}

function toMillis(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (value && typeof value === 'object') {
    const maybeTs = value as { toMillis?: () => number; seconds?: number };
    if (typeof maybeTs.toMillis === 'function') {
      const ms = maybeTs.toMillis();
      if (Number.isFinite(ms) && ms > 0) return Math.floor(ms);
    }
    if (typeof maybeTs.seconds === 'number' && Number.isFinite(maybeTs.seconds)) {
      return Math.floor(maybeTs.seconds * 1000);
    }
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return fallback;
}

function safeDocs(snap: { docs: QueryDocumentSnapshot<DocumentData>[] }): QueryDocumentSnapshot<DocumentData>[] {
  return Array.isArray(snap?.docs) ? snap.docs : [];
}

/**
 * Directly queries Firestore via the authenticated admin's Firebase Web SDK
 * (`getDocsFromServer` to bypass stale IndexedDB cache) and pushes the snapshot
 * to the server Admin SQLite DB. This ensures all users, courses, materials,
 * groups, and members in Firestore are visible immediately even when no
 * Service Account JSON is configured on the server.
 */
export async function syncAllUsersFromClientFirestore(): Promise<FirebaseSyncStatus> {
  const now = Date.now();
  const usersMap = new Map<string, SnapshotUser>();
  const courses: SnapshotCourse[] = [];
  const materials: SnapshotMaterial[] = [];
  const groups: SnapshotGroup[] = [];

  try {
    // 1. List all /users profile documents directly from Firestore server
    const usersSnap = await getDocsFromServer(collection(db, 'users'));
    for (const docSnap of safeDocs(usersSnap)) {
      const data = docSnap.data() || {};
      const uid = String(data.userId || docSnap.id || '').trim();
      if (!uid) continue;
      const email = String(data.email || '').trim().toLowerCase();
      const displayName = String(data.displayName || email.split('@')[0] || 'Student').slice(0, 120);
      const photoURL = String(data.photoURL || '').slice(0, 500);
      const createdAtMs = toMillis(data.createdAt, now);
      const updatedAtMs = toMillis(data.updatedAt, createdAtMs);
      usersMap.set(uid, {
        uid,
        email,
        displayName,
        photoURL,
        createdAtMs,
        updatedAtMs,
      });
    }

    // 2. Also discover any course authors from top-level /courseShares who may be missing /users/{uid}
    try {
      const sharesSnap = await getDocsFromServer(collection(db, 'courseShares'));
      for (const shareDoc of safeDocs(sharesSnap)) {
        const data = shareDoc.data() || {};
        const authorId = String(data.authorId || '').trim();
        if (authorId && !usersMap.has(authorId)) {
          const createdAtMs = toMillis(data.createdAt, now);
          const updatedAtMs = toMillis(data.updatedAt, createdAtMs);
          usersMap.set(authorId, {
            uid: authorId,
            email: '',
            displayName: String(data.authorName || 'Student').slice(0, 120),
            photoURL: '',
            createdAtMs,
            updatedAtMs,
          });
        }
      }
    } catch {
      // Non-fatal if courseShares is empty or restricted
    }

    // 3. For each discovered user, fetch courses, sources, groups, and members
    const initialUids = Array.from(usersMap.keys());
    for (const uid of initialUids) {
      const userInfo = usersMap.get(uid)!;
      let coursesSnap;
      try {
        coursesSnap = await getDocsFromServer(collection(db, 'users', uid, 'courses'));
      } catch {
        continue;
      }

      for (const courseDoc of safeDocs(coursesSnap)) {
        const c = courseDoc.data() || {};
        const courseId = courseDoc.id;
        const code = String(c.code || '').slice(0, 32);
        const name = String(c.name || '').slice(0, 120);
        const description = String(c.description || '').slice(0, 1000);
        const isPublic = Boolean(c.isPublic);
        const shareToken = String(c.shareToken || '').slice(0, 128);
        const authorName = String(c.authorName || userInfo.displayName || 'Student').slice(0, 120);
        const createdAtMs = toMillis(c.createdAt, now);
        const updatedAtMs = toMillis(c.updatedAt, createdAtMs);

        courses.push({
          uid,
          courseId,
          code,
          name,
          description,
          isPublic,
          shareToken,
          authorName,
          createdAtMs,
          updatedAtMs,
        });

        // Fetch course sources, groups, and members in parallel
        const [sourcesRes, groupsRes, membersRes] = await Promise.allSettled([
          getDocsFromServer(collection(db, 'users', uid, 'courses', courseId, 'sources')),
          getDocsFromServer(collection(db, 'users', uid, 'courses', courseId, 'groups')),
          getDocsFromServer(collection(db, 'users', uid, 'courses', courseId, 'members')),
        ]);

        if (sourcesRes.status === 'fulfilled') {
          for (const sourceDoc of safeDocs(sourcesRes.value)) {
            const s = sourceDoc.data() || {};
            const sCreated = toMillis(s.createdAt, now);
            const sUpdated = toMillis(s.updatedAt, sCreated);
            materials.push({
              uid,
              courseId,
              sourceId: sourceDoc.id,
              title: String(s.title || 'Untitled').slice(0, 200),
              materialType: String(s.materialType || 'other').slice(0, 40),
              pageCount: Math.max(0, Math.floor(Number(s.pageOrSlideCount) || 0)),
              originalFileName: String(s.originalFileName || '').slice(0, 260),
              contentPreview: String(s.extractedContent || '').slice(0, 400),
              createdAtMs: sCreated,
              updatedAtMs: sUpdated,
            });
          }
        }

        const memberRows: Array<{
          uid: string;
          displayName: string;
          photoURL: string;
          groupId: string;
          joinedAtMs: number;
        }> = [];

        if (membersRes.status === 'fulfilled') {
          for (const mDoc of safeDocs(membersRes.value)) {
            const m = mDoc.data() || {};
            const memberUid = String(m.memberUid || mDoc.id || '').trim();
            if (!memberUid) continue;
            const joinedAtMs = toMillis(m.joinedAt, now);
            const memberDisplayName = String(m.displayName || 'Student').slice(0, 120);
            const memberPhoto = String(m.photoURL || '').slice(0, 500);
            memberRows.push({
              uid: memberUid,
              displayName: memberDisplayName,
              photoURL: memberPhoto,
              groupId: String(m.groupId || ''),
              joinedAtMs,
            });

            // Discover users who joined courses even if their /users/{uid} doc wasn't created
            if (!usersMap.has(memberUid)) {
              usersMap.set(memberUid, {
                uid: memberUid,
                email: '',
                displayName: memberDisplayName,
                photoURL: memberPhoto,
                createdAtMs: joinedAtMs,
                updatedAtMs: toMillis(m.updatedAt, joinedAtMs),
              });
            }
          }
        }

        if (groupsRes.status === 'fulfilled') {
          for (const gDoc of safeDocs(groupsRes.value)) {
            const g = gDoc.data() || {};
            const gCreated = toMillis(g.createdAt, now);
            const gUpdated = toMillis(g.updatedAt, gCreated);
            const matchedMembers = memberRows
              .filter((m) => !m.groupId || m.groupId === gDoc.id)
              .map(({ uid: mUid, displayName, photoURL, joinedAtMs }) => ({
                uid: mUid,
                displayName,
                photoURL,
                joinedAtMs,
              }));

            groups.push({
              id: gDoc.id,
              authorUid: uid,
              authorEmail: userInfo.email,
              authorName,
              courseId,
              courseCode: code,
              courseName: name,
              name: String(g.name || 'Study Group').slice(0, 100),
              description: String(g.description || '').slice(0, 400),
              shareToken,
              createdAtMs: gCreated,
              updatedAtMs: gUpdated,
              members: matchedMembers,
            });
          }
        }
      }
    }

    // 4. Push the verified Firestore snapshot to the Express Admin SQLite DB
    const result = await apiFetchJson<FirebaseSyncStatus>('/api/admin/import-firestore-snapshot', {
      method: 'POST',
      body: {
        users: Array.from(usersMap.values()),
        courses,
        materials,
        groups,
      },
    });
    return result;
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const isPermDenied =
      rawMsg.toLowerCase().includes('missing or insufficient permissions') ||
      rawMsg.toLowerCase().includes('permission-denied');
    return {
      ok: false,
      source: 'client_sdk',
      usersSynced: 0,
      coursesSynced: 0,
      materialsSynced: 0,
      groupsSynced: 0,
      syncedAtMs: Date.now(),
      projectId: firebaseConfig.projectId,
      firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
      permissionDenied: isPermDenied,
      error: rawMsg,
      setupHint: isPermDenied
        ? 'Your Firestore security rules denied listing /users. Verify you are signed in with the verified admin email configured in firestore.rules and that the latest rules are deployed.'
        : undefined,
    };
  }
}
