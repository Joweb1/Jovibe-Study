import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AppRoute } from '../types/models';

const STATIC_ROUTES: AppRoute[] = [
  '/library',
  '/tutor',
  '/practice',
  '/automatic-study',
  '/live',
  '/history',
  '/courses',
  '/settings',
  '/manage-course',
  '/streak',
  '/dashboard',
  '/admin',
];

export const PENDING_JOIN_TOKEN_KEY = 'sotal_pending_join_token';

export interface RouteParams {
  shareToken?: string;
  courseId?: string;
  sourceId?: string;
}

interface ParsedLocation {
  route: AppRoute;
  params: RouteParams;
  canonicalPath: string;
}

function parseLocation(pathname: string): ParsedLocation {
  const cleaned = pathname.replace(/\/+$/, '') || '/courses';

  const joinMatch = cleaned.match(/^\/join\/([a-zA-Z0-9_-]+)$/);
  if (joinMatch && joinMatch[1]) {
    return {
      route: '/join',
      params: { shareToken: joinMatch[1] },
      canonicalPath: `/join/${joinMatch[1]}`,
    };
  }

  const manageMatch = cleaned.match(/^\/manage-course\/([a-zA-Z0-9_-]+)$/);
  if (manageMatch && manageMatch[1]) {
    return {
      route: '/manage-course',
      params: { courseId: manageMatch[1] },
      canonicalPath: `/manage-course/${manageMatch[1]}`,
    };
  }

  const liveMatch = cleaned.match(/^\/live\/([a-zA-Z0-9_-]+)$/);
  if (liveMatch && liveMatch[1]) {
    return {
      route: '/live',
      params: { sourceId: liveMatch[1] },
      canonicalPath: `/live/${liveMatch[1]}`,
    };
  }

  if (STATIC_ROUTES.includes(cleaned as AppRoute)) {
    return {
      route: cleaned as AppRoute,
      params: {},
      canonicalPath: cleaned,
    };
  }

  return {
    route: '/courses',
    params: {},
    canonicalPath: '/courses',
  };
}

interface RouterContextValue {
  route: AppRoute;
  routeParams: RouteParams;
  navigate: (nextPath: AppRoute | string) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locationState, setLocationState] = useState<ParsedLocation>(() => {
    if (typeof window === 'undefined') {
      return { route: '/courses', params: {}, canonicalPath: '/courses' };
    }
    const parsed = parseLocation(window.location.pathname);
    if (parsed.route === '/join') {
      return parsed;
    }
    // Restore any pending invite token saved prior to authentication
    try {
      const pendingToken = window.sessionStorage.getItem(PENDING_JOIN_TOKEN_KEY);
      if (pendingToken && /^[a-zA-Z0-9_-]+$/.test(pendingToken)) {
        window.sessionStorage.removeItem(PENDING_JOIN_TOKEN_KEY);
        return {
          route: '/join',
          params: { shareToken: pendingToken },
          canonicalPath: `/join/${pendingToken}`,
        };
      }
    } catch {
      // Ignore storage errors
    }
    return parsed;
  });

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      (window.location.pathname === '/' || window.location.pathname !== locationState.canonicalPath)
    ) {
      window.history.replaceState({}, '', locationState.canonicalPath);
    }

    const handlePopState = () => {
      setLocationState(parseLocation(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [locationState.canonicalPath]);

  const navigate = useCallback((nextPath: AppRoute | string) => {
    const parsed = parseLocation(nextPath);
    setLocationState(parsed);
    if (typeof window !== 'undefined' && window.location.pathname !== parsed.canonicalPath) {
      window.history.pushState({}, '', parsed.canonicalPath);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  return (
    <RouterContext.Provider
      value={{
        route: locationState.route,
        routeParams: locationState.params,
        navigate,
      }}
    >
      {children}
    </RouterContext.Provider>
  );
};

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter must be used within RouterProvider');
  }
  return ctx;
}
