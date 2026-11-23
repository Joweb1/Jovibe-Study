import React, { useEffect, useState } from 'react';
import { onSnapshotsInSync } from 'firebase/firestore';
import { ArrowLeft, Check, Download, LogOut, Moon, Square, Sun, Trash2, Volume2 } from 'lucide-react';
import {
  DEFAULT_USER_PREFERENCES,
  type DifficultyLevel,
  type GeminiTtsVoice,
  type TutorSourceMode,
  type UserPreferences,
} from '../types/models';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { usePlatformAccess } from '../context/PlatformAccessContext';
import { useTheme } from '../context/ThemeContext';
import { useRouter } from '../router/RouterContext';
import { db } from '../services/firebase/config';
import { formatReadableError } from '../services/firebase/errors';
import { syncCoursesForOffline } from '../services/firebase/offlineSyncService';
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
  const { courses } = useCourses();
  const { status: platformStatus, usingPersonalKey } = usePlatformAccess();
  const { navigate } = useRouter();
  const { theme, toggleTheme } = useTheme();

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
    cachedAudioClips: 0,
  });
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheSyncing, setCacheSyncing] = useState(false);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [offlineSyncStatus, setOfflineSyncStatus] = useState<string | null>(null);
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
    setOfflineSyncStatus(null);
    try {
      await clearLocalCache();
      geminiAudioPlayer.clearMemoryCache();
      setCacheStats({
        cachedCourses: 0,
        cachedTopics: 0,
        cachedSources: 0,
        cachedDrafts: 0,
        cachedAudioClips: 0,
      });
    } finally {
      setClearingCache(false);
    }
  };

  const handleSyncForOffline = async () => {
    if (!user) return;
    if (!isOnline) {
      setError('Turn on your internet connection to sync your courses for offline study.');
      return;
    }
    setSyncingOffline(true);
    setError(null);
    setOfflineSyncStatus('Starting offline sync...');
    try {
      const result = await syncCoursesForOffline(user.uid, courses, (label) => {
        setOfflineSyncStatus(label);
      });
      const stats = await getLocalCacheStats(user.uid);
      setCacheStats(stats);
      setOfflineSyncStatus(
        `Ready for offline study: ${result.coursesSynced} course${result.coursesSynced === 1 ? '' : 's'}, ${result.sourcesSynced} material${result.sourcesSynced === 1 ? '' : 's'}, ${result.savedResourcesSynced} saved resource${result.savedResourcesSynced === 1 ? '' : 's'}, and ${result.conversationsSynced} tutor chat${result.conversationsSynced === 1 ? '' : 's'} cached on this device.`
      );
    } catch (err) {
      setError(formatReadableError(err));
      setOfflineSyncStatus(null);
    } finally {
      setSyncingOffline(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-10">
      <div className="flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <button
          type="button"
          onClick={() => navigate('/library')}
          aria-label="Back to Library"
          title="Back to Library"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
          Settings
        </h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Profile Section */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-200">Account profile</h2>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-y border-zinc-200 dark:border-zinc-800 py-5">
          <div className="flex items-center gap-3.5 min-w-0">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={profile?.displayName || 'Profile'}
                referrerPolicy="no-referrer"
                className="h-11 w-11 rounded-md border border-zinc-200 dark:border-zinc-700 object-cover shrink-0"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm font-semibold text-zinc-900 dark:text-zinc-200 shrink-0">
                {(profile?.displayName || user?.email || 'S').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-200">
                {profile?.displayName || user?.displayName || 'Student'}
              </div>
              <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {profile?.email || user?.email}
              </div>
            </div>
          </div>

          <Button variant="secondary" size="sm" onClick={() => void signOut()}>
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>

        {/* Expired Free AI Access Notice */}
        {platformStatus && !usingPersonalKey && platformStatus.freeAccess.expired && (
          <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/35 p-4 space-y-1.5 text-xs">
            <div className="font-semibold text-red-900 dark:text-red-200">
              7-Day Free AI Access Expired
            </div>
            <p className="text-red-700 dark:text-red-300 leading-relaxed">
              Your 7-day free AI trial has ended and shared API access is no longer available. Add your own free Google Gemini (or fallback provider) API key in the AI Providers section below to continue using AI features.
            </p>
          </div>
        )}
      </section>

      {/* Appearance */}
      <section className="space-y-4 border-t border-zinc-200 dark:border-zinc-800 pt-8">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-200">Appearance</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Stored locally on this device — not synced to the cloud.
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 border-y border-zinc-200 dark:border-zinc-800 py-4">
          <div>
            <div className="text-sm text-zinc-900 dark:text-zinc-200">Theme</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {theme === 'dark' ? 'Dark mode is on' : 'Light mode is on'}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
          </button>
        </div>
      </section>

      {/* Study & Voice Preferences (Cloud-synced to Firestore) */}
      <section>
        <form onSubmit={handleSavePreferences} className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-200">Learning preferences</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Synchronized to your private Firestore profile across devices.
            </p>
          </div>

          <div className="space-y-5 border-t border-zinc-200 dark:border-zinc-800 pt-5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-start">
              <label htmlFor="pref-default-model" className="sm:col-span-5 sm:pt-2 text-sm text-zinc-900 dark:text-zinc-200">
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
                  className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
                >
                  {AVAILABLE_AI_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {AVAILABLE_AI_MODELS.find((m) => m.id === prefs.defaultModel)?.description ||
                    'Used across AI Tutor, OCR, Practice modes, and Automatic Study.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center">
              <label htmlFor="pref-source-mode" className="sm:col-span-5 text-sm text-zinc-900 dark:text-zinc-200">
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
                className="sm:col-span-7 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
              >
                <option value="materials_only">My Materials Only</option>
                <option value="materials_plus_ai">My Materials + AI Explanation</option>
                <option value="general_ai">General AI Knowledge</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center">
              <label htmlFor="pref-difficulty" className="sm:col-span-5 text-sm text-zinc-900 dark:text-zinc-200">
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
                className="sm:col-span-7 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
              >
                <option value="foundational">Foundational</option>
                <option value="standard">Standard</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center">
              <label htmlFor="pref-voice-enabled" className="sm:col-span-5 text-sm text-zinc-900 dark:text-zinc-200">
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
                  className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 accent-zinc-950 dark:accent-zinc-200 cursor-pointer"
                />
                <span className="text-sm text-zinc-600 dark:text-zinc-300">
                  Enable voice playback controls on AI responses (Gemini with Groq fallback)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-start">
              <label htmlFor="pref-tts-voice" className="sm:col-span-5 sm:pt-2 text-sm text-zinc-900 dark:text-zinc-200">
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
                    className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
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
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {AVAILABLE_TTS_VOICES.find((v) => v.id === prefs.ttsVoice)?.description ||
                    'Powered by Gemini 3.8 Flash Lite TTS with Groq fallback.'}
                </p>
                {playback.activeId === `voice_preview_${prefs.ttsVoice}` && playback.error && (
                  <p className="text-xs text-red-700 dark:text-red-400">{playback.error}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center">
              <label htmlFor="pref-voice-rate" className="sm:col-span-5 text-sm text-zinc-900 dark:text-zinc-200">
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
                  className="w-full accent-zinc-950 dark:accent-zinc-200 cursor-pointer"
                />
                <span className="w-10 text-right font-mono text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
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
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
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
      <section className="space-y-4 border-t border-zinc-200 dark:border-zinc-800 pt-8">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-200">Local device cache (IndexedDB)</h2>
            <div
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
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
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
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
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Firestore offline persistence and local IndexedDB automatically cache courses, library materials, saved resources, tutor chat history, and audio clips so you can keep studying without internet. Clearing local cache does not delete your Cloud Firestore data.
          </p>
        </div>

        <div className="space-y-3 border-y border-zinc-200 dark:border-zinc-800 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
              <span>Courses cached: {cacheStats.cachedCourses}</span>
              <span aria-hidden="true">·</span>
              <span>Topics cached: {cacheStats.cachedTopics}</span>
              <span aria-hidden="true">·</span>
              <span>Materials cached: {cacheStats.cachedSources}</span>
              <span aria-hidden="true">·</span>
              <span>Audio clips: {cacheStats.cachedAudioClips}</span>
              <span aria-hidden="true">·</span>
              <span>Drafts: {cacheStats.cachedDrafts}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleSyncForOffline()}
                loading={syncingOffline}
                disabled={!isOnline || courses.length === 0}
                title={
                  !isOnline
                    ? 'Turn on internet to download latest updates for offline study'
                    : 'Download all courses, library notes, saved resources, and recent chats for offline study'
                }
              >
                <Download className="h-3.5 w-3.5" />
                Save all for offline
              </Button>
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

          {offlineSyncStatus && (
            <p className="text-xs text-zinc-700 dark:text-zinc-300">{offlineSyncStatus}</p>
          )}
        </div>
      </section>
    </div>
  );
};
