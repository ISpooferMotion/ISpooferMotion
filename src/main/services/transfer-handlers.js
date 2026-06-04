'use strict';

const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { DEVELOPER_MODE } = require('./common');

// --- Upload configuration ---

const DOWNLOAD_DEFAULTS = Object.freeze({
  timeoutMs: 15_000,
  retries: 2,
  retryDelayMs: 2_000,
});

const MAX_UPLOAD_RATE_LIMIT_RETRIES = 10000;
const MAX_UPLOAD_POLL_ATTEMPTS = 120;
const UPLOAD_POLL_INTERVAL_MS = 2_000;
const UPLOAD_START_FALLBACK_INTERVAL_MS = 100;
const ASSET_UPLOAD_URL = 'https://apis.roblox.com/assets/v1/assets';

// --- Global upload rate limiting ---
// All upload slots share a single queue and rate-limit window so we respect
// Roblox's per-key limits across concurrent workers.

let rateLimitUntil = 0;
let nextUploadStartAt = 0;
let uploadStartIntervalMs = UPLOAD_START_FALLBACK_INTERVAL_MS;
let uploadStartQueue = Promise.resolve();

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
  const result = uploadStartQueue
    .catch(() => {})
    .then(async () => {
      await waitRateLimit();
      const waitMs = nextUploadStartAt - Date.now();
      if (waitMs > 0) await delay(waitMs);
      nextUploadStartAt = Date.now() + uploadStartIntervalMs;
    });
  uploadStartQueue = result.catch(() => {});
  return result;
}

// --- Small utilities ---

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
    return Math.min(Math.max(retryAfterSeconds, 1), 300) * 1000;
  }
  const baseMs = 30000;
  const expMs = baseMs * Math.pow(1.5, attempt - 1);
  return Math.floor(Math.min(expMs, 120000) + Math.random() * 2000);
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

function getAssetIdFromResponse(responseData) {
  return responseData?.response?.assetId || responseData?.response?.Id || null;
}

// --- Fetch helpers ---

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = DOWNLOAD_DEFAULTS.timeoutMs,
  request = fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const providedSignal = options.signal;
  const abortListener = () => controller.abort();
  if (providedSignal) {
    providedSignal.addEventListener('abort', abortListener);
    if (providedSignal.aborted) controller.abort();
  }

  try {
    return await request(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (providedSignal) providedSignal.removeEventListener('abort', abortListener);
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// --- File stream helpers ---

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

async function removeFileIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT' && DEVELOPER_MODE) {
      console.warn(`[TRANSFER DEBUG] Failed to remove partial file: ${getErrorMessage(error)}`);
    }
  }
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

// --- Upload internals ---

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
  abortSignal = null,
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
      signal: abortSignal,
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

async function pollUploadOperation(
  responseData,
  apiKey,
  assetType,
  transferId,
  sendTransferUpdate,
) {
  const pollUrl = normalizeOperationUrl(responseData?.path);
  if (!pollUrl) return null;

  if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG] Operation pending, polling: ${pollUrl}`);

  for (let attempt = 1; attempt <= MAX_UPLOAD_POLL_ATTEMPTS; attempt += 1) {
    await delay(UPLOAD_POLL_INTERVAL_MS);

    const response = await fetch(pollUrl, { headers: { 'x-api-key': apiKey } });
    const pollData = await readJsonResponse(response);

    if (!response.ok) {
      if (response.status === 429) {
        if (DEVELOPER_MODE) {
          console.log(
            `[UPLOAD DEBUG] Polling rate limited (429) on attempt ${attempt}, pausing...`,
          );
        }
        await delay(getRetryAfterMs(response, attempt));
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

// --- Public: Download ---

/**
 * Downloads an animation or sound asset from Roblox with progress reporting.
 */
async function downloadAnimationAssetWithProgress(
  url,
  robloxSession,
  filePath,
  transferId,
  entryName,
  originalAssetId,
  sendTransferUpdate,
  placeId = null,
  options = {},
) {
  const cookieHeader = robloxSession.getCookieHeader();

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
      const fetchHeaders = {};
      if (placeId) {
        fetchHeaders['Roblox-Place-Id'] = String(placeId);
        fetchHeaders['User-Agent'] = 'RobloxStudio/WinInet';
        fetchHeaders['Roblox-Browser-Asset-Request'] = 'false';
      }

      const response = await fetchWithTimeout(
        url,
        { headers: fetchHeaders, redirect: 'follow', signal: options.abortSignal },
        timeoutMs,
        robloxSession.fetch.bind(robloxSession),
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

// --- Public: Upload (animation / sound via Open Cloud) ---

/**
 * Publishes an animation or sound RBXM file to Roblox via the Open Cloud Assets API.
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
    const responseData = await uploadAsset(
      fileBuffer,
      fileName,
      fileType,
      requestMetadata,
      apiKey,
      transferId,
      sendTransferUpdate,
      'POST',
      ASSET_UPLOAD_URL,
      options.abortSignal,
    );

    // Fast path: Roblox processed the upload synchronously.
    if (responseData?.done && responseData.response) {
      const assetId = getAssetIdFromResponse(responseData);
      if (assetId) {
        sendTransferUpdateSafe(sendTransferUpdate, {
          id: transferId,
          progress: 100,
          status: 'completed',
          newAssetId: String(assetId),
        });
        return { success: true, assetId: String(assetId) };
      }
    }

    // Slow path: Roblox is processing async - poll until done.
    if (responseData?.path && !responseData.done) {
      const assetId = await pollUploadOperation(
        responseData,
        apiKey,
        assetType,
        transferId,
        sendTransferUpdate,
      );
      return { success: true, assetId };
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
