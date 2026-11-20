import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import {
  DEFAULT_USER_PREFERENCES,
  type SavedMaterialType,
  type SavedStudyMaterial,
  type Topic,
} from '../../types/models';
import { useAuth } from '../../context/AuthContext';
import { formatReadableError } from '../../services/firebase/errors';
import {
  createSavedStudyMaterial,
  deleteSavedMaterial,
  subscribeCourseSavedMaterials,
  updateSavedMaterial,
} from '../../services/firebase/savedMaterialService';
import { geminiAudioPlayer, type PlaybackState } from '../../services/ai/audioService';
import { formatShortDate } from '../../utils/validation';
import { MarkdownMessage } from '../tutor/MarkdownMessage';
import { TopicPickerField } from '../courses/TopicPickerField';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { EmptyState, ErrorBanner, LoadingSkeleton } from '../ui/StateViews';

interface SavedMaterialsViewProps {
  courseId: string;
  courseCode: string;
  topics: Topic[];
  selectedTopicId?: string;
  externalSearchQuery?: string;
  externalTypeFilter?: SavedMaterialType | 'all';
  onClearExternalFilters?: () => void;
  onReaderOpenChange?: (open: boolean) => void;
}

export const SAVED_MATERIAL_TYPE_LABELS: Record<SavedMaterialType, string> = {
  tutor_response: 'Tutor Response',
  flashcards: 'Flashcards Deck',
  cbt: 'CBT Test Set',
  fill_in_the_gap: 'Fill in the Gap',
  exam_prep: 'Exam Prep Rubric',
  summary: 'Summary',
  study_guide: 'Study Guide',
  explanation: 'Explanation',
  custom_note: 'Custom Note',
};

const MATERIAL_TYPE_LABELS = SAVED_MATERIAL_TYPE_LABELS;

function extractReadableTextForSpeech(mat: SavedStudyMaterial): string {
  const c = mat.content;
  if (typeof c.markdown === 'string' && c.markdown.trim()) {
    return `${mat.title}. ${c.markdown}`;
  }
  if (Array.isArray(c.cards)) {
    return (c.cards as Array<{ front?: string; back?: string }>)
      .slice(0, 10)
      .map((card, i) => `Card ${i + 1}: ${card.front || ''}. Answer: ${card.back || ''}.`)
      .join(' ');
  }
  if (Array.isArray(c.questions)) {
    return (c.questions as Array<{ question?: string; explanation?: string }>)
      .slice(0, 8)
      .map((q, i) => `Question ${i + 1}: ${q.question || ''}. ${q.explanation || ''}`)
      .join(' ');
  }
  return mat.title;
}

