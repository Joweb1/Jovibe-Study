import React, { useEffect, useMemo, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { Topic } from '../../types/models';
import { createTopic, subscribeTopics } from '../../services/firebase/courseService';
import { formatReadableError } from '../../services/firebase/errors';
import { SCHEMA_LIMITS } from '../../utils/validation';
import { Button } from '../ui/Button';

const CREATE_NEW_SENTINEL = '__create_new_topic__';

interface TopicPickerFieldProps {
  id: string;
  userId: string;
  courseId: string;
  /** Pre-loaded topics for the currently active course (used when courseId matches). */
  knownTopics?: Topic[];
  /** Pass the activeCourseId if knownTopics belongs to a specific course. */
  knownTopicsCourseId?: string;
  value: string;
  onChange: (topicId: string) => void;
  label?: string;
  emptyOptionLabel?: string;
  disabled?: boolean;
  className?: string;
}

export const TopicPickerField: React.FC<TopicPickerFieldProps> = ({
  id,
  userId,
  courseId,
  knownTopics,
  knownTopicsCourseId,
  value,
  onChange,
  label = 'Topic',
  emptyOptionLabel = 'No specific topic (Whole course)',
  disabled = false,
  className = '',
}) => {
  const usesExternalTopics =
    Boolean(knownTopics) && (!knownTopicsCourseId || knownTopicsCourseId === courseId);

  const [fetchedTopics, setFetchedTopics] = useState<Topic[]>([]);
  const [optimisticTopics, setOptimisticTopics] = useState<Topic[]>([]);
  const [creatingMode, setCreatingMode] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to target course's topics if courseId differs from the active course's preloaded topics
  useEffect(() => {
    setOptimisticTopics([]);
    setCreatingMode(false);
    setNewTopicName('');
    setError(null);

    if (usesExternalTopics || !userId || !courseId) {
      setFetchedTopics([]);
      return;
    }

    const unsub = subscribeTopics(
      userId,
      courseId,
      (list) => setFetchedTopics(list),
      () => {
        // Non-blocking fallback
      }
    );
    return () => unsub();
  }, [usesExternalTopics, userId, courseId]);

  const mergedTopics = useMemo(() => {
    const base = usesExternalTopics ? knownTopics ?? [] : fetchedTopics;
    const seen = new Set(base.map((t) => t.id));
    const extras = optimisticTopics.filter((t) => !seen.has(t.id) && t.courseId === courseId);
    return [...base, ...extras];
  }, [usesExternalTopics, knownTopics, fetchedTopics, optimisticTopics, courseId]);

  const handleSelectChange = (nextVal: string) => {
    setError(null);
    if (nextVal === CREATE_NEW_SENTINEL) {
      setCreatingMode(true);
      return;
    }
    onChange(nextVal);
  };

  const handleCreateInlineTopic = async () => {
    const trimmed = newTopicName.trim();
    if (!trimmed) {
      setError('Enter a topic name.');
      return;
    }

    // If an identical topic already exists in this course, select it instead of duplicating
    const existing = mergedTopics.find(
      (t) => t.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      onChange(existing.id);
      setNewTopicName('');
      setCreatingMode(false);
      setError(null);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await createTopic(userId, courseId, {
        name: trimmed,
        description: '',
        order: mergedTopics.length,
      });
      setOptimisticTopics((prev) => [...prev, created]);
      onChange(created.id);
      setNewTopicName('');
      setCreatingMode(false);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {label} <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
        </label>
        {!creatingMode && !disabled && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setCreatingMode(true);
            }}
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
          >
            <Plus className="h-3 w-3" />
            New topic
          </button>
        )}
      </div>

      {!creatingMode ? (
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => handleSelectChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-300 focus:outline-none disabled:opacity-60"
        >
          <option value="">{emptyOptionLabel}</option>
          {mergedTopics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value={CREATE_NEW_SENTINEL}>+ Create new topic...</option>
        </select>
      ) : (
        <div className="mt-1 space-y-1.5">
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
            <input
              id={id}
              type="text"
              autoFocus
              maxLength={SCHEMA_LIMITS.TOPIC_NAME_MAX}
              value={newTopicName}
              disabled={submitting}
              onChange={(e) => {
                setNewTopicName(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleCreateInlineTopic();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setCreatingMode(false);
                  setNewTopicName('');
                  setError(null);
                }
              }}
              placeholder="New topic name (e.g., Week 2: Thermodynamics)"
              className="min-w-0 flex-1 basis-[180px] rounded-md border border-zinc-950 dark:border-zinc-400 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
            />
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                loading={submitting}
                onClick={() => void handleCreateInlineTopic()}
              >
                <Check className="h-3.5 w-3.5" />
                Add
              </Button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setCreatingMode(false);
                  setNewTopicName('');
                  setError(null);
                }}
                aria-label="Cancel new topic"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
};
