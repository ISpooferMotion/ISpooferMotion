import { extractNumericId } from './common';
import { AssetService } from './AssetService';
// @ts-nocheck
import { withTimeout, readResponseText, readJsonResponse, ROBLOX_USER_AGENT, debugLog, debugWarn, getCookieFromAutoDetect } from './auth';
import { createRobloxSession } from './roblox-session';

export class RobloxApiService {
  public static getCleanAssetName(value, assetId) {
    const name = String(value || '').trim();
    if (!name) return '';
    if (/^unknown$/i.test(name)) return '';
    if (assetId && name === String(assetId)) return '';
    return name;
  }
  
  
  public static shouldRefreshAssetName(entry, force = false) {
    if (force) return true;
    return !RobloxApiService.getCleanAssetName(entry?.name, entry?.id);
  }
  
  
  public static getAssetNameFromDetails(data) {
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
      const name = RobloxApiService.getCleanAssetName(candidate);
      if (name) return name;
    }
  
    return '';
  }
  
  
  public static getAssetCreatorFromDetails(data) {
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
  
  
  public static getAssetMetadataFromDetails(data) {
    const creator = RobloxApiService.getAssetCreatorFromDetails(data);
    const assetTypeId = data?.AssetTypeId || data?.assetTypeId || data?.asset?.AssetTypeId || null;
    return {
      name: RobloxApiService.getAssetNameFromDetails(data),
      assetTypeId,
      assetTypeName: AssetService.normalizeAssetTypeName(assetTypeId),
      ...(creator || {}),
    };
  }
  
  
  public static applyResolvedAssetMetadata(entry, metadata, options = {}) {
    if (!entry || !metadata) return false;
  
    const forceName = Boolean(options.forceName);
    let changed = false;
    const resolvedName = RobloxApiService.getCleanAssetName(metadata.name, entry.id);
    if (resolvedName && (forceName || RobloxApiService.shouldRefreshAssetName(entry))) {
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
  
    const assetTypeName = AssetService.getAssetTypeNameFromMetadata(metadata);
    if (assetTypeName && entry.assetTypeName !== assetTypeName) {
      entry.assetTypeName = assetTypeName;
      changed = true;
    }
  
    return changed;
  }
  
  
  public static async fetchAssetMetadata(assetId, robloxSession) {
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
  
  
  public static async resolveAssetEntryMetadata(entries, robloxSession, options = {}) {
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
          forceName: force || RobloxApiService.shouldRefreshAssetName(entry, force),
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
  
  
  public static async fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  
  
  public static async getRobloxProfile(context) {
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
        } catch {}
      }
  
      return {
        user: { id: userId, name: username, avatarUrl },
        group: groupInfo,
      };
    } catch {
      return null;
    }
  }
  
  
  public static async detectOpenCloudApiKeyOwner(apiKey) {
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
  
  
  public static async validateOpenCloudApiKey(apiKey) {
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
        ok: false,
        code: 'network',
        message: `Could not reach Roblox to validate the API key: ${err.message}. Check your internet connection and try again, or skip validation by saving the key directly in Profiles.`,
      };
    }
  }
  
}
