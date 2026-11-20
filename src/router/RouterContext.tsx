import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AppRoute } from '../types/models';

const VALID_ROUTES: AppRoute[] = [
  '/library',
  '/tutor',
  '/practice',
  '/automatic-study',
  '/history',
  '/courses',
  '/settings',
];

function normalizeRoute(pathname: string): AppRoute {
  const cleaned = pathname.replace(/\/+$/, '') || '/courses';
  if (VALID_ROUTES.includes(cleaned as AppRoute)) {
    return cleaned as AppRoute;
  }
  return '/courses';
}

interface RouterContextValue {
  route: AppRoute;
  navigate: (nextRoute: AppRoute) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window !== 'undefined' ? normalizeRoute(window.location.pathname) : '/courses'
  );

  useEffect(() => {
    const currentNormalized = normalizeRoute(window.location.pathname);
    if (window.location.pathname === '/' || window.location.pathname !== currentNormalized) {
      window.history.replaceState({}, '', currentNormalized);
      setRoute(currentNormalized);
    }

    const handlePopState = () => {
      setRoute(normalizeRoute(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute) => {
    setRoute(nextRoute);
    if (typeof window !== 'undefined' && window.location.pathname !== nextRoute) {
      window.history.pushState({}, '', nextRoute);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  return <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>;
};

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter must be used within RouterProvider');
  }
  return ctx;
}
