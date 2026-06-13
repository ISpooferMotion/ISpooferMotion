const path = require('node:path');
const { app, BrowserWindow, Notification, nativeImage } = require('electron');

let mainWindow = null;

const WINDOW_OPTIONS = Object.freeze({
  width: 1280,
  height: 780,
  minWidth: 1260,
  minHeight: 740,
  title: 'ISpooferMotion',
  frame: false,
  resizable: true,
  show: false,
  backgroundColor: '#0a0a0a',
});

function resolveAssetPath(fileName) {
  const assetPath = path.join(__dirname, '..', 'src', 'assets', fileName);
  return app.isPackaged ? assetPath.replace('app.asar', 'app.asar.unpacked') : assetPath;
}

function getIconPath() {
  return process.platform === 'win32'
    ? resolveAssetPath('app_icon.ico')
    : resolveAssetPath('app_icon.png');
}

function getPreloadPath() {
  return path.join(__dirname, '..', 'src', 'preload', 'preload.js');
}

function getRendererPath() {
  return path.join(__dirname, '..', 'src', 'renderer-react', 'dist', 'index.html');
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  const windowIcon = nativeImage.createFromPath(getIconPath());

  mainWindow = new BrowserWindow({
    ...WINDOW_OPTIONS,
    icon: windowIcon,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      devTools: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(getRendererPath()).catch((error) => {
    console.error('[WINDOW ERROR] Failed to load renderer:', error);
  });

  return mainWindow;
}

function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function setupAppLifecycle() {
  const ready = app.whenReady().then(() => {
    createWindow();

    if (Notification.isSupported()) {
      new Notification({
        title: 'ISpooferMotion',
        body: 'ISpooferMotion Opened',
        icon: nativeImage.createFromPath(getIconPath()),
      }).show();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  return ready;
}

module.exports = {
  createWindow,
  getMainWindow,
  setupAppLifecycle,
};
