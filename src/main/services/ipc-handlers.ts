'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { app, dialog, ipcMain, shell, Notification, nativeImage } = require('electron');
const {
  DEVELOPER_MODE,
  buildRobloxCookieHeader,
  clearDownloadsDirectory,
  retryAsync,
  sanitizeFilename,
} = require('./common');
const {
  getPlaceIdFromCreator,
  getPlaceSuggestionsFromCreator,
  getPlaceSuggestionByPlaceId,
  getPlaceIdsFromAllUserContext,
} = require('./assets');
const { getCookieFromAutoDetect, getAuthenticatedUserId, readResponseText } = require('./auth');
const {
  downloadAnimationAssetWithProgress,
  publishAnimationRbxmWithProgress,
} = require('./transfer-handlers');
const { loadJobs, saveJobRecord, deleteJobRecord } = require('./jobs');
const { saveSession, loadSession, clearSession } = require('./session');
const { createRobloxSession } = require('./roblox-session');
  savePlaceIdCache,
  pruneExpiredEntries,
  getCachedPlaceIds,
  recordSuccessfulPlaceId,
  evictPlaceId,
} = require('./place-id-cache');
const { inspectTransferPayload } = require('./payload-inspector');
const {
  pauseSpoofer,
  resumeSpoofer,
  cancelSpoofer,
  resetRunControls,
  checkCancelled,
  checkPaused,
  getAbortSignal,
} = require('./ProcessManager');
const { pushReplacement } = require('./localhost-plugin-server');
const { buildFinalUploadName } = require('./replacement-utils');

let batchRateLimitUntil = 0;
let batchNextRequestAt = 0;
let batchRequestIntervalMs = 100;
let spooferRunActive = false;
let profileSecretsWriteQueue = Promise.resolve();

function setBatchRateLimit(ms) {
  batchRateLimitUntil = Math.max(batchRateLimitUntil, Date.now() + ms);
}

async function waitBatchRateLimit() {
  const waitMs = batchRateLimitUntil - Date.now();
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function waitBatchRequestSlot() {
  await waitBatchRateLimit();
  const waitMs = batchNextRequestAt - Date.now();
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
  batchNextRequestAt = Date.now() + batchRequestIntervalMs;
}

function updateBatchRateLimitFromHeaders(response) {
  const remaining = Number.parseInt(response?.headers?.get('x-ratelimit-remaining') || '', 10);
  const resetSeconds = Number.parseFloat(response?.headers?.get('x-ratelimit-reset') || '');
  if (!Number.isFinite(remaining) || !Number.isFinite(resetSeconds) || resetSeconds <= 0) return;

  if (remaining <= 2) {
    setBatchRateLimit(Math.ceil(resetSeconds * 1000) + 250);
    return;
  }

  batchRequestIntervalMs = Math.max(
    50,
    Math.min(5_000, Math.ceil((resetSeconds * 1000) / Math.max(1, remaining - 2))),
  );
}

function getBatchRetryAfterMs(response, attempt = 1) {
  const retryAfterSeconds = parseInt(response?.headers?.get('retry-after') || '0', 10);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  const baseMs = 15000;
  const expMs = baseMs * Math.pow(2, attempt - 1);
  return Math.floor(expMs + Math.random() * 2000);
}

function normalizePayload(value) {
  return value && typeof value === 'object' ? value : {};
}

function canOpenExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function resetIpcChannel(channel, mode = 'listener') {
  if (mode === 'handler') {
    try {
      ipcMain.removeHandler(channel);
    } catch {}
    return;
  }
  ipcMain.removeAllListeners(channel);
}

function onIpc(channel, listener) {
  resetIpcChannel(channel);
  ipcMain.on(channel, listener);
}

function handleIpc(channel, handler) {
  resetIpcChannel(channel, 'handler');
  ipcMain.handle(channel, handler);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((entry) => path.normalize(entry)))];
}

function showDesktopNotification(title, body) {
  try {
    if (!Notification.isSupported()) return false;
    const iconName = process.platform === 'win32' ? 'app_icon.ico' : 'app_icon.png';
    const rawIconPath = path.join(__dirname, '..', 'src', 'assets', iconName);
    const iconPath = app.isPackaged
      ? rawIconPath.replace('app.asar', 'app.asar.unpacked')
      : rawIconPath;
    new Notification({
      title: title || 'ISpooferMotion',
      body: body || '',
      icon: nativeImage.createFromPath(iconPath),
    }).show();
    return true;
  } catch (error) {
    if (DEVELOPER_MODE) console.warn('Failed to show notification', error);
    return false;
  }
}

function spawnDetached(filePath, args = []) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(filePath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve(true);
    });
  });
}

const runWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let index = 0;
  let cancelled = false;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      if (cancelled) break;
      try {
        checkCancelled();
        await checkPaused();
      } catch (err) {
        if (
          err.message === 'Operation cancelled by user' ||
          err.message === 'Operation cancelled'
        ) {
          cancelled = true;
          break;
        }
        throw err;
      }
      const current = index++;
      if (current >= items.length) break;
      try {
        results[current] = await worker(items[current]);
      } catch (err) {
        if (
          err.message === 'Operation cancelled by user' ||
          err.message === 'Operation cancelled'
        ) {
          cancelled = true;
          break;
        }
        throw err;
      }
    }
  });
  await Promise.all(workers);
  return results.filter((r) => r !== undefined);
};

function getBatchLocationErrors(loc) {
  return Array.isArray(loc?.errors) ? loc.errors : [];
}

function getBatchLocationErrorMessage(error) {
  if (!error || typeof error !== 'object') return String(error || '');
  return error.Message || error.message || JSON.stringify(error) || '';
}

function hasBatchLocationSuccess(loc) {
  return Array.isArray(loc?.locations) && loc.locations.some((location) => location?.location);
}

function hasBatchAccessDeniedErrors(loc) {
  return getBatchLocationErrors(loc).some((error) => {
    const status = Number(error?.code || error?.Code || error?.status || error?.statusCode || 0);
    const message = getBatchLocationErrorMessage(error);
    return (
      status === 403 || /\b403\b|not authorized|unauthorized|forbidden|permission/i.test(message)
    );
  });
}

function setBatchLocation(locationsMap, loc) {
  if (!loc?.requestId) return;
  const existing = locationsMap[loc.requestId];
  if (hasBatchLocationSuccess(existing) && !hasBatchLocationSuccess(loc)) return;
  locationsMap[loc.requestId] = loc;
}

function extractBatchLocationError(loc) {
  if (!loc) return 'No location in batch response';
  const errors = getBatchLocationErrors(loc);
  if (errors.length === 0) return 'No locations in batch response';

  return getBatchLocationErrorMessage(errors[0]) || 'Unknown batch error';
}

function buildDirectAssetDownloadUrls(assetId, placeIds = [], isSoundMode = false) {
  const encodedAssetId = encodeURIComponent(String(assetId));
  const expectedAssetType = isSoundMode ? 'Audio' : 'Animation';
  const urls = new Set();

  for (const placeId of placeIds) {
    if (!placeId) continue;
    const encodedPlaceId = encodeURIComponent(String(placeId));
    urls.add(
      `https://assetdelivery.roblox.com/v1/asset?id=${encodedAssetId}&placeId=${encodedPlaceId}`,
    );
    urls.add(
      `https://assetdelivery.roblox.com/v1/asset/?id=${encodedAssetId}&placeId=${encodedPlaceId}`,
    );
    urls.add(
      `https://assetdelivery.roblox.com/v1/asset/?id=${encodedAssetId}&expectedAssetType=${expectedAssetType}&placeId=${encodedPlaceId}`,
    );
  }

  urls.add(`https://assetdelivery.roblox.com/v1/asset?id=${encodedAssetId}`);
  urls.add(`https://assetdelivery.roblox.com/v1/asset/?id=${encodedAssetId}`);
  urls.add(
    `https://assetdelivery.roblox.com/v1/asset/?id=${encodedAssetId}&expectedAssetType=${expectedAssetType}`,
  );

  return [...urls];
}

function getPlaceIdFromDownloadUrl(url) {
  try {
    return new URL(url).searchParams.get('placeId') || null;
  } catch {
    return null;
  }
}

function buildDirectAssetDownloadAttempts(assetId, placeIds = [], isSoundMode = false) {
  return buildDirectAssetDownloadUrls(assetId, placeIds, isSoundMode).map((url) => ({
    url,
    placeId: getPlaceIdFromDownloadUrl(url),
  }));
}

function getCleanAssetName(value, assetId) {
  const name = String(value || '').trim();
  if (!name) return '';
  if (/^unknown$/i.test(name)) return '';
  if (assetId && name === String(assetId)) return '';
  return name;
}

function shouldRefreshAssetName(entry, force = false) {
  if (force) return true;
  return !getCleanAssetName(entry?.name, entry?.id);
}

function getAssetNameFromDetails(data) {
  if (!data || typeof data !== 'object') return '';

  const candidates = [
    data.Name,
    data.name,
    data.assetName,
    data.displayName,
    data.asset?.Name,
    data.asset?.name,
  ];

  for (const candidate of candidates) {
    const name = getCleanAssetName(candidate);
    if (name) return name;
  }

  return '';
}

function getAssetCreatorFromDetails(data) {
  if (!data || typeof data !== 'object') return null;

  const creator = data.Creator || data.creator || data.asset?.Creator || data.asset?.creator || {};
  const creatorId = extractNumericId(
    creator.Id ||
      creator.id ||
      creator.CreatorTargetId ||
      creator.creatorTargetId ||
      creator.creatorId ||
      data.creatorId ||
      data.CreatorId,
  );
  if (!creatorId || creatorId === '1') return null;

  const rawType = String(
    creator.CreatorType ||
      creator.creatorType ||
      creator.Type ||
      creator.type ||
      data.creatorType ||
      data.CreatorType ||
      '',
  ).toLowerCase();

  return {
    creatorType: rawType.includes('group') ? 'group' : 'user',
    creatorId,
  };
}

function getAssetMetadataFromDetails(data) {
  const creator = getAssetCreatorFromDetails(data);
  const assetTypeId = data?.AssetTypeId || data?.assetTypeId || data?.asset?.AssetTypeId || null;
  return {
    name: getAssetNameFromDetails(data),
    assetTypeId,
    assetTypeName: normalizeAssetTypeName(assetTypeId),
    ...(creator || {}),
  };
}

function applyResolvedAssetMetadata(entry, metadata, options = {}) {
  if (!entry || !metadata) return false;

  const forceName = Boolean(options.forceName);
  let changed = false;
  const resolvedName = getCleanAssetName(metadata.name, entry.id);
  if (resolvedName && (forceName || shouldRefreshAssetName(entry))) {
    if (entry.name !== resolvedName) changed = true;
    entry.name = resolvedName;
  }

  if (metadata.creatorId && metadata.creatorType) {
    const creatorType = metadata.creatorType === 'group' ? 'group' : 'user';
    const creatorId = String(metadata.creatorId);
    if (entry.creatorType !== creatorType || entry.creatorId !== creatorId) {
      entry.creatorType = creatorType;
      entry.creatorId = creatorId;
      changed = true;
    }
  }

  const assetTypeName = getAssetTypeNameFromMetadata(metadata);
  if (assetTypeName && entry.assetTypeName !== assetTypeName) {
    entry.assetTypeName = assetTypeName;
    changed = true;
  }

  return changed;
}

async function fetchAssetMetadata(assetId, robloxSession) {
  const encodedAssetId = encodeURIComponent(String(assetId));
  const headers = {
    'User-Agent': 'RobloxStudio/WinInet',
  };

  const urls = [
    `https://economy.roblox.com/v2/assets/${encodedAssetId}/details`,
    `https://api.roblox.com/marketplace/productinfo?assetId=${encodedAssetId}`,
  ];

  for (const url of urls) {
    try {
      const response = await robloxSession.fetch(url, { headers });
      if (!response.ok) continue;
      const data = await response.json();
      const metadata = getAssetMetadataFromDetails(data);
      if (metadata.name || metadata.creatorId) return metadata;
    } catch (err) {
      if (DEVELOPER_MODE) {
        console.warn(`(Dev) Failed to resolve metadata for asset ${assetId}: ${err.message}`);
      }
    }
  }

  return null;
}

