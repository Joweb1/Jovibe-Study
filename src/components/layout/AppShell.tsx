import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen,
  Clock,
  FolderOpen,
  GraduationCap,
  Layers,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Moon,
  Settings,
  Sun,
  WifiOff,
} from 'lucide-react';
import type { AppRoute } from '../../types/models';
import { useAuth } from '../../context/AuthContext';
import { useCourses } from '../../context/CourseContext';
import { useTheme } from '../../context/ThemeContext';
import { useWorkspaceUi } from '../../context/WorkspaceUiContext';
import { useRouter } from '../../router/RouterContext';
import { CourseModal } from '../courses/CourseModal';
import { CourseSelector } from '../courses/CourseSelector';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
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
];

const CHROME_HIDDEN_ROUTES: ReadonlySet<AppRoute> = new Set<AppRoute>([
  '/automatic-study',
  '/history',
  '/settings',
]);

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, isOnline, signOut } = useAuth();
  const { createCourse, courseError, clearCourseError } = useCourses();
  const { theme, toggleTheme } = useTheme();
  const {
    hideHeader,
    setHideHeader,
    hideBottomNav,
    setHideBottomNav,
    lockViewport,
    setLockViewport,
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
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
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

  const initials = (profile?.displayName || user?.displayName || user?.email || 'S')
    .slice(0, 1)
    .toUpperCase();

  const effectiveHideHeader =
    hideHeader || route === '/tutor' || CHROME_HIDDEN_ROUTES.has(route);
  const effectiveHideBottomNav = hideBottomNav || CHROME_HIDDEN_ROUTES.has(route);
  const effectiveLockViewport = lockViewport || route === '/tutor';

  return (
    <div
      className={
        effectiveLockViewport
          ? 'h-[100dvh] overflow-hidden bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-50 flex flex-col'
          : 'min-h-screen bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-50 flex flex-col'
      }
    >
      {/* Top Bar: strict 3-zone contract (hidden on Tutor, focused search, and back-nav views) */}
      {!effectiveHideHeader && (
        <header className="sticky top-0 z-30 shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 md:gap-8 px-4 sm:px-6">
            {/* Zone 1: Brand Wordmark */}
            <button
              type="button"
              onClick={() => navigate('/courses')}
              className="font-display text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              SOTAL Study
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
                        ? 'font-medium text-zinc-950 dark:text-zinc-50'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100'
                    }`}
                  >
                    {item.label}
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-950 dark:bg-zinc-50"
                      />
                    )}
                  </button>
                );
              })}
            </nav>

          {/* Zone 3: Course Selector & Account Menu */}
          <div className="flex items-center gap-2.5 shrink-0">
            <CourseSelector onNewCourse={() => setCourseModalOpen(true)} />

            {/* Theme toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <div ref={accountMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                aria-label="Account and settings"
                aria-expanded={accountMenuOpen}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-xs font-medium text-zinc-900 dark:text-zinc-100 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
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
                      <div className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">
                        {profile?.displayName || user?.displayName || 'Student'}
                      </div>
                      <div className="truncate text-xs text-zinc-500">
                        {profile?.email || user?.email || ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigate('/courses');
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-50 cursor-pointer"
                    >
                      <FolderOpen className="h-4 w-4 text-zinc-500" />
                      Courses
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigate('/settings');
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-50 cursor-pointer"
                    >
                      <Settings className="h-4 w-4 text-zinc-500" />
                      Settings
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
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-50 cursor-pointer"
                    >
                      <LogOut className="h-4 w-4 text-zinc-500" />
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

      {/* Honest offline notice — shown ONLY when offline and header is visible */}
      {!isOnline && !effectiveHideHeader && (
        <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300">
          <div className="mx-auto flex max-w-[1200px] items-center gap-2">
            <WifiOff className="h-3.5 w-3.5 shrink-0 text-zinc-600 dark:text-zinc-400" />
            <span>
              You are offline. Cached courses and topics remain viewable; cloud sync and AI tools require an internet connection.
            </span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main
        className={
          effectiveLockViewport
            ? `mx-auto w-full max-w-[1200px] flex-1 min-h-0 flex flex-col px-4 sm:px-6 transition-[padding] duration-200 ${
                effectiveHideHeader ? 'pt-3' : 'pt-5'
              } ${effectiveHideBottomNav ? 'pb-3' : 'pb-[84px] md:pb-5'}`
            : `mx-auto w-full max-w-[1200px] flex-1 px-4 sm:px-6 transition-[padding] duration-200 ${
                effectiveHideHeader ? 'pt-5' : 'pt-8'
              } ${effectiveHideBottomNav ? 'pb-12' : 'pb-24 md:pb-16'}`
        }
      >
        {courseError && (
          <div className="mb-4 shrink-0">
            <ErrorBanner message={courseError} onDismiss={clearCourseError} />
          </div>
        )}
        {children}
      </main>

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
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-100/95 dark:bg-zinc-800/95 p-1 shadow-md backdrop-blur"
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
                        : 'w-11 text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="mobile-bottom-nav-pill"
                        transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                        className="absolute inset-0 rounded-full bg-zinc-950 dark:bg-zinc-100"
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
