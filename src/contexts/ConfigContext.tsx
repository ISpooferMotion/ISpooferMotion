import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';

import { type AppConfig, useConfigStore } from '../stores/configStore';
import { useSpooferStore } from '../stores/spooferStore';
import type {
  SpooferAssetResult,
  SpooferLogPayload,
  SpooferProgressPayload,
  SpooferResultPayload,
  SpooferStartedPayload,
} from '../types/tauriEvents';
import { notifyError } from '../utils/notifyError';
import type { RbxInstance } from '../utils/robloxPlaceParser';
import { appendSpoofingLog } from '../utils/spoofingLogs';
import { queueStudioReplacements } from '../utils/studioBridge';
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

  rootInstances: RbxInstance[];
  setRootInstances: React.Dispatch<React.SetStateAction<RbxInstance[]>>;
  loadedFileName: string | null;
  setLoadedFileName: React.Dispatch<React.SetStateAction<string | null>>;
  parsingFileName: string | null;
  setParsingFileName: React.Dispatch<React.SetStateAction<string | null>>;
  selectedAssetIds: Set<string>;
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  applyReplacements: (replacements: Record<string, string>) => void;
  spoofingLogs: string;
  setSpoofingLogs: React.Dispatch<React.SetStateAction<string>>;
  isSpoofing: boolean;
  setIsSpoofing: React.Dispatch<React.SetStateAction<boolean>>;
  spoofProgress: number;
  setSpoofProgress: React.Dispatch<React.SetStateAction<number>>;
  lastReplacements: Record<string, string>;
  setLastReplacements: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  isReplacing: boolean;
  setIsReplacing: React.Dispatch<React.SetStateAction<boolean>>;
  replaceError: boolean;
  setReplaceError: React.Dispatch<React.SetStateAction<boolean>>;
  spoofCompletionVersion: number;
  activeSpooferJobId: string | null;
  lastAssetResults: SpooferAssetResult[];
  keyframeWarningCount: number;
  setKeyframeWarningCount: React.Dispatch<React.SetStateAction<number>>;
}

