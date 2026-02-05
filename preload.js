// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  onStatusUpdate: (callback) => ipcRenderer.on('update-status-message', (event, ...args) => callback(...args)),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openLogs: () => ipcRenderer.send('open-logs'),

  // Function to send data to main process when "Run Spoofer" is clicked
  runSpooferAction: (data) => ipcRenderer.send('run-spoofer-action', data),

  // Listen for results/output from the spoofer action
  onSpooferResult: (callback) => ipcRenderer.on('spoofer-result', (event, ...args) => callback(...args)),

  // Toggle aspect ratio lock
  toggleAspectRatio: (isLocked) => ipcRenderer.send('toggle-aspect-ratio', isLocked),

  // Asset Explorer: fetch assets
  fetchAssets: (query) => ipcRenderer.invoke('fetch-assets', query),

  // Asset server: fetch dumped sounds
  fetchServerSounds: () => ipcRenderer.invoke('fetch-server-sounds'),

  // Asset server: fetch dumped animations
  fetchServerAnimations: () => ipcRenderer.invoke('fetch-server-animations'),

  // Asset server: fetch dumped images
  fetchServerImages: () => ipcRenderer.invoke('fetch-server-images'),

  // Asset server: request Roblox to dump sounds
  requestSoundDump: () => ipcRenderer.invoke('request-sound-dump'),

  // Asset server: request Roblox to dump animations
  requestAnimationDump: () => ipcRenderer.invoke('request-animation-dump'),

  // Asset server: request Roblox to dump images
  requestImageDump: () => ipcRenderer.invoke('request-image-dump'),

  // Reveal asset in file explorer
  revealAsset: (assetId, assetType) => ipcRenderer.send('reveal-asset', assetId, assetType),

  // Play sound asset
  playSound: (assetId) => ipcRenderer.send('play-sound', assetId),

  // Discover valid Roblox users from stored cookies
  discoverValidRobloxUsers: (preferences) => ipcRenderer.invoke('discover-valid-roblox-users', preferences),

  // Get groups for a user with upload permissions
  getUserGroups: (userId, cookie) => ipcRenderer.invoke('get-user-groups', userId, cookie),

  // Get a valid cookie for a specific user
  getCookieForUser: (userId, preferences) => ipcRenderer.invoke('get-cookie-for-user', userId, preferences),

  // Set window icon based on theme
  setWindowIcon: (theme) => ipcRenderer.send('set-window-icon', theme),

  // Replace asset IDs in the plugin after spoofing
  replaceAssetIds: (mappings) => ipcRenderer.invoke('replace-asset-ids', mappings),

  // Listener for when to apply ID replacements
  onApplyIdReplacements: (callback) => ipcRenderer.on('apply-id-replacements', (event, ...args) => callback(...args)),

  // Get plugin server port from config
  getPluginPort: () => ipcRenderer.invoke('get-plugin-port'),

  // Set plugin server port in config (requires app restart)
  setPluginPort: (port) => ipcRenderer.invoke('set-plugin-port', port),

  // Ownership check toggle
  getSkipOwnedCheck: () => ipcRenderer.invoke('get-skip-owned-check'),
  setSkipOwnedCheck: (enabled) => ipcRenderer.invoke('set-skip-owned-check', enabled),

  // Download/output preferences
  getDownloadSettings: () => ipcRenderer.invoke('get-download-settings'),
  setDownloadSettings: (settings) => ipcRenderer.invoke('set-download-settings', settings),
  chooseDownloadDirectory: () => ipcRenderer.invoke('choose-download-directory'),

  // Get creator exclusion list
  getExclusionList: () => ipcRenderer.invoke('get-exclusion-list'),

  // Add creator to exclusion list
  addToExclusionList: (creatorType, creatorId) => ipcRenderer.invoke('add-to-exclusion-list', creatorType, creatorId),

  // Remove creator from exclusion list
  removeFromExclusionList: (creatorType, creatorId) => ipcRenderer.invoke('remove-from-exclusion-list', creatorType, creatorId),

  // Replace exclusion list
  setExclusionList: (exclusionList) => ipcRenderer.invoke('set-exclusion-list', exclusionList),

  // Get custom themes from folder
  getCustomThemes: () => ipcRenderer.invoke('get-custom-themes'),

  // Save custom theme to folder
  saveCustomTheme: (themeName, themeJson) => ipcRenderer.invoke('save-custom-theme', themeName, themeJson),

  // Load custom theme from file
  loadCustomThemeFile: (fileName) => ipcRenderer.invoke('load-custom-theme-file', fileName),

  // Update handlers
  downloadAndInstallUpdate: (downloadUrl) => ipcRenderer.invoke('download-and-install-update', downloadUrl),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, ...args) => callback(...args)),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, ...args) => callback(...args)),
  onUpdateInstalling: (callback) => ipcRenderer.on('update-installing', (event, ...args) => callback(...args)),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (event, ...args) => callback(...args)),
  checkForUpdates: () => ipcRenderer.invoke('manual-check-for-update'),

  // Generic invoke for dynamic IPC calls
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
  
});