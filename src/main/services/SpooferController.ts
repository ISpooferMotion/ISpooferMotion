// @ts-nocheck
import { withTimeout, readResponseText, readJsonResponse, ROBLOX_USER_AGENT, debugLog, debugWarn } from './auth';

import * as fs from 'fs/promises';
import * as path from 'path';
import { DEVELOPER_MODE, clearDownloadsDirectory } from './common';
import { getAbortSignal, checkPaused, checkCancelled } from './ProcessManager';
import { showDesktopNotification } from './IpcRegistry';
import { clearSession, saveSession } from './session';
import { saveJobRecord } from './jobs';
import { getAuthenticatedUserId } from './auth';
import { buildFinalUploadName } from './replacement-utils';
import { AssetService } from './AssetService';
import { inspectTransferPayload } from './payload-inspector';
import { RobloxApiService } from './RobloxApiService';

import { createRobloxSession } from './roblox-session';


import { evictPlaceId, recordSuccessfulPlaceId, savePlaceIdCache } from './place-id-cache';
import { sanitizeFilename, retryAsync } from './common';
import { downloadAnimationAssetWithProgress, publishAnimationRbxmWithProgress } from './transfer-handlers';


export class SpooferController {
  private static batchRateLimitUntil = 0;
  private static batchNextRequestAt = 0;
  private static batchRequestIntervalMs = 100;
  private static spooferRunActive = false;
  
