// @ts-nocheck
'use strict';

import { markNonRetryableError } from './common';
function startsWithBytes(buffer: Buffer, bytes: number[]) {
  if (!Buffer.isBuffer(buffer) || buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function getTextSample(buffer: Buffer) {
  return buffer
    .subarray(0, Math.min(buffer.length, MAX_TEXT_SAMPLE_BYTES))
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
}

function createInvalidPayloadError(assetType: string, reason: string, metadata: any = {}) {
  const error: any = markNonRetryableError(
    new Error(`${assetType} payload is not uploadable: ${reason}`),
    'INVALID_TRANSFER_PAYLOAD',
  );
  error.payloadMetadata = {
    format: metadata.format || 'unknown',
    extension: metadata.extension || '.bin',
    mimeType: metadata.mimeType || 'application/octet-stream',
    byteSize: metadata.byteSize || 0,
    responseContentType: metadata.responseContentType || '',
  };
  return error;
}

function getBaseMetadata(buffer: Buffer, responseContentType = '') {
  return {
    byteSize: Buffer.isBuffer(buffer) ? buffer.length : 0,
    responseContentType: String(responseContentType || '').trim(),
  };
}

function detectAudioPayload(buffer: Buffer, responseContentType = '') {
  const base = getBaseMetadata(buffer, responseContentType);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createInvalidPayloadError('Audio', 'the downloaded file is empty.', base);
  }

  if (startsWithBytes(buffer, [0x4f, 0x67, 0x67, 0x53])) {
    return { ...base, format: 'ogg', extension: '.ogg', mimeType: 'audio/ogg' };
  }
  if (
    startsWithBytes(buffer, [0x49, 0x44, 0x33]) ||
    (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    return { ...base, format: 'mp3', extension: '.mp3', mimeType: 'audio/mpeg' };
  }
  if (
    startsWithBytes(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    buffer.length >= 12 &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return { ...base, format: 'wav', extension: '.wav', mimeType: 'audio/wav' };
  }
  if (startsWithBytes(buffer, [0x66, 0x4c, 0x61, 0x43])) {
    return { ...base, format: 'flac', extension: '.flac', mimeType: 'audio/flac' };
  }

  throw createInvalidPayloadError('Audio', describeUnexpectedPayload(buffer), base);
}

function detectAnimationPayload(buffer: Buffer, responseContentType = '') {
  const base = getBaseMetadata(buffer, responseContentType);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createInvalidPayloadError('Animation', 'the downloaded file is empty.', base);
  }

  if (buffer.length >= 8 && buffer.subarray(0, 8).toString('ascii') === '<roblox!') {
    return {
      ...base,
      format: 'rbxm-binary',
      extension: '.rbxm',
      mimeType: 'model/x-rbxm',
    };
  }

  const textSample = getTextSample(buffer);
  if (
    /^<roblox(?:\s|>)/i.test(textSample) ||
    (/^<\?xml\b/i.test(textSample) && /<roblox(?:\s|>)/i.test(textSample))
  ) {
    return {
      ...base,
      format: 'rbxmx',
      extension: '.rbxmx',
      mimeType: 'model/x-rbxm',
    };
  }

  throw createInvalidPayloadError('Animation', describeUnexpectedPayload(buffer), base);
}

function describeUnexpectedPayload(buffer: Buffer) {
  const sample = getTextSample(buffer).toLowerCase();
  if (!sample) return 'the downloaded file has no recognizable content.';
  if (/^<!doctype\s+html\b|^<html\b/.test(sample)) {
    return 'Roblox returned an HTML page instead of an asset file.';
  }
  if (/^[{[]/.test(sample)) {
    return 'Roblox returned JSON or structured text instead of an asset file.';
  }
  if (/^<\?xml\b|^<[a-z_:][^>]*>/i.test(sample)) {
    return 'Roblox returned XML that is not a Roblox asset file.';
  }
  return 'the file header is not a supported Roblox asset format.';
}

function inspectTransferPayload(buffer: Buffer, assetTypeName: string, responseContentType = '') {
  return assetTypeName === 'Audio'
    ? detectAudioPayload(buffer, responseContentType)
    : detectAnimationPayload(buffer, responseContentType);
}

export {
  detectAnimationPayload,
  detectAudioPayload,
  inspectTransferPayload,
};
