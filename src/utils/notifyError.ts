import { invoke } from '@tauri-apps/api/core';

import { isTauriRuntime } from './tauriRuntime';

export async function notifyError(title: string, message?: string) {
  const body = message ?? title;
  if (isTauriRuntime()) {
    try {
      await invoke('show_notification', { options: { title, body } });
      return;
    } catch {}
  }
  console.error(title, message ?? '');
}
