import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Check,
  Clock,
  Folder,
  GraduationCap,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { MaterialType, SavedMaterialType, Topic } from '../types/models';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { useWorkspaceUi } from '../context/WorkspaceUiContext';
import { useCourseSources } from '../hooks/useCourseSources';
import { useRouter } from '../router/RouterContext';
import { formatReadableError } from '../services/firebase/errors';
import {
  countUncertainMarkers,
  MATERIAL_TYPE_LABELS,
} from '../services/ingestion/structureParser';
import { deleteLocalDraft, getLocalDraft } from '../services/local/indexedDb';
import { formatShortDate } from '../utils/validation';
import { CourseModal } from '../components/courses/CourseModal';
import { TopicModal } from '../components/courses/TopicModal';
import {
  ImportMaterialModal,
  type ExtractionDraftPayload,
} from '../components/library/ImportMaterialModal';
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
    activeCourse,
    topics,
    coursesLoading,
    topicsLoading,
    selectCourse,
    createCourse,
    createTopic,
    updateTopic,
    deleteTopic,
  } = useCourses();
  const { navigate } = useRouter();
  const { setHideHeader, setHideBottomNav, setLockViewport } = useWorkspaceUi();

  const {
    sources,
    loading: sourcesLoading,
    error: sourcesError,
    clearError: clearSourcesError,
  } = useCourseSources(user?.uid, activeCourse?.id);

  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [topicsListOpen, setTopicsListOpen] = useState(false);
  const [topicModalOpen, setTopicModalOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [topicToDelete, setTopicToDelete] = useState<Topic | null>(null);
  const [deletingTopic, setDeletingTopic] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<ExtractionDraftPayload | null>(null);
  const [useRestoredDraft, setUseRestoredDraft] = useState(false);

  const [selectedTopicId, setSelectedTopicId] = useState<string>('all');
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

  const draftKey = user && activeCourse ? `ingestion_draft:${user.uid}:${activeCourse.id}` : '';

  const activeSource = useMemo(
    () => (activeSourceId ? sources.find((s) => s.id === activeSourceId) ?? null : null),
    [sources, activeSourceId]
  );

  // Lock page viewport on the main Library list so ONLY the list/cards section scrolls;
  // unlock when viewing a full-page reader or onboarding empty state.
  const isMainLibraryView =
    !coursesLoading && courses.length > 0 && Boolean(activeCourse) && Boolean(user) && !activeSource && !savedReaderOpen;

  const isReaderView =
    !coursesLoading && courses.length > 0 && Boolean(activeCourse) && Boolean(user) && (Boolean(activeSource) || savedReaderOpen);

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
    setSelectedTopicId('all');
    setMaterialTypeFilter('all');
    setSavedTypeFilter('all');
    setSearchQuery('');
    setSearchFocused(false);
    setFilterMenuOpen(false);
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

  const filteredSources = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sources.filter((src) => {
      if (selectedTopicId === 'unassigned' && src.topicId !== '') return false;
      if (selectedTopicId !== 'all' && selectedTopicId !== 'unassigned' && src.topicId !== selectedTopicId) {
        return false;
      }
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
  }, [sources, selectedTopicId, materialTypeFilter, searchQuery]);

  if (coursesLoading) {
    return <LoadingSkeleton lines={4} />;
  }

  if (courses.length === 0 || !activeCourse || !user) {
    return (
      <div>
        <div className="border-b border-zinc-200 pb-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950">
            Library
          </h1>
          <p className="mt-1.5 text-sm text-zinc-600">
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

  // Dedicated full-width structured source reader view
  if (activeSource) {
    return (
      <SourceViewer
        userId={user.uid}
        source={activeSource}
        courses={courses}
        activeCourse={activeCourse}
        topics={topics}
        onBack={() => setActiveSourceId(null)}
        onMovedToAnotherCourse={(targetCourseId) => {
          setActiveSourceId(null);
          void selectCourse(targetCourseId);
        }}
        onDeleted={() => setActiveSourceId(null)}
      />
    );
  }

  const handleConfirmDeleteTopic = async () => {
    if (!topicToDelete) return;
    setDeletingTopic(true);
    setActionError(null);
    try {
      await deleteTopic(topicToDelete.id);
      if (selectedTopicId === topicToDelete.id) {
        setSelectedTopicId('all');
      }
      setTopicToDelete(null);
    } catch (err) {
      setActionError(formatReadableError(err));
    } finally {
      setDeletingTopic(false);
    }
  };

  const unassignedCount = sources.filter((s) => !s.topicId).length;
  const activeTopicLabel =
    selectedTopicId === 'all'
      ? 'Topics'
      : selectedTopicId === 'unassigned'
      ? 'Unassigned'
      : topicMap.get(selectedTopicId)?.name || 'Topics';

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
          <div className="space-y-3 border-b border-zinc-200 pb-4">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 truncate">
                {activeCourse.name}
              </h1>
              {activeCourse.description && (
                <p className="mt-1 max-w-2xl text-sm text-zinc-600 line-clamp-1">
                  {activeCourse.description}
                </p>
              )}
            </div>

            {/* Action Row: Topics + Add material + Study on left; History + Add Topic icon buttons on right */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setTopicsListOpen(true)}
                  className="px-2.5 sm:px-3"
                >
                  <Folder className="h-3.5 w-3.5" />
                  <span className="max-w-[90px] sm:max-w-[120px] truncate">{activeTopicLabel}</span>
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setUseRestoredDraft(false);
                    setImportModalOpen(true);
                  }}
                  className="px-2.5 sm:px-3"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Add material
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate('/automatic-study')}
                  className="px-2.5 sm:px-3"
                >
                  <GraduationCap className="h-3.5 w-3.5" />
                  Study
                </Button>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => navigate('/history')}
                  aria-label="Study history"
                  title="Study history"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-950 transition-colors cursor-pointer"
                >
                  <Clock className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTopic(null);
                    setTopicModalOpen(true);
                  }}
                  aria-label="Add topic"
                  title="Add topic"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-950 transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search Field + Tooltip Popover Types Filter (Same Row) */}
        {!savedReaderOpen && (
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
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
                className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-8 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-950 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-900 cursor-pointer"
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
                    ? 'border-zinc-950 bg-zinc-950 text-white'
                    : 'border-zinc-300 bg-white text-zinc-800 hover:border-zinc-400 hover:bg-zinc-50'
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
                    className="absolute right-0 z-40 mt-2.5 w-52 origin-top-right rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg"
                  >
                    {/* Tooltip pointer arrow */}
                    <span
                      aria-hidden="true"
                      className="absolute -top-1.5 right-4 h-3 w-3 rotate-45 border-l border-t border-zinc-200 bg-white"
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
                                ? 'bg-zinc-950 text-white font-medium'
                                : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950'
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
                className="shrink-0 rounded-md px-2 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-950 cursor-pointer"
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
              className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 p-1"
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
                      isActive ? 'text-white' : 'text-zinc-600 hover:text-zinc-950'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="library-tab-pill"
                        transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                        className="absolute inset-0 rounded-full bg-zinc-950"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative z-10 inline-flex items-center gap-1.5">
                      <span>{item.label}</span>
                      {item.count !== null && (
                        <span
                          className={`font-mono text-xs tabular-nums ${
                            isActive ? 'text-zinc-300' : 'text-zinc-400'
                          }`}
                        >
                          {item.count}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Unsaved Extraction Draft Recovery Banner */}
        {pendingDraft && activeTab === 'sources' && !searchFocused && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-xs sm:text-sm">
            <div className="truncate">
              <span className="font-medium text-zinc-950">Unsaved draft:</span>{' '}
              <span className="text-zinc-700">{pendingDraft.title || 'Untitled Material'}</span>
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
            selectedTopicId={selectedTopicId}
            externalSearchQuery={searchQuery}
            externalTypeFilter={savedTypeFilter}
            onClearExternalFilters={() => {
              setSearchQuery('');
              setSavedTypeFilter('all');
              setSelectedTopicId('all');
            }}
            onReaderOpenChange={setSavedReaderOpen}
          />
        ) : sourcesLoading && sources.length === 0 ? (
          <LoadingSkeleton lines={4} />
        ) : sources.length === 0 ? (
          <EmptyState
            title={`No study materials in ${activeCourse.code} yet`}
            description="Upload PDFs, PowerPoint decks (.pptx), photographs of textbook pages or handwritten notes, or paste typed notes. Extracted content is structured, editable before saving, and cloud-synced across your devices."
            actionLabel="Add your first material"
            onAction={() => {
              setUseRestoredDraft(false);
              setImportModalOpen(true);
            }}
          />
        ) : filteredSources.length === 0 ? (
          <div className="border-t border-zinc-200 py-10 text-center text-sm text-zinc-500">
            No materials match your current search or filter.
          </div>
        ) : (
          <div className="border-t border-zinc-200 divide-y divide-zinc-200">
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
                  className="group block w-full py-4 text-left hover:bg-zinc-50/80 px-2 rounded-md transition-colors cursor-pointer"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-700">
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
                        <span className="inline-flex items-center gap-1 font-medium text-zinc-900">
                          <AlertTriangle className="h-3 w-3" />
                          {uncertain} to review
                        </span>
                      )}
                      <span>{formatShortDate(src.updatedAt)}</span>
                    </div>
                  </div>

                  <h3 className="mt-1.5 text-base font-medium text-zinc-950 group-hover:underline underline-offset-4">
                    {src.title}
                  </h3>

                  {snippet && (
                    <p className="mt-1 text-sm text-zinc-600 line-clamp-2">{snippet}</p>
                  )}

                  {src.studentNotes.trim() && (
                    <p className="mt-1.5 text-xs text-zinc-500 truncate">
                      Note: {src.studentNotes.trim()}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Scrollable Topics Picker Popup Modal */}
      <Modal
        open={topicsListOpen}
        title="Choose a topic"
        description={`Filter ${activeCourse.code} materials by topic or manage your topics.`}
        onClose={() => setTopicsListOpen(false)}
      >
        <div className="space-y-4">
          <div className="max-h-[55vh] overflow-y-auto scrollbar-hide space-y-1">
            <button
              type="button"
              onClick={() => {
                setSelectedTopicId('all');
                setTopicsListOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm cursor-pointer transition-colors ${
                selectedTopicId === 'all'
                  ? 'bg-zinc-950 text-white font-medium'
                  : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950'
              }`}
            >
              <span>All materials</span>
              <span className="font-mono text-xs opacity-70 tabular-nums">{sources.length}</span>
            </button>

            {unassignedCount > 0 && topics.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedTopicId('unassigned');
                  setTopicsListOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm cursor-pointer transition-colors ${
                  selectedTopicId === 'unassigned'
                    ? 'bg-zinc-950 text-white font-medium'
                    : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950'
                }`}
              >
                <span>General / Unassigned</span>
                <span className="font-mono text-xs opacity-70 tabular-nums">{unassignedCount}</span>
              </button>
            )}

            {topicsLoading ? (
              <div className="pt-2">
                <LoadingSkeleton lines={3} />
              </div>
            ) : topics.length === 0 ? (
              <p className="px-3 py-4 text-xs text-zinc-500">
                No topics in {activeCourse.code} yet. Create one below or add one when uploading a material or note.
              </p>
            ) : (
              topics.map((topic) => {
                const selected = selectedTopicId === topic.id;
                const count = sources.filter((s) => s.topicId === topic.id).length;
                return (
                  <div
                    key={topic.id}
                    className={`flex items-center justify-between rounded-md transition-colors ${
                      selected
                        ? 'bg-zinc-950 text-white'
                        : 'text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTopicId(topic.id);
                        setTopicsListOpen(false);
                      }}
                      className={`min-w-0 flex-1 flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm cursor-pointer ${
                        selected ? 'font-medium text-white' : 'text-zinc-800'
                      }`}
                    >
                      <span className="truncate">{topic.name}</span>
                      <span
                        className={`font-mono text-xs tabular-nums shrink-0 ${
                          selected ? 'text-zinc-300' : 'text-zinc-400'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                    <div className="flex items-center pr-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setTopicsListOpen(false);
                          setEditingTopic(topic);
                          setTopicModalOpen(true);
                        }}
                        aria-label={`Rename ${topic.name}`}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded cursor-pointer ${
                          selected
                            ? 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                            : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-950'
                        }`}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTopicsListOpen(false);
                          setTopicToDelete(topic);
                        }}
                        aria-label={`Delete ${topic.name}`}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded cursor-pointer ${
                          selected
                            ? 'text-zinc-300 hover:bg-red-950/60 hover:text-red-300'
                            : 'text-zinc-500 hover:bg-red-50 hover:text-red-700'
                        }`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between border-t border-zinc-200 pt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setTopicsListOpen(false);
                setEditingTopic(null);
                setTopicModalOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              New topic
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setTopicsListOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* Import Material Wizard Modal */}
      <ImportMaterialModal
        open={importModalOpen}
        userId={user.uid}
        courses={courses}
        activeCourse={activeCourse}
        topics={topics}
        initialTopicId={
          selectedTopicId !== 'all' && selectedTopicId !== 'unassigned' ? selectedTopicId : ''
        }
        restoredDraft={useRestoredDraft ? pendingDraft : null}
        draftKey={draftKey}
        onClose={() => setImportModalOpen(false)}
        onSaved={(sourceId, savedCourseId) => {
          setImportModalOpen(false);
          setPendingDraft(null);
          setUseRestoredDraft(false);
          if (savedCourseId !== activeCourse.id) {
            void selectCourse(savedCourseId);
          } else {
            setActiveSourceId(sourceId);
          }
        }}
      />

      {/* Topic Modals */}
      <TopicModal
        open={topicModalOpen}
        courseLabel={`${activeCourse.code} — ${activeCourse.name}`}
        initialTopic={editingTopic}
        onClose={() => {
          setTopicModalOpen(false);
          setEditingTopic(null);
        }}
        onSubmit={async (input) => {
          if (editingTopic) {
            await updateTopic(editingTopic.id, {
              ...input,
              order: editingTopic.order,
            });
          } else {
            await createTopic(input);
          }
        }}
      />

      <Modal
        open={Boolean(topicToDelete)}
        title="Delete topic?"
        description={
          topicToDelete
            ? `Remove "${topicToDelete.name}" from ${activeCourse.code}? Any materials assigned to this topic will remain safely in your course Library.`
            : undefined
        }
        onClose={() => setTopicToDelete(null)}
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            variant="secondary"
            onClick={() => setTopicToDelete(null)}
            disabled={deletingTopic}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleConfirmDeleteTopic()}
            loading={deletingTopic}
          >
            Delete topic
          </Button>
        </div>
      </Modal>
    </div>
  );
};
