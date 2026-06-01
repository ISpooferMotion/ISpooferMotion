'use strict';

const { buildRobloxCookieHeader } = require('./common');
const {
  withTimeout,
  readResponseText,
  readJsonResponse,
  ROBLOX_USER_AGENT,
  debugLog,
  debugWarn,
} = require('./auth');

function asPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNumericId(value) {
  const match = String(value ?? '').match(/\d+/);
  return match ? match[0] : '';
}

function normalizePlaceId(value) {
  const id = normalizeNumericId(value);
  return id && id !== '0' ? id : '';
}

function normalizeCreatorId(value) {
  const id = normalizeNumericId(value);
  return id && id !== '0' ? id : '';
}

function normalizeCreatorType(value) {
  return String(value || '').toLowerCase() === 'group' ? 'group' : 'user';
}

function buildCreatorGamesUrl(creatorType, creatorId, cursor, limit, accessFilter, sortOrder = 'Desc') {
  const normalizedCreatorType = normalizeCreatorType(creatorType);
  const normalizedCreatorId = normalizeCreatorId(creatorId);

  if (!normalizedCreatorId) {
    throw new Error('Creator ID must be numeric');
  }

  const url =
    normalizedCreatorType === 'group'
      ? new URL(`https://games.roblox.com/v2/groups/${normalizedCreatorId}/games`)
      : new URL(`https://games.roblox.com/v2/users/${normalizedCreatorId}/games`);

  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sortOrder', sortOrder === 'Asc' ? 'Asc' : 'Desc');
  if (accessFilter) url.searchParams.set('accessFilter', accessFilter);
  if (cursor) url.searchParams.set('cursor', String(cursor));

  return url;
}

async function fetchJsonWithRetries(url, cookieHeader, label, maxAttempts = 3) {
  const headers = { 'User-Agent': ROBLOX_USER_AGENT };
  if (cookieHeader) headers.Cookie = cookieHeader;

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, withTimeout({ headers }));
      if (!response.ok) {
        const errorText = await readResponseText(response, 300);
        const error = new Error(`HTTP ${response.status}${errorText ? `: ${errorText}` : ''}`);
        error.status = response.status;
        throw error;
      }
      return await readJsonResponse(response, label);
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 0 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retryable || attempt === maxAttempts) break;
      await sleep(350 * attempt);
    }
  }

  throw lastError || new Error(`${label} request failed`);
}

function getUniverseId(game) {
  if (!game || typeof game !== 'object') return '';
  const candidates = [
    game.universeId,
    game.universe?.id,
    game.id,
    game.rootPlace?.universeId,
  ];
  for (const candidate of candidates) {
    const id = normalizeNumericId(candidate);
    if (id) return id;
  }
  return '';
}

function getRootPlaceId(game) {
  if (!game || typeof game !== 'object') return '';
  const candidates = [
    game.rootPlace?.id,
    game.rootPlace?.placeId,
    game.rootPlaceId,
    game.placeId,
    game.place?.id,
  ];

  for (const candidate of candidates) {
    const id = normalizePlaceId(candidate);
    if (id) return id;
  }
  return '';
}

function getCreatorFromGame(game, fallbackCreatorType, fallbackCreatorId) {
  const rawCreator = game?.creator || game?.Creator || {};
  const creatorType = normalizeCreatorType(
    rawCreator.type || rawCreator.Type || rawCreator.creatorType || rawCreator.CreatorType || fallbackCreatorType,
  );
  const creatorId = normalizeCreatorId(
    rawCreator.id || rawCreator.Id || rawCreator.creatorTargetId || rawCreator.CreatorTargetId || fallbackCreatorId,
  );

  return {
    creatorType,
    creatorId: creatorId || String(fallbackCreatorId || ''),
  };
}

function makePlaceSuggestion(game, creatorType, creatorId, source = 'creator-games') {
  const placeId = getRootPlaceId(game);
  if (!placeId) return null;

  const creator = getCreatorFromGame(game, creatorType, creatorId);
  if (creator.creatorType === 'user' && String(creator.creatorId) === '1') return null;

  return {
    placeId,
    name: game.name || game.Name || game.rootPlace?.name || game.rootPlace?.Name || 'Untitled Experience',
    universeId: getUniverseId(game) || null,
    creatorType: creator.creatorType,
    creatorId: String(creator.creatorId || creatorId || ''),
    source,
    verified: true,
  };
}

