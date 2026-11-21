import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AudioLines,
  BarChart3,
  BookOpen,
  Clock,
  Flame,
  FolderOpen,
  GraduationCap,
  KeyRound,
  Layers,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Moon,
  Settings,
  Sun,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { AppRoute } from '../../types/models';
import { useAuth } from '../../context/AuthContext';
import { useCourses } from '../../context/CourseContext';
import { useGeminiOnboarding } from '../../context/GeminiOnboardingContext';
import { useTheme } from '../../context/ThemeContext';
import { useWorkspaceUi } from '../../context/WorkspaceUiContext';
import { useRouter } from '../../router/RouterContext';
import { CourseModal } from '../courses/CourseModal';
import { CourseSelector } from '../courses/CourseSelector';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { StreakHeaderIndicator } from '../streak/StreakHeaderIndicator';
import { SotalLogo } from '../ui/SotalLogo';
import { ErrorBanner } from '../ui/StateViews';

const DESKTOP_NAV_ITEMS: Array<{
  route: AppRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { route: '/courses', label: 'Courses', icon: LayoutGrid },
  { route: '/library', label: 'Library', icon: BookOpen },
  { route: '/tutor', label: 'Tutor', icon: MessageSquare },
  { route: '/practice', label: 'Practice', icon: Layers },
  { route: '/live', label: 'Live', icon: AudioLines },
  { route: '/automatic-study', label: 'Automatic Study', icon: GraduationCap },
  { route: '/history', label: 'History', icon: Clock },
];

const BOTTOM_NAV_ITEMS: Array<{
  route: AppRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { route: '/courses', label: 'Courses', icon: LayoutGrid },
  { route: '/library', label: 'Library', icon: BookOpen },
  { route: '/tutor', label: 'Tutor', icon: MessageSquare },
  { route: '/practice', label: 'Practice', icon: Layers },
  { route: '/live', label: 'Live', icon: AudioLines },
];

const CHROME_HIDDEN_ROUTES: ReadonlySet<AppRoute> = new Set<AppRoute>([
  '/automatic-study',
  '/live',
  '/history',
  '/settings',
  '/manage-course',
  '/join',
  '/streak',
  '/dashboard',
]);

