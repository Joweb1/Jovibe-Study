import React, { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Check, Lock, Settings2, Users } from 'lucide-react';
import type { CourseShare } from '../types/models';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { useRouter } from '../router/RouterContext';
import { formatReadableError } from '../services/firebase/errors';
import { fetchCourseShareByToken, joinSharedCourse } from '../services/firebase/sharedCourseService';
import { Button } from '../components/ui/Button';
import { OfflineFeatureNotice } from '../components/ui/OfflineFeatureNotice';
import { ErrorBanner, LoadingSkeleton } from '../components/ui/StateViews';

export const JoinCoursePage: React.FC = () => {
  const { user, profile, isOnline } = useAuth();
  const { courses, selectCourse } = useCourses();
  const { routeParams, navigate } = useRouter();
  const shareToken = routeParams.shareToken || '';

  const [loading, setLoading] = useState(true);
  const [share, setShare] = useState<CourseShare | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setShare(null);

    if (!shareToken || !isOnline) {
      setLoading(false);
      return;
    }

    void fetchCourseShareByToken(shareToken)
      .then((result) => {
        if (!cancelled) {
          setShare(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(formatReadableError(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shareToken, isOnline]);

  const isAuthor = Boolean(user && share && share.authorId === user.uid);
  const alreadyJoined = Boolean(share && courses.some((c) => c.id === share.courseId));

  const handleJoin = async () => {
    if (!user || !share) return;
    if (!isOnline) {
      setError('Turn on your internet connection to join this shared course.');
      return;
    }
    setJoining(true);
    setError(null);
    try {
      await joinSharedCourse({
        share,
        memberUid: user.uid,
        displayName: profile?.displayName || user.displayName || 'Student',
        photoURL: profile?.photoURL || user.photoURL || '',
      });
      await selectCourse(share.courseId);
      navigate('/library');
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setJoining(false);
    }
  };

  const handleOpenExisting = async () => {
    if (!share) return;
    await selectCourse(share.courseId);
    navigate('/library');
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 py-4">
      <button
        type="button"
        onClick={() => navigate('/courses')}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Courses
      </button>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {!isOnline ? (
        <OfflineFeatureNotice
          title="Connect to the internet to join a shared course"
          description="Loading and joining a shared course invite link requires an active internet connection. Turn on your internet and this page will load automatically."
          actionLabel="Back to Courses"
          onAction={() => navigate('/courses')}
        />
      ) : loading ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <LoadingSkeleton lines={4} />
        </div>
      ) : !share || !share.active ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 space-y-4">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
            <Lock className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
              Invite link unavailable
            </h1>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              This shared course link is invalid, has been rotated, or was switched back to private by its author. Ask the course author for an updated link.
            </p>
          </div>
          <div className="pt-2">
            <Button onClick={() => navigate('/courses')}>Return to Courses</Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-mono font-medium text-zinc-900 dark:text-zinc-200">
                {share.courseCode}
              </span>
              <span aria-hidden="true">·</span>
              <span>Shared course invitation</span>
              <span aria-hidden="true">·</span>
              <span>by {share.authorName || 'Course Author'}</span>
            </div>

            <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
              {share.courseName}
            </h1>

            {share.courseDescription && (
              <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {share.courseDescription}
              </p>
            )}
          </div>

          <div className="border-y border-zinc-200 dark:border-zinc-800 py-4 space-y-2.5 text-xs text-zinc-600 dark:text-zinc-400">
            <div className="flex items-start gap-2.5">
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
              <span>
                <strong className="font-medium text-zinc-900 dark:text-zinc-200">Shared materials:</strong>{' '}
                Learn from the same live lecture slides, readings, and topics curated by {share.authorName || 'the author'}.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
              <span>
                <strong className="font-medium text-zinc-900 dark:text-zinc-200">Private study workspace:</strong>{' '}
                Your AI Tutor chats, Practice quizzes, Automatic Study progress, personal annotations, and Study History remain strictly private to your account.
              </span>
            </div>
          </div>

          {isAuthor ? (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                You are the author of this shared course.
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button onClick={() => void handleOpenExisting()}>Open Library</Button>
                <Button
                  variant="secondary"
                  onClick={() => navigate(`/manage-course/${share.courseId}`)}
                >
                  <Settings2 className="h-4 w-4" />
                  Manage Sharing &amp; Groups
                </Button>
              </div>
            </div>
          ) : alreadyJoined ? (
            <div className="space-y-3">
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-900 dark:text-zinc-200">
                <Check className="h-4 w-4" />
                You have already joined this shared course.
              </div>
              <div>
                <Button onClick={() => void handleOpenExisting()}>Open Course Library</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <Button onClick={() => void handleJoin()} loading={joining}>
                Join shared course
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate('/courses')}
                disabled={joining}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
