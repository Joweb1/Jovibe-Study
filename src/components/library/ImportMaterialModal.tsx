import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Camera,
  EyeOff,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Trash2,
  Type as TypeIcon,
  Upload,
  X,
} from 'lucide-react';
import type {
  Course,
  MaterialType,
  StudySection,
  Topic,
} from '../../types/models';
import { SCHEMA_LIMITS } from '../../utils/validation';
import { useBackgroundIngestion } from '../../context/BackgroundIngestionContext';
import { formatReadableError } from '../../services/firebase/errors';
import { createStudySource } from '../../services/firebase/sourceService';
import {
  ingestTextInput,
  type ExtractionResult,
} from '../../services/ingestion/ingestionPipeline';
import { inspectPdfPageCount } from '../../services/ingestion/pdfExtractor';
import {
  countUncertainMarkers,
  MATERIAL_TYPE_LABELS,
  parseStructuredText,
  sectionsToMarkdown,
} from '../../services/ingestion/structureParser';
import type { VisionExtractionMode } from '../../services/ingestion/visionExtractor';
import { deleteLocalDraft, saveLocalDraft } from '../../services/local/indexedDb';
import { TopicPickerField } from '../courses/TopicPickerField';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/StateViews';

type InputTab = 'document' | 'photo' | 'text';
type WizardStep = 'input' | 'extracting' | 'preview';

export interface ExtractionDraftPayload {
  title: string;
  materialType: MaterialType;
  courseId: string;
  topicId: string;
  extractedContent: string;
  sections: StudySection[];
  pageOrSlideCount: number;
  originalFileName: string;
  warnings: string[];
}

interface ImportMaterialModalProps {
  open: boolean;
  userId: string;
  courses: Course[];
  activeCourse: Course;
  topics: Topic[];
  initialTopicId?: string;
  restoredDraft?: ExtractionDraftPayload | null;
  draftKey: string;
  onClose: () => void;
  onSaved: (sourceId: string, savedCourseId: string) => void;
  onBackgrounded?: (targetCourseId: string) => void;
}

