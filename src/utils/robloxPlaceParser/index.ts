export { parseRbxl } from './parseRbxl';
export { parseRbxlx } from './parseRbxlx';
export type {
  ParsedAssetRef,
  ParseProgress,
  ParseProgressCallback,
  PlaceParseResult,
  RbxInstance,
  RobloxFileType,
} from './types';

import { parseRbxl } from './parseRbxl';
import { parseRbxlx } from './parseRbxlx';
import type { ParseProgressCallback, PlaceParseResult, RobloxFileType } from './types';

function detectFormat(fileName: string, bytes: Uint8Array): RobloxFileType {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.rbxlx')) return 'rbxlx';
  if (lower.endsWith('.rbxl')) {
    const MAGIC_START = '<roblox!';
    if (bytes.length >= 8) {
      const start = String.fromCharCode(...bytes.slice(0, 8));
      if (start === MAGIC_START) return 'rbxl';
    }

    const head = new TextDecoder().decode(bytes.slice(0, 64)).trimStart();
    if (head.startsWith('<?xml') || head.startsWith('<roblox')) return 'rbxlx';
    return 'rbxl';
  }
  return 'unknown';
}

export async function parsePlaceBytes(
  bytes: Uint8Array,
  fileName: string,
  onProgress?: ParseProgressCallback,
): Promise<PlaceParseResult> {
  const fmt = detectFormat(fileName, bytes);

  if (fmt === 'rbxlx') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return await parseRbxlx(text, fileName, onProgress);
  }

  if (fmt === 'rbxl') {
    return await parseRbxl(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      fileName,
    );
  }

  return {
    fileType: 'unknown',
    rootInstances: [],
    warnings: [`"${fileName}" does not have a recognised Roblox place extension (.rbxl / .rbxlx).`],
  };
}

export async function parsePlaceBytesInWorker(
  bytes: Uint8Array,
  fileName: string,
  onProgress?: ParseProgressCallback,
): Promise<PlaceParseResult> {
  const fmt = detectFormat(fileName, bytes);

  if (fmt === 'rbxl' || fmt === 'rbxlx') {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

      worker.onmessage = (e) => {
        const { type, payload } = e.data;
        if (type === 'progress' && onProgress) {
          onProgress(payload);
        } else if (type === 'success') {
          resolve(payload);
          worker.terminate();
        } else if (type === 'error') {
          reject(new Error(payload));
          worker.terminate();
        }
      };

      worker.onerror = (err) => {
        reject(err);
        worker.terminate();
      };

      worker.postMessage({ bytes, fileName, format: fmt }, [bytes.buffer]);
    });
  }

  return {
    fileType: 'unknown',
    rootInstances: [],
    warnings: [`"${fileName}" does not have a recognised Roblox place extension (.rbxl / .rbxlx).`],
  };
}

export async function parsePlaceUrlInWorker(
  fileUrl: string,
  fileName: string,
  onProgress?: ParseProgressCallback,
): Promise<PlaceParseResult> {
  const lower = fileName.toLowerCase();
  let fmt: RobloxFileType = 'unknown';
  if (lower.endsWith('.rbxlx')) fmt = 'rbxlx';
  else if (lower.endsWith('.rbxl')) fmt = 'rbxl';

  if (fmt === 'rbxl' || fmt === 'rbxlx') {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

      worker.onmessage = (e) => {
        const { type, payload } = e.data;
        if (type === 'progress' && onProgress) {
          onProgress(payload);
        } else if (type === 'success') {
          resolve(payload);
          worker.terminate();
        } else if (type === 'error') {
          reject(new Error(payload));
          worker.terminate();
        }
      };

      worker.onerror = (err) => {
        reject(err);
        worker.terminate();
      };

      worker.postMessage({ fileUrl, fileName, format: fmt });
    });
  }

  return {
    fileType: 'unknown',
    rootInstances: [],
    warnings: [`"${fileName}" does not have a recognised Roblox place extension (.rbxl / .rbxlx).`],
  };
}

export async function parsePlaceFile(
  file: File,
  onProgress?: ParseProgressCallback,
): Promise<PlaceParseResult> {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return await parsePlaceBytes(bytes, file.name, onProgress);
  } catch (err) {
    return {
      fileType: 'unknown',
      rootInstances: [],
      warnings: [`Failed to read file "${file.name}": ${String(err)}`],
    };
  }
}

export function validateXmlParser(): boolean {
  const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<roblox xmlns:xmime="http://www.w3.org/2001/XMLSchema-instance" version="4">
  <Item class="Sound" referent="RBX001">
    <Properties>
      <string name="Name">BGMusic</string>
      <Content name="SoundId"><url>rbxassetid://987654321</url></Content>
    </Properties>
  </Item>
  <Item class="Animation" referent="RBX002">
    <Properties>
      <string name="Name">RunAnim</string>
      <Content name="AnimationId"><url>rbxassetid://111222333</url></Content>
    </Properties>
  </Item>
  <Item class="Decal" referent="RBX003">
    <Properties>
      <string name="Name">SkyDecal</string>
      <Content name="Texture"><url>https://www.roblox.com/asset/?id=444555666</url></Content>
    </Properties>
  </Item>
</roblox>`;

  parseRbxlx(SAMPLE_XML, 'sample.rbxlx').then((result) => {
    const allAssets: import('./types').ParsedAssetRef[] = [];
    const traverse = (node: import('./types').RbxInstance) => {
      allAssets.push(...node.assets);
      node.children.forEach(traverse);
    };
    result.rootInstances.forEach(traverse);

    const ok =
      allAssets.length === 3 &&
      allAssets.some((a) => a.type === 'audio' && a.assetId === '987654321') &&
      allAssets.some((a) => a.type === 'animation' && a.assetId === '111222333') &&
      allAssets.some((a) => a.type === 'image' && a.assetId === '444555666');

    if (ok) {
      console.warn('[rbxlx validator] ✓ XML parser self-test passed.', result);
    } else {
      console.warn('[rbxlx validator] ✗ XML parser self-test failed.', result);
    }
  });
  return true;
}

export function validateBinaryParserRejectsGarbage(): boolean {
  const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
  parsePlaceBytes(garbage, 'test.rbxl').then((result) => {
    const ok = result.rootInstances.length === 0 && result.warnings.length > 0;
    if (ok) {
      console.warn('[rbxl validator] ✓ Binary parser correctly rejects garbage input.', result);
    } else {
      console.warn('[rbxl validator] ✗ Binary parser did not reject garbage correctly.', result);
    }
  });
  return true;
}
