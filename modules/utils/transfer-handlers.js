// modules/utils/transfer-handlers.js
const path = require('path');
const fsSync = require('fs');
const fs = require('fs').promises;
const { DEVELOPER_MODE } = require('./common');
const { getCsrfToken } = require('./roblox-api');

const MAX_RATE_LIMIT_RETRIES = 4;

// Shared rate-limit gate for Open Cloud uploads.
// When any concurrent slot hits a 429, it sets this timestamp so all other
// slots pause before their next POST, preventing the thundering-herd retry loop.
let _rlUntil = 0;
function setRateLimit(ms) { _rlUntil = Math.max(_rlUntil, Date.now() + ms); }
async function waitRateLimit() {
  const wait = _rlUntil - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

// Open Cloud asset type + content type mapping
const OPEN_CLOUD_TYPE_MAP = {
  Animation: { assetType: 'Animation', contentType: 'model/x-rbxm',          fileName: 'animation.rbxm' },
  Audio:     { assetType: 'Audio',     contentType: 'audio/ogg',              fileName: 'audio.ogg'      },
  Sound:     { assetType: 'Audio',     contentType: 'audio/ogg',              fileName: 'audio.ogg'      },
  Image:     { assetType: 'Decal',     contentType: 'image/png',              fileName: 'image.png'      },
  Decal:     { assetType: 'Decal',     contentType: 'image/png',              fileName: 'image.png'      },
  Mesh:      { assetType: 'Mesh',      contentType: 'model/x-file-mesh-data',   fileName: 'mesh.mesh'    },
  Model:     { assetType: 'Mesh',      contentType: 'model/x-file-mesh-data',   fileName: 'mesh.mesh'    },
};

/**
 * Downloads an asset with progress reporting
 */
async function downloadAnimationAssetWithProgress(url, robloxCookie, filePath, transferId, entryName, originalAssetId, sendTransferUpdate, placeId = null, options = {}) {
  sendTransferUpdate({ id: transferId, name: entryName, originalAssetId: originalAssetId, status: 'processing', direction: 'download', progress: 0, error: null, size: 0 });
  if (DEVELOPER_MODE) {
    console.log(`[DOWNLOAD DEBUG] Starting download for "${entryName}" (Asset ID: ${originalAssetId})`);
    console.log(`[DOWNLOAD DEBUG] URL: ${url}`);
    console.log(`[DOWNLOAD DEBUG] PlaceId: ${placeId || 'not provided'}`);
    console.log(`[DOWNLOAD DEBUG] Target file: ${filePath}`);
  }

  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 15000;
  const retries = typeof options.retries === 'number' && options.retries > 0 ? options.retries : 2;
  const retryDelayMs = typeof options.retryDelayMs === 'number' && options.retryDelayMs > 0 ? options.retryDelayMs : 2000;
  let lastReportedProgress = 0;
  let fileStream = null;

  for (let attempt = 1; attempt <= (retries + 1); attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${robloxCookie}` }, redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) {
        const errorDetail = DEVELOPER_MODE
          ? `Failed to download asset: ${response.status} ${response.statusText} | Asset ID: ${originalAssetId} | PlaceId: ${placeId || 'N/A'} | URL: ${url}`
          : `Failed to download asset: ${response.status} ${response.statusText}`;
        throw new Error(errorDetail);
      }
      if (!response.body) throw new Error(`No response body for asset (ID: ${originalAssetId})`);

      const totalSize = Number(response.headers.get('content-length'));
      if (DEVELOPER_MODE) console.log(`[DOWNLOAD DEBUG] Content-Length: ${totalSize} bytes`);
      sendTransferUpdate({ id: transferId, size: isNaN(totalSize) ? 0 : totalSize });

      const reader = response.body.getReader();
      fileStream = fsSync.createWriteStream(filePath);
      let receivedLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(value);
        receivedLength += value.length;

        if (totalSize > 0) {
          const currentProgress = Math.round((receivedLength / totalSize) * 100);
          if (currentProgress > lastReportedProgress) {
            sendTransferUpdate({ id: transferId, progress: currentProgress });
            lastReportedProgress = currentProgress;
          }
        }
      }

      fileStream.end();
      await new Promise((resolve, reject) => {
        fileStream.on('finish', resolve);
        fileStream.on('error', (err) => reject(new Error(`File stream error: ${err.message}`)));
      });

      if (lastReportedProgress < 100 && totalSize > 0) sendTransferUpdate({ id: transferId, progress: 100 });
      sendTransferUpdate({ id: transferId, status: 'completed', progress: 100 });
      if (DEVELOPER_MODE) console.log(`[DOWNLOAD DEBUG] Successfully downloaded "${entryName}" (${receivedLength} bytes)`);
      return { success: true, filePath };
    } catch (error) {
      const msg = error && error.message ? error.message : 'unknown error';
      const isTimeout = error && (error.name === 'AbortError' || /aborted|timeout/i.test(msg));
      const shouldRetry = isTimeout || /\b5\d\d\b/.test(msg) || /Failed to download asset: (500|502|503|504)/.test(msg);

      try { if (fileStream) fileStream.end(); } catch {}
      try { if (fsSync.existsSync(filePath)) fsSync.unlinkSync(filePath); } catch {}

      if (DEVELOPER_MODE) console.warn(`[DOWNLOAD DEBUG] Attempt ${attempt}/${retries + 1} for "${entryName}" failed (${isTimeout ? 'timeout' : 'error'}): ${msg}${shouldRetry && attempt <= retries ? ' -> retrying' : ''}`);

      if (!shouldRetry || attempt > retries) {
        const errorMsg = DEVELOPER_MODE
          ? `[DOWNLOAD ERROR] "${entryName}" (Asset ID: ${originalAssetId}, PlaceId: ${placeId || 'N/A'}): ${msg}`
          : `Download error for ${entryName}: ${msg}`;
        console.error(errorMsg);
        sendTransferUpdate({ id: transferId, status: 'error', error: msg, progress: lastReportedProgress || 0 });
        return { success: false, error: msg };
      }

      const waitMs = isTimeout ? 5000 : (retryDelayMs + Math.floor(Math.random() * 300));
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

/**
 * Shared upload logic for all asset types via Open Cloud Assets API.
 * Handles rate-limit retries and async operation polling.
 */
const CONTENT_TYPE_EXT = {
  'model/x-file-mesh-data': '.mesh',
  'model/x-rbxm':           '.rbxm',
  'audio/ogg':              '.ogg',
  'image/png':              '.png',
};

function buildFileName(name, contentType, fallbackFileName) {
  const ext = CONTENT_TYPE_EXT[contentType] || require('path').extname(fallbackFileName) || '';
  const safe = (name || 'asset').replace(/[<>:"/\\|?*\r\n]/g, '_').substring(0, 100);
  return safe + ext;
}

async function uploadViaOpenCloud({ fileBuffer, contentType, fileName, assetType, name, groupId, userId, apiKey, transferId, sendTransferUpdate }) {
  if (!apiKey) {
    const errorMsg = `${assetType} uploads require an Open Cloud API key. Go to create.roblox.com → Open Cloud → API Keys, create a key with Assets Read & Write permissions, and paste it into the app.`;
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }

  const creatorObj = groupId ? { groupId: String(groupId) } : { userId: String(userId) };
  const requestMetadata = {
    assetType,
    displayName: name,
    description: 'Placeholder',
    creationContext: { creator: creatorObj },
  };

  const formFileName = buildFileName(name, contentType, fileName);
  if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG] Uploading "${name}" as ${assetType} via Open Cloud API (file: ${formFileName})`);

  let response, responseData;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const formData = new FormData();
    formData.append('request', JSON.stringify(requestMetadata));
    formData.append('fileContent', new Blob([fileBuffer], { type: contentType }), formFileName);

    await waitRateLimit();
    response = await fetch('https://apis.roblox.com/assets/v1/assets', {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: formData,
    });

    if (response.status === 429) {
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error(`Rate limit hit after ${MAX_RATE_LIMIT_RETRIES} retries. Wait a minute and try again.`);
      }
      const retryAfter = Math.min(parseInt(response.headers.get('retry-after') || '30', 10), 60);
      const jitter = Math.floor(Math.random() * 8000);
      if (DEVELOPER_MODE) console.log(`[UPLOAD] Rate limited on "${name}". Pausing all slots for ${retryAfter}s + ${jitter}ms jitter (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`);
      sendTransferUpdate({ id: transferId, status: 'processing', progress: 0 });
      setRateLimit(retryAfter * 1000 + jitter);
      await waitRateLimit();
      continue;
    }

    responseData = await response.json();

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`API key unauthorized (${response.status}). Verify your Open Cloud API key has Assets Read & Write permissions.`);
      } else if (response.status >= 500) {
        throw new Error(`Server error (${response.status}). Response: ${JSON.stringify(responseData)}`);
      } else {
        throw new Error(`Upload failed (Status: ${response.status}). Response: ${JSON.stringify(responseData)}`);
      }
    }

    break;
  }

  // Synchronous success
  if (responseData.done && responseData.response) {
    const assetId = responseData.response.assetId || responseData.response.Id;
    if (assetId) {
      sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: String(assetId) });
      return { success: true, assetId: String(assetId) };
    }
  }

  // Async operation — poll until done
  // Roblox may return path as "operations/{id}" (short form) or "assets/v1/operations/{id}".
  // The correct poll endpoint is always https://apis.roblox.com/assets/v1/operations/{id}.
  if (responseData.path && !responseData.done) {
    const operationPath = responseData.path;
    const normalizedPath = operationPath.startsWith('assets/')
      ? operationPath
      : `assets/v1/${operationPath}`;
    const pollUrl = `https://apis.roblox.com/${normalizedPath}`;
    if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG] Polling operation: ${pollUrl} (raw path: ${operationPath})`);
    for (let attempt = 1; attempt <= 30; attempt++) {
      await new Promise(r => setTimeout(r, 1000));
      const pollResp = await fetch(pollUrl, {
        headers: { 'x-api-key': apiKey },
      });
      const pollData = await pollResp.json();
      if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG] Poll attempt ${attempt}/30, done=${pollData.done}`);
      if (pollData.done && pollData.response) {
        const assetId = pollData.response.assetId || pollData.response.Id;
        if (assetId) {
          sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: String(assetId) });
          return { success: true, assetId: String(assetId) };
        }
      }
      if (pollData.done && pollData.error) {
        throw new Error(`Roblox rejected the ${assetType.toLowerCase()} upload: ${pollData.error.message || JSON.stringify(pollData.error)}`);
      }
    }
    throw new Error(`Upload timed out waiting for Roblox to process the ${assetType.toLowerCase()}.`);
  }

  throw new Error(`Unexpected response from Open Cloud API: ${JSON.stringify(responseData)}`);
}

