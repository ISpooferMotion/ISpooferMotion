'use strict';

const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const keytar = require('keytar');
const fs = require('node:fs/promises');
const { DEVELOPER_MODE } = require('./common');
const { createRobloxSession } = require('./roblox-session');

// --- Constants & Config ---

const execFileAsync = promisify(execFile);
// New Roblox cookies are not guaranteed to keep the old hex-only suffix. Keep
// auto-detection format-agnostic so rotated cookies from the 2026 rollout work.
const ROBLOX_COOKIE_PATTERN =
  /_\|WARNING:-DO-NOT-SHARE-THIS\.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items\.\|_[^;\s"'\\]+/i;
const ROBLOX_STUDIO_COOKIE_TARGET = 'https://www.roblox.com:RobloxStudioAuth.ROBLOSECURITY';
const ROBLOX_USER_AGENT = 'RobloxStudio/WinInet';
const DEFAULT_TIMEOUT_MS = 15_000;
const BROWSER_COOKIE_SCAN_BYTES = 25 * 1024 * 1024;

// --- Network & Debug Utilities ---

function debugLog(...args) {
  if (DEVELOPER_MODE) console.log(...args);
}

function debugWarn(...args) {
  if (DEVELOPER_MODE) console.warn(...args);
}

function withTimeout(options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (typeof AbortSignal?.timeout !== 'function') return options;
  return { ...options, signal: options.signal || AbortSignal.timeout(timeoutMs) };
}

async function readResponseText(response, maxLength = 300) {
  try {
    return (await response.text()).slice(0, maxLength);
  } catch {
    return '';
  }
}

async function readJsonResponse(response, context) {
  let data;
  try {
    data = await response.json();
  } catch (err) {
    const body = await readResponseText(response);
    throw new Error(`${context} returned invalid JSON${body ? `: ${body}` : ''}`, { cause: err });
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`${context} returned an invalid response shape`);
  }
  return data;
}

// --- Cookie Extraction & File Scanning ---

function extractRobloxCookie(rawValue) {
  if (!rawValue) return undefined;
  const text = Buffer.isBuffer(rawValue) ? rawValue.toString('latin1') : String(rawValue);
  return text.match(ROBLOX_COOKIE_PATTERN)?.[0];
}

async function readPossibleCookieFile(filePath) {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const stat = await handle.stat();
      const length = Math.min(stat.size, BROWSER_COOKIE_SCAN_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, 0);
      return extractRobloxCookie(buffer);
    } finally {
      await handle.close();
    }
  } catch (err) {
    debugWarn('(Dev) Could not scan browser cookie file:', filePath, err.message);
    return undefined;
  }
}

async function findExistingFiles(paths) {
  const existing = [];
  for (const filePath of paths) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) existing.push(filePath);
    } catch {}
  }
  return existing;
}

function getBrowserCookieFileCandidates() {
  const home = os.homedir();
  const candidates = [];

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const chromiumRoots = [
      path.join(local, 'Google', 'Chrome', 'User Data'),
      path.join(local, 'Microsoft', 'Edge', 'User Data'),
      path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      path.join(roaming, 'Opera Software', 'Opera Stable'),
      path.join(roaming, 'Opera Software', 'Opera GX Stable'),
    ];

    for (const root of chromiumRoots) {
      for (const profile of ['Default', 'Profile 1', 'Profile 2', 'Profile 3']) {
        candidates.push(path.join(root, profile, 'Network', 'Cookies'));
        candidates.push(path.join(root, profile, 'Cookies'));
      }
      candidates.push(path.join(root, 'Network', 'Cookies'));
      candidates.push(path.join(root, 'Cookies'));
    }

    candidates.push(path.join(roaming, 'Mozilla', 'Firefox', 'Profiles'));
  } else if (process.platform === 'darwin') {
    const appSupport = path.join(home, 'Library', 'Application Support');
    for (const root of [
      path.join(appSupport, 'Google', 'Chrome'),
      path.join(appSupport, 'Microsoft Edge'),
      path.join(appSupport, 'BraveSoftware', 'Brave-Browser'),
    ]) {
      for (const profile of ['Default', 'Profile 1', 'Profile 2', 'Profile 3']) {
        candidates.push(path.join(root, profile, 'Network', 'Cookies'));
        candidates.push(path.join(root, profile, 'Cookies'));
      }
    }
    candidates.push(path.join(appSupport, 'Firefox', 'Profiles'));
  }

  return candidates;
}

