import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Atom,
  BookOpen,
  Check,
  Compass,
  Copy,
  Cpu,
  Landmark,
  Link2,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { Course } from '../types/models';
import { useCourses } from '../context/CourseContext';
import { usePlatformAccess } from '../context/PlatformAccessContext';
import { useRouter } from '../router/RouterContext';
import { formatReadableError } from '../services/firebase/errors';
import {
  buildCourseInviteUrl,
  extractShareToken,
} from '../services/firebase/sharedCourseService';
import { ApplicationCoursesSection } from '../components/courses/ApplicationCoursesSection';
import { CourseModal } from '../components/courses/CourseModal';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EmptyState, ErrorBanner, LoadingSkeleton } from '../components/ui/StateViews';

type CourseMotif = 'book' | 'science' | 'tech' | 'business' | 'math' | 'humanities';
type CourseFilter = 'all' | 'owned' | 'shared';

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
      ? 'text-white dark:text-zinc-950 opacity-[0.12] dark:opacity-[0.14] group-hover:opacity-[0.19]'
      : 'text-zinc-900 dark:text-zinc-300 opacity-[0.09] dark:opacity-[0.1] group-hover:opacity-[0.16] dark:group-hover:opacity-[0.17]'
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
    case 'tech':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <rect x="36" y="24" width="68" height="68" rx="14" stroke="currentColor" strokeWidth="2.5" />
          <rect x="52" y="40" width="36" height="36" rx="8" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2" />
          <line x1="50" y1="12" x2="50" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="70" y1="12" x2="70" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="90" y1="12" x2="90" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="50" y1="92" x2="50" y2="104" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="70" y1="92" x2="70" y2="104" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="90" y1="92" x2="90" y2="104" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="16" y1="42" x2="36" y2="42" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="16" y1="58" x2="36" y2="58" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="16" y1="74" x2="36" y2="74" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="104" y1="42" x2="124" y2="42" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="104" y1="58" x2="124" y2="58" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="104" y1="74" x2="124" y2="74" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case 'science':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <circle cx="70" cy="58" r="7" fill="currentColor" />
          <ellipse cx="70" cy="58" rx="46" ry="16" stroke="currentColor" strokeWidth="2.4" />
          <g transform="rotate(60 70 58)">
            <ellipse cx="70" cy="58" rx="46" ry="16" stroke="currentColor" strokeWidth="2.4" />
          </g>
          <g transform="rotate(-60 70 58)">
            <ellipse cx="70" cy="58" rx="46" ry="16" stroke="currentColor" strokeWidth="2.4" />
          </g>
        </svg>
      );
    case 'business':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <line x1="22" y1="96" x2="118" y2="96" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <rect x="28" y="68" width="16" height="28" rx="3" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="2" />
          <rect x="52" y="52" width="16" height="44" rx="3" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="2" />
          <rect x="76" y="38" width="16" height="58" rx="3" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="2" />
          <rect x="100" y="24" width="16" height="72" rx="3" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="2" />
          <path d="M26 62 L54 44 L78 50 L108 18" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="96 18 108 18 108 30" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'math':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <circle cx="70" cy="58" r="42" stroke="currentColor" strokeWidth="2.4" />
          <path d="M70 20 L70 96" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
          <path d="M32 58 L108 58" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
          <path
            d="M36 78 C48 42, 60 30, 70 58 C80 86, 92 74, 104 38"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="70" cy="58" r="4" fill="currentColor" />
        </svg>
      );
    case 'humanities':
      return (
        <svg viewBox="0 0 140 120" fill="none" aria-hidden="true" className={baseClass}>
          <polygon points="70,18 24,38 116,38" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          <line x1="20" y1="44" x2="120" y2="44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="32" y1="44" x2="32" y2="84" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="56" y1="44" x2="56" y2="84" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="84" y1="44" x2="84" y2="84" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="108" y1="44" x2="108" y2="84" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <rect x="20" y="84" width="100" height="12" rx="2" stroke="currentColor" strokeWidth="2.5" fill="currentColor" fillOpacity="0.15" />
        </svg>
      );
  }
};

