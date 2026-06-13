import { decompress as zstdDecompress } from 'fzstd';

import { buildAssetRef, classifyProperty, extractAssetId } from './assetClassifier';
import type { PlaceParseResult, RbxInstance } from './types';

const MAGIC = '<roblox!\x89\xff\r\n\x1a\n';
const MAGIC_BYTES = new Uint8Array(MAGIC.split('').map((c) => c.charCodeAt(0)));

function lz4Decompress(src: Uint8Array, uncompressedSize: number): Uint8Array {
  const dst = new Uint8Array(uncompressedSize);
  let sPos = 0;
  let dPos = 0;

  while (sPos < src.length) {
    const token = src[sPos++];
    let litLen = (token >> 4) & 0xf;

    if (litLen === 15) {
      let extra: number;
      do {
        extra = src[sPos++];
        litLen += extra;
      } while (extra === 255);
    }

    dst.set(src.subarray(sPos, sPos + litLen), dPos);
    sPos += litLen;
    dPos += litLen;

    if (sPos >= src.length) break;

    const offset = src[sPos] | (src[sPos + 1] << 8);
    sPos += 2;
    if (offset === 0) throw new Error('LZ4: invalid offset 0');

    let matchLen = (token & 0xf) + 4;
    if (matchLen - 4 === 15) {
      let extra: number;
      do {
        extra = src[sPos++];
        matchLen += extra;
      } while (extra === 255);
    }

    let matchPos = dPos - offset;
    for (let i = 0; i < matchLen; i++) {
      dst[dPos++] = dst[matchPos++];
    }
  }

  return dst;
}

class BinaryReader {
  private view: DataView;
  pos: number = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  get remaining(): number {
    return this.view.byteLength - this.pos;
  }

  readUint8(): number {
    return this.view.getUint8(this.pos++);
  }

  readUint16LE(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readUint32LE(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readInt32LE(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readBytes(n: number): Uint8Array {
    const slice = new Uint8Array(this.view.buffer, this.pos, n);
    this.pos += n;
    return slice;
  }

  readAscii(n: number): string {
    return String.fromCharCode(...this.readBytes(n));
  }

  readLPString(): string {
    const len = this.readUint32LE();
    const bytes = this.readBytes(len);
    return new TextDecoder().decode(bytes);
  }

  readInterleaved(count: number): number[] {
    const bytes = this.readBytes(count * 4);
    const result: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const b0 = bytes[i];
      const b1 = bytes[i + count];
      const b2 = bytes[i + count * 2];
      const b3 = bytes[i + count * 3];
      let v = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;

      v = (v >>> 1) ^ -(v & 1);
      result[i] = v;
    }
    return result;
  }

  readInterleavedUint32(count: number): number[] {
    const bytes = this.readBytes(count * 4);
    const result: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const b0 = bytes[i];
      const b1 = bytes[i + count];
      const b2 = bytes[i + count * 2];
      const b3 = bytes[i + count * 3];
      result[i] = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
    }
    return result;
  }
}

interface Chunk {
  name: string;
  data: Uint8Array;
}

function readChunks(reader: BinaryReader, warnings: string[]): Chunk[] {
  const chunks: Chunk[] = [];

  while (reader.remaining >= 16) {
    const name = reader.readAscii(4).replace(/\0/g, '').trim();
    const compressedLen = reader.readUint32LE();
    const uncompressedLen = reader.readUint32LE();
    reader.readUint32LE();

    if (compressedLen > reader.remaining) {
      warnings.push(
        `[rbxl] Chunk "${name}" claims ${compressedLen} bytes but only ${reader.remaining} remain - file may be truncated.`,
      );
      break;
    }

    const rawData = reader.readBytes(compressedLen > 0 ? compressedLen : uncompressedLen);

    let data: Uint8Array;
    if (compressedLen === 0) {
      data = rawData;
    } else {
      try {
        if (
          rawData.length >= 4 &&
          rawData[0] === 0x28 &&
          rawData[1] === 0xb5 &&
          rawData[2] === 0x2f &&
          rawData[3] === 0xfd
        ) {
          data = zstdDecompress(rawData);
        } else {
          data = lz4Decompress(rawData, uncompressedLen);
        }
      } catch (err) {
        warnings.push(
          `[rbxl] Could not decompress chunk "${name}" - skipping. Error: ${String(err)}`,
        );
        continue;
      }
    }

    chunks.push({ name, data });

    if (name === 'END') break;
  }

  return chunks;
}

interface InstEntry {
  typeId: number;
  className: string;

