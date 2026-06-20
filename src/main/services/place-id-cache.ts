// @ts-nocheck
'use strict';

import fs from 'node:fs/promises';
import path from 'node:path';

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_PLACE_IDS_PER_CREATOR = 20;

function getCacheFilePath(userDataPath: any) {
  return path.join(userDataPath, 'place-id-cache.json');
}

async function loadPlaceIdCache(userDataPath: any) {
  const filePath = getCacheFilePath(userDataPath);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== CACHE_VERSION || typeof parsed?.entries !== 'object') return {};
    return parsed.entries || {};
  } catch {
    return {};
  }
}

async function savePlaceIdCache(userDataPath: any, entries: any) {
  const filePath = getCacheFilePath(userDataPath);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      tmpPath,
      JSON.stringify({ version: CACHE_VERSION, entries }, null, 2),
      'utf8',
    );
    try {
      await fs.rename(tmpPath, filePath);
    } catch {
      try {
        await fs.copyFile(tmpPath, filePath);
      } finally {
        await fs.rm(tmpPath, { force: true }).catch(() => {});
      }
    }
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

function pruneExpiredEntries(entries: any) {
  const now = Date.now();
  const pruned: any = {};
  for (const [key, entry] of Object.entries(entries)) {
    const freshIds = (entry.placeIds || []).filter(
      (p) => typeof p?.lastSuccess === 'number' && now - p.lastSuccess < CACHE_TTL_MS,
    );
    if (freshIds.length > 0) {
      pruned[key] = { placeIds: freshIds };
    }
  }
  return pruned;
}


function getCachedPlaceIds(entries: any, creatorKey: any) {
  const entry = entries[creatorKey];
  if (!entry?.placeIds?.length) return [];
  const now = Date.now();
  return entry.placeIds
    .filter((p) => typeof p?.lastSuccess === 'number' && now - p.lastSuccess < CACHE_TTL_MS)
    .sort((a, b) => b.lastSuccess - a.lastSuccess)
    .map((p) => p.id);
}

function recordSuccessfulPlaceId(entries: any, creatorKey: any, placeId: any) {
  if (!creatorKey || !placeId) return;
  const id = String(placeId);
  if (!entries[creatorKey]) entries[creatorKey] = { placeIds: [] };
  const existing = entries[creatorKey].placeIds.find((p) => p.id === id);
  if (existing) {
    existing.lastSuccess = Date.now();
  } else {
    entries[creatorKey].placeIds.unshift({ id, lastSuccess: Date.now() });
    if (entries[creatorKey].placeIds.length > MAX_PLACE_IDS_PER_CREATOR) {
      entries[creatorKey].placeIds = entries[creatorKey].placeIds.slice(
        0,
        MAX_PLACE_IDS_PER_CREATOR,
      );
    }
  }
}

function evictPlaceId(entries: any, creatorKey: any, placeId: any) {
  if (!creatorKey || !placeId || !entries[creatorKey]) return;
  entries[creatorKey].placeIds = (entries[creatorKey].placeIds || []).filter(
    (p) => p.id !== String(placeId),
  );
}

export {
  loadPlaceIdCache,
  savePlaceIdCache,
  pruneExpiredEntries,
  getCachedPlaceIds,
  recordSuccessfulPlaceId,
  evictPlaceId,
};
