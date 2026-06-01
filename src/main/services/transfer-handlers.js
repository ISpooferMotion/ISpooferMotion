const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { DEVELOPER_MODE, buildRobloxCookieHeader } = require('./common');

const DOWNLOAD_DEFAULTS = Object.freeze({
  timeoutMs: 15_000,
  retries: 2,
  retryDelayMs: 2_000,
});

const MAX_UPLOAD_RATE_LIMIT_RETRIES = 5;
const MAX_UPLOAD_POLL_ATTEMPTS = 120;
const UPLOAD_POLL_INTERVAL_MS = 2_000;
const UPLOAD_START_FALLBACK_INTERVAL_MS = 1_100;
const ASSET_UPLOAD_URL = 'https://apis.roblox.com/assets/v1/assets';

let rateLimitUntil = 0;
let nextUploadStartAt = 0;
let uploadStartIntervalMs = UPLOAD_START_FALLBACK_INTERVAL_MS;
let uploadStartQueue = Promise.resolve();

// Per-replacement-name lock: prevents overlapping PATCH requests for the same
// asset, which causes Roblox to return
// "A newer version was created from a different request..."
const replacementLocks = new Map();

async function withReplacementLock(key, fn) {
  const previous = replacementLocks.get(key) || Promise.resolve();

  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });

  const next = previous.catch(() => {}).then(() => current);
  replacementLocks.set(key, next);

  await previous.catch(() => {});

  try {
    return await fn();
  } finally {
    release();
    if (replacementLocks.get(key) === next) {
      replacementLocks.delete(key);
    }
  }
}

function getErrorMessage(error, fallback = 'Unknown error') {
  return error instanceof Error ? error.message : String(error || fallback);
}

function getPositiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sendTransferUpdateSafe(sendTransferUpdate, payload) {
  if (typeof sendTransferUpdate !== 'function') return;

  try {
    sendTransferUpdate(payload);
  } catch (error) {
    if (DEVELOPER_MODE) {
      console.warn('[TRANSFER DEBUG] Failed to send transfer update:', getErrorMessage(error));
    }
  }
}

function setRateLimit(ms) {
  rateLimitUntil = Math.max(rateLimitUntil, Date.now() + ms);
}

async function waitRateLimit() {
  const waitMs = rateLimitUntil - Date.now();
  if (waitMs > 0) await delay(waitMs);
}

function updateUploadRateLimitFromHeaders(response) {
  const remaining = Number.parseInt(response?.headers?.get('x-ratelimit-remaining') || '', 10);
  const resetSeconds = Number.parseFloat(response?.headers?.get('x-ratelimit-reset') || '');
  if (!Number.isFinite(remaining) || !Number.isFinite(resetSeconds) || resetSeconds <= 0) return;

  if (remaining <= 2) {
    setRateLimit(Math.ceil(resetSeconds * 1000) + 250);
    return;
  }

  uploadStartIntervalMs = Math.max(
    250,
    Math.min(5_000, Math.ceil((resetSeconds * 1000) / Math.max(1, remaining - 2))),
  );
}

function waitUploadStartSlot() {
  const result = uploadStartQueue.catch(() => {}).then(async () => {
    await waitRateLimit();
    const waitMs = nextUploadStartAt - Date.now();
    if (waitMs > 0) await delay(waitMs);
    nextUploadStartAt = Date.now() + uploadStartIntervalMs;
  });
  uploadStartQueue = result.catch(() => {});
  return result;
}

