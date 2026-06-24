import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Provide a minimal window stub so debugLogger can run in node
const createWindow = () => {
  const listeners: Record<string, EventListener[]> = {};
  return {
    __ismDebugLogger: undefined as any,
    ismLog: undefined as any,
    addEventListener: (event: string, fn: EventListener) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(fn);
    },
    removeEventListener: (event: string, fn: EventListener) => {
      listeners[event] = (listeners[event] ?? []).filter((l) => l !== fn);
    },
    dispatchEvent: (_: Event) => true,
  };
};

let windowStub: ReturnType<typeof createWindow>;

beforeEach(async () => {
  vi.resetModules();
  windowStub = createWindow();
  vi.stubGlobal('window', windowStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function getLogger() {
  const mod = await import('./debugLogger');
  return mod;
}

describe('addDebugLog', () => {
  it('stores a log entry with the correct level and message', async () => {
    const { addDebugLog, getDebugLogs } = await getLogger();
    addDebugLog('info', ['hello world']);
    const logs = getDebugLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('info');
    expect(logs[0].message).toBe('hello world');
    expect(logs[0].source).toBe('console');
  });

  it('separates string args as message from object args as payload', async () => {
    const { addDebugLog, getDebugLogs } = await getLogger();
    const obj = { foo: 'bar' };
    addDebugLog('warn', ['prefix', obj]);
    const logs = getDebugLogs();
    expect(logs[0].message).toBe('prefix');
    expect(logs[0].payload).toEqual([obj]);
  });

  it('uses "Object logged" when only non-string args are provided', async () => {
    const { addDebugLog, getDebugLogs } = await getLogger();
    addDebugLog('error', [{ code: 42 }]);
    expect(getDebugLogs()[0].message).toBe('Object logged');
  });

  it('formats Error objects using their stack or message', async () => {
    const { addDebugLog, getDebugLogs } = await getLogger();
    const err = new Error('boom');
    addDebugLog('error', [err]);
    expect(getDebugLogs()[0].message).toMatch(/boom/);
  });

  it('respects the source parameter', async () => {
    const { addDebugLog, getDebugLogs } = await getLogger();
    addDebugLog('success', ['done'], 'ism');
    expect(getDebugLogs()[0].source).toBe('ism');
  });

  it('assigns incrementing ids across entries', async () => {
    const { addDebugLog, getDebugLogs } = await getLogger();
    addDebugLog('info', ['a']);
    addDebugLog('info', ['b']);
    const logs = getDebugLogs();
    expect(logs[1].id).toBe(logs[0].id + 1);
  });

  it('caps the log buffer at 1000 entries', async () => {
    const { addDebugLog, getDebugLogs } = await getLogger();
    for (let i = 0; i < 1005; i++) {
      addDebugLog('info', [`msg ${i}`]);
    }
    expect(getDebugLogs()).toHaveLength(1000);
  });
});

describe('subscribeDebugLogs', () => {
  it('immediately calls the listener with current logs on subscribe', async () => {
    const { addDebugLog, subscribeDebugLogs } = await getLogger();
    addDebugLog('info', ['existing']);
    const received: any[] = [];
    const unsub = subscribeDebugLogs((logs) => received.push(logs));
    expect(received).toHaveLength(1);
    unsub();
  });

  it('calls the listener on each subsequent log', async () => {
    const { addDebugLog, subscribeDebugLogs } = await getLogger();
    const calls: number[] = [];
    const unsub = subscribeDebugLogs((logs) => calls.push(logs.length));
    addDebugLog('info', ['one']);
    addDebugLog('warn', ['two']);
    expect(calls).toContain(1);
    expect(calls).toContain(2);
    unsub();
  });

  it('stops receiving updates after unsubscribing', async () => {
    const { addDebugLog, subscribeDebugLogs } = await getLogger();
    const calls: number[] = [];
    const unsub = subscribeDebugLogs((logs) => calls.push(logs.length));
    unsub();
    const countBefore = calls.length;
    addDebugLog('info', ['after unsub']);
    expect(calls.length).toBe(countBefore);
  });
});

describe('clearDebugLogs', () => {
  it('empties the log buffer', async () => {
    const { addDebugLog, clearDebugLogs, getDebugLogs } = await getLogger();
    addDebugLog('info', ['a']);
    addDebugLog('info', ['b']);
    clearDebugLogs();
    expect(getDebugLogs()).toHaveLength(0);
  });

  it('notifies listeners with an empty array', async () => {
    const { addDebugLog, clearDebugLogs, subscribeDebugLogs } = await getLogger();
    addDebugLog('info', ['x']);
    const received: any[][] = [];
    const unsub = subscribeDebugLogs((logs) => received.push(logs));
    clearDebugLogs();
    expect(received[received.length - 1]).toHaveLength(0);
    unsub();
  });
});
