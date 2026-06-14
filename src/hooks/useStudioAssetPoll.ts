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

    const bundleSnapshot = (bundle: StudioScanBundle) =>
      JSON.stringify({
        anims: bundle.anims.assets,
        sounds: bundle.sounds.assets,
        images: bundle.images.assets,
        meshes: bundle.meshes.assets,
        scriptRefs: bundle.scriptRefs.assets,
      });

    const schedulePoll = (delayMs: number) => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => void poll(), delayMs);
    };

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;

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