async function resolveAssetEntryMetadata(entries, robloxSession, options = {}) {
  const { force = false } = options;
  const entriesToResolve = entries.filter((entry) => entry?.id);
  if (entriesToResolve.length === 0) return 0;

  let resolvedCount = 0;
  await runWithConcurrency(
    entriesToResolve,
    Math.min(entriesToResolve.length, 8),
    async (entry) => {
      const metadata = await fetchAssetMetadata(entry.id, robloxSession);
      if (!metadata) return;

      const oldName = entry.name;
      const oldCreator = `${entry.creatorType}:${entry.creatorId}`;
      const changed = applyResolvedAssetMetadata(entry, metadata, {
        forceName: force || shouldRefreshAssetName(entry, force),
      });
      if (!changed) return;

      resolvedCount += 1;

      if (DEVELOPER_MODE) {
        const newCreator = `${entry.creatorType}:${entry.creatorId}`;
        if (oldName !== entry.name) {
          console.log(
            `(Dev) Resolved ${getAssetKindLabel(entry.assetTypeName).toLowerCase()} name for ${entry.id}: "${entry.name}"`,
          );
        }
        if (oldCreator !== newCreator) {
          console.log(
            `(Dev) Resolved ${getAssetKindLabel(entry.assetTypeName).toLowerCase()} creator for ${entry.id}: ${oldCreator} -> ${newCreator}`,
          );
        }
      }
    },
  );

  return resolvedCount;
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.name === 'SyntaxError') {
      const backupPath = `${filePath}.invalid-${Date.now()}.bak`;
      await fs.rename(filePath, backupPath).catch(() => {});
      console.warn(`Failed to parse JSON at ${filePath}. Moved corrupt file to ${backupPath}.`);
    }
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  try {
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    if (!['EACCES', 'EPERM', 'EEXIST'].includes(err?.code)) {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
      throw err;
    }

    await fs.copyFile(tmpPath, filePath);
    await fs.rm(tmpPath, { force: true }).catch(() => {});
  }
}

function getProfileSecretsPath() {
  return path.join(app.getPath('userData'), 'profile-secrets.json');
}

function migrateProfileSecrets(allSecrets) {
  if (allSecrets && !allSecrets.profiles) {
    const oldProfiles = { ...allSecrets };
    delete oldProfiles.activeProfileId;
    return {
      activeProfileId: 'default',
      profiles:
        Object.keys(oldProfiles).length > 0
          ? oldProfiles
          : {
              default: {
                name: 'Default Profile',
                cookie: '',
                apiKey: '',
                groupId: '',
                concurrent: true,
              },
            },
    };
  }
  if (!allSecrets || !allSecrets.profiles) {
    return {
      activeProfileId: 'default',
      profiles: {
        default: {
          name: 'Default Profile',
          cookie: '',
          apiKey: '',
          groupId: '',
          concurrent: true,
        },
      },
    };
  }
  return allSecrets;
}

async function loadProfileSecrets() {
  const allSecrets = await readJsonFile(getProfileSecretsPath(), {});
  const migrated = migrateProfileSecrets(allSecrets);
  if (!migrated.profiles || typeof migrated.profiles !== 'object') migrated.profiles = {};
  if (Object.keys(migrated.profiles).length === 0) {
    migrated.profiles.default = {
      name: 'Default Profile',
      cookie: '',
      apiKey: '',
      groupId: '',
      concurrent: true,
    };
  }
  if (!migrated.activeProfileId || !migrated.profiles[migrated.activeProfileId]) {
    migrated.activeProfileId = Object.keys(migrated.profiles)[0];
  }
  return migrated;
}

function normalizeProfileSecrets(secrets) {
  const profile = normalizePayload(secrets);
  const normalized = {
    name: String(profile.name || 'Unnamed Profile'),
    cookie: typeof profile.cookie === 'string' ? profile.cookie : '',
    apiKey: typeof profile.apiKey === 'string' ? profile.apiKey.trim() : '',
    groupId: typeof profile.groupId === 'string' ? profile.groupId.replace(/\D/g, '') : '',
  };

  for (const [key, value] of Object.entries(profile)) {
    if (key === 'profileId') continue;
    if (normalized[key] === undefined) normalized[key] = value;
  }

  return normalized;
}

function queueProfileSecretsWrite(operation) {
  const result = profileSecretsWriteQueue.catch(() => {}).then(operation);
  profileSecretsWriteQueue = result.catch(() => {});
  return result;
}

async function saveProfileSecretsUnlocked(data) {
  const payload = normalizePayload(data);
  const allSecrets = await loadProfileSecrets();

  if (payload.action === 'setActive') {
    const requestedId = String(payload.profileId || '');
    if (!allSecrets.profiles[requestedId]) {
      throw new Error(`Profile "${requestedId}" does not exist.`);
    }
    allSecrets.activeProfileId = requestedId;
  } else if (payload.action === 'saveProfile') {
    const pId = String(payload.profileId || `profile_${Date.now()}`);
    allSecrets.profiles[pId] = normalizeProfileSecrets(payload.secrets);
    if (!allSecrets.activeProfileId) allSecrets.activeProfileId = pId;
  } else if (payload.action === 'patchProfile') {
    const pId = String(payload.profileId || allSecrets.activeProfileId || 'default');
    const existing = allSecrets.profiles[pId] || {
      name: 'Unnamed Profile',
      cookie: '',
      apiKey: '',
      groupId: '',
    };
    allSecrets.profiles[pId] = normalizeProfileSecrets({
      ...existing,
      ...normalizePayload(payload.secrets),
    });
    if (!allSecrets.activeProfileId) allSecrets.activeProfileId = pId;
  } else if (payload.action === 'deleteProfile') {
    delete allSecrets.profiles[payload.profileId];
    if (allSecrets.activeProfileId === payload.profileId) {
      const remaining = Object.keys(allSecrets.profiles);
      allSecrets.activeProfileId = remaining.length > 0 ? remaining[0] : null;
    }
  } else if (payload.profileId) {
    const pId = String(payload.profileId || 'default');
    allSecrets.profiles[pId] = normalizeProfileSecrets({
      ...(allSecrets.profiles[pId] || {}),
      ...normalizePayload(payload.secrets || payload),
    });
  }

  await writeJsonFile(getProfileSecretsPath(), allSecrets);
  return allSecrets;
}

function saveProfileSecrets(data) {
  return queueProfileSecretsWrite(() => saveProfileSecretsUnlocked(data));
}

async function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const { net } = require('electron');
    const req = net.request({ url, ...options });
    req.on('response', (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getRobloxProfile(context) {
  if (!context) return null;
  let cookie = context.cookie;
  if (!cookie && context.autoDetect) {
    cookie = await getCookieFromAutoDetect();
  }
  if (!cookie) return null;
  const groupId = context.groupId ? String(context.groupId).trim() : null;

  try {
    const userResp = await fetchJson('https://users.roblox.com/v1/users/authenticated', {
      headers: { Cookie: buildRobloxCookieHeader(cookie) },
    });
    if (!userResp || !userResp.id) return null;
    const userId = userResp.id;
    const username = userResp.name || userResp.displayName;

    const avatarResp = await fetchJson(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`,
    );
    const avatarUrl = avatarResp?.data?.[0]?.imageUrl || '';

    let groupInfo = null;
    if (groupId) {
      try {
        const gResp = await fetchJson(`https://groups.roblox.com/v1/groups/${groupId}`);
        const gAvatarResp = await fetchJson(
          `https://thumbnails.roblox.com/v1/groups/icons?groupIds=${groupId}&size=150x150&format=Png&isCircular=true`,
        );

        groupInfo = {
          id: groupId,
          name: gResp.name,
          iconUrl: gAvatarResp?.data?.[0]?.imageUrl || '',
        };
      } catch {
      }
    }

    return {
      user: { id: userId, name: username, avatarUrl },
      group: groupInfo,
    };
  } catch {
    return null;
  }
}

function extractNumericId(input) {
  return String(input || '').match(/\d+/)?.[0] || '';
}

function parsePlaceLookupInput(input, explicitType) {
  const raw = String(input || '').trim();
  const compact = raw.replace(/[,\s]+/g, ' ');
  const lower = compact.toLowerCase();
  const requestedType = String(explicitType || '').toLowerCase();

  if (requestedType === 'place' || lower.includes('/games/') || lower.includes('place')) {
    const placeId = extractNumericId(compact);
    if (!placeId) throw new Error('Enter a numeric Place ID or Roblox game URL.');
    return { lookupType: 'place', placeId };
  }

  const id = extractNumericId(compact);
  let creatorType = requestedType === 'group' || requestedType === 'user' ? requestedType : '';

  if (!creatorType) {
    if (lower.includes('group') || lower.startsWith('g:')) creatorType = 'group';
    else if (lower.includes('user') || lower.startsWith('u:')) creatorType = 'user';
  }

  if (!id) {
    throw new Error('Enter a numeric User ID, Group ID, Place ID, or Roblox game URL.');
  }
  if (!creatorType) {
    creatorType = 'place';
  }
  if (creatorType === 'user' && id === '1') {
    throw new Error('User ID 1 is ignored by design.');
  }

  return { lookupType: 'creator', creatorType, creatorId: id };
}

async function detectOpenCloudApiKeyOwner(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) {
    return { ok: false, ownerUserId: null, message: 'API key is required to detect owner.' };
  }

  try {
    const dummyBuffer = Buffer.from([0]);
    const formData = new FormData();
    formData.append(
      'request',
      JSON.stringify({
        assetType: 'Audio',
        displayName: 'ownership-probe',
        description: 'probe',

        creationContext: { creator: { userId: '1' } },
      }),
    );
    formData.append('fileContent', new Blob([dummyBuffer], { type: 'audio/ogg' }), 'probe.ogg');

    const response = await fetch('https://apis.roblox.com/assets/v1/assets', {
      method: 'POST',
      headers: { 'x-api-key': key },
      body: formData,
    });
    const text = await readResponseText(response, 1000);

    if (DEVELOPER_MODE) {
      console.log(`[OWNER DETECT] Probe response status=${response.status} body=${text}`);
    }

    const match = text.match(/User\s+(\d+)\s+is\s+unauthorized/i);
    if (match && match[1]) {
      return {
        ok: true,
        ownerUserId: match[1],
        message: `Detected API key owner: user ${match[1]}.`,
      };
    }

    if (response.status === 401) {
      return {
        ok: false,
        ownerUserId: null,
        message: 'API key was rejected by Roblox; cannot detect owner.',
      };
    }

    return {
      ok: false,
      ownerUserId: null,
      message: `Could not detect API key owner (Roblox returned ${response.status}). Enter the user ID manually.`,
    };
  } catch (err) {
    return {
      ok: false,
      ownerUserId: null,
      message: `Could not reach Roblox to detect API key owner: ${err.message}.`,
    };
  }
}

async function validateOpenCloudApiKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) {
    return {
      ok: false,
      code: 'missing',
      message: 'Open Cloud API key is required.',
    };
  }
  if (/\s/.test(key) || key.length < 20) {
    return {
      ok: false,
      code: 'format',
      message:
        'API key format looks invalid. Paste the full key from Creator Dashboard without spaces or line breaks.',
    };
  }

  try {
    const response = await fetch('https://apis.roblox.com/assets/v1/assets/0', {
      headers: { 'x-api-key': key },
    });
    const body = await readResponseText(response, 300);

    if (response.status === 401) {
      return {
        ok: false,
        code: 'invalid',
        message:
          'API key was rejected by Roblox. It may be invalid, expired, revoked, moderated, or copied incorrectly.',
      };
    }
    if (response.status === 403) {
      return {
        ok: false,
        code: 'permission',
        message:
          'API key was accepted but lacks Assets API access. Add asset:read and asset:write permissions, then save the key again.',
      };
    }
    if (response.status === 404 || response.status === 400 || response.ok) {
      return {
        ok: true,
        code: 'validated',
        message:
          'API key was accepted for the Assets API. Upload write permission will also be checked during upload.',
      };
    }

    return {
      ok: true,
      code: 'unchecked',
      message: `Could not fully validate API key right now (Roblox returned ${response.status}${body ? `: ${body}` : ''}). The key was saved and upload will report any permission errors.`,
    };
  } catch (err) {
    return {
      ok: true,
      code: 'network',
      message: `Could not reach Roblox to validate the API key: ${err.message}. The key was saved and will be checked during upload.`,
    };
  }
}

