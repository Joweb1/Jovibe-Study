import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CourseProvider, useCourses } from './context/CourseContext';
import { WorkspaceUiProvider } from './context/WorkspaceUiContext';
import { RouterProvider, useRouter } from './router/RouterContext';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/ui/StateViews';
import { AuthPage } from './pages/AuthPage';
import { AutomaticStudyPage } from './pages/AutomaticStudyPage';
import { CoursesPage } from './pages/CoursesPage';
import { HistoryPage } from './pages/HistoryPage';
import { LibraryPage } from './pages/LibraryPage';
import { PracticePage } from './pages/PracticePage';
import { SettingsPage } from './pages/SettingsPage';
import { TutorPage } from './pages/TutorPage';

const WorkspaceRouter: React.FC = () => {
  const { route, navigate } = useRouter();
  const { courses, coursesLoading } = useCourses();

  // When a signed-in user has no courses yet (e.g., fresh signup), keep Courses as the default landing page
  useEffect(() => {
    if (!coursesLoading && courses.length === 0 && route !== '/courses' && route !== '/settings') {
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
      case '/history':
        return <HistoryPage />;
      case '/settings':
        return <SettingsPage />;
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

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6">
        <div className="flex flex-col items-center gap-3">
          <div
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent"
          />
          <p className="text-sm text-zinc-600">Loading SOTAL Study...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <CourseProvider>
      <RouterProvider>
        <WorkspaceUiProvider>
          <AppShell>
            <WorkspaceRouter />
          </AppShell>
        </WorkspaceUiProvider>
      </RouterProvider>
    </CourseProvider>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </ErrorBoundary>
  );
}
