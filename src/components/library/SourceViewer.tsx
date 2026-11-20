import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FolderInput,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';
import type { Course, MaterialType, StudySource, Topic } from '../../types/models';
import { formatShortDate, SCHEMA_LIMITS } from '../../utils/validation';
import { formatReadableError } from '../../services/firebase/errors';
import {
  deleteStudySource,
  moveStudySource,
  updateStudySource,
} from '../../services/firebase/sourceService';
import {
  countUncertainMarkers,
  MATERIAL_TYPE_LABELS,
  parseStructuredText,
  sectionsToMarkdown,
} from '../../services/ingestion/structureParser';
import { TopicPickerField } from '../courses/TopicPickerField';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ErrorBanner } from '../ui/StateViews';

interface SourceViewerProps {
  userId: string;
  source: StudySource;
  courses: Course[];
  activeCourse: Course;
  topics: Topic[];
  onBack: () => void;
  onMovedToAnotherCourse: (targetCourseId: string) => void;
  onDeleted: () => void;
}

export const SourceViewer: React.FC<SourceViewerProps> = ({
  userId,
  source,
  courses,
  activeCourse,
  topics,
  onBack,
  onMovedToAnotherCourse,
  onDeleted,
}) => {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(source.title);
  const [editType, setEditType] = useState<MaterialType>(source.materialType);
  const [editContent, setEditContent] = useState(source.extractedContent);
  const [savingEdit, setSavingEdit] = useState(false);

  const [notes, setNotes] = useState(source.studentNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSavedNotice, setNotesSavedNotice] = useState(false);

  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveCourseId, setMoveCourseId] = useState(source.courseId);
  const [moveTopicId, setMoveTopicId] = useState(source.topicId);
  const [moving, setMoving] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditTitle(source.title);
    setEditType(source.materialType);
    setEditContent(source.extractedContent);
    setNotes(source.studentNotes);
    setMoveCourseId(source.courseId);
    setMoveTopicId(source.topicId);
  }, [source]);

  const currentTopic = topics.find((t) => t.id === source.topicId) ?? null;
  const uncertainCount = countUncertainMarkers(source.extractedContent);

  const handleSaveContentEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) {
      setError('Material title cannot be empty.');
      return;
    }

    setSavingEdit(true);
    setError(null);
    try {
      const reparsedSections = parseStructuredText(editContent, editTitle.trim());
      const cleanedContent = sectionsToMarkdown(reparsedSections) || editContent.trim();
      await updateStudySource(userId, source.courseId, source.id, {
        title: editTitle.trim(),
        materialType: editType,
        extractedContent: cleanedContent,
        sections: reparsedSections,
        processingStatus: countUncertainMarkers(cleanedContent) > 0 ? 'needs_review' : 'ready',
      });
      setEditing(false);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    setNotesSavedNotice(false);
    setError(null);
    try {
      await updateStudySource(userId, source.courseId, source.id, {
        studentNotes: notes,
      });
      setNotesSavedNotice(true);
      setTimeout(() => setNotesSavedNotice(false), 2500);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setSavingNotes(false);
    }
  };

  const handleMoveSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setMoving(true);
    setError(null);
    try {
      await moveStudySource({
        userId,
        source,
        targetCourseId: moveCourseId,
        targetTopicId: moveTopicId,
      });
      setMoveModalOpen(false);
      if (moveCourseId !== activeCourse.id) {
        onMovedToAnotherCourse(moveCourseId);
      }
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setMoving(false);
    }
  };

  const handleDeleteSource = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteStudySource(userId, source.courseId, source.id);
      setDeleteModalOpen(false);
      onDeleted();
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Bar & Actions */}
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-950 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to {activeCourse.code} Library
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {!editing && (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit material
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setMoveModalOpen(true)}>
              <FolderInput className="h-3.5 w-3.5" />
              Move / Topic
            </Button>
            <Button variant="danger" size="sm" onClick={() => setDeleteModalOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="font-mono text-zinc-900">{activeCourse.code}</span>
            <span aria-hidden="true">·</span>
            <span>{MATERIAL_TYPE_LABELS[source.materialType]}</span>
            <span aria-hidden="true">·</span>
            <span>{currentTopic ? currentTopic.name : 'Whole course'}</span>
            {source.pageOrSlideCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {source.pageOrSlideCount}{' '}
                  {source.materialType === 'slides'
                    ? source.pageOrSlideCount === 1
                      ? 'slide'
                      : 'slides'
                    : source.pageOrSlideCount === 1
                    ? 'page'
                    : 'pages'}
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">Updated {formatShortDate(source.updatedAt)}</span>
          </div>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-zinc-950">
            {source.title}
          </h1>
          {source.originalFileName && (
            <div className="mt-1 font-mono text-xs text-zinc-400">
              Imported from {source.originalFileName}
            </div>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {uncertainCount > 0 && !editing && (
        <div className="flex items-start justify-between gap-4 rounded-md border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-900" />
            <div>
              <span className="font-medium text-zinc-950">
                {uncertainCount} uncertain OCR/handwriting {uncertainCount === 1 ? 'marker' : 'markers'} remaining.
              </span>{' '}
              <span className="text-zinc-600">
                Edit this material to review and correct [unclear: ...] items.
              </span>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Review now
          </Button>
        </div>
      )}

      {/* Main Content Area: Edit Mode vs Structured Reader */}
      {editing ? (
        <form onSubmit={handleSaveContentEdit} className="space-y-5 max-w-4xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="edit-src-title" className="block text-xs font-medium text-zinc-700">
                Title
              </label>
              <input
                id="edit-src-title"
                type="text"
                required
                maxLength={SCHEMA_LIMITS.SOURCE_TITLE_MAX}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="edit-src-type" className="block text-xs font-medium text-zinc-700">
                Material type
              </label>
              <select
                id="edit-src-type"
                value={editType}
                onChange={(e) => setEditType(e.target.value as MaterialType)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
              >
                {(Object.keys(MATERIAL_TYPE_LABELS) as MaterialType[]).map((key) => (
                  <option key={key} value={key}>
                    {MATERIAL_TYPE_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="edit-src-content" className="block text-xs font-medium text-zinc-700">
                Structured study content (Markdown headings # / ## / ### preserve section outline)
              </label>
              <span className="font-mono text-xs text-zinc-400 tabular-nums">
                {editContent.length.toLocaleString()} chars
              </span>
            </div>
            <textarea
              id="edit-src-content"
              rows={20}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-zinc-300 px-3.5 py-3 font-mono text-xs leading-relaxed text-zinc-900 focus:border-zinc-950 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2.5">
            <Button type="submit" loading={savingEdit}>
              <Save className="h-4 w-4" />
              Save changes
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditTitle(source.title);
                setEditType(source.materialType);
                setEditContent(source.extractedContent);
                setEditing(false);
              }}
              disabled={savingEdit}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          {/* Structured Document Reader */}
          <article className="lg:col-span-8 space-y-8">
            {source.sections.length > 0 ? (
              source.sections.map((section, idx) => (
                <section
                  key={section.id || idx}
                  id={`section-${idx}`}
                  className="border-b border-zinc-100 pb-6 last:border-b-0"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h2
                      className={`font-display font-semibold text-zinc-950 ${
                        section.level === 1
                          ? 'text-xl'
                          : section.level === 3
                          ? 'text-sm'
                          : 'text-base'
                      }`}
                    >
                      {section.heading}
                    </h2>
                    {section.pageOrSlide && (
                      <span className="font-mono text-xs text-zinc-400 tabular-nums shrink-0">
                        {source.materialType === 'slides'
                          ? `Slide ${section.pageOrSlide}`
                          : `p. ${section.pageOrSlide}`}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 whitespace-pre-wrap text-[15px] leading-[1.7] text-zinc-800 max-w-[72ch]">
                    {section.content}
                  </div>
                </section>
              ))
            ) : (
              <div className="whitespace-pre-wrap text-[15px] leading-[1.7] text-zinc-800 max-w-[72ch]">
                {source.extractedContent}
              </div>
            )}
          </article>

          {/* Right Rail: Document Outline + Personal Annotations */}
          <aside className="lg:col-span-4 space-y-8 border-t border-zinc-200 pt-6 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0">
            {source.sections.length > 1 && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500">
                  Outline ({source.sections.length})
                </h3>
                <nav aria-label="Document sections" className="mt-3 max-h-64 overflow-y-auto space-y-1">
                  {source.sections.map((sec, idx) => (
                    <a
                      key={sec.id || idx}
                      href={`#section-${idx}`}
                      className="block truncate py-1 text-xs text-zinc-600 hover:text-zinc-950"
                    >
                      <span className="mr-2 font-mono text-zinc-400 tabular-nums">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      {sec.heading}
                    </a>
                  ))}
                </nav>
              </div>
            )}

            <div className={source.sections.length > 1 ? 'border-t border-zinc-200 pt-6' : ''}>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-zinc-500">Personal annotations</h3>
                <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                  {notes.length}/{SCHEMA_LIMITS.SOURCE_NOTES_MAX}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Add your own exam reminders, clarifications, or page takeaways. Synced with this source.
              </p>
              <textarea
                rows={7}
                maxLength={SCHEMA_LIMITS.SOURCE_NOTES_MAX}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Write your notes on this material..."
                className="mt-3 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-950 focus:outline-none"
              />
              <div className="mt-3 flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleSaveNotes()}
                  loading={savingNotes}
                  disabled={notes === source.studentNotes}
                >
                  Save notes
                </Button>
                {notesSavedNotice && (
                  <span className="inline-flex items-center gap-1 text-xs text-zinc-600">
                    <Check className="h-3.5 w-3.5" />
                    Saved
                  </span>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Move / Reassign Course or Topic Modal */}
      <Modal
        open={moveModalOpen}
        title="Organize or move material"
        description="Assign this material to a topic or move it to another course."
        onClose={() => setMoveModalOpen(false)}
      >
        <form onSubmit={handleMoveSource} className="space-y-4">
          <div>
            <label htmlFor="move-course" className="block text-sm font-medium text-zinc-900">
              Course
            </label>
            <select
              id="move-course"
              value={moveCourseId}
              onChange={(e) => {
                setMoveCourseId(e.target.value);
                setMoveTopicId('');
              }}
              className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <TopicPickerField
            id="move-topic"
            userId={userId}
            courseId={moveCourseId}
            knownTopics={topics}
            knownTopicsCourseId={activeCourse.id}
            value={moveTopicId}
            onChange={setMoveTopicId}
          />

          <div className="flex items-center justify-end gap-2.5 border-t border-zinc-100 pt-4">
            <Button variant="secondary" onClick={() => setMoveModalOpen(false)} disabled={moving}>
              Cancel
            </Button>
            <Button type="submit" loading={moving}>
              Save placement
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        title="Delete study material?"
        description={`This permanently deletes "${source.title}" and its personal annotations from Cloud Firestore.`}
        onClose={() => setDeleteModalOpen(false)}
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            variant="secondary"
            onClick={() => setDeleteModalOpen(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void handleDeleteSource()} loading={deleting}>
            Delete material
          </Button>
        </div>
      </Modal>
    </div>
  );
};
