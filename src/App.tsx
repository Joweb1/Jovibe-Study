import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { CourseProvider, useCourses } from './context/CourseContext';
import { GeminiOnboardingProvider } from './context/GeminiOnboardingContext';
import { StreakProvider } from './context/StreakContext';
import { WorkspaceUiProvider } from './context/WorkspaceUiContext';
import { PENDING_JOIN_TOKEN_KEY, RouterProvider, useRouter } from './router/RouterContext';
import { AppShell } from './components/layout/AppShell';
import { ApiKeyLimitModal } from './components/onboarding/ApiKeyLimitModal';
import { GeminiOnboardingOverlay } from './components/onboarding/GeminiOnboardingOverlay';
import { ErrorBoundary } from './components/ui/StateViews';
import { SotalLogo } from './components/ui/SotalLogo';
import { AuthPage } from './pages/AuthPage';
import { AutomaticStudyPage } from './pages/AutomaticStudyPage';
import { CourseManagePage } from './pages/CourseManagePage';
import { CoursesPage } from './pages/CoursesPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { JoinCoursePage } from './pages/JoinCoursePage';
import { LibraryPage } from './pages/LibraryPage';
import { PracticePage } from './pages/PracticePage';
import { SettingsPage } from './pages/SettingsPage';
import { SotalLivePage } from './pages/SotalLivePage';
import { StreakPage } from './pages/StreakPage';
import { TutorPage } from './pages/TutorPage';

const WorkspaceRouter: React.FC = () => {
  const { route, navigate } = useRouter();
  const { courses, coursesLoading } = useCourses();

  // When a signed-in user has no courses yet (e.g., fresh signup), keep Courses as the default landing page,
  // unless they are visiting Settings or joining a shared course via an invite link.
  useEffect(() => {
    if (
      !coursesLoading &&
      courses.length === 0 &&
      route !== '/courses' &&
      route !== '/settings' &&
      route !== '/join' &&
      route !== '/live' &&
      route !== '/streak' &&
      route !== '/dashboard'
    ) {
      navigate('/courses');
    }
  }, [coursesLoading, courses.length, route, navigate]);

  const renderPage = () => {
    switch (route) {
      case '/courses':
        return <CoursesPage />;
      case '/library':
        return <LibraryPage />;
      case '/tutor':
        return <TutorPage />;
      case '/practice':
        return <PracticePage />;
      case '/automatic-study':
        return <AutomaticStudyPage />;
      case '/live':
        return <SotalLivePage />;
      case '/history':
        return <HistoryPage />;
      case '/settings':
        return <SettingsPage />;
      case '/manage-course':
        return <CourseManagePage />;
      case '/join':
        return <JoinCoursePage />;
      case '/streak':
        return <StreakPage />;
      case '/dashboard':
        return <DashboardPage />;
      default:
        return <CoursesPage />;
    }
  };

  return (
    <motion.div
      key={route}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-1 min-h-0 flex-col"
    >
      {renderPage()}
    </motion.div>
  );
};

const AuthenticatedApp: React.FC = () => {
  const { user, authReady } = useAuth();

  // Preserve shared course invite token across sign-in so unauthenticated visitors land on /join/:token immediately
  useEffect(() => {
    if (user || typeof window === 'undefined') return;
    const cleaned = window.location.pathname.replace(/\/+$/, '');
    const match = cleaned.match(/^\/join\/([a-zA-Z0-9_-]+)$/);
    if (match && match[1]) {
      try {
        window.sessionStorage.setItem(PENDING_JOIN_TOKEN_KEY, match[1]);
      } catch {
        // Ignore storage errors
      }
    }
  }, [user]);

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-zinc-950 px-6">
        <div className="flex flex-col items-center gap-3.5">
          <SotalLogo size="lg" />
          <div className="flex items-center gap-2">
            <div
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 dark:border-zinc-200 border-t-transparent"
            />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading SOTAL Study...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <CourseProvider>
      <StreakProvider>
        <RouterProvider>
          <GeminiOnboardingProvider>
            <WorkspaceUiProvider>
              <AppShell>
                <WorkspaceRouter />
              </AppShell>
              <GeminiOnboardingOverlay />
              <ApiKeyLimitModal />
            </WorkspaceUiProvider>
          </GeminiOnboardingProvider>
        </RouterProvider>
      </StreakProvider>
    </CourseProvider>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AuthProvider>
          <AuthenticatedApp />
        </AuthProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
