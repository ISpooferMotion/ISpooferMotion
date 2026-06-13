import { create } from 'zustand';

import { isTauriRuntime } from '../utils/tauriRuntime';

export interface AppConfig {
  general: {
    desktopNotifications: boolean;
    hideToTrayOnClose: boolean;
  };
  advanced: {
    autoCookieStudio: boolean;
    autoCookieBrowser: boolean;
    skipOwned: boolean;
    enablePluginSpoofing: boolean;
    memoryInjectionEnabled: boolean;
    clipboardMonitoring: boolean;
    pluginPort: string;
    forcePlaceIds: string;
    placeIdSearchLimit: string;
    assetScanTimeout: string;
    excludedUserIds: string;
    excludedGroupIds: string;
    concurrentSpoofing: boolean;
    maxConcurrency: number;
    enableArchiveRecovery: boolean;
    proxyUrl: string;
  };
  debug: {
    debugMode: boolean;
    enableCache: boolean;
    enableExperimentalTab: boolean;
  };
  spoofing: {
    selectedUser: string;
    selectedGroup: string;
    animation: boolean;
    audio: boolean;
    images: boolean;
    meshes: boolean;
    scriptRefs: boolean;
    cookie: string;
    apiKey: string;
    enableSpoofing: boolean;
    uploadTypes: string[];
    downloadPath: string;
    extraAssetIds: string;
    preserveMetadata: boolean;
  };
  ui: {
    activeTab: string;
    assetExplorerOpen: boolean;
    homeUpdateSections: string[];
    settingsSections: string[];
    configSections: string[];
    spoofingSections: string[];
    autoScrollSections: boolean;
    quickSettings: string[];
  };
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  general: {
    desktopNotifications: true,
    hideToTrayOnClose: false,
  },
  advanced: {
    autoCookieStudio: true,
    autoCookieBrowser: false,
    skipOwned: false,
    enablePluginSpoofing: false,
    memoryInjectionEnabled: false,
    clipboardMonitoring: false,
    pluginPort: '14285',
    forcePlaceIds: '',
    placeIdSearchLimit: '20',
    assetScanTimeout: '20',
    excludedUserIds: '',
    excludedGroupIds: '',
    concurrentSpoofing: true,
    maxConcurrency: 100,
    enableArchiveRecovery: false,
    proxyUrl: '',
  },
  debug: {
    debugMode: false,
    enableCache: true,
    enableExperimentalTab: false,
  },
  spoofing: {
    selectedUser: 'none',
    selectedGroup: 'none',
    animation: true,
    audio: true,
    images: true,
    meshes: true,
    scriptRefs: true,
    cookie: '',
    apiKey: '',
    enableSpoofing: false,
    uploadTypes: ['animation', 'audio', 'image', 'mesh', 'script_ref'],
    downloadPath: '',
    extraAssetIds: '',
    preserveMetadata: true,
  },
  ui: {
    activeTab: 'home',
    assetExplorerOpen: false,
    homeUpdateSections: ['changelog'],
    settingsSections: ['general', 'debug'],
    configSections: ['credentials', 'assetProcessing', 'routing', 'exclusions'],
    spoofingSections: ['targets', 'execution'],
    autoScrollSections: false,
    quickSettings: ['general.desktopNotifications', 'advanced.skipOwned'],
  },
};

const mergeKnownKeys = <T extends Record<string, unknown>>(
  defaults: T,
  saved: Partial<T> | undefined,
): T => {
  const next = { ...defaults };
  Object.keys(defaults).forEach((key) => {
    if (saved && Object.prototype.hasOwnProperty.call(saved, key)) {
      next[key as keyof T] = saved[key as keyof T] as T[keyof T];
    }
  });
  return next;
};

const mergeSections = (savedSections: unknown, defaultSections: string[]) => {
  if (!Array.isArray(savedSections)) return defaultSections;
  const next = savedSections.filter((section: string) => defaultSections.includes(section));
  return next.length > 0 ? next : defaultSections;
};

