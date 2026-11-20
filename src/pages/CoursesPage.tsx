import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Atom,
  BookOpen,
  Compass,
  Cpu,
  Landmark,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type { Course } from '../types/models';
import { useCourses } from '../context/CourseContext';
import { useRouter } from '../router/RouterContext';
import { formatReadableError } from '../services/firebase/errors';
import { CourseModal } from '../components/courses/CourseModal';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EmptyState, ErrorBanner, LoadingSkeleton } from '../components/ui/StateViews';

type CourseMotif = 'book' | 'science' | 'tech' | 'business' | 'math' | 'humanities';

const MOTIF_LIST: CourseMotif[] = ['book', 'business', 'tech', 'science', 'math', 'humanities'];

function pickCourseMotif(course: Course): CourseMotif {
  const text = `${course.code} ${course.name}`.toLowerCase();
  if (/(cs|csc|comp|soft|data|code|prog|web|ai|ml|cyber|net|sys|eng|ece|it\b)/.test(text)) {
    return 'tech';
  }
  if (/(bio|chem|phys|sci|med|anat|neuro|genet|eco|env|lab|pharm)/.test(text)) {
    return 'science';
  }
  if (/(bus|mgt|mgmt|manage|econ|fin|acc|market|stat|org|comm|entr|strat|hr\b)/.test(text)) {
    return 'business';
  }
  if (/(math|mth|calc|alg|geom|trig|linear|prob|quant|arch)/.test(text)) {
    return 'math';
  }
  if (/(law|hist|pol|phil|soc|lit|psych|art|gov|ethic|relig|lang|anthro)/.test(text)) {
    return 'humanities';
  }

  let hash = 0;
  const seed = `${course.id}:${course.code}`;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return MOTIF_LIST[hash % MOTIF_LIST.length];
}

const MOTIF_ICONS: Record<CourseMotif, React.ComponentType<{ className?: string }>> = {
  book: BookOpen,
  science: Atom,
  tech: Cpu,
  business: TrendingUp,
  math: Compass,
  humanities: Landmark,
};

