import { invoke } from '@tauri-apps/api/core';

import { isTauriRuntime } from './tauriRuntime';

export const DEFAULT_PLUGIN_PORT = '14285';

export interface PluginBridgeHealth {
  app: string;
  port: number;
  startedAt?: number;
}

export interface PluginAsset {
  assetId?: string;
  callType?: string;
  fullName?: string;
  kind?: string;
  name?: string;
  property?: string;
  script?: string;
  scriptType?: string;
  sourceHint?: string;
  type?: string;
}

export interface PluginAssetStore {
  assets?: PluginAsset[];
  scanning?: boolean;
  complete?: boolean;
}

let cachedPort: string | null = null;
let cachedAt = 0;
let pendingDiscovery: Promise<string | null> | null = null;

let cachedApiKey: string | null = null;
let cachedApiKeyAt = 0;

export async function getPluginBridgeApiKey(): Promise<string | null> {
  if (Date.now() - cachedApiKeyAt < 5000 && cachedApiKey) {
    return cachedApiKey;
  }
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    cachedApiKey = await invoke<string>('get_plugin_api_key');
    cachedApiKeyAt = Date.now();
    return cachedApiKey;
  } catch {
    return null;
  }
}

export async function pluginBridgeHeaders(): Promise<HeadersInit> {
  const apiKey = await getPluginBridgeApiKey();
  return apiKey ? { 'X-API-Key': apiKey } : {};
}

export async function fetchPluginBridge(path: string, port: string, init?: RequestInit) {
  const base = `http://localhost:${port}`;
  const headers = new Headers(init?.headers);
  const auth = await pluginBridgeHeaders();
  for (const [key, value] of Object.entries(auth)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  const requestInit: RequestInit = { ...init, headers };
  requestInit.signal ??= AbortSignal.timeout(5000);
  return fetch(`${base}${path}`, requestInit);
}

export async function findPluginBridgePort(preferredPort?: string) {
  if (Date.now() - cachedAt < 1000) return cachedPort;
  if (pendingDiscovery) return pendingDiscovery;

  pendingDiscovery = (async () => {
    if (isTauriRuntime()) {
      try {
        const activePort = await invoke<number | null>('get_plugin_bridge_port');
        return activePort ? String(activePort) : null;
      } catch {
        return null;
      }
    }

    const port = Number.parseInt(preferredPort || DEFAULT_PLUGIN_PORT, 10);
    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(450),
      });
      if (!response.ok) return null;

      const health = (await response.json()) as PluginBridgeHealth;
      return health.app === 'ISpooferMotion' && health.port === port ? String(port) : null;
    } catch {
      return null;
    }
  })().then((port) => {
    cachedPort = port;
    cachedAt = Date.now();
    pendingDiscovery = null;
    return cachedPort;
  });

  return pendingDiscovery;
}

export async function reopenPluginPairing() {
  if (isTauriRuntime()) {
    await invoke('trigger_key_pairing');
    cachedApiKey = null;
    cachedApiKeyAt = 0;
  }
}
