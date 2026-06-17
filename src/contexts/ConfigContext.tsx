import React, { createContext, useContext, useEffect, useMemo } from 'react';

import { type AppConfig, useConfigStore } from '../stores/configStore';
import { applyReplacements, useSpooferStore } from '../stores/spooferStore';
import type {
  SpooferLogPayload,
  SpooferProgressPayload,
  SpooferResultPayload,
  SpooferStartedPayload,
} from '../types/tauriEvents';
import { appendSpoofingLog } from '../utils/spoofingLogs';
import { isTauriRuntime } from '../utils/tauriRuntime';

export type { AppConfig };

interface ConfigContextType {
  config: AppConfig;
  updateConfig: <C extends keyof AppConfig, K extends keyof AppConfig[C]>(
    c: C,
    k: K,
    v: AppConfig[C][K],
  ) => void;
  updateCategory: <C extends keyof AppConfig>(c: C, vals: Partial<AppConfig[C]>) => void;
  resetConfig: () => void;
}

const Context = createContext<ConfigContextType | undefined>(undefined);

// Main provider that houses all our app configuration and spoofing state
export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const configState = useConfigStore();

  useEffect(() => {
    configState.loadSecrets();
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const unlisteners: Array<() => void> = [];

    // Hook up all the Tauri event listeners so we can react to backend spoofing updates in real-time
    const setup = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const {
        setIsSpoofing,
        setSpoofingLogs,
        setActiveSpooferJobId,
        setSpoofProgress,
        setLastAssetResults,
        setKeyframeWarningCount,
        incrementSpoofCompletionVersion,
      } = useSpooferStore.getState();

      const un1 = await listen<SpooferStartedPayload>('spoofer-started', (e) => {
        setIsSpoofing(true);
        setSpoofingLogs([]);
        setSpoofProgress(0);
        setActiveSpooferJobId(e.payload.job_id ?? e.payload.jobId);
      });

      const un2 = await listen<SpooferLogPayload>('spoofer-log', (e) => {
        let msg = e.payload.message ?? '';
        const rawLevel = (e.payload.level || 'info').toUpperCase();
        
        // If the message doesn't already have a level prefix like [INFO], [SUCCESS], etc.
        // we'll inject it so the SpoofingView can colorize it properly.
        if (!msg.startsWith('[')) {
          msg = `[${rawLevel}] ${msg}`;
        }
        
        setSpoofingLogs((prev) => appendSpoofingLog(prev, msg));
      });

      const un3 = await listen<SpooferProgressPayload>('spoofer-progress', (e) => {
        if (e.payload.progress !== undefined) {
          setSpoofProgress(e.payload.progress);
        } else if (e.payload.current !== undefined && e.payload.total !== undefined && e.payload.total > 0) {
          setSpoofProgress((e.payload.current / e.payload.total) * 100);
        }
      });

      const un4 = await listen<SpooferResultPayload>('spoofer-result', (e) => {
        setIsSpoofing(false);
        setActiveSpooferJobId(null);
        setLastAssetResults(e.payload.assetResults ?? e.payload.results ?? []);
        setKeyframeWarningCount(e.payload.keyframe_warnings ?? 0);
        incrementSpoofCompletionVersion();

        if (e.payload.error) {
          setSpoofingLogs((prev) => appendSpoofingLog(prev, `[ERROR]: ${e.payload.error}`));
        } else if (e.payload.replacements) {
          applyReplacements(e.payload.replacements);
        }
      });

      unlisteners.push(un1, un2, un3, un4);
    };

    setup();
    return () => {
      unlisteners.forEach((u) => u());
    };
  }, []);

  // Memoize the context value so we don't nuke performance with massive re-renders
  const contextValue = useMemo<ConfigContextType>(
    () => ({
      config: configState.config,
      updateConfig: configState.updateConfig,
      updateCategory: configState.updateCategory,
      resetConfig: configState.resetConfig,
    }),
    [
      configState.config,
      configState.updateConfig,
      configState.updateCategory,
      configState.resetConfig,
    ],
  );

  return <Context.Provider value={contextValue}>{children}</Context.Provider>;
};

export const useConfig = () => {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
};