  referents: number[];
}

function parseInstChunk(data: Uint8Array, warnings: string[]): Map<number, InstEntry> {
  const map = new Map<number, InstEntry>();
  try {
    const r = new BinaryReader(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    );
    const typeId = r.readInt32LE();
    const className = r.readLPString();
    const isService = r.readUint8();
    void isService;
    const count = r.readInt32LE();

    const rawReferents = r.readInterleaved(count);

    const referents: number[] = [];
    let acc = 0;
    for (const delta of rawReferents) {
      acc += delta;
      referents.push(acc);
    }
    map.set(typeId, { typeId, className, referents });
  } catch (err) {
    warnings.push(`[rbxl] Error parsing INST chunk: ${String(err)}`);
  }
  return map;
}

function parseSstrChunk(data: Uint8Array, warnings: string[]): string[] {
  const array: string[] = [];
  try {
    const r = new BinaryReader(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    );
    r.readInt32LE();
    const count = r.readInt32LE();
    for (let i = 0; i < count; i++) {
      r.readBytes(16);
      const value = r.readLPString();
      array.push(value);
    }
  } catch (err) {
    warnings.push(`[rbxl] Failed to parse SSTR chunk: ${String(err)}`);
  }
  return array;
}

const PROP_TYPE_STRING = 0x01;
const PROP_TYPE_SHARED_STRING = 0x1c;

interface PropEntry {
  typeId: number;
  className: string;
  propertyName: string;

