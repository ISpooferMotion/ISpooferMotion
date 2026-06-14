import { invoke } from '@tauri-apps/api/core';

import { fetchPluginBridge } from './pluginBridge';

const SCAN_WAIT_MS = 120_000;
const SCAN_POLL_MS = 1500;

async function waitForStudioScanComplete(): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SCAN_WAIT_MS) {
    try {
      const health = await invoke<{ scanStatus?: { scanning?: boolean } | null }>(
        'get_studio_health_status',
      );
      if (!health.scanStatus || !health.scanStatus.scanning) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, SCAN_POLL_MS));
  }
  throw new Error('Timed out waiting for Roblox Studio to finish scanning.');
}

export async function triggerStudioScan(port: string): Promise<void> {
  const startResponse = await fetchPluginBridge('/request-sounds', port, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!startResponse.ok) {
    throw new Error('Could not start a Studio scan. Is the plugin connected?');
  }
  await waitForStudioScanComplete();
}