function normalizeSpooferInputLine(line) {
  return (
    String(line || '')
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\u2060]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
  );
}

function isSpooferOutputMetadataLine(line) {
  const trimmed = normalizeSpooferInputLine(line);
  if (!trimmed) return true;
  if (/^--/.test(trimmed)) return true;
  if (/^COPY THE CONTENTS OF THIS SCRIPT/i.test(trimmed)) return true;
  if (/^Generated by ISpooferMotion/i.test(trimmed)) return true;

  const withoutKnownMarkers = trimmed
    .replace(/--\[\[/g, '')
    .replace(/--\]\]/g, '')
    .replace(/\bTYPE\s*:\s*(SOUND|ANIMATION|MIXED)\b/gi, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\s,\u00A0]+/g, '')
    .replace(/[-_[\]{}()*=;:|/\\]+/g, '');

  return withoutKnownMarkers === '';
}

function getSpooferInputTypeMarker(text) {
  const source = String(text || '');
  const hasSoundMarker = /\bTYPE\s*:\s*SOUND\b/i.test(source);
  const hasAnimationMarker = /\bTYPE\s*:\s*ANIMATION\b/i.test(source);
  if (/\bTYPE\s*:\s*(MIXED|BOTH)\b/i.test(source)) return null;
  if (hasSoundMarker && !hasAnimationMarker) return 'sound';
  if (hasAnimationMarker && !hasSoundMarker) return 'animation';
  return null;
}

function normalizeAssetTypeName(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('sound') || text.includes('audio') || text === '3') return 'Audio';
  if (text.includes('anim') || text === '24') return 'Animation';
  return '';
}

function getAssetTypeNameFromMetadata(metadata) {
  return (
    normalizeAssetTypeName(metadata?.assetTypeName || metadata?.assetType) ||
    normalizeAssetTypeName(metadata?.assetTypeId)
  );
}

function getEntryAssetTypeName(entry, fallback = 'Animation') {
  return normalizeAssetTypeName(entry?.assetTypeName || entry?.assetType) || fallback;
}

function getAssetKindLabel(assetTypeName) {
  return getEntryAssetTypeName({ assetTypeName }) === 'Audio' ? 'Sound' : 'Animation';
}

function summarizeAssetTypes(entries) {
  const audio = entries.filter((entry) => getEntryAssetTypeName(entry) === 'Audio').length;
  const animations = entries.length - audio;
  if (audio > 0 && animations > 0) return `${animations} animation(s), ${audio} sound(s)`;
  if (audio > 0) return `${audio} sound(s)`;
  return `${animations} animation(s)`;
}

function normalizePlaceContextId(value) {
  const id = extractNumericId(value);
  return id && id !== '0' ? id : '';
}

