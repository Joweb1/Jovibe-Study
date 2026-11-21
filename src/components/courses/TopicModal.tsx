import React, { useEffect, useState } from 'react';
import type { Topic } from '../../types/models';
import { SCHEMA_LIMITS, validateTopicInput } from '../../utils/validation';
import { formatReadableError } from '../../services/firebase/errors';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ErrorBanner } from '../ui/StateViews';

interface TopicModalProps {
  open: boolean;
  courseLabel: string;
  initialTopic?: Topic | null;
  onClose: () => void;
  onSubmit: (input: { name: string; description: string }) => Promise<void>;
}

export const TopicModal: React.FC<TopicModalProps> = ({
  open,
  courseLabel,
  initialTopic,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialTopic?.name ?? '');
      setDescription(initialTopic?.description ?? '');
      setError(null);
      setSubmitting(false);
    }
  }, [open, initialTopic]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateTopicInput({ name, description });
    if (!check.valid) {
      setError(check.error || 'Topic name is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(check.sanitized);
      onClose();
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={initialTopic ? 'Rename topic' : 'Add topic'}
      description={`Optional topic inside ${courseLabel}. You can also study the entire course without topics.`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <div>
          <label htmlFor="topic-name" className="block text-sm font-medium text-zinc-900 dark:text-zinc-200">
            Topic name
          </label>
          <input
            id="topic-name"
            type="text"
            required
            maxLength={SCHEMA_LIMITS.TOPIC_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Week 3: Supply and Demand Elasticity"
            className="mt-1.5 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="topic-desc" className="block text-sm font-medium text-zinc-900 dark:text-zinc-200">
              Notes <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
            </label>
            <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
              {description.length}/{SCHEMA_LIMITS.TOPIC_DESC_MAX}
            </span>
          </div>
          <textarea
            id="topic-desc"
            rows={2}
            maxLength={SCHEMA_LIMITS.TOPIC_DESC_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Sub-topics or chapters covered..."
            className="mt-1.5 w-full resize-none rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-zinc-100 dark:border-zinc-800 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {initialTopic ? 'Save topic' : 'Add topic'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
