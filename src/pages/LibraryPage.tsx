import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Globe,
  GraduationCap,
  Lock,
  Search,
  Share2,
  SlidersHorizontal,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { MaterialType, SavedMaterialType, Topic } from '../types/models';
import { useAuth } from '../context/AuthContext';
import {
  useBackgroundIngestion,
  type BackgroundIngestionJob,
} from '../context/BackgroundIngestionContext';
import { useCourses } from '../context/CourseContext';
import { useWorkspaceUi } from '../context/WorkspaceUiContext';
import { useCourseSources } from '../hooks/useCourseSources';
import { useRouter } from '../router/RouterContext';
import { adminSetApplicationCourseVisibility } from '../services/firebase/adminCourseService';
import { formatReadableError } from '../services/firebase/errors';
import { buildCourseInviteUrl } from '../services/firebase/sharedCourseService';
import {
  countUncertainMarkers,
  MATERIAL_TYPE_LABELS,
} from '../services/ingestion/structureParser';
import { deleteLocalDraft, getLocalDraft } from '../services/local/indexedDb';
import { formatShortDate } from '../utils/validation';
import { CourseModal } from '../components/courses/CourseModal';
import { RevokedCourseNotice } from '../components/courses/RevokedCourseNotice';
import {
  ImportMaterialModal,
  type ExtractionDraftPayload,
} from '../components/library/ImportMaterialModal';
import { ProcessingSourceCard } from '../components/library/ProcessingSourceCard';
import { SourceViewer } from '../components/library/SourceViewer';
import {
  SAVED_MATERIAL_TYPE_LABELS,
  SavedMaterialsView,
} from '../components/library/SavedMaterialsView';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EmptyState, ErrorBanner, LoadingSkeleton } from '../components/ui/StateViews';

