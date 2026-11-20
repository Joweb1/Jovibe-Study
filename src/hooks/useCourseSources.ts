import { useEffect, useState } from 'react';
import type { StudySource } from '../types/models';
import { formatReadableError } from '../services/firebase/errors';
import { subscribeCourseSources } from '../services/firebase/sourceService';
import { cacheCourseSources, getCachedSources } from '../services/local/indexedDb';

export function useCourseSources(userId: string | undefined, courseId: string | undefined) {
  const [sources, setSources] = useState<StudySource[]>([]);
  const [loading, setLoading] = useState(false);
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
