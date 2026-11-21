import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, FolderOpen, Plus } from 'lucide-react';
import { useCourses } from '../../context/CourseContext';
import { useRouter } from '../../router/RouterContext';

interface CourseSelectorProps {
  onNewCourse: () => void;
}

export const CourseSelector: React.FC<CourseSelectorProps> = ({ onNewCourse }) => {
  const { courses, activeCourse, coursesLoading, selectCourse } = useCourses();
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex min-h-9 max-w-[180px] sm:max-w-[230px] items-center justify-between gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-950 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
      >
        <span className="truncate">
          {coursesLoading
            ? 'Loading courses...'
            : activeCourse
            ? `${activeCourse.code} — ${activeCourse.name}`
            : 'Select course'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label="Select active course"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 z-40 mt-2 w-72 origin-top-right rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 shadow-lg"
          >
            {courses.length === 0 ? (
              <div className="px-3 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                No courses yet. Create your first course to organize materials and study sessions.
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto scrollbar-hide py-1">
                {courses.map((course) => {
                  const isSelected = activeCourse?.id === course.id;
                  return (
                    <button
                      key={course.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        void selectCourse(course.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-950 dark:text-zinc-200 font-medium'
                          : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                          <span className="font-mono">{course.code}</span>
                          {course.isShared ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Shared</span>
                            </>
                          ) : course.isPublic ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Public</span>
                            </>
                          ) : null}
                        </div>
                        <div className="truncate">{course.name}</div>
                      </div>
                      {isSelected && <Check className="h-4 w-4 shrink-0 text-zinc-950 dark:text-zinc-200" />}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-1 border-t border-zinc-200 dark:border-zinc-800 pt-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onNewCourse();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-zinc-950 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
              >
                <Plus className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                New course
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate('/courses');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer transition-colors"
              >
                <FolderOpen className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                All courses
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