const CourseCardIllustration: React.FC<{ motif: CourseMotif; inverted?: boolean }> = ({
  motif,
  inverted = false,
}) => {
  const baseClass = `pointer-events-none absolute -right-3 -bottom-3 h-28 w-32 sm:h-32 sm:w-36 transition-all duration-300 group-hover:scale-105 ${
    inverted
      ? 'text-white opacity-[0.12] group-hover:opacity-[0.19]'
      : 'text-zinc-900 opacity-[0.09] group-hover:opacity-[0.16]'
  }`;

  switch (motif) {
    case 'book':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <path
            d="M22 30 C22 25 27 22 34 22 L66 22 C70 22 72 25 72 29 L72 92 C66 88 54 88 34 88 C27 88 22 85 22 80 Z"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M122 30 C122 25 117 22 110 22 L78 22 C74 22 72 25 72 29 L72 92 C78 88 90 88 110 88 C117 88 122 85 122 80 Z"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <line x1="34" y1="40" x2="60" y2="40" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="34" y1="53" x2="58" y2="53" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="34" y1="66" x2="52" y2="66" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="84" y1="40" x2="110" y2="40" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="84" y1="53" x2="106" y2="53" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <path
            d="M94 22 L94 42 L100 37 L106 42 L106 22"
            fill="currentColor"
            fillOpacity="0.2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'business':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <line x1="20" y1="96" x2="122" y2="96" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <rect x="28" y="66" width="16" height="30" rx="3" stroke="currentColor" strokeWidth="2.4" />
          <rect x="54" y="50" width="16" height="46" rx="3" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="2.4" />
          <rect x="80" y="38" width="16" height="58" rx="3" stroke="currentColor" strokeWidth="2.4" />
          <rect x="106" y="24" width="14" height="72" rx="3" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2.4" />
          <path
            d="M28 54 L58 34 L82 40 L114 16"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="58" cy="34" r="3.5" fill="currentColor" />
          <circle cx="82" cy="40" r="3.5" fill="currentColor" />
          <circle cx="114" cy="16" r="3.5" fill="currentColor" />
        </svg>
      );
    case 'tech':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <rect x="44" y="34" width="52" height="52" rx="10" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="2.5" />
          <rect x="58" y="48" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="2.2" />
          <line x1="58" y1="18" x2="58" y2="34" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="70" y1="18" x2="70" y2="34" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="82" y1="18" x2="82" y2="34" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="58" y1="86" x2="58" y2="102" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="70" y1="86" x2="70" y2="102" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="82" y1="86" x2="82" y2="102" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="26" y1="48" x2="44" y2="48" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="26" y1="60" x2="44" y2="60" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="26" y1="72" x2="44" y2="72" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="96" y1="48" x2="114" y2="48" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="96" y1="60" x2="114" y2="60" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="96" y1="72" x2="114" y2="72" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
    case 'science':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <ellipse cx="72" cy="60" rx="46" ry="18" transform="rotate(-28 72 60)" stroke="currentColor" strokeWidth="2.4" />
          <ellipse cx="72" cy="60" rx="46" ry="18" transform="rotate(28 72 60)" stroke="currentColor" strokeWidth="2.4" />
          <ellipse cx="72" cy="60" rx="46" ry="18" transform="rotate(90 72 60)" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="72" cy="60" r="9" fill="currentColor" fillOpacity="0.22" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="110" cy="40" r="4" fill="currentColor" />
          <circle cx="34" cy="80" r="4" fill="currentColor" />
          <circle cx="72" cy="14" r="4" fill="currentColor" />
        </svg>
      );
    case 'math':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <polygon
            points="70,18 114,96 26,96"
            fill="currentColor"
            fillOpacity="0.1"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="70" cy="64" r="22" stroke="currentColor" strokeWidth="2.2" strokeDasharray="5 4" />
          <line x1="70" y1="18" x2="70" y2="96" stroke="currentColor" strokeWidth="2" />
          <path d="M56 96 C56 88 62 82 70 82" stroke="currentColor" strokeWidth="2.2" />
          <circle cx="70" cy="18" r="3.5" fill="currentColor" />
          <circle cx="114" cy="96" r="3.5" fill="currentColor" />
          <circle cx="26" cy="96" r="3.5" fill="currentColor" />
        </svg>
      );
    case 'humanities':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <polygon
            points="70,18 118,40 22,40"
            fill="currentColor"
            fillOpacity="0.14"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <line x1="26" y1="48" x2="114" y2="48" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <rect x="34" y="48" width="12" height="40" stroke="currentColor" strokeWidth="2.3" />
          <rect x="64" y="48" width="12" height="40" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="2.3" />
          <rect x="94" y="48" width="12" height="40" stroke="currentColor" strokeWidth="2.3" />
          <rect x="22" y="88" width="96" height="10" rx="2" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="2.4" />
        </svg>
      );
  }
};

