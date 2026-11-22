import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileText, Loader2 } from 'lucide-react';
import { useBackgroundIngestion } from '../../context/BackgroundIngestionContext';
import { useCourses } from '../../context/CourseContext';
import { useRouter } from '../../router/RouterContext';

interface BackgroundExtractionPillProps {
  effectiveHideBottomNav: boolean;
  hasMinimizedLiveBar: boolean;
}

/**
 * Compact floating background extraction indicator shown when the user navigates
 * away from the Library while one or more documents are still being processed.
 */
export const BackgroundExtractionPill: React.FC<BackgroundExtractionPillProps> = ({
  effectiveHideBottomNav,
  hasMinimizedLiveBar,
}) => {
  const { activeJobs } = useBackgroundIngestion();
  const { activeCourse, selectCourse } = useCourses();
  const { route, navigate } = useRouter();

  const shouldShow = activeJobs.length > 0 && route !== '/library' && route !== '/live';
  const primaryJob = activeJobs.find((j) => j.status === 'extracting' || j.status === 'saving') ?? activeJobs[0];

  const bottomPositionClass = hasMinimizedLiveBar
    ? effectiveHideBottomNav
      ? 'bottom-[82px]'
      : 'bottom-[140px] md:bottom-[86px]'
    : effectiveHideBottomNav
    ? 'bottom-4'
    : 'bottom-[72px] md:bottom-5';

  const handleOpenLibrary = () => {
    if (primaryJob && primaryJob.courseId && activeCourse?.id !== primaryJob.courseId) {
      void selectCourse(primaryJob.courseId);
    }
    navigate('/library');
  };

  return (
    <AnimatePresence>
      {shouldShow && primaryJob && (
        <motion.div
          key="background-extraction-floating-pill"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className={`fixed z-40 left-4 right-4 md:left-auto md:right-6 md:w-[340px] ${bottomPositionClass}`}
        >
          <button
            type="button"
            onClick={handleOpenLibrary}
            aria-label="View background document extraction in Library"
            className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 px-3.5 py-2.5 text-left shadow-lg backdrop-blur hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950">
                <FileText className="h-3.5 w-3.5" />
                <Loader2 className="absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 animate-spin rounded-full bg-white dark:bg-zinc-900 p-0.5 text-zinc-950 dark:text-zinc-100" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-950 dark:text-zinc-100">
                  <span className="truncate">
                    {activeJobs.length === 1
                      ? primaryJob.title || primaryJob.fileName
                      : `Extracting ${activeJobs.length} materials`}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-zinc-700 dark:text-zinc-300 shrink-0">
                    {Math.round(primaryJob.progressPercent)}%
                  </span>
                </div>
                <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                  {primaryJob.progressStage}
                </p>
              </div>
            </div>

            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <motion.div
                animate={{ width: `${Math.max(5, Math.round(primaryJob.progressPercent))}%` }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="h-full rounded-full bg-zinc-950 dark:bg-zinc-100"
              />
            </div>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