export const ImportMaterialModal: React.FC<ImportMaterialModalProps> = ({
  open,
  userId,
  courses,
  activeCourse,
  topics,
  initialTopicId = '',
  restoredDraft = null,
  draftKey,
  onClose,
  onSaved,
  onBackgrounded,
}) => {
  const {
    enqueueFileExtraction,
    setJobAutoSave,
    cancelJob,
    dismissJob,
    consumeReadyJob,
    getJob,
  } = useBackgroundIngestion();

  const [step, setStep] = useState<WizardStep>('input');
  const [tab, setTab] = useState<InputTab>('document');

  // File / PDF controls
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pdfTotalPages, setPdfTotalPages] = useState<number | null>(null);
  const [pdfStartPage, setPdfStartPage] = useState<number>(1);
  const [pdfEndPage, setPdfEndPage] = useState<number>(1);
  const [enableScannedOcr, setEnableScannedOcr] = useState<boolean>(true);
  const [inspectingPdf, setInspectingPdf] = useState<boolean>(false);

  // Photo / Handwriting controls
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoDragOver, setPhotoDragOver] = useState<boolean>(false);
  const [photoMode, setPhotoMode] = useState<VisionExtractionMode>('textbook_photo');

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [photoFile]);

  const handleSelectPhotoFile = (file: File | null) => {
    setError(null);
    if (!file) {
      setPhotoFile(null);
      return;
    }
    if (file.type && !file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPEG, WebP, or photo from your gallery).');
      return;
    }
    setPhotoFile(file);
  };

  // Typed / Pasted text controls
  const [rawTitle, setRawTitle] = useState('');
  const [rawText, setRawText] = useState('');
  const [textInputType, setTextInputType] = useState<'typed_notes' | 'pasted_text'>('pasted_text');

  // Background extraction tracking
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [queueingBackground, setQueueingBackground] = useState(false);

  // Preview & Organize state
  const [title, setTitle] = useState('');
  const [materialType, setMaterialType] = useState<MaterialType>('pdf');
  const [targetCourseId, setTargetCourseId] = useState(activeCourse.id);
  const [targetTopicId, setTargetTopicId] = useState(initialTopicId);
  const [sections, setSections] = useState<StudySection[]>([]);
  const [fullText, setFullText] = useState('');
  const [pageOrSlideCount, setPageOrSlideCount] = useState(1);
  const [originalFileName, setOriginalFileName] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [previewMode, setPreviewMode] = useState<'sections' | 'raw'>('sections');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeJob = activeJobId ? getJob(activeJobId) : undefined;
  const progressStage = activeJob?.progressStage || 'Storing locally & initializing extraction...';
  const progressPercent = activeJob?.progressPercent ?? 8;

  // Reset or restore draft when modal opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setQueueingBackground(false);
    setActiveJobId(null);

    if (restoredDraft) {
      setTitle(restoredDraft.title);
      setMaterialType(restoredDraft.materialType);
      setTargetCourseId(restoredDraft.courseId || activeCourse.id);
      setTargetTopicId(restoredDraft.topicId || '');
      setSections(restoredDraft.sections);
      setFullText(restoredDraft.extractedContent);
      setPageOrSlideCount(restoredDraft.pageOrSlideCount || 1);
      setOriginalFileName(restoredDraft.originalFileName || '');
      setWarnings(restoredDraft.warnings || []);
      setPreviewMode(restoredDraft.sections.length > 0 ? 'sections' : 'raw');
      setStep('preview');
      return;
    }

    setStep('input');
    setTab('document');
    setSelectedFile(null);
    setPdfTotalPages(null);
    setPdfStartPage(1);
    setPdfEndPage(1);
    setEnableScannedOcr(true);
    setPhotoFile(null);
    setPhotoMode('textbook_photo');
    setRawTitle('');
    setRawText('');
    setTargetCourseId(activeCourse.id);
    setTargetTopicId(initialTopicId);
    setSections([]);
    setFullText('');
    setWarnings([]);
  }, [open, activeCourse.id, initialTopicId, restoredDraft]);

  // Persist preview edits as a local IndexedDB draft so interrupted reviews are recoverable
  useEffect(() => {
    if (!open || step !== 'preview') return;
    const timer = window.setTimeout(() => {
      void saveLocalDraft({
        key: draftKey,
        userId,
        payload: {
          title,
          materialType,
          courseId: targetCourseId,
          topicId: targetTopicId,
          extractedContent: fullText,
          sections,
          pageOrSlideCount,
          originalFileName,
          warnings,
        },
        updatedAtMs: Date.now(),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    open,
    step,
    draftKey,
    userId,
    title,
    materialType,
    targetCourseId,
    targetTopicId,
    fullText,
    sections,
    pageOrSlideCount,
    originalFileName,
    warnings,
  ]);

  const applyExtractionResult = useCallback((result: ExtractionResult) => {
    setTitle(result.title);
    setMaterialType(result.materialType);
    setSections(result.sections);
    setFullText(result.extractedContent);
    setPageOrSlideCount(result.pageOrSlideCount);
    setOriginalFileName(result.originalFileName);
    setWarnings(result.warnings);
    setPreviewMode(result.sections.length > 0 ? 'sections' : 'raw');
    setStep('preview');
  }, []);

  const handleHideToBackground = useCallback(() => {
    if (activeJobId) {
      setJobAutoSave(activeJobId, true);
      setActiveJobId(null);
    }
    setSelectedFile(null);
    setPhotoFile(null);
    if (onBackgrounded) {
      onBackgrounded(targetCourseId);
    } else {
      onClose();
    }
  }, [activeJobId, setJobAutoSave, onBackgrounded, targetCourseId, onClose]);

  // Observe the active background job while the modal remains open on the extracting step
  useEffect(() => {
    if (!open || step !== 'extracting' || !activeJobId || !activeJob) return;

    if (activeJob.status === 'ready_for_review' && activeJob.extractedResult) {
      const id = activeJobId;
      setActiveJobId(null);
      void consumeReadyJob(id).then((res) => {
        if (res) {
          applyExtractionResult(res);
        }
      });
      return;
    }

    if (activeJob.status === 'failed') {
      const id = activeJobId;
      const errMsg = activeJob.error || 'Could not extract content from this file.';
      setActiveJobId(null);
      setError(errMsg);
      setStep('input');
      void dismissJob(id);
    }
  }, [open, step, activeJobId, activeJob, consumeReadyJob, dismissJob, applyExtractionResult]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (step === 'extracting') {
          handleHideToBackground();
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, step, onClose, handleHideToBackground]);

  const uncertainCount = countUncertainMarkers(fullText);

  const handleSelectDocumentFile = async (file: File | null) => {
    setError(null);
    setSelectedFile(file);
    setPdfTotalPages(null);
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
      setInspectingPdf(true);
      try {
        const count = await inspectPdfPageCount(file);
        setPdfTotalPages(count);
        setPdfStartPage(1);
        setPdfEndPage(Math.min(count, 40));
      } catch (err) {
        setError(
          `Could not inspect PDF file: ${err instanceof Error ? err.message : 'Invalid or encrypted PDF.'}`
        );
      } finally {
        setInspectingPdf(false);
      }
    }
  };

  const handleStartExtraction = async (runInBackgroundImmediately = false) => {
    setError(null);

    if (tab === 'text') {
      if (!rawText.trim()) {
        setError('Enter or paste study content before continuing.');
        return;
      }
      const res = ingestTextInput({
        title: rawTitle || 'Study Notes',
        rawText,
        materialType: textInputType,
      });
      applyExtractionResult(res);
      return;
    }

    const fileToProcess = tab === 'document' ? selectedFile : photoFile;
    if (!fileToProcess) {
      setError(
        tab === 'document'
          ? 'Choose a PDF, PowerPoint (.pptx), Markdown, or text file first.'
          : 'Choose or capture a photograph first.'
      );
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError(
        "You're offline. Turn on your internet connection to extract text from PDFs, slides, or photos with AI. You can still paste or type plain text notes offline."
      );
      return;
    }

    setQueueingBackground(true);
    try {
      const jobId = await enqueueFileExtraction({
        file: fileToProcess,
        courseId: targetCourseId,
        topicId: targetTopicId,
        autoSaveWhenDone: runInBackgroundImmediately,
        options: {
          visionMode: tab === 'photo' ? photoMode : undefined,
          overrideType:
            tab === 'photo'
              ? photoMode === 'handwriting'
                ? 'handwritten_notes'
                : photoMode === 'scanned_doc'
                ? 'scanned_doc'
                : 'textbook_photo'
              : undefined,
          startPage: pdfTotalPages ? pdfStartPage : undefined,
          endPage: pdfTotalPages ? pdfEndPage : undefined,
          enableScannedOcr,
        },
      });

      if (runInBackgroundImmediately) {
        setSelectedFile(null);
        setPhotoFile(null);
        if (onBackgrounded) {
          onBackgrounded(targetCourseId);
        } else {
          onClose();
        }
      } else {
        setActiveJobId(jobId);
        setStep('extracting');
      }
    } catch (err) {
      setError(formatReadableError(err));
      setStep('input');
    } finally {
      setQueueingBackground(false);
    }
  };

  const handleCancelExtraction = () => {
    if (activeJobId) {
      void cancelJob(activeJobId);
      setActiveJobId(null);
    }
    setStep('input');
  };

  const handleUpdateSection = (index: number, patch: Partial<StudySection>) => {
    setSections((prev) => {
      const next = prev.map((s, idx) => (idx === index ? { ...s, ...patch } : s));
      setFullText(sectionsToMarkdown(next));
      return next;
    });
  };

  const handleRemoveSection = (index: number) => {
    setSections((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      setFullText(sectionsToMarkdown(next));
      return next;
    });
  };

  const handleSwitchPreviewMode = (nextMode: 'sections' | 'raw') => {
    if (nextMode === 'sections' && previewMode === 'raw') {
      setSections(parseStructuredText(fullText, title || 'Study Notes'));
    } else if (nextMode === 'raw' && previewMode === 'sections') {
      setFullText(sectionsToMarkdown(sections));
    }
    setPreviewMode(nextMode);
  };

  const handleSaveToCloud = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Material title is required.');
      return;
    }

    const finalContent =
      previewMode === 'sections' ? sectionsToMarkdown(sections) : fullText.trim();
    if (!finalContent) {
      setError('Extracted content cannot be empty.');
      return;
    }

    const finalSections =
      previewMode === 'raw' ? parseStructuredText(finalContent, trimmedTitle) : sections;

    setSaving(true);
    setError(null);

    try {
      const created = await createStudySource(userId, targetCourseId, {
        topicId: targetTopicId,
        title: trimmedTitle,
        materialType,
        extractedContent: finalContent,
        sections: finalSections,
        pageOrSlideCount,
        processingStatus: countUncertainMarkers(finalContent) > 0 ? 'needs_review' : 'ready',
        originalFileName,
      });

      await deleteLocalDraft(draftKey);
      // Discard file references from memory immediately after save
      setSelectedFile(null);
      setPhotoFile(null);
      onSaved(created.id, targetCourseId);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="import-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onClick={() => {
            if (step === 'extracting') {
              handleHideToBackground();
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 dark:bg-black/70 backdrop-blur-[2px] p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-material-title"
        >
          <motion.div
            key="import-modal-panel"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl"
          >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 sm:gap-4 border-b border-zinc-200 dark:border-zinc-800 px-4 sm:px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-mono">{activeCourse.code}</span>
              <span aria-hidden="true">·</span>
              <span>
                {step === 'input'
                  ? 'Step 1 of 2 — Import material'
                  : step === 'extracting'
                  ? 'Extracting structured text'
                  : 'Step 2 of 2 — Preview, edit & save'}
              </span>
            </div>
            <h2 id="import-material-title" className="mt-0.5 text-lg font-semibold text-zinc-950 dark:text-zinc-200">
              {step === 'preview' ? 'Review extracted content' : 'Add study material'}
            </h2>
          </div>

          <button
            type="button"
            onClick={step === 'extracting' ? handleHideToBackground : onClose}
            aria-label={step === 'extracting' ? 'Hide and continue extracting in background' : 'Close import dialog'}
            title={step === 'extracting' ? 'Hide & run in background' : 'Close'}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5">
          {error && (
            <div className="mb-5">
              <ErrorBanner message={error} onDismiss={() => setError(null)} />
            </div>
          )}

          {/* STEP 1: IMPORT INPUT */}
          {step === 'input' && (
            <div className="space-y-6">
              {/* Segmented Input Mode Tabs */}
              <div className="inline-flex max-w-full flex-wrap gap-1 rounded-md bg-zinc-100 dark:bg-zinc-950 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setTab('document');
                    setError(null);
                  }}
                  className={`inline-flex max-w-full items-center gap-2 rounded px-3 sm:px-3.5 py-2 text-xs font-medium text-left cursor-pointer ${
                    tab === 'document'
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-200'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span>Document (PDF / PPTX / Text)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('photo');
                    setError(null);
                  }}
                  className={`inline-flex max-w-full items-center gap-2 rounded px-3 sm:px-3.5 py-2 text-xs font-medium text-left cursor-pointer ${
                    tab === 'photo'
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-200'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  <Camera className="h-3.5 w-3.5 shrink-0" />
                  <span>Textbook Photo / Handwriting</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('text');
                    setError(null);
                  }}
                  className={`inline-flex max-w-full items-center gap-2 rounded px-3 sm:px-3.5 py-2 text-xs font-medium text-left cursor-pointer ${
                    tab === 'text'
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-200'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  <TypeIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>Type or Paste Notes</span>
                </button>
              </div>

              {/* Course & Topic selection up front when adding any material or note */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-y border-zinc-200 dark:border-zinc-800 py-4">
                <div>
                  <label htmlFor="import-course" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Course
                  </label>
                  <select
                    id="import-course"
                    value={targetCourseId}
                    onChange={(e) => {
                      setTargetCourseId(e.target.value);
                      setTargetTopicId('');
                    }}
                    className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                  >
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <TopicPickerField
                  id="import-step1-topic"
                  userId={userId}
                  courseId={targetCourseId}
                  knownTopics={topics}
                  knownTopicsCourseId={activeCourse.id}
                  value={targetTopicId}
                  onChange={setTargetTopicId}
                />
              </div>

              {/* TAB A: DOCUMENT UPLOAD */}
              {tab === 'document' && (
                <div className="space-y-5">
                  <label className="flex flex-col items-center justify-center rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-950/60 px-6 py-10 text-center hover:border-zinc-500 dark:hover:border-zinc-500 cursor-pointer">
                    <Upload className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                    <span className="mt-3 text-sm font-medium text-zinc-950 dark:text-zinc-200">
                      {selectedFile ? selectedFile.name : 'Choose a PDF, PowerPoint (.pptx), Markdown, or text file'}
                    </span>
                    <span className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Selectable PDFs and .pptx slides extract directly without unnecessary vision calls. Original files are discarded after extraction.
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown"
                      onChange={(e) => void handleSelectDocumentFile(e.target.files?.[0] ?? null)}
                      className="sr-only"
                    />
                  </label>

                  {inspectingPdf && (
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">Inspecting PDF page count...</p>
                  )}

                  {pdfTotalPages !== null && (
                    <div className="space-y-4 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium text-zinc-950 dark:text-zinc-200">
                          PDF detected — <span className="font-mono tabular-nums">{pdfTotalPages}</span>{' '}
                          {pdfTotalPages === 1 ? 'page' : 'pages'}
                        </div>
                        {pdfTotalPages > 40 && (
                          <span className="text-xs text-zinc-600 dark:text-zinc-400">
                            Large document: select a chapter or page range for clean, manageable units.
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div>
                          <label htmlFor="pdf-start" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                            Start page
                          </label>
                          <input
                            id="pdf-start"
                            type="number"
                            min={1}
                            max={pdfTotalPages}
                            value={pdfStartPage}
                            onChange={(e) => {
                              const val = Math.max(1, Math.min(pdfTotalPages, Number(e.target.value) || 1));
                              setPdfStartPage(val);
                              if (val > pdfEndPage) setPdfEndPage(val);
                            }}
                            className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-sm text-zinc-950 dark:text-zinc-200 font-mono tabular-nums focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label htmlFor="pdf-end" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                            End page
                          </label>
                          <input
                            id="pdf-end"
                            type="number"
                            min={pdfStartPage}
                            max={pdfTotalPages}
                            value={pdfEndPage}
                            onChange={(e) => {
                              const val = Math.max(
                                pdfStartPage,
                                Math.min(pdfTotalPages, Number(e.target.value) || pdfStartPage)
                              );
                              setPdfEndPage(val);
                            }}
                            className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-sm text-zinc-950 dark:text-zinc-200 font-mono tabular-nums focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                          />
                        </div>
                        <div className="flex items-end">
                          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 pb-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={enableScannedOcr}
                              onChange={(e) => setEnableScannedOcr(e.target.checked)}
                              className="h-4 w-4 accent-zinc-950 dark:accent-zinc-200"
                            />
                            Use AI Vision OCR if scanned pages are found
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB B: PHOTO / HANDWRITING OCR */}
              {tab === 'photo' && (
                <div className="space-y-5">
                  <div>
                    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Material type</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'textbook_photo', label: 'Textbook page', desc: 'Printed pages, diagrams, tables' },
                          {
                            id: 'handwriting',
                            label: 'Handwritten notes',
                            desc: 'Marks unclear words for review',
                          },
                          { id: 'scanned_doc', label: 'Scanned sheet', desc: 'Photocopies or scanned handouts' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setPhotoMode(opt.id)}
                          className={`rounded-md border p-3 text-left cursor-pointer ${
                            photoMode === opt.id
                              ? 'border-zinc-950 bg-zinc-50 dark:border-zinc-300 dark:bg-zinc-800/80'
                              : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600'
                          }`}
                        >
                          <div className="text-sm font-medium text-zinc-950 dark:text-zinc-200">{opt.label}</div>
                          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setPhotoDragOver(true);
                    }}
                    onDragLeave={() => setPhotoDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setPhotoDragOver(false);
                      const dropped = e.dataTransfer.files?.[0] ?? null;
                      if (dropped) {
                        handleSelectPhotoFile(dropped);
                      }
                    }}
                    className={`rounded-md border border-dashed px-6 py-8 text-center transition-colors ${
                      photoDragOver
                        ? 'border-zinc-950 bg-zinc-100/80 dark:border-zinc-200 dark:bg-zinc-900'
                        : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-950/60'
                    }`}
                  >
                    {photoFile && photoPreviewUrl ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="relative overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                          <img
                            src={photoPreviewUrl}
                            alt="Selected study material preview"
                            className="max-h-48 max-w-full object-contain"
                          />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-zinc-950 dark:text-zinc-200 break-all">
                            {photoFile.name}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            {(photoFile.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                          <label className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
                            <ImageIcon className="h-3.5 w-3.5" />
                            Choose another image
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                handleSelectPhotoFile(e.target.files?.[0] ?? null);
                                e.target.value = '';
                              }}
                              className="sr-only"
                            />
                          </label>
                          <label className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
                            <Camera className="h-3.5 w-3.5" />
                            Retake photo
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={(e) => {
                                handleSelectPhotoFile(e.target.files?.[0] ?? null);
                                e.target.value = '';
                              }}
                              className="sr-only"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => handleSelectPhotoFile(null)}
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <ImageIcon className="h-6 w-6 text-zinc-600 dark:text-zinc-400" />
                        <p className="mt-3 text-sm font-medium text-zinc-950 dark:text-zinc-200">
                          Upload an image or snap a photo
                        </p>
                        <p className="mt-1 max-w-md text-xs text-zinc-500 dark:text-zinc-400">
                          Choose a saved photo, screenshot, or image from your device, drag and drop it here, or take a photo with your camera. Supports PNG, JPEG, WebP, and gallery photos.
                        </p>
                        <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                          <label className="inline-flex items-center gap-2 rounded-md bg-zinc-950 dark:bg-zinc-100 px-4 py-2 text-xs font-medium text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 cursor-pointer">
                            <Upload className="h-3.5 w-3.5" />
                            Upload image / photo
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                handleSelectPhotoFile(e.target.files?.[0] ?? null);
                                e.target.value = '';
                              }}
                              className="sr-only"
                            />
                          </label>
                          <label className="inline-flex items-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
                            <Camera className="h-3.5 w-3.5" />
                            Take photo
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={(e) => {
                                handleSelectPhotoFile(e.target.files?.[0] ?? null);
                                e.target.value = '';
                              }}
                              className="sr-only"
                            />
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB C: TYPE / PASTE TEXT */}
              {tab === 'text' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label htmlFor="raw-title" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Material title
                      </label>
                      <input
                        id="raw-title"
                        type="text"
                        maxLength={SCHEMA_LIMITS.SOURCE_TITLE_MAX}
                        value={rawTitle}
                        onChange={(e) => setRawTitle(e.target.value)}
                        placeholder="e.g., Chapter 4: Contract Formation Notes"
                        className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="text-type" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Source type
                      </label>
                      <select
                        id="text-type"
                        value={textInputType}
                        onChange={(e) =>
                          setTextInputType(e.target.value as 'typed_notes' | 'pasted_text')
                        }
                        className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                      >
                        <option value="pasted_text">Pasted Text</option>
                        <option value="typed_notes">Typed Notes</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="raw-text" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Study content (headings, lists, definitions, or raw text)
                      </label>
                      <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                        {rawText.length.toLocaleString()} chars
                      </span>
                    </div>
                    <textarea
                      id="raw-text"
                      rows={11}
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      placeholder="Paste lecture notes, textbook excerpts, or type structured Markdown notes (# Heading, - Bullet, etc.)..."
                      className="mt-1.5 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2.5 text-sm leading-relaxed text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: EXTRACTING PROGRESS (HIDEABLE TO BACKGROUND) */}
          {step === 'extracting' && (
            <div className="py-10 text-center space-y-5">
              <div
                aria-hidden="true"
                className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-zinc-950 dark:border-zinc-200 border-t-transparent dark:border-t-transparent"
              />
              <div className="space-y-1">
                <div className="text-sm font-medium text-zinc-950 dark:text-zinc-200">
                  {progressStage}
                </div>
                <div className="font-mono text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-400">
                  {Math.max(0, Math.min(100, Math.round(progressPercent)))}% complete
                </div>
              </div>
              <div className="mx-auto h-2 w-full max-w-md overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <motion.div
                  initial={{ width: '8%' }}
                  animate={{ width: `${Math.max(8, Math.min(100, Math.round(progressPercent)))}%` }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full rounded-full bg-zinc-950 dark:bg-zinc-200 animate-sotal-shimmer"
                />
              </div>
              <p className="mx-auto max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Your file is temporarily cached locally while extraction runs in the background. You can hide this popup and continue using Jovibe Study — live progress will show in your Library and automatically save when finished.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                <Button size="sm" onClick={handleHideToBackground}>
                  <EyeOff className="h-3.5 w-3.5" />
                  Hide &amp; run in background
                </Button>
                <Button variant="secondary" size="sm" onClick={handleCancelExtraction}>
                  Cancel extraction
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW, CORRECT & ORGANIZE */}
          {step === 'preview' && (
            <form id="save-source-form" onSubmit={handleSaveToCloud} className="space-y-6">
              {uncertainCount > 0 && (
                <div className="flex items-start gap-3 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-4 py-3 text-sm text-zinc-800 dark:text-zinc-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-900 dark:text-zinc-200" />
                  <div>
                    <div className="font-medium text-zinc-950 dark:text-zinc-200">
                      {uncertainCount} uncertain {uncertainCount === 1 ? 'word or phrase' : 'words or phrases'} marked for review
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                      Look for <span className="font-mono">[unclear: ...]</span> or{' '}
                      <span className="font-mono">[illegible]</span> markers below and correct them before saving.
                    </p>
                  </div>
                </div>
              )}

              {warnings.length > 0 && (
                <div className="space-y-1 border-y border-zinc-200 dark:border-zinc-800 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                  {warnings.map((w, idx) => (
                    <div key={idx}>{w}</div>
                  ))}
                </div>
              )}

              {/* Organize metadata */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <label htmlFor="preview-title" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Material title
                  </label>
                  <input
                    id="preview-title"
                    type="text"
                    required
                    maxLength={SCHEMA_LIMITS.SOURCE_TITLE_MAX}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="preview-type" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Material type
                  </label>
                  <select
                    id="preview-type"
                    value={materialType}
                    onChange={(e) => setMaterialType(e.target.value as MaterialType)}
                    className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                  >
                    {(Object.keys(MATERIAL_TYPE_LABELS) as MaterialType[]).map((key) => (
                      <option key={key} value={key}>
                        {MATERIAL_TYPE_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="preview-course" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Course
                  </label>
                  <select
                    id="preview-course"
                    value={targetCourseId}
                    onChange={(e) => {
                      setTargetCourseId(e.target.value);
                      setTargetTopicId('');
                    }}
                    className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                  >
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="max-w-md">
                <TopicPickerField
                  id="preview-topic"
                  userId={userId}
                  courseId={targetCourseId}
                  knownTopics={topics}
                  knownTopicsCourseId={activeCourse.id}
                  value={targetTopicId}
                  onChange={setTargetTopicId}
                />
              </div>

              {/* Editor Mode Toggle */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <div className="inline-flex gap-1 rounded-md bg-zinc-100 dark:bg-zinc-950 p-1">
                  <button
                    type="button"
                    onClick={() => handleSwitchPreviewMode('sections')}
                    className={`rounded px-3 py-1.5 text-xs font-medium cursor-pointer ${
                      previewMode === 'sections'
                        ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-200'
                        : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    Structured Sections ({sections.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchPreviewMode('raw')}
                    className={`rounded px-3 py-1.5 text-xs font-medium cursor-pointer ${
                      previewMode === 'raw'
                        ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-200'
                        : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    Full Text Editor
                  </button>
                </div>

                <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                  {fullText.length.toLocaleString()} / {SCHEMA_LIMITS.SOURCE_CONTENT_MAX.toLocaleString()} chars
                </div>
              </div>

              {/* Structured Section Editor */}
              {previewMode === 'sections' ? (
                <div className="space-y-4">
                  {sections.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4">
                      All sections were removed. Switch to Full Text Editor or go back to re-import.
                    </p>
                  ) : (
                    sections.map((sec, idx) => (
                      <div
                        key={sec.id}
                        className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <input
                              type="text"
                              value={sec.heading}
                              onChange={(e) =>
                                handleUpdateSection(idx, { heading: e.target.value })
                              }
                              aria-label={`Section ${idx + 1} heading`}
                              className="w-full border-b border-transparent bg-transparent py-0.5 text-sm font-semibold text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {sec.pageOrSlide && (
                              <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                                {materialType === 'slides' ? `Slide ${sec.pageOrSlide}` : `p. ${sec.pageOrSlide}`}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveSection(idx)}
                              aria-label={`Remove section ${sec.heading}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-700 dark:text-zinc-500 dark:hover:bg-red-950/40 dark:hover:text-red-400 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <textarea
                          rows={Math.min(10, Math.max(3, Math.ceil(sec.content.length / 110)))}
                          value={sec.content}
                          onChange={(e) => handleUpdateSection(idx, { content: e.target.value })}
                          aria-label={`Section ${idx + 1} content`}
                          className="w-full rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900 px-3 py-2 text-sm leading-relaxed text-zinc-800 dark:text-zinc-300 focus:border-zinc-950 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-950 focus:outline-none"
                        />
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <textarea
                  rows={16}
                  value={fullText}
                  onChange={(e) => setFullText(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 py-3 font-mono text-xs leading-relaxed text-zinc-900 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                />
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 border-t border-zinc-200 dark:border-zinc-800 px-4 sm:px-6 py-3.5 sm:py-4">
          {step === 'input' && (
            <>
              <Button variant="secondary" onClick={onClose} disabled={queueingBackground}>
                Cancel
              </Button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {tab !== 'text' && (
                  <Button
                    variant="secondary"
                    onClick={() => void handleStartExtraction(true)}
                    disabled={inspectingPdf || queueingBackground}
                    loading={queueingBackground}
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    Extract in background
                  </Button>
                )}
                <Button
                  onClick={() => void handleStartExtraction(false)}
                  disabled={inspectingPdf || queueingBackground}
                >
                  {tab === 'text' ? 'Structure & preview' : 'Extract & preview'}
                </Button>
              </div>
            </>
          )}

          {step === 'extracting' && (
            <div className="flex w-full flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 shrink-0" />
                Temporarily cached on device — raw file is removed automatically after saving.
              </span>
              <button
                type="button"
                onClick={handleHideToBackground}
                className="font-medium text-zinc-900 dark:text-zinc-200 underline underline-offset-2 hover:opacity-80 cursor-pointer"
              >
                Hide popup
              </button>
            </div>
          )}

          {step === 'preview' && (
            <>
              <Button
                variant="secondary"
                onClick={() => setStep('input')}
                disabled={saving}
              >
                Back to import
              </Button>
              <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                <Button variant="ghost" onClick={onClose} disabled={saving}>
                  Save as draft
                </Button>
                <Button type="submit" form="save-source-form" loading={saving}>
                  Save
                </Button>
              </div>
            </>
          )}
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