/**
 * Publishes an animation RBXM file via Open Cloud Assets API.
 */
async function publishAnimationRbxmWithProgress(filePath, name, cookie, csrfToken, groupId = null, transferId, sendTransferUpdate, assetTypeName = 'Animation', apiKey = null, userId = null) {
  let fileBuffer, fileSize = 0;
  try {
    fileBuffer = await fs.readFile(filePath);
    fileSize = fileBuffer.length;
  } catch (fileError) {
    sendTransferUpdate({ id: transferId, name, status: 'error', direction: 'upload', error: `File system error: ${fileError.message}` });
    return { success: false, error: `File system error: ${fileError.message}` };
  }

  sendTransferUpdate({ id: transferId, name, size: fileSize, status: 'processing', direction: 'upload', progress: 0, error: null });

  try {
    return await uploadViaOpenCloud({
      fileBuffer, contentType: 'model/x-rbxm', fileName: 'animation.rbxm',
      assetType: 'Animation', name, groupId, userId, apiKey, transferId, sendTransferUpdate,
    });
  } catch (err) {
    const errorMsg = err.message || `Upload failed for "${name}" due to an unknown error.`;
    console.error(`[UPLOAD ERROR - ANIMATION] ${errorMsg}`, err.cause || err);
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }
}

/**
 * Publishes an audio file via Open Cloud Assets API.
 */