async function fetchCreatorGamesPage(url, cookieHeader) {
  const data = await fetchJsonWithRetries(url, cookieHeader, 'Games API');
  if (!Array.isArray(data.data)) {
    throw new Error(`Invalid games response format: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return data;
}

async function fetchUniverseDetailsByIds(universeIds, cookieHeader) {
  const uniqueIds = [...new Set((universeIds || []).map(normalizeNumericId).filter(Boolean))];
  const details = new Map();

  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    const url = new URL('https://games.roblox.com/v1/games');
    url.searchParams.set('universeIds', chunk.join(','));

    try {
      const data = await fetchJsonWithRetries(url, cookieHeader, 'Universe details API');
      if (Array.isArray(data?.data)) {
        for (const item of data.data) {
          const universeId = getUniverseId(item);
          if (universeId) details.set(universeId, item);
        }
      }
    } catch (error) {
      debugWarn('(Dev) Failed to enrich universe details:', error.message);
    }
  }

  return details;
}

async function fetchUniverseIdForPlaceId(placeId, cookieHeader) {
  const normalizedPlaceId = normalizePlaceId(placeId);
  if (!normalizedPlaceId) throw new Error('Place ID must be numeric');

  const url = new URL(`https://apis.roblox.com/universes/v1/places/${normalizedPlaceId}/universe`);
  const data = await fetchJsonWithRetries(url, cookieHeader, 'Place universe API');
  const universeId = normalizeNumericId(data?.universeId || data?.UniverseId || data?.id);
  if (!universeId) throw new Error('No universe ID returned for that place');
  return universeId;
}

async function addSuggestionsFromGames(games, creatorType, creatorId, cookieHeader, state, source = 'creator-games') {
  const missingUniverseIds = [];

  for (const game of games) {
    const directSuggestion = makePlaceSuggestion(game, creatorType, creatorId, source);
    if (directSuggestion && !state.seenPlaceIds.has(directSuggestion.placeId)) {
      state.seenPlaceIds.add(directSuggestion.placeId);
      state.suggestions.push(directSuggestion);
      debugLog(`(Dev) Game "${directSuggestion.name}" -> rootPlace ID: ${directSuggestion.placeId}`);
      if (state.suggestions.length >= state.maxResults) return;
      continue;
    }

    const universeId = getUniverseId(game);
    if (universeId) missingUniverseIds.push(universeId);
  }

  if (!missingUniverseIds.length || state.suggestions.length >= state.maxResults) return;

  const detailMap = await fetchUniverseDetailsByIds(missingUniverseIds, cookieHeader);
  for (const universeId of missingUniverseIds) {
    const detail = detailMap.get(universeId);
    if (!detail) continue;
    const enrichedSuggestion = makePlaceSuggestion(detail, creatorType, creatorId, 'universe-details');
    if (!enrichedSuggestion || state.seenPlaceIds.has(enrichedSuggestion.placeId)) continue;

    state.seenPlaceIds.add(enrichedSuggestion.placeId);
    state.suggestions.push(enrichedSuggestion);
    debugLog(`(Dev) Universe ${universeId} -> rootPlace ID: ${enrichedSuggestion.placeId}`);
    if (state.suggestions.length >= state.maxResults) return;
  }
}

async function collectPlaceSuggestionsForCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  const normalizedCreatorType = normalizeCreatorType(creatorType);
  const normalizedCreatorId = normalizeCreatorId(creatorId);
  if (!normalizedCreatorId) throw new Error('Creator ID must be numeric');
  if (normalizedCreatorType === 'user' && normalizedCreatorId === '1') {
    return { places: [], errors: ['User ID 1 is ignored.'], pagesRequested: 0 };
  }

  const limit = 50;
  const maxResults = Math.min(asPositiveInteger(maxPlaceIds, 10), 100);
  const cookieHeader = buildRobloxCookieHeader(cookie);
  const state = {
    suggestions: [],
    seenPlaceIds: new Set(),
    maxResults,
  };
  const errors = [];
  let pagesRequested = 0;
  const accessFilters = cookieHeader ? ['All', 'Public', ''] : ['Public', ''];
  const sortOrders = ['Desc', 'Asc'];

  for (const accessFilter of accessFilters) {
    if (state.suggestions.length >= maxResults) break;

    for (const sortOrder of sortOrders) {
      if (state.suggestions.length >= maxResults) break;

      let cursor = null;
      let pageCount = 0;
      while (state.suggestions.length < maxResults) {
        const url = buildCreatorGamesUrl(normalizedCreatorType, normalizedCreatorId, cursor, limit, accessFilter, sortOrder);
        debugLog(`(Dev) Fetching games page from URL: ${url.toString()}`);

        let pageData;
        try {
          pageData = await fetchCreatorGamesPage(url, cookieHeader);
        } catch (err) {
          errors.push(`${accessFilter || 'default'} ${sortOrder}: ${err.message}`);
          break;
        }

        pagesRequested += 1;
        pageCount += 1;

        if (pageData.data.length === 0) {
          debugLog(`(Dev) No games found on this page. Total collected: ${state.suggestions.length}`);
          break;
        }

        await addSuggestionsFromGames(pageData.data, normalizedCreatorType, normalizedCreatorId, cookieHeader, state);
        if (state.suggestions.length >= maxResults) break;

        if (!pageData.nextPageCursor) {
          debugLog('(Dev) No more pages available');
          break;
        }

        cursor = pageData.nextPageCursor;
      }

      if (pageCount > 0 && state.suggestions.length > 0) break;
    }

    if (state.suggestions.length > 0) break;
  }

  return {
    places: state.suggestions,
    errors,
    pagesRequested,
  };
}

async function getPlaceSuggestionByPlaceId(placeId, cookie) {
  const normalizedPlaceId = normalizePlaceId(placeId);
  if (!normalizedPlaceId) throw new Error('Place ID must be numeric');

  const cookieHeader = buildRobloxCookieHeader(cookie);
  try {
    const universeId = await fetchUniverseIdForPlaceId(normalizedPlaceId, cookieHeader);
    const details = await fetchUniverseDetailsByIds([universeId], cookieHeader);
    const detail = details.get(universeId);
    const suggestion = detail ? makePlaceSuggestion({ ...detail, rootPlaceId: normalizedPlaceId }, null, null, 'place-lookup') : null;
    if (suggestion) {
      return { ...suggestion, placeId: normalizedPlaceId, universeId, verified: true };
    }
    return {
      placeId: normalizedPlaceId,
      name: `Place ${normalizedPlaceId}`,
      universeId,
      creatorType: 'user',
      creatorId: '',
      source: 'place-lookup',
      verified: true,
    };
  } catch (error) {
    debugWarn('(Dev) Could not verify place ID:', error.message);
    return {
      placeId: normalizedPlaceId,
      name: `Place ${normalizedPlaceId}`,
      universeId: null,
      creatorType: 'user',
      creatorId: '',
      source: 'manual-place-id',
      verified: false,
      warning: error.message,
    };
  }
}

/**
 * Gets the rootPlace from each game the creator owns.
 */
async function getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  const result = await collectPlaceSuggestionsForCreator(creatorType, creatorId, cookie, maxPlaceIds);
  const rootPlaces = result.places.map((place) => place.placeId);

  if (rootPlaces.length === 0) throw new Error('No root places found in games');

  debugLog(
    `(Dev) Got ${rootPlaces.length} root places from ${result.pagesRequested} page(s): ${rootPlaces.join(', ')}`,
  );
  return rootPlaces;
}

