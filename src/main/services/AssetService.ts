import { extractNumericId } from './common';
// @ts-nocheck
import {
  debugLog,
  debugWarn,
  readJsonResponse,
  readResponseText,
  ROBLOX_USER_AGENT,
  withTimeout,
} from './auth';
import { createRobloxSession } from './roblox-session';

export class AssetService {
  public static normalizeNumericId(value) {
    const match = String(value ?? '').match(/\d+/);
    return match ? match[0] : '';
  }

  public static normalizePlaceId(value) {
    const id = AssetService.normalizeNumericId(value);
    return id && id !== '0' ? id : '';
  }

  public static normalizeCreatorId(value) {
    const id = AssetService.normalizeNumericId(value);
    return id && id !== '0' ? id : '';
  }

  public static normalizeCreatorType(value) {
    return String(value || '').toLowerCase() === 'group' ? 'group' : 'user';
  }

  public static asPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  public static sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public static buildCreatorGamesUrl(
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

  public static async fetchJsonWithRetries(url, cookieOrSession, label, maxAttempts = 3) {
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

  public static getUniverseId(game) {
    if (!game || typeof game !== 'object') return '';
    const candidates = [game.universeId, game.universe?.id, game.id, game.rootPlace?.universeId];
    for (const candidate of candidates) {
      const id = AssetService.normalizeNumericId(candidate);
      if (id) return id;
    }
    return '';
  }

  public static getRootPlaceId(game) {
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

  public static getCreatorFromGame(game, fallbackCreatorType, fallbackCreatorId) {
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

  public static makePlaceSuggestion(game, creatorType, creatorId, source = 'creator-games') {
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

  public static async fetchCreatorGamesPage(url, robloxSession) {
    const data = await AssetService.fetchJsonWithRetries(url, robloxSession, 'Games API');
    if (!Array.isArray(data.data)) {
      throw new Error(`Invalid games response format: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
  }

  public static async fetchUniverseDetailsByIds(universeIds, robloxSession) {
    const uniqueIds = [...new Set((universeIds || []).map(normalizeNumericId).filter(Boolean))];
    const details = new Map();

    for (let i = 0; i < uniqueIds.length; i += 50) {
      const chunk = uniqueIds.slice(i, i + 50);
      const url = new URL('https://games.roblox.com/v1/games');
      url.searchParams.set('universeIds', chunk.join(','));

      try {
        const data = await AssetService.fetchJsonWithRetries(url, robloxSession, 'Universe details API');
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

  public static async fetchUniverseIdForPlaceId(placeId, robloxSession) {
    const normalizedPlaceId = normalizePlaceId(placeId);
    if (!normalizedPlaceId) throw new Error('Place ID must be numeric');

    const url = new URL(
      `https://apis.roblox.com/universes/v1/places/${normalizedPlaceId}/universe`,
    );
    const data = await AssetService.fetchJsonWithRetries(url, robloxSession, 'Place universe API');
    const universeId = AssetService.normalizeNumericId(data?.universeId || data?.UniverseId || data?.id);
    if (!universeId) throw new Error('No universe ID returned for that place');
    return universeId;
  }

  public static async addSuggestionsFromGames(
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

      const universeId = AssetService.getUniverseId(game);
      if (universeId) missingUniverseIds.push(universeId);
    }

    if (!missingUniverseIds.length || state.suggestions.length >= state.maxResults) return;

    const detailMap = await AssetService.fetchUniverseDetailsByIds(missingUniverseIds, robloxSession);
    for (const universeId of missingUniverseIds) {
      const detail = detailMap.get(universeId);
      if (!detail) continue;
      const enrichedSuggestion = AssetService.makePlaceSuggestion(
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

  public static async collectPlaceSuggestionsForCreator(
    creatorType,
    creatorId,
    cookie,
    maxPlaceIds = 10,
  ) {
    const normalizedCreatorType = normalizeCreatorType(creatorType);
    const normalizedCreatorId = normalizeCreatorId(creatorId);
    if (!normalizedCreatorId) throw new Error('Creator ID must be numeric');
    if (normalizedCreatorType === 'user' && normalizedCreatorId === '1') {
      return { places: [], errors: ['User ID 1 is ignored.'], pagesRequested: 0 };
    }

    const limit = 50;
    const maxResults = asPositiveInteger(maxPlaceIds, 200);
    const robloxSession = createRobloxSession(cookie);
    const state = { suggestions: [], seenPlaceIds: new Set(), maxResults };
    const errors = [];
    let pagesRequested = 0;

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
            pageData = await AssetService.fetchCreatorGamesPage(url, robloxSession);
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

          await AssetService.addSuggestionsFromGames(
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

  public static async getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 1000) {
    const result = await AssetService.collectPlaceSuggestionsForCreator(
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

  public static async getPlaceSuggestionsFromCreator(
    creatorType,
    creatorId,
    cookie,
    maxPlaceIds = 1000,
  ) {
    return AssetService.collectPlaceSuggestionsForCreator(creatorType, creatorId, cookie, maxPlaceIds);
  }

  public static async getPlaceSuggestionByPlaceId(placeId, cookie) {
    const normalizedPlaceId = normalizePlaceId(placeId);
    if (!normalizedPlaceId) throw new Error('Place ID must be numeric');

    const robloxSession = createRobloxSession(cookie);
    try {
      const universeId = await AssetService.fetchUniverseIdForPlaceId(normalizedPlaceId, robloxSession);
      const details = await AssetService.fetchUniverseDetailsByIds([universeId], robloxSession);
      const detail = details.get(universeId);
      const suggestion = detail
        ? AssetService.makePlaceSuggestion(
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

  public static async getGroupsForUser(userId, cookie) {
    const normalizedId = AssetService.normalizeNumericId(userId);
    if (!normalizedId) return [];

    const robloxSession = createRobloxSession(cookie);
    try {
      const url = new URL(`https://groups.roblox.com/v1/users/${normalizedId}/groups/roles`);
      const data = await AssetService.fetchJsonWithRetries(url, robloxSession, 'User groups API', 2);
      if (!Array.isArray(data?.data)) return [];
      return data.data
        .map((entry) => {
          const groupId = AssetService.normalizeNumericId(entry?.group?.id);
          const ownerId = AssetService.normalizeNumericId(entry?.group?.owner?.userId);
          return groupId ? { groupId, ownerId: ownerId || null } : null;
        })
        .filter(Boolean);
    } catch (err) {
      debugWarn('(Dev) Failed to fetch user groups:', err.message);
      return [];
    }
  }

  public static async getFriendsForUser(userId, cookie) {
    const normalizedId = AssetService.normalizeNumericId(userId);
    if (!normalizedId) return [];

    const robloxSession = createRobloxSession(cookie);
    try {
      const url = new URL(`https://friends.roblox.com/v1/users/${normalizedId}/friends`);
      const data = await AssetService.fetchJsonWithRetries(url, robloxSession, 'Friends API', 2);
      if (!Array.isArray(data?.data)) return [];
      return data.data.map((f) => AssetService.normalizeNumericId(f?.id || f?.userId)).filter(Boolean);
    } catch (err) {
      debugWarn('(Dev) Failed to fetch user friends:', err.message);
      return [];
    }
  }

  public static async getPlaceIdsFromAllUserContext(
    authUserId,
    creatorId,
    creatorType,
    cookie,
    maxPerSource = 10,
  ) {
    const seenPlaceIds = new Set();
    const results = [];
    const robloxSession = createRobloxSession(cookie);

    const addPlaceIds = (ids) => {
      for (const id of ids || []) {
        const normalized = normalizePlaceId(id);
        if (normalized && !seenPlaceIds.has(normalized)) {
          seenPlaceIds.add(normalized);
          results.push(normalized);
        }
      }
    };

    const fetchUserPlaces = async (userId, label) => {
      try {
        const r = await AssetService.collectPlaceSuggestionsForCreator('user', userId, cookie, maxPerSource);
        addPlaceIds(r.places.map((p) => p.placeId));
        if (r.places.length > 0)
          debugLog(`(Dev) Fallback: got ${r.places.length} places from ${label} (${userId})`);
      } catch {}
    };

    const fetchGroupPlaces = async (groupId, label) => {
      try {
        const r = await AssetService.collectPlaceSuggestionsForCreator('group', groupId, cookie, maxPerSource);
        addPlaceIds(r.places.map((p) => p.placeId));
        if (r.places.length > 0)
          debugLog(
            `(Dev) Fallback: got ${r.places.length} places from group ${label} (${groupId})`,
          );
      } catch {}
    };

    if (authUserId) {
      await fetchUserPlaces(authUserId, 'auth user');
      debugLog(`(Dev) Fallback pool after (auth user games): ${results.length}`);
    }

    if (authUserId) {
      const authGroups = await AssetService.getGroupsForUser(authUserId, cookie);
      debugLog(`(Dev) Fallback: auth user is in ${authGroups.length} groups`);
      for (const { groupId } of authGroups) {
        if (results.length >= maxPerSource * 5) break;
        await fetchGroupPlaces(groupId, 'auth-user-group');
      }
      debugLog(`(Dev) Fallback pool after (auth user group games): ${results.length}`);
    }

    if (creatorType === 'user' && creatorId && creatorId !== authUserId) {
      const creatorGroups = await AssetService.getGroupsForUser(creatorId, cookie);
      debugLog(`(Dev) Fallback: creator ${creatorId} is in ${creatorGroups.length} groups`);

      for (const { groupId } of creatorGroups) {
        if (results.length >= maxPerSource * 8) break;
        await fetchGroupPlaces(groupId, 'creator-group');
      }
      debugLog(`(Dev) Fallback pool after (creator group games): ${results.length}`);

      const seenOwnerIds = new Set([authUserId, creatorId].filter(Boolean));
      for (const { groupId, ownerId } of creatorGroups) {
        if (results.length >= maxPerSource * 12) break;
        if (!ownerId || seenOwnerIds.has(ownerId)) continue;
        seenOwnerIds.add(ownerId);
        debugLog(`(Dev) Fallback: checking personal games of group ${groupId} owner (${ownerId})`);
        await fetchUserPlaces(ownerId, `group-${groupId}-owner`);
      }
      debugLog(`(Dev) Fallback pool after (group owner personal games): ${results.length}`);

      if (results.length < maxPerSource * 3) {
        const friendIds = await AssetService.getFriendsForUser(creatorId, cookie);
        debugLog(`(Dev) Fallback: creator has ${friendIds.length} friends`);
        for (const friendId of friendIds) {
          if (results.length >= maxPerSource * 15) break;
          if (seenOwnerIds.has(friendId)) continue;
          seenOwnerIds.add(friendId);
          await fetchUserPlaces(friendId, `creator-friend`);
        }
        debugLog(`(Dev) Fallback pool after (creator friends): ${results.length}`);
      }
    }

    return results;
  }

  public static async getPlaceIdFromUniverseId(universeId, cookie) {
    const normalizedUniverseId = AssetService.normalizeNumericId(universeId);
    if (!normalizedUniverseId) return null;

    const robloxSession = createRobloxSession(cookie);
    try {
      const details = await AssetService.fetchUniverseDetailsByIds([normalizedUniverseId], robloxSession);
      const detail = details.get(normalizedUniverseId);
      if (detail && detail.rootPlaceId) {
        return String(detail.rootPlaceId);
      }
    } catch (error) {
      debugWarn('(Dev) Could not resolve place ID from universe ID:', error.message);
    }
    return null;
  }

  public static buildDirectAssetDownloadUrls(assetId, placeIds = [], isSoundMode = false) {
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

  public static getPlaceIdFromDownloadUrl(url) {
    try {
      return new URL(url).searchParams.get('placeId') || null;
    } catch {
      return null;
    }
  }

  public static buildDirectAssetDownloadAttempts(assetId, placeIds = [], isSoundMode = false) {
    return AssetService.buildDirectAssetDownloadUrls(assetId, placeIds, isSoundMode).map((url) => ({
      url,
      placeId: AssetService.getPlaceIdFromDownloadUrl(url),
    }));
  }

  public static normalizeAssetTypeName(value) {
    const text = String(value || '').toLowerCase();
    if (text.includes('sound') || text.includes('audio') || text === '3') return 'Audio';
    if (text.includes('anim') || text === '24') return 'Animation';
    return '';
  }

  public static getAssetTypeNameFromMetadata(metadata) {
    return (
      AssetService.normalizeAssetTypeName(metadata?.assetTypeName || metadata?.assetType) ||
      AssetService.normalizeAssetTypeName(metadata?.assetTypeId)
    );
  }

  public static getEntryAssetTypeName(entry, fallback = 'Animation') {
    return AssetService.normalizeAssetTypeName(entry?.assetTypeName || entry?.assetType) || fallback;
  }

  public static getAssetKindLabel(assetTypeName) {
    return AssetService.getEntryAssetTypeName({ assetTypeName }) === 'Audio' ? 'Sound' : 'Animation';
  }

  public static summarizeAssetTypes(entries) {
    const audio = entries.filter((entry) => AssetService.getEntryAssetTypeName(entry) === 'Audio').length;
    const animations = entries.length - audio;
    if (audio > 0 && animations > 0) return `${animations} animation(s), ${audio} sound(s)`;
    if (audio > 0) return `${audio} sound(s)`;
    return `${animations} animation(s)`;
  }

  public static normalizePlaceContextId(value) {
    const id = extractNumericId(value);
    return id && id !== '0' ? id : '';
  }

  public static uniquePlaceIds(...groups) {
    const seen = new Set();
    const ids = [];

    for (const group of groups) {
      const values = Array.isArray(group) ? group : [group];
      for (const value of values) {
        const id = AssetService.normalizePlaceContextId(value);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }

    return ids;
  }
}