  public static setBatchRateLimit(ms) {
    SpooferController.batchRateLimitUntil = Math.max(SpooferController.batchRateLimitUntil, Date.now() + ms);
  }
  
  
  public static async waitBatchRateLimit() {
    const waitMs = SpooferController.batchRateLimitUntil - Date.now();
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  
  
  public static async waitBatchRequestSlot() {
    await waitBatchRateLimit();
    const waitMs = SpooferController.batchNextRequestAt - Date.now();
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
    SpooferController.batchNextRequestAt = Date.now() + SpooferController.batchRequestIntervalMs;
  }
  
  
  public static updateBatchRateLimitFromHeaders(response) {
    const remaining = Number.parseInt(response?.headers?.get('x-ratelimit-remaining') || '', 10);
    const resetSeconds = Number.parseFloat(response?.headers?.get('x-ratelimit-reset') || '');
    if (!Number.isFinite(remaining) || !Number.isFinite(resetSeconds) || resetSeconds <= 0) return;
  
    if (remaining <= 2) {
      setBatchRateLimit(Math.ceil(resetSeconds * 1000) + 250);
      return;
    }
  
    SpooferController.batchRequestIntervalMs = Math.max(
      50,
      Math.min(5_000, Math.ceil((resetSeconds * 1000) / Math.max(1, remaining - 2))),
    );
  }
  
  
  public static getBatchRetryAfterMs(response, attempt = 1) {
    const retryAfterSeconds = parseInt(response?.headers?.get('retry-after') || '0', 10);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }
    const baseMs = 15000;
    const expMs = baseMs * Math.pow(2, attempt - 1);
    return Math.floor(expMs + Math.random() * 2000);
  }
  
  
  private static runWithConcurrency = async (items, limit, worker) => {
    const results = new Array(items.length);
    let index = 0;
    let cancelled = false;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (true) {
        if (cancelled) break;
        try {
          checkCancelled();
          await checkPaused();
        } catch (err: any) {
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
        } catch (err: any) {
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
  
  public static getBatchLocationErrors(loc) {
    return Array.isArray(loc?.errors) ? loc.errors : [];
  }
  
  
  public static getBatchLocationErrorMessage(error) {
    if (!error || typeof error !== 'object') return String(error || '');
    return error.Message || error.message || JSON.stringify(error) || '';
  }
  
  
  public static hasBatchLocationSuccess(loc) {
    return Array.isArray(loc?.locations) && loc.locations.some((location) => location?.location);
  }
  
  
  public static hasBatchAccessDeniedErrors(loc) {
    return SpooferController.getBatchLocationErrors(loc).some((error) => {
      const status = Number(error?.code || error?.Code || error?.status || error?.statusCode || 0);
      const message = SpooferController.getBatchLocationErrorMessage(error);
      return (
        status === 403 || /\b403\b|not authorized|unauthorized|forbidden|permission/i.test(message)
      );
    });
  }
  
  
  public static setBatchLocation(locationsMap, loc) {
    if (!loc?.requestId) return;
    const existing = locationsMap[loc.requestId];
    if (SpooferController.hasBatchLocationSuccess(existing) && !SpooferController.hasBatchLocationSuccess(loc)) return;
    locationsMap[loc.requestId] = loc;
  }
  
  
  public static extractBatchLocationError(loc) {
    if (!loc) return 'No location in batch response';
    const errors = SpooferController.getBatchLocationErrors(loc);
    if (errors.length === 0) return 'No locations in batch response';
  
    return SpooferController.getBatchLocationErrorMessage(errors[0]) || 'Unknown batch error';
  }
  
  
  public static normalizeSpooferInputLine(line) {
    return String(line || '')
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\u2060]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim();
  }
  
  
  public static isSpooferOutputMetadataLine(line) {
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
  
  
  public static getSpooferInputTypeMarker(text) {
    const source = String(text || '');
    const hasSoundMarker = /\bTYPE\s*:\s*SOUND\b/i.test(source);
    const hasAnimationMarker = /\bTYPE\s*:\s*ANIMATION\b/i.test(source);
    if (/\bTYPE\s*:\s*(MIXED|BOTH)\b/i.test(source)) return null;
    if (hasSoundMarker && !hasAnimationMarker) return 'sound';
    if (hasAnimationMarker && !hasSoundMarker) return 'animation';
    return null;
  }
  
  
  public static parseSpooferAssetLine(trimmedLine) {
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
        placeId = AssetService.normalizePlaceContextId(extraToken);
        if (!placeId) {
          return { error: 'Place ID must be numeric.' };
        }
      } else if (/^(type|assettype|kind)/i.test(extraToken)) {
        assetTypeName = AssetService.normalizeAssetTypeName(extraToken);
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
  
  
  public static async validateDownloadedAssetFile(filePath, assetTypeName) {
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
  
  public static async handleSpooferAction(
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
      ? String(data.overridePlaceId).replace(/[^0-9,\s]/g, '')
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
      ? inputTypeMarker === 'mixed'
        ? ''
        : inputTypeMarker === 'sound'
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
      const msg = `Smart Dedup: ${assetEntries.length} valid entries. Skipped ${duplicateAssetLines.length} duplicates and ${invalidAssetLines.length} invalid lines.`;
      console.warn(`[INPUT] Processing ${assetEntries.length} valid entries; skipped ${invalidAssetLines.length} invalid and ${duplicateAssetLines.length} duplicate line(s).`);
      sendStatusMessage(msg);
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
      } catch (err: any) {
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
  
    let preflightAuthUserId;
    sendStatusMessage('Validating Roblox session...');
    try {
      preflightAuthUserId = await getAuthenticatedUserId(robloxCookie);
      if (DEVELOPER_MODE)
        console.log(`(Dev) Cookie pre-flight OK — authenticated as user ${preflightAuthUserId}`);
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
      
      const beforeFilterCount = animationEntries.length;
      animationEntries.splice(
        0,
        animationEntries.length,
        ...animationEntries.filter((entry) => String(entry.creatorId) !== '1')
      );
      if (animationEntries.length < beforeFilterCount) {
        const skipped = beforeFilterCount - animationEntries.length;
        console.log(`[FILTER] Ignored ${skipped} core Roblox asset(s) (Creator ID 1).`);
      }

      for (const entry of animationEntries) {
        if (!entry.assetTypeName) entry.assetTypeName = 'Animation';
      }
      if (resolvedMetadataCount > 0) {
        console.log(
          `[METADATA] Resolved ${resolvedMetadataCount}/${animationEntries.length} asset metadata entr${resolvedMetadataCount === 1 ? 'y' : 'ies'} from Roblox.`,
        );
      }
    } catch (err: any) {
      for (const entry of animationEntries) {
        if (!entry.assetTypeName) entry.assetTypeName = 'Animation';
      }
      if (DEVELOPER_MODE) {
        console.warn(`(Dev) Failed to refresh asset names: ${err.message}`);
      }
    }
  
    const assetTypeSummary = AssetService.summarizeAssetTypes(animationEntries);
  
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
    // True when all batch locations came back access-denied (403) but the HTTP request
    // itself succeeded — this means the assets are private/restricted, NOT that the cookie
    // is bad. Keeping it separate prevents a false "check your cookie" message.
    let hasPlaceContextError = false;
  
    const maxPlaceIds = data.maxPlaceIds || 200;
    const maxPlaceIdRetries = data.maxPlaceIdRetries || 3;
    const overridePlaceIds = data.overridePlaceId 
      ? String(data.overridePlaceId).split(',').map(s => Number.parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0)
      : [];
    const uniqueCreators = [
      ...new Set(animationEntries.map((e) => `${e.creatorType}:${e.creatorId}`)),
    ];
    const entryPlaceIdsByCreator = {};
    for (const creatorKey of uniqueCreators) {
      entryPlaceIdsByCreator[creatorKey] = AssetService.uniquePlaceIds(
        animationEntries
          .filter((entry) => `${entry.creatorType}:${entry.creatorId}` === creatorKey)
          .map((entry) => entry.placeId),
      );
    }
  
    const userDataPath = app.getPath('userData');
    let placeIdCacheEntries = {};
    try {
      const rawCache = await loadPlaceIdCache(userDataPath);
      placeIdCacheEntries = pruneExpiredEntries(rawCache);
      const cachedCreatorCount = Object.keys(placeIdCacheEntries).length;
      if (DEVELOPER_MODE && cachedCreatorCount > 0)
        console.log(`(Dev) Loaded placeId cache with ${cachedCreatorCount} creator(s)`);
    } catch (cacheErr: any) {
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
  
      await SpooferController.runWithConcurrency(uniqueCreators, 5, async (creatorKey) => {
        const [creatorType, creatorId] = creatorKey.split(':');
        // Prepend cached (proven) placeIds so they are tried before fresh discovery.
        const cachedIds = getCachedPlaceIds(placeIdCacheEntries, creatorKey);
        if (cachedIds.length > 0 && DEVELOPER_MODE)
          console.log(`(Dev) Cache hit for ${creatorKey}: ${cachedIds.length} cached placeId(s)`);
        try {
          const placeIds = await retryAsync(
            () => AssetService.getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
            maxPlaceIdRetries,
            1000,
            (attempt, max, err) => {
              if (DEVELOPER_MODE)
                console.warn(`(Dev) Attempt ${attempt}/${max} for ${creatorKey}: ${err.message}`);
            },
          );
          placeIdMap[creatorKey] = AssetService.uniquePlaceIds(
            entryPlaceIdsByCreator[creatorKey],
            cachedIds,
            placeIds,
          );
          if (DEVELOPER_MODE)
            console.log(
              `(Dev) Got ${placeIdMap[creatorKey].length} placeIds for ${creatorKey} (${cachedIds.length} cached)`,
            );
        } catch (error: any) {
          if (DEVELOPER_MODE)
            console.warn(`(Dev) Could not get placeIds for ${creatorKey}: ${error.message}`);
          placeIdMap[creatorKey] = AssetService.uniquePlaceIds(entryPlaceIdsByCreator[creatorKey], cachedIds);
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
            placeIdMap[creatorKey] = AssetService.uniquePlaceIds(entryPlaceIdsByCreator[creatorKey], fallbackPool);
            if (DEVELOPER_MODE)
              console.log(
                `(Dev) Assigned ${placeIdMap[creatorKey].length} fallback place IDs to ${creatorKey}`,
              );
          }
        }
      }
  
      if (overridePlaceIds && overridePlaceIds.length > 0) {
        for (const creatorKey of uniqueCreators) {
          placeIdMap[creatorKey] = AssetService.uniquePlaceIds(overridePlaceIds, placeIdMap[creatorKey]);
        }
        if (DEVELOPER_MODE) console.log('(Dev) Prepended overridePlaceIds to all creator placeIdMaps');
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
    await SpooferController.runWithConcurrency(batchTasks, 5, async (task) => {
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
          SpooferController.setBatchLocation(locationsMap, {
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
            } catch (err: any) {
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
              if (SpooferController.hasBatchLocationSuccess(loc)) SpooferController.setBatchLocation(locationsMap, loc);
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
                    () => AssetService.getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
                    1,
                    1000,
                  );
                  placeIdMap[creatorKey] = AssetService.uniquePlaceIds(
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
                } catch (refreshErr: any) {
                  if (DEVELOPER_MODE)
                    console.warn(
                      `(Dev) Failed to refresh placeIds for ${creatorKey}: ${refreshErr.message}`,
                    );
                  for (const loc of locations) {
                    SpooferController.setBatchLocation(locationsMap, loc);
                  }
                  if (
                    locations.every(
                      (loc) => !SpooferController.hasBatchLocationSuccess(loc) && SpooferController.hasBatchAccessDeniedErrors(loc),
                    )
                  ) {
                    // All locations denied — private assets with wrong/missing place context,
                    // NOT a cookie problem.
                    hasPlaceContextError = true;
                  }
                  evictPlaceId(placeIdCacheEntries, creatorKey, placeId);
                  break;
                }
              } else {
                if (DEVELOPER_MODE)
                  console.log(`(Dev) Max retries reached for ${creatorKey}, accepting batch errors`);
                for (const loc of locations) {
                  SpooferController.setBatchLocation(locationsMap, loc);
                }
                if (
                  locations.every(
                    (loc) => !SpooferController.hasBatchLocationSuccess(loc) && SpooferController.hasBatchAccessDeniedErrors(loc),
                  )
                ) {
                  // Max retries reached and all still access-denied — place context issue,
                  // NOT a cookie problem.
                  hasPlaceContextError = true;
                }
                evictPlaceId(placeIdCacheEntries, creatorKey, placeId);
                break;
              }
            }
          } else {
            if (DEVELOPER_MODE)
              console.log(`(Dev) Batch request successful for ${creatorKey} with placeId ${placeId}`);
            for (const loc of locations) {
              SpooferController.setBatchLocation(locationsMap, loc);
              if (SpooferController.hasBatchLocationSuccess(loc) && loc.requestId && placeId) {
                if (data.shareCacheData !== false && typeof fetch === 'function') {
                  try {
                    fetch('https://ispoofermotion.com/api/cache', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        asset_id: String(loc.requestId),
                        place_id: String(placeId),
                      }),
                    }).catch(() => {});
                  } catch {}
                }
              }
            }
            recordSuccessfulPlaceId(placeIdCacheEntries, creatorKey, placeId);
            break;
          }
        }
      } catch (error: any) {
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
            SpooferController.setBatchLocation(locationsMap, { requestId: item.requestId, errors: [{ message: msg }] });
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
    } catch (cacheErr: any) {
      if (DEVELOPER_MODE) console.warn('(Dev) Failed to save placeId cache:', cacheErr.message);
    }
  
    const UPLOAD_RETRIES = parseInt(data.uploadRetries, 10) || 3;
    const UPLOAD_RETRY_DELAY_MS = parseInt(data.uploadRetryDelay, 10) || 5000;
  
    const DOWNLOAD_RETRIES = parseInt(data.downloadRetries, 10) || 2;
    const DOWNLOAD_RETRY_DELAY_MS = parseInt(data.downloadRetryDelayMs, 10) || 2000;
    const DOWNLOAD_TIMEOUT_MS = parseInt(data.downloadTimeoutMs, 10) || 15000;
  
    sendStatusMessage(`Downloading ${assetTypeSummary}...`);
    const defaultDownloadLimit = 20;
    const userDownloadLimit = data.concurrentUploads
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
      const entryAssetTypeName = AssetService.getEntryAssetTypeName(entry);
      const entryIsSound = entryAssetTypeName === 'Audio';
      const loc = locationsMap[entry.id];
      const sanitizedName = sanitizeFilename(entry.name);
      const fileExtension = entryIsSound ? '.ogg' : '.rbxm';
      const fileName = `${sanitizedName}_${entry.id}${fileExtension}`;
      let filePath = path.join(downloadsDir, fileName);
      const downloadTransfer = initialTransferStates.find((t) => t.originalAssetId === entry.id);
      if (!downloadTransfer) {
        console.error(`[DOWNLOAD] No transfer state found for entry id=${entry.id}, skipping.`);
        return;
      }
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
          const validation = await SpooferController.validateDownloadedAssetFile(filePath, entryAssetTypeName);
          filePath = validation.filePath;
          return {
            ...downloadResult,
            filePath,
            payloadMetadata: validation.payloadMetadata,
          };
        } catch (error: any) {
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
          AssetService.getPlaceIdFromDownloadUrl(batchLocation) || entryPlaceId,
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
        batchErrorMessage = batchErrorMessage || SpooferController.extractBatchLocationError(loc);
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
              AssetService.getPlaceIdFromDownloadUrl(scrapedUrl),
              true,
            );
            if (result && result.success) {
              scraperSuccess = true;
            }
          }
        }
  
