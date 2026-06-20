'use strict';

import { buildRobloxCookieHeader, normalizeRobloxCookie } from './common';

const ROBLOX_COOKIE_ROLLOUT_URL =
  'https://devforum.roblox.com/t/upcoming-roblosecurity-cookie-format-changes/4328913';

const sessionsByCookie = new Map();

function getSetCookieHeaders(response: Response) {
  if (!response?.headers) return [];
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }

  const combined = response.headers.get?.('set-cookie');
  return combined ? [combined] : [];
}

function extractRotatedRobloxCookie(response: Response) {
  for (const header of getSetCookieHeaders(response)) {
    const match = String(header).match(/(?:^|,\s*)\.ROBLOSECURITY=([^;,\r\n]+)/i);
    const cookie = normalizeRobloxCookie(match?.[1] || '');
    if (cookie) return cookie;
  }
  return '';
}

class RobloxSession {
  cookie: string;
  cookieRotatedListeners: Map<unknown, (cookie: string) => void>;

  constructor(cookie: string) {
    this.cookie = '';
    this.cookieRotatedListeners = new Map();
    this.setCookie(cookie);
  }

  addCookieRotatedListener(listener: (cookie: string) => void, listenerKey: unknown = listener) {
    if (typeof listener === 'function') this.cookieRotatedListeners.set(listenerKey, listener);
    return this;
  }

  getCookieHeader() {
    return buildRobloxCookieHeader(this.cookie);
  }

  setCookie(cookie: string) {
    const normalized = normalizeRobloxCookie(cookie);
    if (!normalized || normalized === this.cookie) return false;

    // Evict the old cookie entry to prevent the Map from leaking rotated cookies.
    if (this.cookie) sessionsByCookie.delete(this.cookie);
    this.cookie = normalized;
    sessionsByCookie.set(normalized, this);
    return true;
  }

  absorbResponse(response: Response) {
    const rotatedCookie = extractRotatedRobloxCookie(response);
    if (!rotatedCookie || !this.setCookie(rotatedCookie)) return false;

    for (const listener of this.cookieRotatedListeners.values()) {
      Promise.resolve()
        .then(() => listener(rotatedCookie))
        .catch(() => {});
    }
    return true;
  }

  async fetch(url: string | URL | Request, options: RequestInit = {}, requestOptions: { includeCookie?: boolean } = {}) {
    const headers = new Headers(options.headers || {});
    if (requestOptions.includeCookie !== false) {
      const cookieHeader = this.getCookieHeader();
      if (cookieHeader) headers.set('Cookie', cookieHeader);
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });
    this.absorbResponse(response);
    return response;
  }
}

function createRobloxSession(cookieOrSession: string | RobloxSession, options: { onCookieRotated?: (cookie: string) => void, cookieRotatedListenerKey?: unknown } = {}) {
  if (cookieOrSession instanceof RobloxSession) {
    return cookieOrSession.addCookieRotatedListener(
      options.onCookieRotated!,
      options.cookieRotatedListenerKey,
    );
  }

  const normalized = normalizeRobloxCookie(cookieOrSession);
  const session = sessionsByCookie.get(normalized) || new RobloxSession(normalized);
  return session.addCookieRotatedListener(
    options.onCookieRotated!,
    options.cookieRotatedListenerKey,
  );
}

function describeRobloxAuthStatus(status: number | string) {
  if (Number(status) === 401) {
    return `Roblox rejected the session cookie (401). Sign in again so the app can receive the rotated cookie required by Roblox's 2026 rollout: ${ROBLOX_COOKIE_ROLLOUT_URL}`;
  }
  if (Number(status) === 403) {
    return 'Roblox denied access to this asset (403). The asset, account, or selected place may not have permission to download it.';
  }
  return '';
}

export {
  ROBLOX_COOKIE_ROLLOUT_URL,
  RobloxSession,
  createRobloxSession,
  describeRobloxAuthStatus,
  extractRotatedRobloxCookie,
};
