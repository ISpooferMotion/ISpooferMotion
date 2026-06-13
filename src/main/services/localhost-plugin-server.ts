'use strict';

const http = require('node:http');
const path = require('node:path');
const { app, Notification, nativeImage } = require('electron');
const { DEVELOPER_MODE } = require('./common');
const { getCookieFromAutoDetect } = require('./auth');
const { createRobloxSession } = require('./roblox-session');
const { getPlaceSuggestionByPlaceId } = require('./assets');

const DEFAULT_PORT = 3100;
const PORT_SCAN_LIMIT = 10;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

let server = null;
let activePort = DEFAULT_PORT;

let pendingReplacement = null;

function pushReplacement(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  const pairs = extractReplacementPairs(trimmed);
  if (pairs.length === 0) return;
  pendingReplacement = {
    text: trimmed,
    pairs,
    pushedAt: new Date().toISOString(),
  };
  if (DEVELOPER_MODE) {
    console.log(`[LocalhostPlugin] pushReplacement: ${pairs.length} pair(s) queued for Studio.`);
  }
}

function resolveIconPath() {
  const assetFile = process.platform === 'win32' ? 'app_icon.ico' : 'app_icon.png';
  const assetPath = path.join(__dirname, '..', 'src', 'assets', assetFile);
  return app.isPackaged ? assetPath.replace('app.asar', 'app.asar.unpacked') : assetPath;
}

function normalizeScanKind(value, fallback = 'animation') {
  const text = String(value || fallback).toLowerCase();
  if (text.includes('sound') || text.includes('audio')) return 'sound';
  return 'animation';
}

function scanLabel(kind) {
  return kind === 'sound' ? 'Sounds' : 'Animations';
}

function firstNumericId(...values) {
  for (const value of values) {
    const match = String(value ?? '').match(/\d+/);
    if (match) return match[0];
  }
  return '';
}

function cleanText(value, fallback = 'Unknown') {
  const clean = String(value || fallback)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\][]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const text = clean.replace(/\[\s*]/g, '[]');
  return text || fallback;
}

function normalizeCreatorType(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('group') ? 'Group' : 'User';
}

function normalizePlaceId(value) {
  const id = firstNumericId(value);
  return id && id !== '0' ? id : '';
}

function normalizeAssetEntry(entry, defaultPlaceId = '') {
  if (typeof entry === 'string' || typeof entry === 'number') {
    const id = firstNumericId(entry);
    if (!id) return null;
    return {
      assetId: id,
      name: 'Unknown',
      creatorType: 'User',
      creatorId: '',
      placeId: normalizePlaceId(defaultPlaceId),
    };
  }

  if (!entry || typeof entry !== 'object') return null;
  const assetId = firstNumericId(
    entry.assetId,
    entry.id,
    entry.animationId,
    entry.soundId,
    entry.rawUrl,
  );
  if (!assetId) return null;

  const creatorType = normalizeCreatorType(
    entry.creatorType || entry.creator?.CreatorType || entry.creator?.type || entry.CreatorType,
  );
  const creatorId = firstNumericId(
    entry.creatorId,
    entry.creatorTargetId,
    entry.creator?.CreatorTargetId,
    entry.creator?.Id,
    entry.creator?.id,
    entry.CreatorTargetId,
    entry.CreatorId,
  );

  if (creatorType === 'User' && creatorId === '1') return null;

  return {
    assetId,
    name: cleanText(entry.name || entry.assetName || entry.Name, assetId),
    creatorType,
    creatorId,
    placeId: normalizePlaceId(entry.placeId || entry.PlaceId || entry.place?.id || defaultPlaceId),
  };
}

function normalizeAssets(payload) {
  const payloadPlaceId = normalizePlaceId(
    payload?.placeId || payload?.PlaceId || payload?.game?.placeId,
  );
  const sourceAssets = Array.isArray(payload?.assets)
    ? payload.assets
    : Array.isArray(payload?.ids)
      ? payload.ids
      : Array.isArray(payload?.results)
        ? payload.results
        : [];

  const seen = new Set();
  const assets = [];
  for (const rawEntry of sourceAssets) {
    const entry = normalizeAssetEntry(rawEntry, payloadPlaceId);
    if (!entry || seen.has(entry.assetId)) continue;
    seen.add(entry.assetId);
    assets.push(entry);
  }
  return assets;
}

function appendPlaceContextToLine(line) {
  const trimmed = String(line || '').trim();
  return trimmed ? `${trimmed.replace(/,?\s*$/, '')},` : trimmed;
}

function formatAssetsForInput(assets) {
  return assets
    .filter((asset) => asset.assetId && asset.creatorId)
    .map((asset) => {
      const base = `[${asset.assetId}] [${cleanText(asset.name, asset.assetId)}] [${asset.creatorType}:${asset.creatorId}]`;
      return appendPlaceContextToLine(base);
    })
    .join('\n');
}

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': 'http://localhost',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });

    req.on('error', reject);
  });
}

