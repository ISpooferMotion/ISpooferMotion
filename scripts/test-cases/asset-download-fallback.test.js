'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { __private } = require('../../src/main/services/ipc-handlers');
const { __private: localhostPrivate } = require('../../src/main/services/localhost-plugin-server');

const {
  buildDirectAssetDownloadAttempts,
  buildDirectAssetDownloadUrls,
  extractBatchLocationError,
  getSpooferInputTypeMarker,
  getAssetMetadataFromDetails,
  getPlaceIdFromDownloadUrl,
  hasBatchAccessDeniedErrors,
  applyResolvedAssetMetadata,
  parseSpooferAssetLine,
  setBatchLocation,
  uniquePlaceIds,
  validateDownloadedAssetFile,
} = __private;

const {
  appendPlaceContextToLine,
  formatAssetsForInput,
  normalizeAssets,
} = localhostPrivate;

test('direct asset fallback keeps bare URLs free of place authorization context', () => {
  const attempts = buildDirectAssetDownloadAttempts('123456789', ['987654321']);

  assert.deepEqual(
    attempts.map((attempt) => attempt.placeId),
    ['987654321', '987654321', '987654321', null, null, null],
  );
  assert.equal(attempts.at(-3).url, 'https://assetdelivery.roblox.com/v1/asset?id=123456789');
  assert.equal(attempts.at(-2).url, 'https://assetdelivery.roblox.com/v1/asset/?id=123456789');
  assert.equal(attempts.at(-1).url, 'https://assetdelivery.roblox.com/v1/asset/?id=123456789&expectedAssetType=Animation');
});

test('direct asset fallback still includes plain retries when no places are known', () => {
  const attempts = buildDirectAssetDownloadAttempts('123456789', []);

  assert.equal(attempts.length, 3);
  assert.deepEqual(
    attempts.map((attempt) => attempt.placeId),
    [null, null, null],
  );
});

test('download URL place extraction only trusts the URL query string', () => {
  assert.equal(
    getPlaceIdFromDownloadUrl('https://assetdelivery.roblox.com/v1/asset?id=1&placeId=22'),
    '22',
  );
  assert.equal(getPlaceIdFromDownloadUrl('https://assetdelivery.roblox.com/v1/asset?id=1'), null);
  assert.equal(getPlaceIdFromDownloadUrl('not a url'), null);
});

test('direct asset fallback URL builder de-duplicates duplicate place IDs', () => {
  const urls = buildDirectAssetDownloadUrls('123456789', ['987654321', '987654321']);

  assert.equal(urls.length, 6);
});

test('batch access-denied detection handles Roblox message-only item errors', () => {
  assert.equal(
    hasBatchAccessDeniedErrors({
      requestId: '123456789',
      errors: [{ Message: 'User is not authorized to access Asset.' }],
    }),
    true,
  );
  assert.equal(
    extractBatchLocationError({
      requestId: '123456789',
      errors: [{ Message: 'User is not authorized to access Asset.' }],
    }),
    'User is not authorized to access Asset.',
  );
});

test('batch location map preserves a successful location over later access errors', () => {
  const locationsMap = {};

  setBatchLocation(locationsMap, {
    requestId: '123456789',
    locations: [{ location: 'https://rbxcdn.example/download' }],
  });
  setBatchLocation(locationsMap, {
    requestId: '123456789',
    errors: [{ code: 403, message: 'User is not authorized to access Asset.' }],
  });

  assert.equal(locationsMap['123456789'].locations[0].location, 'https://rbxcdn.example/download');
});

test('asset input parser accepts optional per-entry Studio place context', () => {
  assert.deepEqual(parseSpooferAssetLine('[123456789] [Lucas] [User:42] [Place:987654321],'), {
    entry: {
      id: '123456789',
      name: 'Lucas',
      creatorType: 'user',
      creatorId: '42',
      placeId: '987654321',
    },
  });
  assert.deepEqual(
    parseSpooferAssetLine('[234567890] [Doorbell] [Group:84] [Type:Sound] [Place:987654321],'),
    {
      entry: {
        id: '234567890',
        name: 'Doorbell',
        creatorType: 'group',
        creatorId: '84',
        assetTypeName: 'Audio',
        placeId: '987654321',
      },
    },
  );
  assert.deepEqual(parseSpooferAssetLine('[123456789] [Lucas] [Group:84],'), {
    entry: {
      id: '123456789',
      name: 'Lucas',
      creatorType: 'group',
      creatorId: '84',
    },
  });
});

test('asset metadata repair replaces stale pasted creator IDs before place lookup', () => {
  const entry = {
    id: '81514591369041',
    name: 'equip',
    creatorType: 'user',
    creatorId: '10998017190',
  };
  const metadata = getAssetMetadataFromDetails({
    Name: 'Lucas',
    AssetTypeId: 24,
    Creator: {
      Id: 10949827818,
      Name: '1679245',
      CreatorType: 'User',
    },
  });

  assert.deepEqual(metadata, {
    name: 'Lucas',
    assetTypeId: 24,
    assetTypeName: 'Animation',
    creatorType: 'user',
    creatorId: '10949827818',
  });
  assert.equal(applyResolvedAssetMetadata(entry, metadata, { forceName: false }), true);
  assert.deepEqual(entry, {
    id: '81514591369041',
    name: 'equip',
    creatorType: 'user',
    creatorId: '10949827818',
    assetTypeName: 'Animation',
  });
});

