import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { useEffect, useRef } from 'react';

import { isTauriRuntime } from '@/utils/tauriRuntime';

import { useThemeAccent } from '../contexts/ThemeContext';
import type { StoredDiscordAuth } from '../types/discordAuth';

interface CloudThemeStateResponse {
  changed: boolean;
  version?: number;
  themeData?: string | Record<string, any>;
  themeHash?: string;
}

const CLOUD_THEME_APP_VERSION = '2.0.0';

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// send a receipt back to the server so we know the theme applied successfully or if it exploded
async function sendThemeReceipt(
  loginToken: string,
  version: number,
  themeHash: string,
  status: 'applied' | 'failed',
  error: string | null,
) {
  const baseUrl =
    import.meta.env.VITE_API_BASE_URL === undefined
      ? 'https://ispoofermotion.com'
      : import.meta.env.VITE_API_BASE_URL;
  await tauriFetch(`${baseUrl}/api/cloud-theme/receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loginToken,
      version,
      themeHash,
      status,
      error,
      appVersion: CLOUD_THEME_APP_VERSION,
    }),
  }).catch(() => {});
}

export function useCloudThemeSync() {
  const { clearCustomTheme, loadThemeFromJson, setThemeMode } = useThemeAccent();
  const syncInProgress = useRef(false);
  const mountedAbort = useRef<AbortController | null>(null);

  const themeOps = useRef({
    clearCustomTheme,
    loadThemeFromJson,
    setThemeMode,
  });
  useEffect(() => {
    themeOps.current = { clearCustomTheme, loadThemeFromJson, setThemeMode };
  }, [clearCustomTheme, loadThemeFromJson, setThemeMode]);

  // the actual sync logic, wrapped in a ref so we don't trip over react dependencies or cause weird re-renders
  const performSyncRef = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    performSyncRef.current = async () => {
      if (!isTauriRuntime() || syncInProgress.current) return;
      syncInProgress.current = true;

      const stateController = new AbortController();
      mountedAbort.current = stateController;

      try {
        const auth = await invoke<StoredDiscordAuth | null>('load_discord_report_auth', {});
        if (!auth?.loginToken || stateController.signal.aborted) return;

        const localVersion = Number.parseInt(
          window.localStorage.getItem('cloud_theme_version') || '0',
          10,
        );

        const baseUrl =
          import.meta.env.VITE_API_BASE_URL === undefined
            ? 'https://ispoofermotion.com'
            : import.meta.env.VITE_API_BASE_URL;
        const response = await tauriFetch(
          `${baseUrl}/api/cloud-theme/state?since=${localVersion}`,
          {
            headers: { Authorization: `Bearer ${auth.loginToken}` },
            signal: stateController.signal,
          },
        );

        if (stateController.signal.aborted) return;

        if (response.status === 404) {
          if (localVersion > 0) {
            window.localStorage.removeItem('active_custom_theme_json');
            window.localStorage.removeItem('cloud_theme_version');
            window.localStorage.removeItem('cloud_theme_hash');
            themeOps.current.clearCustomTheme();
            themeOps.current.setThemeMode('dark');
          }
          return;
        }

        if (!response.ok) return;

        const data: CloudThemeStateResponse = await response.json();
        if (!data.changed || !data.themeData || !data.version || !data.themeHash) return;

        const themeJsonString =
          typeof data.themeData === 'string' ? data.themeData : JSON.stringify(data.themeData);

        if (themeJsonString === '{}') {
          window.localStorage.removeItem('active_custom_theme_json');
          window.localStorage.removeItem('cloud_theme_version');
          window.localStorage.removeItem('cloud_theme_hash');
          themeOps.current.clearCustomTheme();
          themeOps.current.setThemeMode('dark');
          return;
        }

        try {
          window.localStorage.setItem('active_custom_theme_json', themeJsonString);
          window.localStorage.setItem('theme', 'custom');
          window.localStorage.setItem('cloud_theme_version', data.version.toString());
          window.localStorage.setItem('cloud_theme_hash', data.themeHash);

          themeOps.current.loadThemeFromJson(themeJsonString);

          await sendThemeReceipt(auth.loginToken, data.version, data.themeHash, 'applied', null);
        } catch (applyError) {
          console.error('Failed to apply theme', applyError);
          await sendThemeReceipt(
            auth.loginToken,
            data.version,
            data.themeHash,
            'failed',
            errorMessage(applyError),
          );
        }
      } catch (error) {
        if (!stateController.signal.aborted) {
          console.error('Cloud theme sync error:', error);
        }
      } finally {
        if (mountedAbort.current === stateController) {
          mountedAbort.current = null;
        }
        syncInProgress.current = false;
      }
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    // kick off the sync loop and listen for manual triggers from the UI
    const unlisteners: Array<() => void> = [];
    const performSync = () => performSyncRef.current();

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('cloud-theme-sync-now', performSync).then((unlisten) => {
        unlisteners.push(unlisten);
      });
    });

    const intervalId = window.setInterval(performSync, 5 * 60 * 1000);
    performSync();

    return () => {
      window.clearInterval(intervalId);
      for (const unlisten of unlisteners) unlisten();
      if (mountedAbort.current) {
        mountedAbort.current.abort();
      }
    };
  }, []);
}
