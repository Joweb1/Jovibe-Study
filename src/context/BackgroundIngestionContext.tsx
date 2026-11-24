import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MaterialType } from '../types/models';
import { useAuth } from './AuthContext';
import { formatReadableError } from '../services/firebase/errors';
import { createStudySource } from '../services/firebase/sourceService';
import {
  ingestImageBatch,
  ingestUploadedFile,
} from '../services/ingestion/ingestionPipeline';
import {
  detectMaterialTypeFromFile,
  stripFileExtension,
} from '../services/ingestion/structureParser';
import {
  deletePendingIngestion,
  getPendingIngestion,
  getPendingIngestionsForUser,
  savePendingIngestion,
  updatePendingIngestion,
  type BackgroundIngestionStatus,
  type PendingIngestionExtractedResult,
  type PendingIngestionOptions,
  type PendingIngestionRecord,
} from '../services/local/indexedDb';
import { generateDocumentId } from '../utils/validation';

export interface BackgroundIngestionJob {
  id: string;
  userId: string;
  courseId: string;
  topicId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  title: string;
  materialType: MaterialType;
  options: PendingIngestionOptions;
  status: BackgroundIngestionStatus;
  progressPercent: number;
  progressStage: string;
  autoSaveWhenDone: boolean;
  hasLocalFile: boolean;
  extractedResult?: PendingIngestionExtractedResult | null;
  savedSourceId?: string | null;
  error?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface EnqueueFileExtractionParams {
  file: File;
  /** Additional image files when combining multiple selected photos into one study material */
  additionalFiles?: File[];
  courseId: string;
  topicId: string;
  options?: PendingIngestionOptions;
  /** True when user immediately chooses background upload without watching the modal */
  autoSaveWhenDone?: boolean;
}

interface BackgroundIngestionContextValue {
  jobs: BackgroundIngestionJob[];
  activeJobs: BackgroundIngestionJob[];
  getJob: (jobId: string) => BackgroundIngestionJob | undefined;
  getJobsForCourse: (courseId: string) => BackgroundIngestionJob[];
  enqueueFileExtraction: (params: EnqueueFileExtractionParams) => Promise<string>;
  setJobAutoSave: (jobId: string, autoSaveWhenDone: boolean) => void;
  cancelJob: (jobId: string) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  dismissJob: (jobId: string) => Promise<void>;
  consumeReadyJob: (jobId: string) => Promise<PendingIngestionExtractedResult | null>;
}

const BackgroundIngestionContext = createContext<BackgroundIngestionContextValue | null>(null);

const COMPLETED_AUTO_DISMISS_MS = 4500;

function recordToJob(record: PendingIngestionRecord): BackgroundIngestionJob {
  return {
    id: record.id,
    userId: record.userId,
    courseId: record.courseId,
    topicId: record.topicId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    fileSize: record.fileSize,
    title: record.title,
    materialType: record.materialType,
    options: record.options || {},
    status: record.status,
    progressPercent: record.progressPercent,
    progressStage: record.progressStage,
    autoSaveWhenDone: record.autoSaveWhenDone,
    hasLocalFile: Boolean(record.fileBlob),
    extractedResult: record.extractedResult ?? null,
    savedSourceId: record.savedSourceId ?? null,
    error: record.error ?? null,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
  };
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (err.name === 'AbortError' || msg.includes('cancelled') || msg.includes('aborted')) {
      return true;
    }
  }
  return false;
}