        if (!scraperSuccess) {
          const directAttempts = AssetService.buildDirectAssetDownloadAttempts(
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
          const batchIsAccessDenied = /403|forbidden|not authorized|unauthorized|permission/i.test(
            String(batchErrorMessage || ''),
          );
          const directIsAccessDenied = /403|forbidden|not authorized|unauthorized|permission/i.test(
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
    const downloadResults = await SpooferController.runWithConcurrency(
      animationEntries,
      DOWNLOAD_CONCURRENCY,
      downloadOne,
    );
  
    let authenticatedUserId = null;
    if (!data.downloadOnly && data.apiKey && !data.groupId) {
      try {
        const ownerDetection = await RobloxApiService.detectOpenCloudApiKeyOwner(data.apiKey);
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
      } catch (err: any) {
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
  
      sendStatusMessage(
        `Uploading ${AssetService.summarizeAssetTypes(successfulDownloads.map((r) => r.entry))}...`,
      );
  
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
        const entryAssetTypeName = AssetService.getEntryAssetTypeName(entry);
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
  
          const result = await publishAnimationRbxmWithProgress(
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
          sendStatusMessage(
            `${actionText} ${uploadCompleted}/${successfulDownloads.length} assets${etaStr}`,
          );
          return {
            entry,
            success: uploadResult.success,
            assetId: uploadResult.assetId,
            error: uploadResult.error,
          };
        } catch (finalRetryError: any) {
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
          sendStatusMessage(
            `Uploaded ${uploadCompleted}/${successfulDownloads.length} assets${etaStr}`,
          );
          return { entry, success: false, error: finalRetryError.message };
        }
      };
      uploadResults = await SpooferController.runWithConcurrency(successfulDownloads, UPLOAD_CONCURRENCY, uploadOne);
    }
  
    for (const downloadResult of downloadResults) {
      const entry = downloadResult.entry;
      const entryLabel = AssetService.getAssetKindLabel(entry.assetTypeName);
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
        .map(
          (r) => `${AssetService.getAssetKindLabel(r.entry.assetTypeName)}: ${r.entry.name} (ID: ${r.entry.id})`,
        )
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
        if (hasAuthError) {
          // Real HTTP-level 401/403 on the batch endpoint — the cookie itself is the problem.
          finalOutput =
            'Authentication failed. Your ROBLOSECURITY cookie is invalid or expired.\n\n' +
            'How to fix:\n' +
            '  1. Open Roblox in your browser and make sure you are logged in.\n' +
            '  2. Re-copy your .ROBLOSECURITY cookie and paste it into the Cookie field.\n' +
            '  3. If "Auto detect cookie" is enabled, try disabling it and pasting the cookie manually.\n' +
            '  4. Note: Roblox rotates cookies after each login — a cookie copied days ago may be expired.\n' +
            `\n${runSummary}`;
        } else if (hasPlaceContextError) {
          // Assets exist and the cookie is fine, but every download was 403'd because
          // no compatible place context could be found for private/restricted assets.
          finalOutput =
            'All assets failed with access denied (403). Your cookie appears valid, but the assets could not be accessed.\n\n' +
            'This usually means the assets are private or restricted. To fix:\n' +
            '  • Add an Override Place ID — use a place ID from a game you own or have access to that uses these assets.\n' +
            '  • Or re-import asset IDs using the Studio plugin scan, which automatically includes place context.\n' +
            '  • If the asset creator has no public games, the batch API cannot resolve download URLs for their assets.\n' +
            `\n${runSummary}`;
        } else {
          finalOutput = `No assets were successfully processed to provide mappings. Valid entries were parsed, but every download or upload failed.\n${runSummary}`;
        }
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
  
    const safePayload = { ...data };
    delete safePayload.robloxCookie;
    delete safePayload.apiKey;
    const jobRecord = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      status: jobStatus,
      output: finalOutput,
      payload: safePayload,
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
      } catch (err: any) {
        if (DEVELOPER_MODE)
          console.warn('(Dev) Failed to clear downloads directory after operation:', err.message);
      }
    } else {
      if (DEVELOPER_MODE) console.log('(Dev) Download-only mode: keeping files in', downloadsDir);
    }
  }
  
}
