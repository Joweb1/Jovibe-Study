import React, { useState } from 'react';
import { ShieldOff } from 'lucide-react';
import type { Course } from '../../types/models';
import { useCourses } from '../../context/CourseContext';
import { useRouter } from '../../router/RouterContext';
import { formatReadableError } from '../../services/firebase/errors';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/StateViews';

interface RevokedCourseNoticeProps {
  course: Course;
  pageTitle: string;
}

export const RevokedCourseNotice: React.FC<RevokedCourseNoticeProps> = ({ course, pageTitle }) => {
  const { leaveCourse } = useCourses();
  const { navigate } = useRouter();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await leaveCourse(course.id);
      navigate('/courses');
    } catch (err) {
      setError(formatReadableError(err));
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {course.code} · Shared
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
          {pageTitle}
        </h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="mx-auto max-w-lg rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/70 p-6 sm:p-8 text-center">
        <div className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-950 dark:bg-zinc-200 text-white dark:text-zinc-950">
          <ShieldOff className="h-5 w-5" />
        </div>
        <h2 className="mt-4 font-display text-lg font-semibold text-zinc-950 dark:text-zinc-200">
          Access to {course.name} has ended
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          The course author removed your membership or deleted this shared course. Materials from this course are no longer available, though your personal study history remains private.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <Button
            onClick={() => void handleRemove()}
            loading={removing}
          >
            Remove from my courses
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate('/courses')}
            disabled={removing}
          >
            Back to Courses
          </Button>
        </div>
      </div>
    </div>
  );
};