  values: string[];
}

function parsePropChunk(
  data: Uint8Array,
  instMap: Map<number, InstEntry>,
  warnings: string[],
): PropEntry | null {
  try {
    const r = new BinaryReader(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    );
    const typeId = r.readInt32LE();
    const propertyName = r.readLPString();
    const propType = r.readUint8();

    const entry = instMap.get(typeId);
    if (!entry) {
      warnings.push(
        `[rbxl] PROP chunk references unknown typeId ${typeId} for property "${propertyName}" - skipping.`,
      );
      return null;
    }

    const count = entry.referents.length;

    if (propType === PROP_TYPE_SHARED_STRING) {
      const indices = r.readInterleavedUint32(count);
      const values: string[] = [];
      for (let i = 0; i < count; i++) {
        values.push(`SSTR:${indices[i]}`);
      }
      return { typeId, className: entry.className, propertyName, values };
    }

    if (propType !== PROP_TYPE_STRING) {
      return null;
    }

    const values: string[] = [];
    for (let i = 0; i < count; i++) {
      values.push(r.readLPString());
    }

    return { typeId, className: entry.className, propertyName, values };
  } catch (err) {
    warnings.push(`[rbxl] Error parsing PROP chunk: ${String(err)}`);
    return null;
  }
}

function parsePrntChunk(
  data: Uint8Array,
  warnings: string[],
): { childId: number; parentId: number }[] {
  const edges: { childId: number; parentId: number }[] = [];
  try {
    const r = new BinaryReader(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    );
    const version = r.readUint8();
    if (version !== 0) {
      warnings.push(`[rbxl] PRNT chunk version ${version} unsupported.`);
      return [];
    }
    const count = r.readInt32LE();
    const rawChildIds = r.readInterleaved(count);
    const rawParentIds = r.readInterleaved(count);

    const childIds: number[] = [];
    let accChild = 0;
    for (const delta of rawChildIds) {
      accChild += delta;
      childIds.push(accChild);
    }

    const parentIds: number[] = [];
    let accParent = 0;
    for (const delta of rawParentIds) {
      accParent += delta;
      parentIds.push(accParent);
    }

    for (let i = 0; i < count; i++) {
      edges.push({ childId: childIds[i], parentId: parentIds[i] });
    }
  } catch (err) {
    warnings.push(`[rbxl] Error parsing PRNT chunk: ${String(err)}`);
  }
  return edges;
}

export function parseRbxl(buffer: ArrayBuffer, fileName: string): PlaceParseResult {
  const warnings: string[] = [];

  const header = new Uint8Array(buffer, 0, Math.min(14, buffer.byteLength));
  for (let i = 0; i < MAGIC_BYTES.length; i++) {
    if (header[i] !== MAGIC_BYTES[i]) {
      warnings.push(
        `[rbxl] "${fileName}" does not start with the Roblox binary magic bytes - ` +
          'is this a valid .rbxl file?',
      );
      return { fileType: 'rbxl', rootInstances: [], warnings };
    }
  }

  const reader = new BinaryReader(buffer);
  reader.pos = 14;

  const version = reader.readUint16LE();
  if (version !== 0) {
    warnings.push(
      `[rbxl] "${fileName}" reports binary format version ${version}, but only version 0 is supported.`,
    );
    return { fileType: 'rbxl', rootInstances: [], warnings };
  }

  const classCount = reader.readInt32LE();
  const instanceCount = reader.readInt32LE();
  reader.pos += 8;

  void classCount;
  void instanceCount;

  const chunks = readChunks(reader, warnings);

  const instMap = new Map<number, InstEntry>();
  let sstrArray: string[] = [];
  let prntEdges: { childId: number; parentId: number }[] = [];

  for (const chunk of chunks) {
    if (chunk.name === 'INST') {
      const entries = parseInstChunk(chunk.data, warnings);
      for (const [id, entry] of entries) {
        instMap.set(id, entry);
      }
    } else if (chunk.name === 'SSTR') {
      sstrArray = parseSstrChunk(chunk.data, warnings);
    } else if (chunk.name === 'PRNT') {
      prntEdges = parsePrntChunk(chunk.data, warnings);
    }
  }

  if (instMap.size === 0) {
    warnings.push(`[rbxl] "${fileName}" - no INST chunks found; file may be empty or unreadable.`);
    return { fileType: 'rbxl', rootInstances: [], warnings };
  }

  const instances = new Map<number, RbxInstance>();
  for (const entry of instMap.values()) {
    for (const referent of entry.referents) {
      instances.set(referent, {
        referent: String(referent),
        className: entry.className,
        name: entry.className,
        assets: [],
        children: [],
      });
    }
  }

  for (const chunk of chunks) {
    if (chunk.name !== 'PROP') continue;
    const propEntry = parsePropChunk(chunk.data, instMap, warnings);
    if (!propEntry) continue;
    const instEntry = instMap.get(propEntry.typeId);
    if (!instEntry) continue;

    const assetType = classifyProperty(propEntry.className, propEntry.propertyName);

    for (let i = 0; i < propEntry.values.length; i++) {
      let rawValue = propEntry.values[i];
      const referent = instEntry.referents[i];
      const instance = instances.get(referent);
      if (!instance) continue;

      if (rawValue.startsWith('SSTR:')) {
        const idx = parseInt(rawValue.substring(5), 10);
        const resolved = sstrArray[idx];
        if (resolved !== undefined) {
          rawValue = resolved;
        }
      }

      if (propEntry.propertyName === 'Name') {
        instance.name = rawValue;
      } else if (assetType) {
        const assetId = extractAssetId(rawValue);
        if (assetId) {
          instance.assets.push(
            buildAssetRef(
              instance.className,
              instance.name,
              propEntry.propertyName,
              rawValue,
              assetId,
              '',
              assetType,
            ),
          );
        } else if (rawValue && rawValue !== 'nil' && rawValue !== '0' && rawValue !== '') {
          warnings.push(
            `[rbxl] Could not extract asset ID from ${instance.className}.${propEntry.propertyName} - raw: "${rawValue}"`,
          );
        }
      }
    }
  }

  const rootInstances: RbxInstance[] = [];
  for (const edge of prntEdges) {
    const child = instances.get(edge.childId);
    if (!child) continue;

    if (edge.parentId === -1) {
      rootInstances.push(child);
    } else {
      const parent = instances.get(edge.parentId);
      if (parent) {
        parent.children.push(child);
      } else {
        rootInstances.push(child);
      }
    }
  }

  function buildPaths(node: RbxInstance, currentPath: string) {
    const nextPath = currentPath ? `${currentPath}/${node.name}` : node.name;
    for (const asset of node.assets) {
      asset.instanceName = node.name;
      asset.path = nextPath;
    }
    for (const child of node.children) {
      buildPaths(child, nextPath);
    }
  }

  for (const root of rootInstances) {
    buildPaths(root, '');
  }

  return { fileType: 'rbxl', rootInstances, warnings };
}
