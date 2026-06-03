'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  markNonRetryableError,
  retryAsync,
} = require('../../src/main/services/common');

test('retryAsync stops immediately for deterministic failures', async () => {
  let attempts = 0;

  await assert.rejects(
    retryAsync(() => {
      attempts += 1;
      throw markNonRetryableError(new Error('Failed to parse file'), 'ROBLOX_PARSE_REJECTED');
    }, 3, 1),
    /Failed to parse file/,
  );

  assert.equal(attempts, 1);
});

test('retryAsync continues retrying transient failures', async () => {
  let attempts = 0;

  const result = await retryAsync(() => {
    attempts += 1;
    if (attempts < 3) throw new Error('temporary server failure');
    return 'ok';
  }, 3, 1);

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});