async function removeFileIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT' && DEVELOPER_MODE) {
      console.warn(`[TRANSFER DEBUG] Failed to remove partial file: ${getErrorMessage(error)}`);
    }
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function sanitizeUploadName(name, fallback = 'asset') {
  const safeName = String(name || fallback)
    .replace(/[<>:"/\\|?*\r\n]/g, '_')
    .trim()
    .slice(0, 100);

  return safeName || fallback;
}

function getRetryAfterMs(response, attempt = 1) {
  const retryAfterSeconds = Number.parseInt(response?.headers?.get('retry-after'), 10);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(Math.max(retryAfterSeconds, 1), 60) * 1000;
  }
  const baseMs = 5000;
  const expMs = baseMs * Math.pow(1.5, attempt - 1);
  const safeMs = Math.min(expMs, 60000);
  return Math.floor(safeMs + Math.random() * 2000);
}

function shouldRetryDownload(error) {
  const message = getErrorMessage(error, '').toLowerCase();
  return (
    error?.name === 'AbortError' ||
    message.includes('aborted') ||
    message.includes('timeout') ||
    /\b50[0-9]\b/.test(message)
  );
}

function normalizeOperationUrl(operationPath) {
  if (!operationPath || typeof operationPath !== 'string') return null;

  const normalizedPath = operationPath.startsWith('assets/')
    ? operationPath
    : `assets/v1/${operationPath}`;

  return `https://apis.roblox.com/${normalizedPath}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DOWNLOAD_DEFAULTS.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForStreamEvent(stream, successEvent) {
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off(successEvent, onSuccess);
      stream.off('error', onError);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    stream.once(successEvent, onSuccess);
    stream.once('error', onError);
  });
}

async function writeResponseBodyToFile(
  response,
  filePath,
  transferId,
  totalSize,
  sendTransferUpdate,
  lastProgressRef,
) {
  if (!response.body) throw new Error('No response body was returned.');

  const reader = response.body.getReader();
  const fileStream = fsSync.createWriteStream(filePath);
  let receivedLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!fileStream.write(value)) {
        await waitForStreamEvent(fileStream, 'drain');
      }

      receivedLength += value.length;

      if (totalSize > 0) {
        const progress = Math.round((receivedLength / totalSize) * 100);
        if (progress > lastProgressRef.value) {
          sendTransferUpdateSafe(sendTransferUpdate, { id: transferId, progress });
          lastProgressRef.value = progress;
        }
      }
    }
  } catch (error) {
    fileStream.destroy(error);
    throw error;
  } finally {
    if (!fileStream.destroyed) fileStream.end();
  }

  await waitForStreamEvent(fileStream, 'finish');
  return receivedLength;
}

/**
 * Downloads an animation asset with progress reporting.
 */
async function downloadAnimationAssetWithProgress(
  url,
  robloxCookie,
  filePath,
  transferId,
  entryName,
  originalAssetId,
  sendTransferUpdate,
  placeId = null,
  options = {},
) {
  const cookieHeader = buildRobloxCookieHeader(robloxCookie);

  if (!cookieHeader) {
    const error = 'Missing or invalid ROBLOSECURITY cookie';
    sendTransferUpdateSafe(sendTransferUpdate, {
      id: transferId,
      status: 'error',
      error,
      progress: 0,
    });
    return { success: false, error };
  }

  const timeoutMs = getPositiveNumber(options.timeoutMs, DOWNLOAD_DEFAULTS.timeoutMs);
  const retries = getPositiveNumber(options.retries, DOWNLOAD_DEFAULTS.retries);
  const retryDelayMs = getPositiveNumber(options.retryDelayMs, DOWNLOAD_DEFAULTS.retryDelayMs);
  const suppressErrorUpdate = Boolean(options.suppressErrorUpdate);
  const lastProgressRef = { value: 0 };

  sendTransferUpdateSafe(sendTransferUpdate, {
    id: transferId,
    name: entryName,
    originalAssetId,
    status: 'processing',
    direction: 'download',
    progress: 0,
    error: null,
    size: 0,
  });

  if (DEVELOPER_MODE) {
    console.log(
      `[DOWNLOAD DEBUG] Starting download for "${entryName}" (Asset ID: ${originalAssetId})`,
    );
    console.log(`[DOWNLOAD DEBUG] PlaceId: ${placeId || 'not provided'}`);
    console.log(`[DOWNLOAD DEBUG] Target file: ${filePath}`);
  }

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const fetchHeaders = { Cookie: cookieHeader };
      if (placeId) {
        fetchHeaders['Roblox-Place-Id'] = String(placeId);
        fetchHeaders['User-Agent'] = 'RobloxStudio/WinInet';
        fetchHeaders['Roblox-Browser-Asset-Request'] = 'true';
      }

      const response = await fetchWithTimeout(
        url,
        {
          headers: fetchHeaders,
          redirect: 'follow',
        },
        timeoutMs,
      );

      if (!response.ok) {
        const detail = DEVELOPER_MODE
          ? `Failed to download asset: ${response.status} ${response.statusText} | Asset ID: ${originalAssetId} | PlaceId: ${placeId || 'N/A'}`
          : `Failed to download asset: ${response.status} ${response.statusText}`;
        throw new Error(detail);
      }

      const totalSize = Number(response.headers.get('content-length')) || 0;
      sendTransferUpdateSafe(sendTransferUpdate, { id: transferId, size: totalSize });

      const receivedLength = await writeResponseBodyToFile(
        response,
        filePath,
        transferId,
        totalSize,
        sendTransferUpdate,
        lastProgressRef,
      );

      if (lastProgressRef.value < 100 && totalSize > 0) {
        sendTransferUpdateSafe(sendTransferUpdate, { id: transferId, progress: 100 });
      }

      sendTransferUpdateSafe(sendTransferUpdate, {
        id: transferId,
        status: 'completed',
        progress: 100,
      });

      if (DEVELOPER_MODE) {
        console.log(`[DOWNLOAD DEBUG] Downloaded "${entryName}" (${receivedLength} bytes)`);
      }

      return { success: true, filePath };
    } catch (error) {
      const message = getErrorMessage(error);
      const canRetry = shouldRetryDownload(error) && attempt <= retries;

      await removeFileIfExists(filePath);

      if (DEVELOPER_MODE) {
        console.warn(
          `[DOWNLOAD DEBUG] Attempt ${attempt}/${retries + 1} failed for "${entryName}": ${message}${canRetry ? ' -> retrying' : ''}`,
        );
      }

      if (!canRetry) {
        if (!suppressErrorUpdate) {
          sendTransferUpdateSafe(sendTransferUpdate, {
            id: transferId,
            status: 'error',
            error: message,
            progress: lastProgressRef.value || 0,
          });
        }
        return { success: false, error: message };
      }

      await delay(retryDelayMs + Math.floor(Math.random() * 300));
    }
  }

  return { success: false, error: 'Download failed.' };
}

async function uploadAsset(
  fileBuffer,
  fileName,
  fileType,
  requestMetadata,
  apiKey,
  transferId,
  sendTransferUpdate,
  customMethod = 'POST',
  customUrl = ASSET_UPLOAD_URL,
) {
  let response = null;
  let responseData = null;

  for (let attempt = 0; attempt <= MAX_UPLOAD_RATE_LIMIT_RETRIES; attempt += 1) {
    const formData = new FormData();
    formData.append('request', JSON.stringify(requestMetadata));
    formData.append('fileContent', new Blob([fileBuffer], { type: fileType }), fileName);

    await waitUploadStartSlot();

    response = await fetch(customUrl, {
      method: customMethod,
      headers: { 'x-api-key': apiKey },
      body: formData,
    });
    updateUploadRateLimitFromHeaders(response);

    responseData = await readJsonResponse(response);

    if (response.status !== 429) break;

    if (attempt >= MAX_UPLOAD_RATE_LIMIT_RETRIES) {
      throw new Error(
        `Rate limit hit after ${MAX_UPLOAD_RATE_LIMIT_RETRIES} retries. Try again later.`,
      );
    }

    const waitMs = getRetryAfterMs(response, attempt + 1);
    if (DEVELOPER_MODE)
      console.log(`[UPLOAD DEBUG] Rate limited, pausing all slots for ${waitMs}ms`);
    sendTransferUpdateSafe(sendTransferUpdate, {
      id: transferId,
      status: 'processing',
      progress: 0,
    });
    setRateLimit(waitMs);
    await waitRateLimit();
  }

  if (!response) throw new Error('Upload did not produce a response.');

  if (!response.ok) {
    const responseText = JSON.stringify(responseData || {});
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `API key rejected (${response.status}). Make sure your key has Assets Read & Write permissions. Response: ${responseText}`,
      );
    }
    if (response.status >= 500) {
      throw new Error(`Server error (${response.status}). Response: ${responseText}`);
    }
    throw new Error(`Upload failed (Status: ${response.status}). Response: ${responseText}`);
  }

  return responseData;
}

function getAssetIdFromResponse(responseData) {
  return responseData?.response?.assetId || responseData?.response?.Id || null;
}

async function pollUploadOperation(
  responseData,
  apiKey,
  assetType,
  transferId,
  sendTransferUpdate,
) {
  const pollUrl = normalizeOperationUrl(responseData?.path);
  if (!pollUrl) return null;

  if (DEVELOPER_MODE) {
    console.log(`[UPLOAD DEBUG] Operation pending, polling: ${pollUrl}`);
  }

  for (let attempt = 1; attempt <= MAX_UPLOAD_POLL_ATTEMPTS; attempt += 1) {
    await delay(UPLOAD_POLL_INTERVAL_MS);

    const response = await fetch(pollUrl, {
      headers: { 'x-api-key': apiKey },
    });
    const pollData = await readJsonResponse(response);

    if (!response.ok) {
      if (response.status === 429) {
        if (DEVELOPER_MODE)
          console.log(
            `[UPLOAD DEBUG] Polling rate limited (429) on attempt ${attempt}, pausing...`,
          );
        const waitMs = getRetryAfterMs(response, attempt);
        await delay(waitMs);
        continue;
      }
      throw new Error(
        `Upload poll failed (${response.status}). Response: ${JSON.stringify(pollData || {})}`,
      );
    }

    if (DEVELOPER_MODE) {
      console.log(
        `[UPLOAD DEBUG] Poll attempt ${attempt}/${MAX_UPLOAD_POLL_ATTEMPTS}: done=${Boolean(pollData?.done)}`,
      );
    }

    if (!pollData?.done) continue;

    if (pollData.error) {
      throw new Error(
        `Roblox rejected the upload: ${pollData.error.message || JSON.stringify(pollData.error)}`,
      );
    }

    const assetId = getAssetIdFromResponse(pollData);
    if (assetId) {
      sendTransferUpdateSafe(sendTransferUpdate, {
        id: transferId,
        progress: 100,
        status: 'completed',
        newAssetId: String(assetId),
      });
      return String(assetId);
    }
  }

  throw new Error(`Upload timed out waiting for Roblox to process the ${assetType.toLowerCase()}.`);
}

/**
 * Publishes an animation or sound RBXM file to Roblox.
 */
async function publishAnimationRbxmWithProgress(
  filePath,
  name,
  cookie,
  csrfToken,
  groupId = null,
  transferId,
  sendTransferUpdate,
  assetTypeName = 'Animation',
  apiKey = null,
  userId = null,
  options = {},
) {
  let fileBuffer;

  try {
    fileBuffer = await fs.readFile(filePath);
  } catch (error) {
    const message = `File system error: ${getErrorMessage(error)}`;
    sendTransferUpdateSafe(sendTransferUpdate, {
      id: transferId,
      name,
      status: 'error',
      direction: 'upload',
      error: message,
    });
    return { success: false, error: message };
  }

  sendTransferUpdateSafe(sendTransferUpdate, {
    id: transferId,
    name,
    size: fileBuffer.length,
    status: 'processing',
    direction: 'upload',
    progress: 0,
    error: null,
  });

  const isAudio = assetTypeName === 'Audio';
  const assetType = isAudio ? 'Audio' : 'Animation';

  if (!apiKey) {
    const assetLabel = isAudio ? 'Sound' : 'Animation';
    const error = `${assetLabel} uploads require an Open Cloud API key. Go to create.roblox.com -> Open Cloud -> API Keys and create a key with Assets Read & Write permissions.`;
    sendTransferUpdateSafe(sendTransferUpdate, {
      id: transferId,
      status: 'error',
      error,
      progress: 0,
    });
    return { success: false, error };
  }

  const creator = groupId ? { groupId: String(groupId) } : { userId: String(userId) };
  const fileType = isAudio ? 'audio/ogg' : 'model/x-rbxm';
  const fileName = `${sanitizeUploadName(name)}.${isAudio ? 'ogg' : 'rbxm'}`;
  const requestMetadata = {
    assetType,
    displayName: String(name || 'Asset'),
    description: 'Placeholder',
    creationContext: { creator },
  };

  if (DEVELOPER_MODE) {
    console.log(`[UPLOAD DEBUG] Attempting ${assetType} upload for "${name}" via Open Cloud API`);
    console.log(`[UPLOAD DEBUG] Creator: ${JSON.stringify(creator)}`);
  }

  try {
    let method = 'POST';
    let url = ASSET_UPLOAD_URL;
    let existingId = null;

    if (options.replaceExisting) {
      const { findAssetByName } = require('./assets');

      const replacementLockKey = `${assetType}:${groupId || userId || 'user'}:${String(name).trim().toLowerCase()}`;

      return await withReplacementLock(replacementLockKey, async () => {
        existingId = await findAssetByName(cookie, isAudio ? 3 : 24, name, groupId);
        if (existingId) {
          if (isAudio) {
            if (options.onLog) {
              options.onLog(`[Replace] Found existing audio "${name}" (ID: ${existingId}). Audio cannot be patched, skipping upload...`, 'success');
            }
            sendTransferUpdateSafe(sendTransferUpdate, {
              id: transferId,
              progress: 100,
              status: 'completed',
              newAssetId: String(existingId),
            });
            return { success: true, assetId: String(existingId), replacedId: existingId };
          }

          if (DEVELOPER_MODE)
            console.log(
              `[UPLOAD DEBUG] Found existing asset ${existingId} for "${name}". Using PATCH.`,
            );
          method = 'PATCH';
          url = `https://apis.roblox.com/assets/v1/assets/${existingId}`;

          // Open Cloud PATCH does not allow assetType or creationContext
          delete requestMetadata.assetType;
          delete requestMetadata.creationContext;
          requestMetadata.assetId = String(existingId);

          if (options.onLog) {
            options.onLog(`[Replace] Found and overwriting existing animation "${name}" (ID: ${existingId})...`, 'warn');
          }
        }

        const responseData = await uploadAsset(
          fileBuffer,
          fileName,
          fileType,
          requestMetadata,
          apiKey,
          transferId,
          sendTransferUpdate,
          method,
          url,
        );

        if (responseData?.done && responseData.response) {
          const assetId = getAssetIdFromResponse(responseData);
          if (assetId) {
            sendTransferUpdateSafe(sendTransferUpdate, {
              id: transferId,
              progress: 100,
              status: 'completed',
              newAssetId: String(assetId),
            });
            return { success: true, assetId: String(assetId), replacedId: existingId };
          }
        }

        if (responseData?.path && !responseData.done) {
          const assetId = await pollUploadOperation(
            responseData,
            apiKey,
            assetType,
            transferId,
            sendTransferUpdate,
          );
          return { success: true, assetId, replacedId: existingId };
        }

        throw new Error(
          `Unexpected response from Open Cloud API: ${JSON.stringify(responseData || {})}`,
        );
      });
    }

    const responseData = await uploadAsset(
      fileBuffer,
      fileName,
      fileType,
      requestMetadata,
      apiKey,
      transferId,
      sendTransferUpdate,
      method,
      url,
    );

    if (responseData?.done && responseData.response) {
      const assetId = getAssetIdFromResponse(responseData);
      if (assetId) {
        sendTransferUpdateSafe(sendTransferUpdate, {
          id: transferId,
          progress: 100,
          status: 'completed',
          newAssetId: String(assetId),
        });
        return { success: true, assetId: String(assetId), replacedId: existingId };
      }
    }

    if (responseData?.path && !responseData.done) {
      const assetId = await pollUploadOperation(
        responseData,
        apiKey,
        assetType,
        transferId,
        sendTransferUpdate,
      );
      return { success: true, assetId, replacedId: existingId };
    }

    throw new Error(
      `Unexpected response from Open Cloud API: ${JSON.stringify(responseData || {})}`,
    );
  } catch (error) {
    const errorMsg = getErrorMessage(error, `Upload failed for "${name}" due to an unknown error.`);
    const isRateLimit = errorMsg.includes('429') || /rate limit/i.test(errorMsg);
    console.error(
      `[UPLOAD ERROR] ${assetType} upload failed${isRateLimit ? ' (RATE LIMIT)' : ''}: ${errorMsg}`,
    );
    sendTransferUpdateSafe(sendTransferUpdate, {
      id: transferId,
      status: 'error',
      error: errorMsg,
      progress: 0,
    });
    return { success: false, error: errorMsg };
  }
}

module.exports = {
  downloadAnimationAssetWithProgress,
  publishAnimationRbxmWithProgress,
};
