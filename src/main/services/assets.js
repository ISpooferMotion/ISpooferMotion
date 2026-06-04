'use strict';

const { createRobloxSession } = require('./roblox-session');
const {
  withTimeout,
  readResponseText,
  readJsonResponse,
  ROBLOX_USER_AGENT,
  debugLog,
  debugWarn,
} = require('./auth');

// --- ID / type normalizers ---

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

function asPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- URL builders ---

function buildCreatorGamesUrl(
  creatorType,
  creatorId,
  cursor,
  limit,
  accessFilter,
  sortOrder = 'Desc',
) {
  const normalizedCreatorType = normalizeCreatorType(creatorType);
  const normalizedCreatorId = normalizeCreatorId(creatorId);

  if (!normalizedCreatorId) throw new Error('Creator ID must be numeric');

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

// --- Fetch with retry (session-aware) ---

async function fetchJsonWithRetries(url, cookieOrSession, label, maxAttempts = 3) {
  const robloxSession = createRobloxSession(cookieOrSession);
  const headers = { 'User-Agent': ROBLOX_USER_AGENT };
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await robloxSession.fetch(url, withTimeout({ headers }));
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
      const retryable =
        status === 0 ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504;
      if (!retryable || attempt === maxAttempts) break;
      await sleep(350 * attempt);
    }
  }

  throw lastError || new Error(`${label} request failed`);
}

// --- Game / universe data extractors ---

function getUniverseId(game) {
  if (!game || typeof game !== 'object') return '';
  const candidates = [game.universeId, game.universe?.id, game.id, game.rootPlace?.universeId];
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
    rawCreator.type ||
      rawCreator.Type ||
      rawCreator.creatorType ||
      rawCreator.CreatorType ||
      fallbackCreatorType,
  );
  const creatorId = normalizeCreatorId(
    rawCreator.id ||
      rawCreator.Id ||
      rawCreator.creatorTargetId ||
      rawCreator.CreatorTargetId ||
      fallbackCreatorId,
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
    name:
      game.name ||
      game.Name ||
      game.rootPlace?.name ||
      game.rootPlace?.Name ||
      'Untitled Experience',
    universeId: getUniverseId(game) || null,
    creatorType: creator.creatorType,
    creatorId: String(creator.creatorId || creatorId || ''),
    source,
    verified: true,
  };
}

// --- Page / detail fetchers ---

