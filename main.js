// main.js
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { setupAppLifecycle, getMainWindow } = require('./modules/window');
const { registerIpcHandlers } = require('./modules/utils/ipc-handlers');
const { DEVELOPER_MODE, initializeFileLogging } = require('./modules/utils/common');
const { AssetServer } = require('./modules/utils/asset-server');
const { setGetMainWindow } = require('./modules/utils/update-manager');

const versionUrl = 'https://www.incredidev.com/api/v2/version-release';

// Initialize file logging
const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
initializeFileLogging(logsDir);

// Load plugin port from config file
const configPath = path.join(app.getPath('userData'), 'config.json');
let pluginPort = 3100; // Default port
let skipOwnedCheck = true;
try {
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    pluginPort = config.pluginPort || 3100;
    if (typeof config.skipOwnedCheck === 'boolean') {
      skipOwnedCheck = config.skipOwnedCheck;
    }
    console.log(`[MAIN] Loaded plugin port from config: ${pluginPort}`);
  }
} catch (err) {
  console.warn('[MAIN] Failed to load config, using default port 3100:', err.message);
}

// Initialize asset server with configured port
const assetServer = new AssetServer(pluginPort);
assetServer.start().catch(err => {
  console.warn('Failed to start asset server:', err.message);
});
assetServer.setSkipOwnedCheck(skipOwnedCheck);

// Setup window and app lifecycle
setupAppLifecycle();
const mainWindow = getMainWindow();

// --- IPC Message Senders ---
function sendTransferUpdate(transferData) {
  const win = getMainWindow();
  if (win && win.webContents) {
    win.webContents.send('transfer-update', transferData);
  } else {
    if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): Cannot send transfer update - mainWindow or webContents not available.');
  }
}

function sendSpooferResultToRenderer(result) {
  const win = getMainWindow();
  if (win && win.webContents) {
    win.webContents.send('spoofer-result', result);
  } else {
    if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): Cannot send spoofer result - mainWindow or webContents not available.');
  }
}

function sendStatusMessage(message) {
  const win = getMainWindow();
  if (win && win.webContents) {
    win.webContents.send('update-status-message', message);
  } else {
    if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): Cannot send status message - mainWindow or webContents not available.');
  }
}

/**
 * Download and install update
 */
function downloadAndInstallUpdate(downloadUrl) {
  const { downloadAndInstallUpdate: download } = require('./modules/utils/update-manager');
  download(downloadUrl);
}

/**
 * Check for version updates from custom endpoint
 */
function performVersionCheck() {
  const currentVersion = app.getVersion();

  return new Promise((resolve) => {
    https.get(versionUrl, { timeout: 5000 }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const hasVersion = Boolean(release.version);
          const updateAvailable = hasVersion && isVersionNewer(release.version, currentVersion);

          if (updateAvailable) {
            const mainWindow = getMainWindow();
            if (mainWindow) {
              mainWindow.webContents.send('update-available', {
                version: release.version,
                downloadUrl: release.downloadUrl,
                releaseNotes: release.releaseNotes || '',
              });
            }
          }

          resolve({
            ok: true,
            updateAvailable,
            version: release.version || null,
            downloadUrl: release.downloadUrl || null,
          });
        } catch (err) {
          if (DEVELOPER_MODE) console.warn('[Version Check] Failed to parse version data:', err.message);
          resolve({ ok: false, error: err.message });
        }
      });
    }).on('error', (err) => {
      if (DEVELOPER_MODE) console.warn('[Version Check] Failed to fetch version:', err.message);
      resolve({ ok: false, error: err.message });
    });
  });
}

function setupVersionCheck() {
  // Check on startup (after a small delay to let window load)
  setTimeout(() => {
    performVersionCheck();
  }, 3000);

  // Check every hour
  setInterval(() => {
    performVersionCheck();
  }, 60 * 60 * 1000);
}

/**
 * Compare semantic versions (e.g., "2.0.4" > "2.0.3")
 */
function isVersionNewer(newVersion, currentVersion) {
  const parseVersion = (v) => {
    return v.split('.').map(x => parseInt(x, 10));
  };

  const [newMajor, newMinor, newPatch] = parseVersion(newVersion);
  const [currMajor, currMinor, currPatch] = parseVersion(currentVersion);

  if (newMajor !== currMajor) return newMajor > currMajor;
  if (newMinor !== currMinor) return newMinor > currMinor;
  return newPatch > currPatch;
}

// Register all IPC handlers
registerIpcHandlers(getMainWindow, sendTransferUpdate, sendSpooferResultToRenderer, sendStatusMessage, assetServer);

// Manual update check (used by About -> Check for Updates)
ipcMain.handle('manual-check-for-update', async () => {
  const result = await performVersionCheck();
  return result;
});

// Set the getMainWindow function for update-manager
setGetMainWindow(getMainWindow);

// Setup version check after window is ready
app.whenReady().then(() => {
  setTimeout(() => {
    setupVersionCheck();
  }, 2000);
});

