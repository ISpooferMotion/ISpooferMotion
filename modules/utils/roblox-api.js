// modules/utils/roblox-api.js
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const keytar = require('keytar');
const fs = require('fs').promises;
const { DEVELOPER_MODE } = require('./common');

/**
 * Retrieves Roblox cookie from Roblox Studio or Windows Credential Manager
 */
async function getCookieFromRobloxStudio(userId = null) {
  if (!['darwin', 'win32', 'linux'].includes(process.platform)) return undefined;

  if (process.platform === 'darwin') {
    try {
      const homePath = os.homedir();
      const cookieFile = path.join(homePath, 'Library/HTTPStorages/com.Roblox.RobloxStudio.binarycookies');
      const binaryCookieData = await fs.readFile(cookieFile, { encoding: 'utf-8' });
      const matchGroups = binaryCookieData.match(
        /_\|WARNING:-DO-NOT-SHARE-THIS\.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items\.\|_[A-F\d]+/
      );
      return matchGroups?.[0];
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Could not read Roblox cookie from binarycookies:', err.message);
      return undefined;
    }
  }

  if (process.platform === 'win32') {
    try {
      const stdout = await new Promise((resolve, reject) => {
        exec('cmdkey /list', (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
      const lines = stdout.split('\n');
      const robloxTargets = [];
      for (const line of lines) {
        // Look only for RobloxStudioAuth.ROBLOSECURITY credentials
        if (line.includes('RobloxStudioAuth.ROBLOSECURITY')) {
          const match = line.match(/Target:\s*LegacyGeneric:target=(.+)/);
          if (match) {
            robloxTargets.push(match[1]);
          }
        }
      }
      
      robloxTargets.sort((a, b) => {
        const numA = parseInt(a.split('ROBLOSECURITY')[1]) || 0;
        const numB = parseInt(b.split('ROBLOSECURITY')[1]) || 0;
        return numB - numA;
      });
      for (const target of robloxTargets) {
        try {
          const token = await keytar.findPassword(target);
          if (token) {
            return token;
          }
        } catch (e) {
          // Continue to next
        }
      }
      return undefined;
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Could not read Roblox cookie from Windows Credential Manager:', err.message);
      return undefined;
    }
  }
  return undefined;
}

/**
 * Fetches CSRF token from Roblox auth endpoint
 */
async function getCsrfToken(cookie) {
  const csrfUrl = 'https://auth.roblox.com/v2/logout';
  const csrfHeaders = { 'Cookie': `.ROBLOSECURITY=${cookie}`, 'Content-Type': 'application/json' };
  let response;
  try {
    response = await fetch(csrfUrl, { method: 'POST', headers: csrfHeaders, body: JSON.stringify({}) });
  } catch (networkError) {
    console.error('Network error fetching CSRF token:', networkError);
    throw new Error(`Network error fetching CSRF token: ${networkError.message}`);
  }
  const token = response.headers.get('x-csrf-token');
  if (!token) {
    let errorDetails = `CSRF token endpoint (${csrfUrl}) returned status ${response.status}.`;
    try {
      const textBody = await response.text();
      errorDetails += ` Body: ${textBody.substring(0, 200)}`;
    } catch (e) {
      // ignore
    }
    throw new Error(`No X-CSRF-TOKEN in response header. ${errorDetails}`);
  }
  return token;
}

/**
 * Gets the rootPlace from each game the creator owns, with pagination and multiple fallbacks
 */
async function getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  // Always use the maximum page size to minimise HTTP round-trips.
  // We slice to maxPlaceIds at the end anyway, so over-fetching is fine.
  const limit = 50;

  async function getGamesPage(url) {
    const resp = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Failed to get games (${resp.status}): ${errorText.substring(0, 200)}`);
    }
    const data = await resp.json();
    if (!data || !data.data) {
      throw new Error(`Invalid response format. Response: ${JSON.stringify(data).substring(0, 200)}`);
    }
    return data;
  }

  let allGames = [];
  let cursor = null;
  let pagesRequested = 0;

  while (allGames.length < maxPlaceIds) {
    let url;
    const normalizedCreatorType = (creatorType || '').toLowerCase();
    if (normalizedCreatorType === 'group') {
      url = `https://games.roblox.com/v2/groups/${creatorId}/games?limit=${limit}`;
    } else {
      url = `https://games.roblox.com/v2/users/${creatorId}/games?sortOrder=Asc&limit=${limit}`;
    }
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    if (DEVELOPER_MODE) console.log(`(Dev) Fetching games page from URL: ${url}`);
    const pageData = await getGamesPage(url);

    if (!pageData.data || pageData.data.length === 0) {
      if (DEVELOPER_MODE) console.log(`(Dev) No games found on this page. Total collected: ${allGames.length}`);
      break;
    }

    allGames = allGames.concat(pageData.data);
    pagesRequested++;
    if (DEVELOPER_MODE) {
      console.log(`(Dev) Page ${pagesRequested}: Got ${pageData.data.length} games (total: ${allGames.length})`);
      pageData.data.forEach((game, idx) => {
        if (game.rootPlace && game.rootPlace.id) {
          console.log(`  Game ${idx}: "${game.name}" -> rootPlace ID: ${game.rootPlace.id}`);
        } else {
          console.log(`  Game ${idx}: "${game.name}" -> NO rootPlace found (keys: ${Object.keys(game).join(', ')})`);
        }
      });
    }

    if (!pageData.nextPageCursor) {
      if (DEVELOPER_MODE) console.log(`(Dev) No more pages available`);
      break;
    }

    cursor = pageData.nextPageCursor;
  }

  const rootPlaces = allGames
    .slice(0, maxPlaceIds)
    .map((game) => {
      if (game.rootPlace && game.rootPlace.id) return game.rootPlace.id;
      if (game.id) return game.id; // some APIs surface placeId directly as id
      return null;
    })
    .filter((id) => id !== null);

  if (rootPlaces.length === 0) {
    if (DEVELOPER_MODE) {
      console.log(`(Dev) No root places found. Sample game structures:`);
      allGames.slice(0, 3).forEach((game, idx) => {
        console.log(`  Game ${idx}:`, JSON.stringify(game, null, 2).substring(0, 200));
      });
    }
    throw new Error('No root places found in games');
  }

  if (DEVELOPER_MODE) console.log(`(Dev) Got ${rootPlaces.length} root places from ${pagesRequested} page(s): ${rootPlaces.join(', ')}`);
  return rootPlaces;
}

/**
 * Gets multiple place IDs from a creator to use as fallbacks
 */
async function getMultiplePlaceIds(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  try {
    const places = await getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds);
    return Array.isArray(places) ? places : [places];
  } catch (err) {
    if (DEVELOPER_MODE) console.warn(`(Dev) Failed to get place IDs: ${err.message}`);
    return [];
  }
}

/**
 * Resolves creator name to { creatorId, creatorType } by looking up the asset info
 * Used when we have creator name but need creator ID and type for API calls
 */
async function resolveCreatorNameToId(assetId, creatorName, cookie) {
  try {
    // Try to get asset info from Roblox to determine creator
    const resp = await fetch(`https://apis.roblox.com/assets/v1/assets/${assetId}`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    
    if (resp.ok) {
      const data = await resp.json();
      if (data.creator) {
        return {
          creatorId: data.creator.id,
          creatorType: data.creator.type || 'User',
        };
      }
    }
  } catch (err) {
    if (DEVELOPER_MODE) console.warn(`(Dev) Failed to resolve creator from asset ${assetId}:`, err.message);
  }

  // Fallback: try searching for user or group by name
  try {
    // Try as user first
    const userResp = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(creatorName)}&limit=1`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    
    if (userResp.ok) {
      const userData = await userResp.json();
      if (userData.data && userData.data.length > 0) {
        const match = userData.data.find(u => u.name.toLowerCase() === creatorName.toLowerCase());
        if (match) {
          return { creatorId: match.id, creatorType: 'User' };
        }
      }
    }
  } catch (err) {
    if (DEVELOPER_MODE) console.warn(`(Dev) Failed to search for user ${creatorName}:`, err.message);
  }

  // If all else fails, default to User type
  if (DEVELOPER_MODE) console.warn(`(Dev) Could not resolve creator name "${creatorName}" - defaulting to User type`);
  return { creatorId: creatorName, creatorType: 'User' };
}

/**
 * Lists all Roblox cookies found in system credential stores (Windows/macOS)
 * Returns an array of cookie strings
 */
async function listRobloxCookies() {
  const cookies = [];
  if (process.platform === 'win32') {
    try {
      const stdout = await new Promise((resolve, reject) => {
        exec('cmdkey /list', (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
      
      const lines = stdout.split('\n');
      const robloxTargets = [];
      for (const line of lines) {
        // Look only for RobloxStudioAuth.ROBLOSECURITY credentials
        if (line.includes('RobloxStudioAuth.ROBLOSECURITY')) {
          const match = line.match(/Target:\s*LegacyGeneric:target=(.+)/);
          if (match) {
            robloxTargets.push(match[1]);
          }
        }
      }
      
      // Sort newest first
      robloxTargets.sort((a, b) => {
        const numA = parseInt(a.split('ROBLOSECURITY')[1]) || 0;
        const numB = parseInt(b.split('ROBLOSECURITY')[1]) || 0;
        return numB - numA;
      });
      for (const target of robloxTargets) {
        try {
          const token = await keytar.findPassword(target);
          if (token) {
            cookies.push(token);
          }
        } catch (e) {
          // continue
        }
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) listRobloxCookies error (win32):', err.message);
    }
  } else if (process.platform === 'darwin') {
    // Basic support: try reading binarycookies and extract first match
    try {
      const homePath = os.homedir();
      const cookieFile = path.join(homePath, 'Library/HTTPStorages/com.Roblox.RobloxStudio.binarycookies');
      const binaryCookieData = await fs.readFile(cookieFile, { encoding: 'utf-8' });
      const matches = binaryCookieData.match(
        /_\|WARNING:-DO-NOT-SHARE-THIS\.-\-Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items\._\|_[A-F\d]+/g
      );
      if (matches && matches.length) cookies.push(...matches);
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) listRobloxCookies error (darwin):', err.message);
    }
  } else if (process.platform === 'linux') {
    // Linux: Try reading from Roblox Studio's cookie storage locations
    try {
      const homePath = os.homedir();
      // Roblox Studio on Linux typically stores cookies in ~/.config/roblox-studio
      const possiblePaths = [
        path.join(homePath, '.config', 'roblox-studio', 'cookies'),
        path.join(homePath, '.local', 'share', 'roblox-studio', 'cookies')
      ];
      
      for (const cookiePath of possiblePaths) {
        try {
          const cookieData = await fs.readFile(cookiePath, { encoding: 'utf-8' });
          const matches = cookieData.match(
            /_\|WARNING:-DO-NOT-SHARE-THIS\.-\-Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items\.\|_[A-F\d]+/g
          );
          if (matches && matches.length) cookies.push(...matches);
        } catch (err) {
          // Try next path
          continue;
        }
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) listRobloxCookies error (linux):', err.message);
    }
  }
  return cookies;
}

/**
 * Validates a Roblox cookie and returns the authenticated user { id, name }
 */
async function validateCookieAndGetUser(cookie) {
  const url = 'https://users.roblox.com/v1/users/authenticated';
  try {
    const resp = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
    if (!resp.ok) {
      return null;
    }
    const data = await resp.json();
    if (data && data.id) {
      return { id: data.id, name: data.name || data.displayName || String(data.id) };
    }
    return null;
  } catch (err) {
    if (DEVELOPER_MODE) console.warn('(Dev) validateCookieAndGetUser error:', err.message);
    return null;
  }
}

/**
 * Lists Roblox cookies from Firefox and Chrome browsers
 * Returns an array of cookie strings
 * SAFETY: Cookies are never logged in full, only validated and discarded
 * NOTE: Chrome on Windows uses DPAPI encryption (supported), Linux uses libsecret (limited support - recommend Firefox)
 */
async function listBrowserRobloxCookies() {
  const cookies = [];
  const sqlite3 = require('better-sqlite3');
  
  // Helper to mask cookies in logs
  const maskCookie = (cookie) => {
    if (!cookie || cookie.length < 16) return '[invalid]';
    return `...${cookie.slice(-8)}`;
  };

  // Firefox support (cookies are NOT encrypted, pure SQLite)
  if (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux') {
    try {
      const homePath = os.homedir();
      let firefoxProfilesPath;
      if (process.platform === 'win32') {
        firefoxProfilesPath = path.join(homePath, 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles');
      } else if (process.platform === 'darwin') {
        firefoxProfilesPath = path.join(homePath, 'Library', 'Application Support', 'Firefox', 'Profiles');
      } else {
        firefoxProfilesPath = path.join(homePath, '.mozilla', 'firefox');
      }

      const profiles = await fs.readdir(firefoxProfilesPath).catch(() => []);
      for (const profile of profiles) {
        const cookiesDb = path.join(firefoxProfilesPath, profile, 'cookies.sqlite');
        try {
          // Copy to temp to avoid lock issues
          const tempDb = path.join(os.tmpdir(), `firefox-cookies-${Date.now()}.sqlite`);
          await fs.copyFile(cookiesDb, tempDb).catch(() => null);
          
          if (await fs.stat(tempDb).catch(() => null)) {
            const db = sqlite3(tempDb, { readonly: true });
            const rows = db.prepare(
              'SELECT value FROM moz_cookies WHERE host LIKE "%roblox.com" AND name = ".ROBLOSECURITY"'
            ).all();
            db.close();
            
            // Clean up temp file
            await fs.unlink(tempDb).catch(() => {});
            
            if (rows && rows.length > 0) {
              const value = rows[0].value;
              if (value) {
                cookies.push(value);
                if (DEVELOPER_MODE) console.log(`(Dev) Found cookie from Firefox (${profile}): ${maskCookie(value)}`);
              }
            }
          }
        } catch (err) {
          // Silent fail for locked/missing databases
          if (DEVELOPER_MODE) console.warn(`(Dev) Firefox profile ${profile} skipped:`, err.message);
        }
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Firefox browser cookies unavailable:', err.message);
    }
  }

  // Chrome/Edge support (Windows and Linux - Linux cookies may be encrypted with libsecret/keyring)
  if (process.platform === 'win32' || process.platform === 'linux') {
    try {
      const homePath = os.homedir();
      const chromeProfilesPath = process.platform === 'win32'
        ? path.join(homePath, 'AppData', 'Local', 'Google', 'Chrome', 'User Data')
        : path.join(homePath, '.config', 'google-chrome');
      
      // Check if Chrome is installed
      if (await fs.stat(chromeProfilesPath).catch(() => null)) {
        const profiles = await fs.readdir(chromeProfilesPath).catch(() => []);
        
        for (const profile of profiles) {
          if (!profile.startsWith('Profile') && profile !== 'Default') continue;
          
          const cookiesDb = path.join(chromeProfilesPath, profile, 'Cookies');
          try {
            // Copy to temp to avoid lock issues
            const tempDb = path.join(os.tmpdir(), `chrome-cookies-${Date.now()}-${Math.random()}.sqlite`);
            await fs.copyFile(cookiesDb, tempDb).catch(() => null);
            
            if (await fs.stat(tempDb).catch(() => null)) {
              const db = sqlite3(tempDb, { readonly: true });
              const rows = db.prepare(
                'SELECT encrypted_value FROM cookies WHERE host_key LIKE "%roblox.com" AND name = ".ROBLOSECURITY"'
              ).all();
              db.close();
              
              // Clean up temp file
              await fs.unlink(tempDb).catch(() => {});
              
              if (rows && rows.length > 0) {
                try {
                  const encryptedValue = rows[0].encrypted_value;
                  
                  if (!encryptedValue) continue;
                  
                  // Chrome v80+ uses DPAPI encryption
                  let decryptedValue = null;
                  
                  try {
                    // Try to decrypt using win-dpapi (Windows only)
                    if (process.platform === 'win32') {
                      const dpapi = require('win-dpapi');
                      if (dpapi && typeof dpapi.unprotectData === 'function') {
                        decryptedValue = dpapi.unprotectData(encryptedValue, null, 'CurrentUser');
                        if (DEVELOPER_MODE) console.log(`(Dev) Successfully decrypted Chrome cookie`);
                      }
                    } else if (process.platform === 'linux') {
                      // Linux: Chrome cookies are encrypted with libsecret/gnome-keyring
                      // This is more complex to decrypt - recommend using Firefox or manual cookie entry
                      if (DEVELOPER_MODE) console.log(`(Dev) Chrome on Linux uses libsecret encryption - consider using Firefox`);
                    }
                  } catch (dpapiErr) {
                    if (DEVELOPER_MODE) console.warn(`(Dev) Cookie decryption failed:`, dpapiErr.message);
                  }
                  
                  // If decryption succeeded
                  if (decryptedValue && typeof decryptedValue === 'string' && decryptedValue.length > 50) {
                    cookies.push(decryptedValue);
                    if (DEVELOPER_MODE) console.log(`(Dev) Found cookie from Chrome (${profile}): ${maskCookie(decryptedValue)}`);
                  } else if (typeof encryptedValue === 'string' && encryptedValue.length > 50) {
                    // Fallback: try using as-is (for older Chrome or test scenarios)
                    cookies.push(encryptedValue);
                    if (DEVELOPER_MODE) console.log(`(Dev) Found cookie from Chrome without decryption (${profile}): ${maskCookie(encryptedValue)}`);
                  }
                } catch (decryptErr) {
                  if (DEVELOPER_MODE) console.warn(`(Dev) Chrome cookie processing failed:`, decryptErr.message);
                }
              }
            }
          } catch (err) {
            // Silent fail for locked/missing databases
            if (DEVELOPER_MODE) console.warn(`(Dev) Chrome profile ${profile} skipped:`, err.message);
          }
        }
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Chrome cookies unavailable:', err.message);
    }
  }

  if (DEVELOPER_MODE) console.log(`(Dev) Total browser cookies found: ${cookies.length}`);
  return cookies;
}

/**
 * Gets groups for a user that they have upload/creation permissions for
 * Uses the authenticated /canmanage endpoint which directly returns manageable groups
 * Returns array of { id, name }
 */
async function getUserGroupsWithUploadPerms(userId, cookie) {
  const groups = [];
  
  const maskCookie = (c) => {
    if (!c || c.length < 16) return '[invalid]';
    return `${c.slice(0, 4)}...${c.slice(-6)}`;
  };

  try {
    // Use the official canmanage endpoint - authenticated, returns groups user can manage
    const url = `https://develop.roblox.com/v1/user/groups/canmanage`;
    
    if (DEVELOPER_MODE) console.log(`(Dev) getUserGroupsWithUploadPerms called: userId=${userId}, cookie=${maskCookie(cookie)}`);
    if (DEVELOPER_MODE) console.log(`(Dev) Fetching groups from: ${url}`);
    
    const resp = await fetch(url, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });

    if (DEVELOPER_MODE) console.log(`(Dev) Groups response status: ${resp.status}`);

    if (!resp.ok) {
      if (DEVELOPER_MODE) console.warn(`(Dev) Failed to fetch manageable groups: ${resp.status}`);
      return groups;
    }

    const data = await resp.json();
    if (DEVELOPER_MODE) console.log(`(Dev) Groups response data:`, JSON.stringify(data).substring(0, 500));
    
    if (!data || !data.data || !Array.isArray(data.data)) {
      if (DEVELOPER_MODE) console.warn(`(Dev) Invalid canmanage response format`);
      return groups;
    }

    // The canmanage endpoint returns groups directly with id and name
    for (const groupData of data.data) {
      if (groupData.id && groupData.name) {
        groups.push({
          id: groupData.id,
          name: groupData.name
        });
      }
    }

    if (DEVELOPER_MODE) console.log(`(Dev) Found ${groups.length} manageable groups`);
  } catch (err) {
    if (DEVELOPER_MODE) console.error('(Dev) getUserGroupsWithUploadPerms error:', err.message);
  }

  return groups;
}

