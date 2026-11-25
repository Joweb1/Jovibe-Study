import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Atom,
  BookOpen,
  Check,
  Compass,
  Copy,
  CopyPlus,
  Cpu,
  Globe,
  Landmark,
  Loader2,
  Lock,
  Mail,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import type { Course } from '../../types/models';
import { useAuth } from '../../context/AuthContext';
import { useCourses } from '../../context/CourseContext';
import { useRouter } from '../../router/RouterContext';
import {
  adminDeleteApplicationCourse,
  adminSetApplicationCourseVisibility,
  adminUpdateApplicationCourse,
  fetchAllApplicationCourses,
  remixCourseToOwnAccount,
} from '../../services/firebase/adminCourseService';
import { formatReadableError } from '../../services/firebase/errors';
import { buildCourseInviteUrl } from '../../services/firebase/sharedCourseService';
import { CourseModal } from './CourseModal';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ErrorBanner, LoadingSkeleton } from '../ui/StateViews';

type VisibilityFilter = 'all' | 'public' | 'private';
type CourseMotif = 'book' | 'science' | 'tech' | 'business' | 'math' | 'humanities';

const MOTIF_LIST: CourseMotif[] = ['book', 'business', 'tech', 'science', 'math', 'humanities'];

function pickMotif(course: Course): CourseMotif {
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

export const ApplicationCoursesSection: React.FC = () => {
  const { user, profile } = useAuth();
  const {
    activeCourse,
    externalActiveCourse,
    selectCourse,
    selectExternalCourse,
    updateExternalCourseState,
    clearExternalCourse,
  } = useCourses();
  const { navigate } = useRouter();

  const [appCourses, setAppCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; courseId?: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all');

  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [remixingKey, setRemixingKey] = useState<string | null>(null);
  const [togglingVisibilityKey, setTogglingVisibilityKey] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadCourses = useCallback(
    async (isManualRefresh = false) => {
      if (!user) return;
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const list = await fetchAllApplicationCourses(user.uid);
        setAppCourses(list);
      } catch (err) {
        setError(formatReadableError(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user]
  );

  useEffect(() => {
    void loadCourses(false);
  }, [loadCourses]);

  useEffect(() => {
    if (!openMenuKey) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuKey(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuKey(null);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openMenuKey]);

  const counts = useMemo(() => {
    let pub = 0;
    let priv = 0;
    for (const c of appCourses) {
      if (c.isPublic) pub += 1;
      else priv += 1;
    }
    return { all: appCourses.length, public: pub, private: priv };
  }, [appCourses]);

  const filteredCourses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return appCourses.filter((c) => {
      if (visibilityFilter === 'public' && !c.isPublic) return false;
      if (visibilityFilter === 'private' && c.isPublic) return false;
      if (q) {
        const haystack = `${c.code} ${c.name} ${c.ownerEmail || ''} ${c.authorName || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [appCourses, searchQuery, visibilityFilter]);

  const handleEnterCourse = (course: Course) => {
    setOpenMenuKey(null);
    if (course.isOwner) {
      void selectCourse(course.id);
    } else {
      void selectExternalCourse(course);
    }
    navigate('/library');
  };

  const handleManageCourse = (course: Course) => {
    setOpenMenuKey(null);
    if (!course.isOwner) {
      void selectExternalCourse(course);
    }
    navigate(`/manage-course/${course.id}`);
  };

  const handleRemixCourse = async (course: Course) => {
    if (!user) return;
    const key = `${course.userId}:${course.id}`;
    setOpenMenuKey(null);
    setRemixingKey(key);
    setError(null);
    setNotice(null);
    try {
      const result = await remixCourseToOwnAccount({
        adminUid: user.uid,
        adminDisplayName: profile?.displayName || user.displayName || 'Admin',
        sourceCourse: course,
      });
      setNotice({
        message: `Remixed "${result.course.code} — ${result.course.name}" into your courses (${result.topicsCopied} ${
          result.topicsCopied === 1 ? 'topic' : 'topics'
        }, ${result.sourcesCopied} ${result.sourcesCopied === 1 ? 'material' : 'materials'} copied).`,
        courseId: result.course.id,
      });
      void loadCourses(true);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setRemixingKey(null);
    }
  };

  const handleToggleVisibility = async (course: Course) => {
    const key = `${course.userId}:${course.id}`;
    setOpenMenuKey(null);
    setTogglingVisibilityKey(key);
    setError(null);
    try {
      const result = await adminSetApplicationCourseVisibility(course, !course.isPublic);
      setAppCourses((prev) =>
        prev.map((c) =>
          c.id === course.id && c.userId === course.userId
            ? { ...c, isPublic: result.isPublic, shareToken: result.shareToken }
            : c
        )
      );
      updateExternalCourseState((prev) =>
        prev && prev.id === course.id && prev.userId === course.userId
          ? { ...prev, isPublic: result.isPublic, shareToken: result.shareToken }
          : prev
      );
      setNotice({
        message: `"${course.code}" is now ${result.isPublic ? 'Public' : 'Private'}.`,
      });
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setTogglingVisibilityKey(null);
    }
  };

  const handleCopyInviteLink = async (course: Course) => {
    setOpenMenuKey(null);
    if (!course.shareToken) return;
    const url = buildCourseInviteUrl(course.shareToken);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ message: `Invite link copied for ${course.code}.` });
    } catch {
      setError('Could not copy link automatically. Open Manage Course to copy it manually.');
    }
  };

  const handleSaveEdit = async (input: { code: string; name: string; description: string }) => {
    if (!editingCourse) return;
    await adminUpdateApplicationCourse(editingCourse, input);
    setAppCourses((prev) =>
      prev.map((c) =>
        c.id === editingCourse.id && c.userId === editingCourse.userId
          ? { ...c, ...input }
          : c
      )
    );
    updateExternalCourseState((prev) =>
      prev && prev.id === editingCourse.id && prev.userId === editingCourse.userId
        ? { ...prev, ...input }
        : prev
    );
    setNotice({ message: `Updated "${input.code} — ${input.name}".` });
  };

  const handleConfirmDelete = async () => {
    if (!courseToDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await adminDeleteApplicationCourse(courseToDelete);
      setAppCourses((prev) =>
        prev.filter((c) => !(c.id === courseToDelete.id && c.userId === courseToDelete.userId))
      );
      if (externalActiveCourse?.id === courseToDelete.id) {
        clearExternalCourse();
      }
      setNotice({ message: `Deleted "${courseToDelete.code} — ${courseToDelete.name}".` });
      setCourseToDelete(null);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="space-y-5 border-t border-zinc-200 dark:border-zinc-800 pt-8">
      {/* Section Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-display text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
              Application Courses
            </h2>
            {!loading && (
              <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                {filteredCourses.length === appCourses.length
                  ? `${appCourses.length} ${appCourses.length === 1 ? 'course' : 'courses'}`
                  : `${filteredCourses.length} of ${appCourses.length}`}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            All courses across the application. Click any card to enter and study, remix a copy to your account, or manage it.
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          loading={refreshing}
          onClick={() => void loadCourses(true)}
          className="self-start sm:self-auto shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Search & Visibility Filter Bar */}
      {!loading && appCourses.length > 0 && (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search code, title, or owner email..."
              aria-label="Search application courses"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1.5 pl-8 pr-8 text-xs text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div
            role="tablist"
            aria-label="Filter application courses by visibility"
            className="inline-flex max-w-full flex-wrap items-center gap-0.5 self-start sm:self-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 p-0.5"
          >
            {(
              [
                { id: 'all' as const, label: 'All', count: counts.all },
                { id: 'public' as const, label: 'Public', count: counts.public },
                { id: 'private' as const, label: 'Private', count: counts.private },
              ]
            ).map((tab) => {
              const active = visibilityFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setVisibilityFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-zinc-950 dark:bg-zinc-200 text-white dark:text-zinc-950'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
                  }`}
                >
                  {tab.label}{' '}
                  <span className="font-mono text-[11px] opacity-75 tabular-nums">{tab.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {notice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
          <div className="flex items-center gap-2 min-w-0">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>{notice.message}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {notice.courseId && (
              <button
                type="button"
                onClick={() => {
                  const id = notice.courseId!;
                  setNotice(null);
                  void selectCourse(id);
                  navigate('/library');
                }}
                className="underline underline-offset-2 text-zinc-950 dark:text-zinc-100 hover:opacity-80 cursor-pointer"
              >
                Open remixed course
              </button>
            )}
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notice"
              className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Grid of Application Course Cards */}
      {loading ? (
        <LoadingSkeleton lines={4} />
      ) : appCourses.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No courses found across application accounts yet.
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
          No application courses match your current search or visibility filter.
        </div>
      ) : (
        <div className="responsive-course-grid">
          {filteredCourses.map((course) => {
            const cardKey = `${course.userId}:${course.id}`;
            const isActive = activeCourse?.id === course.id && (activeCourse.authorId || activeCourse.userId) === course.userId;
            const isMenuOpen = openMenuKey === cardKey;
            const isRemixing = remixingKey === cardKey;
            const isTogglingVis = togglingVisibilityKey === cardKey;
            const motif = pickMotif(course);
            const Icon = MOTIF_ICONS[motif];

            return (
              <div
                key={cardKey}
                className={`group relative min-w-0 rounded-2xl border p-4 sm:p-5 lg:p-6 min-h-[12.25rem] sm:min-h-[13.25rem] flex flex-col justify-between text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${
                  isMenuOpen ? 'z-30 shadow-md' : 'z-0'
                } ${
                  isActive
                    ? 'border-zinc-950 dark:border-zinc-300 bg-zinc-950 dark:bg-zinc-200 text-white dark:text-zinc-950 hover:bg-zinc-900 dark:hover:bg-zinc-300'
                    : isMenuOpen
                    ? 'border-zinc-900 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-200'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-200 hover:border-zinc-900 dark:hover:border-zinc-600'
                }`}
              >
                {/* Full-card click target -> Enter & Study */}
                <button
                  type="button"
                  onClick={() => handleEnterCourse(course)}
                  aria-label={`Enter and study ${course.code} ${course.name}`}
                  className="absolute inset-0 z-10 rounded-2xl cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 dark:focus-visible:outline-zinc-200"
                />

                {/* Top Row: Subject Icon + Visibility Status + More Menu */}
                <div className="relative z-20 flex items-start justify-between gap-2 pointer-events-none">
                  <span
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-xl shadow-xs transition-transform duration-200 group-hover:scale-105 ${
                      isActive
                        ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-200'
                        : 'bg-zinc-950 dark:bg-zinc-200 text-white dark:text-zinc-950'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>

                  <div className="flex items-center gap-1.5 pointer-events-auto">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                        course.isPublic
                          ? isActive
                            ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-800'
                            : 'border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                          : isActive
                          ? 'border-zinc-700 dark:border-zinc-400 bg-zinc-800 dark:bg-zinc-300 text-zinc-200 dark:text-zinc-800'
                          : 'border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {course.isPublic ? (
                        <Globe className="h-3 w-3 shrink-0" />
                      ) : (
                        <Lock className="h-3 w-3 shrink-0" />
                      )}
                      {course.isPublic ? 'Public' : 'Private'}
                    </span>

                    <div
                      ref={isMenuOpen ? menuRef : undefined}
                      className="relative"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuKey((prev) => (prev === cardKey ? null : cardKey));
                        }}
                        aria-haspopup="menu"
                        aria-expanded={isMenuOpen}
                        aria-label={`More options for ${course.name}`}
                        title="More options"
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors cursor-pointer ${
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
                            className="absolute right-0 top-full z-40 mt-2 w-48 max-w-[calc(100vw-2rem)] origin-top-right rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-1.5 shadow-lg"
                          >
                            <span
                              aria-hidden="true"
                              className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-l border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                            />
                            <div className="relative z-10 space-y-0.5">
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => handleEnterCourse(course)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                              >
                                <BookOpen className="h-3.5 w-3.5" />
                                Enter &amp; Study
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={isRemixing}
                                onClick={() => void handleRemixCourse(course)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
                              >
                                <CopyPlus className="h-3.5 w-3.5" />
                                Remix to my courses
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => handleManageCourse(course)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                              >
                                <Users className="h-3.5 w-3.5" />
                                Manage course
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenuKey(null);
                                  setEditingCourse(course);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit details
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={isTogglingVis}
                                onClick={() => void handleToggleVisibility(course)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {course.isPublic ? (
                                  <Lock className="h-3.5 w-3.5" />
                                ) : (
                                  <Globe className="h-3.5 w-3.5" />
                                )}
                                {course.isPublic ? 'Make private' : 'Make public'}
                              </button>
                              {course.isPublic && course.shareToken && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => void handleCopyInviteLink(course)}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  Copy invite link
                                </button>
                              )}
                              <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenuKey(null);
                                  setCourseToDelete(course);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete course
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Middle: Course Code, Title & Owner Email */}
                <div className="relative z-10 mt-5 min-w-0 pointer-events-none space-y-1.5">
                  <div
                    className={`flex flex-wrap items-center gap-1.5 text-xs ${
                      isActive ? 'text-zinc-400 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    <span
                      className={`font-mono font-medium truncate max-w-full ${
                        isActive ? 'text-zinc-200 dark:text-zinc-800' : 'text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      {course.code}
                    </span>
                    {isActive && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-white dark:text-zinc-950 shrink-0">Active</span>
                      </>
                    )}
                  </div>

                  <h3
                    className={`font-display text-base sm:text-lg font-semibold tracking-tight break-words line-clamp-2 ${
                      isActive ? 'text-white dark:text-zinc-950' : 'text-zinc-950 dark:text-zinc-200'
                    }`}
                  >
                    {course.name}
                  </h3>

                  <div
                    className={`flex items-center gap-1.5 text-xs min-w-0 ${
                      isActive ? 'text-zinc-300 dark:text-zinc-700' : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                    title={course.ownerEmail || course.authorName || course.userId}
                  >
                    <Mail className="h-3.5 w-3.5 shrink-0 opacity-75" />
                    <span className="truncate">
                      {course.ownerEmail || course.authorName || 'Unknown owner'}
                    </span>
                    {course.isOwner && (
                      <span className="shrink-0 opacity-70">(You)</span>
                    )}
                  </div>
                </div>

                {/* Footer Quick Actions: Remix + Manage */}
                <div
                  className={`relative z-20 mt-4 pt-3 border-t flex flex-wrap items-center justify-between gap-2 pointer-events-auto ${
                    isActive
                      ? 'border-zinc-800 dark:border-zinc-300'
                      : 'border-zinc-100 dark:border-zinc-800'
                  }`}
                >
                  <button
                    type="button"
                    disabled={isRemixing}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRemixCourse(course);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                      isActive
                        ? 'text-zinc-200 hover:bg-zinc-800 dark:text-zinc-800 dark:hover:bg-zinc-300'
                        : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                    }`}
                  >
                    {isRemixing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CopyPlus className="h-3.5 w-3.5" />
                    )}
                    {isRemixing ? 'Remixing...' : 'Remix'}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleManageCourse(course);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'text-zinc-200 hover:bg-zinc-800 dark:text-zinc-800 dark:hover:bg-zinc-300'
                        : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                    }`}
                  >
                    <Users className="h-3.5 w-3.5" />
                    Manage
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Application Course Modal */}
      <CourseModal
        open={Boolean(editingCourse)}
        initialCourse={editingCourse}
        onClose={() => setEditingCourse(null)}
        onSubmit={handleSaveEdit}
      />

      {/* Delete Application Course Confirmation Modal */}
      <Modal
        open={Boolean(courseToDelete)}
        title="Delete application course?"
        description={
          courseToDelete
            ? `Permanently delete "${courseToDelete.code} — ${courseToDelete.name}" owned by ${
                courseToDelete.ownerEmail || courseToDelete.authorName || 'this user'
              }? All its topics, materials, study sessions, and share links will be removed.`
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
    </section>
  );
};
