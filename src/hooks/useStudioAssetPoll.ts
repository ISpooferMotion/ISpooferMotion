import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';

import type { PluginAssetStore } from '../utils/pluginBridge';

export type StudioScanBundle = {
  anims: PluginAssetStore;
  sounds: PluginAssetStore;
  images: PluginAssetStore;
  meshes: PluginAssetStore;
  scriptRefs: PluginAssetStore;
};

export function useStudioAssetPoll(
  // polls the studio plugin bridge to see if any new assets have been discovered
  studioConnected: boolean,
  pluginPort: string,
  onComplete: (bundle: StudioScanBundle) => void,
) {
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!studioConnected) return;

    let cancelled = false;
    let idle = false;
    let inFlight = false;
    let lastSnapshot = '';
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const hashAssets = (assets?: any[]) => {
      if (!assets || assets.length === 0) return '0';
      // Fast hash: combine length, first asset ID/name, and last asset ID/name
      const first = assets[0].assetId || assets[0].name || '';
      const last = assets[assets.length - 1].assetId || assets[assets.length - 1].name || '';
      return `${assets.length}:${first}:${last}`;
    };

    // lazy snapshot comparison so we avoid triggering massive react renders if nothing actually changed
    const bundleSnapshot = (bundle: StudioScanBundle) =>
      `${hashAssets(bundle.anims.assets)}-${hashAssets(bundle.sounds.assets)}-${hashAssets(bundle.images.assets)}-${hashAssets(bundle.meshes.assets)}-${hashAssets(bundle.scriptRefs.assets)}`;

    const schedulePoll = (delayMs: number) => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => void poll(), delayMs);
    };

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;

      // grab the latest asset stores from the rust backend
      try {
        const bundle = await invoke<StudioScanBundle>('get_studio_asset_snapshots');
        if (cancelled) return;

        const { anims, sounds, images, meshes, scriptRefs } = bundle;
        const stores = [anims, sounds, images, meshes, scriptRefs];
        const anyScanning = stores.some((store) => store.scanning);
        if (anyScanning && idle) {
          idle = false;
          schedulePoll(2000);
        }

        const allDone = stores.every((store) => store.complete);

        if (!allDone) {
          idle = false;
          lastSnapshot = '';
          if (intervalId) schedulePoll(2000);
          return;
        }

        const snapshot = bundleSnapshot(bundle);
        if (snapshot === lastSnapshot) {
          if (!idle) {
            idle = true;
            schedulePoll(10000);
          }
          return;
        }

        lastSnapshot = snapshot;
        idle = true;
        onCompleteRef.current(bundle);
        schedulePoll(10000);
      } catch {
      } finally {
        inFlight = false;
      }
    };

    void poll();
    schedulePoll(2000);

    return () => {
      cancelled = true;
      idle = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [studioConnected, pluginPort]);
}