async function fetchCreatorGamesPage(url, robloxSession) {
  const data = await fetchJsonWithRetries(url, robloxSession, 'Games API');
  if (!Array.isArray(data.data)) {
    throw new Error(`Invalid games response format: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function fetchUniverseDetailsByIds(universeIds, robloxSession) {
  const uniqueIds = [...new Set((universeIds || []).map(normalizeNumericId).filter(Boolean))];
  const details = new Map();

  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    const url = new URL('https://games.roblox.com/v1/games');
    url.searchParams.set('universeIds', chunk.join(','));

    try {
      const data = await fetchJsonWithRetries(url, robloxSession, 'Universe details API');
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

async function fetchUniverseIdForPlaceId(placeId, robloxSession) {
  const normalizedPlaceId = normalizePlaceId(placeId);
  if (!normalizedPlaceId) throw new Error('Place ID must be numeric');

  const url = new URL(`https://apis.roblox.com/universes/v1/places/${normalizedPlaceId}/universe`);
  const data = await fetchJsonWithRetries(url, robloxSession, 'Place universe API');
  const universeId = normalizeNumericId(data?.universeId || data?.UniverseId || data?.id);
  if (!universeId) throw new Error('No universe ID returned for that place');
  return universeId;
}

// --- Suggestion builder helpers ---

async function addSuggestionsFromGames(
  games,
  creatorType,
  creatorId,
  robloxSession,
  state,
  source = 'creator-games',
) {
  const missingUniverseIds = [];

  for (const game of games) {
    const directSuggestion = makePlaceSuggestion(game, creatorType, creatorId, source);
    if (directSuggestion && !state.seenPlaceIds.has(directSuggestion.placeId)) {
      state.seenPlaceIds.add(directSuggestion.placeId);
      state.suggestions.push(directSuggestion);
      debugLog(
        `(Dev) Game "${directSuggestion.name}" -> rootPlace ID: ${directSuggestion.placeId}`,
      );
      if (state.suggestions.length >= state.maxResults) return;
      continue;
    }

    const universeId = getUniverseId(game);
    if (universeId) missingUniverseIds.push(universeId);
  }

  if (!missingUniverseIds.length || state.suggestions.length >= state.maxResults) return;

  const detailMap = await fetchUniverseDetailsByIds(missingUniverseIds, robloxSession);
  for (const universeId of missingUniverseIds) {
    const detail = detailMap.get(universeId);
    if (!detail) continue;
    const enrichedSuggestion = makePlaceSuggestion(
      detail,
      creatorType,
      creatorId,
      'universe-details',
    );
    if (!enrichedSuggestion || state.seenPlaceIds.has(enrichedSuggestion.placeId)) continue;

    state.seenPlaceIds.add(enrichedSuggestion.placeId);
    state.suggestions.push(enrichedSuggestion);
    debugLog(`(Dev) Universe ${universeId} -> rootPlace ID: ${enrichedSuggestion.placeId}`);
    if (state.suggestions.length >= state.maxResults) return;
  }
}

// --- Main collection logic ---

async function collectPlaceSuggestionsForCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  const normalizedCreatorType = normalizeCreatorType(creatorType);
  const normalizedCreatorId = normalizeCreatorId(creatorId);
  if (!normalizedCreatorId) throw new Error('Creator ID must be numeric');
  if (normalizedCreatorType === 'user' && normalizedCreatorId === '1') {
    return { places: [], errors: ['User ID 1 is ignored.'], pagesRequested: 0 };
  }

  const limit = 50;
  const maxResults = asPositiveInteger(maxPlaceIds, 10000);
  const robloxSession = createRobloxSession(cookie);
  const state = { suggestions: [], seenPlaceIds: new Set(), maxResults };
  const errors = [];
  let pagesRequested = 0;

  // Try authenticated access first when a cookie is available.
  const accessFilters = robloxSession.getCookieHeader() ? ['All', 'Public', ''] : ['Public', ''];
  const sortOrders = ['Desc', 'Asc'];

  for (const accessFilter of accessFilters) {
    if (state.suggestions.length >= maxResults) break;

    for (const sortOrder of sortOrders) {
      if (state.suggestions.length >= maxResults) break;

      let cursor = null;
      let pageCount = 0;
      while (state.suggestions.length < maxResults) {
        const url = buildCreatorGamesUrl(
          normalizedCreatorType,
          normalizedCreatorId,
          cursor,
          limit,
          accessFilter,
          sortOrder,
        );
        debugLog(`(Dev) Fetching games page from URL: ${url.toString()}`);

        let pageData;
        try {
          pageData = await fetchCreatorGamesPage(url, robloxSession);
        } catch (err) {
          errors.push(`${accessFilter || 'default'} ${sortOrder}: ${err.message}`);
          break;
        }

        pagesRequested += 1;
        pageCount += 1;

        if (pageData.data.length === 0) {
          debugLog(
            `(Dev) No games found on this page. Total collected: ${state.suggestions.length}`,
          );
          break;
        }

        await addSuggestionsFromGames(
          pageData.data,
          normalizedCreatorType,
          normalizedCreatorId,
          robloxSession,
          state,
        );
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

  return { places: state.suggestions, errors, pagesRequested };
}

// --- Public API ---

/**
 * Returns all root place IDs for every game owned by the given creator.
 */
async function getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10000) {
  const result = await collectPlaceSuggestionsForCreator(
    creatorType,
    creatorId,
    cookie,
    maxPlaceIds,
  );
  const rootPlaces = result.places.map((place) => place.placeId);

  if (rootPlaces.length === 0) throw new Error('No root places found in games');

  debugLog(
    `(Dev) Got ${rootPlaces.length} root places from ${result.pagesRequested} page(s): ${rootPlaces.join(', ')}`,
  );
  return rootPlaces;
}

/**
 * Returns root place suggestions with display metadata for a creator.
 */
async function getPlaceSuggestionsFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10000) {
  return collectPlaceSuggestionsForCreator(creatorType, creatorId, cookie, maxPlaceIds);
}

/**
 * Looks up a single place by its ID and returns a fully-formed suggestion object.
 */
async function getPlaceSuggestionByPlaceId(placeId, cookie) {
  const normalizedPlaceId = normalizePlaceId(placeId);
  if (!normalizedPlaceId) throw new Error('Place ID must be numeric');

  const robloxSession = createRobloxSession(cookie);
  try {
    const universeId = await fetchUniverseIdForPlaceId(normalizedPlaceId, robloxSession);
    const details = await fetchUniverseDetailsByIds([universeId], robloxSession);
    const detail = details.get(universeId);
    const suggestion = detail
      ? makePlaceSuggestion(
          { ...detail, rootPlaceId: normalizedPlaceId },
          null,
          null,
          'place-lookup',
        )
      : null;

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

module.exports = {
  getPlaceIdFromCreator,
  getPlaceSuggestionsFromCreator,
  getPlaceSuggestionByPlaceId,
};