async function publishAudioWithProgress(filePath, name, cookie, csrfToken, groupId = null, transferId, sendTransferUpdate, apiKey = null, userId = null) {
  let fileBuffer, fileSize = 0;
  try {
    fileBuffer = await fs.readFile(filePath);
    fileSize = fileBuffer.length;
  } catch (fileError) {
    sendTransferUpdate({ id: transferId, name, status: 'error', direction: 'upload', error: `File system error: ${fileError.message}` });
    return { success: false, error: `File system error: ${fileError.message}` };
  }

  sendTransferUpdate({ id: transferId, name, size: fileSize, status: 'processing', direction: 'upload', progress: 0, error: null });

  try {
    return await uploadViaOpenCloud({
      fileBuffer, contentType: 'audio/ogg', fileName: 'audio.ogg',
      assetType: 'Audio', name, groupId, userId, apiKey, transferId, sendTransferUpdate,
    });
  } catch (err) {
    const errorMsg = err.message || `Upload failed for "${name}" due to an unknown error.`;
    const isRateLimit = errorMsg.includes('429') || errorMsg.includes('Rate limit');
    console.error(`[UPLOAD ERROR - AUDIO] ${errorMsg}${isRateLimit ? ' (RATE LIMIT)' : ''}`, err.cause || err);
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }
}

