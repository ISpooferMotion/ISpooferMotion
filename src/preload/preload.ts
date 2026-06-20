import { contextBridge, ipcRenderer } from 'electron';

const SEND_CHANNELS = new Set([
  'window-minimize',
  'window-close',
  'open-external',
  'run-spoofer-action',
  'spoofer-pause',
  'spoofer-resume',
  'spoofer-cancel',
  'clear-session',
]);

const INVOKE_CHANNELS = new Set([
  'get-app-version',
  'load-profile-secrets',
  'save-profile-secrets',
  'get-roblox-profile',
  'validate-opencloud-api-key',
  'detect-opencloud-api-key-owner',
  'search-place-ids',
  'fetch-audio-quota',
  'select-folder',
  'check-session',
  'open-data-folder',
  'open-logs-folder',
  'clear-app-cache',
  'uninstall-app',
  'get-jobs',
  'delete-job',
  'push-to-studio',
  'open-dev-console',
]);

const SUBSCRIBE_CHANNELS = new Set([
  'update-status-message',
  'spoofer-result',
  'transfer-update',
  'spoofer-log',
  'spoofer-progress',
  'localhost-scan-results',
]);

function isRecord(value: any): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: any): Record<string, any> {
  return isRecord(value) ? value : {};
}

function sanitizeExternalUrl(value: string | unknown): string | null {
  if (typeof value !== 'string') return null;

  const rawUrl = value.trim();
  if (!rawUrl || rawUrl.length > 2048) return null;

  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function send(channel: string, ...args: any[]) {
  if (!SEND_CHANNELS.has(channel)) {
    throw new Error(`Blocked IPC send channel: ${channel}`);
  }
  ipcRenderer.send(channel, ...args);
}

function invoke(channel: string, ...args: any[]): Promise<any> {
  if (!INVOKE_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`Blocked IPC invoke channel: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel: string, callback: (payload: any) => void) {
  if (!SUBSCRIBE_CHANNELS.has(channel) || typeof callback !== 'function') return () => {};

  const listener = (_event: any, payload: any) => callback(payload);
  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

export const electronAPI = {
  minimize: () => send('window-minimize'),
  close: () => send('window-close'),

  onStatusUpdate: (callback: (msg: string) => void) => subscribe('update-status-message', callback),
  onSpooferResult: (callback: (res: any) => void) => subscribe('spoofer-result', callback),
  onTransferUpdate: (callback: (update: any) => void) => subscribe('transfer-update', callback),
  onSpooferLog: (callback: (log: any) => void) => subscribe('spoofer-log', callback),
  onSpooferProgress: (callback: (prog: any) => void) => subscribe('spoofer-progress', callback),
  onLocalhostScanResults: (callback: (res: any) => void) => subscribe('localhost-scan-results', callback),

  getAppVersion: () => invoke('get-app-version'),

  openExternal: (url: string) => {
    const safeUrl = sanitizeExternalUrl(url);
    if (!safeUrl) return false;
    send('open-external', safeUrl);
    return true;
  },

  loadProfileSecrets: () => invoke('load-profile-secrets'),
  saveProfileSecrets: (data: any) => invoke('save-profile-secrets', asRecord(data)),
  getRobloxProfile: (context: any) => invoke('get-roblox-profile', asRecord(context)),
  validateOpenCloudApiKey: (apiKey: string) => invoke('validate-opencloud-api-key', String(apiKey || '')),
  detectOpenCloudApiKeyOwner: (apiKey: string) =>
    invoke('detect-opencloud-api-key-owner', String(apiKey || '')),
  searchPlaceIds: (context: any) => invoke('search-place-ids', asRecord(context)),

  runSpooferAction: (data: any) => send('run-spoofer-action', asRecord(data)),
  pauseSpoofer: () => send('spoofer-pause'),
  resumeSpoofer: () => send('spoofer-resume'),
  cancelSpoofer: () => send('spoofer-cancel'),
  resumeSession: (data: any) => send('run-spoofer-action', { ...asRecord(data), resumeSession: true }),

  getAudioQuota: (context: any) => invoke('fetch-audio-quota', asRecord(context)),
  selectFolder: () => invoke('select-folder'),
  openLogsFolder: () => invoke('open-logs-folder'),
  openDataFolder: () => invoke('open-data-folder'),
  clearAppCache: () => invoke('clear-app-cache'),
  uninstallApp: () => invoke('uninstall-app'),
  openDevConsole: () => invoke('open-dev-console'),

  checkSession: () => invoke('check-session'),
  getJobs: () => invoke('get-jobs'),
  deleteJob: (jobId: string) => invoke('delete-job', jobId),
  pushToStudio: (text: string) => invoke('push-to-studio', String(text || '')),
  clearSession: () => send('clear-session'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
