import React, { useEffect, useState } from 'react';
import type { Topic, TutorMessage, TutorSourceMode } from '../../types/models';
import { useAuth } from '../../context/AuthContext';
import { useCourses } from '../../context/CourseContext';
import { TopicPickerField } from '../courses/TopicPickerField';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface SaveResponseModalProps {
  open: boolean;
  message: TutorMessage | null;
  questionPrompt: string;
  sourceMode: TutorSourceMode;
  topics: Topic[];
  defaultTopicId: string;
  onClose: () => void;
  onSave: (payload: {
    title: string;
    topicId: string;
    type: 'tutor_response' | 'explanation' | 'summary' | 'study_guide';
  }) => Promise<void>;
}

export const SaveResponseModal: React.FC<SaveResponseModalProps> = ({
  open,
  message,
  questionPrompt,
  topics,
  defaultTopicId,
  onClose,
  onSave,
}) => {
  const { user } = useAuth();
  const { activeCourse } = useCourses();
  const [title, setTitle] = useState('');
  const [topicId, setTopicId] = useState(defaultTopicId);
  const [materialType, setMaterialType] = useState<
    'tutor_response' | 'explanation' | 'summary' | 'study_guide'
  >('tutor_response');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && message) {
      const suggested = questionPrompt
        ? questionPrompt.replace(/\s+/g, ' ').trim().slice(0, 90)
        : message.content.replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
      setTitle(suggested || 'Tutor Study Note');
      setTopicId(defaultTopicId);
      setMaterialType('tutor_response');
      setError(null);
    }
  }, [open, message, questionPrompt, defaultTopicId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Please enter a title for this saved study material.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        topicId,
        type: materialType,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save response.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save Tutor response to Study Materials"
      description="Store this explanation under your active course so you can review it later in Saved Materials."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="save-resp-title" className="block text-xs font-medium text-zinc-700 mb-1">
            Title
          </label>
          <input
            id="save-resp-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="save-resp-type" className="block text-xs font-medium text-zinc-700 mb-1">
              Category
            </label>
            <select
              id="save-resp-type"
              value={materialType}
              onChange={(e) =>
                setMaterialType(
                  e.target.value as 'tutor_response' | 'explanation' | 'summary' | 'study_guide'
                )
              }
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
            >
              <option value="tutor_response">Tutor Response</option>
              <option value="explanation">Concept Explanation</option>
              <option value="summary">Summary</option>
              <option value="study_guide">Study Guide</option>
            </select>
          </div>

          {user && activeCourse ? (
            <TopicPickerField
              id="save-resp-topic"
              userId={user.uid}
              courseId={activeCourse.id}
              knownTopics={topics}
              knownTopicsCourseId={activeCourse.id}
              value={topicId}
              onChange={setTopicId}
              emptyOptionLabel="General course"
            />
          ) : (
            <div>
              <label htmlFor="save-resp-topic" className="block text-xs font-medium text-zinc-700 mb-1">
                Topic (optional)
              </label>
              <select
                id="save-resp-topic"
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
              >
                <option value="">General course</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={saving}>
            Save material
          </Button>
        </div>
      </form>
    </Modal>
  );
};
