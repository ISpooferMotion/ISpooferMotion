'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  clearTransferDiagnostics,
  recordFailedTransferDiagnostic,
} = require('../../src/main/services/transfer-diagnostics');

test('failed transfer diagnostics retain only the newest ten records and clear cleanly', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ispoofer-diagnostics-'));
  const payloadPath = path.join(directory, 'source.ogg');
  await fs.writeFile(payloadPath, Buffer.from('OggS\0\0\0\0'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  for (let index = 0; index < 12; index += 1) {
    await recordFailedTransferDiagnostic(
      {
        filePath: payloadPath,
        assetId: index,
        assetMode: index % 2 === 0 ? 'Audio' : 'Animation',
        payloadMetadata: {
          format: 'ogg',
          extension: '.ogg',
          mimeType: 'audio/ogg',
          byteSize: 8,
        },
        responseContentType: 'audio/ogg',
        sourceUrl: 'https://assetdelivery.roblox.com/v2/asset',
        failureStage: 'upload-roblox-rejected',
        error: new Error('Failed to parse file'),
      },
      directory,
    );
  }

  let entries = await fs.readdir(directory, { withFileTypes: true });
  assert.equal(entries.filter((entry) => entry.isDirectory()).length, 10);

  const newestMetadata = JSON.parse(
    await fs.readFile(
      path.join(
        directory,
        entries
          .filter((entry) => entry.isDirectory())
          .sort()
          .at(-1).name,
        'metadata.json',
      ),
      'utf8',
    ),
  );
  assert.equal(newestMetadata.sourceHostname, 'assetdelivery.roblox.com');
  assert.equal(newestMetadata.responseContentType, 'audio/ogg');
  assert.equal('cookie' in newestMetadata, false);
  assert.equal('apiKey' in newestMetadata, false);

  await clearTransferDiagnostics(directory);
  entries = await fs.readdir(directory);
  assert.deepEqual(entries, []);
});
