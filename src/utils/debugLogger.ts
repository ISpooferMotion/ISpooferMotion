import { invoke } from '@tauri-apps/api/core';

import { isTauriRuntime } from './tauriRuntime';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';
export type LogSource = 'console' | 'ism';

export interface LogEntry {
  id: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  payload?: unknown[];
  timestamp: string;
}

// Lazy loaded so we don't cause circular dependencies on boot
let cachedConfigStore: typeof import('../stores/configStore') | null = null;

const MAX_LOGS = 1000;

type Listener = (logs: LogEntry[]) => void;

interface DebugLoggerState {
  logs: LogEntry[];
  counter: number;
  listeners: Set<Listener>;
  patched: boolean;
  originals?: {
    log: typeof console.log;
    info: typeof console.info;
    debug: typeof console.debug;
    warn: typeof console.warn;
    error: typeof console.error;
    success: (...args: unknown[]) => void;
  };
}

declare global {
  interface Window {
    ismLog: (level: LogLevel, message: string, notify?: boolean) => void;
    __ismDebugLogger?: DebugLoggerState;
  }
}

// grab or initialize the global logger state so we don't lose logs across hot reloads
function getState(): DebugLoggerState {
  if (!window.__ismDebugLogger) {
    window.__ismDebugLogger = {
      logs: [],
      counter: 0,
      listeners: new Set(),
      patched: false,
    };
  }
  return window.__ismDebugLogger;
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === 'string') {
    return arg;
  }
  try {
    return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
  } catch {
    return String(arg);
  }
}

// pipe the log to our internal state, the console, and optionally the rust backend
export function addDebugLog(
  level: LogLevel,
  args: unknown[],
  source: LogSource = 'console',
  notify: boolean = false,
) {
  const state = getState();
  const messageArgs = args.filter((arg) => typeof arg === 'string' || arg instanceof Error);
  const payloadArgs = args.filter((arg) => typeof arg !== 'string' && !(arg instanceof Error));

  const entry: LogEntry = {
    id: state.counter++,
    level,
    source,
    message: messageArgs.length > 0 ? messageArgs.map(formatArg).join(' ') : '',
    payload: payloadArgs.length > 0 ? payloadArgs : undefined,
    timestamp: new Date().toLocaleTimeString([], { hour12: false }),
  };

  // If there's no string message but there is a payload, set a default message
  if (!entry.message && entry.payload) {
    entry.message = 'Object logged';
  }

  state.logs = [...state.logs, entry].slice(-MAX_LOGS);
  state.listeners.forEach((listener) => listener(state.logs));

  if (isTauriRuntime()) {
    try {
      invoke('append_debug_log', {
        level: entry.level,
        source: entry.source,
        message: entry.message,
      }).catch(() => {});
    } catch (e) {}
  }

  if (notify && (level === 'success' || level === 'error') && isTauriRuntime()) {
    try {
      if (!cachedConfigStore) {
        import('../stores/configStore').then((mod) => {
          cachedConfigStore = mod;
        });
      }

      if (cachedConfigStore) {
        const config = cachedConfigStore.useConfigStore.getState().config;
        if (config?.general?.desktopNotifications) {
          invoke('show_notification', {
            options: {
              title: level === 'success' ? 'ISpooferMotion - Success' : 'ISpooferMotion - Error',
              body: entry.message,
            },
          }).catch(() => {});
        }
      }
    } catch (e) {}
  }
}

export function subscribeDebugLogs(listener: Listener) {
  const state = getState();
  state.listeners.add(listener);
  listener(state.logs);
  return () => {
    state.listeners.delete(listener);
  };
}

export function getDebugLogs() {
  return getState().logs;
}

export function clearDebugLogs() {
  const state = getState();
  state.logs = [];
  state.listeners.forEach((listener) => listener([]));
}

export function installDebugLogger() {
  const state = getState();
  if (state.patched) return;

  // monkey-patch the native console so we can intercept and record everything
  const originals = {
    log: Reflect.get(console, 'log').bind(console),
    info: Reflect.get(console, 'info').bind(console),
    debug: Reflect.get(console, 'debug').bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    success: (Reflect.get(console, 'success') || Reflect.get(console, 'info')).bind(console),
  };
  state.originals = originals;
  state.patched = true;

  Reflect.set(console, 'log', (...args: unknown[]) => {
    originals.log(...args);
    addDebugLog('info', args, 'console');
  });
  Reflect.set(console, 'info', (...args: unknown[]) => {
    originals.info(...args);
    addDebugLog('info', args, 'console');
  });
  Reflect.set(console, 'debug', (...args: unknown[]) => {
    originals.debug(...args);
    addDebugLog('info', args, 'console');
  });
  Reflect.set(console, 'success', (...args: unknown[]) => {
    originals.success(...args);
    addDebugLog('success', args, 'console');
  });
  console.warn = (...args) => {
    originals.warn(...args);
    addDebugLog('warn', args, 'console');
  };
  console.error = (...args) => {
    originals.error(...args);
    addDebugLog('error', args, 'console');
  };

  window.addEventListener('error', (event) => {
    addDebugLog('error', [event.error || event.message || 'Unhandled window error'], 'console');
  });
  window.addEventListener('unhandledrejection', (event) => {
    addDebugLog('error', [event.reason || 'Unhandled promise rejection'], 'console');
  });

  window.ismLog = (level: LogLevel, message: string, notify?: boolean) => {
    addDebugLog(level, [message], 'ism', notify);
  };
}

installDebugLogger();