function uniquePlaceIds(...groups) {
  const seen = new Set();
  const ids = [];

  for (const group of groups) {
    const values = Array.isArray(group) ? group : [group];
    for (const value of values) {
      const id = normalizePlaceContextId(value);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

function parseSpooferAssetLine(trimmedLine) {
  const line = String(trimmedLine || '').replace(/,?\s*$/, '');
  const tokens = [...line.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim());
  const tokenText = [...line.matchAll(/\[([^\]]+)\]/g)].map((match) => match[0]).join('');
  const leftovers = line.replace(/\[([^\]]+)\]/g, '').trim();

  if (tokens.length < 3 || leftovers || tokenText.length === 0) {
    return {
      error:
        'Expected [assetId] [name] [User:123] or [Group:123], optionally followed by [Type:Sound] and [Place:123].',
    };
  }

  const id = tokens[0];
  const name = tokens[1];
  const third = tokens[2];
  let creatorType;
  let creatorId;

  if (!/^\d+$/.test(id)) {
    return { error: 'Asset ID must be numeric.' };
  }
  if (/^user/i.test(third)) {
    creatorType = 'user';
    creatorId = third.substring(4).replace(/[^0-9]/g, '');
  } else if (/^group/i.test(third)) {
    creatorType = 'group';
    creatorId = third.substring(5).replace(/[^0-9]/g, '');
  } else {
    return { error: 'Creator must start with User or Group.' };
  }
  if (!creatorId) {
    return { error: 'Creator ID must be numeric.' };
  }
  if (creatorType === 'user' && creatorId === '1') {
    return { error: 'User ID 1 is ignored.' };
  }

  let placeId = '';
  let assetTypeName = '';
  for (const extraToken of tokens.slice(3)) {
    if (/^place/i.test(extraToken)) {
      placeId = normalizePlaceContextId(extraToken);
      if (!placeId) {
        return { error: 'Place ID must be numeric.' };
      }
    } else if (/^(type|assettype|kind)/i.test(extraToken)) {
      assetTypeName = normalizeAssetTypeName(extraToken);
      if (!assetTypeName) {
        return { error: 'Type must be Sound, Audio, or Animation.' };
      }
    } else {
      return { error: 'Extra fields must be Type:Sound, Type:Animation, or Place:123.' };
    }
  }

  return {
    entry: {
      id,
      name,
      creatorType,
      creatorId,
      ...(assetTypeName ? { assetTypeName } : {}),
      ...(placeId ? { placeId } : {}),
    },
  };
}

async function validateDownloadedAssetFile(filePath, assetTypeName) {
  const fileBuffer = await fs.readFile(filePath);
  const payloadMetadata = inspectTransferPayload(fileBuffer, assetTypeName);
  const currentExtension = path.extname(filePath).toLowerCase();
  if (payloadMetadata.extension && payloadMetadata.extension !== currentExtension) {
    const basePath = currentExtension ? filePath.slice(0, -currentExtension.length) : filePath;
    const renamedPath = `${basePath}${payloadMetadata.extension}`;
    await fs.rm(renamedPath, { force: true });
    await fs.rename(filePath, renamedPath);
    return { filePath: renamedPath, payloadMetadata };
  }
  return { filePath, payloadMetadata };
}

/**
 * Registers all IPC handlers for main process
 */
function registerIpcHandlers(
  getMainWindowFn,
  sendTransferUpdate,
  sendSpooferResultToRenderer,
  sendStatusMessage,
  sendSpooferLog,
  sendSpooferProgress,
) {
  onIpc('window-minimize', () => getMainWindowFn()?.minimize());
  onIpc('window-close', () => getMainWindowFn()?.close());

  handleIpc('get-app-version', () => {
    try {
      return app.getVersion();
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to get app version:', err);
      return '0.0.0';
    }
  });

  handleIpc('load-profile-secrets', () => loadProfileSecrets());
  handleIpc('save-profile-secrets', (_event, data) => saveProfileSecrets(data));
  handleIpc('get-roblox-profile', (_event, context) => getRobloxProfile(context));
  handleIpc('validate-opencloud-api-key', async (_event, apiKey) => {
    const validation = await validateOpenCloudApiKey(apiKey);

    if (validation.ok) {
      try {
        const owner = await detectOpenCloudApiKeyOwner(apiKey);
        if (owner.ok && owner.ownerUserId) {
          validation.ownerUserId = owner.ownerUserId;
        }
      } catch {}
    }
    return validation;
  });

  handleIpc('detect-opencloud-api-key-owner', async (_event, apiKey) =>
    detectOpenCloudApiKeyOwner(apiKey),
  );
  handleIpc('search-place-ids', async (_event, payload) => {
    const context = normalizePayload(payload);
    const lookup = parsePlaceLookupInput(context.creatorId || context.input, context.creatorType);
    const maxPlaceIds = Number.parseInt(context.maxPlaceIds, 10) || 10;
    let cookie = context.cookie;

    if (lookup.lookupType === 'place') {
      if (context.autoDetect && !cookie) {
        cookie = await getCookieFromAutoDetect();
      }

      const place = await getPlaceSuggestionByPlaceId(lookup.placeId, cookie);
      const warnings = place.warning ? [place.warning] : [];
      const message = place.verified
        ? `Verified place ${place.placeId}${place.name ? ` (${place.name})` : ''}. Selected it as the override place ID.`
        : `Using place ${place.placeId} as an override. Roblox could not verify it${place.warning ? `: ${place.warning}` : '.'}`;

      return {
        creatorType: 'place',
        requestedCreatorType: 'place',
        creatorId: '',
        placeId: place.placeId,
        places: [place],
        warnings,
        message,
        usedCookie: Boolean(cookie),
      };
    }

    const { creatorType, creatorId } = lookup;
    if (context.autoDetect && !cookie) {
      cookie = await getCookieFromAutoDetect(creatorType === 'user' ? creatorId : null);
    }

    const primary = await getPlaceSuggestionsFromCreator(
      creatorType,
      creatorId,
      cookie,
      maxPlaceIds,
    );
    const warnings = [...(primary.errors || [])];
    let places = primary.places || [];
    let resolvedCreatorType = creatorType;

    if (places.length === 0 && context.tryAlternateType !== false) {
      const alternateType = creatorType === 'group' ? 'user' : 'group';
      if (!(alternateType === 'user' && creatorId === '1')) {
        const alternate = await getPlaceSuggestionsFromCreator(
          alternateType,
          creatorId,
          cookie,
          maxPlaceIds,
        );
        warnings.push(
          ...(alternate.errors || []).map((message) => `${alternateType} fallback ${message}`),
        );
        if (alternate.places?.length) {
          places = alternate.places;
          resolvedCreatorType = alternateType;
          warnings.push(
            `No ${creatorType}-owned places were found, but ${alternate.places.length} ${alternateType}-owned place(s) matched the same ID.`,
          );
        }
      }
    }

    let message;
    if (places.length === 0) {
      const ownerLabel = creatorType === 'group' ? 'Group ID' : 'User ID';
      message = `No places found for that ${ownerLabel}. Check the ID, try the other owner type, paste a game URL, or use Override place ID if the experience is private.`;
      if (!cookie) {
        message +=
          ' Add a Roblox cookie or enable Auto detect cookie to include places visible only to your account.';
      }
    } else if (resolvedCreatorType !== creatorType) {
      message = `Found ${places.length} place(s), but under ${resolvedCreatorType} ownership instead of ${creatorType}.`;
    } else {
      message = `Found ${places.length} place${places.length === 1 ? '' : 's'}.`;
    }

    return {
      creatorType: resolvedCreatorType,
      requestedCreatorType: creatorType,
      creatorId,
      places,
      warnings,
      message,
      usedCookie: Boolean(cookie),
    };
  });
  handleIpc('open-data-folder', async () => {
    try {
      await shell.openPath(app.getPath('userData'));
      return true;
    } catch (e) {
      if (DEVELOPER_MODE) console.warn('Failed to open data folder', e);
      return false;
    }
  });

  handleIpc('uninstall-app', async () => {
    try {
      if (process.platform === 'win32') {
        const uninstallerPaths = uniquePaths([
          path.join(path.dirname(process.execPath), 'Uninstall ISpooferMotion.exe'),
          path.join(process.resourcesPath, '..', 'Uninstall ISpooferMotion.exe'),
        ]);

        for (const uninstallerPath of uninstallerPaths) {
          if (!(await pathExists(uninstallerPath))) continue;
          try {
            await spawnDetached(uninstallerPath);
            app.quit();
            return { ok: true, message: 'Uninstaller started.' };
          } catch (err) {
            return {
              ok: false,
              message: `Could not start the Windows uninstaller: ${err.message}`,
            };
          }
        }

        return {
          ok: false,
          message:
            'The Windows uninstaller was not found. This usually means the app is running from an unpacked build or the install folder is incomplete.',
        };
      }

      const userDataPath = app.getPath('userData');
      await fs.rm(userDataPath, { recursive: true, force: true });
      app.quit();
      return { ok: true, message: 'App data removed.' };
    } catch (e) {
      if (DEVELOPER_MODE) console.warn('Failed to uninstall app', e);
      return { ok: false, message: e.message || 'Failed to uninstall app.' };
    }
  });

  handleIpc('get-jobs', async () => {
    return await loadJobs();
  });

  handleIpc('delete-job', async (_event, jobId) => {
    await deleteJobRecord(jobId);
    return true;
  });

  handleIpc('push-to-studio', async (_event, text) => {
    try {
      const safeText = String(text || '').trim();
      if (!safeText) return { ok: false, error: 'No output text provided.' };
      pushReplacement(safeText);
      const pairPattern = /(\d{5,})\s*=\s*(\d{5,})/g;
      let count = 0;
      let m;
      while ((m = pairPattern.exec(safeText))) {
        if (m[1] !== m[2]) count++;
      }
      if (count === 0) return { ok: false, error: 'No replacement pairs found in output.' };
      return { ok: true, count };
    } catch (err) {
      return { ok: false, error: err.message || 'Unknown error' };
    }
  });

  handleIpc('clear-app-cache', async () => {
    try {
      const session = require('electron').session;
      await session.defaultSession.clearStorageData();
      await clearSession();
      try {
        const fs = require('fs/promises');
        await fs.unlink(getProfileSecretsPath());
      } catch {}
      return true;
    } catch (e) {
      if (DEVELOPER_MODE) console.warn('Failed to clear app data', e);
      return false;
    }
  });

  handleIpc('open-dev-console', async () => {
    try {
      const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
      const files = await fs.readdir(logsDir);
      const logFiles = files.filter((f) => f.startsWith('debug-') && f.endsWith('.txt')).sort();
      if (logFiles.length === 0) return false;
      const latestLog = path.join(logsDir, logFiles[logFiles.length - 1]);

      const { exec } = require('node:child_process');
      if (process.platform === 'win32') {
        exec(`start powershell -NoExit -Command "Get-Content -Path '${latestLog}' -Wait"`);
      } else if (process.platform === 'darwin') {
        exec(
          `osascript -e 'tell application "Terminal" to do script "tail -f \\"${latestLog}\\""'`,
        );
      } else {
        exec(`x-terminal-emulator -e "tail -f '${latestLog}'"`);
      }
      return true;
    } catch (e) {
      if (DEVELOPER_MODE) console.warn('Failed to open dev console', e);
      return false;
    }
  });

  onIpc('open-external', (event, url) => {
    try {
      if (canOpenExternalUrl(url)) {
        void shell.openExternal(String(url));
      } else if (DEVELOPER_MODE) {
        console.warn('open-external called with invalid url:', url);
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to open external URL:', err);
    }
  });

  handleIpc('open-logs-folder', async () => {
    const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
    try {
      await fs.mkdir(logsDir, { recursive: true });
      const errorMessage = await shell.openPath(logsDir);
      if (errorMessage) {
        if (DEVELOPER_MODE) console.warn('Failed to open logs folder:', errorMessage);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Failed to open logs folder:', err);
      return false;
    }
  });

  onIpc('run-spoofer-action', async (_event, data) => {
    if (spooferRunActive) {
      sendStatusMessage(
        'A spoofing operation is already running. Cancel it before starting another.',
      );
      return;
    }
    spooferRunActive = true;

    const originalConsoleLog = console.log;
    const originalConsoleWarn = console.warn;
    const originalConsoleError = console.error;

    const formatArgs = (args) =>
      args
        .map((a) => {
          if (a instanceof Error) return a.stack || a.message || String(a);
          if (typeof a === 'object') {
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          }
          return String(a);
        })
        .join(' ');

    console.log = (...args) => {
      originalConsoleLog(...args);
      sendSpooferLog({ level: 'info', message: formatArgs(args) });
    };
    console.warn = (...args) => {
      originalConsoleWarn(...args);
      sendSpooferLog({ level: 'warn', message: formatArgs(args) });
    };
    console.error = (...args) => {
      originalConsoleError(...args);
      sendSpooferLog({ level: 'error', message: formatArgs(args) });
    };

    try {
      await handleSpooferAction(
        data,
        getMainWindowFn,
        sendTransferUpdate,
        sendSpooferResultToRenderer,
        sendStatusMessage,
        sendSpooferLog,
        sendSpooferProgress,
      );
    } catch (err) {
      if (err?.message === 'Operation cancelled') {
        sendSpooferResultToRenderer({
          output: 'Operation cancelled.',
          success: false,
        });
        sendStatusMessage('Cancelled');
        return;
      }
      console.error('Unhandled spoofer action error:', err);
      sendSpooferResultToRenderer({
        output: `Unexpected error: ${err.message}`,
        success: false,
      });
      sendStatusMessage('Error occurred');
    } finally {
      console.log = originalConsoleLog;
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;
      spooferRunActive = false;
    }
  });

  onIpc('spoofer-pause', () => {
    pauseSpoofer();
    sendStatusMessage('Paused');
  });
  onIpc('spoofer-resume', () => {
    resumeSpoofer();
    sendStatusMessage('Resuming...');
  });
  onIpc('spoofer-cancel', () => {
    cancelSpoofer();
    sendStatusMessage('Cancelled');
  });
  handleIpc('check-session', () => loadSession());
  onIpc('clear-session', () => {
    void clearSession();
  });

  handleIpc('fetch-audio-quota', async (_event, data) => {
    data = normalizePayload(data);
    try {
      if (DEVELOPER_MODE)
        console.log('(Dev) Fetching audio quota with data:', {
          hasCookie: !!data.cookie,
          autoDetect: data.autoDetect,
        });

      let cookie = data.cookie;
      if (data.autoDetect && !cookie) {
        if (DEVELOPER_MODE) console.log('(Dev) Auto-detecting cookie...');
        cookie = await getCookieFromAutoDetect();
        if (DEVELOPER_MODE)
          console.log('(Dev) Auto-detected cookie:', cookie ? 'Found' : 'Not found');
      }
      if (!cookie) {
        if (DEVELOPER_MODE) console.log('(Dev) No cookie available for quota check');
        return { error: 'No cookie provided' };
      }

      const robloxSession = createRobloxSession(cookie);
      if (!robloxSession.getCookieHeader()) {
        return { error: 'Invalid ROBLOSECURITY cookie format' };
      }

      if (DEVELOPER_MODE) console.log('(Dev) Fetching from Roblox API...');
      const response = await robloxSession.fetch(
        'https://publish.roblox.com/v1/asset-quotas?resourceType=RateLimitUpload&assetType=Audio',
        {
          headers: {
            'User-Agent': 'RobloxStudio/WinInet',
          },
        },
      );

      if (DEVELOPER_MODE) console.log('(Dev) Quota API response status:', response.status);
      if (!response.ok) {
        try {
          const errorText = await response.text();
          if (DEVELOPER_MODE) console.log('(Dev) Quota API error:', errorText);
        } catch {}
        return { error: `Failed to fetch quota: ${response.status}` };
      }

      const quotaData = await response.json();
      if (DEVELOPER_MODE) console.log('(Dev) Quota data received:', quotaData);
      return quotaData;
    } catch (err) {
      console.error('Error fetching audio quota:', err);
      return { error: err.message };
    }
  });

  handleIpc('select-folder', async (_event) => {
    try {
      const result = await dialog.showOpenDialog(getMainWindowFn(), {
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    } catch (err) {
      console.error('Error selecting folder:', err);
      return null;
    }
  });
}

async function handleSpooferAction(
  data,
  getMainWindowFn,
  sendTransferUpdate,
  sendSpooferResultToRenderer,
  sendStatusMessage,
  sendSpooferLog,
  sendSpooferProgress,
) {
  data = normalizePayload(data);

  resetRunControls();

  if (DEVELOPER_MODE) {
    const sanitizedData = { ...data };
    if (sanitizedData.robloxCookie) sanitizedData.robloxCookie = '{Cookie:Here}';
    console.log('MAIN_PROCESS (Dev): Received run-spoofer-action with data:', sanitizedData);
  } else {
    console.log('MAIN_PROCESS: Received run-spoofer-action.');
  }

  if (data.resumeSession === true) {
    const savedSession = await loadSession();
    if (savedSession && savedSession.animationIdInput) {
      data.animationId = savedSession.animationIdInput;
    }
  }

  const hasCustomDownloadFolder = !!(
    data.downloadOnly &&
    data.downloadFolder &&
    data.downloadFolder.trim()
  );
  const downloadsDir = hasCustomDownloadFolder
    ? data.downloadFolder.trim()
    : path.join(app.getPath('userData'), 'ispoofer_downloads');

  if (data.downloadOnly && (!data.downloadFolder || !data.downloadFolder.trim())) {
    sendSpooferResultToRenderer({
      output: 'Please select a download folder for Download-Only mode.',
      success: false,
    });
    sendStatusMessage('Error: No download folder selected');
    return;
  }

  if (!hasCustomDownloadFolder) {
    const cleared = await clearDownloadsDirectory(downloadsDir);
    if (!cleared) {
      if (DEVELOPER_MODE)
        console.warn('(Dev) Failed to fully clear downloads directory, proceeding anyway.');
      sendSpooferResultToRenderer({
        output: 'Warning: Could not fully clear previous downloads.',
        success: false,
      });
    }
  } else if (DEVELOPER_MODE) {
    console.log('(Dev) Skipping auto-clear: using user-selected download folder', downloadsDir);
  }

  data.apiKey = String(data.apiKey || '').trim();
  data.groupId = data.groupId ? String(data.groupId).replace(/\D/g, '') : '';
  data.overridePlaceId = data.overridePlaceId
    ? String(data.overridePlaceId).replace(/\D/g, '')
    : '';

  if (data.groupId && !/^\d+$/.test(String(data.groupId).trim())) {
    sendSpooferResultToRenderer({
      output: `Invalid Group ID "${data.groupId}" - must be a number only, not a URL or text.`,
      success: false,
    });
    return;
  }

  if (!data.downloadOnly && !data.apiKey) {
    sendSpooferResultToRenderer({
      output:
        'Uploads now require an Open Cloud API key.\n\nTo fix this:\n1. Go to create.roblox.com -> Open Cloud -> API Keys\n2. Create a key with Assets Read & Write permissions\n3. Paste the key into the "Open Cloud API Key" field',
      success: false,
    });
    return;
  }

  if (!data.downloadOnly) {
    const apiKeyValidation = await validateOpenCloudApiKey(data.apiKey);
    if (!apiKeyValidation.ok) {
      sendSpooferResultToRenderer({
        output: apiKeyValidation.message,
        success: false,
      });
      sendStatusMessage('API key validation failed');
      return;
    }
    console.log(`[API KEY] ${apiKeyValidation.message}`);
  }

  const inputText = String(data.animationId || '');
  const inputTypeMarker = getSpooferInputTypeMarker(inputText);
  const defaultInputAssetTypeName = inputTypeMarker
    ? inputTypeMarker === 'sound'
      ? 'Audio'
      : 'Animation'
    : '';
  const invalidAssetLines = [];
  const duplicateAssetLines = [];
  const seenAssetIds = new Set();
  const assetEntries = inputText
    .split('\n')
    .map((line, index) => {
      const trimmedLine = normalizeSpooferInputLine(line);
      if (isSpooferOutputMetadataLine(trimmedLine)) return null;
      const parsed = parseSpooferAssetLine(trimmedLine);
      if (parsed.error) {
        invalidAssetLines.push({
          line: index + 1,
          reason: parsed.error,
        });
        return null;
      }
      if (seenAssetIds.has(parsed.entry.id)) {
        duplicateAssetLines.push({ line: index + 1, id: parsed.entry.id });
        return null;
      }
      seenAssetIds.add(parsed.entry.id);
      if (!parsed.entry.assetTypeName && defaultInputAssetTypeName) {
        parsed.entry.assetTypeName = defaultInputAssetTypeName;
      }
      return parsed.entry;
    })
    .filter((entry) => entry && entry.id && entry.creatorId);

  if (assetEntries.length === 0) {
    const details = invalidAssetLines.length
      ? `\n\nInvalid line(s):\n${invalidAssetLines.map((item) => `Line ${item.line}: ${item.reason}`).join('\n')}`
      : '';
    sendSpooferResultToRenderer({
      output: `No valid asset entries were found. Paste entries like:\n[12345678] [ExampleAsset] [User:12345]\n[23456789] [ExampleGroupAsset] [Group:67890]\n[34567890] [ExampleSound] [User:12345] [Type:Sound]${details}`,
      success: false,
    });
    return;
  }

  if (invalidAssetLines.length || duplicateAssetLines.length) {
    console.warn(
      `[INPUT] Processing ${assetEntries.length} valid asset entr${assetEntries.length === 1 ? 'y' : 'ies'}; skipped ${invalidAssetLines.length} invalid and ${duplicateAssetLines.length} duplicate line(s).`,
    );
  }

  const animationEntries = assetEntries;

  const firstEntry = animationEntries[0];
  let robloxCookie = data.robloxCookie;
  if (data.autoDetectCookie) {
    try {
      if (firstEntry.creatorType === 'user') {
        robloxCookie = await getCookieFromAutoDetect(firstEntry.creatorId);
      } else {
        robloxCookie = await getCookieFromAutoDetect();
      }
      if (!robloxCookie) throw new Error('Auto-detected cookie empty/not found.');
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Error auto-detecting cookie:', err);
      sendSpooferResultToRenderer({
        output: `Failed to auto-detect cookie: ${err.message}`,
        success: false,
      });
      return;
    }
  }
  if (!robloxCookie) {
    sendSpooferResultToRenderer({
      output: 'Roblox cookie not provided.',
      success: false,
    });
    return;
  }

  const robloxSession = createRobloxSession(robloxCookie);

  let preflightAuthUserId = null;
  sendStatusMessage('Validating Roblox session...');
  try {
    preflightAuthUserId = await getAuthenticatedUserId(robloxCookie);
    if (DEVELOPER_MODE) console.log(`(Dev) Cookie pre-flight OK — authenticated as user ${preflightAuthUserId}`);
  } catch (preflightErr) {
    sendSpooferResultToRenderer({
      output: `Cookie validation failed: ${preflightErr.message}\n\nMake sure your ROBLOSECURITY cookie is current and not expired. You can re-copy it from your browser.`,
      success: false,
    });
    sendStatusMessage('Cookie validation failed');
    return;
  }

  try {
    if (!(await fs.stat(downloadsDir).catch(() => null))) {
      await fs.mkdir(downloadsDir, { recursive: true });
      if (DEVELOPER_MODE) console.log('(Dev) Downloads directory created:', downloadsDir);
    }
  } catch (dirError) {
    sendSpooferResultToRenderer({
      output: `Failed to ensure downloads directory exists: ${dirError.message}`,
      success: false,
    });
    return;
  }

  try {
    const resolvedMetadataCount = await resolveAssetEntryMetadata(animationEntries, robloxSession, {
      force: data.downloadOnly,
    });
    for (const entry of animationEntries) {
      if (!entry.assetTypeName) entry.assetTypeName = 'Animation';
    }
    if (resolvedMetadataCount > 0) {
      console.log(
        `[METADATA] Resolved ${resolvedMetadataCount}/${animationEntries.length} asset metadata entr${resolvedMetadataCount === 1 ? 'y' : 'ies'} from Roblox.`,
      );
    }
  } catch (err) {
    for (const entry of animationEntries) {
      if (!entry.assetTypeName) entry.assetTypeName = 'Animation';
    }
    if (DEVELOPER_MODE) {
      console.warn(`(Dev) Failed to refresh asset names: ${err.message}`);
    }
  }

  const assetTypeSummary = summarizeAssetTypes(animationEntries);

  const isResume = data.resumeSession === true;
  let session = isResume ? await loadSession() : null;
  if (isResume && session) {
    const completedIds = new Set((session.completedMappings || []).map((m) => m.originalId));
    animationEntries.splice(
      0,
      animationEntries.length,
      ...animationEntries.filter((e) => !completedIds.has(String(e.id))),
    );

    if (animationEntries.length === 0) {
      const mappingOutput = (session.completedMappings || [])
        .map((m) => `${m.originalId} = ${m.newId},`)
        .join('\n');
      sendSpooferResultToRenderer({
        output: mappingOutput.replace(/,$/, ''),
        success: true,
      });
      sendStatusMessage('Session already complete');
      await clearSession();
      return;
    }

    sendSpooferResultToRenderer({
      output: `Resuming - ${animationEntries.length} asset(s) remaining from previous session.\n`,
      success: true,
    });
  } else {
    session = {
      sessionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      mode: 'Mixed',
      animationIdInput: data.animationId,
      totalCount: animationEntries.length,
      completedMappings: [],
    };
    await saveSession(session);
  }

  let verboseOutputMessage = `Downloading ${assetTypeSummary}...\n`;
  let successfulUploadCount = 0;
  let downloadedSuccessfullyCount = 0;

  let uploadMappingOutput = (session.completedMappings || [])
    .map((m) => `${m.originalId} = ${m.newId},`)
    .join('\n');
  if (uploadMappingOutput) uploadMappingOutput += '\n';

  const initialTransferStates = [];
  for (const entry of animationEntries) {
    const downloadTransferId = crypto.randomUUID();
    initialTransferStates.push({
      id: downloadTransferId,
      name: entry.name,
      originalAssetId: entry.id,
      status: 'queued',
      direction: 'download',
      progress: 0,
      size: 0,
    });
  }
  initialTransferStates.forEach((state) => sendTransferUpdate(state));

  const totalAnimations = animationEntries.length;
  try {
    sendStatusMessage(`Preparing ${assetTypeSummary}...`);
    sendSpooferProgress({
      phase: 'preparing',
      current: 0,
      total: totalAnimations,
    });
  } catch (e) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to send initial status message', e);
  }

  let hasAuthError = false;

  const maxPlaceIds = data.maxPlaceIds || 200;
  const maxPlaceIdRetries = data.maxPlaceIdRetries || 3;
  const overridePlaceId = data.overridePlaceId ? parseInt(data.overridePlaceId) : null;
  const uniqueCreators = [
    ...new Set(animationEntries.map((e) => `${e.creatorType}:${e.creatorId}`)),
  ];
  const entryPlaceIdsByCreator = {};
  for (const creatorKey of uniqueCreators) {
    entryPlaceIdsByCreator[creatorKey] = uniquePlaceIds(
      animationEntries
        .filter((entry) => `${entry.creatorType}:${entry.creatorId}` === creatorKey)
        .map((entry) => entry.placeId),
    );
  }

  const userDataPath = app.getPath('userData');
  let placeIdCacheEntries = {};
  try {
    const cachedCreatorCount = Object.keys(placeIdCacheEntries).length;
    if (DEVELOPER_MODE && cachedCreatorCount > 0)
      console.log(`(Dev) Loaded placeId cache with ${cachedCreatorCount} creator(s)`);
  } catch (cacheErr) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to load placeId cache:', cacheErr.message);
  }

  const placeIdMap = {};
  if (animationEntries.length > 0) {
    sendStatusMessage('Discovering compatible Roblox places...');
    if (DEVELOPER_MODE)
      console.log(
        `(Dev) Found ${animationEntries.length > 0 ? [...new Set(animationEntries.map((e) => `${e.creatorType}:${e.creatorId}`))].length : 0} unique creators. Fetching placeIds (max ${maxPlaceIds} per creator, ${maxPlaceIdRetries} retries)...`,
      );

    if (DEVELOPER_MODE)
      console.log(`(Dev) Fetching placeIds for ${uniqueCreators.length} creator(s) in parallel...`);

    await runWithConcurrency(uniqueCreators, 5, async (creatorKey) => {
      const [creatorType, creatorId] = creatorKey.split(':');
      // Prepend cached (proven) placeIds so they are tried before fresh discovery.
      const cachedIds = getCachedPlaceIds(placeIdCacheEntries, creatorKey);
      if (cachedIds.length > 0 && DEVELOPER_MODE)
        console.log(`(Dev) Cache hit for ${creatorKey}: ${cachedIds.length} cached placeId(s)`);
      try {
        const placeIds = await retryAsync(
          () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
          maxPlaceIdRetries,
          1000,
          (attempt, max, err) => {
            if (DEVELOPER_MODE)
              console.warn(`(Dev) Attempt ${attempt}/${max} for ${creatorKey}: ${err.message}`);
          },
        );
        placeIdMap[creatorKey] = uniquePlaceIds(
          entryPlaceIdsByCreator[creatorKey],
          cachedIds,
          placeIds,
        );
        if (DEVELOPER_MODE)
          console.log(`(Dev) Got ${placeIdMap[creatorKey].length} placeIds for ${creatorKey} (${cachedIds.length} cached)`);
      } catch (error) {
        if (DEVELOPER_MODE)
          console.warn(`(Dev) Could not get placeIds for ${creatorKey}: ${error.message}`);
        placeIdMap[creatorKey] = uniquePlaceIds(
          entryPlaceIdsByCreator[creatorKey],
          cachedIds,
        );
      }
    });

    const creatorsNeedingFallback = uniqueCreators.filter(
      (k) => !placeIdMap[k] || placeIdMap[k].length === 0,
    );
    if (creatorsNeedingFallback.length > 0) {
      sendStatusMessage('Searching for alternate place context for private assets...');
      if (DEVELOPER_MODE)
        console.log(
          `(Dev) ${creatorsNeedingFallback.length} creator(s) have no places. Building fallback pools...`,
        );

      const fallbackAuthUserId = preflightAuthUserId;

      const fallbackPools = new Map();
      const getFallbackPool = async (creatorKey, creatorType, creatorId) => {
        if (fallbackPools.has(creatorKey)) return fallbackPools.get(creatorKey);
        const pool = await getPlaceIdsFromAllUserContext(
          fallbackAuthUserId,
          creatorId,
          creatorType,
          robloxCookie,
          10,
        );
        fallbackPools.set(creatorKey, pool);
        if (DEVELOPER_MODE)
          console.log(`(Dev) Fallback pool for ${creatorKey} has ${pool.length} place IDs`);
        return pool;
      };

      for (const creatorKey of creatorsNeedingFallback) {
        const [creatorType, creatorId] = creatorKey.split(':');
        const fallbackPool = await getFallbackPool(creatorKey, creatorType, creatorId);
        if (fallbackPool.length > 0) {
          placeIdMap[creatorKey] = uniquePlaceIds(entryPlaceIdsByCreator[creatorKey], fallbackPool);
          if (DEVELOPER_MODE)
            console.log(
              `(Dev) Assigned ${placeIdMap[creatorKey].length} fallback place IDs to ${creatorKey}`,
            );
        }
      }
    }

    if (overridePlaceId) {
      for (const creatorKey of uniqueCreators) {
        placeIdMap[creatorKey] = uniquePlaceIds(overridePlaceId, placeIdMap[creatorKey]);
      }
      if (DEVELOPER_MODE) console.log('(Dev) Prepended overridePlaceId to all creator placeIdMaps');
    }

    if (DEVELOPER_MODE) console.log('(Dev) Resolved placeIdMap:', placeIdMap);

    const creatorsWithNoPlaces = uniqueCreators.filter((k) => !placeIdMap[k]?.length);
    if (creatorsWithNoPlaces.length > 0) {
      const affectedCount = animationEntries.filter((e) =>
        creatorsWithNoPlaces.includes(`${e.creatorType}:${e.creatorId}`),
      ).length;
      const warnMsg =
        `⚠️ No Roblox place context found for ${creatorsWithNoPlaces.length} creator(s) ` +
        `(affects ${affectedCount} asset${affectedCount !== 1 ? 's' : ''}). ` +
        `Private assets from these creators may fail with 403. ` +
        `Consider adding an Override Place ID or re-importing from the Studio plugin scan.`;
      console.warn(`[PLACE CONTEXT] ${warnMsg}`);
      sendStatusMessage(warnMsg);
      sendSpooferLog?.(warnMsg);
    }
  }

  const locationsMap = {};
  const batchItems = animationEntries.map((entry) => ({
    requestId: entry.id,
    assetId: parseInt(entry.id),
    creatorType: entry.creatorType,
    creatorId: entry.creatorId,
  }));

  const BATCH_MAX_RETRIES = parseInt(data.batchRetries, 10) || 5;
  const BATCH_RETRY_DELAY_MS = parseInt(data.batchRetryDelay, 10) || 2000;
  const BATCH_TIMEOUT_MS = parseInt(data.batchTimeoutMs, 10) || 15000;
  const chunkSize = Math.min(50, Math.max(1, parseInt(data.batchChunkSize, 10) || 10));

  sendStatusMessage('Resolving download locations...');
  sendSpooferProgress({
    phase: 'locations',
    current: 0,
    total: batchItems.length,
  });
  if (DEVELOPER_MODE)
    console.log(
      `(Dev) Fetching batch locations for ${batchItems.length} assets with creator-specific placeIds`,
    );
  const batchTasks = [];
  const creatorGroups = {};
  for (const item of batchItems) {
    const creatorKey = `${item.creatorType}:${item.creatorId}`;
    if (!creatorGroups[creatorKey]) creatorGroups[creatorKey] = [];
    creatorGroups[creatorKey].push(item);
  }
  for (const [creatorKey, items] of Object.entries(creatorGroups)) {
    for (let i = 0; i < items.length; i += chunkSize) {
      batchTasks.push({
        creatorKey,
        items: items.slice(i, i + chunkSize),
      });
    }
  }

  let resolvedLocationsCount = 0;
  await runWithConcurrency(batchTasks, 5, async (task) => {
    checkCancelled();
    await checkPaused();

    const { creatorKey, items } = task;
    const [creatorType, creatorId] = creatorKey.split(':');
    let placeIdArray = placeIdMap[creatorKey] || [];
    let placeIdIndex = 0;
    let retryCount = 0;
    const maxRetries = maxPlaceIdRetries;

    try {
      for (const item of items) {
        setBatchLocation(locationsMap, {
          requestId: item.requestId,
          errors: [
            {
              message:
                placeIdArray.length === 0
                  ? 'No places found for creator to authorize download'
                  : 'Asset missing from batch response',
            },
          ],
        });
      }

      while (placeIdIndex < placeIdArray.length) {
        checkCancelled();
        await checkPaused();
        const placeId = placeIdArray[placeIdIndex];
        const itemsWithoutCreator = items.map(
          ({ creatorType: _creatorType, creatorId: _creatorId, ...rest }) => ({
            ...rest,
            placeId: placeId,
            serverPlaceId: placeId,
          }),
        );

        if (DEVELOPER_MODE)
          console.log(
            `(Dev) Batch request for ${creatorKey}: ${items.length} items with placeId ${placeId}${placeIdIndex > 0 ? ` (place index ${placeIdIndex}/${placeIdArray.length})` : ''}`,
          );

        let locations;
        for (let attempt = 1; attempt <= BATCH_MAX_RETRIES; attempt++) {
          if (attempt > 1) {
            sendStatusMessage(
              `Resolving download locations... retry ${attempt}/${BATCH_MAX_RETRIES}`,
            );
          }
          await waitBatchRequestSlot();

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
          let resp;
          let caughtErr = null;
          try {
            resp = await robloxSession.fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
              method: 'POST',
              headers: {
                'User-Agent': 'RobloxStudio/WinInet',
                'Content-Type': 'application/json',
                'Roblox-Place-Id': String(placeId),
                'Roblox-Browser-Asset-Request': 'false',
              },
              body: JSON.stringify(itemsWithoutCreator),
              signal: controller.signal,
            });
          } catch (err) {
            caughtErr = err;
          } finally {
            clearTimeout(timeout);
          }
          if (resp) updateBatchRateLimitFromHeaders(resp);

          if (resp && resp.ok) {
            locations = await resp.json();
            break;
          }

          const status = resp ? resp.status : 0;
          const isTimeout =
            caughtErr &&
            (caughtErr.name === 'AbortError' || /aborted|timeout/i.test(caughtErr.message));
          const retryable =
            isTimeout ||
            status === 429 ||
            status === 502 ||
            status === 503 ||
            status === 504 ||
            status === 500;
          const statusText = resp
            ? `${status}`
            : isTimeout
              ? 'timeout'
              : caughtErr
                ? caughtErr.message
                : 'unknown';

          if (DEVELOPER_MODE) {
            console.warn(
              `(Dev) Batch attempt ${attempt}/${BATCH_MAX_RETRIES} for ${creatorKey} @ place ${placeId} failed: ${statusText}${retryable && attempt < BATCH_MAX_RETRIES ? ' -> retrying' : ''}`,
            );
            console.warn(
              `(Dev) [Diagnostics] Creator Key: ${creatorKey}, Items: ${items.length}, Place ID: ${placeId}, Attempt: ${attempt}`,
            );
            if (resp) {
              console.warn(
                `(Dev) [Diagnostics] Retry-After: ${resp.headers.get('retry-after') || 'none'}`,
              );
            }
          }

          if (!retryable || attempt === BATCH_MAX_RETRIES) {
            if (DEVELOPER_MODE && resp) {
              try {
                const clonedResp = resp.clone();
                const text = await clonedResp.text();
                console.warn(`(Dev) [Diagnostics] Response Body: ${text.substring(0, 500)}`);
              } catch {}
            }
            throw new Error(`Batch request failed for ${creatorKey}: ${statusText}`);
          }

          if (status === 429 && resp) {
            const delayMs = getBatchRetryAfterMs(resp, attempt);
            sendStatusMessage(
              `Roblox rate limited download lookup. Retrying in ${Math.ceil(delayMs / 1000)}s...`,
            );
            if (DEVELOPER_MODE)
              console.warn(`(Dev) Rate limited (429). Pausing batch globally for ${delayMs}ms`);
            setBatchRateLimit(delayMs);
          } else {
            const delayMs = BATCH_RETRY_DELAY_MS + Math.floor(Math.random() * 300);
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }

        if (!locations) throw new Error(`Batch request failed for ${creatorKey}: no response`);
        if (DEVELOPER_MODE) console.log(`(Dev) Batch response for ${creatorKey}:`, locations);

        const hasBatchErrors = locations.some(hasBatchAccessDeniedErrors);

        const errorItems = locations.filter((loc) => loc.errors && loc.errors.length > 0);
        if (errorItems.length > 0 && DEVELOPER_MODE) {
          for (const locErr of errorItems) {
            const firstErr = locErr.errors[0] || {};
            console.warn(
              `Batch error for ${locErr.requestId} at place ${placeId}:`,
              JSON.stringify(firstErr),
            );
            console.log(
              '(Dev) Full batch item with error:',
              JSON.stringify(locErr, null, 2).substring(0, 500),
            );
          }
        }

        if (hasBatchErrors) {
          for (const loc of locations) {
            if (hasBatchLocationSuccess(loc)) setBatchLocation(locationsMap, loc);
          }

          if (placeIdIndex < placeIdArray.length - 1) {
            if (DEVELOPER_MODE)
              console.log(
                `(Dev) Batch errors detected for ${creatorKey} with placeId ${placeId}. Trying next place...`,
              );
            placeIdIndex++;
            continue;
          } else {
            if (retryCount < maxRetries) {
              retryCount++;
              if (DEVELOPER_MODE)
                console.log(
                  `(Dev) All places exhausted for ${creatorKey}. Fetching fresh placeIds (retry ${retryCount}/${maxRetries})...`,
                );
              try {
                const freshPlaceIds = await retryAsync(
                  () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
                  1,
                  1000,
                );
                placeIdMap[creatorKey] = uniquePlaceIds(
                  entryPlaceIdsByCreator[creatorKey],
                  freshPlaceIds,
                );
                placeIdArray = placeIdMap[creatorKey];
                placeIdIndex = 0;
                if (DEVELOPER_MODE)
                  console.log(
                    `(Dev) Got fresh placeIds for ${creatorKey}: ${placeIdArray.join(', ')}`,
                  );
                continue;
              } catch (refreshErr) {
                if (DEVELOPER_MODE)
                  console.warn(
                    `(Dev) Failed to refresh placeIds for ${creatorKey}: ${refreshErr.message}`,
                  );
                for (const loc of locations) {
                  setBatchLocation(locationsMap, loc);
                }
                if (locations.every((loc) => !hasBatchLocationSuccess(loc) && hasBatchAccessDeniedErrors(loc))) {
                  hasAuthError = true;
                }
                evictPlaceId(placeIdCacheEntries, creatorKey, placeId);
                break;
              }
            } else {
              if (DEVELOPER_MODE)
                console.log(`(Dev) Max retries reached for ${creatorKey}, accepting batch errors`);
              for (const loc of locations) {
                setBatchLocation(locationsMap, loc);
              }
              if (locations.every((loc) => !hasBatchLocationSuccess(loc) && hasBatchAccessDeniedErrors(loc))) {
                hasAuthError = true;
              }
              evictPlaceId(placeIdCacheEntries, creatorKey, placeId);
              break;
            }
          }
        } else {
          if (DEVELOPER_MODE)
            console.log(`(Dev) Batch request successful for ${creatorKey} with placeId ${placeId}`);
          for (const loc of locations) {
            setBatchLocation(locationsMap, loc);
          }
          recordSuccessfulPlaceId(placeIdCacheEntries, creatorKey, placeId);
          break;
        }
      }
    } catch (error) {
      console.error('Batch request error:', error);
      const msg = error && error.message ? error.message : '';
      if (/\b401\b|\b403\b/.test(msg)) {
        hasAuthError = true;
      }
      sendStatusMessage(`Batch request failed: ${error.message}`);
      for (const item of items) {
        if (
          !locationsMap[item.requestId] ||
          locationsMap[item.requestId].errors?.[0]?.message === 'Asset missing from batch response'
        ) {
          setBatchLocation(locationsMap, { requestId: item.requestId, errors: [{ message: msg }] });
        }

        const transfer = initialTransferStates.find((t) => t.originalAssetId === item.requestId);
        if (transfer)
          sendTransferUpdate({
            id: transfer.id,
            status: 'error',
            error: 'Batch request failed',
          });
      }
    }

    resolvedLocationsCount += items.length;
    sendSpooferProgress({
      phase: 'locations',
      current: resolvedLocationsCount,
      total: batchItems.length,
    });
    sendStatusMessage(`Resolved download locations ${resolvedLocationsCount}/${batchItems.length}`);
  });

  // Save the updated placeId success cache to disk.
  try {
    await savePlaceIdCache(userDataPath, placeIdCacheEntries);
    if (DEVELOPER_MODE) console.log('(Dev) Saved placeId cache');
  } catch (cacheErr) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to save placeId cache:', cacheErr.message);
  }

  const UPLOAD_RETRIES = parseInt(data.uploadRetries, 10) || 3;
  const UPLOAD_RETRY_DELAY_MS = parseInt(data.uploadRetryDelay, 10) || 5000;

  const DOWNLOAD_RETRIES = parseInt(data.downloadRetries, 10) || 2;
  const DOWNLOAD_RETRY_DELAY_MS = parseInt(data.downloadRetryDelayMs, 10) || 2000;
  const DOWNLOAD_TIMEOUT_MS = parseInt(data.downloadTimeoutMs, 10) || 15000;

  sendStatusMessage(`Downloading ${assetTypeSummary}...`);
  const defaultDownloadLimit = 20;
  let userDownloadLimit = data.concurrentUploads
    ? data.maxConcurrentDownloads
      ? parseInt(data.maxConcurrentDownloads, 10)
      : defaultDownloadLimit
    : defaultDownloadLimit;
  const DOWNLOAD_CONCURRENCY = Math.min(userDownloadLimit, animationEntries.length);

  let downloadCompleted = 0;
  const downloadStartTime = Date.now();

  const getScrapedAssetCdnUrl = async (assetId) => {
    try {
      const htmlResponse = await robloxSession.fetch(`https://www.roblox.com/library/${assetId}/`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        },
      });
      if (htmlResponse.ok) {
        const htmlText = await htmlResponse.text();
        const match = htmlText.match(/data-mediathumb-url="([^"]+)"/i);
        if (match && match[1]) {
          if (DEVELOPER_MODE) console.log(`(Dev) [CDN] Scraped mediathumb URL for ${assetId}`);
          return match[1];
        }
      }
    } catch {
      if (DEVELOPER_MODE) console.warn(`(Dev) [CDN] Scrape failed for ${assetId}`);
    }

    try {
      const v1Response = await robloxSession.fetch(
        `https://assetdelivery.roblox.com/v1/asset/?id=${assetId}&expectedAssetType=Audio`,
        {
          headers: {
            'User-Agent': 'Roblox/WinInet',
          },
          redirect: 'manual',
        },
      );
      const cdnUrl = v1Response.headers.get('location') || v1Response.url || '';
      if (cdnUrl.includes('rbxcdn.com')) {
        if (DEVELOPER_MODE) console.log(`(Dev) [CDN] V1 Redirect success for ${assetId}`);
        return cdnUrl;
      }
    } catch {}
    return null;
  };

  const downloadOne = async (entry) => {
    checkCancelled();
    await checkPaused();
    const entryAssetTypeName = getEntryAssetTypeName(entry);
    const entryIsSound = entryAssetTypeName === 'Audio';
    const loc = locationsMap[entry.id];
    const sanitizedName = sanitizeFilename(entry.name);
    const fileExtension = entryIsSound ? '.ogg' : '.rbxm';
    const fileName = `${sanitizedName}_${entry.id}${fileExtension}`;
    let filePath = path.join(downloadsDir, fileName);
    const downloadTransfer = initialTransferStates.find((t) => t.originalAssetId === entry.id);
    const downloadTransferId = downloadTransfer.id;
    const creatorKey = `${entry.creatorType}:${entry.creatorId}`;
    const entryPlaceIds = placeIdMap[creatorKey] || [];
    const normalizedEntryPlaceIds = Array.isArray(entryPlaceIds) ? entryPlaceIds : [entryPlaceIds];
    const entryPlaceId = normalizedEntryPlaceIds[0];
    let result = null;
    let batchErrorMessage;

    const tryDownloadUrl = async (
      url,
      statusMessage,
      placeIdForRequest = null,
      suppressErrorUpdate = false,
    ) => {
      if (statusMessage) {
        sendTransferUpdate({
          id: downloadTransferId,
          status: 'processing',
          message: statusMessage,
        });
      } else {
        sendTransferUpdate({ id: downloadTransferId, status: 'processing' });
      }

      const downloadResult = await downloadAnimationAssetWithProgress(
        url,
        robloxSession,
        filePath,
        downloadTransferId,
        entry.name,
        entry.id,
        sendTransferUpdate,
        placeIdForRequest,
        {
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          retries: DOWNLOAD_RETRIES,
          retryDelayMs: DOWNLOAD_RETRY_DELAY_MS,
          suppressErrorUpdate,
          abortSignal: getAbortSignal(),
        },
      );

      if (!downloadResult?.success) return downloadResult;

      try {
        const validation = await validateDownloadedAssetFile(filePath, entryAssetTypeName);
        filePath = validation.filePath;
        return {
          ...downloadResult,
          filePath,
          payloadMetadata: validation.payloadMetadata,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : String(
                error || `Downloaded ${entryAssetTypeName.toLowerCase()} file is not uploadable.`,
              );
        await fs.rm(filePath, { force: true }).catch(() => {});
        sendTransferUpdate({
          id: downloadTransferId,
          status: 'error',
          error: errorMessage,
        });
        return {
          success: false,
          error: errorMessage,
          nonRetryable: error?.nonRetryable === true,
          payloadMetadata: error?.payloadMetadata || null,
        };
      }
    };

    if (loc?.locations && loc.locations.length > 0 && loc.locations[0].location) {
      const batchLocation = loc.locations[0].location;
      result = await tryDownloadUrl(
        batchLocation,
        null,
        getPlaceIdFromDownloadUrl(batchLocation) || entryPlaceId,
      );
      if (!result?.success) {
        batchErrorMessage = result?.error || 'Batch URL download failed';
        if (DEVELOPER_MODE) {
          console.log(
            `(Dev) Batch URL download failed for ${entry.id}: ${batchErrorMessage}. Trying direct asset fallback...`,
          );
        }
      }
    }

    if (!result?.success) {
      batchErrorMessage = batchErrorMessage || extractBatchLocationError(loc);
      if (DEVELOPER_MODE) {
        console.log(
          `(Dev) Batch location failed for ${entry.id}: ${batchErrorMessage}. Trying direct asset fallback...`,
        );
      }

      let scraperSuccess = false;
      if (entryIsSound) {
        const scrapedUrl = await getScrapedAssetCdnUrl(entry.id);
        if (scrapedUrl) {
          result = await tryDownloadUrl(
            scrapedUrl,
            'Batch lookup failed; trying CDN web scraper fallback',
            getPlaceIdFromDownloadUrl(scrapedUrl),
            true,
          );
          if (result && result.success) {
            scraperSuccess = true;
          }
        }
      }

      if (!scraperSuccess) {
        const directAttempts = buildDirectAssetDownloadAttempts(
          entry.id,
          normalizedEntryPlaceIds,
          entryIsSound,
        );
        for (let index = 0; index < directAttempts.length; index += 1) {
          checkCancelled();
          await checkPaused();
          const attempt = directAttempts[index];
          result = await tryDownloadUrl(
            attempt.url,
            `Batch lookup failed; trying direct download fallback ${index + 1}/${directAttempts.length}`,
            attempt.placeId,
            true,
          );
          if (result.success) break;
        }
      }

      if (!result || !result.success) {
        const directError = result?.error || 'Direct download fallback failed';
        const accessDenied = /403|forbidden|not authorized|unauthorized|permission/i.test(
        const batchIsAccessDenied = /403|forbidden|not authorized|unauthorized|permission/i.test(
          String(batchErrorMessage || ''),
          directError,
        );
        const accessDenied = batchIsAccessDenied || directIsAccessDenied;
        // Always show the place-context hint on any 403 — even if a placeId was supplied,
        // it may be wrong or stale for this private asset.
        const placeContextHint = accessDenied
          ? ' Asset is private or restricted — re-import from the Studio plugin scan, or add [Place:<placeId>] / Override place ID for a game that has access to it.'
          : '';
        // Collapse both errors into one clean message when both are access-denied,
        // otherwise keep the full dual-error message for debugging.
        const combinedError =
          batchIsAccessDenied && directIsAccessDenied
            ? `Failed to download asset: Access denied (403).${placeContextHint}`
            : `Batch error: ${batchErrorMessage}. Direct fallback: ${directError}.${placeContextHint}`;
        result = {
          success: false,
          error: combinedError,
        };
        sendTransferUpdate({
          id: downloadTransferId,
          status: 'error',
          error: result.error,
        });
      }
    }

    downloadCompleted++;
    sendSpooferProgress({
      phase: 'download',
      current: downloadCompleted,
      total: animationEntries.length,
    });
    const elapsed = (Date.now() - downloadStartTime) / 1000;
    const avgTimePerItem = elapsed / downloadCompleted;
    const remaining = animationEntries.length - downloadCompleted;
    const etaSeconds = Math.ceil(avgTimePerItem * remaining);
    const etaMin = Math.floor(etaSeconds / 60);
    const etaSec = etaSeconds % 60;
    const etaStr = remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
    sendStatusMessage(`Downloaded ${downloadCompleted}/${animationEntries.length} assets${etaStr}`);
    return {
      entry,
      filePath: result.success ? filePath : null,
      success: result.success,
      error: result.error,
    };
  };
  const downloadResults = await runWithConcurrency(
    animationEntries,
    DOWNLOAD_CONCURRENCY,
    downloadOne,
  );

  let authenticatedUserId = null;
  if (!data.downloadOnly && data.apiKey && !data.groupId) {
    try {
      const ownerDetection = await detectOpenCloudApiKeyOwner(data.apiKey);
      if (ownerDetection.ok && ownerDetection.ownerUserId) {
        authenticatedUserId = ownerDetection.ownerUserId;
        if (DEVELOPER_MODE)
          console.log(`(Dev) Resolved upload user ID from API key: ${authenticatedUserId}`);
      } else {
        authenticatedUserId = await getAuthenticatedUserId(robloxCookie);
        if (DEVELOPER_MODE)
          console.log(
            `(Dev) Resolved upload user ID from cookie (API key detection failed): ${authenticatedUserId}`,
          );
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn(`(Dev) Could not resolve upload user ID: ${err.message}`);
      sendSpooferResultToRenderer({
        output: `Failed to resolve your Roblox user ID: ${err.message}\n\nMake sure your cookie and API key are valid.`,
        success: false,
      });
      return;
    }
  }

  let uploadResults = [];
  if (data.downloadOnly) {
    sendStatusMessage('Download-only mode: Skipping uploads');
    if (DEVELOPER_MODE) console.log('(Dev) Download-only mode enabled, skipping all uploads');
  } else {
    const successfulDownloads = downloadResults.filter((r) => r.success);

    sendStatusMessage(`Uploading ${summarizeAssetTypes(successfulDownloads.map((r) => r.entry))}...`);

    let uploadCompleted = 0;
    const uploadStartTime = Date.now();
    const defaultLimit = 15;

    let userLimit = data.maxConcurrentUploads
      ? parseInt(data.maxConcurrentUploads, 10)
      : defaultLimit;

    if (!Number.isFinite(userLimit) || userLimit < 1) {
      userLimit = defaultLimit;
    }

    const UPLOAD_CONCURRENCY = Math.max(1, Math.min(userLimit, successfulDownloads.length || 1));

    const uploadOne = async (downloadResult) => {
      const entry = downloadResult.entry;
      const entryAssetTypeName = getEntryAssetTypeName(entry);
      const filePath = downloadResult.filePath;
      const uploadTransferId = crypto.randomUUID();
      const fileSize = (await fs.stat(filePath).catch(() => ({ size: 0 }))).size;
      const finalName = buildFinalUploadName(entry, data);

      sendTransferUpdate({
        id: uploadTransferId,
        name: finalName,
        originalAssetId: entry.id,
        status: 'queued',
        direction: 'upload',
        progress: 0,
        size: fileSize,
      });
      const onRetryAttempt = (attempt, maxAttempts, err) => {
        const errMsg = err.message || '';
        const isRateLimit = errMsg.includes('429') || errMsg.includes('Rate limit');
        const isFinal = attempt >= maxAttempts;
        const logMsg = isRateLimit
          ? `Upload attempt ${attempt}/${maxAttempts} for ${entry.name} rate-limited (429).${isFinal ? ' No more retries.' : ' Retrying with delay...'}`
          : `Upload attempt ${attempt}/${maxAttempts} for ${entry.name} failed.${isFinal ? ' No more retries.' : ' Retrying...'}`;
        if (DEVELOPER_MODE && isRateLimit) {
          console.warn(`(Dev) [RATE LIMIT DETECTED] ${entry.name}: ${errMsg}`);
        }
        sendTransferUpdate({
          id: uploadTransferId,
          status: 'processing',
          message: logMsg,
          error: errMsg.substring(0, 120),
        });
      };
      const uploadFn = async () => {
        await checkPaused();
        const finalName = buildFinalUploadName(entry, data);

        let result = await publishAnimationRbxmWithProgress(
          filePath,
          finalName,
          robloxCookie,
          null,
          data.groupId && String(data.groupId).trim() ? data.groupId : null,
          uploadTransferId,
          sendTransferUpdate,
          entryAssetTypeName,
          data.apiKey || null,
          authenticatedUserId || null,
          { abortSignal: getAbortSignal() },
        );
        if (!result.success) {
          const error = new Error(result.error || 'Upload failed');
          if (result.nonRetryable) error.nonRetryable = true;
          throw error;
        }
        return result;
      };
      try {
        const uploadResult = await retryAsync(
          uploadFn,
          UPLOAD_RETRIES,
          UPLOAD_RETRY_DELAY_MS,
          onRetryAttempt,
        );
        if (uploadResult.success && uploadResult.assetId) {
          session.completedMappings.push({
            originalId: String(entry.id),
            newId: uploadResult.assetId,
          });
          await saveSession(session);
        }
        uploadCompleted++;
        sendSpooferProgress({
          phase: 'upload',
          current: uploadCompleted,
          total: successfulDownloads.length,
        });
        const elapsed = (Date.now() - uploadStartTime) / 1000;
        const avgTimePerItem = elapsed / uploadCompleted;
        const remaining = successfulDownloads.length - uploadCompleted;
        const etaSeconds = Math.ceil(avgTimePerItem * remaining);
        const etaMin = Math.floor(etaSeconds / 60);
        const etaSec = etaSeconds % 60;
        const etaStr = remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
        const actionText = 'Uploaded';
        sendStatusMessage(`${actionText} ${uploadCompleted}/${successfulDownloads.length} assets${etaStr}`);
        return {
          entry,
          success: uploadResult.success,
          assetId: uploadResult.assetId,
          error: uploadResult.error,
        };
      } catch (finalRetryError) {
        sendTransferUpdate({
          id: uploadTransferId,
          status: 'error',
          error: `All upload attempts failed: ${finalRetryError.message}`,
        });
        uploadCompleted++;
        sendSpooferProgress({
          phase: 'upload',
          current: uploadCompleted,
          total: successfulDownloads.length,
        });
        const elapsed = (Date.now() - uploadStartTime) / 1000;
        const avgTimePerItem = elapsed / uploadCompleted;
        const remaining = successfulDownloads.length - uploadCompleted;
        const etaSeconds = Math.ceil(avgTimePerItem * remaining);
        const etaMin = Math.floor(etaSeconds / 60);
        const etaSec = etaSeconds % 60;
        const etaStr = remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
        sendStatusMessage(`Uploaded ${uploadCompleted}/${successfulDownloads.length} assets${etaStr}`);
        return { entry, success: false, error: finalRetryError.message };
      }
    };
    uploadResults = await runWithConcurrency(successfulDownloads, UPLOAD_CONCURRENCY, uploadOne);
  }

  for (const downloadResult of downloadResults) {
    const entry = downloadResult.entry;
    const entryLabel = getAssetKindLabel(entry.assetTypeName);
    verboseOutputMessage += `\n--- ${entryLabel}: ${entry.name} (ID: ${entry.id}) ---\n`;
    if (downloadResult.success) {
      downloadedSuccessfullyCount++;

      if (!data.downloadOnly) {
        const uploadResult = uploadResults.find((u) => u.entry.id === entry.id);
        if (uploadResult) {
          if (uploadResult.success) {
            successfulUploadCount++;
            uploadMappingOutput += `${entry.id} = ${uploadResult.assetId},\n`;
            verboseOutputMessage += `Uploaded ${entryLabel}: ${entry.name} (Original ID: ${entry.id}) -> New Asset ID: ${uploadResult.assetId}\n`;
          } else {
            console.error(
              `[${entryLabel.toUpperCase()} UPLOAD FAILED] ${entry.name} (ID: ${entry.id}): ${uploadResult.error || 'Unknown upload error'}`,
            );
            verboseOutputMessage += `X ${entryLabel} Upload Failed: ${entry.name} (ID: ${entry.id}): ${uploadResult.error || 'Unknown upload error'}\n`;
          }
        } else {
          console.error(`[UPLOAD SKIPPED] ${entry.name} (ID: ${entry.id}): Download failed.`);
          verboseOutputMessage += `! Skipped Upload for ${entry.name}: Download failed.\n`;
        }
      } else {
        verboseOutputMessage += `Downloaded: ${entry.name} (ID: ${entry.id}) to ${downloadResult.filePath}\n`;
      }
    } else {
      console.error(`[DOWNLOAD FAILED] ${entry.name} (ID: ${entry.id}): ${downloadResult.error}`);
      verboseOutputMessage += `Download Failed: ${entry.name} (ID: ${entry.id}) - ${downloadResult.error}\n`;
    }
  }

  verboseOutputMessage += `\n--- Summary ---\nTotal assets: ${animationEntries.length} (${assetTypeSummary})\nDownloaded: ${downloadedSuccessfullyCount}\n`;
  if (!data.downloadOnly) {
    verboseOutputMessage += `Uploaded: ${successfulUploadCount}\n\n--- Output Mapping ---\n${uploadMappingOutput}`;
  } else {
    verboseOutputMessage += `Uploads: Skipped (Download-Only Mode)\n`;
  }

  if (DEVELOPER_MODE) console.log(`(Dev) Verbose Spoofer Run Log:\n${verboseOutputMessage}`);

  try {
    if (data.downloadOnly) {
      sendStatusMessage(
        `Download Complete: ${downloadedSuccessfullyCount}/${animationEntries.length} files saved to ${downloadsDir}`,
      );
    } else {
      sendStatusMessage(
        `Operation Successful: ${successfulUploadCount}/${animationEntries.length}`,
      );
    }
  } catch (e) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to send final status message', e);
  }

  const downloadFailures = downloadResults
    .filter((r) => !r.success)
    .map((r) => ({
      id: r.entry.id,
      name: r.entry.name,
      reason: r.error || 'Unknown error',
    }));
  const uploadFailures = data.downloadOnly
    ? []
    : (uploadResults || [])
        .filter((u) => !u.success)
        .map((u) => ({
          id: u.entry.id,
          name: u.entry.name,
          reason: u.error || 'Unknown error',
        }));

  const rateLimitFailures = uploadFailures.filter(
    (f) => (f.reason || '').includes('429') || (f.reason || '').includes('Rate limit'),
  );

  const skippedUploadsCount = data.downloadOnly ? 0 : downloadFailures.length;

  const listFailures = (label, items) => {
    if (!items || items.length === 0) return '';
    const maxItems = 5;
    const lines = items
      .slice(0, maxItems)
      .map((it) => `- ${it.name} (ID: ${it.id}) - ${it.reason}`);
    const remaining = items.length - maxItems;
    return `${label}:\n${lines.join('\n')}${remaining > 0 ? `\n(+${remaining} more)` : ''}\n`;
  };

  let runSummary =
    `\n--- Summary ---\n` +
    `Mode: ${data.downloadOnly ? 'Download-Only' : 'Download + Upload'}\n` +
    `Total assets: ${animationEntries.length} (${assetTypeSummary})\n` +
    `Downloaded: ${downloadedSuccessfullyCount}/${animationEntries.length}${downloadFailures.length ? ` (Failed: ${downloadFailures.length})` : ''}\n` +
    (!data.downloadOnly
      ? `Uploaded: ${successfulUploadCount}/${downloadResults.filter((r) => r.success).length}${uploadFailures.length ? ` (Failed: ${uploadFailures.length}, Skipped: ${skippedUploadsCount})` : skippedUploadsCount ? ` (Skipped: ${skippedUploadsCount})` : ''}\n`
      : '');

  if (invalidAssetLines.length || duplicateAssetLines.length) {
    const parseNotes = [];
    invalidAssetLines.slice(0, 5).forEach((item) => {
      parseNotes.push(`- Line ${item.line}: ${item.reason}`);
    });
    duplicateAssetLines.slice(0, 5).forEach((item) => {
      parseNotes.push(`- Line ${item.line}: duplicate asset ID ${item.id}`);
    });
    const skippedCount = invalidAssetLines.length + duplicateAssetLines.length;
    runSummary += `\nInput lines skipped: ${skippedCount}\n${parseNotes.join('\n')}${skippedCount > parseNotes.length ? `\n(+${skippedCount - parseNotes.length} more)` : ''}\n`;
  }

  if (downloadFailures.length) {
    runSummary += `\n` + listFailures('Download failures', downloadFailures);
  }
  if (!data.downloadOnly && uploadFailures.length) {
    runSummary += `\n` + listFailures('Upload failures', uploadFailures);
  }

  if (rateLimitFailures.length > 0) {
    const suggestedDelay = Math.min(Math.max(UPLOAD_RETRY_DELAY_MS * 2, 10000), 60000);
    runSummary += `\nRATE LIMIT DETECTED (429): ${rateLimitFailures.length} upload(s) hit rate limits.\n`;
    runSummary += `   Recommendation: Try again with higher "Retry Delay" (current: ${UPLOAD_RETRY_DELAY_MS}ms, suggested: ${suggestedDelay}ms)\n`;
    runSummary += `   Or increase "Upload Retries" for more attempts.\n`;
  }

  let finalOutput;
  if (data.downloadOnly) {
    const successfulDownloadsList = downloadResults
      .filter((r) => r.success)
      .map((r) => `${getAssetKindLabel(r.entry.assetTypeName)}: ${r.entry.name} (ID: ${r.entry.id})`)
      .join('\n');

    if (successfulDownloadsList) {
      finalOutput = `Downloaded ${downloadedSuccessfullyCount}/${animationEntries.length} assets to:\n${downloadsDir}\n\nFiles:\n${successfulDownloadsList}`;
    } else {
      finalOutput = 'No assets were successfully downloaded.';
    }
  } else if (uploadMappingOutput.trim()) {
    finalOutput = uploadMappingOutput.trim().replace(/,$/, '');
    if (
      downloadFailures.length ||
      uploadFailures.length ||
      invalidAssetLines.length ||
      duplicateAssetLines.length
    ) {
      finalOutput += `\n${runSummary}`;
    }
  } else {
    if (downloadedSuccessfullyCount > 0 && successfulUploadCount === 0) {
      finalOutput = `Downloads successful (${downloadedSuccessfullyCount}/${animationEntries.length}), but no assets were successfully uploaded.\n${runSummary}`;
    } else if (animationEntries.length > 0) {
      finalOutput = hasAuthError
        ? 'Authentication failed. Please check your Roblox cookie.'
        : `No assets were successfully processed to provide mappings. Valid entries were parsed, but every download or upload failed.\n${runSummary}`;
    } else {
      finalOutput = 'No operations performed.';
    }
  }

  try {
    if (DEVELOPER_MODE) {
      console.log('(Dev) Run Summary:\n' + runSummary);
    } else {
      console.log('Run Summary:\n' + runSummary);
    }
  } catch {}

  const hasSuccess = downloadedSuccessfullyCount > 0 || successfulUploadCount > 0;
  const isFullySuccessful =
    downloadedSuccessfullyCount === animationEntries.length &&
    (data.downloadOnly || successfulUploadCount === downloadedSuccessfullyCount);

  let jobStatus = 'error';
  if (hasSuccess) {
    jobStatus = isFullySuccessful ? 'success' : 'partial';
  }

  const jobRecord = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    status: jobStatus,
    output: finalOutput,
    payload: data,
  };
  await saveJobRecord(jobRecord);

  sendSpooferResultToRenderer({
    output: finalOutput,
    success: hasSuccess,
    status: jobStatus,
    job: jobRecord,
  });
  if (data.desktopNotifications !== false) {
    const action = data.downloadOnly ? 'downloaded' : 'uploaded';
    showDesktopNotification(
      'ISpooferMotion Complete',
      `Assets ${action}: ${data.downloadOnly ? downloadedSuccessfullyCount : successfulUploadCount}/${animationEntries.length}.`,
    );
  }

  await clearSession();

  if (!data.downloadOnly) {
    try {
      await clearDownloadsDirectory(downloadsDir, false);
      if (DEVELOPER_MODE) console.log('(Dev) Downloads directory cleared after operation');
    } catch (err) {
      if (DEVELOPER_MODE)
        console.warn('(Dev) Failed to clear downloads directory after operation:', err.message);
    }
  } else {
    if (DEVELOPER_MODE) console.log('(Dev) Download-only mode: keeping files in', downloadsDir);
  }
}

module.exports = {
  registerIpcHandlers,
  __private: {
    buildDirectAssetDownloadAttempts,
    buildDirectAssetDownloadUrls,
    extractBatchLocationError,
    getPlaceIdFromDownloadUrl,
    getAssetCreatorFromDetails,
    getAssetMetadataFromDetails,
    hasBatchAccessDeniedErrors,
    hasBatchLocationSuccess,
    applyResolvedAssetMetadata,
    getSpooferInputTypeMarker,
    parseSpooferAssetLine,
    setBatchLocation,
    uniquePlaceIds,
    validateDownloadedAssetFile,
  },
};
