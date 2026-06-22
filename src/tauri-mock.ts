// Mock for Tauri APIs to prevent web build crashes
export class Channel {
  constructor() {}
  onmessage() {}
}
export class Resource {
  constructor() {}
  close() {}
}
export async function addPluginListener() {
  return () => {};
}

export async function invoke(cmd: string, args: any) {
  console.log(`Mock Tauri IPC: ${cmd}`, args);
  if (cmd === 'get_runtime_info') return { os_type: 'web', version: 'mock' };
  return null;
}

export function convertFileSrc(path: string) {
  return path;
}

export function getCurrentWindow() {
  return {
    minimize: async () => console.log('Mock window minimize'),
    close: async () => console.log('Mock window close'),
    onCloseRequested: async () => console.log('Mock window onCloseRequested'),
    onDragDropEvent: async (_handler: any) => {
      console.log('Mock onDragDropEvent listener attached');
      return () => {};
    },
  };
}

export async function register(shortcut: string) {
  console.log(`Mock register shortcut: ${shortcut}`);
}

export async function unregister(shortcut: string) {
  console.log(`Mock unregister shortcut: ${shortcut}`);
}

export async function isRegistered(_shortcut: string) {
  return false;
}

export async function listen(event: string, _handler: any) {
  console.log(`Mock listen for event: ${event}`);
  return async () => {}; // Unlisten function
}

export async function emit(event: string, payload: any) {
  console.log(`Mock emit event: ${event}`, payload);
}

export async function getVersion() {
  return '2.0.0-mock';
}