function showScanNotification(kind, count) {
  try {
    if (!Notification.isSupported()) return false;
    new Notification({
      title: 'ISpooferMotion Scan Finished',
      body: `${scanLabel(kind)} scan is finished. ${count} ID${count === 1 ? '' : 's'} were sent to the app.`,
      icon: nativeImage.createFromPath(resolveIconPath()),
    }).show();
    return true;
  } catch (error) {
    if (DEVELOPER_MODE) console.warn('[LocalhostPlugin] Notification failed:', error);
    return false;
  }
}



const METADATA_CONCURRENCY = 30;
const ECONOMY_DETAIL_BASE = 'https://economy.roblox.com/v2/assets';
const ROBLOX_USER_AGENT = 'RobloxStudio/WinInet';
const ASSET_TYPE_IDS = { animation: 24, sound: 3 };

async function fetchSingleAssetDetail(id, placeId, session, attempt = 1) {
  const url = `${ECONOMY_DETAIL_BASE}/${id}/details`;
  const headers = {
    'User-Agent': ROBLOX_USER_AGENT,
    Accept: 'application/json',
  };
  if (placeId) headers['Roblox-Place-Id'] = placeId;

  try {
    const signal =
      typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(15_000) : undefined;
    const fetchFn = session ? (u, o) => session.fetch(u, o) : fetch;
    const response = await fetchFn(url, { headers, signal, includeCookie: false });

    if (response.status === 429 && attempt <= 5) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return fetchSingleAssetDetail(id, placeId, session, attempt + 1);
    }

    if (!response.ok) return null;

    const json = await response.json();
    return json && json.AssetId ? json : null;
  } catch (err) {
    if (attempt <= 5 && err.name !== 'AbortError') {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return fetchSingleAssetDetail(id, placeId, session, attempt + 1);
    }
    return null;
  }
}

async function batchResolveMetadata(
  candidateIds,
  kind,
  session,
  placeId,
  fallbackCreator,
  names = {},
  onProgress,
  confirmedIds = new Set(),
) {
  const results = [];
  const privateIds = [];

  const seen = new Set();
  const ids = candidateIds.filter((id) => {
    const s = String(id);
    if (seen.has(s)) return false;
    seen.add(s);
    if (s[0] === '0') return false;
    const len = s.length;
    return len >= 7 && len <= 15;
  });

  let processedCount = 0;
  let index = 0;

  const worker = async () => {
    while (index < ids.length) {
      const i = index++;
      const id = ids[i];
      const item = await fetchSingleAssetDetail(id, placeId, session);

      processedCount++;
      if (onProgress) onProgress(processedCount, ids.length);

      if (!item) {
        if (confirmedIds.has(String(id))) {
          privateIds.push(id);
        }
        continue;
      }

      const expectedTypeId = ASSET_TYPE_IDS[kind];
      if (expectedTypeId && item.AssetTypeId !== expectedTypeId) continue;

      const creatorType = normalizeCreatorType(
        item.Creator?.CreatorType || item.creator?.CreatorType || item.creatorType,
      );
      const creatorId = firstNumericId(
        item.Creator?.CreatorTargetId,
        item.Creator?.Id,
        item.creator?.CreatorTargetId,
        item.creator?.Id,
        item.creatorTargetId,
        item.creatorId,
      );

      const strCreatorId = String(creatorId || '');
      if (!strCreatorId || strCreatorId === '0' || strCreatorId === '1') continue;

      results.push({
        assetId: String(item.AssetId || id),
        name: cleanText(item.Name || item.name, id),
        creatorType,
        creatorId: strCreatorId,
        placeId: normalizePlaceId(placeId),
      });
    }
  };

  const workers = Array.from({ length: Math.min(METADATA_CONCURRENCY, ids.length) }, () =>
    worker(),
  );
  await Promise.all(workers);

  if (results.length > 0) {
    const creatorCounts = {};
    for (const r of results) {
      if (r.creatorId && r.creatorId !== 'Unknown' && r.creatorId !== '1') {
        const key = `${r.creatorType}:${r.creatorId}`;
        creatorCounts[key] = (creatorCounts[key] || 0) + 1;
      }
    }
    let bestCreator = null;
    let maxCount = 0;
    for (const [key, count] of Object.entries(creatorCounts)) {
      if (count > maxCount) {
        maxCount = count;
        bestCreator = key;
      }
    }
    if (bestCreator) {
      const [cType, cId] = bestCreator.split(':');
      fallbackCreator = { creatorType: cType, creatorId: cId };
      if (DEVELOPER_MODE)
        console.log(
          `[LocalhostPlugin] Heuristic detected likely creator: ${cType}:${cId} (${maxCount} assets)`,
        );
    }
  }

  for (const id of privateIds) {
    const contextualName = names[id] || names[String(id)] || 'Unknown';
    results.push({
      assetId: id,
      name: cleanText(contextualName, id),
      creatorType: fallbackCreator?.creatorType || 'User',
      creatorId: fallbackCreator?.creatorId || 'Unknown',
      placeId: normalizePlaceId(placeId),
    });
  }

  return results;
}

