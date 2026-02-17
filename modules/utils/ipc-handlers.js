// modules/utils/ipc-handlers.js
const path = require('path');
const { ipcMain, app, dialog } = require('electron');
const crypto = require('crypto');
const { DEVELOPER_MODE } = require('./common');
const { listCreatorAssets } = require('./assets-api');
const { getCookieFromRobloxStudio, getCsrfToken, getPlaceIdFromCreator, listRobloxCookies, validateCookieAndGetUser, listBrowserRobloxCookies, getUserGroupsWithUploadPerms, getMultiplePlaceIds, resolveCreatorNameToId, getAudioQuota } = require('./roblox-api');
const { clearDownloadsDirectory, retryAsync, sanitizeFilename } = require('./common');
const { downloadAnimationAssetWithProgress, publishAnimationRbxmWithProgress, publishAssetWithProgress } = require('./transfer-handlers');
const { resolveAssetCreators } = require('./asset-creator-resolver');
const { downloadAssetsBatch, downloadAssetsIndividual } = require('./asset-downloader');
const fs = require('fs').promises;

// Prevent running the spoofer multiple times concurrently
let isSpooferRunning = false;

/**
 * Registers all IPC handlers for main process
 */
function registerIpcHandlers(getMainWindowFn, sendTransferUpdate, sendSpooferResultToRenderer, sendStatusMessage, assetServer) {
  ipcMain.on('window-minimize', () => getMainWindowFn()?.minimize());
  ipcMain.on('window-close', () => getMainWindowFn()?.close());

  ipcMain.handle('get-app-version', () => {
    try {
      return app.getVersion();
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to get app version:', err);
      return '0.0.0';
    }
  });

  ipcMain.on('open-external', (event, url) => {
    const { shell } = require('electron');
    try {
      if (typeof url === 'string' && url.trim()) {
        shell.openExternal(url);
      } else if (DEVELOPER_MODE) {
        console.warn('open-external called with invalid url:', url);
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to open external URL:', err);
    }
  });

  // Download and install update
  ipcMain.handle('download-and-install-update', (event, downloadUrl) => {
    try {
      const { downloadAndInstallUpdate } = require('./update-manager');
      downloadAndInstallUpdate(downloadUrl);
      return { ok: true };
    } catch (err) {
      if (DEVELOPER_MODE) console.error('[IPC] Download and install failed:', err);
      return { ok: false, error: err.message };
    }
  });

  // Open logs directory
  ipcMain.on('open-logs', (event) => {
    const { shell } = require('electron');
    const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
    try {
      shell.showItemInFolder(logsDir);
      if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Opened logs directory:', logsDir);
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to open logs directory:', err);
    }
  });

  // Reveal asset in file explorer
  ipcMain.on('reveal-asset', (event, assetId, assetType) => {
    const { shell } = require('electron');
    try {
      if (!assetId) {
        if (DEVELOPER_MODE) console.warn('reveal-asset called with invalid assetId:', assetId);
        return;
      }
      
      // Build path based on asset type
      const downloadsDir = path.join(app.getPath('downloads'), 'ISpooferMotion');
      let assetPath = path.join(downloadsDir, String(assetId));
      
      // Check if file exists, if not try with common extensions
      const fs = require('fs');
      const extensions = ['.rbxm', '.rbxmx', '.mp3', '.wav', '.ogg', '.png', '.jpg', '.jpeg'];
      
      let foundPath = null;
      if (fs.existsSync(assetPath)) {
        foundPath = assetPath;
      } else {
        for (const ext of extensions) {
          const pathWithExt = assetPath + ext;
          if (fs.existsSync(pathWithExt)) {
            foundPath = pathWithExt;
            break;
          }
        }
      }
      
      if (foundPath) {
        shell.showItemInFolder(foundPath);
        if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Revealed asset in explorer:', foundPath);
      } else {
        // If file doesn't exist, open the directory
        shell.openPath(downloadsDir);
        if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Asset not found, opened downloads directory:', downloadsDir);
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to reveal asset:', err);
    }
  });

  // Play sound asset
  ipcMain.on('play-sound', async (event, assetId) => {
    const { shell } = require('electron');
    const https = require('https');
    const fs = require('fs');
    
    try {
      if (!assetId) {
        if (DEVELOPER_MODE) console.warn('play-sound called with invalid assetId:', assetId);
        return;
      }
      
      const tempDir = path.join(app.getPath('temp'), 'ISpooferMotion-Audio');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const tempFile = path.join(tempDir, `sound_${assetId}.mp3`);
      
      // If already cached, just play it
      if (fs.existsSync(tempFile)) {
        shell.openPath(tempFile);
        if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Playing cached sound:', tempFile);
        return;
      }
      
      // Download the sound from Roblox
      const url = `https://assetdelivery.roblox.com/v1/asset/?id=${assetId}`;
      if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Downloading sound from:', url);
      
      const downloadFile = (downloadUrl) => {
        return new Promise((resolve, reject) => {
          const file = fs.createWriteStream(tempFile);
          
          https.get(downloadUrl, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
              file.close();
              fs.unlink(tempFile, () => {});
              downloadFile(response.headers.location).then(resolve).catch(reject);
              return;
            }
            
            if (response.statusCode !== 200) {
              file.close();
              fs.unlink(tempFile, () => {});
              reject(new Error(`HTTP ${response.statusCode}`));
              return;
            }
            
            response.pipe(file);
            
            file.on('finish', () => {
              file.close((err) => {
                if (err) {
                  fs.unlink(tempFile, () => {});
                  reject(err);
                } else {
                  resolve();
                }
              });
            });
            
            file.on('error', (err) => {
              file.close();
              fs.unlink(tempFile, () => {});
              reject(err);
            });
            
            response.on('error', (err) => {
              file.close();
              fs.unlink(tempFile, () => {});
              reject(err);
            });
          }).on('error', (err) => {
            file.close();
            fs.unlink(tempFile, () => {});
            reject(err);
          });
        });
      };
      
      await downloadFile(url);
      shell.openPath(tempFile);
      if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Sound downloaded and playing:', tempFile);
      
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to play sound:', err);
    }
  });

  ipcMain.on('run-spoofer-action', async (event, data) => {
    // Guard: avoid concurrent spoofer runs
    if (isSpooferRunning) {
      try {
        const ts = new Date().toLocaleTimeString();
        sendStatusMessage('Spoofer already running — please wait...');
        sendSpooferResultToRenderer({
          output: `[${ts}] [WARN] Spoofer is already running. Please wait for it to complete.\n`,
          success: null,
        });
      } catch (_) {}
      return;
    }

    isSpooferRunning = true;
    try {
      await handleSpooferAction(
        data,
        getMainWindowFn,
        sendTransferUpdate,
        sendSpooferResultToRenderer,
        sendStatusMessage
      );
    } finally {
      isSpooferRunning = false;
    }
  });

  // Replace asset IDs in the plugin
  ipcMain.handle('replace-asset-ids', async (event, mappings) => {
    try {
      if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Replacing asset IDs with mappings:', mappings);
      
      if (!Array.isArray(mappings) || mappings.length === 0) {
        return { ok: false, error: 'No mappings provided' };
      }

      // Send mappings to the asset server which will relay to the plugin
      if (assetServer) {
        // Post the mappings to the plugin via the asset server endpoint
        const https = require('https');
        const http = require('http');
        
        return new Promise((resolve) => {
          const data = JSON.stringify({ mappings });
          const options = {
            hostname: 'localhost',
            port: 3100,
            path: '/replace-ids',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
            },
          };

          const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
              responseData += chunk;
            });
            res.on('end', () => {
              try {
                const result = JSON.parse(responseData);
                resolve(result);
              } catch (err) {
                resolve({ ok: true, message: `Sent ${mappings.length} mappings to plugin` });
              }
            });
          });

          req.on('error', (err) => {
            if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): Error sending to asset server:', err.message);
            resolve({ ok: false, error: `Failed to send to plugin: ${err.message}` });
          });

          req.write(data);
          req.end();
        });
      }
      
      return { ok: false, error: 'Asset server not available' };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): replace-asset-ids error:', err);
      return { ok: false, error: err.message };
    }
  });

  // Asset Explorer: fetch assets from user/group
  ipcMain.handle('fetch-assets', async (event, query) => {
    try {
      if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): fetch-assets query:', query);
      const { creatorType, creatorId, assetTypes, cookie, limit, maxPages } = query || {};
      const result = await listCreatorAssets({ creatorType, creatorId, assetTypes, cookie, limit, maxPages });
      return { ok: true, result };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): fetch-assets error:', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Discover valid Roblox users from stored cookies
  ipcMain.handle('discover-valid-roblox-users', async (event, preferences) => {
    try {
      const { includeStudio = true, includeBrowsers = true } = preferences || {};
      const allCookies = [];
      const seenUserIds = new Set();
      const results = [];

      // Pull from Roblox Studio / Windows Credential Manager
      if (includeStudio) {
        const studioCookies = await listRobloxCookies();
        allCookies.push(...studioCookies);
        if (DEVELOPER_MODE) console.log(`(Dev) Found ${studioCookies.length} Studio/credential cookies`);
      }

      // Pull from browsers
      if (includeBrowsers) {
        const browserCookies = await listBrowserRobloxCookies();
        allCookies.push(...browserCookies);
        if (DEVELOPER_MODE) console.log(`(Dev) Found ${browserCookies.length} browser cookies`);
      }

      // Validate and deduplicate by user ID
      for (const cookie of allCookies) {
        const user = await validateCookieAndGetUser(cookie);
        if (user && !seenUserIds.has(user.id)) {
          seenUserIds.add(user.id);
          results.push(user);
        }
      }

      if (DEVELOPER_MODE) console.log(`(Dev) Validated ${results.length} unique users`);
      return { ok: true, result: results };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('discover-valid-roblox-users error:', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Get groups for a user with upload permissions
  ipcMain.handle('get-user-groups', async (event, userId, cookie) => {
    try {
      if (DEVELOPER_MODE) console.log(`(Dev) get-user-groups called: userId=${userId}, hasCookie=${!!cookie}, cookieLength=${cookie?.length || 0}`);
      
      if (!cookie) {
        if (DEVELOPER_MODE) console.warn('(Dev) get-user-groups: Missing cookie');
        return { ok: false, error: 'Missing cookie' };
      }
      
      if (DEVELOPER_MODE) console.log('(Dev) Calling getUserGroupsWithUploadPerms...');
      const groups = await getUserGroupsWithUploadPerms(userId, cookie);
      if (DEVELOPER_MODE) console.log(`(Dev) getUserGroupsWithUploadPerms returned ${groups.length} groups:`, groups.map(g => `${g.name} (${g.id})`));
      
      return { ok: true, result: groups };
    } catch (err) {
      if (DEVELOPER_MODE) console.error('(Dev) get-user-groups error:', err.message);
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Get a valid cookie for a specific user
  ipcMain.handle('get-cookie-for-user', async (event, userId, preferences) => {
    try {
      if (!userId) {
        return { ok: false, error: 'Missing userId' };
      }
      const { includeStudio = true, includeBrowsers = true } = preferences || {};
      const allCookies = [];

      // Pull from Roblox Studio / Windows Credential Manager
      if (includeStudio) {
        const studioCookies = await listRobloxCookies();
        allCookies.push(...studioCookies);
      }

      // Pull from browsers
      if (includeBrowsers) {
        const browserCookies = await listBrowserRobloxCookies();
        allCookies.push(...browserCookies);
      }

      // Validate each cookie and return the first one that matches the user
      for (const cookie of allCookies) {
        const user = await validateCookieAndGetUser(cookie);
        if (user && user.id === parseInt(userId)) {
          return { ok: true, cookie };
        }
      }

      return { ok: false, error: 'No valid cookie found for this user' };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('get-cookie-for-user error:', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Fetch sounds from the local asset server (Roblox dump)
  ipcMain.handle('fetch-server-sounds', async (event) => {
    try {
      if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Fetching server sounds');
      if (!assetServer) {
        return { ok: false, error: 'Asset server not initialized' };
      }
      const sounds = assetServer.getLastSounds();
      console.log('[ASSET-SERVER] Sounds data received:', JSON.stringify(sounds, null, 2));
      return { ok: true, result: sounds };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): fetch-server-sounds error:', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Fetch animations from the local asset server (Roblox dump)
  ipcMain.handle('fetch-server-animations', async (event) => {
    try {
      if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Fetching server animations');
      if (!assetServer) {
        return { ok: false, error: 'Asset server not initialized' };
      }
      const animations = assetServer.getLastAnimations();
      console.log('[ASSET-SERVER] Animations data received:', JSON.stringify(animations, null, 2));
      return { ok: true, result: animations };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): fetch-server-animations error:', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Request sound dump from Roblox via the asset server
  ipcMain.handle('request-sound-dump', async (event) => {
    try {
      if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Requesting sound dump from Roblox');
      if (assetServer) {
        assetServer.requestSoundDump();
      }
      return { ok: true };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): request-sound-dump error:', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Request animation dump from Roblox via the asset server
  ipcMain.handle('request-animation-dump', async (event) => {
    try {
      if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Requesting animation dump from Roblox');
      if (assetServer) {
        assetServer.requestAnimationDump();
      }
      return { ok: true };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): request-animation-dump error:', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Fetch images from the asset server
  ipcMain.handle('fetch-server-images', async (event) => {
    try {
      if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Fetching images from asset server');
      if (assetServer) {
        const data = assetServer.getLastImages();
        if (DEVELOPER_MODE && data.assets && data.assets.length > 0) {
          console.log('MAIN_PROCESS (Dev): Retrieved', data.assets.length, 'images from asset server');
        }
        return { ok: true, result: data };
      }
      return { ok: false, error: 'Asset server not available' };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): fetch-server-images error:', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Request image dump from Roblox via the asset server
  ipcMain.handle('request-image-dump', async (event) => {
    try {
      if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Requesting image dump from Roblox');
      if (assetServer) {
        assetServer.requestImageDump();
      }
      return { ok: true };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): request-image-dump error:', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Check if Roblox plugin is connected
  ipcMain.handle('check-plugin-status', async (event) => {
    try {
      if (!assetServer) {
        return { ok: false, error: 'Asset server not initialized' };
      }
      const status = assetServer.getPluginStatus();
      return { ok: true, result: status };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): check-plugin-status error:', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.on('toggle-aspect-ratio', (event, isLocked) => {
    const mainWindow = getMainWindowFn();
    if (mainWindow) {
      try {
        if (isLocked) {
          mainWindow.setAspectRatio(1.6); // 16:10 ratio
          if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Aspect ratio locked to 1.6');
        } else {
          mainWindow.setAspectRatio(0); // 0 disables aspect ratio lock
          if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Aspect ratio unlocked');
        }
      } catch (err) {
        if (DEVELOPER_MODE) console.warn('Failed to toggle aspect ratio:', err);
      }
    }
  });

  // Set window icon based on theme
  ipcMain.on('set-window-icon', (event, theme) => {
    const mainWindow = getMainWindowFn();
    if (mainWindow) {
      try {
        const iconPath = theme === 'light' 
          ? path.join(__dirname, '..', '..', 'assets', 'app_icon_light.ico')
          : path.join(__dirname, '..', '..', 'assets', 'app_icon_dark.ico');
        mainWindow.setIcon(iconPath);
        if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Window icon changed to', theme);
      } catch (err) {
        if (DEVELOPER_MODE) console.warn('Failed to set window icon:', err);
      }
    }
  });

  // Get plugin port from config
  ipcMain.handle('get-plugin-port', async () => {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      if (require('fs').existsSync(configPath)) {
        const config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
        return config.pluginPort || 3100;
      }
      return 3100;
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to get plugin port:', err);
      return 3100;
    }
  });

  // Get skip-owned-assets check preference
  ipcMain.handle('get-skip-owned-check', async () => {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      if (require('fs').existsSync(configPath)) {
        const config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
        if (typeof config.skipOwnedCheck === 'boolean') return config.skipOwnedCheck;
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to get skip-owned-check:', err);
    }
    return true; // default: skip owned assets
  });

  // Set plugin port in config (requires app restart to take effect)
  ipcMain.handle('set-plugin-port', async (event, port) => {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      let config = {};
      if (require('fs').existsSync(configPath)) {
        config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
      }
      config.pluginPort = port;
      require('fs').writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`[IPC] Plugin port set to ${port} (restart required)`);
      return { success: true, port };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to set plugin port:', err);
      return { success: false, error: err.message };
    }
  });

  // Set skip-owned-assets check preference and push to asset server
  ipcMain.handle('set-skip-owned-check', async (event, enabled) => {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      let config = {};
      if (require('fs').existsSync(configPath)) {
        config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
      }
      const value = enabled !== false;
      config.skipOwnedCheck = value;
      require('fs').writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      if (assetServer && typeof assetServer.setSkipOwnedCheck === 'function') {
        assetServer.setSkipOwnedCheck(value);
      }
      if (DEVELOPER_MODE) console.log(`[IPC] skipOwnedCheck set to ${value}`);
      return { success: true, value };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to set skip-owned-check:', err);
      return { success: false, error: err.message };
    }
  });

  // Download/output preferences
  ipcMain.handle('get-download-settings', async () => {
    const defaultDirectory = path.join(app.getPath('downloads'), 'ISpooferMotion');
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      if (require('fs').existsSync(configPath)) {
        const config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
        return {
          mode: config.transferMode || 'upload',
          directory: config.downloadDirectory || defaultDirectory,
        };
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to get download settings:', err);
    }
    return { mode: 'upload', directory: defaultDirectory };
  });

  ipcMain.handle('set-download-settings', async (_event, settings = {}) => {
    const defaultDirectory = path.join(app.getPath('downloads'), 'ISpooferMotion');
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      let config = {};
      if (require('fs').existsSync(configPath)) {
        config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
      }

      const mode = settings.mode === 'download' ? 'download' : 'upload';
      const directory = (typeof settings.directory === 'string' && settings.directory.trim()) || defaultDirectory;

      config.transferMode = mode;
      config.downloadDirectory = directory;

      require('fs').writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      if (DEVELOPER_MODE) console.log(`[IPC] Download settings saved: mode=${mode}, dir=${directory}`);
      return { success: true, mode, directory };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to set download settings:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('choose-download-directory', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
      }

      const chosenPath = result.filePaths[0];
      return { canceled: false, path: chosenPath };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to choose download directory:', err);
      return { canceled: true, error: err.message };
    }
  });

  // Get creator exclusion list
  ipcMain.handle('get-exclusion-list', async (event) => {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      if (require('fs').existsSync(configPath)) {
        const config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
        return config.exclusionList || { userIds: [], groupIds: [] };
      }
      return { userIds: [], groupIds: [] };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to get exclusion list:', err);
      return { userIds: [], groupIds: [] };
    }
  });

  // Add creator to exclusion list
  ipcMain.handle('add-to-exclusion-list', async (event, creatorType, creatorId) => {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      let config = {};
      if (require('fs').existsSync(configPath)) {
        config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
      }
      
      if (!config.exclusionList) {
        config.exclusionList = { userIds: [], groupIds: [] };
      }

      const idStr = String(creatorId);
      if (creatorType === 'User') {
        if (!config.exclusionList.userIds.includes(idStr)) {
          config.exclusionList.userIds.push(idStr);
        }
      } else if (creatorType === 'Group') {
        if (!config.exclusionList.groupIds.includes(idStr)) {
          config.exclusionList.groupIds.push(idStr);
        }
      }

      require('fs').writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      if (DEVELOPER_MODE) console.log(`[IPC] Added ${creatorType} ${creatorId} to exclusion list`);
      return { success: true, exclusionList: config.exclusionList };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to add to exclusion list:', err);
      return { success: false, error: err.message };
    }
  });

  // Replace exclusion list
  ipcMain.handle('set-exclusion-list', async (event, exclusionList) => {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      let config = {};
      if (require('fs').existsSync(configPath)) {
        config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
      }

      const userIds = Array.isArray(exclusionList?.userIds) ? exclusionList.userIds.map(String) : [];
      const groupIds = Array.isArray(exclusionList?.groupIds) ? exclusionList.groupIds.map(String) : [];

      config.exclusionList = { userIds, groupIds };
      require('fs').writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      if (DEVELOPER_MODE) console.log(`[IPC] Set exclusion list (users: ${userIds.length}, groups: ${groupIds.length})`);
      return { success: true, exclusionList: config.exclusionList };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to set exclusion list:', err);
      return { success: false, error: err.message };
    }
  });

  // Remove creator from exclusion list
  ipcMain.handle('remove-from-exclusion-list', async (event, creatorType, creatorId) => {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      let config = {};
      if (require('fs').existsSync(configPath)) {
        config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
      }
      
      if (!config.exclusionList) {
        config.exclusionList = { userIds: [], groupIds: [] };
      }

      const idStr = String(creatorId);
      if (creatorType === 'User') {
        config.exclusionList.userIds = config.exclusionList.userIds.filter(id => id !== idStr);
      } else if (creatorType === 'Group') {
        config.exclusionList.groupIds = config.exclusionList.groupIds.filter(id => id !== idStr);
      }

      require('fs').writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      if (DEVELOPER_MODE) console.log(`[IPC] Removed ${creatorType} ${creatorId} from exclusion list`);
      return { success: true, exclusionList: config.exclusionList };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to remove from exclusion list:', err);
      return { success: false, error: err.message };
    }
  });

  // Get custom themes from folder
  ipcMain.handle('get-custom-themes', async (event) => {
    try {
      const customThemesDir = path.join(app.getPath('userData'), 'custom_themes');
      
      // Create directory if it doesn't exist
      const fsSync = require('fs');
      if (!fsSync.existsSync(customThemesDir)) {
        fsSync.mkdirSync(customThemesDir, { recursive: true });
      }

      const files = await fs.readdir(customThemesDir);
      const themes = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const themePath = path.join(customThemesDir, file);
          const stat = await fs.stat(themePath);
          if (stat.isFile()) {
            const content = await fs.readFile(themePath, 'utf-8');
            try {
              const theme = JSON.parse(content);
              themes.push({
                fileName: file,
                name: theme.name || file.replace('.json', ''),
                theme: theme
              });
            } catch (parseErr) {
              if (DEVELOPER_MODE) console.warn(`Failed to parse theme ${file}:`, parseErr.message);
            }
          }
        }
      }
      
      return themes;
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to get custom themes:', err);
      return [];
    }
  });

  // Save custom theme to folder
  ipcMain.handle('save-custom-theme', async (event, themeName, themeJson) => {
    try {
      const customThemesDir = path.join(app.getPath('userData'), 'custom_themes');
      const fsSync = require('fs');
      
      // Create directory if it doesn't exist
      if (!fsSync.existsSync(customThemesDir)) {
        fsSync.mkdirSync(customThemesDir, { recursive: true });
      }

      // Sanitize filename
      let fileName = themeName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
      if (!fileName) fileName = 'theme';
      if (!fileName.endsWith('.json')) fileName += '.json';

      const filePath = path.join(customThemesDir, fileName);
      await fs.writeFile(filePath, JSON.stringify(themeJson, null, 2), 'utf-8');
      
      console.log(`[IPC] Custom theme saved to ${filePath}`);
      return { success: true, fileName, filePath };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to save custom theme:', err);
      return { success: false, error: err.message };
    }
  });

  // Load custom theme from file
  ipcMain.handle('load-custom-theme-file', async (event, fileName) => {
    try {
      const customThemesDir = path.join(app.getPath('userData'), 'custom_themes');
      const filePath = path.join(customThemesDir, fileName);
      
      // Verify the file is within the custom themes directory (security check)
      if (!filePath.startsWith(customThemesDir)) {
        throw new Error('Invalid theme file path');
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const theme = JSON.parse(content);
      
      return { success: true, theme };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to load custom theme file:', err);
      return { success: false, error: err.message };
    }
  });
}

/**
 * Main spoofer action handler - uses batch API with creator-based placeId mapping
 */
async function handleSpooferAction(data, getMainWindowFn, sendTransferUpdate, sendSpooferResultToRenderer, sendStatusMessage) {
  const maskCookie = (c) => {
    if (!c || typeof c !== 'string') return c;
    if (c.length <= 12) return '***';
    return `${c.slice(0, 4)}...${c.slice(-6)}`;
  };

  // Avoid logging raw cookie; show masked version in dev logs only
  if (DEVELOPER_MODE) {
    const { cookie, ...rest } = data || {};
    console.log('MAIN_PROCESS (Dev): Received run-spoofer-action with data:', { ...rest, cookie: maskCookie(cookie) });
  } else {
    console.log('MAIN_PROCESS: Received run-spoofer-action.');
  }

  // Validate cookie early to avoid pointless attempts
  let validatedUser = null;
  try {
    const user = await validateCookieAndGetUser(data?.cookie);
    if (!user) {
      const ts = new Date().toLocaleTimeString();
      sendStatusMessage('Invalid or expired cookie');
      sendSpooferResultToRenderer({
        output: `[${ts}] [ERROR] Cookie is invalid or expired. Please log in again.\n`,
        success: false,
        completed: true,
      });
      return;
    }
    validatedUser = user;
    if (DEVELOPER_MODE) console.log('(Dev) Cookie validated for user', user.id, user.name);
  } catch (err) {
    const ts = new Date().toLocaleTimeString();
    sendStatusMessage('Cookie validation failed');
    sendSpooferResultToRenderer({
      output: `[${ts}] [ERROR] Cookie validation failed: ${err.message}\n`,
      success: false,
      completed: true,
    });
    return;
  }

  // Helper to format logs consistently with timestamp + level
  const log = (level, message, success = null) => {
    const ts = new Date().toLocaleTimeString();
    sendSpooferResultToRenderer({ output: `[${ts}] [${level}] ${message}\n`, success });
  };

  const formatEta = (startedAtMs, completed, total) => {
    const elapsedMs = Date.now() - startedAtMs;
    const rate = completed > 0 ? elapsedMs / completed : 0;
    const remaining = Math.max(total - completed, 0);
    const etaMs = rate * remaining;
    const minutes = Math.floor(etaMs / 60000);
    const seconds = Math.max(0, Math.floor((etaMs % 60000) / 1000));
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const runWithConcurrency = async (items, limit, worker) => {
    const poolSize = Math.max(1, Math.min(limit || 8, items.length));
    let index = 0;
    const workers = Array.from({ length: poolSize }, async () => {
      while (true) {
        const current = index++;
        const item = items[current];
        if (!item) break;
        await worker(item);
      }
    });
    await Promise.all(workers);
  };

  const defaultDownloadDirectory = path.join(app.getPath('downloads'), 'ISpooferMotion');
  const rawDownloadDirectory = data?.advancedSettings?.downloadDirectory;
  const downloadDirectory = (typeof rawDownloadDirectory === 'string' && rawDownloadDirectory.trim()) || defaultDownloadDirectory;
  const downloadMode = data?.advancedSettings?.transferMode === 'download' || data?.advancedSettings?.downloadOnly === true ? 'download' : 'upload';
  const downloadOnly = downloadMode === 'download';

  const downloadsDir = downloadOnly
    ? downloadDirectory
    : path.join(app.getPath('userData'), 'ispoofer_downloads');
  
  // Ensure downloads directory exists
  try {
    await fs.mkdir(downloadsDir, { recursive: true });
  } catch (err) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to create downloads directory:', err.message);
  }

  if (!downloadOnly) {
    const cleared = await clearDownloadsDirectory(downloadsDir);
    if (!cleared && DEVELOPER_MODE) {
      console.warn('(Dev) Failed to fully clear downloads directory, proceeding anyway.');
    }
  } else if (DEVELOPER_MODE) {
    console.log(`(Dev) Download-only mode enabled. Saving files to ${downloadsDir}`);
  }

  // Validate data
  if (!data.assets || data.assets.length === 0) {
    sendSpooferResultToRenderer({ output: 'No assets selected for spoofing.', success: false });
    return;
  }

  // Group is optional - if not provided, will upload to user account
  const uploadTarget = data.groupId ? `group ${data.groupId}` : 'your account';

  // Get cookie (either manual or from userId)
  let cookie = data.cookie;
  if (!cookie && data.userId) {
    try {
      const cookieResult = await getCookieFromRobloxStudio(data.userId);
      if (cookieResult) {
        cookie = cookieResult;
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to get cookie from Studio:', err.message);
    }
  }

  if (!cookie) {
    sendSpooferResultToRenderer({ output: 'No valid cookie found. Please select a user or enter a cookie.', success: false });
    return;
  }

  sendStatusMessage(downloadOnly ? 'Starting download-only run...' : 'Starting spoofing process...');
  log('INFO', `${downloadOnly ? 'Download-only' : 'Spoofing'} process for ${data.assets.length} assets...`);

  // Advanced setting: allow adjusting how many placeIds to search per creator (default 50 for faster batch success)
  const placeIdSearchLimit = (data && data.advancedSettings && Number(data.advancedSettings.placeIdSearchLimit)) || 50;
  const rawForcedPlaceIds = data && data.advancedSettings ? data.advancedSettings.forcePlaceIds : undefined;
  const forcedPlaceIds = Array.isArray(rawForcedPlaceIds) && rawForcedPlaceIds.length > 0 
    ? rawForcedPlaceIds.filter(id => Number.isFinite(id) && id > 0)
    : undefined;
  const useForcedPlaceIds = forcedPlaceIds && forcedPlaceIds.length > 0;
  if (useForcedPlaceIds) {
    log('INFO', `Force placeIds enabled: [${forcedPlaceIds.join(', ')}] (skipping placeId discovery)`);
  }

  // Audio quota check (only if we have audio assets to upload)
  const audioAssets = (data.assets || []).filter(a => a && (a.assetType === 'Audio' || a.assetType === 'Sound'));
  if (!downloadOnly && audioAssets.length > 0) {
    try {
      const quota = await getAudioQuota(cookie, data.groupId || null);
      const remaining = quota.remaining;
      const total = quota.total;
      const used = quota.used;
      const willUse = audioAssets.length;
      const after = (typeof remaining === 'number') ? remaining - willUse : null;
      const parts = [];
      if (typeof remaining === 'number' && typeof total === 'number') {
        parts.push(`remaining ${remaining}/${total}`);
      } else if (typeof remaining === 'number') {
        parts.push(`remaining ${remaining}`);
      }
      if (typeof used === 'number' && typeof total === 'number') {
        parts.push(`used ${used}/${total}`);
      }
      parts.push(`this run needs ${willUse}`);
      if (after !== null) {
        parts.push(`after run: ${after < 0 ? 'over by ' + Math.abs(after) : after} left`);
      }
      log('INFO', `Audio quota: ${parts.join(' | ')}`);
    } catch (err) {
      log('WARN', `Could not check audio quota: ${err.message}`);
    }
  }

  const creatorResolveStart = Date.now();
  await resolveAssetCreators(
    data.assets,
    cookie,
    sendSpooferResultToRenderer,
    (done, total) => {
      const eta = formatEta(creatorResolveStart, done, total);
      sendStatusMessage(`Resolving creators ${done}/${total} (ETA ${eta})`);
    }
  );

  // Map each asset to its creator and collect unique creators
  const creatorMap = {}; // creatorKey -> array of assets
  const creatorPlaceIds = {}; // creatorKey -> array of placeIds
  
  // Load exclusion list
  let exclusionList = { userIds: [], groupIds: [] };
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      exclusionList = config.exclusionList || { userIds: [], groupIds: [] };
    }
  } catch (err) {
    if (DEVELOPER_MODE) console.warn('Failed to load exclusion list:', err);
  }
  
  for (const asset of data.assets) {
    // Skip moderated assets to prevent uploading multiple versions
    if (asset.isModerated || asset.moderationStatus === 'Moderated') {
      if (DEVELOPER_MODE) console.log(`[SPOOFER] Skipping moderated asset: ${asset.id} (${asset.name})`);
      log('WARN', `⛔ Skipping moderated sound: ${asset.name}`);
      results.skipped = (results.skipped || 0) + 1;
      continue;
    }

    // Check if creator is in exclusion list
    const creatorType = asset.creatorType || 'User';
    const creatorId = String(asset.creatorId || asset.creator || '');
    const assetIdForLog = asset.id || asset.assetId || asset.targetId || 'unknown';
    if (creatorType === 'User' && exclusionList.userIds.includes(creatorId)) {
      if (DEVELOPER_MODE) console.log(`[SPOOFER] Skipping asset from excluded user: ${creatorId} (${asset.name})`);
      log('WARN', `*skipped (${assetIdForLog}), creator in exclusion list*`);
      results.skipped = (results.skipped || 0) + 1;
      continue;
    }
    if (creatorType === 'Group' && exclusionList.groupIds.includes(creatorId)) {
      if (DEVELOPER_MODE) console.log(`[SPOOFER] Skipping asset from excluded group: ${creatorId} (${asset.name})`);
      log('WARN', `*skipped (${assetIdForLog}), creator in exclusion list*`);
      results.skipped = (results.skipped || 0) + 1;
      continue;
    }

    // Use creatorId if available, otherwise fall back to creator name
    const creatorIdentifier = asset.creatorId || asset.creator || 'Unknown';
    const creatorKey = `${creatorType}:${creatorIdentifier}`;
    if (!creatorMap[creatorKey]) {
      creatorMap[creatorKey] = [];
    }
    creatorMap[creatorKey].push(asset);
  }

  log('INFO', `📦 Grouping ${data.assets.length} assets by creator...`);
  sendStatusMessage('Grouping assets by creator...');

  // Resolve creator names to IDs and get placeIds for each creator (run in parallel to speed up)
  const placeResolveStart = Date.now();
  let placeDone = 0;
  const placeTotal = Object.keys(creatorMap).length;
  await Promise.all(
    Object.keys(creatorMap).map(async (creatorKey) => {
      let [creatorType, creatorIdentifier] = creatorKey.split(':');
      const firstAsset = creatorMap[creatorKey][0];

      if (useForcedPlaceIds) {
        creatorPlaceIds[creatorKey] = { placeIds: forcedPlaceIds, creatorType, creatorId: firstAsset.creatorId || creatorIdentifier || 'Unknown' };
        placeDone++;
        const eta = formatEta(placeResolveStart, placeDone, placeTotal);
        sendStatusMessage(`Forced place IDs ${placeDone}/${placeTotal} (ETA ${eta})`);
        return;
      }
      
      if (creatorIdentifier === 'Unknown') {
        sendSpooferResultToRenderer({ output: `  Skipping creator "${creatorIdentifier}" - will use individual asset downloads\n`, success: null });
        creatorPlaceIds[creatorKey] = { placeIds: ['individual'], creatorType, creatorId: 'Unknown' };
        return;
      }
      
      let creatorId = firstAsset.creatorId || null;
      
      if (creatorId) {
        log('INFO', `Using resolved creator: ${creatorType} ${creatorId}`);
      } else {
        log('INFO', `Resolving creator "${creatorIdentifier}" (${creatorType})...`);
        try {
          const resolved = await resolveCreatorNameToId(firstAsset.assetId, creatorIdentifier, cookie);
          creatorId = resolved.creatorId;
          creatorType = resolved.creatorType;
          log('INFO', `Resolved to: ${creatorType} ${creatorId}`, true);
        } catch (err) {
          log('WARN', `Failed to resolve: ${err.message}, will use individual downloads`, false);
          creatorPlaceIds[creatorKey] = { placeIds: ['individual'], creatorType, creatorId: creatorIdentifier };
          return;
        }
      }
      
      try {
        log('INFO', `Fetching placeIds (limit ${placeIdSearchLimit})...`);
        const placeIds = await getMultiplePlaceIds(creatorType, creatorId, cookie, placeIdSearchLimit);
        creatorPlaceIds[creatorKey] = { placeIds, creatorType, creatorId };
        log('INFO', `✓ Found ${placeIds.length} place(s)`, true);
        if (DEVELOPER_MODE) console.log(`Got ${placeIds.length} placeIds for ${creatorType} ${creatorId}:`, placeIds);
      } catch (err) {
        log('WARN', `Failed to resolve placeIds: ${err.message}, will use individual downloads`, false);
        creatorPlaceIds[creatorKey] = { placeIds: ['individual'], creatorType, creatorId };
      } finally {
        placeDone++;
        const eta = formatEta(placeResolveStart, placeDone, placeTotal);
        sendStatusMessage(`Getting place IDs ${placeDone}/${placeTotal} (ETA ${eta})`);
      }
    })
  );

  const results = {
    total: data.assets.length,
    successful: 0,
    failed: 0,
    mappings: [], // [{ originalId, newId, name, type }]
  };

  // Process assets by creator (batch downloads per creator)
  let uploadProcessed = 0;
  const uploadStart = Date.now();
  let downloadProcessed = 0;
  const downloadStart = Date.now();
  for (const creatorKey of Object.keys(creatorMap)) {
    const assets = creatorMap[creatorKey];
    const creatorInfo = creatorPlaceIds[creatorKey];
    
    if (!creatorInfo || !creatorInfo.placeIds || creatorInfo.placeIds.length === 0) {
      sendSpooferResultToRenderer({ output: `\n⚠ No valid placeIds for ${creatorKey}, skipping ${assets.length} asset(s)...\n`, success: false });
      results.failed += assets.length;
      continue;
    }

    log('INFO', `📥 Processing ${assets.length} asset(s) from ${creatorKey}...`);

    // Check if this is individual download mode (for Unknown creators)
    const isIndividualMode = creatorInfo.placeIds[0] === 'individual';
    
    // Create a progress callback for downloads
    const updateDownloadProgress = () => {
      downloadProcessed++;
      const downloadEta = formatEta(downloadStart, downloadProcessed, data.assets.length);
      sendStatusMessage(`Downloading ${downloadProcessed}/${data.assets.length} (ETA ${downloadEta})`);
    };
    
    sendStatusMessage(`Downloading 0/${data.assets.length}...`);
    let downloadResult;
    if (isIndividualMode) {
      // Individual downloads with per-asset creator resolution
      downloadResult = await downloadAssetsIndividual(
        assets,
        cookie,
        downloadsDir,
        sendSpooferResultToRenderer,
        sendTransferUpdate,
        creatorInfo.placeIds,
        placeIdSearchLimit,
        updateDownloadProgress
      );
    } else {
      // Batch download with multiple placeId fallback
      downloadResult = await downloadAssetsBatch(
        assets,
        creatorInfo.placeIds,
        cookie,
        downloadsDir,
        sendSpooferResultToRenderer,
        sendTransferUpdate,
        updateDownloadProgress
      );
    }

    let downloadedAssets = downloadResult.downloadedAssets;

    if (Object.keys(downloadedAssets).length === 0) {
      // If batch failed, try fetching more placeIds (double limit) once before falling back
      if (!isIndividualMode && !useForcedPlaceIds) {
        try {
          const expandedLimit = placeIdSearchLimit * 2;
          log('WARN', `Batch download failed for ${creatorKey} — fetching more placeIds (limit ${expandedLimit})...`);
          const extraPlaceIds = await getMultiplePlaceIds(creatorInfo.creatorType, creatorInfo.creatorId, cookie, expandedLimit);
          const combinedPlaceIds = Array.from(new Set([...(creatorInfo.placeIds || []), ...extraPlaceIds]));
          creatorInfo.placeIds = combinedPlaceIds;
          const retryResult = await downloadAssetsBatch(
            assets,
            creatorInfo.placeIds,
            cookie,
            downloadsDir,
            sendSpooferResultToRenderer,
            sendTransferUpdate,
            updateDownloadProgress
          );
          downloadedAssets = retryResult.downloadedAssets;
        } catch (err) {
          log('WARN', `Extra placeId fetch failed: ${err.message}`);
        }
      } else if (!isIndividualMode && useForcedPlaceIds) {
        log('WARN', `Batch download failed for ${creatorKey} with forced placeIds; skipping extra fetch`);
      }

      // Fallback to individual downloads if still empty
      if (Object.keys(downloadedAssets).length === 0) {
        log('WARN', `Batch download failed for ${creatorKey} — falling back to individual downloads...`);
        const fallbackResult = await downloadAssetsIndividual(
          assets,
          cookie,
          downloadsDir,
          sendSpooferResultToRenderer,
          sendTransferUpdate,
          creatorInfo.placeIds,
          placeIdSearchLimit,
          updateDownloadProgress
        );
        downloadedAssets = fallbackResult.downloadedAssets || {};

        if (Object.keys(downloadedAssets).length === 0) {
          log('ERROR', `Download failed for ${creatorKey}`, false);
          results.failed += assets.length;
          continue;
        }
      }
    }

  // Progress already updated during downloads via callback

    if (downloadOnly) {
      const successCount = assets.filter(a => downloadedAssets[a.assetId]).length;
      const failCount = assets.length - successCount;
      results.successful += successCount;
      results.failed += failCount;

      if (successCount > 0) {
        log('INFO', `↓ Saved ${successCount}/${assets.length} asset(s) to ${downloadsDir}`);
      }
      if (failCount > 0) {
        log('WARN', `Download failures for ${failCount} asset(s) in this batch`, false);
      }
      continue;
    }

    const uploadConcurrency = Math.min(15, assets.length);

    await runWithConcurrency(assets, uploadConcurrency, async (asset) => {
      const downloadData = downloadedAssets[asset.assetId];
      if (!downloadData) {
        results.failed++;
        return;
      }

      const uploadTransferId = crypto.randomUUID();

      try {
        // Prefer asset.name (original animation name), fallback to downloadData.name, then generic
        let assetName = asset.name || downloadData.name || `Spoofed ${downloadData.type}`;
        // Only use if it's not just the asset ID
        if (!assetName || assetName === String(asset.assetId) || assetName.match(/^\d+$/)) {
          assetName = downloadData.name || `Spoofed ${downloadData.type}`;
        }
        if (DEVELOPER_MODE) console.log(`(Dev) Upload naming: asset.name="${asset.name}", downloadData.name="${downloadData.name}", final="${assetName}"`);
        log('INFO', `↑ Uploading ${assetName}...`);

        let lastError;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const csrfToken = await getCsrfToken(cookie);
            const uploadResult = await publishAssetWithProgress(
              downloadData.filePath,
              assetName,
              cookie,
              csrfToken,
              data.groupId || null,
              uploadTransferId,
              sendTransferUpdate,
              downloadData.type,
              validatedUser ? validatedUser.id : null
            );

            if (!uploadResult.success) {
              throw new Error(uploadResult.error || 'Upload failed');
            }

            log('INFO', `✓ Uploaded! New ID: ${uploadResult.assetId}`, true);

            results.successful++;
            results.mappings.push({
              originalId: asset.assetId,
              newId: uploadResult.assetId,
              name: assetName,
              type: downloadData.type,
            });
            uploadProcessed++;
            const eta = formatEta(uploadStart, uploadProcessed, data.assets.length);
            sendStatusMessage(`Uploading ${uploadProcessed}/${data.assets.length} (ETA ${eta})`);
            return;
          } catch (err) {
            lastError = err;
            if (attempt === 0) {
              log('WARN', `Upload retry for ${assetName}: ${err.message}`);
              // Wait 5s before retrying on timeout or server errors
              const isTimeout = /timeout|aborted|429|50\d/.test(err.message);
              if (isTimeout) {
                await new Promise(r => setTimeout(r, 5000));
              }
            }
          }
        }

        throw lastError || new Error('Upload failed');
      } catch (err) {
        log('ERROR', `Upload failed: ${err.message}`, false);
        results.failed++;
        uploadProcessed++;
        const eta = formatEta(uploadStart, uploadProcessed, data.assets.length);
        sendStatusMessage(`Uploading ${uploadProcessed}/${data.assets.length} (ETA ${eta})`);
      }
    });
  }

  // Summary
  log('INFO', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('INFO', 'SPOOFING COMPLETE', results.successful > 0);
  log('INFO', `Total: ${results.total} | Success: ${results.successful} | Failed: ${results.failed}`);
  
  if (results.mappings.length > 0) {
    log('INFO', 'ID Mappings:');
    results.mappings.forEach(mapping => {
      log('INFO', `  ${mapping.originalId} → ${mapping.newId} (${mapping.name})`, true);
    });

    // Send mappings to plugin for ID replacement
    log('INFO', '↻ Sending mappings to plugin for ID replacement...');
    
    try {
      const mainWindow = getMainWindowFn();
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('apply-id-replacements', { 
          mappings: results.mappings,
          count: results.mappings.length 
        });
        log('INFO', `✓ Sent ${results.mappings.length} mappings to plugin`, true);
      } else {
        log('WARN', 'Could not connect to plugin - IDs were not replaced', false);
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): Failed to send mappings to plugin:', err);
      log('ERROR', `Failed to send to plugin: ${err.message}`, false);
    }
  }

  sendStatusMessage('Spoofing complete!');

  // Build summary for renderer output box
  const summaryLines = [];
  summaryLines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  summaryLines.push('SPOOFING SUMMARY');
  summaryLines.push(`Mode: ${downloadOnly ? 'Download only (no reupload)' : 'Reupload to Roblox'}`);
  if (downloadOnly) {
    summaryLines.push(`Saved to: ${downloadsDir}`);
  }
  summaryLines.push(`Total: ${results.total} | Success: ${results.successful} | Failed: ${results.failed}`);

  if (results.failed > 0) {
    summaryLines.push('Recommendations:');
    summaryLines.push('- Verify cookie is valid and logged in');
    summaryLines.push('- Try increasing placeId search limit in Advanced Settings');
  }

  if (results.mappings.length > 0) {
    summaryLines.push('Mapped IDs:');
    results.mappings.forEach(m => {
      summaryLines.push(`  ${m.originalId} → ${m.newId} (${m.name})`);
    });
  }

  const summaryText = summaryLines.join('\n') + '\n';

  // Send final completion signal with summary
  sendSpooferResultToRenderer({ output: summaryText, success: results.successful > 0, completed: true, summary: true });
}

module.exports = {
  registerIpcHandlers,
};