export const CoursesPage: React.FC = () => {
  const {
    courses,
    ownedCourses,
    sharedCourses,
    activeCourse,
    coursesLoading,
    selectCourse,
    createCourse,
    updateCourse,
    deleteCourse,
    leaveCourse,
  } = useCourses();
  const { isAdmin, status: platformStatus, usingPersonalKey } = usePlatformAccess();
  const { navigate } = useRouter();

  const [courseFilter, setCourseFilter] = useState<CourseFilter>('all');
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [courseToLeave, setCourseToLeave] = useState<Course | null>(null);
  const [leaving, setLeaving] = useState(false);

  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [openMenuCourseId, setOpenMenuCourseId] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  // Reset filter to 'all' if user no longer has shared courses
  useEffect(() => {
    if (sharedCourses.length === 0 && courseFilter !== 'all') {
      setCourseFilter('all');
    }
  }, [sharedCourses.length, courseFilter]);

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

  const visibleCourses = useMemo(() => {
    if (courseFilter === 'owned') return ownedCourses;
    if (courseFilter === 'shared') return sharedCourses;
    return courses;
  }, [courseFilter, courses, ownedCourses, sharedCourses]);

  const handleSelectCourse = (courseId: string) => {
    setOpenMenuCourseId(null);
    void selectCourse(courseId);
    navigate('/library');
  };

  const handleCopyInviteLink = async (course: Course) => {
    if (!course.shareToken) return;
    const url = buildCourseInviteUrl(course.shareToken);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedNotice(`Invite link copied for ${course.code}`);
      setTimeout(() => setCopiedNotice(null), 2600);
    } catch {
      setActionError('Could not copy link automatically. Open Share & Manage to copy it manually.');
    }
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

  const handleConfirmLeave = async () => {
    if (!courseToLeave) return;
    setLeaving(true);
    setActionError(null);
    try {
      await leaveCourse(courseToLeave.id);
      setCourseToLeave(null);
    } catch (err) {
      setActionError(formatReadableError(err));
    } finally {
      setLeaving(false);
    }
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const token = extractShareToken(joinInput);
    if (!token) {
      setJoinError('Paste a valid shared course invite link or share code.');
      return;
    }
    setJoinError(null);
    setJoinModalOpen(false);
    setJoinInput('');
    navigate(`/join/${token}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
            Courses
          </h1>
          {!coursesLoading && courses.length > 0 && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              {courses.length} {courses.length === 1 ? 'course' : 'courses'}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setJoinError(null);
              setJoinInput('');
              setJoinModalOpen(true);
            }}
          >
            <Link2 className="h-3.5 w-3.5" />
            Join link
          </Button>
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
      </div>

      {/* Filter switch — only shown when the user has at least one joined shared course */}
      {!coursesLoading && sharedCourses.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Filter courses"
            className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-2xl sm:rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 p-1"
          >
            {(
              [
                { id: 'all' as const, label: 'All', count: courses.length },
                { id: 'owned' as const, label: 'My Courses', count: ownedCourses.length },
                { id: 'shared' as const, label: 'Shared', count: sharedCourses.length },
              ]
            ).map((tab) => {
              const active = courseFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCourseFilter(tab.id)}
                  className={`relative rounded-full px-3.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'text-white dark:text-zinc-950'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="courses-filter-pill"
                      transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                      className="absolute inset-0 rounded-full bg-zinc-950 dark:bg-zinc-200"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10 inline-flex items-center gap-1.5">
                    <span>{tab.label}</span>
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        active ? 'text-zinc-300 dark:text-zinc-700' : 'text-zinc-400 dark:text-zinc-500'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {copiedNotice && (
        <div className="flex items-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
          <Check className="h-3.5 w-3.5 shrink-0" />
          <span>{copiedNotice}</span>
        </div>
      )}

      {actionError && (
        <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
      )}

      {coursesLoading ? (
        <LoadingSkeleton lines={4} />
      ) : courses.length === 0 ? (
        <EmptyState
          title="Create or join your first course"
          description="Set up a private course for your lecture slides, PDFs, notes, AI Tutor threads, and practice drills — or join a shared course using an invite link."
          actionLabel="Create course"
          onAction={() => {
            setEditingCourse(null);
            setCourseModalOpen(true);
          }}
        />
      ) : visibleCourses.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No courses in this view yet.
        </div>
      ) : (
        <div className="responsive-course-grid">
          {visibleCourses.map((course) => {
            const isActive = activeCourse?.id === course.id;
            const isShared = Boolean(course.isShared);
            const isOwner = Boolean(course.isOwner);
            const motif = pickCourseMotif(course);
            const Icon = MOTIF_ICONS[motif];
            const isMenuOpen = openMenuCourseId === course.id;

            return (
              <div
                key={course.id}
                className={`group relative min-w-0 rounded-2xl border p-4 sm:p-5 lg:p-6 min-h-[152px] sm:min-h-[188px] flex flex-col justify-between text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${
                  isMenuOpen ? 'z-30 shadow-md' : 'z-0'
                } ${
                  isActive
                    ? 'border-zinc-950 dark:border-zinc-300 bg-zinc-950 dark:bg-zinc-200 text-white dark:text-zinc-950 hover:bg-zinc-900 dark:hover:bg-zinc-300 hover:border-zinc-900 dark:hover:border-zinc-300'
                    : isMenuOpen
                    ? 'border-zinc-900 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-200'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-200 hover:border-zinc-900 dark:hover:border-zinc-600'
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
                  className="absolute inset-0 z-10 rounded-2xl cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 dark:focus-visible:outline-zinc-200"
                />

                {/* Top Row: Subject Icon + More Tooltip Menu */}
                <div className="relative z-20 flex items-start justify-between gap-2 pointer-events-none">
                  <span
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-xl shadow-xs transition-transform duration-200 group-hover:scale-105 ${
                      isActive
                        ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-200'
                        : 'bg-zinc-950 dark:bg-zinc-200 text-white dark:text-zinc-950'
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
                            ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-200'
                            : 'text-zinc-400 dark:text-zinc-600 hover:bg-zinc-800 dark:hover:bg-zinc-300 hover:text-white dark:hover:text-zinc-950'
                          : isMenuOpen
                          ? 'bg-zinc-950 dark:bg-zinc-200 text-white dark:text-zinc-950'
                          : 'text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200'
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
                          className="absolute right-0 top-full z-40 mt-2 w-44 max-w-[calc(100vw-2rem)] origin-top-right rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-1.5 shadow-lg"
                        >
                          {/* Tooltip caret arrow */}
                          <span
                            aria-hidden="true"
                            className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-l border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                          />
                          <div className="relative z-10 space-y-0.5">
                            {isOwner ? (
                              <>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenMenuCourseId(null);
                                    navigate(`/manage-course/${course.id}`);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                                >
                                  <Users className="h-3.5 w-3.5" />
                                  Share &amp; Manage
                                </button>
                                {course.isPublic && course.shareToken && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setOpenMenuCourseId(null);
                                      void handleCopyInviteLink(course);
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    Copy invite link
                                  </button>
                                )}
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenMenuCourseId(null);
                                    setEditingCourse(course);
                                    setCourseModalOpen(true);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
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
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenuCourseId(null);
                                  setCourseToLeave(course);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer"
                              >
                                <LogOut className="h-3.5 w-3.5" />
                                Leave course
                              </button>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Bottom Content: Course Code, Status Metadata, Title, & Author */}
                <div className="relative z-10 mt-6 min-w-0 pointer-events-none">
                  <div
                    className={`flex flex-wrap items-center gap-1.5 text-xs ${
                      isActive ? 'text-zinc-400 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    <span
                      className={`font-mono font-medium truncate max-w-full ${
                        isActive ? 'text-zinc-300 dark:text-zinc-800' : 'text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      {course.code}
                    </span>
                    {isShared ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0">Shared</span>
                      </>
                    ) : course.isPublic ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0">Public</span>
                      </>
                    ) : null}
                    {isActive && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-white dark:text-zinc-950 shrink-0">Active</span>
                      </>
                    )}
                  </div>
                  <h2
                    className={`mt-1 font-display text-base sm:text-lg font-semibold tracking-tight break-words line-clamp-2 ${
                      isActive ? 'text-white dark:text-zinc-950' : 'text-zinc-950 dark:text-zinc-200'
                    }`}
                  >
                    {course.name}
                  </h2>
                  {isShared && (
                    <p
                      className={`mt-1 truncate text-xs ${
                        isActive ? 'text-zinc-400 dark:text-zinc-700' : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      by {course.authorName || 'Course Author'}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Shared AI Quota Progress Bar (Courses page only, directly below course cards) */}
      {platformStatus && platformStatus.freeAccess.active && !usingPersonalKey && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/95 dark:bg-zinc-900/90 px-4 py-2.5 text-xs text-zinc-700 dark:text-zinc-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono font-semibold text-zinc-950 dark:text-zinc-100 tabular-nums">
                {platformStatus.quota.used}/{platformStatus.quota.limit} requests used ·{' '}
                {platformStatus.quota.remaining} remaining
              </span>
              <span aria-hidden="true" className="text-zinc-400">
                ·
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {platformStatus.quota.resetLabel}
              </span>
              <span aria-hidden="true" className="text-zinc-400 hidden sm:inline">
                ·
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 hidden sm:inline">
                Free trial: {platformStatus.freeAccess.daysRemaining}d left
              </span>
            </div>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="text-[11px] font-medium text-zinc-900 dark:text-zinc-200 underline underline-offset-2 hover:opacity-80 cursor-pointer"
            >
              Add own API key
            </button>
          </div>
        </div>
      )}

      {/* Admin-only Application Courses Directory */}
      {isAdmin && <ApplicationCoursesSection />}

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

      {/* Join Shared Course via Link Modal */}
      <Modal
        open={joinModalOpen}
        title="Join a shared course"
        description="Paste an invite link or share code from a course author to join their shared study library."
        onClose={() => setJoinModalOpen(false)}
      >
        <form onSubmit={handleJoinSubmit} className="space-y-4">
          {joinError && <ErrorBanner message={joinError} onDismiss={() => setJoinError(null)} />}
          <div>
            <label htmlFor="join-link-input" className="block text-sm font-medium text-zinc-900 dark:text-zinc-200">
              Invite link or share code
            </label>
            <input
              id="join-link-input"
              type="text"
              autoFocus
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              placeholder="https://.../join/shr_... or shr_..."
              className="mt-1.5 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-end gap-2.5 border-t border-zinc-100 dark:border-zinc-800 pt-4">
            <Button variant="secondary" type="button" onClick={() => setJoinModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!joinInput.trim()}>
              Open invite
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Course Confirmation Modal */}
      <Modal
        open={Boolean(courseToDelete)}
        title="Delete course?"
        description={
          courseToDelete
            ? `Permanently delete "${courseToDelete.code} — ${courseToDelete.name}" along with all its materials, topics, AI Tutor chats, practice history, and Automatic Study sessions?${
                courseToDelete.isPublic ? ' Anyone who joined this shared course will also lose access.' : ''
              }`
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

      {/* Leave Shared Course Confirmation Modal */}
      <Modal
        open={Boolean(courseToLeave)}
        title="Leave shared course?"
        description={
          courseToLeave
            ? `Leave "${courseToLeave.code} — ${courseToLeave.name}"? You will no longer have access to the author's shared materials, though you can rejoin later if the invite link is still active.`
            : undefined
        }
        onClose={() => {
          if (!leaving) setCourseToLeave(null);
        }}
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            variant="secondary"
            onClick={() => setCourseToLeave(null)}
            disabled={leaving}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleConfirmLeave()}
            loading={leaving}
          >
            Leave course
          </Button>
        </div>
      </Modal>
    </div>
  );
};