/**
 * Gets root place suggestions with display metadata for a creator.
 */
async function getPlaceSuggestionsFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  return collectPlaceSuggestionsForCreator(creatorType, creatorId, cookie, maxPlaceIds);
}

const assetCache = new Map();

async function findAssetByName(cookie, assetType, name, groupId = null) {
  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) return null;

  const cacheKey = `${assetType}_${groupId || 'user'}`;
  if (!assetCache.has(cacheKey)) {
    assetCache.set(cacheKey, { items: new Map(), fullyLoaded: false, cursor: '', fetchPromise: null });
  }

  const cache = assetCache.get(cacheKey);

  if (cache.items.has(name)) {
    return cache.items.get(name);
  }

  // If already fully loaded and not found, it doesn't exist
  if (cache.fullyLoaded) return null;

  // Wait if another worker is currently fetching
  if (cache.fetchPromise) {
    await cache.fetchPromise;
    if (cache.items.has(name)) return cache.items.get(name);
    if (cache.fullyLoaded) return null;
  }

  // Create a new fetch promise
  cache.fetchPromise = (async () => {
    let baseUrl = `https://itemconfiguration.roblox.com/v1/creations/get-assets?assetType=${assetType}&isArchived=false&limit=100`;
    if (groupId) baseUrl += `&groupId=${groupId}`;

    try {
      while (!cache.fullyLoaded) {
        let url = baseUrl;
        if (cache.cursor) url += `&cursor=${cache.cursor}`;

        const response = await fetch(url, {
          headers: { Cookie: cookieHeader, 'User-Agent': ROBLOX_USER_AGENT },
        });

        if (response.status === 429) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        if (!response.ok) break;

        const data = await response.json();
        if (!data || !data.data) break;

        for (const item of data.data) {
          if (!cache.items.has(item.name)) {
             cache.items.set(item.name, item.assetId);
          }
        }

        // If we found the specific item, we can return early but we must clear the promise
        if (cache.items.has(name)) {
          cache.cursor = data.nextPageCursor || '';
          if (!cache.cursor) cache.fullyLoaded = true;
          return;
        }

        if (!data.nextPageCursor) {
          cache.fullyLoaded = true;
          break;
        }
        cache.cursor = data.nextPageCursor;
      }
    } catch (err) {
      debugWarn('(Dev) Error in findAssetByName pagination:', err);
    }
  })();

  await cache.fetchPromise;
  cache.fetchPromise = null;

  return cache.items.get(name) || null;
}

module.exports = {
  getPlaceIdFromCreator,
  getPlaceSuggestionsFromCreator,
  getPlaceSuggestionByPlaceId,
  findAssetByName,
};