export const LibraryPage: React.FC = () => {
  const { user } = useAuth();
  const {
    courses,
    ownedCourses,
    activeCourse,
    activeContentOwnerId,
    activeCourseAccessRevoked,
    activeMemberGroupName,
    topics,
    coursesLoading,
    selectCourse,
    createCourse,
    setCourseVisibility,
    updateExternalCourseState,
  } = useCourses();
  const { navigate } = useRouter();
  const { setHideHeader, setHideBottomNav, setLockViewport } = useWorkspaceUi();
  const {
    getJobsForCourse,
    cancelJob,
    retryJob,
    dismissJob,
    consumeReadyJob,
  } = useBackgroundIngestion();

  const {
    sources,
    loading: sourcesLoading,
    error: sourcesError,
    clearError: clearSourcesError,
  } = useCourseSources(activeContentOwnerId, activeCourse?.id);

  const isOwner = Boolean(activeCourse?.isOwner);

  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [togglingPublic, setTogglingPublic] = useState(false);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<ExtractionDraftPayload | null>(null);
  const [useRestoredDraft, setUseRestoredDraft] = useState(false);
  const [reviewingJobDraft, setReviewingJobDraft] = useState<ExtractionDraftPayload | null>(null);

  const [materialTypeFilter, setMaterialTypeFilter] = useState<MaterialType | 'all'>('all');
  const [savedTypeFilter, setSavedTypeFilter] = useState<SavedMaterialType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [savedReaderOpen, setSavedReaderOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'sources' | 'saved'>('sources');
  const [actionError, setActionError] = useState<string | null>(null);

  const filterMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const draftKey =
    user && activeCourse && isOwner ? `ingestion_draft:${user.uid}:${activeCourse.id}` : '';

  const activeSource = useMemo(
    () => (activeSourceId ? sources.find((s) => s.id === activeSourceId) ?? null : null),
    [sources, activeSourceId]
  );

  // Lock page viewport on the main Library list so ONLY the list/cards section scrolls;
  // unlock when viewing a full-page reader, revoked notice, or onboarding empty state.
  const isMainLibraryView =
    !coursesLoading &&
    courses.length > 0 &&
    Boolean(activeCourse) &&
    Boolean(user) &&
    !activeCourseAccessRevoked &&
    !activeSource &&
    !savedReaderOpen;

  const isReaderView =
    !coursesLoading &&
    courses.length > 0 &&
    Boolean(activeCourse) &&
    Boolean(user) &&
    !activeCourseAccessRevoked &&
    (Boolean(activeSource) || savedReaderOpen);

  useEffect(() => {
    setLockViewport(isMainLibraryView);
    return () => setLockViewport(false);
  }, [isMainLibraryView, setLockViewport]);

  // Hide application header on back-nav reader views and during focused search
  useEffect(() => {
    setHideHeader(isReaderView || (isMainLibraryView && searchFocused));
    return () => setHideHeader(false);
  }, [isReaderView, isMainLibraryView, searchFocused, setHideHeader]);

  // Hide bottom pill nav on back-nav reader views (SourceViewer & SavedMaterials reader)
  useEffect(() => {
    setHideBottomNav(isReaderView);
    return () => setHideBottomNav(false);
  }, [isReaderView, setHideBottomNav]);

  // Close type filter tooltip menu on outside click or Escape
  useEffect(() => {
    if (!filterMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setFilterMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilterMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [filterMenuOpen]);

  // Reset filters & check for recoverable extraction draft when active course changes
  useEffect(() => {
    setMaterialTypeFilter('all');
    setSavedTypeFilter('all');
    setSearchQuery('');
    setSearchFocused(false);
    setFilterMenuOpen(false);
    setShareModalOpen(false);
    setShareError(null);
    setCopiedShareLink(false);
    setActiveSourceId(null);
    setSavedReaderOpen(false);
    setPendingDraft(null);
    setUseRestoredDraft(false);

    if (!draftKey) return;
    let cancelled = false;
    void getLocalDraft(draftKey).then((draft) => {
      if (!cancelled && draft?.payload && typeof draft.payload.extractedContent === 'string') {
        setPendingDraft(draft.payload as unknown as ExtractionDraftPayload);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  const topicMap = useMemo(() => {
    const map = new Map<string, Topic>();
    topics.forEach((t) => map.set(t.id, t));
    return map;
  }, [topics]);

  const courseJobs = useMemo(
    () => (activeCourse && isOwner ? getJobsForCourse(activeCourse.id) : []),
    [activeCourse, isOwner, getJobsForCourse]
  );

  const activeCourseJobsCount = useMemo(
    () =>
      courseJobs.filter(
        (j) => j.status === 'queued' || j.status === 'extracting' || j.status === 'saving'
      ).length,
    [courseJobs]
  );

  const visibleCourseJobs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return courseJobs.filter((job) => {
      if (q) {
        const matchTitle = job.title.toLowerCase().includes(q);
        const matchFile = job.fileName.toLowerCase().includes(q);
        if (!matchTitle && !matchFile) return false;
      }
      return true;
    });
  }, [courseJobs, searchQuery]);

  const handleReviewBackgroundJob = async (job: BackgroundIngestionJob) => {
    const result = await consumeReadyJob(job.id);
    if (!result) return;
    setReviewingJobDraft({
      title: result.title,
      materialType: result.materialType,
      courseId: job.courseId,
      topicId: job.topicId,
      extractedContent: result.extractedContent,
      sections: result.sections,
      pageOrSlideCount: result.pageOrSlideCount,
      originalFileName: result.originalFileName,
      warnings: result.warnings,
    });
    setUseRestoredDraft(false);
    setImportModalOpen(true);
  };

  const filteredSources = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sources.filter((src) => {
      if (materialTypeFilter !== 'all' && src.materialType !== materialTypeFilter) {
        return false;
      }
      if (q) {
        const inTitle = src.title.toLowerCase().includes(q);
        const inContent = src.extractedContent.toLowerCase().includes(q);
        const inNotes = src.studentNotes.toLowerCase().includes(q);
        const inFile = src.originalFileName.toLowerCase().includes(q);
        if (!inTitle && !inContent && !inNotes && !inFile) return false;
      }
      return true;
    });
  }, [sources, materialTypeFilter, searchQuery]);

  if (coursesLoading) {
    return <LoadingSkeleton lines={4} />;
  }

  if (!activeCourse || !user) {
    return (
      <div>
        <div className="border-b border-zinc-200 dark:border-zinc-800 pb-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
            Library
          </h1>
          <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
            Your personal academic knowledge base for lecture slides, textbooks, and notes.
          </p>
        </div>
        <EmptyState
          title="Start by creating a course"
          description="Create your first course to upload PDFs, PowerPoint decks, textbook photos, handwritten notes, or typed study materials."
          actionLabel="Create your first course"
          onAction={() => setCourseModalOpen(true)}
        />
        <CourseModal
          open={courseModalOpen}
          onClose={() => setCourseModalOpen(false)}
          onSubmit={async (input) => {
            await createCourse(input);
          }}
        />
      </div>
    );
  }

  if (activeCourseAccessRevoked) {
    return <RevokedCourseNotice course={activeCourse} pageTitle="Library" />;
  }

  // Dedicated full-width structured source reader view
  if (activeSource) {
    return (
      <SourceViewer
        userId={user.uid}
        source={activeSource}
        courses={ownedCourses}
        activeCourse={activeCourse}
        topics={topics}
        isOwner={isOwner}
        onBack={() => setActiveSourceId(null)}
        onOpenLive={() => navigate(`/live/${activeSource.id}`)}
        onMovedToAnotherCourse={(targetCourseId) => {
          setActiveSourceId(null);
          void selectCourse(targetCourseId);
        }}
        onDeleted={() => setActiveSourceId(null)}
      />
    );
  }

  const canShareCourse = isOwner || Boolean(activeCourse.isAdminAccess);
  const shareInviteUrl = activeCourse.shareToken
    ? buildCourseInviteUrl(activeCourse.shareToken)
    : '';
  const supportsNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleToggleCoursePublic = async () => {
    setTogglingPublic(true);
    setShareError(null);
    try {
      if (activeCourse.isAdminAccess && !isOwner) {
        const result = await adminSetApplicationCourseVisibility(
          activeCourse,
          !activeCourse.isPublic
        );
        updateExternalCourseState((prev) =>
          prev && prev.id === activeCourse.id
            ? { ...prev, isPublic: result.isPublic, shareToken: result.shareToken }
            : prev
        );
      } else {
        await setCourseVisibility(activeCourse.id, !activeCourse.isPublic);
      }
    } catch (err) {
      setShareError(formatReadableError(err));
    } finally {
      setTogglingPublic(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareInviteUrl) return;
    setShareError(null);
    try {
      await navigator.clipboard.writeText(shareInviteUrl);
      setCopiedShareLink(true);
      window.setTimeout(() => setCopiedShareLink(false), 2200);
    } catch {
      setShareError('Unable to copy automatically. Select and copy the link manually.');
    }
  };

  const handleNativeShareCourse = async () => {
    if (!shareInviteUrl || !supportsNativeShare) return;
    setShareError(null);
    try {
      await navigator.share({
        title: `${activeCourse.code} — ${activeCourse.name}`,
        text: `Join ${activeCourse.code} (${activeCourse.name}) on Jovibe Study`,
        url: shareInviteUrl,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      void handleCopyShareLink();
    }
  };

  const currentTypeFilter = activeTab === 'sources' ? materialTypeFilter : savedTypeFilter;
  const currentTypeOptions: Array<{ value: string; label: string }> =
    activeTab === 'sources'
      ? [
          { value: 'all', label: 'All types' },
          ...(Object.keys(MATERIAL_TYPE_LABELS) as MaterialType[]).map((key) => ({
            value: key,
            label: MATERIAL_TYPE_LABELS[key],
          })),
        ]
      : [
          { value: 'all', label: 'All types' },
          ...(Object.keys(SAVED_MATERIAL_TYPE_LABELS) as SavedMaterialType[]).map((key) => ({
            value: key,
            label: SAVED_MATERIAL_TYPE_LABELS[key],
          })),
        ];

  const activeFilterLabel =
    currentTypeOptions.find((o) => o.value === currentTypeFilter)?.label || 'All types';

  const handleSelectTypeFilter = (val: string) => {
    if (activeTab === 'sources') {
      setMaterialTypeFilter(val as MaterialType | 'all');
    } else {
      setSavedTypeFilter(val as SavedMaterialType | 'all');
    }
    setFilterMenuOpen(false);
  };

  const handleExitSearchFocus = () => {
    setSearchFocused(false);
    setFilterMenuOpen(false);
    searchInputRef.current?.blur();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Fixed Non-Scrolling Top Area */}
      <div className="shrink-0 space-y-4 pb-3">
        {/* Everything above the search field hides smoothly when search is focused */}
        {!searchFocused && !savedReaderOpen && (
          <div className="space-y-3 border-b border-zinc-200 dark:border-zinc-800 pb-4">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200 truncate">
                {activeCourse.name}
              </h1>
              {!isOwner && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {activeCourse.isAdminAccess ? (
                    <>
                      Application course · Owner: {activeCourse.ownerEmail || activeCourse.authorName || 'User'} ·{' '}
                      {activeCourse.isPublic ? 'Public' : 'Private'}
                    </>
                  ) : (
                    <>
                      Shared by {activeCourse.authorName || 'Course Author'}
                      {activeMemberGroupName ? ` · ${activeMemberGroupName}` : ''}
                      {' · Materials managed by author'}
                    </>
                  )}
                </p>
              )}
              {activeCourse.description && (
                <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400 line-clamp-1">
                  {activeCourse.description}
                </p>
              )}
            </div>

            {/* Action Row: (Owner: Add material) + Study + (Owner/Admin: Share) on left; Manage + History on right */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
                {isOwner && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setReviewingJobDraft(null);
                      setUseRestoredDraft(false);
                      setImportModalOpen(true);
                    }}
                    className="px-2.5 sm:px-3"
                  >
                    <Upload className="h-3.5 w-3.5 shrink-0" />
                    Add material
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate('/automatic-study')}
                  className="px-2.5 sm:px-3"
                >
                  <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                  Study
                </Button>
                {canShareCourse && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setShareError(null);
                      setCopiedShareLink(false);
                      setShareModalOpen(true);
                    }}
                    className="px-2.5 sm:px-3"
                  >
                    <Share2 className="h-3.5 w-3.5 shrink-0" />
                    Share
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {(isOwner || activeCourse.isAdminAccess) && (
                  <button
                    type="button"
                    onClick={() => navigate(`/manage-course/${activeCourse.id}`)}
                    aria-label="Share and manage course"
                    title="Manage course"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                  >
                    <Users className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate('/history')}
                  aria-label="Study history"
                  title="Study history"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  <Clock className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search Field + Tooltip Popover Types Filter (Same Row) */}
        {!savedReaderOpen && (
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onFocus={() => setSearchFocused(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    handleExitSearchFocus();
                  }
                }}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  activeTab === 'sources'
                    ? 'Search titles, extracted content, or notes...'
                    : `Search saved materials in ${activeCourse.code}...`
                }
                aria-label="Search library"
                className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-2 pl-9 pr-8 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Types Filter Tooltip Popup Menu */}
            <div ref={filterMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setFilterMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={filterMenuOpen}
                aria-label={`Filter by type: ${activeFilterLabel}`}
                className={`inline-flex h-[38px] items-center gap-1.5 rounded-md border px-3 text-sm transition-colors cursor-pointer ${
                  currentTypeFilter !== 'all'
                    ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950'
                    : 'border-zinc-300 bg-white text-zinc-800 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[100px] sm:max-w-[130px] truncate text-xs font-medium">
                  {activeFilterLabel}
                </span>
              </button>

              <AnimatePresence>
                {filterMenuOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.14 }}
                    className="absolute right-0 z-40 mt-2.5 w-52 max-w-[calc(100vw-1.5rem)] origin-top-right rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1.5 shadow-lg dark:shadow-black/40"
                  >
                    {/* Tooltip pointer arrow */}
                    <span
                      aria-hidden="true"
                      className="absolute -top-1.5 right-4 h-3 w-3 rotate-45 border-l border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                    />
                    <div className="relative z-10 max-h-64 overflow-y-auto space-y-0.5">
                      {currentTypeOptions.map((opt) => {
                        const isSelected = currentTypeFilter === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={isSelected}
                            onClick={() => handleSelectTypeFilter(opt.value)}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-zinc-950 text-white dark:bg-zinc-200 dark:text-zinc-950 font-medium'
                                : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                            }`}
                          >
                            <span className="truncate">{opt.label}</span>
                            {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Exit Search Focus Mode */}
            {searchFocused && (
              <button
                type="button"
                onClick={handleExitSearchFocus}
                className="shrink-0 rounded-md px-2 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
              >
                Done
              </button>
            )}
          </div>
        )}

        {/* Centered Animated Sliding Pill Switch: placed AFTER Search & Filter */}
        {!savedReaderOpen && (
          <div className="flex justify-center pt-0.5">
            <div
              role="tablist"
              aria-label="Library sections"
              className="inline-flex max-w-full flex-wrap justify-center items-center gap-0.5 rounded-2xl sm:rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 p-1"
            >
              {(
                [
                  { id: 'sources' as const, label: 'Course Sources', count: sources.length },
                  { id: 'saved' as const, label: 'Saved Materials', count: null },
                ]
              ).map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => {
                      setActiveTab(item.id);
                      setFilterMenuOpen(false);
                    }}
                    className={`relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'text-white dark:text-zinc-950'
                        : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="library-tab-pill"
                        transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                        className="absolute inset-0 rounded-full bg-zinc-950 dark:bg-zinc-200"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative z-10 inline-flex items-center gap-1.5">
                      <span>{item.label}</span>
                      {item.count !== null && (
                        <span
                          className={`font-mono text-xs tabular-nums ${
                            isActive
                              ? 'text-zinc-300 dark:text-zinc-700'
                              : 'text-zinc-400 dark:text-zinc-500'
                          }`}
                        >
                          {item.count}
                        </span>
                      )}
                      {item.id === 'sources' && activeCourseJobsCount > 0 && (
                        <span
                          aria-label={`${activeCourseJobsCount} processing in background`}
                          className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Unsaved Extraction Draft Recovery Banner */}
        {isOwner && pendingDraft && activeTab === 'sources' && !searchFocused && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 text-xs sm:text-sm">
            <div className="truncate">
              <span className="font-medium text-zinc-950 dark:text-zinc-200">Unsaved draft:</span>{' '}
              <span className="text-zinc-700 dark:text-zinc-300">{pendingDraft.title || 'Untitled Material'}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                onClick={() => {
                  setUseRestoredDraft(true);
                  setImportModalOpen(true);
                }}
              >
                Resume
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void deleteLocalDraft(draftKey);
                  setPendingDraft(null);
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        )}

        {(actionError || sourcesError) && (
          <ErrorBanner
            message={actionError || sourcesError || ''}
            onDismiss={() => {
              setActionError(null);
              clearSourcesError();
            }}
          />
        )}
      </div>

      {/* ONLY THIS SECTION SCROLLS: Materials & Notes List */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-hide pb-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            {activeTab === 'saved' ? (
          <SavedMaterialsView
            courseId={activeCourse.id}
            courseCode={activeCourse.code}
            topics={topics}
            selectedTopicId="all"
            externalSearchQuery={searchQuery}
            externalTypeFilter={savedTypeFilter}
            onClearExternalFilters={() => {
              setSearchQuery('');
              setSavedTypeFilter('all');
            }}
            onReaderOpenChange={setSavedReaderOpen}
          />
        ) : sourcesLoading && sources.length === 0 && visibleCourseJobs.length === 0 ? (
          <LoadingSkeleton lines={4} />
        ) : sources.length === 0 && visibleCourseJobs.length === 0 ? (
          isOwner ? (
            <EmptyState
              title={`No study materials in ${activeCourse.code} yet`}
              description="Upload PDFs, PowerPoint decks (.pptx), photographs of textbook pages or handwritten notes, or paste typed notes. Extracted content is structured, editable before saving, and cloud-synced across your devices."
              actionLabel="Add your first material"
              onAction={() => {
                setReviewingJobDraft(null);
                setUseRestoredDraft(false);
                setImportModalOpen(true);
              }}
            />
          ) : (
            <EmptyState
              title={`No materials in ${activeCourse.code} yet`}
              description={`Course materials are managed by ${activeCourse.authorName || 'the course author'}. New uploads will appear here automatically.`}
            />
          )
        ) : filteredSources.length === 0 && visibleCourseJobs.length === 0 ? (
          <div className="border-t border-zinc-200 dark:border-zinc-800 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No materials match your current search or filter.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Background Extraction Skeleton Cards */}
            {visibleCourseJobs.length > 0 && (
              <div className="space-y-2.5 pt-1">
                <AnimatePresence initial={false}>
                  {visibleCourseJobs.map((job) => {
                    const jobTopicName = job.topicId ? topicMap.get(job.topicId)?.name : null;
                    return (
                      <ProcessingSourceCard
                        key={job.id}
                        job={job}
                        topicName={jobTopicName}
                        onCancel={(id) => void cancelJob(id)}
                        onRetry={(id) => void retryJob(id)}
                        onDismiss={(id) => void dismissJob(id)}
                        onReview={(j) => void handleReviewBackgroundJob(j)}
                        onOpenSavedSource={(sourceId, jobId) => {
                          void dismissJob(jobId);
                          setSearchFocused(false);
                          setActiveSourceId(sourceId);
                        }}
                      />
                    );
                  })}
                </AnimatePresence>
              </div>
            )}

            {filteredSources.length > 0 && (
              <div className="border-t border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredSources.map((src) => {
                  const topicName = src.topicId ? topicMap.get(src.topicId)?.name : null;
                  const uncertain = countUncertainMarkers(src.extractedContent);
                  const snippet = src.extractedContent
                    .replace(/^#+\s*/gm, '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 170);

                  return (
                    <button
                      key={src.id}
                      type="button"
                      onClick={() => {
                        setSearchFocused(false);
                        setActiveSourceId(src.id);
                      }}
                      className="group block w-full py-4 text-left hover:bg-zinc-50/80 dark:hover:bg-zinc-900/70 px-2 rounded-md transition-colors cursor-pointer"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {MATERIAL_TYPE_LABELS[src.materialType]}
                          </span>
                          {topicName && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{topicName}</span>
                            </>
                          )}
                          {src.pageOrSlideCount > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">
                                {src.pageOrSlideCount}{' '}
                                {src.materialType === 'slides'
                                  ? src.pageOrSlideCount === 1
                                    ? 'slide'
                                    : 'slides'
                                  : src.pageOrSlideCount === 1
                                  ? 'page'
                                  : 'pages'}
                              </span>
                            </>
                          )}
                          {src.sections.length > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">
                                {src.sections.length}{' '}
                                {src.sections.length === 1 ? 'section' : 'sections'}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2 tabular-nums">
                          {uncertain > 0 && (
                            <span className="inline-flex items-center gap-1 font-medium text-zinc-900 dark:text-zinc-200">
                              <AlertTriangle className="h-3 w-3" />
                              {uncertain} to review
                            </span>
                          )}
                          <span>{formatShortDate(src.updatedAt)}</span>
                        </div>
                      </div>

                      <h3 className="mt-1.5 text-base font-medium text-zinc-950 dark:text-zinc-200 group-hover:underline underline-offset-4">
                        {src.title}
                      </h3>

                      {snippet && (
                        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">{snippet}</p>
                      )}

                      {isOwner && src.studentNotes.trim() && (
                        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">
                          Note: {src.studentNotes.trim()}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Share Course Modal */}
      {canShareCourse && (
        <Modal
          open={shareModalOpen}
          title={`Share ${activeCourse.code}`}
          description={`Make "${activeCourse.name}" public to generate an invite link so others can join and study from this library.`}
          onClose={() => {
            setShareModalOpen(false);
            setShareError(null);
          }}
        >
          <div className="space-y-4">
            {shareError && (
              <ErrorBanner message={shareError} onDismiss={() => setShareError(null)} />
            )}

            <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                  {activeCourse.isPublic ? (
                    <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                    {activeCourse.isPublic ? 'Public shared course' : 'Private course'}
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {activeCourse.isPublic
                      ? 'Anyone with the invite link can join and study your materials. Only you can upload or edit materials.'
                      : 'Only visible to your account. Switch to public to get a shareable invite link.'}
                  </p>
                </div>
              </div>

              <Button
                variant={activeCourse.isPublic ? 'secondary' : 'primary'}
                size="sm"
                loading={togglingPublic}
                onClick={() => void handleToggleCoursePublic()}
                className="shrink-0"
              >
                {activeCourse.isPublic ? 'Make private' : 'Make public'}
              </Button>
            </div>

            {activeCourse.isPublic && shareInviteUrl && (
              <div className="space-y-2">
                <label
                  htmlFor="library-course-share-link"
                  className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Shareable invite link
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    id="library-course-share-link"
                    type="text"
                    readOnly
                    value={shareInviteUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-900 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" onClick={() => void handleCopyShareLink()}>
                      {copiedShareLink ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedShareLink ? 'Copied' : 'Copy link'}
                    </Button>
                    {supportsNativeShare && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleNativeShareCourse()}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Share
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShareModalOpen(false);
                  navigate(`/manage-course/${activeCourse.id}`);
                }}
              >
                <Users className="h-3.5 w-3.5" />
                Manage members &amp; link
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShareModalOpen(false);
                  setShareError(null);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Owner-only Import Modal */}
      {isOwner && (
        <ImportMaterialModal
          open={importModalOpen}
          userId={user.uid}
          courses={ownedCourses}
          activeCourse={activeCourse}
          topics={topics}
          initialTopicId=""
          restoredDraft={reviewingJobDraft ?? (useRestoredDraft ? pendingDraft : null)}
          draftKey={draftKey}
          onClose={() => {
            setImportModalOpen(false);
            setReviewingJobDraft(null);
          }}
          onBackgrounded={(targetCourseId) => {
            setImportModalOpen(false);
            setReviewingJobDraft(null);
            setActiveTab('sources');
            if (targetCourseId && targetCourseId !== activeCourse.id) {
              void selectCourse(targetCourseId);
            }
          }}
          onSaved={(sourceId, savedCourseId) => {
            setImportModalOpen(false);
            setReviewingJobDraft(null);
            setPendingDraft(null);
            setUseRestoredDraft(false);
            if (savedCourseId !== activeCourse.id) {
              void selectCourse(savedCourseId);
            } else {
              setActiveSourceId(sourceId);
            }
          }}
        />
      )}
    </div>
  );
};
