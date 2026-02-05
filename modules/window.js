// modules/window.js
const { BrowserWindow, app } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

let mainWindow;
let loadingWindow;

/**
 * Creates the loading splash screen
 */
function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 500,
    height: 600,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const loadingUrl = pathToFileURL(path.join(__dirname, '..', 'loading.html'));
  loadingUrl.searchParams.set('version', app.getVersion() || '');
  loadingWindow.loadURL(loadingUrl.toString());
  loadingWindow.center();
}

/**
 * Creates the main application window
 */
function createWindow() {
  // Create loading screen first
  createLoadingWindow();
  
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'ISpooferMotion',
    icon: path.join(__dirname, '..', 'assets', 'app_icon_dark.ico'),
    frame: false,
    resizable: true,
    show: false, // Don't show until ready
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  
  // Lock aspect ratio to 16:10 (1.6)
  mainWindow.setAspectRatio(1.6);
  
  mainWindow.loadFile('index.html');
  
  // When main window is ready, close loading screen and show main window
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      if (loadingWindow && !loadingWindow.isDestroyed()) {
        loadingWindow.close();
      }
      mainWindow.show();
    }, 1000); // Show for at least 1 second
  });
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Gets the main window instance
 */
function getMainWindow() {
  return mainWindow;
}

/**
 * Sets up application lifecycle handlers
 */
function setupAppLifecycle() {
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = {
  createWindow,
  getMainWindow,
  setupAppLifecycle,
};