interface ConfigState {
  config: AppConfig;
  updateConfig: <C extends keyof AppConfig, K extends keyof AppConfig[C]>(
    c: C,
    k: K,
    v: AppConfig[C][K],
  ) => void;
  updateCategory: <C extends keyof AppConfig>(c: C, vals: Partial<AppConfig[C]>) => void;
  resetConfig: () => void;
  loadSecrets: () => Promise<void>;
  saveSecrets: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set, get) => {
  const saved = localStorage.getItem('ISpooferMotion_Config');
  let initConfig = DEFAULT_APP_CONFIG;
  if (saved) {
    try {
      const p = JSON.parse(saved);
      initConfig = {
        general: mergeKnownKeys(DEFAULT_APP_CONFIG.general, p.general),
        advanced: mergeKnownKeys(DEFAULT_APP_CONFIG.advanced, p.advanced),
        debug: mergeKnownKeys(DEFAULT_APP_CONFIG.debug, p.debug),
        spoofing: mergeKnownKeys(DEFAULT_APP_CONFIG.spoofing, p.spoofing),
        ui: {
          ...mergeKnownKeys(DEFAULT_APP_CONFIG.ui, p.ui),
          settingsSections: mergeSections(
            p.ui?.settingsSections,
            DEFAULT_APP_CONFIG.ui.settingsSections,
          ),
          configSections: mergeSections(p.ui?.configSections, DEFAULT_APP_CONFIG.ui.configSections),
          spoofingSections: mergeSections(
            p.ui?.spoofingSections,
            DEFAULT_APP_CONFIG.ui.spoofingSections,
          ),
        },
      };
      initConfig.spoofing.cookie = '';
      initConfig.spoofing.apiKey = '';
    } catch (e) {}
  }

  const saveToStorage = (c: AppConfig) => {
    localStorage.setItem(
      'ISpooferMotion_Config',
      JSON.stringify({
        ...c,
        spoofing: { ...c.spoofing, cookie: '', apiKey: '' },
      }),
    );
  };

  return {
    config: initConfig,
    updateConfig: (cat, key, val) =>
      set((state) => {
        const n = { ...state.config, [cat]: { ...state.config[cat], [key]: val } };
        saveToStorage(n);
        return { config: n };
      }),
    updateCategory: (cat, vals) =>
      set((state) => {
        const n = { ...state.config, [cat]: { ...state.config[cat], ...vals } };
        saveToStorage(n);
        return { config: n };
      }),
    resetConfig: () =>
      set(() => {
        saveToStorage(DEFAULT_APP_CONFIG);
        return { config: DEFAULT_APP_CONFIG };
      }),
    loadSecrets: async () => {
      if (!isTauriRuntime()) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const s: any = await invoke('load_profile_secrets');
        if (s && (s.cookie || s.apiKey)) {
          set((state) => {
            const selectedUser = state.config.spoofing.selectedUser;
            const profileCookie =
              selectedUser !== 'none' && typeof s.profileCookies?.[selectedUser] === 'string'
                ? s.profileCookies[selectedUser]
                : '';
            return {
              config: {
                ...state.config,
                spoofing: {
                  ...state.config.spoofing,
                  cookie:
                    profileCookie ||
                    (typeof s.cookie === 'string' ? s.cookie : state.config.spoofing.cookie),
                  apiKey: typeof s.apiKey === 'string' ? s.apiKey : state.config.spoofing.apiKey,
                },
              },
            };
          });
        }
      } catch (e) {}
    },
    saveSecrets: async () => {
      if (!isTauriRuntime()) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const c = get().config.spoofing;
        await invoke('save_profile_secrets', {
          cookie: c.cookie,
          apiKey: c.apiKey,
          selectedUser: c.selectedUser,
        });
      } catch (e) {}
    },
  };
});
