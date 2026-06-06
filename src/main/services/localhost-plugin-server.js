'use strict';

const http = require('node:http');
const path = require('node:path');
const { app, Notification, nativeImage } = require('electron');
const { DEVELOPER_MODE } = require('./common');

const DEFAULT_PORT = 3100;
const PORT_SCAN_LIMIT = 10;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

let server = null;
let activePort = DEFAULT_PORT;

// Holds the last batch of replacement mappings pushed by the app.
// The plugin polls /pending-replacement and clears this once applied.
let pendingReplacement = null;

/**
 * Called by the app (ipc-handlers.js) after a successful upload run.
 * Stores mappings so the Studio plugin can pick them up on its next poll.
 */
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
  const assetPath = path.join(__dirname, '..', '..', 'assets', assetFile);
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
    const match = String(value ?? '').match(/\d{5,}/);
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
  const payloadPlaceId = normalizePlaceId(payload?.placeId || payload?.PlaceId || payload?.game?.placeId);
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

function appendPlaceContextToLine(line, placeId) {
  const normalizedPlaceId = normalizePlaceId(placeId);
  const trimmed = String(line || '').trim();
  if (!trimmed || !normalizedPlaceId || /\[\s*place\s*:/i.test(trimmed)) return trimmed;
  return `${trimmed.replace(/,?\s*$/, '')} [Place:${normalizedPlaceId}],`;
}

function formatAssetsForInput(assets) {
  return assets
    .filter((asset) => asset.assetId && asset.creatorId)
    .map(
      (asset) => {
        const base = `[${asset.assetId}] [${cleanText(asset.name, asset.assetId)}] [${asset.creatorType}:${asset.creatorId}]`;
        return appendPlaceContextToLine(base, asset.placeId);
      },
    )
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

async function handleScanPayload(payload, callbacks) {
  const kind = normalizeScanKind(payload?.kind || payload?.type || payload?.scanType);
  const assets = normalizeAssets(payload);
  const payloadPlaceId = normalizePlaceId(payload?.placeId || payload?.PlaceId || payload?.game?.placeId);
  const text =
    Array.isArray(payload?.lines) && payload.lines.length
      ? payload.lines
          .map((line) => String(line || '').trim())
          .filter(Boolean)
          .map((line) => appendPlaceContextToLine(line, payloadPlaceId))
          .join('\n')
      : formatAssetsForInput(assets);
  const lines = text ? text.split(/\r?\n/).filter(Boolean) : [];
  const count = lines.length;

  const scanResult = {
    kind,
    label: scanLabel(kind),
    count,
    text,
    lines,
    placeId: payloadPlaceId || null,
    source: 'localhost-plugin',
    receivedAt: new Date().toISOString(),
  };

  const delivered = count > 0 ? callbacks.sendScanResults(scanResult) : false;
  const statusMessage =
    count > 0
      ? `${scanLabel(kind)} scan imported: ${count} ID${count === 1 ? '' : 's'}.`
      : `${scanLabel(kind)} scan received, but no importable IDs were found.`;
  callbacks.sendStatusMessage(statusMessage);
  if (count > 0) showScanNotification(kind, count);

  if (DEVELOPER_MODE) {
    console.log(`[LocalhostPlugin] Received ${count} ${kind} ID(s) from Roblox Studio.`);
  }

  return { ok: true, delivered, count, kind, port: activePort };
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

      // App → Server: push a replacement batch so the plugin can pick it up.
      if (req.method === 'POST' && url.pathname === '/push-replacements') {
        const body = await readJsonBody(req);
        const text = String(body?.text || '');
        pushReplacement(text);
        sendJson(res, 200, { ok: true, queued: pendingReplacement !== null });
        return;
      }

      // Plugin → Server: poll for a pending replacement batch.
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

      // Plugin → Server: acknowledge that the replacement was applied.
      if (req.method === 'POST' && url.pathname === '/mark-replacement-applied') {
        pendingReplacement = null;
        if (typeof safeCallbacks.sendStatusMessage === 'function') {
          safeCallbacks.sendStatusMessage('Studio plugin applied the replacements ✓');
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