test('asset metadata repair also handles audio creator metadata shapes', () => {
  const entry = {
    id: '1843529637',
    name: 'sound-effect',
    creatorType: 'user',
    creatorId: '12345',
  };
  const metadata = getAssetMetadataFromDetails({
    name: 'Door Open',
    assetTypeId: 3,
    creator: {
      creatorTargetId: 987654321,
      type: 'Group',
    },
  });

  assert.deepEqual(metadata, {
    name: 'Door Open',
    assetTypeId: 3,
    assetTypeName: 'Audio',
    creatorType: 'group',
    creatorId: '987654321',
  });
  assert.equal(applyResolvedAssetMetadata(entry, metadata, { forceName: true }), true);
  assert.deepEqual(entry, {
    id: '1843529637',
    name: 'Door Open',
    creatorType: 'group',
    creatorId: '987654321',
    assetTypeName: 'Audio',
  });
});

test('place ID merging keeps scanned places before discovered places', () => {
  assert.deepEqual(uniquePlaceIds(['222', '0'], ['111', '222'], 333), ['222', '111', '333']);
});

test('localhost scan formatting carries payload place context into asset lines', () => {
  assert.equal(
    appendPlaceContextToLine('[123456789] [Lucas] [User:42],', '987654321'),
    '[123456789] [Lucas] [User:42],',
  );
  assert.equal(
    appendPlaceContextToLine('[123456789] [Lucas] [User:42] [Place:111],', '987654321'),
    '[123456789] [Lucas] [User:42] [Place:111],',
  );
  assert.equal(
    formatAssetsForInput([
      {
        assetId: '123456789',
        name: 'Lucas',
        creatorType: 'User',
        creatorId: '42000',
        placeId: '987654321',
      },
    ]),
    '[123456789] [Lucas] [User:42000],',
  );
  assert.deepEqual(
    normalizeAssets({ placeId: '987654321', assets: [{ assetId: '123456789', creatorId: '42000' }] }),
    [
      {
        assetId: '123456789',
        name: '123456789',
        creatorType: 'User',
        creatorId: '42000',
        placeId: '987654321',
      },
    ],
  );
});

test('localhost scan formatting includes an import type marker when kind is known', () => {
  assert.equal(
    formatAssetsForInput(
      [
        {
          assetId: '123456789',
          name: 'Doorbell',
          creatorType: 'User',
          creatorId: '42000',
        },
      ],
      'sound',
    ),
    '--[[ TYPE: SOUND ]]\n[123456789] [Doorbell] [User:42000] [Type:Sound],',
  );
  assert.equal(
    formatAssetsForInput(
      [
        {
          assetId: '123456789',
          name: 'Run',
          creatorType: 'User',
          creatorId: '42000',
          assetTypeName: 'Animation',
        },
        {
          assetId: '987654321',
          name: 'Doorbell',
          creatorType: 'User',
          creatorId: '42000',
          assetTypeName: 'Audio',
        },
      ],
      'mixed',
    ),
    '--[[ TYPE: MIXED ]]\n[123456789] [Run] [User:42000] [Type:Animation],\n[987654321] [Doorbell] [User:42000] [Type:Sound],',
  );
});

test('spoofer input type marker is detected independently of the saved mode toggle', () => {
  assert.equal(
    getSpooferInputTypeMarker('--[[ TYPE: SOUND ]]\n[123456789] [Doorbell] [User:42000],'),
    'sound',
  );
  assert.equal(
    getSpooferInputTypeMarker('--[[ TYPE: ANIMATION ]]\n[123456789] [Run] [User:42000],'),
    'animation',
  );
  assert.equal(getSpooferInputTypeMarker('[123456789] [Run] [User:42000],'), null);
});

test('download validation rejects HTML saved as an animation payload', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ispoofer-download-invalid-'));
  const filePath = path.join(directory, 'bad-animation.rbxm');
  await fs.writeFile(filePath, '<html>not an asset</html>');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    validateDownloadedAssetFile(filePath, 'Animation'),
    /Roblox returned an HTML page instead of an asset file/,
  );
});

test('download validation renames audio files to the detected extension', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ispoofer-download-audio-'));
  const filePath = path.join(directory, 'sound.ogg');
  await fs.writeFile(filePath, Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00]));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const result = await validateDownloadedAssetFile(filePath, 'Audio');

  assert.equal(result.filePath, path.join(directory, 'sound.mp3'));
  assert.equal(result.payloadMetadata.mimeType, 'audio/mpeg');
  assert.equal(await fs.stat(result.filePath).then((stats) => stats.isFile()), true);
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
});
