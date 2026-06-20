import { create } from 'zustand';

import type { SpooferAssetResult } from '../types/tauriEvents';
import { notifyError } from '../utils/notifyError';
import type { RbxInstance } from '../utils/robloxPlaceParser';
import { appendSpoofingLog } from '../utils/spoofingLogs';
import { queueStudioReplacements } from '../utils/studioBridge';
import { isTauriRuntime } from '../utils/tauriRuntime';
import { useConfigStore } from './configStore';

interface SpooferState {
  rootInstances: RbxInstance[];
  setRootInstances: (val: RbxInstance[] | ((prev: RbxInstance[]) => RbxInstance[])) => void;

  loadedFileName: string | null;
  setLoadedFileName: (val: string | null | ((prev: string | null) => string | null)) => void;

  parsingFileName: string | null;
  setParsingFileName: (name: string | null) => void;

  selectedAssetIds: Set<string>;
  setSelectedAssetIds: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;

  spoofingLogs: string[];
  setSpoofingLogs: (val: string[] | ((prev: string[]) => string[])) => void;

  isSpoofing: boolean;
  setIsSpoofing: (val: boolean) => void;

  spoofProgress: number;
  setSpoofProgress: (val: number) => void;

  lastReplacements: Record<string, string>;
  setLastReplacements: (
    val: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;

  isReplacing: boolean;
  setIsReplacing: (val: boolean) => void;

  replaceError: boolean;
  setReplaceError: (val: boolean) => void;

  spoofCompletionVersion: number;
  incrementSpoofCompletionVersion: () => void;

  activeSpooferJobId: string | null;
  setActiveSpooferJobId: (id: string | null) => void;

  lastAssetResults: SpooferAssetResult[];
  setLastAssetResults: (results: SpooferAssetResult[]) => void;

  keyframeWarningCount: number;
  setKeyframeWarningCount: (val: number | ((prev: number) => number)) => void;
}

// holds all the active ephemeral state for the spoofing jobs, asset explorer, and studio integration
export const useSpooferStore = create<SpooferState>((set) => ({
  rootInstances: [],
  setRootInstances: (val) =>
    set((state) => ({
      rootInstances: typeof val === 'function' ? val(state.rootInstances) : val,
    })),

  loadedFileName: null,
  setLoadedFileName: (val) =>
    set((state) => ({
      loadedFileName: typeof val === 'function' ? val(state.loadedFileName) : val,
    })),

  parsingFileName: null,
  setParsingFileName: (name) => set({ parsingFileName: name }),

  selectedAssetIds: new Set<string>(),
  setSelectedAssetIds: (val) =>
    set((state) => ({
      selectedAssetIds: typeof val === 'function' ? val(state.selectedAssetIds) : val,
    })),

  spoofingLogs: [],
  setSpoofingLogs: (val) =>
    set((state) => {
      const nextVal = typeof val === 'function' ? val(state.spoofingLogs) : val;
      if (nextVal.length > 500) {
        return { spoofingLogs: nextVal.slice(nextVal.length - 500) };
      }
      return { spoofingLogs: nextVal };
    }),

  isSpoofing: false,
  setIsSpoofing: (val) => set({ isSpoofing: val }),

  spoofProgress: 0,
  setSpoofProgress: (val) => set({ spoofProgress: val }),

  lastReplacements: {},
  setLastReplacements: (val) =>
    set((state) => ({
      lastReplacements: typeof val === 'function' ? val(state.lastReplacements) : val,
    })),

  isReplacing: false,
  setIsReplacing: (val) => set({ isReplacing: val }),

  replaceError: false,
  setReplaceError: (val) => set({ replaceError: val }),

  spoofCompletionVersion: 0,
  incrementSpoofCompletionVersion: () =>
    set((state) => ({
      spoofCompletionVersion: state.spoofCompletionVersion + 1,
    })),

  activeSpooferJobId: null,
  setActiveSpooferJobId: (id) => set({ activeSpooferJobId: id }),

  lastAssetResults: [],
  setLastAssetResults: (results) => set({ lastAssetResults: results }),

  keyframeWarningCount: 0,
  setKeyframeWarningCount: (val) =>
    set((state) => ({
      keyframeWarningCount: typeof val === 'function' ? val(state.keyframeWarningCount) : val,
    })),
}));

export const applyReplacements = async (replacements: Record<string, string>) => {
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

      const results = await invoke<Record<string, { total_replaced: number }>>(
        'scan_and_replace_multiple_strings',
        {
          pid,
          replacements,
        },
      );

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
        appendSpoofingLog(prev, 'Queued replacements to plugin bridge. Run the plugin in Studio!'),
      );
    }
    setLastReplacements(replacements);
  } catch (e: unknown) {
    setReplaceError(true);
    notifyError('Replacement Error', String(e));
    setSpoofingLogs((prev) =>
      appendSpoofingLog(prev, `[ERROR] Failed to apply replacements: ${e}`),
    );
  } finally {
    setIsReplacing(false);
  }
};