export const CoursesPage: React.FC = () => {
  const {
    courses,
    activeCourse,
    coursesLoading,
    selectCourse,
    createCourse,
    updateCourse,
    deleteCourse,
  } = useCourses();
  const { navigate } = useRouter();

  const [openMenuCourseId, setOpenMenuCourseId] = useState<string | null>(null);
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenuCourseId) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenuCourseId(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuCourseId(null);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openMenuCourseId]);

  const handleSelectCourse = (courseId: string) => {
    setOpenMenuCourseId(null);
    void selectCourse(courseId);
    navigate('/library');
  };

  const handleConfirmDelete = async () => {
    if (!courseToDelete) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteCourse(courseToDelete.id);
      setCourseToDelete(null);
    } catch (err) {
      setActionError(formatReadableError(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-7">
      <div className="flex items-center justify-between gap-4 border-b border-zinc-200 pb-5">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950">
            Courses
          </h1>
          {!coursesLoading && courses.length > 0 && (
            <span className="text-xs text-zinc-500 tabular-nums">
              {courses.length} {courses.length === 1 ? 'course' : 'courses'}
            </span>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditingCourse(null);
            setCourseModalOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          New course
        </Button>
      </div>

      {actionError && (
        <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
      )}

      {coursesLoading ? (
        <LoadingSkeleton lines={4} />
      ) : courses.length === 0 ? (
        <EmptyState
          title="Create your first course"
          description="Set up a course to organize your lecture slides, PDFs, study notes, AI Tutor threads, and practice drills."
          actionLabel="Create course"
          onAction={() => {
            setEditingCourse(null);
            setCourseModalOpen(true);
          }}
        />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {courses.map((course) => {
            const isActive = activeCourse?.id === course.id;
            const motif = pickCourseMotif(course);
            const Icon = MOTIF_ICONS[motif];
            const isMenuOpen = openMenuCourseId === course.id;

            return (
              <div
                key={course.id}
                className={`group relative rounded-2xl border p-5 sm:p-6 min-h-[164px] sm:min-h-[184px] flex flex-col justify-between text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${
                  isMenuOpen ? 'z-30 shadow-md' : 'z-0'
                } ${
                  isActive
                    ? 'border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-900 hover:border-zinc-900'
                    : isMenuOpen
                    ? 'border-zinc-900 bg-white'
                    : 'border-zinc-200 bg-white hover:border-zinc-900'
                }`}
              >
                {/* Clipped vector background illustration */}
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                  <CourseCardIllustration motif={motif} inverted={isActive} />
                </div>

                {/* Full-card tap/click target (kept behind the More menu trigger) */}
                <button
                  type="button"
                  onClick={() => handleSelectCourse(course.id)}
                  aria-label={`Open ${course.code} ${course.name}`}
                  className="absolute inset-0 z-10 rounded-2xl cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                />

                {/* Top Row: Subject Icon + More Tooltip Menu */}
                <div className="relative z-20 flex items-start justify-between gap-2 pointer-events-none">
                  <span
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-xl shadow-xs transition-transform duration-200 group-hover:scale-105 ${
                      isActive ? 'bg-white text-zinc-950' : 'bg-zinc-950 text-white'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>

                  <div
                    ref={isMenuOpen ? menuContainerRef : undefined}
                    className="relative pointer-events-auto"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuCourseId((prev) => (prev === course.id ? null : course.id));
                      }}
                      aria-haspopup="menu"
                      aria-expanded={isMenuOpen}
                      aria-label={`More options for ${course.name}`}
                      title="More options"
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors cursor-pointer ${
                        isActive
                          ? isMenuOpen
                            ? 'bg-white text-zinc-950'
                            : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                          : isMenuOpen
                          ? 'bg-zinc-950 text-white'
                          : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950'
                      }`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>

                    <AnimatePresence>
                      {isMenuOpen && (
                        <motion.div
                          role="menu"
                          initial={{ opacity: 0, y: -4, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.96 }}
                          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-full z-40 mt-2 w-36 origin-top-right rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg"
                        >
                          {/* Tooltip caret arrow */}
                          <span
                            aria-hidden="true"
                            className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-l border-t border-zinc-200 bg-white"
                          />
                          <div className="relative z-10 space-y-0.5">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuCourseId(null);
                                setEditingCourse(course);
                                setCourseModalOpen(true);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 transition-colors cursor-pointer"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuCourseId(null);
                                setCourseToDelete(course);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Bottom Content: Course Code & Title */}
                <div className="relative z-10 mt-6 pointer-events-none">
                  <div
                    className={`flex items-center gap-1.5 text-xs ${
                      isActive ? 'text-zinc-400' : 'text-zinc-500'
                    }`}
                  >
                    <span
                      className={`font-mono font-medium truncate ${
                        isActive ? 'text-zinc-300' : 'text-zinc-700'
                      }`}
                    >
                      {course.code}
                    </span>
                    {isActive && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-white shrink-0">Active</span>
                      </>
                    )}
                  </div>
                  <h2
                    className={`mt-1 font-display text-base sm:text-lg font-semibold tracking-tight line-clamp-2 ${
                      isActive ? 'text-white' : 'text-zinc-950'
                    }`}
                  >
                    {course.name}
                  </h2>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Course Modal */}
      <CourseModal
        open={courseModalOpen}
        initialCourse={editingCourse}
        onClose={() => {
          setCourseModalOpen(false);
          setEditingCourse(null);
        }}
        onSubmit={async (input) => {
          if (editingCourse) {
            await updateCourse(editingCourse.id, input);
          } else {
            await createCourse(input);
          }
        }}
      />

      {/* Delete Course Confirmation Modal */}
      <Modal
        open={Boolean(courseToDelete)}
        title="Delete course?"
        description={
          courseToDelete
            ? `Permanently delete "${courseToDelete.code} — ${courseToDelete.name}" along with all its materials, topics, AI Tutor chats, practice history, and Automatic Study sessions?`
            : undefined
        }
        onClose={() => {
          if (!deleting) setCourseToDelete(null);
        }}
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            variant="secondary"
            onClick={() => setCourseToDelete(null)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleConfirmDelete()}
            loading={deleting}
          >
            Delete course
          </Button>
        </div>
      </Modal>
    </div>
  );
};
