'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { publishAnimationRbxmWithProgress } = require('../../src/main/services/transfer-handlers');

test('upload rejects invalid downloaded payloads before calling Open Cloud', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ispoofer-upload-invalid-'));
  const filePath = path.join(directory, 'bad.rbxm');
  await fs.writeFile(filePath, '<html>not an asset</html>');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch should not be called for invalid payloads');
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const result = await publishAnimationRbxmWithProgress(
    filePath,
    'BadPayload',
    'cookie',
    'csrf',
    null,
    'transfer-1',
    () => {},
    'Animation',
    'api-key',
    '12345',
  );

  assert.equal(result.success, false);
  assert.equal(result.nonRetryable, true);
  assert.match(result.error, /not uploadable/i);
  assert.equal(fetchCalled, false);
});

test('sound upload uses detected audio MIME type and extension', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ispoofer-upload-audio-'));
  const filePath = path.join(directory, 'sound.ogg');
  await fs.writeFile(filePath, Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00]));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const originalFetch = global.fetch;
  let capturedFile;
  let capturedRequest;
  global.fetch = async (_url, options = {}) => {
    capturedFile = options.body.get('fileContent');
    capturedRequest = JSON.parse(options.body.get('request'));
    return new Response(JSON.stringify({ done: true, response: { assetId: '999999' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const result = await publishAnimationRbxmWithProgress(
    filePath,
    'SoundPayload',
    'cookie',
    'csrf',
    null,
    'transfer-2',
    () => {},
    'Audio',
    'api-key',
    '12345',
  );

  assert.deepEqual(result, { success: true, assetId: '999999' });
  assert.equal(capturedRequest.assetType, 'Audio');
  assert.equal(capturedFile.type, 'audio/mpeg');
  assert.equal(capturedFile.name, 'SoundPayload.mp3');
});
