import { invoke } from '@tauri-apps/api/core';

import { isTauriRuntime } from './tauriRuntime';

// pops up a native OS notification if we're in tauri, otherwise just yells in the console
export async function notifyError(title: string, message?: string) {
  let displayMessage = message ?? title;

  // Try to parse structured backend errors
  if (message) {
    try {
      const parsed = JSON.parse(message);
      if (parsed.message && parsed.debug) {
        displayMessage = parsed.message;
        console.error(`[Backend Error Context] ${title}`, parsed.debug);
      }
    } catch {
      // It's just a normal string
    }
  }

  const body = displayMessage !== title ? displayMessage : '';

  if (isTauriRuntime()) {
    try {
      await invoke('show_notification', { options: { title, body } });
      return;
    } catch {}
  }
  console.error(title, displayMessage);
}
