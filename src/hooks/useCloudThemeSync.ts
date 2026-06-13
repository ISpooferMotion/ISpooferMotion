import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef } from 'react';

import { useThemeAccent } from '../contexts/ThemeContext';
import { isTauriRuntime } from '../utils/tauriRuntime';

const CLOUD_THEME_APP_VERSION = '2.0.0';

interface StoredDiscordAuth {
  loginToken: string;
}

interface CloudThemeStateResponse {
  changed: boolean;
  version?: number;
  themeData?: string;
  themeHash?: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function sendThemeReceipt(
  loginToken: string,
  version: number,
  themeHash: string,
  status: 'applied' | 'failed',
  error: string | null,
  signal: AbortSignal,
) {
  await fetch('https://ispoofermotion.com/api/cloud-theme/receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      loginToken,
      version,
      themeHash,
      status,
      error,
      appVersion: CLOUD_THEME_APP_VERSION,
    }),
  });
}

export function useCloudThemeSync() {
  const { clearCustomTheme, loadThemeFromJson, setThemeMode } = useThemeAccent();
  const syncInProgress = useRef(false);
  const activeAbort = useRef<AbortController | null>(null);

  const performSync = useCallback(async () => {
    if (!isTauriRuntime() || syncInProgress.current) return;

    const controller = new AbortController();
    activeAbort.current = controller;
    syncInProgress.current = true;

    try {
      const auth = await invoke<StoredDiscordAuth | null>('load_discord_report_auth');
      if (!auth?.loginToken || controller.signal.aborted) return;

      const localVersion = Number.parseInt(
        window.localStorage.getItem('cloud_theme_version') || '0',
        10,
      );

      const response = await fetch(
        `https://ispoofermotion.com/api/cloud-theme/state?since=${localVersion}`,
        {
          headers: { Authorization: `Bearer ${auth.loginToken}` },
          signal: controller.signal,
        },
      );

      if (response.status === 404) {
        if (localVersion > 0) {
          window.localStorage.removeItem('active_custom_theme_json');
          window.localStorage.removeItem('cloud_theme_version');
          window.localStorage.removeItem('cloud_theme_hash');
          clearCustomTheme();
          setThemeMode('dark');
        }
        return;
      }

      if (!response.ok) {
        console.error('Failed to fetch cloud theme state', response.status);
        return;
      }

      const data: CloudThemeStateResponse = await response.json();
      if (!data.changed || !data.themeData || !data.version || !data.themeHash) return;

      try {
        window.localStorage.setItem('active_custom_theme_json', data.themeData);
        window.localStorage.setItem('theme', 'custom');
        window.localStorage.setItem('cloud_theme_version', data.version.toString());
        window.localStorage.setItem('cloud_theme_hash', data.themeHash);

        loadThemeFromJson(data.themeData);
        await sendThemeReceipt(
          auth.loginToken,
          data.version,
          data.themeHash,
          'applied',
          null,
          controller.signal,
        );
      } catch (applyError) {
        console.error('Failed to apply theme', applyError);
        await sendThemeReceipt(
          auth.loginToken,
          data.version,
          data.themeHash,
          'failed',
          errorMessage(applyError),
          controller.signal,
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('Cloud theme sync error:', error);
      }
    } finally {
      if (activeAbort.current === controller) {
        activeAbort.current = null;
      }
      syncInProgress.current = false;
    }
  }, [clearCustomTheme, loadThemeFromJson, setThemeMode]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const unlisteners: Array<() => void> = [];
    let disposed = false;

    const trackUnlistener = (promise: Promise<() => void>) => {
      promise
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlisteners.push(unlisten);
          }
        })
        .catch((error) => {
          console.error('Cloud theme listener setup failed:', error);
        });
    };

    void performSync();
    const interval = window.setInterval(() => void performSync(), 30000);

    trackUnlistener(listen('cloud-theme-sync-now', () => void performSync()));
    trackUnlistener(listen('discord-login-success', () => void performSync()));

    return () => {
      disposed = true;
      window.clearInterval(interval);
      activeAbort.current?.abort();
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [performSync]);
}
