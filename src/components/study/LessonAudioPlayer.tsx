import React from 'react';
import {
  AlertCircle,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { geminiAudioPlayer, type PlaybackState } from '../../services/ai/audioService';

interface LessonAudioPlayerProps {
  entryId: string;
  title?: string;
  playback: PlaybackState;
  isOnline: boolean;
  onPlayOrToggle: () => void;
  onRetry: () => void;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const LessonAudioPlayer: React.FC<LessonAudioPlayerProps> = ({
  entryId,
  title,
  playback,
  isOnline,
  onPlayOrToggle,
  onRetry,
}) => {
  const isActive = playback.activeId === entryId;
  const isLoading = isActive && playback.status === 'loading';
  const isPlaying = isActive && playback.status === 'playing';
  const isPaused = isActive && playback.status === 'paused';
  const hasError = isActive && Boolean(playback.error);
  const isAutoplayBlocked = isActive && playback.autoplayBlocked;

  const currentTime = isActive ? playback.currentTime : 0;
  const duration = isActive ? playback.duration : 0;
  const progressMax = duration > 0 ? duration : 100;
  const progressValue = duration > 0 ? Math.min(duration, currentTime) : 0;

  return (
    <div
      className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/80 px-3.5 py-2.5"
      aria-label={`Audio narration controls${title ? ` for ${title}` : ''}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* Play / Pause / Resume primary button */}
        <button
          type="button"
          onClick={() => {
            if (isAutoplayBlocked) {
              void geminiAudioPlayer.resumeBlockedAutoplay();
            } else {
              onPlayOrToggle();
            }
          }}
          disabled={isLoading || (!isOnline && !isPlaying && !isPaused)}
          aria-label={
            isLoading
              ? 'Generating audio narration'
              : isPlaying
              ? 'Pause narration'
              : isPaused
              ? 'Resume narration'
              : 'Play lesson narration'
          }
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-zinc-950 dark:bg-zinc-100 px-3 text-xs font-medium text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-white disabled:opacity-50 transition-colors cursor-pointer"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Generating audio...</span>
            </>
          ) : isPlaying ? (
            <>
              <Pause className="h-3.5 w-3.5" />
              <span>Pause</span>
            </>
          ) : isPaused ? (
            <>
              <Play className="h-3.5 w-3.5" />
              <span>Resume</span>
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              <span>Listen</span>
            </>
          )}
        </button>

        {/* Seek / progress bar */}
        <div className="flex min-w-[160px] flex-1 items-center gap-2">
          <span className="w-9 text-right font-mono text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={progressMax}
            step={0.25}
            value={progressValue}
            disabled={!isActive || (!isPlaying && !isPaused) || duration <= 0}
            onChange={(e) => geminiAudioPlayer.seek(Number(e.target.value))}
            aria-label="Seek narration progress"
            className="h-1.5 flex-1 accent-zinc-950 dark:accent-zinc-100 cursor-pointer disabled:opacity-40"
          />
          <span className="w-9 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
            {duration > 0 ? formatTime(duration) : '--:--'}
          </span>
        </div>

        {/* Volume & Stop controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => geminiAudioPlayer.toggleMute()}
            aria-label={playback.muted || playback.volume === 0 ? 'Unmute audio' : 'Mute audio'}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-100 cursor-pointer"
          >
            {playback.muted || playback.volume === 0 ? (
              <VolumeX className="h-3.5 w-3.5" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={playback.muted ? 0 : playback.volume}
            onChange={(e) => geminiAudioPlayer.setVolume(Number(e.target.value))}
            aria-label="Narration volume"
            className="w-16 sm:w-20 h-1.5 accent-zinc-950 dark:accent-zinc-100 cursor-pointer"
          />
          {(isPlaying || isPaused || isLoading) && (
            <button
              type="button"
              onClick={() => geminiAudioPlayer.stop()}
              aria-label="Stop narration"
              title="Stop narration"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-100 cursor-pointer"
            >
              <Square className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Status / Error / Autoplay recovery notice */}
      {hasError && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/40 px-2.5 py-1.5 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{playback.error}</span>
          </div>
          {isAutoplayBlocked ? (
            <button
              type="button"
              onClick={() => void geminiAudioPlayer.resumeBlockedAutoplay()}
              className="inline-flex items-center gap-1 rounded bg-zinc-950 dark:bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-white dark:text-zinc-950 cursor-pointer"
            >
              <Play className="h-3 w-3" />
              Start playback
            </button>
          ) : (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded border border-amber-300 dark:border-amber-700 px-2 py-0.5 text-[11px] font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40 cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              Retry audio
            </button>
          )}
        </div>
      )}
    </div>
  );
};
