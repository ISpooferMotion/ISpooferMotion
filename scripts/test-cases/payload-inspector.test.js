'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  detectAnimationPayload,
  detectAudioPayload,
} = require('../../src/main/services/payload-inspector');

test('detects supported audio signatures and upload descriptors', () => {
  const cases = [
    [Buffer.from('OggS\0\0\0\0'), 'ogg', '.ogg', 'audio/ogg'],
    [Buffer.from('ID3\0\0\0\0'), 'mp3', '.mp3', 'audio/mpeg'],
    [Buffer.from([0xff, 0xfb, 0x90, 0x64]), 'mp3', '.mp3', 'audio/mpeg'],
    [Buffer.from('RIFF1234WAVEfmt '), 'wav', '.wav', 'audio/wav'],
    [Buffer.from('fLaC\0\0\0\0'), 'flac', '.flac', 'audio/flac'],
  ];

  for (const [buffer, format, extension, mimeType] of cases) {
    const metadata = detectAudioPayload(buffer);
    assert.equal(metadata.format, format);
    assert.equal(metadata.extension, extension);
    assert.equal(metadata.mimeType, mimeType);
  }
});

test('detects binary and XML Roblox animation payloads', () => {
  const binary = detectAnimationPayload(Buffer.from('<roblox!\x89\xff\r\n'));
  assert.equal(binary.format, 'rbxm-binary');

  const xml = detectAnimationPayload(
    Buffer.from('<?xml version="1.0" encoding="utf-8"?><roblox version="4"></roblox>'),
  );
  assert.equal(xml.format, 'rbxmx');
});

test('rejects empty, HTML, JSON, unknown XML, and unknown binary payloads locally', () => {
  const cases = [
    [Buffer.alloc(0), 'empty'],
    [Buffer.from('<!doctype html><html></html>'), 'HTML'],
    [Buffer.from('{"error":"denied"}'), 'JSON'],
    [Buffer.from('<?xml version="1.0"?><Error />'), 'XML'],
    [Buffer.from([0x01, 0x02, 0x03, 0x04]), 'header'],
  ];

  for (const [buffer, reason] of cases) {
    assert.throws(
      () => detectAnimationPayload(buffer),
      (error) =>
        error.code === 'INVALID_TRANSFER_PAYLOAD' &&
        error.nonRetryable === true &&
        error.message.includes(reason),
    );
  }
});
