import { useEffect, useState } from 'react';
import type { StudySource } from '../types/models';
import { apiFetchJson } from '../services/api/authHeaders';
import { auth } from '../services/firebase/config';
import { formatReadableError } from '../services/firebase/errors';
import { subscribeCourseSources } from '../services/firebase/sourceService';
import { cacheCourseSources, getCachedSources } from '../services/local/indexedDb';
import { timestampToMillis } from '../utils/validation';

export function useCourseSources(userId: string | undefined, courseId: string | undefined) {
  const [sources, setSources] = useState<StudySource[]>([]);
  const [loading, setLoading] = useState(() => Boolean(userId && courseId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !courseId) {
      setSources([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void getCachedSources(courseId).then((cached) => {
      if (!cancelled && cached.length > 0) {
        setSources(cached);
      }
    });

    const unsub = subscribeCourseSources(
      userId,
      courseId,
      (liveSources) => {
        if (cancelled) return;
        setSources(liveSources);
        setLoading(false);
        setError(null);
        void cacheCourseSources(userId, courseId, liveSources);
        // Mirror owned course materials metadata into server DB for admin analytics & moderation
        if (
          auth.currentUser &&
          auth.currentUser.uid === userId &&
          liveSources.length > 0 &&
          (typeof navigator === 'undefined' || navigator.onLine)
        ) {
          void apiFetchJson('/api/me/sync', {
            method: 'POST',
            body: {
              materials: liveSources.map((s) => ({
                courseId,
                sourceId: s.id,
                title: s.title,
                materialType: s.materialType,
                pageCount: s.pageOrSlideCount,
                originalFileName: s.originalFileName,
                contentPreview: s.extractedContent.slice(0, 400),
                createdAtMs: s.createdAt ? timestampToMillis(s.createdAt) : undefined,
                updatedAtMs: s.updatedAt ? timestampToMillis(s.updatedAt) : undefined,
              })),
            },
          }).catch(() => {});
        }
      },
      (err) => {
        if (cancelled) return;
        setError(formatReadableError(err));
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [userId, courseId]);

  return {
    sources,
    loading,
    error,
    clearError: () => setError(null),
  };
}
