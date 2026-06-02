'use strict';

const { app, dialog, shell } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const USER_AGENT = `ISpooferMotion-Electron-App/${app.getVersion()} (+https://github.com/IncrediDev/ISpooferMotion)`;
const REPO_OWNER = 'IncrediDev';
const REPO_NAME = 'ISpooferMotion';
const API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const REQUEST_TIMEOUT_MS = 15000;

function getVersionFromNameOrTag(value) {
  const match = String(value || '').match(/v?\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?/i);
  if (!match) return null;
  return /^v/i.test(match[0]) ? match[0] : `v${match[0]}`;
}

function parseVersionParts(value) {
  const match = String(value || '').match(/v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?/i);
  if (!match) return null;
  return {
    core: match.slice(1, 4).map((part) => Number(part)),
    suffix: match[4] ? match[4].split('.') : [],
  };
}

function compareVersions(a, b) {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] > right.core[i]) return 1;
    if (left.core[i] < right.core[i]) return -1;
  }

  if (left.suffix.length === 0 || right.suffix.length === 0) {
    if (left.suffix.length === right.suffix.length) return 0;
    return left.suffix.length > 0 ? 1 : -1;
  }

  const suffixLength = Math.max(left.suffix.length, right.suffix.length);
  for (let i = 0; i < suffixLength; i += 1) {
    if (left.suffix[i] === undefined) return -1;
    if (right.suffix[i] === undefined) return 1;

    const leftNumber = /^\d+$/.test(left.suffix[i]) ? Number(left.suffix[i]) : null;
    const rightNumber = /^\d+$/.test(right.suffix[i]) ? Number(right.suffix[i]) : null;
    if (leftNumber !== null && rightNumber !== null) {
      if (leftNumber > rightNumber) return 1;
      if (leftNumber < rightNumber) return -1;
      continue;
    }

    const suffixComparison = left.suffix[i].localeCompare(right.suffix[i], undefined, {
      sensitivity: 'base',
    });
    if (suffixComparison !== 0) return suffixComparison > 0 ? 1 : -1;
  }
  return 0;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(requestJson(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`GitHub request failed: HTTP ${res.statusCode}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': USER_AGENT },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(downloadFile(res.headers.location, destination));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(destination);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(destination);
        });
        file.on('error', (err) => {
          fs.unlink(destination, () => {});
          reject(err);
        });
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

async function promptUpdateFailed(err, releaseUrl) {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Update Failed',
    message: 'The auto-update failed to complete.',
    detail: err.message || String(err),
    buttons: ['Try Again', 'Download from GitHub', 'Keep using older version'],
    cancelId: 2,
    defaultId: 0,
  });

  if (response === 0) {
    return checkForUpdates(true); // retry
  } else if (response === 1) {
    shell.openExternal(
      releaseUrl || `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
    );
  }
}

function getRobloxPluginsDir() {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'Plugins');
  } else if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Documents', 'Roblox', 'Plugins');
  }
  return null;
}

async function applyUpdate(downloadPath) {
  if (process.platform === 'darwin') {
    shell.openPath(downloadPath);
    app.quit();
    return;
  }

  if (process.platform === 'linux') {
    if (downloadPath.endsWith('.AppImage')) {
      try {
        fs.chmodSync(downloadPath, '755');
      } catch (e) {}
    }
    shell.showItemInFolder(downloadPath);
    app.quit();
    return;
  }

  // Windows silent install using NSIS installer
  const scriptPath = path.join(os.tmpdir(), `ispoofer_update_${Date.now()}.bat`);
  const scriptContent = `
@echo off
timeout /t 2 /nobreak > nul
start "" "${downloadPath}" /S /UPDATE=true
del "%~f0"
`;

  fs.writeFileSync(scriptPath, scriptContent, 'utf8');

  const child = spawn('cmd.exe', ['/c', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  app.quit();
}

async function checkForUpdates(force = false) {
  if (!app.isPackaged && !force) return; // Don't auto-update in dev

  try {
    const release = await requestJson(API_URL);
    const releaseVersion = getVersionFromNameOrTag(release.tag_name || release.name);
    const currentVersion = getVersionFromNameOrTag(app.getVersion());

    if (!releaseVersion || compareVersions(releaseVersion, currentVersion) <= 0) {
      return; // Up to date
    }

    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `A new version of ISpooferMotion (${releaseVersion}) is available.`,
      detail: 'Would you like to download and install it now? The app will restart automatically.',
      buttons: ['Update Now', 'Skip'],
      cancelId: 1,
      defaultId: 0,
    });

    if (response === 1) return; // Skip

    let extension = '.exe';
    if (process.platform === 'darwin') extension = '.dmg';
    else if (process.platform === 'linux') extension = '.AppImage';

    // Find the right OS asset
    const osAsset = release.assets.find((a) =>
      a.name.toLowerCase().endsWith(extension.toLowerCase()),
    );

    // Find the plugin asset
    const pluginAsset = release.assets.find((a) => a.name.toLowerCase().endsWith('.rbxmx'));

    if (!osAsset) {
      throw new Error(`No update executable found for ${process.platform}.`);
    }

    const downloadPath = path.join(os.tmpdir(), `ISpooferMotion-Update-${Date.now()}${extension}`);

    // Download OS app update
    await downloadFile(osAsset.browser_download_url, downloadPath);

    // Download and install plugin silently
    if (pluginAsset) {
      try {
        const pluginsDir = getRobloxPluginsDir();
        if (pluginsDir) {
          fs.mkdirSync(pluginsDir, { recursive: true });
          const pluginPath = path.join(pluginsDir, pluginAsset.name);
          await downloadFile(pluginAsset.browser_download_url, pluginPath);
        }
      } catch (err) {
        console.error('Failed to update plugin:', err);
      }
    }

    await applyUpdate(downloadPath);
  } catch (err) {
    console.error('Update error:', err);
    await promptUpdateFailed(err, `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`);
  }
}

module.exports = {
  checkForUpdates,
};