const AI_FEATURE_ROUTES: ReadonlySet<AppRoute> = new Set<AppRoute>([
  '/tutor',
  '/practice',
  '/automatic-study',
  '/live',
]);

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, isOnline, justReconnected, signOut } = useAuth();
  const { createCourse, courseError, clearCourseError } = useCourses();
  const {
    needsSetupReminder,
    reminderDismissedThisSession,
    openSettingsKeyGuide,
    dismissReminderForSession,
    notifyProfileMenuChange,
  } = useGeminiOnboarding();
  const { theme, toggleTheme } = useTheme();
  const {
    hideHeader,
    setHideHeader,
    hideBottomNav,
    setHideBottomNav,
    lockViewport,
    setLockViewport,
    minimizedLiveSession,
    setMinimizedLiveSession,
  } = useWorkspaceUi();
  const { route, navigate } = useRouter();
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  // Reset route-scoped UI overrides on navigation
  useEffect(() => {
    if (route !== '/tutor') {
      setHideHeader(false);
    }
    setHideBottomNav(false);
    if (route !== '/library' && route !== '/tutor') {
      setLockViewport(false);
    }
  }, [route, setHideHeader, setHideBottomNav, setLockViewport]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target instanceof Element && target.closest('[data-onboarding-tooltip="true"]')) {
        return;
      }
      if (accountMenuRef.current && target && !accountMenuRef.current.contains(target)) {
        setAccountMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [accountMenuOpen]);

  // Keep the interactive Gemini setup spotlight synchronized with the real profile menu state
  useEffect(() => {
    notifyProfileMenuChange(accountMenuOpen);
  }, [accountMenuOpen, notifyProfileMenuChange]);

  const initials = (profile?.displayName || user?.displayName || user?.email || 'S')
    .slice(0, 1)
    .toUpperCase();

  const isLiveRoute = route === '/live';
  const effectiveHideHeader =
    hideHeader || route === '/tutor' || CHROME_HIDDEN_ROUTES.has(route);
  const effectiveHideBottomNav = hideBottomNav || CHROME_HIDDEN_ROUTES.has(route);
  const effectiveLockViewport = lockViewport || route === '/tutor' || isLiveRoute;

  return (
    <div
      className={
        effectiveLockViewport
          ? 'h-[100dvh] overflow-hidden bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-200 flex flex-col'
          : 'min-h-screen bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-200 flex flex-col'
      }
    >
      {/* Top Bar: strict 3-zone contract (hidden on Tutor, focused search, and back-nav views) */}
      {!effectiveHideHeader && (
        <header className="sticky top-0 z-30 shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 md:gap-8 px-4 sm:px-6">
            {/* Zone 1: Brand Logo & Wordmark */}
            <button
              type="button"
              onClick={() => navigate('/courses')}
              className="inline-flex items-center gap-2 font-display text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-200 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SotalLogo size="md" />
              <span>SOTAL Study</span>
            </button>

            {/* Zone 2: Primary Desktop Navigation */}
            <nav
              aria-label="Primary navigation"
              className="hidden md:flex items-center gap-6"
            >
              {DESKTOP_NAV_ITEMS.map((item) => {
                const active = route === item.route;
                return (
                  <button
                    key={item.route}
                    type="button"
                    onClick={() => navigate(item.route)}
                    aria-current={active ? 'page' : undefined}
                    className={`relative py-4 text-sm whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      active
                        ? 'font-medium text-zinc-950 dark:text-zinc-200'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
                    }`}
                  >
                    {item.label}
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-950 dark:bg-zinc-200"
                      />
                    )}
                  </button>
                );
              })}
            </nav>

          {/* Zone 3: Streak Indicator, Course Selector & Account Menu */}
          <div className="flex items-center gap-2 shrink-0">
            <StreakHeaderIndicator />

            <CourseSelector onNewCourse={() => setCourseModalOpen(true)} />

            <div ref={accountMenuRef} className="relative">
              <button
                type="button"
                data-onboarding="profile-button"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                aria-label="Account and settings"
                aria-expanded={accountMenuOpen}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-xs font-medium text-zinc-900 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={profile?.displayName || 'Account'}
                    referrerPolicy="no-referrer"
                    className="h-full w-full rounded-[5px] object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </button>

              <AnimatePresence>
                {accountMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute right-0 z-40 mt-2 w-56 origin-top-right rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 shadow-lg"
                  >
                    <div className="border-b border-zinc-100 dark:border-zinc-800 px-3 py-2.5">
                      <div className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-200">
                        {profile?.displayName || user?.displayName || 'Student'}
                      </div>
                      <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {profile?.email || user?.email || ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigate('/dashboard');
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      <BarChart3 className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      Study Dashboard
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigate('/streak');
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      <Flame className="h-4 w-4 text-orange-500 dark:text-orange-400" />
                      Study Streak
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigate('/courses');
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      <FolderOpen className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      Courses
                    </button>
                    <button
                      type="button"
                      data-onboarding="settings-menu-item"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigate('/settings');
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      <Settings className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      Settings
                    </button>
                    <button
                      type="button"
                      onClick={toggleTheme}
                      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                      className="flex w-full items-center justify-between gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      <span className="flex items-center gap-2.5">
                        {theme === 'dark' ? (
                          <Sun className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        ) : (
                          <Moon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        )}
                        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                          theme === 'dark' ? 'bg-zinc-200' : 'bg-zinc-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 rounded-full transition-transform ${
                            theme === 'dark'
                              ? 'translate-x-3.5 bg-zinc-950'
                              : 'translate-x-0.5 bg-white'
                          }`}
                        />
                      </span>
                    </button>
                    <PWAInstallButton
                      variant="menu"
                      onActionComplete={() => setAccountMenuOpen(false)}
                    />
                    <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        void signOut();
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      <LogOut className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      Sign out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            </div>
          </div>
        </header>
      )}

      {/* Calm offline study notice — shown across workspace routes when offline (SOTAL Live renders its own dedicated view) */}
      {!isOnline && !isLiveRoute && (
        <div
          role="status"
          className="shrink-0 border-b border-amber-200/80 dark:border-amber-900/50 bg-amber-50/90 dark:bg-amber-950/35 px-4 py-2 text-xs text-amber-950 dark:text-amber-100"
        >
          <div className="mx-auto flex max-w-[1200px] items-center gap-2">
            <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
            <span>
              You&apos;re offline. You can browse cached courses, library notes, saved resources, and chat history. Turn on your internet to use AI features or sync changes.
            </span>
          </div>
        </div>
      )}

      {/* Brief reconnection confirmation */}
      {isOnline && justReconnected && !isLiveRoute && (
        <div
          role="status"
          className="shrink-0 border-b border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/90 dark:bg-emerald-950/35 px-4 py-2 text-xs text-emerald-950 dark:text-emerald-100"
        >
          <div className="mx-auto flex max-w-[1200px] items-center gap-2">
            <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
            <span>Back online — syncing your study data and re-enabling AI features.</span>
          </div>
        </div>
      )}

      {/* Calm, non-blocking Gemini API key setup reminder shown only on AI routes when skipped/incomplete */}
      {needsSetupReminder && !reminderDismissedThisSession && AI_FEATURE_ROUTES.has(route) && (
        <div className="shrink-0 border-b border-amber-200/80 dark:border-amber-900/50 bg-amber-50/90 dark:bg-amber-950/35 px-4 py-2 text-xs text-amber-950 dark:text-amber-100">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
              <span className="truncate">
                Gemini API key not set up yet — add your free key to power SOTAL AI features.
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={openSettingsKeyGuide}
                className="rounded-md bg-zinc-950 dark:bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-white transition-colors cursor-pointer"
              >
                Set up key
              </button>
              <button
                type="button"
                onClick={dismissReminderForSession}
                aria-label="Dismiss API key setup reminder"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-amber-800/70 dark:text-amber-300/70 hover:bg-amber-200/50 dark:hover:bg-amber-900/40 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main
        className={
          isLiveRoute
            ? 'h-[100dvh] w-full flex-1 min-h-0 overflow-hidden flex flex-col'
            : effectiveLockViewport
            ? `mx-auto w-full max-w-[1200px] flex-1 min-h-0 flex flex-col px-4 sm:px-6 transition-[padding] duration-200 ${
                effectiveHideHeader ? 'pt-3' : 'pt-5'
              } ${effectiveHideBottomNav ? 'pb-3' : 'pb-[84px] md:pb-5'}`
            : `mx-auto w-full max-w-[1200px] flex-1 px-4 sm:px-6 transition-[padding] duration-200 ${
                effectiveHideHeader ? 'pt-5' : 'pt-8'
              } ${effectiveHideBottomNav ? 'pb-12' : 'pb-24 md:pb-16'}`
        }
      >
        {courseError && !isLiveRoute && (
          <div className="mb-4 shrink-0">
            <ErrorBanner message={courseError} onDismiss={clearCourseError} />
          </div>
        )}
        {children}
      </main>

      {/* Minimized SOTAL Live Floating Resume Bar */}
      <AnimatePresence>
        {minimizedLiveSession && !isLiveRoute && (
          <motion.div
            key="minimized-sotal-live-bar"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`fixed z-40 left-4 right-4 md:left-auto md:right-6 md:w-[340px] ${
              effectiveHideBottomNav ? 'bottom-4' : 'bottom-[72px] md:bottom-5'
            }`}
          >
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-[#12151D]/95 px-3.5 py-2.5 shadow-lg">
              <button
                type="button"
                onClick={() =>
                  navigate(
                    minimizedLiveSession.sourceId
                      ? `/live/${minimizedLiveSession.sourceId}`
                      : '/live'
                  )
                }
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer"
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 via-sky-500 to-indigo-500 text-white">
                  <AudioLines className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-950 dark:text-zinc-100">
                    <span>SOTAL Live</span>
                    <span aria-hidden="true" className="text-zinc-400">
                      ·
                    </span>
                    <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {minimizedLiveSession.courseCode}
                    </span>
                  </div>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {minimizedLiveSession.lessonTitle}
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMinimizedLiveSession(null)}
                aria-label="End minimized SOTAL Live session"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixed Curved Pill Bottom Navigation (smoothly hides on back-nav sub-pages & focused chat input) */}
      <AnimatePresence>
        {!effectiveHideBottomNav && (
          <motion.nav
            key="mobile-bottom-pill-nav"
            aria-label="Mobile navigation"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 md:hidden"
          >
            <motion.div
              layout
              transition={{ type: 'spring', stiffness: 450, damping: 34 }}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-100/95 dark:bg-zinc-900/95 p-1 shadow-md backdrop-blur"
            >
              {BOTTOM_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = route === item.route;
                return (
                  <motion.button
                    layout
                    key={item.route}
                    type="button"
                    onClick={() => navigate(item.route)}
                    aria-label={item.label}
                    title={item.label}
                    aria-current={active ? 'page' : undefined}
                    transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    className={`relative inline-flex h-10 items-center justify-center rounded-full text-sm font-medium transition-colors cursor-pointer ${
                      active
                        ? 'gap-2 px-4 text-white dark:text-zinc-950'
                        : 'w-11 text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="mobile-bottom-nav-pill"
                        transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                        className="absolute inset-0 rounded-full bg-zinc-950 dark:bg-zinc-200"
                        aria-hidden="true"
                      />
                    )}
                    <Icon className="relative z-10 h-[18px] w-[18px] shrink-0" />
                    {active && (
                      <motion.span
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.16 }}
                        className="relative z-10 whitespace-nowrap"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </motion.button>
                );
              })}
            </motion.div>
          </motion.nav>
        )}
      </AnimatePresence>

      {/* Global Create Course Modal */}
      <CourseModal
        open={courseModalOpen}
        onClose={() => setCourseModalOpen(false)}
        onSubmit={async (input) => {
          await createCourse(input);
        }}
      />
    </div>
  );
};