const Context = createContext<ConfigContextType | undefined>(undefined);

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const configState = useConfigStore();
  const spooferState = useSpooferStore();

  useEffect(() => {
    configState.loadSecrets();
  }, []);

  const applyReplacements = useCallback(async (replacements: Record<string, string>) => {
    if (!isTauriRuntime()) return;
    const { config } = useConfigStore.getState();
    const { setSpoofingLogs, setLastReplacements, setIsReplacing, setReplaceError } =
      useSpooferStore.getState();

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      setIsReplacing(true);
      setReplaceError(false);
      setSpoofingLogs((prev) => appendSpoofingLog(prev, '\nApplying replacements to Studio...'));

      if (config.advanced.memoryInjectionEnabled) {
        setSpoofingLogs((prev) => appendSpoofingLog(prev, 'Starting Memory Injection (Beta)...'));
        const pid = await invoke<number | null>('find_studio_process');
        if (!pid) {
          throw new Error('Roblox Studio is not running.');
        }

        const results = await invoke<Record<string, any>>('scan_and_replace_multiple_strings', {
          pid,
          replacements,
        });

        let total = 0;
        for (const [, res] of Object.entries(results)) {
          total += res.total_replaced;
        }

        setSpoofingLogs((prev) =>
          appendSpoofingLog(
            prev,
            `Memory injection complete! Patched ${total} exact matches in memory.`,
          ),
        );
      } else {
        await queueStudioReplacements(replacements, config.advanced.pluginPort);
        setSpoofingLogs((prev) =>
          appendSpoofingLog(
            prev,
            'Queued replacements to plugin bridge. Run the plugin in Studio!',
          ),
        );
      }
      setLastReplacements(replacements);
    } catch (e: any) {
      setReplaceError(true);
      notifyError('Replacement Error', String(e));
      setSpoofingLogs((prev) =>
        appendSpoofingLog(prev, `[ERROR] Failed to apply replacements: ${e}`),
      );
    } finally {
      setIsReplacing(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const unlisteners: Array<() => void> = [];

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
        setSpoofingLogs('');
        setSpoofProgress(0);
        setActiveSpooferJobId(e.payload.job_id ?? e.payload.jobId);
      });

      const un2 = await listen<SpooferLogPayload>('spoofer-log', (e) => {
        setSpoofingLogs((prev) => appendSpoofingLog(prev, e.payload.message ?? ''));
      });

      const un3 = await listen<SpooferProgressPayload>('spoofer-progress', (e) => {
        setSpoofProgress(e.payload.progress);
      });

      const un4 = await listen<SpooferResultPayload>('spoofer-result', (e) => {
        setIsSpoofing(false);
        setActiveSpooferJobId(null);
        setLastAssetResults(e.payload.assetResults ?? e.payload.results ?? []);
        setKeyframeWarningCount(e.payload.keyframe_warnings ?? 0);
        incrementSpoofCompletionVersion();

        if (e.payload.error) {
          setSpoofingLogs((prev) => appendSpoofingLog(prev, `\n[ERROR]: ${e.payload.error}`));
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
  }, [applyReplacements]);

  const contextValue = useMemo<ConfigContextType>(
    () => ({
      config: configState.config,
      updateConfig: configState.updateConfig,
      updateCategory: configState.updateCategory,
      resetConfig: configState.resetConfig,

      rootInstances: spooferState.rootInstances,
      setRootInstances: (val: any) =>
        spooferState.setRootInstances(
          typeof val === 'function' ? val(useSpooferStore.getState().rootInstances) : val,
        ),
      loadedFileName: spooferState.loadedFileName,
      setLoadedFileName: (val: any) =>
        spooferState.setLoadedFileName(
          typeof val === 'function' ? val(useSpooferStore.getState().loadedFileName) : val,
        ),
      parsingFileName: spooferState.parsingFileName,
      setParsingFileName: (val: any) =>
        spooferState.setParsingFileName(
          typeof val === 'function' ? val(useSpooferStore.getState().parsingFileName) : val,
        ),
      selectedAssetIds: spooferState.selectedAssetIds,
      setSelectedAssetIds: spooferState.setSelectedAssetIds,
      applyReplacements,
      spoofingLogs: spooferState.spoofingLogs,
      setSpoofingLogs: (val: any) =>
        spooferState.setSpoofingLogs(typeof val === 'function' ? val : () => val),
      isSpoofing: spooferState.isSpoofing,
      setIsSpoofing: (val: any) =>
        spooferState.setIsSpoofing(
          typeof val === 'function' ? val(useSpooferStore.getState().isSpoofing) : val,
        ),
      spoofProgress: spooferState.spoofProgress,
      setSpoofProgress: (val: any) =>
        spooferState.setSpoofProgress(
          typeof val === 'function' ? val(useSpooferStore.getState().spoofProgress) : val,
        ),
      lastReplacements: spooferState.lastReplacements,
      setLastReplacements: spooferState.setLastReplacements,
      isReplacing: spooferState.isReplacing,
      setIsReplacing: (val: any) =>
        spooferState.setIsReplacing(
          typeof val === 'function' ? val(useSpooferStore.getState().isReplacing) : val,
        ),
      replaceError: spooferState.replaceError,
      setReplaceError: (val: any) =>
        spooferState.setReplaceError(
          typeof val === 'function' ? val(useSpooferStore.getState().replaceError) : val,
        ),
      spoofCompletionVersion: spooferState.spoofCompletionVersion,
      activeSpooferJobId: spooferState.activeSpooferJobId,
      lastAssetResults: spooferState.lastAssetResults,
      keyframeWarningCount: spooferState.keyframeWarningCount,
      setKeyframeWarningCount: (val: any) =>
        spooferState.setKeyframeWarningCount(typeof val === 'function' ? val : () => val),
    }),
    [
      configState.config,
      configState.updateConfig,
      configState.updateCategory,
      configState.resetConfig,
      spooferState.rootInstances,
      spooferState.loadedFileName,
      spooferState.parsingFileName,
      spooferState.selectedAssetIds,
      spooferState.setSelectedAssetIds,
      spooferState.spoofingLogs,
      spooferState.isSpoofing,
      spooferState.spoofProgress,
      spooferState.lastReplacements,
      spooferState.setLastReplacements,
      spooferState.isReplacing,
      spooferState.replaceError,
      spooferState.spoofCompletionVersion,
      spooferState.activeSpooferJobId,
      spooferState.lastAssetResults,
      spooferState.keyframeWarningCount,
      applyReplacements,
    ],
  );

  return <Context.Provider value={contextValue}>{children}</Context.Provider>;
};

export const useConfig = () => {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
};