/**
 * Detects whether a buffer is an RBXM model file or a raw Roblox mesh binary.
 * RBXM (binary): starts with the magic bytes "<roblox!" (0x3C 0x72 0x6F 0x62 0x6C 0x6F 0x78 0x21)
 * RBXMX (XML):   starts with "<roblox " as ASCII text
 * Raw mesh:       starts with "version " as ASCII text
 */
function detectMeshFileFormat(buffer) {
  if (!buffer || buffer.length < 8) return 'unknown';
  // Binary RBXM magic: <roblox!
  if (buffer[0] === 0x3C && buffer[1] === 0x72 && buffer[2] === 0x6F &&
      buffer[3] === 0x62 && buffer[4] === 0x6C && buffer[5] === 0x6F &&
      buffer[6] === 0x78 && buffer[7] === 0x21) return 'rbxm';
  const header = buffer.slice(0, 20).toString('ascii');
  if (header.startsWith('<roblox')) return 'rbxm';
  if (header.startsWith('version ')) return 'mesh';
  return 'unknown';
}

/**
 * Uploads a raw Roblox .mesh binary via the legacy endpoint.
 * Tries data.roblox.com first, falls back to www.roblox.com.
 * Refreshes CSRF token and retries once on 403.
 */
async function uploadMeshLegacy({ fileBuffer, name, groupId, cookie, transferId, sendTransferUpdate }) {
  const params = new URLSearchParams({ name: name || 'Mesh' });
  if (groupId) params.set('groupId', String(groupId));
  const queryString = params.toString();

  const endpoints = [
    `https://data.roblox.com/ide/publish/UploadNewMesh?${queryString}`,
    `https://www.roblox.com/ide/publish/UploadNewMesh?${queryString}`,
  ];

  let token;
  try {
    token = await getCsrfToken(cookie);
  } catch (err) {
    throw new Error(`Failed to get CSRF token for mesh upload: ${err.message}`);
  }

  let lastError;
  for (const url of endpoints) {
    if (DEVELOPER_MODE) console.log(`[MESH UPLOAD] POST ${url}`);

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cookie': `.ROBLOSECURITY=${cookie}`,
          'X-CSRF-Token': token,
          'User-Agent': 'Roblox/WinInet',
        },
        body: fileBuffer,
      });

      const responseText = await response.text();
      if (DEVELOPER_MODE) console.log(`[MESH UPLOAD] ${url} → ${response.status}: ${responseText.substring(0, 120)}`);

      // Stale CSRF — refresh and retry once
      if (response.status === 403 && attempt === 0) {
        try {
          token = await getCsrfToken(cookie);
          continue;
        } catch (err) {
          lastError = new Error(`CSRF refresh failed: ${err.message}`);
          break;
        }
      }

      if (!response.ok) {
        lastError = new Error(`Legacy mesh upload failed (${response.status}): ${responseText.substring(0, 200)}`);
        break;
      }

      const assetId = responseText.trim();
      if (!assetId || isNaN(Number(assetId))) {
        lastError = new Error(`Unexpected response from mesh upload endpoint: ${responseText.substring(0, 200)}`);
        break;
      }

      sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: assetId });
      return { success: true, assetId };
    }
  }

  throw lastError || new Error('All legacy mesh upload endpoints failed');
}

/**
 * Router — selects the correct upload path for each asset type.
 * Mesh/Model: RBXM files → Open Cloud; raw .mesh binaries → legacy endpoint.
 * All others: Open Cloud Assets API.
 */
