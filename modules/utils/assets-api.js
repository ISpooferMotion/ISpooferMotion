// Assets API utilities for listing creator assets (user/group)
// Uses Roblox Inventory and Thumbnails APIs

const DEVELOPER_MODE = process.env.DEVELOPER_MODE === '1' || process.env.DEVELOPER_MODE === 'true';

const ASSET_TYPE_MAP = {
  Animation: 24,
  Audio: 3,
  Decal: 13,
  Image: 13,
  Model: 10,
  Mesh: 4,
};

function logDev(...args) {
  if (DEVELOPER_MODE) console.log('[assets-api]', ...args);
}

function assetTypeParam(types) {
  // Inventory API expects comma-separated names, but older endpoints may require IDs.
  // We use names for inventory.roblox.com, and map where needed.
  const normalized = (types && types.length ? types : ['Animation', 'Audio', 'Image', 'Model']).map(t => {
    if (t === 'Images') return 'Image';
    if (t === 'Decal') return 'Image';
    return t;
  });
  return normalized.join(',');
}

async function fetchInventoryPage({ creatorType, creatorId, assetTypes, cursor, cookie, limit = 50 }) {
  const assetTypesParam = assetTypeParam(assetTypes);
  const base = 'https://inventory.roblox.com/v2';
  const url = creatorType === 'Group'
    ? `${base}/groups/${creatorId}/inventory?assetTypes=${encodeURIComponent(assetTypesParam)}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    : `${base}/users/${creatorId}/inventory?assetTypes=${encodeURIComponent(assetTypesParam)}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

  logDev('Inventory request', url);
  const res = await fetch(url, {
    headers: {
      Cookie: `.ROBLOSECURITY=${cookie}`,
      'User-Agent': 'ISpooferMotion/AssetExplorer',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Inventory fetch failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function fetchThumbnails(assetIds) {
  if (!assetIds || assetIds.length === 0) return {};
  const url = `https://thumbnails.roblox.com/v1/assets?assetIds=${assetIds.join(',')}&size=100x100&format=Png`;
  logDev('Thumbnails request', url);
  const res = await fetch(url, { headers: { 'User-Agent': 'ISpooferMotion/AssetExplorer' } });
  if (!res.ok) return {};
  const json = await res.json();
  const map = {};
  if (json && Array.isArray(json.data)) {
    for (const item of json.data) {
      map[item.targetId] = item.imageUrl || null;
    }
  }
  return map;
}

async function listCreatorAssets({ creatorType = 'User', creatorId, assetTypes = ['Animation', 'Audio', 'Image'], cookie, limit = 50, maxPages = 3 }) {
  if (!creatorId) throw new Error('creatorId is required');
  if (!cookie) throw new Error('cookie is required');

  const items = [];
  let cursor = undefined;
  let pages = 0;

  while (pages < maxPages) {
    const json = await fetchInventoryPage({ creatorType, creatorId, assetTypes, cursor, cookie, limit });
    const pageItems = (json && Array.isArray(json.data)) ? json.data : [];
    items.push(...pageItems);
    cursor = json.nextPageCursor || undefined;
    pages += 1;
    if (!cursor) break;
  }

  const ids = items.map(i => i.assetId).filter(Boolean);
  const thumbs = await fetchThumbnails(ids);

  // Deduplicate by asset ID - keep only the first occurrence of each asset
  const seenIds = new Set();
  const enriched = items
    .map(i => ({
      id: i.assetId,
      name: i.name || i.assetName || `Asset ${i.assetId}`,
      type: i.assetType || i.type || 'Unknown',
      created: i.created || null,
      updated: i.updated || null,
      thumbnailUrl: thumbs[i.assetId] || null,
      creatorType,
      creatorId,
      isModerated: i.isModerated || i.moderationStatus === 'Moderated' || false,
    }))
    .filter(item => {
      // Filter out moderated assets and duplicates
      if (item.isModerated) return false;
      if (seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    });

  return {
    total: enriched.length,
    items: enriched,
  };
}

module.exports = {
  listCreatorAssets,
};
