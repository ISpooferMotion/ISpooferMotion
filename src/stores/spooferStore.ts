import { create } from 'zustand';

import type { SpooferAssetResult } from '../types/tauriEvents';
import type { RbxInstance } from '../utils/robloxPlaceParser';

interface SpooferState {
  rootInstances: RbxInstance[];
  setRootInstances: (instances: RbxInstance[]) => void;

  loadedFileName: string | null;
  setLoadedFileName: (name: string | null) => void;

  parsingFileName: string | null;
  setParsingFileName: (name: string | null) => void;

  selectedAssetIds: Set<string>;
  setSelectedAssetIds: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;

  spoofingLogs: string;
  setSpoofingLogs: (val: string | ((prev: string) => string)) => void;

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

export const useSpooferStore = create<SpooferState>((set) => ({
  rootInstances: [],
  setRootInstances: (instances) => set({ rootInstances: instances }),

  loadedFileName: null,
  setLoadedFileName: (name) => set({ loadedFileName: name }),

  parsingFileName: null,
  setParsingFileName: (name) => set({ parsingFileName: name }),

  selectedAssetIds: new Set<string>(),
  setSelectedAssetIds: (val) =>
    set((state) => ({
      selectedAssetIds: typeof val === 'function' ? val(state.selectedAssetIds) : val,
    })),

  spoofingLogs: '',
  setSpoofingLogs: (val) =>
    set((state) => ({
      spoofingLogs: typeof val === 'function' ? val(state.spoofingLogs) : val,
    })),

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
    set((state) => ({ spoofCompletionVersion: state.spoofCompletionVersion + 1 })),

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