async function expandBrowserCookieCandidates() {
  const candidates = [];
  for (const candidate of getBrowserCookieFileCandidates()) {
    if (path.basename(candidate) === 'Profiles') {
      try {
        const entries = await fs.readdir(candidate, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            candidates.push(path.join(candidate, entry.name, 'cookies.sqlite'));
          }
        }
      } catch {}
    } else {
      candidates.push(candidate);
    }
  }
  return findExistingFiles([...new Set(candidates)]);
}

async function getCookieFromBrowserProfiles() {
  if (!['darwin', 'win32'].includes(process.platform)) return undefined;

  const files = await expandBrowserCookieCandidates();
  for (const filePath of files) {
    const cookie = await readPossibleCookieFile(filePath);
    if (cookie) {
      try {
        await getAuthenticatedUserId(cookie);
        debugLog(`(Dev) Found valid Roblox cookie in browser profile file: ${filePath}`);
        return cookie;
      } catch (err) {
        if (err.message.includes('(401)')) {
          debugWarn(`(Dev) Cookie from ${filePath} is expired (401).`);
          continue;
        }
        debugWarn(`(Dev) Using browser cookie despite validation error:`, err.message);
        return cookie;
      }
    }
  }
  return undefined;
}

async function getCookieFromAutoDetect(userId = null) {
  const studioAttempt = getCookieFromRobloxStudio(userId)
    .then((cookie) => ({ source: 'studio', cookie, id: 'studio' }))
    .catch((err) => {
      debugWarn('(Dev) Studio cookie auto-detect failed:', err.message);
      return { source: 'studio', cookie: undefined, id: 'studio' };
    });
  studioAttempt.id = 'studio';
  const browserAttempt = getCookieFromBrowserProfiles()
    .then((cookie) => ({ source: 'browser', cookie, id: 'browser' }))
    .catch((err) => {
      debugWarn('(Dev) Browser cookie auto-detect failed:', err.message);
      return { source: 'browser', cookie: undefined, id: 'browser' };
    });
  browserAttempt.id = 'browser';
  let attempts = [studioAttempt, browserAttempt];

  while (attempts.length > 0) {
    const result = await Promise.race(attempts);
    attempts = attempts.filter((attempt) => attempt.id !== result.id);
    if (result.cookie) {
      debugLog(`(Dev) Auto-detected Roblox cookie from ${result.source}`);
      return result.cookie;
    }
  }
  return undefined;
}

// --- Platform-Specific Extractors ---

/**
 * Retrieves Roblox cookie from Roblox Studio or Windows Credential Manager.
 */
