import { parseRbxl } from './parseRbxl';
import { parseRbxlx } from './parseRbxlx';
import type { ParseProgress } from './types';

function postProgress(phase: string, current: number, total: number) {
  self.postMessage({
    type: 'progress',
    payload: { phase, current, total },
  });
}

async function yieldToWorkerEventLoop() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

self.onmessage = async (e: MessageEvent) => {
  try {
    const { bytes, fileUrl, fileName, format } = e.data;

    let activeBytes = bytes;
    if (fileUrl) {
      postProgress('Reading file', 0, 1);
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`Failed to load file: ${res.statusText}`);

      const contentLengthStr = res.headers.get('content-length');
      const totalSize = contentLengthStr ? parseInt(contentLengthStr, 10) : 0;

      const reader = res.body?.getReader();
      if (!reader) {
        postProgress('Reading file', 0, Math.max(totalSize, 1));
        const buffer = await res.arrayBuffer();
        activeBytes = new Uint8Array(buffer);
        postProgress('Reading file', activeBytes.byteLength, activeBytes.byteLength);
      } else {
        const chunks: Uint8Array[] = [];
        let loaded = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            loaded += value.length;

            if (loaded % (1024 * 1024 * 5) < value.length || loaded === totalSize) {
              postProgress('Reading file', loaded, Math.max(loaded, totalSize));
            }
          }
        }

        postProgress('Reading file', loaded, loaded);
        postProgress('Preparing file', 0, loaded);
        const buffer = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.length;
          if (offset % (1024 * 1024 * 64) < chunk.length || offset === loaded) {
            postProgress('Preparing file', offset, loaded);
            await yieldToWorkerEventLoop();
          }
        }
        activeBytes = buffer;
      }
    }

    if (!activeBytes) throw new Error('No bytes or fileUrl provided to worker');
    postProgress('Preparing parser', activeBytes.byteLength, activeBytes.byteLength);

    let result;
    if (format === 'rbxlx') {
      result = await parseRbxlx(activeBytes, fileName, (progress: ParseProgress) => {
        self.postMessage({ type: 'progress', payload: progress });
      });
    } else {
      const buffer =
        activeBytes.byteOffset === 0 && activeBytes.byteLength === activeBytes.buffer.byteLength
          ? activeBytes.buffer
          : (activeBytes.buffer.slice(
              activeBytes.byteOffset,
              activeBytes.byteOffset + activeBytes.byteLength,
            ) as ArrayBuffer);
      result = await parseRbxl(buffer, fileName);
    }

    self.postMessage({ type: 'success', payload: result });
  } catch (err) {
    self.postMessage({ type: 'error', payload: String(err) });
  }
};
