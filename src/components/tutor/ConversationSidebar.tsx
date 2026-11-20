import React, { useState } from 'react';
import { Check, MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react';
import type { TutorConversation, TutorSourceMode } from '../../types/models';
import { formatShortDate } from '../../utils/validation';
import { Button } from '../ui/Button';

interface ConversationSidebarProps {
  conversations: TutorConversation[];
  activeConversationId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const MODE_SHORT_LABEL: Record<TutorSourceMode, string> = {
  materials_only: 'Materials only',
  materials_plus_ai: 'Materials + AI',
  general_ai: 'General AI',
};

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  activeConversationId,
  loading,
  onSelect,
  onNewConversation,
  onRename,
  onDelete,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const startEdit = (conv: TutorConversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
    setConfirmDeleteId(null);
  };

  const commitRename = async (id: string) => {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    setBusyId(id);
    try {
      await onRename(id, trimmed);
      setEditingId(null);
    } finally {
      setBusyId(null);
    }
  };

  const commitDelete = async (id: string) => {
    setBusyId(id);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-3 mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Conversations
        </span>
        <Button variant="secondary" size="sm" onClick={onNewConversation}>
          <MessageSquarePlus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3 py-2">
          <div className="h-10 rounded bg-zinc-100 animate-pulse" />
          <div className="h-10 rounded bg-zinc-100 animate-pulse" />
        </div>
      ) : conversations.length === 0 ? (
        <div className="py-6 text-xs leading-relaxed text-zinc-500">
          No conversations in this course yet. Ask a question to start a persistent study thread.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-zinc-200/80">
          {conversations.map((conv) => {
            const isActive = conv.id === activeConversationId;
            const isEditing = editingId === conv.id;
            const isDeleting = confirmDeleteId === conv.id;

            return (
              <div
                key={conv.id}
                onClick={() => {
                  if (!isEditing && !isDeleting) {
                    onSelect(conv.id);
                  }
                }}
                className={`group py-2.5 px-2 transition-colors cursor-pointer ${
                  isActive ? 'bg-zinc-100 text-zinc-950' : 'hover:bg-zinc-50 text-zinc-700'
                }`}
              >
                {isEditing ? (
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename(conv.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      maxLength={160}
                      className="min-w-0 flex-1 rounded border border-zinc-400 bg-white px-2 py-1 text-xs text-zinc-950 focus:border-zinc-950 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busyId === conv.id}
                      onClick={() => void commitRename(conv.id)}
                      aria-label="Save conversation name"
                      className="p-1 text-zinc-700 hover:text-zinc-950"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      aria-label="Cancel rename"
                      className="p-1 text-zinc-500 hover:text-zinc-900"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : isDeleting ? (
                  <div
                    className="flex items-center justify-between gap-2 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-zinc-700 truncate">Delete thread?</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyId === conv.id}
                        onClick={() => void commitDelete(conv.id)}
                        className="font-medium text-red-700 underline underline-offset-2"
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
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-xs ${
                          isActive ? 'font-semibold text-zinc-950' : 'font-medium text-zinc-900'
                        }`}
                      >
                        {conv.title || 'Untitled conversation'}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500 tabular-nums">
                        <span>{MODE_SHORT_LABEL[conv.sourceMode] ?? 'Materials + AI'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{conv.messageCount ?? 0} msg</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatShortDate(conv.updatedAt)}</span>
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => startEdit(conv, e)}
                        aria-label={`Rename ${conv.title}`}
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-900"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(conv.id)}
                        aria-label={`Delete ${conv.title}`}
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-200/60 hover:text-red-700"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