export const BackgroundIngestionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<BackgroundIngestionJob[]>([]);

  const jobsRef = useRef<BackgroundIngestionJob[]>([]);
  const queueRef = useRef<string[]>([]);
  const isWorkerRunningRef = useRef<boolean>(false);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const autoSaveFlagsRef = useRef<Map<string, boolean>>(new Map());
  const cancelledIdsRef = useRef<Set<string>>(new Set());
  const savingIdsRef = useRef<Set<string>>(new Set());
  const fallbackBlobsRef = useRef<Map<string, Blob>>(new Map());
  const fallbackExtraFilesRef = useRef<Map<string, File[]>>(new Map());
  const dismissTimersRef = useRef<Map<string, number>>(new Map());
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    userIdRef.current = user?.uid ?? null;
  }, [user?.uid]);

  const clearDismissTimer = useCallback((jobId: string) => {
    const timer = dismissTimersRef.current.get(jobId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      dismissTimersRef.current.delete(jobId);
    }
  }, []);

  const patchJobState = useCallback(
    (jobId: string, patch: Partial<BackgroundIngestionJob>) => {
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, ...patch, updatedAtMs: Date.now() } : j))
      );
    },
    []
  );

  const removeJobState = useCallback(
    (jobId: string) => {
      clearDismissTimer(jobId);
      autoSaveFlagsRef.current.delete(jobId);
      fallbackBlobsRef.current.delete(jobId);
      fallbackExtraFilesRef.current.delete(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    },
    [clearDismissTimer]
  );

  const saveExtractedResultToLibrary = useCallback(
    async (jobId: string, result: PendingIngestionExtractedResult) => {
      if (savingIdsRef.current.has(jobId) || cancelledIdsRef.current.has(jobId)) {
        return;
      }

      const job = jobsRef.current.find((j) => j.id === jobId);
      if (!job) return;

      savingIdsRef.current.add(jobId);
      patchJobState(jobId, {
        status: 'saving',
        progressPercent: 96,
        progressStage: 'Saving extracted material to Library...',
        error: null,
      });
      await updatePendingIngestion(jobId, {
        status: 'saving',
        progressPercent: 96,
        progressStage: 'Saving extracted material to Library...',
        fileBlob: null,
        extraFiles: null,
        extractedResult: result,
        error: null,
      });

      try {
        const created = await createStudySource(job.userId, job.courseId, {
          topicId: job.topicId,
          title: result.title || job.title,
          materialType: result.materialType || job.materialType,
          extractedContent: result.extractedContent,
          sections: result.sections,
          pageOrSlideCount: result.pageOrSlideCount,
          processingStatus: result.processingStatus,
          originalFileName: result.originalFileName || job.fileName,
        });

        if (cancelledIdsRef.current.has(jobId)) {
          return;
        }

        // Clean up temporary local storage immediately after successful cloud save
        await deletePendingIngestion(jobId);
        fallbackBlobsRef.current.delete(jobId);
        fallbackExtraFilesRef.current.delete(jobId);

        patchJobState(jobId, {
          status: 'completed',
          progressPercent: 100,
          progressStage: 'Saved to Library',
          savedSourceId: created.id,
          hasLocalFile: false,
          extractedResult: null,
          error: null,
        });

        clearDismissTimer(jobId);
        const timer = window.setTimeout(() => {
          removeJobState(jobId);
        }, COMPLETED_AUTO_DISMISS_MS);
        dismissTimersRef.current.set(jobId, timer);
      } catch (err) {
        if (cancelledIdsRef.current.has(jobId)) return;
        const readable = formatReadableError(err);
        const message = `Extracted successfully, but saving to Library failed: ${readable}`;
        await updatePendingIngestion(jobId, {
          status: 'failed',
          fileBlob: null,
          extraFiles: null,
          extractedResult: result,
          progressPercent: 96,
          progressStage: 'Save failed — ready to retry',
          error: message,
        });
        patchJobState(jobId, {
          status: 'failed',
          hasLocalFile: false,
          extractedResult: result,
          progressPercent: 96,
          progressStage: 'Save failed — ready to retry',
          error: message,
        });
      } finally {
        savingIdsRef.current.delete(jobId);
      }
    },
    [clearDismissTimer, patchJobState, removeJobState]
  );

  const runSingleJob = useCallback(
    async (jobId: string) => {
      if (cancelledIdsRef.current.has(jobId)) return;

      const record = await getPendingIngestion(jobId);
      const currentJob = jobsRef.current.find((j) => j.id === jobId);
      if (!currentJob) {
        return;
      }

      // If extraction already succeeded earlier and only cloud save failed, retry save directly
      const existingResult = record?.extractedResult ?? currentJob.extractedResult ?? null;
      if (existingResult) {
        if (autoSaveFlagsRef.current.get(jobId) ?? currentJob.autoSaveWhenDone) {
          await saveExtractedResultToLibrary(jobId, existingResult);
        } else {
          patchJobState(jobId, {
            status: 'ready_for_review',
            progressPercent: 100,
            progressStage: 'Extraction complete — ready to review',
            extractedResult: existingResult,
            hasLocalFile: false,
            error: null,
          });
        }
        return;
      }

      const blob = record?.fileBlob ?? fallbackBlobsRef.current.get(jobId) ?? null;
      if (!blob) {
        const msg = 'Temporary local file was cleared before extraction could start. Please re-upload.';
        await updatePendingIngestion(jobId, {
          status: 'failed',
          error: msg,
          progressStage: 'Local file unavailable',
        });
        patchJobState(jobId, {
          status: 'failed',
          hasLocalFile: false,
          error: msg,
          progressStage: 'Local file unavailable',
        });
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        patchJobState(jobId, {
          status: 'queued',
          progressStage: 'Waiting for internet connection to extract...',
        });
        await updatePendingIngestion(jobId, {
          status: 'queued',
          progressStage: 'Waiting for internet connection to extract...',
        });
        return;
      }

      const controller = new AbortController();
      controllersRef.current.set(jobId, controller);

      let latestPercent = Math.max(8, currentJob.progressPercent || 8);
      patchJobState(jobId, {
        status: 'extracting',
        progressPercent: latestPercent,
        progressStage: 'Starting background extraction...',
        error: null,
      });
      await updatePendingIngestion(jobId, {
        status: 'extracting',
        progressPercent: latestPercent,
        progressStage: 'Starting background extraction...',
        error: null,
      });

      // Gentle smooth trickle for single-request Vision OCR so the progress skeleton stays visibly alive
      const trickleTimer = window.setInterval(() => {
        if (cancelledIdsRef.current.has(jobId) || controller.signal.aborted) return;
        if (latestPercent >= 20 && latestPercent < 88) {
          latestPercent = Math.min(88, latestPercent + 1);
          patchJobState(jobId, { progressPercent: latestPercent });
        }
      }, 750);

      try {
        const localFile = new File([blob], currentJob.fileName, {
          type: currentJob.mimeType || blob.type || 'application/octet-stream',
        });

        const storedExtras = record?.extraFiles ?? [];
        const extraFiles: File[] =
          storedExtras.length > 0
            ? storedExtras.map(
                (ef) =>
                  new File([ef.fileBlob], ef.fileName, {
                    type: ef.mimeType || ef.fileBlob.type || 'image/jpeg',
                  })
              )
            : fallbackExtraFilesRef.current.get(jobId) ?? [];

        const progressHandler = (p: { stage: string; percent?: number }) => {
          if (cancelledIdsRef.current.has(jobId)) return;
          // Map 0..100 extraction progress into 8..92% so saving gets 92..100%
          const scaled =
            typeof p.percent === 'number'
              ? Math.min(92, Math.max(8, Math.round(8 + (p.percent / 100) * 84)))
              : latestPercent;
          latestPercent = Math.max(latestPercent, scaled);
          patchJobState(jobId, {
            progressPercent: latestPercent,
            progressStage: p.stage,
          });
        };

        const result =
          extraFiles.length > 0
            ? await ingestImageBatch([localFile, ...extraFiles], {
                overrideType: currentJob.options.overrideType,
                visionMode: currentJob.options.visionMode,
                signal: controller.signal,
                onProgress: progressHandler,
              })
            : await ingestUploadedFile(localFile, {
                overrideType: currentJob.options.overrideType,
                visionMode: currentJob.options.visionMode,
                startPage: currentJob.options.startPage,
                endPage: currentJob.options.endPage,
                enableScannedOcr: currentJob.options.enableScannedOcr,
                signal: controller.signal,
                onProgress: progressHandler,
              });

        window.clearInterval(trickleTimer);
        controllersRef.current.delete(jobId);

        if (cancelledIdsRef.current.has(jobId)) {
          return;
        }

        // Discard raw local binary blob right away once structured text has been extracted
        fallbackBlobsRef.current.delete(jobId);
        fallbackExtraFilesRef.current.delete(jobId);

        const shouldAutoSave =
          autoSaveFlagsRef.current.get(jobId) ?? currentJob.autoSaveWhenDone;

        if (shouldAutoSave) {
          await saveExtractedResultToLibrary(jobId, result);
        } else {
          await updatePendingIngestion(jobId, {
            status: 'ready_for_review',
            progressPercent: 100,
            progressStage: 'Extraction complete — ready to review',
            fileBlob: null,
            extraFiles: null,
            extractedResult: result,
            error: null,
          });
          patchJobState(jobId, {
            status: 'ready_for_review',
            progressPercent: 100,
            progressStage: 'Extraction complete — ready to review',
            hasLocalFile: false,
            extractedResult: result,
            error: null,
          });
        }
      } catch (err) {
        window.clearInterval(trickleTimer);
        controllersRef.current.delete(jobId);

        if (cancelledIdsRef.current.has(jobId) || isAbortError(err, controller.signal)) {
          return;
        }

        const readable = formatReadableError(err);
        await updatePendingIngestion(jobId, {
          status: 'failed',
          progressStage: 'Extraction failed',
          error: readable,
        });
        patchJobState(jobId, {
          status: 'failed',
          progressStage: 'Extraction failed',
          error: readable,
        });
      }
    },
    [patchJobState, saveExtractedResultToLibrary]
  );

  const processQueue = useCallback(async () => {
    if (isWorkerRunningRef.current) return;
    isWorkerRunningRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const nextJobId = queueRef.current.shift();
        if (!nextJobId) continue;
        if (cancelledIdsRef.current.has(nextJobId)) continue;
        await runSingleJob(nextJobId);
      }
    } finally {
      isWorkerRunningRef.current = false;
      if (queueRef.current.length > 0) {
        void processQueue();
      }
    }
  }, [runSingleJob]);

  const scheduleJobId = useCallback(
    (jobId: string) => {
      if (!queueRef.current.includes(jobId)) {
        queueRef.current.push(jobId);
      }
      void processQueue();
    },
    [processQueue]
  );

  // Restore any interrupted local jobs from IndexedDB on login / page reload
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      // Abort running jobs and clear memory on sign-out
      controllersRef.current.forEach((ctrl) => ctrl.abort());
      controllersRef.current.clear();
      dismissTimersRef.current.forEach((t) => window.clearTimeout(t));
      dismissTimersRef.current.clear();
      queueRef.current = [];
      fallbackBlobsRef.current.clear();
      fallbackExtraFilesRef.current.clear();
      autoSaveFlagsRef.current.clear();
      setJobs([]);
      return;
    }

    let cancelled = false;

    void getPendingIngestionsForUser(uid).then(async (records) => {
      if (cancelled || userIdRef.current !== uid) return;

      const restoredJobs: BackgroundIngestionJob[] = [];
      const toResumeIds: string[] = [];

      for (const rec of records) {
        if (rec.status === 'completed') {
          await deletePendingIngestion(rec.id);
          continue;
        }

        const hasData = Boolean(rec.fileBlob || rec.extractedResult);
        if (!hasData) {
          await deletePendingIngestion(rec.id);
          continue;
        }

        if (rec.status === 'queued' || rec.status === 'extracting' || rec.status === 'saving') {
          const resumed: PendingIngestionRecord = {
            ...rec,
            status: 'queued',
            autoSaveWhenDone: true,
            progressPercent: Math.max(5, Math.min(rec.progressPercent || 5, 15)),
            progressStage:
              typeof navigator !== 'undefined' && navigator.onLine === false
                ? 'Waiting for internet connection to resume...'
                : 'Resuming background extraction from local storage...',
            updatedAtMs: Date.now(),
          };
          await updatePendingIngestion(rec.id, {
            status: resumed.status,
            autoSaveWhenDone: true,
            progressPercent: resumed.progressPercent,
            progressStage: resumed.progressStage,
          });
          autoSaveFlagsRef.current.set(rec.id, true);
          restoredJobs.push(recordToJob(resumed));
          toResumeIds.push(rec.id);
        } else {
          autoSaveFlagsRef.current.set(rec.id, rec.autoSaveWhenDone);
          restoredJobs.push(recordToJob(rec));
        }
      }

      if (cancelled) return;

      if (restoredJobs.length > 0) {
        setJobs((prev) => {
          const existingIds = new Set(prev.map((j) => j.id));
          const merged = [...prev];
          for (const job of restoredJobs) {
            if (!existingIds.has(job.id)) {
              merged.push(job);
            }
          }
          return merged;
        });

        // Kick off resumed jobs after state commits
        window.setTimeout(() => {
          if (cancelled) return;
          for (const id of toResumeIds) {
            scheduleJobId(id);
          }
        }, 50);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user?.uid, scheduleJobId]);

  // Resume queued jobs automatically if the user comes back online
  useEffect(() => {
    const handleOnline = () => {
      for (const job of jobsRef.current) {
        if (job.status === 'queued') {
          scheduleJobId(job.id);
        }
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [scheduleJobId]);

  const enqueueFileExtraction = useCallback(
    async (params: EnqueueFileExtractionParams): Promise<string> => {
      const uid = userIdRef.current;
      if (!uid) {
        throw new Error('You must be signed in to import study materials.');
      }

      const jobId = generateDocumentId('ing');
      const now = Date.now();
      const options = params.options ?? {};
      const materialType =
        options.overrideType ?? detectMaterialTypeFromFile(params.file);
      const additionalFiles = params.additionalFiles ?? [];
      const totalFilesCount = 1 + additionalFiles.length;
      const baseTitle = stripFileExtension(params.file.name) || 'Untitled Material';
      const title =
        additionalFiles.length > 0
          ? `${baseTitle} (+${additionalFiles.length} more)`
          : baseTitle;
      const autoSaveWhenDone = params.autoSaveWhenDone ?? false;

      const record: PendingIngestionRecord = {
        id: jobId,
        userId: uid,
        courseId: params.courseId,
        topicId: params.topicId,
        fileName: params.file.name,
        mimeType: params.file.type || 'application/octet-stream',
        fileSize:
          params.file.size + additionalFiles.reduce((sum, f) => sum + (f.size || 0), 0),
        title,
        materialType,
        fileBlob: params.file,
        extraFiles:
          additionalFiles.length > 0
            ? additionalFiles.map((f) => ({
                fileName: f.name,
                mimeType: f.type || 'image/jpeg',
                fileSize: f.size,
                fileBlob: f,
              }))
            : null,
        options,
        status: 'queued',
        progressPercent: 5,
        progressStage:
          totalFilesCount > 1
            ? `Stored ${totalFilesCount} images locally — queued for extraction...`
            : 'Stored locally — queued for background extraction...',
        autoSaveWhenDone,
        extractedResult: null,
        savedSourceId: null,
        error: null,
        createdAtMs: now,
        updatedAtMs: now,
      };

      // Always keep fallback blob in memory until IndexedDB confirms persistence
      fallbackBlobsRef.current.set(jobId, params.file);
      if (additionalFiles.length > 0) {
        fallbackExtraFilesRef.current.set(jobId, additionalFiles);
      }
      try {
        await savePendingIngestion(record);
        // Persisted safely in IndexedDB; release duplicate in-memory reference
        fallbackBlobsRef.current.delete(jobId);
        fallbackExtraFilesRef.current.delete(jobId);
      } catch (err) {
        console.warn('Could not persist temporary file in IndexedDB; continuing in memory:', err);
      }

      autoSaveFlagsRef.current.set(jobId, autoSaveWhenDone);
      cancelledIdsRef.current.delete(jobId);

      const newJob = recordToJob(record);
      jobsRef.current = [newJob, ...jobsRef.current];
      setJobs((prev) => [newJob, ...prev]);

      scheduleJobId(jobId);
      return jobId;
    },
    [scheduleJobId]
  );

  const setJobAutoSave = useCallback(
    (jobId: string, autoSaveWhenDone: boolean) => {
      autoSaveFlagsRef.current.set(jobId, autoSaveWhenDone);
      void updatePendingIngestion(jobId, { autoSaveWhenDone });
      patchJobState(jobId, { autoSaveWhenDone });

      // If extraction already finished while the modal was closing, trigger auto-save immediately
      if (autoSaveWhenDone) {
        const job = jobsRef.current.find((j) => j.id === jobId);
        if (job && job.status === 'ready_for_review' && job.extractedResult) {
          void saveExtractedResultToLibrary(jobId, job.extractedResult);
        }
      }
    },
    [patchJobState, saveExtractedResultToLibrary]
  );

  const cancelJob = useCallback(
    async (jobId: string) => {
      cancelledIdsRef.current.add(jobId);
      queueRef.current = queueRef.current.filter((id) => id !== jobId);
      const ctrl = controllersRef.current.get(jobId);
      if (ctrl) {
        ctrl.abort();
        controllersRef.current.delete(jobId);
      }
      removeJobState(jobId);
      await deletePendingIngestion(jobId);
    },
    [removeJobState]
  );

  const retryJob = useCallback(
    async (jobId: string) => {
      const job = jobsRef.current.find((j) => j.id === jobId);
      if (!job) return;

      cancelledIdsRef.current.delete(jobId);
      autoSaveFlagsRef.current.set(jobId, true);

      await updatePendingIngestion(jobId, {
        status: 'queued',
        autoSaveWhenDone: true,
        progressPercent: job.extractedResult ? 95 : 8,
        progressStage: job.extractedResult
          ? 'Retrying save to Library...'
          : 'Re-queued from local file...',
        error: null,
      });

      patchJobState(jobId, {
        status: 'queued',
        autoSaveWhenDone: true,
        progressPercent: job.extractedResult ? 95 : 8,
        progressStage: job.extractedResult
          ? 'Retrying save to Library...'
          : 'Re-queued from local file...',
        error: null,
      });

      scheduleJobId(jobId);
    },
    [patchJobState, scheduleJobId]
  );

  const dismissJob = useCallback(
    async (jobId: string) => {
      cancelledIdsRef.current.add(jobId);
      removeJobState(jobId);
      await deletePendingIngestion(jobId);
    },
    [removeJobState]
  );

  const consumeReadyJob = useCallback(
    async (jobId: string): Promise<PendingIngestionExtractedResult | null> => {
      const job = jobsRef.current.find((j) => j.id === jobId);
      const result = job?.extractedResult ?? (await getPendingIngestion(jobId))?.extractedResult ?? null;
      removeJobState(jobId);
      await deletePendingIngestion(jobId);
      return result;
    },
    [removeJobState]
  );

  const activeJobs = useMemo(
    () =>
      jobs.filter(
        (j) => j.status === 'queued' || j.status === 'extracting' || j.status === 'saving'
      ),
    [jobs]
  );

  const getJob = useCallback(
    (jobId: string) => jobs.find((j) => j.id === jobId),
    [jobs]
  );

  const getJobsForCourse = useCallback(
    (courseId: string) => jobs.filter((j) => j.courseId === courseId),
    [jobs]
  );

  const value = useMemo<BackgroundIngestionContextValue>(
    () => ({
      jobs,
      activeJobs,
      getJob,
      getJobsForCourse,
      enqueueFileExtraction,
      setJobAutoSave,
      cancelJob,
      retryJob,
      dismissJob,
      consumeReadyJob,
    }),
    [
      jobs,
      activeJobs,
      getJob,
      getJobsForCourse,
      enqueueFileExtraction,
      setJobAutoSave,
      cancelJob,
      retryJob,
      dismissJob,
      consumeReadyJob,
    ]
  );

  return (
    <BackgroundIngestionContext.Provider value={value}>
      {children}
    </BackgroundIngestionContext.Provider>
  );
};

export function useBackgroundIngestion(): BackgroundIngestionContextValue {
  const ctx = useContext(BackgroundIngestionContext);
  if (!ctx) {
    throw new Error('useBackgroundIngestion must be used within BackgroundIngestionProvider');
  }
  return ctx;
}