async function publishAssetWithProgress(filePath, name, cookie, csrfToken, groupId = null, transferId, sendTransferUpdate, assetType, userId = null, apiKey = null, originalAssetId = null) {
  let fileBuffer, fileSize = 0;
  try {
    fileBuffer = await fs.readFile(filePath);
    fileSize = fileBuffer.length;
  } catch (fileError) {
    sendTransferUpdate({ id: transferId, name, status: 'error', direction: 'upload', error: `File system error: ${fileError.message}` });
    return { success: false, error: `File system error: ${fileError.message}` };
  }

  sendTransferUpdate({ id: transferId, name, size: fileSize, status: 'processing', direction: 'upload', progress: 0, error: null });

  if (assetType === 'Mesh' || assetType === 'Model') {
    if (DEVELOPER_MODE) console.log(`[MESH] Uploading "${name}" as Mesh via Open Cloud API`);
    try {
      return await uploadViaOpenCloud({
        fileBuffer,
        contentType: 'model/x-file-mesh-data',
        fileName: 'mesh.mesh',
        assetType: 'Mesh',
        name, groupId, userId, apiKey, transferId, sendTransferUpdate,
      });
    } catch (err) {
      const errorMsg = err.message || `Mesh upload failed for "${name}".`;
      console.error(`[UPLOAD ERROR - MESH] ${errorMsg}`);
      sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
      return { success: false, error: errorMsg };
    }
  }

  const typeInfo = OPEN_CLOUD_TYPE_MAP[assetType];
  if (!typeInfo) {
    const errorMsg = `Unsupported asset type for upload: ${assetType}`;
    sendTransferUpdate({ id: transferId, name, status: 'error', direction: 'upload', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }

  try {
    return await uploadViaOpenCloud({
      fileBuffer,
      contentType: typeInfo.contentType,
      fileName: typeInfo.fileName,
      assetType: typeInfo.assetType,
      name, groupId, userId, apiKey, transferId, sendTransferUpdate,
    });
  } catch (err) {
    const errorMsg = err.message || `Upload failed for "${name}" due to an unknown error.`;
    const isRateLimit = errorMsg.includes('429') || errorMsg.includes('Rate limit');
    const isContentInvalid = /content is invalid/i.test(errorMsg);

    // If Roblox says the animation content is invalid, the asset was likely mislabelled
    // as Animation in the source game but is actually a Model/Mesh — retry as Model.
    if (typeInfo.assetType === 'Animation' && isContentInvalid && originalAssetId && cookie) {
      if (DEVELOPER_MODE) console.log(`[UPLOAD] "${name}" rejected as Animation, re-fetching as raw mesh via v1/asset (id: ${originalAssetId})`);
      try {
        const meshResp = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${originalAssetId}`, {
          headers: { 'Cookie': `.ROBLOSECURITY=${cookie}`, 'User-Agent': 'Roblox/WinInet' },
          redirect: 'follow',
        });
        if (!meshResp.ok) throw new Error(`v1/asset returned ${meshResp.status}`);
        const meshBuffer = Buffer.from(await meshResp.arrayBuffer());
        if (!meshBuffer.toString('ascii', 0, 8).startsWith('version')) throw new Error('v1/asset did not return raw mesh data');
        return await uploadViaOpenCloud({
          fileBuffer: meshBuffer,
          contentType: 'model/x-file-mesh-data',
          fileName: 'mesh.mesh',
          assetType: 'Mesh',
          name, groupId, userId, apiKey, transferId, sendTransferUpdate,
        });
      } catch (meshErr) {
        const meshErrMsg = meshErr.message || `Mesh fallback upload failed for "${name}".`;
        console.error(`[UPLOAD ERROR - MESH FALLBACK] ${meshErrMsg}`);
        sendTransferUpdate({ id: transferId, status: 'error', error: meshErrMsg, progress: 0 });
        return { success: false, error: meshErrMsg };
      }
    }

    console.error(`[UPLOAD ERROR - ${assetType.toUpperCase()}] ${errorMsg}${isRateLimit ? ' (RATE LIMIT)' : ''}`, err.cause || err);
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }
}

module.exports = {
  downloadAnimationAssetWithProgress,
  publishAnimationRbxmWithProgress,
  publishAudioWithProgress,
  publishAssetWithProgress,
};
