import React, { createContext, useCallback, useContext } from 'react';

import { type ScanStatus, useStudioConnection } from '../hooks/useStudioConnection';
import { useConfig } from './ConfigContext';

type StudioConnectionContextValue = {
  studioConnected: boolean;
  scanStatus: ScanStatus | null;
  studioPlaceId: string;
};

const StudioConnectionContext = createContext<StudioConnectionContextValue | undefined>(undefined);

export const StudioConnectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { config, updateConfig } = useConfig();

  const onPortDiscovered = useCallback(
    (port: string) => {
      if (port !== config.advanced.pluginPort) {
        updateConfig('advanced', 'pluginPort', port);
      }
    },
    [config.advanced.pluginPort, updateConfig],
  );

  const connection = useStudioConnection(config.advanced.pluginPort, onPortDiscovered);

  return (
    <StudioConnectionContext.Provider value={connection}>
      {children}
    </StudioConnectionContext.Provider>
  );
};

export const useStudioConnectionState = () => {
  const context = useContext(StudioConnectionContext);
  if (context === undefined) {
    throw new Error('useStudioConnectionState must be used within a StudioConnectionProvider');
  }
  return context;
};