export const SavedMaterialsView: React.FC<SavedMaterialsViewProps> = ({
  courseId,
  courseCode,
  topics,
  selectedTopicId = 'all',
  externalSearchQuery,
  externalTypeFilter,
  onClearExternalFilters,
  onReaderOpenChange,
}) => {
  const { user, profile } = useAuth();
  const prefs = profile?.preferences ?? DEFAULT_USER_PREFERENCES;

  const isControlledSearch = externalSearchQuery !== undefined;

  const [materials, setMaterials] = useState<SavedStudyMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<SavedMaterialType | 'all'>('all');
  const [topicFilter, setTopicFilter] = useState<string>(selectedTopicId);
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(null);

  const effectiveSearchQuery = isControlledSearch ? externalSearchQuery : searchQuery;
  const effectiveTypeFilter = externalTypeFilter !== undefined ? externalTypeFilter : typeFilter;

  useEffect(() => {
    setTopicFilter(selectedTopicId);
  }, [selectedTopicId]);

  useEffect(() => {
    onReaderOpenChange?.(Boolean(activeMaterialId));
  }, [activeMaterialId, onReaderOpenChange]);

  useEffect(() => {
    return () => {
      onReaderOpenChange?.(false);
    };
  }, [onReaderOpenChange]);

  // Create/Edit note modal
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<SavedStudyMaterial | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formTopicId, setFormTopicId] = useState('');
  const [formMarkdown, setFormMarkdown] = useState('');
  const [savingForm, setSavingForm] = useState(false);

  // Inline delete confirm
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>(() => geminiAudioPlayer.getState());

  useEffect(() => geminiAudioPlayer.subscribe(setPlayback), []);

  useEffect(() => {
    if (!user || !courseId) {
      setMaterials([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setActiveMaterialId(null);
    const unsub = subscribeCourseSavedMaterials(
      user.uid,
      courseId,
      (items) => {
        setMaterials(items);
        setLoading(false);
      },
      (err) => {
        setError(formatReadableError(err));
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user, courseId]);

  const topicMap = useMemo(() => {
    const map = new Map<string, Topic>();
    topics.forEach((t) => map.set(t.id, t));
    return map;
  }, [topics]);

  const filtered = useMemo(() => {
    const q = effectiveSearchQuery.trim().toLowerCase();
    return materials.filter((m) => {
      if (effectiveTypeFilter !== 'all' && m.type !== effectiveTypeFilter) return false;
      if (topicFilter === 'unassigned' && m.topicId !== '') return false;
      if (topicFilter !== 'all' && topicFilter !== 'unassigned' && m.topicId !== topicFilter) {
        return false;
      }
      if (!q) return true;
      const md = typeof m.content.markdown === 'string' ? m.content.markdown.toLowerCase() : '';
      return m.title.toLowerCase().includes(q) || md.includes(q);
    });
  }, [materials, effectiveSearchQuery, effectiveTypeFilter, topicFilter]);

  const activeMaterial = useMemo(
    () => materials.find((m) => m.id === activeMaterialId) ?? null,
    [materials, activeMaterialId]
  );

  const openNewNoteModal = () => {
    setEditingMaterial(null);
    setFormTitle('');
    setFormTopicId(topicFilter !== 'all' && topicFilter !== 'unassigned' ? topicFilter : '');
    setFormMarkdown('');
    setNoteModalOpen(true);
  };

  const openEditModal = (mat: SavedStudyMaterial) => {
    setEditingMaterial(mat);
    setFormTitle(mat.title);
    setFormTopicId(mat.topicId || '');
    setFormMarkdown(typeof mat.content.markdown === 'string' ? mat.content.markdown : '');
    setNoteModalOpen(true);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !formTitle.trim()) return;
    setSavingForm(true);
    setError(null);
    try {
      if (editingMaterial) {
        const nextContent =
          typeof editingMaterial.content.markdown === 'string' || editingMaterial.type === 'custom_note'
            ? { ...editingMaterial.content, markdown: formMarkdown }
            : editingMaterial.content;
        await updateSavedMaterial(user.uid, courseId, editingMaterial.id, {
          title: formTitle.trim(),
          topicId: formTopicId,
          content: nextContent,
        });
      } else {
        await createSavedStudyMaterial(user.uid, courseId, {
          title: formTitle.trim(),
          topicId: formTopicId,
          type: 'custom_note',
          content: { markdown: formMarkdown.trim() },
          sourceReferences: [],
        });
      }
      setNoteModalOpen(false);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setSavingForm(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      await deleteSavedMaterial(user.uid, courseId, id);
      if (activeMaterialId === id) setActiveMaterialId(null);
      setConfirmDeleteId(null);
    } catch (err) {
      setError(formatReadableError(err));
    }
  };

  if (loading) return <LoadingSkeleton lines={4} />;

  if (activeMaterial) {
    const playId = `saved_${activeMaterial.id}`;
    const isPlaying = playback.activeId === playId && playback.status === 'playing';
    const isPaused = playback.activeId === playId && playback.status === 'paused';
    const isLoadingAudio = playback.activeId === playId && playback.status === 'loading';
    const topicName = activeMaterial.topicId ? topicMap.get(activeMaterial.topicId)?.name : null;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4">
          <button
            type="button"
            onClick={() => {
              geminiAudioPlayer.stop();
              setActiveMaterialId(null);
            }}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-950"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Saved Materials
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {prefs.voiceEnabled && (
              <Button
                variant="secondary"
                size="sm"
                loading={isLoadingAudio}
                onClick={() =>
                  void geminiAudioPlayer.playMessage({
                    id: playId,
                    text: extractReadableTextForSpeech(activeMaterial),
                    voiceName: prefs.ttsVoice,
                    playbackRate: prefs.voiceRate,
                  })
                }
              >
                {isPlaying ? (
                  <>
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </>
                ) : isPaused ? (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    Resume
                  </>
                ) : (
                  <>
                    <Volume2 className="h-3.5 w-3.5" />
                    Listen ({prefs.ttsVoice})
                  </>
                )}
              </Button>
            )}
            {(isPlaying || isPaused) && (
              <Button variant="ghost" size="sm" onClick={() => geminiAudioPlayer.stop()}>
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => openEditModal(activeMaterial)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </div>
        </div>

        <div className="max-w-3xl space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>{MATERIAL_TYPE_LABELS[activeMaterial.type]}</span>
              {topicName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{topicName}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>Saved {formatShortDate(activeMaterial.updatedAt)}</span>
            </div>
            <h2 className="mt-1 font-display text-xl font-semibold text-zinc-950">
              {activeMaterial.title}
            </h2>
            {typeof activeMaterial.content.questionPrompt === 'string' &&
              activeMaterial.content.questionPrompt && (
                <p className="mt-2 border-l border-zinc-300 pl-3 text-xs text-zinc-600">
                  Prompt: {activeMaterial.content.questionPrompt}
                </p>
              )}
          </div>

          {typeof activeMaterial.content.markdown === 'string' && activeMaterial.content.markdown && (
            <div className="border-t border-zinc-200 pt-5">
              <MarkdownMessage content={activeMaterial.content.markdown} />
            </div>
          )}

          {Array.isArray(activeMaterial.content.cards) && (
            <div className="border-t border-zinc-200 pt-5 divide-y divide-zinc-200">
              {(activeMaterial.content.cards as Array<{ front: string; back: string; hint?: string }>).map(
                (card, idx) => (
                  <div key={idx} className="py-4 space-y-1.5">
                    <div className="font-mono text-xs text-zinc-400">Card {idx + 1}</div>
                    <div className="text-sm font-medium text-zinc-950">{card.front}</div>
                    <div className="text-sm text-zinc-700">{card.back}</div>
                    {card.hint && <div className="text-xs text-zinc-500">Hint: {card.hint}</div>}
                  </div>
                )
              )}
            </div>
          )}

          {Array.isArray(activeMaterial.content.questions) && (
            <div className="border-t border-zinc-200 pt-5 divide-y divide-zinc-200">
              {(
                activeMaterial.content.questions as Array<{
                  question: string;
                  options?: string[];
                  correctIndex?: number;
                  explanation?: string;
                }>
              ).map((q, idx) => (
                <div key={idx} className="py-4 space-y-2">
                  <div className="text-sm font-medium text-zinc-950">
                    {idx + 1}. {q.question}
                  </div>
                  {Array.isArray(q.options) && (
                    <ul className="space-y-1 pl-4 text-xs text-zinc-700">
                      {q.options.map((opt, oi) => (
                        <li
                          key={oi}
                          className={oi === q.correctIndex ? 'font-semibold text-zinc-950' : ''}
                        >
                          {String.fromCharCode(65 + oi)}. {opt}
                          {oi === q.correctIndex ? ' (Correct)' : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                  {q.explanation && <p className="text-xs text-zinc-600">{q.explanation}</p>}
                </div>
              ))}
            </div>
          )}

          {Array.isArray(activeMaterial.content.items) && (
            <div className="border-t border-zinc-200 pt-5 divide-y divide-zinc-200">
              {(
                activeMaterial.content.items as Array<{
                  sentenceWithBlank: string;
                  expectedAnswer: string;
                  explanation?: string;
                }>
              ).map((item, idx) => (
                <div key={idx} className="py-4 space-y-1.5">
                  <div className="text-sm text-zinc-900">
                    {idx + 1}. {item.sentenceWithBlank}
                  </div>
                  <div className="text-xs font-medium text-zinc-950">
                    Answer: {item.expectedAnswer}
                  </div>
                  {item.explanation && <p className="text-xs text-zinc-600">{item.explanation}</p>}
                </div>
              ))}
            </div>
          )}

          {activeMaterial.sourceReferences && activeMaterial.sourceReferences.length > 0 && (
            <div className="border-t border-zinc-200 pt-4">
              <div className="text-xs font-medium text-zinc-500 mb-1.5">Grounded sources</div>
              <ul className="space-y-1 text-xs text-zinc-600">
                {activeMaterial.sourceReferences.map((ref, idx) => (
                  <li key={idx}>
                    {ref.sourceTitle}
                    {ref.sectionHeading ? ` · ${ref.sectionHeading}` : ''}
                    {typeof ref.pageOrSlide === 'number' ? ` · p.${ref.pageOrSlide}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <Modal
          open={noteModalOpen}
          onClose={() => setNoteModalOpen(false)}
          title="Edit saved study material"
        >
          <form onSubmit={handleSubmitForm} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Title</label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                required
                maxLength={200}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
              />
            </div>
            {user && (
              <TopicPickerField
                id="edit-saved-note-topic"
                userId={user.uid}
                courseId={courseId}
                knownTopics={topics}
                knownTopicsCourseId={courseId}
                value={formTopicId}
                onChange={setFormTopicId}
                emptyOptionLabel="General course"
              />
            )}
            {(typeof editingMaterial?.content.markdown === 'string' ||
              editingMaterial?.type === 'custom_note') && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Content (Markdown)</label>
                <textarea
                  rows={8}
                  value={formMarkdown}
                  onChange={(e) => setFormMarkdown(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs text-zinc-950 focus:border-zinc-950 focus:outline-none"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setNoteModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={savingForm}>
                Save changes
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {isControlledSearch ? (
        <div className="flex items-center justify-between gap-2 pb-1">
          <span className="text-xs text-zinc-500 tabular-nums">
            {filtered.length} {filtered.length === 1 ? 'saved item' : 'saved items'}
          </span>
          <Button size="sm" variant="secondary" onClick={openNewNoteModal} className="shrink-0">
            <Plus className="h-3.5 w-3.5" />
            New study note
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search saved materials in ${courseCode}...`}
                className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-8 pr-3 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-950 focus:outline-none"
              />
            </div>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as SavedMaterialType | 'all')}
              aria-label="Filter by category"
              className="w-36 sm:w-44 shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-900 focus:border-zinc-950 focus:outline-none"
            >
              <option value="all">All types</option>
              {Object.entries(MATERIAL_TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <Button size="sm" onClick={openNewNoteModal} className="shrink-0">
            <Plus className="h-3.5 w-3.5" />
            New study note
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={materials.length === 0 ? 'No saved study materials yet' : 'No matching saved materials'}
          description={
            materials.length === 0
              ? 'Save explanations from AI Tutor, flashcard decks, CBT sets, Exam Prep rubrics, or create your own summary notes here.'
              : 'Try adjusting your search query or category filter.'
          }
          actionLabel={materials.length === 0 ? 'Create study note' : 'Clear filters'}
          onAction={() => {
            if (materials.length === 0) {
              openNewNoteModal();
            } else {
              setSearchQuery('');
              setTypeFilter('all');
              setTopicFilter('all');
              onClearExternalFilters?.();
            }
          }}
        />
      ) : (
        <div className="divide-y divide-zinc-200 border-y border-zinc-200">
          {filtered.map((mat) => {
            const topicName = mat.topicId ? topicMap.get(mat.topicId)?.name : null;
            return (
              <div
                key={mat.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <button
                  type="button"
                  onClick={() => setActiveMaterialId(mat.id)}
                  className="min-w-0 flex-1 text-left group"
                >
                  <div className="text-sm font-medium text-zinc-950 group-hover:underline underline-offset-2 truncate">
                    {mat.title}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>{MATERIAL_TYPE_LABELS[mat.type]}</span>
                    {topicName && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{topicName}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>{formatShortDate(mat.updatedAt)}</span>
                  </div>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => setActiveMaterialId(mat.id)}>
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditModal(mat)}
                    aria-label={`Edit ${mat.title}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {confirmDeleteId === mat.id ? (
                    <div className="flex items-center gap-2 text-xs pl-1">
                      <button
                        type="button"
                        onClick={() => void handleDelete(mat.id)}
                        className="font-medium text-red-700 underline"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-zinc-500 hover:text-zinc-900"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(mat.id)}
                      aria-label={`Delete ${mat.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-zinc-500" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={noteModalOpen}
        onClose={() => setNoteModalOpen(false)}
        title={editingMaterial ? 'Edit saved study material' : 'Create custom study note'}
      >
        <form onSubmit={handleSubmitForm} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">Title</label>
            <input
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              required
              maxLength={200}
              placeholder="e.g., Midterm Formula Sheet"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
            />
          </div>
          {user && (
            <TopicPickerField
              id="create-saved-note-topic"
              userId={user.uid}
              courseId={courseId}
              knownTopics={topics}
              knownTopicsCourseId={courseId}
              value={formTopicId}
              onChange={setFormTopicId}
              emptyOptionLabel="General course"
            />
          )}
          {(!editingMaterial ||
            typeof editingMaterial.content.markdown === 'string' ||
            editingMaterial.type === 'custom_note') && (
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Note content (Markdown)</label>
              <textarea
                rows={7}
                value={formMarkdown}
                onChange={(e) => setFormMarkdown(e.target.value)}
                required={!editingMaterial}
                placeholder="Write concise exam notes, definitions, or key takeaways..."
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setNoteModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={savingForm}>
              {editingMaterial ? 'Save changes' : 'Save note'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
