import React, { createContext, useContext, useMemo, useState } from 'react';

interface WorkspaceUiContextValue {
  hideHeader: boolean;
  setHideHeader: (hidden: boolean) => void;
  hideBottomNav: boolean;
  setHideBottomNav: (hidden: boolean) => void;
  lockViewport: boolean;
  setLockViewport: (locked: boolean) => void;
}

const WorkspaceUiContext = createContext<WorkspaceUiContextValue | null>(null);

export const WorkspaceUiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hideHeader, setHideHeader] = useState(false);
  const [hideBottomNav, setHideBottomNav] = useState(false);
  const [lockViewport, setLockViewport] = useState(false);

  const value = useMemo(
    () => ({
      hideHeader,
      setHideHeader,
      hideBottomNav,
      setHideBottomNav,
      lockViewport,
      setLockViewport,
    }),
    [hideHeader, hideBottomNav, lockViewport]
  );

  return (
    <WorkspaceUiContext.Provider value={value}>
      {children}
    </WorkspaceUiContext.Provider>
  );
};

export function useWorkspaceUi(): WorkspaceUiContextValue {
  const ctx = useContext(WorkspaceUiContext);
  if (!ctx) {
    throw new Error('useWorkspaceUi must be used within WorkspaceUiProvider');
  }
  return ctx;
}
