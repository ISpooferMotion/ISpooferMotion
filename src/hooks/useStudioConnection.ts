import { useEffect, useState } from 'react';

import { findPluginBridgePort } from '../utils/pluginBridge';

export interface ScanStatus {
  scanning: boolean;
  current_service: string;
  scanned: number;
  total: number;
}

const STUDIO_PLACE_ID_CACHE_KEY = 'ISpooferMotion_LastStudioPlaceId';

const readCachedStudioPlaceId = () => {
  try {
    const value = window.localStorage.getItem(STUDIO_PLACE_ID_CACHE_KEY) || '';
    return /^\d+$/.test(value) && value !== '0' ? value : '';
  } catch {
    return '';
  }
};

export function useStudioConnection(port: string, onPortDiscovered?: (port: string) => void) {
  const [studioConnected, setStudioConnected] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [studioPlaceId, setStudioPlaceId] = useState(readCachedStudioPlaceId);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const activePort = await findPluginBridgePort(port);
        if (!activePort) {
          if (!cancelled) {
            setStudioConnected(false);
            setScanStatus(null);
          }
          return;
        }
        if (activePort !== port) onPortDiscovered?.(activePort);

        const response = await fetch(
          `http://localhost:${activePort}/studio-health?t=${Date.now()}`,
          {
            signal: AbortSignal.timeout(800),
            cache: 'no-store',
          },
        );
        const result = await response.json();
        if (!cancelled) {
          setStudioConnected(response.ok && result.synced === true);
          setScanStatus(result.scanStatus || null);
          const placeId = String(result.studioPlaceId || '').trim();
          if (/^\d+$/.test(placeId) && placeId !== '0') {
            setStudioPlaceId(placeId);
            window.localStorage.setItem(STUDIO_PLACE_ID_CACHE_KEY, placeId);
          }
        }
      } catch {
        if (!cancelled) {
          setStudioConnected(false);
          setScanStatus(null);
        }
      }
    };

    check();
    const interval = setInterval(check, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [port, onPortDiscovered]);

  return { studioConnected, scanStatus, studioPlaceId };
}