async function handleScanPayload(payload, callbacks) {
  const kind = normalizeScanKind(payload?.kind || payload?.type || payload?.scanType);
  const placeId = normalizePlaceId(payload?.placeId || payload?.PlaceId || payload?.game?.placeId);
  const names = payload?.names && typeof payload.names === 'object' ? payload.names : {};

  const rawIds = Array.isArray(payload?.ids) ? payload.ids.map(String) : [];
  const confirmedIdsSet = new Set(
    Array.isArray(payload?.confirmedIds) ? payload.confirmedIds.map(String) : [],
  );

  const processScanAsync = async () => {
    let assets = [];

    if (rawIds.length > 0) {
      callbacks.sendStatusMessage(
        `Resolving ${rawIds.length} candidate ID${rawIds.length === 1 ? '' : 's'}...`,
      );
      try {
        const cookie = await getCookieFromAutoDetect();

        let fallbackCreator = { creatorType: 'User', creatorId: '' };
        if (payload.gameCreatorId && String(payload.gameCreatorId) !== '0') {
          fallbackCreator = {
            creatorType: payload.gameCreatorType === 1 ? 'Group' : 'User',
            creatorId: String(payload.gameCreatorId),
          };
        } else if (payload.studioUserId && String(payload.studioUserId) !== '0') {
          fallbackCreator = {
            creatorType: 'User',
            creatorId: String(payload.studioUserId),
          };
        } else if (placeId && cookie) {
          try {
            const suggestion = await getPlaceSuggestionByPlaceId(placeId, cookie);
            if (suggestion) {
              fallbackCreator = {
                creatorType: suggestion.creatorType,
                creatorId: suggestion.creatorId,
              };
            }
          } catch (e) {
            if (DEVELOPER_MODE)
              console.warn('[LocalhostPlugin] place suggestion fetch failed:', e.message);
          }
        }

        if (cookie) {
          const session = createRobloxSession(cookie);
          assets = await batchResolveMetadata(
            rawIds,
            kind,
            session,
            placeId,
            fallbackCreator,
            names,
            (processed, total) => {
              callbacks.sendStatusMessage(`Resolving metadata... (${processed}/${total})`);
            },
            confirmedIdsSet,
          );
          if (DEVELOPER_MODE)
            console.log(
              `[LocalhostPlugin] Resolved ${assets.length} assets from ${rawIds.length} candidates.`,
            );
        } else {
          if (DEVELOPER_MODE)
            console.warn(
              '[LocalhostPlugin] No Roblox session cookie found; falling back to raw IDs.',
            );
          for (const id of rawIds) {
            const s = String(id);
            if (s[0] === '0' || s.length < 7 || s.length > 15) continue;
            if (confirmedIdsSet.has(s)) {
              assets.push({
                assetId: s,
                name: names[s] || 'Unknown',
                creatorType: fallbackCreator?.creatorType || 'User',
                creatorId: fallbackCreator?.creatorId || 'Unknown',
                placeId,
              });
            }
          }
        }
      } catch (err) {
        if (DEVELOPER_MODE)
          console.error('[LocalhostPlugin] batchResolveMetadata failed:', err.message);
      }
    } else {
      assets = normalizeAssets(payload);
    }

    const text = assets.length > 0 ? formatAssetsForInput(assets) : '';
    const lines = text ? text.split(/\r?\n/).filter(Boolean) : [];
    const count = lines.length;

    const scanResult = {
      kind,
      label: scanLabel(kind),
      count,
      text,
      lines,
      placeId: placeId || null,
      source: 'localhost-plugin',
      receivedAt: new Date().toISOString(),
    };

    if (count > 0) callbacks.sendScanResults(scanResult);
    const statusMessage =
      count > 0
        ? `${scanLabel(kind)} scan imported: ${count} ID${count === 1 ? '' : 's'}.`
        : `${scanLabel(kind)} scan received, but no importable IDs were found.`;
    callbacks.sendStatusMessage(statusMessage);
    if (count > 0) showScanNotification(kind, count);

    if (DEVELOPER_MODE) {
      console.log(`[LocalhostPlugin] Received ${count} ${kind} ID(s) from Roblox Studio.`);
    }
  };

  processScanAsync().catch((err) => {
    if (DEVELOPER_MODE) console.error('[LocalhostPlugin] Background scan processing failed:', err);
  });

  return { ok: true, delivered: true, count: rawIds.length, kind, port: activePort };
}

