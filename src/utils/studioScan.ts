import { fetchPluginBridge } from './pluginBridge';

const SCAN_WAIT_MS = 120_000;
const SCAN_POLL_MS = 1500;

async function waitForStudioScanComplete(port: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SCAN_WAIT_MS) {
    const healthResponse = await fetchPluginBridge('/studio-health', port);
    if (healthResponse.ok) {
      const health = (await healthResponse.json()) as { scanning?: boolean; scanStatus?: unknown };
      if (!health.scanning && !health.scanStatus) {
        return;
      }
    }
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
  await waitForStudioScanComplete(port);
}
