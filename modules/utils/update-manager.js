// modules/utils/update-manager.js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');
const axios = require('axios');
const { DEVELOPER_MODE } = require('./common');

/**
 * Get main window for sending updates
 */
let getMainWindow = null;
function setGetMainWindow(fn) {
  getMainWindow = fn;
}

/**
 * Download and install update
 */
async function downloadAndInstallUpdate(downloadUrl) {
  const tempDir = path.join(app.getPath('temp'), 'ispoofermotion-update');
  const installerPath = path.join(tempDir, 'ISpooferMotion-Setup.exe');

  console.log('[Update] downloadAndInstallUpdate called with URL:', downloadUrl);
  console.log('[Update] Temp directory:', tempDir);
  console.log('[Update] Installer path:', installerPath);

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    console.log('[Update] Creating temp directory:', tempDir);
    fs.mkdirSync(tempDir, { recursive: true });
  } else {
    console.log('[Update] Temp directory already exists');
  }

  try {
    console.log('[Update] Starting download with axios...');

    // Ensure Dropbox URLs use direct download (dl=1)
    let finalUrl = downloadUrl;
    if (downloadUrl.includes('dropbox.com')) {
      if (downloadUrl.includes('dl=0')) {
        finalUrl = downloadUrl.replace('dl=0', 'dl=1');
        console.log('[Update] Detected Dropbox URL with dl=0, converting to dl=1');
      } else if (!downloadUrl.includes('dl=')) {
        finalUrl = downloadUrl + (downloadUrl.includes('?') ? '&' : '?') + 'dl=1';
        console.log('[Update] Detected Dropbox URL without dl parameter, adding dl=1');
      }
      console.log('[Update] Final Dropbox URL:', finalUrl);
    }

    const response = await axios({
      method: 'get',
      url: finalUrl,
      responseType: 'stream',
      timeout: 300000, // 5 minutes timeout for large files
      maxRedirects: 5,
      headers: {
        'User-Agent': 'ISpooferMotion/2.0.3'
      }
    });

    const totalSize = parseInt(response.headers['content-length'], 10) || 0;
    let downloadedSize = 0;

    console.log('[Update] Download started, total size:', totalSize);

    const file = fs.createWriteStream(installerPath);

    response.data.on('data', (chunk) => {
      downloadedSize += chunk.length;
      const progress = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
      console.log('[Update] Download progress:', progress + '% (' + downloadedSize + '/' + totalSize + ')');
      const mainWindow = getMainWindow && getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('update-download-progress', { percent: progress });
      }
    });

    response.data.pipe(file);

    response.data.on('error', (err) => {
      console.error('[Update] Stream error:', err);
      file.destroy();
      fs.unlinkSync(installerPath);
      const mainWindow = getMainWindow && getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('update-error', { message: 'Download stream error: ' + err.message });
      }
    });

    await new Promise((resolve, reject) => {
      file.on('finish', resolve);
      file.on('error', reject);
    });

    console.log('[Update] File stream finished writing, total bytes:', downloadedSize);

    // Verify file exists and has content
    if (!fs.existsSync(installerPath)) {
      throw new Error('Installer file not found after download');
    }

    const fileStats = fs.statSync(installerPath);
    console.log('[Update] Installer file exists, file size:', fileStats.size, 'bytes');

    if (fileStats.size === 0) {
      throw new Error('Downloaded installer is empty');
    }

    // Wait a moment for file to be fully released before executing
    await new Promise(resolve => setTimeout(resolve, 500));

    const mainWindow = getMainWindow && getMainWindow();
    if (mainWindow) {
      console.log('[Update] Sending update-installing event');
      mainWindow.webContents.send('update-installing');
    }

    console.log('[Update] Starting installer:', installerPath);
    console.log('[Update] Spawning cmd with args: ["/c", "' + installerPath + '"]');

    // Use spawn with cmd /c to run installer via Windows shell
    const child = spawn('cmd', ['/c', installerPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    console.log('[Update] Spawn process created, PID:', child.pid);

    child.on('error', (err) => {
      console.error('[Update] Spawn error event:', err);
    });

    child.unref();
    console.log('[Update] Process unreferenced (detached)');

    // Give installer time to start, then quit the app
    console.log('[Update] Setting 1000ms timeout before app.quit()');
    setTimeout(() => {
      console.log('[Update] Quitting app now');
      app.quit();
    }, 1000);

  } catch (err) {
    console.error('[Update] Error in download or install:', err);
    console.error('[Update] Stack trace:', err.stack);
    
    // Clean up partial download
    try {
      if (fs.existsSync(installerPath)) {
        fs.unlinkSync(installerPath);
      }
    } catch (e) {}

    const mainWindow = getMainWindow && getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('update-error', { message: 'Update failed: ' + err.message });
    }
  }
}

module.exports = {
  downloadAndInstallUpdate,
  setGetMainWindow,
};