/**
 * Download an asset from Roblox
 * @param {string} assetId - The asset ID to download
 * @param {string} assetType - Type of asset (Sound, Animation, Image)
 * @param {string} cookie - Roblox cookie for authentication
 * @param {string} downloadPath - Path to save the downloaded file
 * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}
 */
async function downloadAsset(assetId, assetType, cookie, downloadPath) {
  const https = require('https');
  const fsSync = require('fs');
  
  try {
    const url = `https://assetdelivery.roblox.com/v1/asset/?id=${assetId}`;
    if (DEVELOPER_MODE) console.log(`(Dev) Downloading asset: ID=${assetId}, Type=${assetType}, URL=${url}`);
    
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'Cookie': `.ROBLOSECURITY=${cookie}`,
          'User-Agent': 'Roblox/WinInet',
        },
      };
      
      https.get(url, options, (response) => {
        if (DEVELOPER_MODE) console.log(`(Dev) Asset delivery response status: ${response.statusCode}`);
        
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          const redirectUrl = response.headers.location;
          if (DEVELOPER_MODE) console.log(`(Dev) Following redirect to: ${redirectUrl}`);
          
          https.get(redirectUrl, (redirectResponse) => {
            if (redirectResponse.statusCode !== 200) {
              if (DEVELOPER_MODE) console.warn(`(Dev) Redirect response status: ${redirectResponse.statusCode}`);
              resolve({ success: false, error: `Download failed with status ${redirectResponse.statusCode}` });
              return;
            }
            
            const fileStream = fsSync.createWriteStream(downloadPath);
            redirectResponse.pipe(fileStream);
            
            fileStream.on('finish', () => {
              fileStream.close();
              if (DEVELOPER_MODE) console.log(`(Dev) Asset downloaded successfully to: ${downloadPath}`);
              resolve({ success: true, filePath: downloadPath });
            });
            
            fileStream.on('error', (err) => {
              fsSync.unlink(downloadPath, () => {});
              if (DEVELOPER_MODE) console.error(`(Dev) File stream error: ${err.message}`);
              resolve({ success: false, error: err.message });
            });
          }).on('error', (err) => {
            if (DEVELOPER_MODE) console.error(`(Dev) Redirect request error: ${err.message}`);
            resolve({ success: false, error: err.message });
          });
        } else if (response.statusCode === 200) {
          const fileStream = fsSync.createWriteStream(downloadPath);
          response.pipe(fileStream);
          
          fileStream.on('finish', () => {
            fileStream.close();
            if (DEVELOPER_MODE) console.log(`(Dev) Asset downloaded successfully to: ${downloadPath}`);
            resolve({ success: true, filePath: downloadPath });
          });
          
          fileStream.on('error', (err) => {
            fsSync.unlink(downloadPath, () => {});
            if (DEVELOPER_MODE) console.error(`(Dev) File stream error: ${err.message}`);
            resolve({ success: false, error: err.message });
          });
        } else {
          if (DEVELOPER_MODE) console.warn(`(Dev) Unexpected response status: ${response.statusCode}`);
          resolve({ success: false, error: `Download failed with status ${response.statusCode}` });
        }
      }).on('error', (err) => {
        if (DEVELOPER_MODE) console.error(`(Dev) Request error: ${err.message}`);
        resolve({ success: false, error: err.message });
      });
    });
  } catch (err) {
    if (DEVELOPER_MODE) console.warn('(Dev) downloadAsset error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Upload an asset to Roblox
 * @param {string} filePath - Path to the file to upload
 * @param {string} assetType - Type of asset (Audio, Decal, etc.)
 * @param {string} assetName - Name for the uploaded asset
 * @param {string} groupId - Group ID to upload to
 * @param {string} cookie - Roblox cookie for authentication
 * @returns {Promise<{success: boolean, assetId?: string, error?: string}>}
 */
async function uploadAsset(filePath, assetType, assetName, groupId, userId, cookie, placeId) {
  const https = require('https');
  const FormData = require('form-data');
  const fsSync = require('fs');
  
  try {
    if (DEVELOPER_MODE) console.log(`(Dev) uploadAsset called: type=${assetType}, name=${assetName}, groupId=${groupId}, userId=${userId}`);
    
    // Get CSRF token
    const csrfToken = await getCsrfToken(cookie);
    if (!csrfToken) {
      if (DEVELOPER_MODE) console.error('(Dev) Failed to get CSRF token');
      return { success: false, error: 'Failed to get CSRF token' };
    }
    if (DEVELOPER_MODE) console.log(`(Dev) Got CSRF token: ${csrfToken.substring(0, 20)}...`);
    
    // Map asset types to Roblox asset type IDs
    const assetTypeMap = {
      'Sound': 3,
      'Audio': 3,
      'Image': 13,
      'Decal': 13,
      'Animation': 24,
    };
    
    const assetTypeId = assetTypeMap[assetType] || 13;
    
    // Determine creator context - group takes priority over user
    let creatorContext;
    if (groupId) {
      creatorContext = { groupId: parseInt(groupId) };
    } else if (userId) {
      creatorContext = { userId: parseInt(userId) };
    } else {
      if (DEVELOPER_MODE) console.error('(Dev) No groupId or userId provided');
      return { success: false, error: 'Either groupId or userId must be provided' };
    }
    
    if (DEVELOPER_MODE) console.log(`(Dev) Creator context:`, creatorContext);
    
    // Create form data
    const form = new FormData();
    const requestPayload = {
      assetType: assetTypeId,
      displayName: assetName,
      description: '',
      creationContext: {
        creator: creatorContext,
      },
    };
    if (DEVELOPER_MODE) console.log(`(Dev) Request payload:`, JSON.stringify(requestPayload));
    
    form.append('request', JSON.stringify(requestPayload));
    form.append('fileContent', fsSync.createReadStream(filePath));
    
    return new Promise((resolve, reject) => {
      const headers = {
        ...form.getHeaders(),
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'x-csrf-token': csrfToken,
        'User-Agent': 'Roblox/WinInet',
      };
      
      // Add placeId header if provided (for batch requests)
      if (placeId) {
        headers['Roblox-Place-Id'] = placeId;
      }
      
      const options = {
        method: 'POST',
        hostname: 'apis.roblox.com',
        path: '/assets/v1/assets',
        headers: headers,
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        
        if (DEVELOPER_MODE) console.log(`(Dev) Upload response status: ${res.statusCode}`);
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (DEVELOPER_MODE) console.log(`(Dev) Upload response body: ${data}`);
          
          try {
            if (res.statusCode === 200 || res.statusCode === 201) {
              const result = JSON.parse(data);
              if (result.assetId) {
                if (DEVELOPER_MODE) console.log(`(Dev) Upload successful, assetId: ${result.assetId}`);
                resolve({ success: true, assetId: result.assetId.toString() });
              } else {
                if (DEVELOPER_MODE) console.warn(`(Dev) Upload succeeded but no assetId in response`);
                resolve({ success: false, error: 'Upload succeeded but no assetId returned' });
              }
            } else {
              if (DEVELOPER_MODE) console.error(`(Dev) Upload failed: Status ${res.statusCode}, Body: ${data}`);
              resolve({ success: false, error: `Upload failed with status ${res.statusCode}: ${data}` });
            }
          } catch (err) {
            if (DEVELOPER_MODE) console.error(`(Dev) Failed to parse response: ${err.message}`);
            resolve({ success: false, error: `Failed to parse response: ${err.message}` });
          }
        });
      });
      
      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
      
      form.pipe(req);
    });
  } catch (err) {
    if (DEVELOPER_MODE) console.warn('(Dev) uploadAsset error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch audio upload quota for the current user or group.
 * Returns { remaining, used, total } when available.
 */
async function getAudioQuota(cookie, groupId = null) {
  const url = groupId
    ? `https://publish.roblox.com/v1/audio/quota?groupId=${encodeURIComponent(groupId)}`
    : 'https://publish.roblox.com/v1/audio/quota';

  const res = await fetch(url, {
    headers: {
      'Cookie': `.ROBLOSECURITY=${cookie}`,
      'User-Agent': 'RobloxStudio/WinInet',
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Quota check failed (${res.status}): ${body.substring(0, 200)}`);
  }

  const data = await res.json();
  // Normalize common field names
  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const remainingRaw = data.remaining ?? data.remainingQuota ?? data.quotaRemaining ?? null;
  const totalRaw = data.total ?? data.totalQuota ?? data.quota ?? null;
  const usedRaw = data.used ?? data.consumed ?? null;

  const remaining = toNumber(remainingRaw);
  const total = toNumber(totalRaw);
  const used = toNumber(usedRaw ?? (total !== null && remaining !== null ? total - remaining : null));

  return { remaining, total, used, raw: data };
}

module.exports = {
  getCookieFromRobloxStudio,
  getCsrfToken,
  getPlaceIdFromCreator,
  getMultiplePlaceIds,
  resolveCreatorNameToId,
  listRobloxCookies,
  validateCookieAndGetUser,
  listBrowserRobloxCookies,
  getUserGroupsWithUploadPerms,
  downloadAsset,
  uploadAsset,
  getAudioQuota,
};