async function getCookieFromRobloxStudio(userId = null) {
  if (!['darwin', 'win32'].includes(process.platform)) return undefined;

  if (process.platform === 'darwin') {
    try {
      const cookieFile = path.join(
        os.homedir(),
        'Library/HTTPStorages/com.Roblox.RobloxStudio.binarycookies',
      );
      const binaryCookieData = await fs.readFile(cookieFile);
      const cookie = extractRobloxCookie(binaryCookieData);
      if (cookie) {
        try {
          await getAuthenticatedUserId(cookie);
          return cookie;
        } catch (err) {
          if (err.message.includes('(401)')) {
            debugWarn('(Dev) Binarycookies cookie is expired (401).');
          } else {
            debugWarn('(Dev) Using binarycookie despite validation error:', err.message);
            return cookie;
          }
        }
      }
    } catch (err) {
      debugWarn('(Dev) Could not read Roblox cookie from binarycookies:', err.message);
    }
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync('cmdkey', ['/list'], {
      windowsHide: true,
      maxBuffer: 512 * 1024,
    });

    const requestedUserId = userId == null ? '' : String(userId).replace(/\D/g, '');
    const targets = String(stdout)
      .split(/\r?\n/)
      .map((line) => line.match(/Target:\s*LegacyGeneric:target=(.+)/)?.[1]?.trim())
      .filter(Boolean)
      .filter((target) => target.includes(ROBLOX_STUDIO_COOKIE_TARGET))
      .sort((a, b) => {
        const aIncludesUser = requestedUserId && a.includes(requestedUserId) ? 1 : 0;
        const bIncludesUser = requestedUserId && b.includes(requestedUserId) ? 1 : 0;
        if (aIncludesUser !== bIncludesUser) return bIncludesUser - aIncludesUser;

        const numA = Number.parseInt(a.split('ROBLOSECURITY')[1], 10) || 0;
        const numB = Number.parseInt(b.split('ROBLOSECURITY')[1], 10) || 0;
        return numB - numA;
      });

    for (const target of targets) {
      try {
        const token = await keytar.findPassword(target);
        if (token) {
          try {
            await getAuthenticatedUserId(token);
            debugLog(`(Dev) Using valid Roblox cookie from credential: ${target}`);
            return token;
          } catch (err) {
            if (err.message.includes('(401)')) {
              debugWarn(`(Dev) Cookie from credential ${target} is expired (401).`);
              continue;
            }
            debugWarn(`(Dev) Using Studio cookie despite validation error:`, err.message);
            return token;
          }
        }
      } catch (err) {
        debugWarn('(Dev) Could not read credential target:', target, err.message);
      }
    }
  } catch (err) {
    debugWarn('(Dev) Could not read Roblox cookie from Windows Credential Manager:', err.message);
  }

  return undefined;
}

// --- Roblox API Methods ---

/**
 * Fetches CSRF token from Roblox auth endpoint.
 */
async function getCsrfToken(cookie) {
  const csrfUrl = 'https://auth.roblox.com/v2/logout';
  const robloxSession = createRobloxSession(cookie);
  const cookieHeader = robloxSession.getCookieHeader();

  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');

  let response;
  try {
    response = await robloxSession.fetch(
      csrfUrl,
      withTimeout({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': ROBLOX_USER_AGENT,
        },
        body: '{}',
      }),
    );
  } catch (err) {
    throw new Error(`Network error fetching CSRF token: ${err.message}`, { cause: err });
  }

  const token = response.headers.get('x-csrf-token');
  if (!token) {
    const body = await readResponseText(response, 200);
    throw new Error(
      `No X-CSRF-TOKEN in response header. CSRF endpoint returned ${response.status}${body ? `: ${body}` : ''}`,
    );
  }

  return token;
}

/**
 * Gets the authenticated user's ID from the Roblox API using their cookie.
 */
async function getAuthenticatedUserId(cookie) {
  const robloxSession = createRobloxSession(cookie);
  const cookieHeader = robloxSession.getCookieHeader();
  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');

  const response = await robloxSession.fetch(
    'https://users.roblox.com/v1/users/authenticated',
    withTimeout({
      headers: {
        'User-Agent': ROBLOX_USER_AGENT,
      },
    }),
  );

  if (!response.ok) {
    const errorText = await readResponseText(response, 200);
    throw new Error(
      `Failed to get authenticated user ID (${response.status})${errorText ? `: ${errorText}` : ''}`,
    );
  }

  const data = await readJsonResponse(response, 'Authenticated user API');
  if (!data.id) throw new Error('No user ID in authenticated user response');

  return String(data.id);
}

module.exports = {
  getCookieFromRobloxStudio,
  getCookieFromBrowserProfiles,
  getCookieFromAutoDetect,
  getCsrfToken,
  getAuthenticatedUserId,
  withTimeout,
  readResponseText,
  readJsonResponse,
  ROBLOX_USER_AGENT,
  debugLog,
  debugWarn,
};
