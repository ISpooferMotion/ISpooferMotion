import { invoke } from '@tauri-apps/api/core';

export interface RobloxUserInfo {
  id: number;
  name: string;
  displayName: string;
  avatarUrl?: string;
  authType?: 'cookie';
}

export interface RobloxGroup {
  id: number;
  name: string;
  iconUrl?: string;
}

export interface CookieValidationResult {
  user: RobloxUserInfo;
  cookie: string;
}

export const USER_CACHE_KEY = 'ISpooferMotion_DetectedUsers';
const GROUP_CACHE_KEY_PREFIX = 'ISpooferMotion_DetectedGroups_';

export const normalizeId = (value: string | number | null | undefined) =>
  String(value ?? '').trim();

// pulls the cached roblox profiles out of localstorage so we don't have to hit the API constantly
export const loadCachedUsers = (): RobloxUserInfo[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(USER_CACHE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveCachedUsers = (nextUsers: RobloxUserInfo[]) => {
  const unique = Array.from(
    new Map(
      nextUsers.map((user) => [`${normalizeId(user.id)}_${user.authType || 'cookie'}`, user]),
    ).values(),
  );
  localStorage.setItem(USER_CACHE_KEY, JSON.stringify(unique));
};

export const mergeCachedUser = (user: RobloxUserInfo) => {
  const nextUsers = Array.from(
    new Map(
      [...loadCachedUsers(), user].map((item) => [
        `${normalizeId(item.id)}_${item.authType || 'cookie'}`,
        item,
      ]),
    ).values(),
  );
  saveCachedUsers(nextUsers);
  return nextUsers;
};

const groupCacheKey = (userId: string) => `${GROUP_CACHE_KEY_PREFIX}${normalizeId(userId)}`;

export const loadCachedGroups = (userId: string): RobloxGroup[] => {
  if (!userId || userId === 'none') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(groupCacheKey(userId)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveCachedGroups = (userId: string, nextGroups: RobloxGroup[]) => {
  if (!userId || userId === 'none') return;
  const unique = Array.from(
    new Map(nextGroups.map((group) => [normalizeId(group.id), group])).values(),
  );
  localStorage.setItem(groupCacheKey(userId), JSON.stringify(unique));
};

// grabs a roblox cookie either from studio's registry keys or by scanning browser profiles
export const detectCookie = async (mode: 'studio' | 'browser', userId: string | null = null) => {
  const payload = { userId };
  if (mode === 'browser') {
    return invoke<string | null>('get_cookie_from_auto_detect', payload).catch(() => null);
  } else if (mode === 'studio') {
    return invoke<string | null>('get_cookie_from_roblox_studio', payload).catch(() => null);
  }
  return null;
};

export const deleteSavedProfileCookie = async (userId: string) => {
  if (!userId || userId === 'none') return;
  await invoke('delete_saved_roblox_profile_cookie', { userId }).catch(() => null);
};

export const logIsm = (
  level: 'info' | 'success' | 'warn' | 'error',
  message: string,
  notify?: boolean,
) => {
  if (typeof window !== 'undefined' && typeof window.ismLog === 'function') {
    window.ismLog(level, message, notify);
    return;
  }

  if (level === 'error') console.error(message);
  else if (level === 'warn') console.warn(message);
  else if (level === 'success') console.info(message);
  else console.info(message);
};

export const hydrateUserProfile = async (
  userId: string,
  authType: RobloxUserInfo['authType'] = 'cookie',
) => {
  const [info, avatarUrl] = await Promise.all([
    invoke<RobloxUserInfo>('get_roblox_user_info', { userId }),
    invoke<string>('get_roblox_user_avatar', { userId }).catch(() => ''),
  ]);
  return { ...info, avatarUrl: avatarUrl || undefined, authType };
};

// verifies the cookie actually works and grabs the user's info before we save it
export const validateCookieProfile = async (cookie: string): Promise<CookieValidationResult> => {
  const trimmedCookie = cookie.trim();
  if (!trimmedCookie) {
    throw new Error('No cookie was provided.');
  }

  const userId = await invoke<string>('get_authenticated_user_id', {
    cookie: trimmedCookie,
  });
  const user = await hydrateUserProfile(userId, 'cookie');
  mergeCachedUser(user);
  return { user, cookie: trimmedCookie };
};
