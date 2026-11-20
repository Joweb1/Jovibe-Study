import React, { useEffect, useState } from 'react';
import { onSnapshotsInSync } from 'firebase/firestore';
import { ArrowLeft, Check, LogOut, Square, Trash2, Volume2 } from 'lucide-react';
import {
  DEFAULT_USER_PREFERENCES,
  type DifficultyLevel,
  type GeminiTtsVoice,
  type TutorSourceMode,
  type UserPreferences,
} from '../types/models';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../router/RouterContext';
import { db } from '../services/firebase/config';
import { formatReadableError } from '../services/firebase/errors';
import {
  clearLocalCache,
  getLocalCacheStats,
  subscribeLocalCacheSync,
} from '../services/local/indexedDb';
import { AVAILABLE_AI_MODELS, AVAILABLE_TTS_VOICES } from '../services/ai/geminiClient';
import { geminiAudioPlayer, type PlaybackState } from '../services/ai/audioService';
import { Button } from '../components/ui/Button';
import { ErrorBanner } from '../components/ui/StateViews';
import { AiKeySettingsSection } from '../components/settings/AiKeySettingsSection';
import { PWAInstallButton } from '../components/pwa/PWAInstallButton';

export const SettingsPage: React.FC = () => {
  const { user, profile, isOnline, savePreferences, signOut } = useAuth();
  const { navigate } = useRouter();

  const [prefs, setPrefs] = useState<UserPreferences>(
    profile?.preferences ?? DEFAULT_USER_PREFERENCES
  );
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cacheStats, setCacheStats] = useState({
    cachedCourses: 0,
    cachedTopics: 0,
    cachedSources: 0,
    cachedDrafts: 0,
  });
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheSyncing, setCacheSyncing] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState>(() => geminiAudioPlayer.getState());

  useEffect(() => {
    return geminiAudioPlayer.subscribe(setPlayback);
  }, []);

  useEffect(() => {
    if (profile?.preferences) {
      setPrefs(profile.preferences);
    }
  }, [profile?.preferences]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const refreshStats = () => {
      void getLocalCacheStats(user.uid).then((stats) => {
        if (active) setCacheStats(stats);
      });
    };

    refreshStats();

    const unsubLocal = subscribeLocalCacheSync(() => {
      refreshStats();
    });

    const unsubFirestoreSync = onSnapshotsInSync(db, () => {
      if (!active) return;
      setCacheSyncing(false);
      refreshStats();
    });

    return () => {
      active = false;
      unsubLocal();
      unsubFirestoreSync();
    };
  }, [user]);

  useEffect(() => {
    if (!isOnline) {
      setCacheSyncing(false);
      return;
    }
    setCacheSyncing(true);
    const timer = window.setTimeout(() => {
      setCacheSyncing(false);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [isOnline]);

  const handlePreviewVoice = async () => {
    const previewId = `voice_preview_${prefs.ttsVoice}`;
    if (playback.activeId === previewId && (playback.status === 'playing' || playback.status === 'loading')) {
      geminiAudioPlayer.stop();
      return;
    }
    setError(null);
    await geminiAudioPlayer.playMessage({
      id: previewId,
      text: `Hello, I am ${prefs.ttsVoice}. I will read your SOTAL Study tutor explanations and course summaries clearly at your preferred pace.`,
      voiceName: prefs.ttsVoice,
      playbackRate: prefs.voiceRate,
    });
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    setError(null);
    try {
      await savePreferences(prefs);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClearLocalCache = async () => {
    setClearingCache(true);
    try {
      await clearLocalCache();
      setCacheStats({ cachedCourses: 0, cachedTopics: 0, cachedSources: 0, cachedDrafts: 0 });
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-10">
      <div className="flex items-center gap-3 border-b border-zinc-200 pb-5">
        <button
          type="button"
          onClick={() => navigate('/library')}
          aria-label="Back to Library"
          title="Back to Library"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950">
          Settings
        </h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Profile Section */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-950">Account profile</h2>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-y border-zinc-200 py-5">
          <div className="flex items-center gap-3.5 min-w-0">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={profile?.displayName || 'Profile'}
                referrerPolicy="no-referrer"
                className="h-11 w-11 rounded-md border border-zinc-200 object-cover shrink-0"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-sm font-semibold text-zinc-900 shrink-0">
                {(profile?.displayName || user?.email || 'S').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-zinc-950">
                {profile?.displayName || user?.displayName || 'Student'}
              </div>
              <div className="truncate text-xs text-zinc-500">
                {profile?.email || user?.email}
              </div>
            </div>
          </div>

          <Button variant="secondary" size="sm" onClick={() => void signOut()}>
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </section>

      {/* Study & Voice Preferences (Cloud-synced to Firestore) */}
      <section>
        <form onSubmit={handleSavePreferences} className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">Learning preferences</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Synchronized to your private Firestore profile across devices.
            </p>
          </div>

          <div className="space-y-5 border-t border-zinc-200 pt-5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-start">
              <label htmlFor="pref-default-model" className="sm:col-span-5 sm:pt-2 text-sm text-zinc-900">
                Default Gemini model
              </label>
              <div className="sm:col-span-7 space-y-1.5">
                <select
                  id="pref-default-model"
                  value={prefs.defaultModel}
                  onChange={(e) =>
                    setPrefs((prev) => ({
                      ...prev,
                      defaultModel: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
                >
                  {AVAILABLE_AI_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-zinc-500">
                  {AVAILABLE_AI_MODELS.find((m) => m.id === prefs.defaultModel)?.description ||
                    'Used across AI Tutor, OCR, Practice modes, and Automatic Study.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center">
              <label htmlFor="pref-source-mode" className="sm:col-span-5 text-sm text-zinc-900">
                Default Tutor source mode
              </label>
              <select
                id="pref-source-mode"
                value={prefs.tutorSourceMode}
                onChange={(e) =>
                  setPrefs((prev) => ({
                    ...prev,
                    tutorSourceMode: e.target.value as TutorSourceMode,
                  }))
                }
                className="sm:col-span-7 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
              >
                <option value="materials_only">My Materials Only</option>
                <option value="materials_plus_ai">My Materials + AI Explanation</option>
                <option value="general_ai">General AI Knowledge</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center">
              <label htmlFor="pref-difficulty" className="sm:col-span-5 text-sm text-zinc-900">
                Default difficulty level
              </label>
              <select
                id="pref-difficulty"
                value={prefs.defaultDifficulty}
                onChange={(e) =>
                  setPrefs((prev) => ({
                    ...prev,
                    defaultDifficulty: e.target.value as DifficultyLevel,
                  }))
                }
                className="sm:col-span-7 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
              >
                <option value="foundational">Foundational</option>
                <option value="standard">Standard</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center">
              <label htmlFor="pref-voice-enabled" className="sm:col-span-5 text-sm text-zinc-900">
                Voice playback for AI replies
              </label>
              <div className="sm:col-span-7 flex items-center gap-3">
                <input
                  id="pref-voice-enabled"
                  type="checkbox"
                  checked={prefs.voiceEnabled}
                  onChange={(e) =>
                    setPrefs((prev) => ({ ...prev, voiceEnabled: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-zinc-300 accent-zinc-950 cursor-pointer"
                />
                <span className="text-sm text-zinc-600">
                  Enable Gemini 3.8 voice playback controls on AI responses
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-start">
              <label htmlFor="pref-tts-voice" className="sm:col-span-5 sm:pt-2 text-sm text-zinc-900">
                Gemini 3.8 voice
              </label>
              <div className="sm:col-span-7 space-y-1.5">
                <div className="flex items-center gap-2">
                  <select
                    id="pref-tts-voice"
                    value={prefs.ttsVoice}
                    onChange={(e) =>
                      setPrefs((prev) => ({
                        ...prev,
                        ttsVoice: e.target.value as GeminiTtsVoice,
                      }))
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
                  >
                    {AVAILABLE_TTS_VOICES.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={
                      playback.activeId === `voice_preview_${prefs.ttsVoice}` &&
                      playback.status === 'loading'
                    }
                    onClick={() => void handlePreviewVoice()}
                    className="shrink-0"
                  >
                    {playback.activeId === `voice_preview_${prefs.ttsVoice}` &&
                    playback.status === 'playing' ? (
                      <>
                        <Square className="h-3.5 w-3.5" />
                        Stop
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-3.5 w-3.5" />
                        Preview
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-zinc-500">
                  {AVAILABLE_TTS_VOICES.find((v) => v.id === prefs.ttsVoice)?.description ||
                    'Powered by Gemini 3.8 Flash Lite TTS.'}
                </p>
                {playback.activeId === `voice_preview_${prefs.ttsVoice}` && playback.error && (
                  <p className="text-xs text-red-700">{playback.error}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center">
              <label htmlFor="pref-voice-rate" className="sm:col-span-5 text-sm text-zinc-900">
                Playback speed ({prefs.voiceRate.toFixed(1)}x)
              </label>
              <div className="sm:col-span-7 flex items-center gap-3">
                <input
                  id="pref-voice-rate"
                  type="range"
                  min={0.6}
                  max={1.8}
                  step={0.1}
                  value={prefs.voiceRate}
                  onChange={(e) =>
                    setPrefs((prev) => ({
                      ...prev,
                      voiceRate: Number(e.target.value),
                    }))
                  }
                  className="w-full accent-zinc-950 cursor-pointer"
                />
                <span className="w-10 text-right font-mono text-xs text-zinc-600 tabular-nums">
                  {prefs.voiceRate.toFixed(1)}x
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" loading={saving}>
              Save preferences
            </Button>
            {savedNotice && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700">
                <Check className="h-3.5 w-3.5" />
                Saved to cloud
              </span>
            )}
          </div>
        </form>
      </section>

      {/* Device-Local BYOK AI Keys & Fallback Configuration */}
      <AiKeySettingsSection defaultModel={prefs.defaultModel} />

      {/* Local Storage / IndexedDB Cache */}
      <section className="space-y-4 border-t border-zinc-200 pt-8">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-950">Local device cache (IndexedDB)</h2>
            <div
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1.5 text-xs text-zinc-600"
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full shrink-0 transition-colors ${
                  !isOnline
                    ? 'bg-amber-500'
                    : cacheSyncing || clearingCache
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-emerald-500'
                }`}
              />
              <span className="font-medium text-zinc-700">
                {!isOnline
                  ? 'Offline'
                  : clearingCache
                  ? 'Clearing cache...'
                  : cacheSyncing
                  ? 'Syncing...'
                  : 'Online · Synced'}
              </span>
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Caches courses, topics, and unsaved drafts locally for fast startup and offline reading. Clearing local cache does not delete your Cloud Firestore data.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-y border-zinc-200 py-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600 tabular-nums">
            <span>Courses cached: {cacheStats.cachedCourses}</span>
            <span aria-hidden="true">·</span>
            <span>Topics cached: {cacheStats.cachedTopics}</span>
            <span aria-hidden="true">·</span>
            <span>Materials cached: {cacheStats.cachedSources}</span>
            <span aria-hidden="true">·</span>
            <span>Drafts: {cacheStats.cachedDrafts}</span>
          </div>
          <div className="flex items-center gap-2">
            <PWAInstallButton variant="button" />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleClearLocalCache()}
              loading={clearingCache}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear local cache
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};
