import React, { useEffect, useState } from 'react';
import type { Course } from '../../types/models';
import { SCHEMA_LIMITS, validateCourseInput } from '../../utils/validation';
import { formatReadableError } from '../../services/firebase/errors';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ErrorBanner } from '../ui/StateViews';

interface CourseModalProps {
  open: boolean;
  initialCourse?: Course | null;
  onClose: () => void;
  onSubmit: (input: { code: string; name: string; description: string }) => Promise<void>;
}

export const CourseModal: React.FC<CourseModalProps> = ({
  open,
  initialCourse,
  onClose,
  onSubmit,
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCode(initialCourse?.code ?? '');
      setName(initialCourse?.name ?? '');
      setDescription(initialCourse?.description ?? '');
      setError(null);
      setSubmitting(false);
    }
  }, [open, initialCourse]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateCourseInput({ code, name, description });
    if (!check.valid) {
      setError(check.error || 'Please complete the required fields.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(check.sanitized);
      onClose();
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={initialCourse ? 'Edit course' : 'Create course'}
      description="Organize your materials, tutor threads, practice sessions, and Automatic Study plans by course."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <div>
          <label htmlFor="course-code" className="block text-sm font-medium text-zinc-900 dark:text-zinc-200">
            Course code
          </label>
          <input
            id="course-code"
            type="text"
            required
            maxLength={SCHEMA_LIMITS.COURSE_CODE_MAX}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g., BUS 115, MGT 101, CS 204"
            className="mt-1.5 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="course-name" className="block text-sm font-medium text-zinc-900 dark:text-zinc-200">
            Course name
          </label>
          <input
            id="course-name"
            type="text"
            required
            maxLength={SCHEMA_LIMITS.COURSE_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Principles of Microeconomics"
            className="mt-1.5 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="course-desc" className="block text-sm font-medium text-zinc-900 dark:text-zinc-200">
              Description <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
            </label>
            <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
              {description.length}/{SCHEMA_LIMITS.COURSE_DESC_MAX}
            </span>
          </div>
          <textarea
            id="course-desc"
            rows={3}
            maxLength={SCHEMA_LIMITS.COURSE_DESC_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Key syllabus focus, semester, or instructor notes..."
            className="mt-1.5 w-full resize-none rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-zinc-100 dark:border-zinc-800 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {initialCourse ? 'Save changes' : 'Create course'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
