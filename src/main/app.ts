const path = require('node:path');
const { app } = require('electron');
const { setupAppLifecycle, getMainWindow } = require('./window');
const { registerIpcHandlers } = require('./services/ipc-handlers');
const { DEVELOPER_MODE, initializeFileLogging } = require('./services/common');
const {
  startLocalhostPluginServer,
  stopLocalhostPluginServer,
} = require('./services/localhost-plugin-server');
const { checkForUpdates } = require('./services/updater');

let latestReplacementText = '';

function getLogsDir() {
  return path.join(app.getPath('userData'), 'ispoofer_logs');
}

function getLiveWebContents() {
  const win = getMainWindow();
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return null;
  return win.webContents;
}

function sendToRenderer(channel, payload) {
  const webContents = getLiveWebContents();
  if (webContents) {
    webContents.send(channel, payload);
    return true;
  }

  if (DEVELOPER_MODE) {
    console.warn(`[MAIN_PROCESS] Cannot send "${channel}"; renderer is not ready.`);
  }

  return false;
}

function sendTransferUpdate(transferData) {
  return sendToRenderer('transfer-update', transferData);
}

function sendSpooferResultToRenderer(result) {
  const output = typeof result === 'string' ? result : result?.output;
  if (typeof output === 'string') latestReplacementText = output;
  return sendToRenderer('spoofer-result', result);
}

function sendStatusMessage(message) {
  return sendToRenderer('update-status-message', message);
}

function sendSpooferLog(logData) {
  return sendToRenderer('spoofer-log', logData);
}

function sendSpooferProgress(progressData) {
  return sendToRenderer('spoofer-progress', progressData);
}

function sendPluginScanResults(scanData) {
  return sendToRenderer('localhost-scan-results', scanData);
}

function bootstrap() {
  app.name = 'ISpooferMotion';
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.github.IncrediDev.ISpooferMotion');
  }

  process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION:', error);
    try {
      fetch('https://ispoofermotion.com/api/crash-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorName: error.name,
          errorMessage: error.message,
          stackTrace: error.stack,
          appVersion: app.getVersion(),
          appType: 'V1',
          osInfo: `${process.platform} ${process.arch}`,
        }),
      }).catch(() => {}).finally(() => {
        app.quit();
      });
    } catch {
      app.quit();
    }
  });

  initializeFileLogging(getLogsDir());
  registerIpcHandlers(
    getMainWindow,
    sendTransferUpdate,
    sendSpooferResultToRenderer,
    sendStatusMessage,
    sendSpooferLog,
    sendSpooferProgress,
  );
  return setupAppLifecycle().then(() => {
    startLocalhostPluginServer({
      sendScanResults: sendPluginScanResults,
      sendStatusMessage,
      getReplacementText: () => latestReplacementText,
    });
    app.once('before-quit', stopLocalhostPluginServer);
    void checkForUpdates().catch((error) => {
      console.error('[UPDATE ERROR] Update check failed:', error);
    });
  });
}

bootstrap().catch((error) => {
  console.error('[APP ERROR] Failed to start ISpooferMotion:', error);
  app.quit();
});