function extractReplacementPairs(text) {
  const pairs = [];
  const seen = new Set();
  const patterns = [
    /(\d{5,})\s*=\s*(\d{5,})/g,
    /Original ID:\s*(\d{5,}).*?(?:New Asset ID|Overwrote Asset ID):\s*(\d{5,})/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      if (match[1] === match[2]) continue;
      const key = `${match[1]}:${match[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ oldId: match[1], newId: match[2] });
    }
  }

  return pairs;
}

function isScanEndpoint(pathname) {
  return (
    pathname === '/scan-results' ||
    pathname === '/plugin-scan' ||
    pathname === '/assets-animations' ||
    pathname === '/assets-sounds'
  );
}

function inferKindFromPath(pathname, payload) {
  if (pathname.includes('sound')) return { ...payload, kind: payload?.kind || 'sound' };
  if (pathname.includes('animation')) return { ...payload, kind: payload?.kind || 'animation' };
  return payload;
}

function startLocalhostPluginServer(callbacks, options = {}) {
  if (server) return server;
  const basePort =
    Number.parseInt(options.port || process.env.ISPOOFERMOTION_PLUGIN_PORT || DEFAULT_PORT, 10) ||
    DEFAULT_PORT;
  const maxPort = basePort + PORT_SCAN_LIMIT;
  activePort = basePort;

  const safeCallbacks = {
    sendScanResults:
      typeof callbacks?.sendScanResults === 'function' ? callbacks.sendScanResults : () => false,
    sendStatusMessage:
      typeof callbacks?.sendStatusMessage === 'function'
        ? callbacks.sendStatusMessage
        : () => false,
    getReplacementText:
      typeof callbacks?.getReplacementText === 'function' ? callbacks.getReplacementText : () => '',
  };

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url || '/',
        `http://${req.headers.host || `127.0.0.1:${activePort}`}`,
      );

      if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return;
      }

      if (
        req.method === 'GET' &&
        (url.pathname === '/health' || url.pathname === '/plugin/health')
      ) {
        sendJson(res, 200, {
          ok: true,
          app: 'ISpooferMotion',
          version: app.getVersion(),
          port: activePort,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/latest-replacements') {
        const text =
          typeof safeCallbacks.getReplacementText === 'function'
            ? String(safeCallbacks.getReplacementText() || '')
            : '';
        const pairs = extractReplacementPairs(text);
        sendJson(res, 200, {
          ok: true,
          app: 'ISpooferMotion',
          count: pairs.length,
          text,
          pairs,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/push-replacements') {
        const body = await readJsonBody(req);
        const text = String(body?.text || '');
        pushReplacement(text);
        sendJson(res, 200, { ok: true, queued: pendingReplacement !== null });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/pending-replacement') {
        if (pendingReplacement) {
          sendJson(res, 200, {
            ok: true,
            pending: true,
            text: pendingReplacement.text,
            pairs: pendingReplacement.pairs,
            pushedAt: pendingReplacement.pushedAt,
          });
        } else {
          sendJson(res, 200, { ok: true, pending: false });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/mark-replacement-applied') {
        pendingReplacement = null;
        if (typeof safeCallbacks.sendStatusMessage === 'function') {
          safeCallbacks.sendStatusMessage('Studio plugin applied the replacements');
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && isScanEndpoint(url.pathname)) {
        const payload = inferKindFromPath(url.pathname, await readJsonBody(req));
        const result = await handleScanPayload(payload, safeCallbacks);
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Bad request' });
    }
  });

  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE' && activePort < maxPort) {
      const previousPort = activePort;
      activePort += 1;
      console.warn(
        `[LocalhostPlugin] localhost:${previousPort} is already in use. Trying localhost:${activePort}...`,
      );
      server.listen(activePort, '127.0.0.1');
      return;
    }

    console.error(`[LocalhostPlugin] Failed to listen on localhost:${activePort}:`, error.message);
  });

  server.listen(activePort, '127.0.0.1', () => {
    console.log(`[LocalhostPlugin] Listening on http://localhost:${activePort}`);
  });

  return server;
}

function stopLocalhostPluginServer() {
  if (!server) return;
  const current = server;
  server = null;
  current.close((error) => {
    if (error && DEVELOPER_MODE) console.warn('[LocalhostPlugin] Failed to close server:', error);
  });
}

module.exports = {
  startLocalhostPluginServer,
  stopLocalhostPluginServer,
  pushReplacement,
  __private: {
    appendPlaceContextToLine,
    formatAssetsForInput,
    normalizeAssets,
    normalizePlaceId,
  },
};
