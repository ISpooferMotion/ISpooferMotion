/**
 * App Module
 * Handles IPC communication, event listeners, and application logic
 */

class AppManager {
  constructor() {
    this.elements = {};
    this.spooferProgress = 0; // Track overall progress 0-100
    this.currentStage = null; // Track current stage for cumulative progress
    this.lastMappings = null; // Store last mappings for retry
    this.isRunning = false; // Track if spoofer is currently running
    // Stage progress ranges (percentages of total)
    this.stages = {
      'creator': { start: 0, end: 15, name: 'Resolving creators' },
      'placeId': { start: 15, end: 25, name: 'Getting place IDs' },
      'download': { start: 25, end: 65, name: 'Downloading' },
      'upload': { start: 65, end: 100, name: 'Uploading' }
    };
    this.init();
  }

  init() {
    console.log('[AppManager.init] Starting initialization...');
    this.cacheElements();
    console.log('[AppManager.init] Elements cached');
    this.setupWindowControls();
    this.setupStatusUpdates();
    this.setupClipboard();
    this.setupToggleLogic();
    this.setupSpooferButton();
    this.setupVersion();
    this.setupDiscordButton();
    this.setupTheme();
    this.setupUpdateModal();
    this.setupCreditsModal();
    this.setupCookieSourceToggles();
    this.setupTransferModeControls();
    this.setupSpooferSelections();
    this.setupPluginUpdates();
    this.setupRetryButton();
  }

  /**
   * Cache DOM elements for quick access
   */
  cacheElements() {
    console.log('[cacheElements] Caching DOM elements...');
    this.elements = {
      closeBtn: document.getElementById('close-btn'),
      copyOutputBtn: document.getElementById('copy-output-btn'),
      outputDataTextarea: document.getElementById('output-data'),
      animationIdTextarea: document.getElementById('animationId'),
      pasteAnimationIdBtn: document.getElementById('paste-animationId-btn'),
      robloxCookieInput: document.getElementById('robloxCookie'),
      autoDetectCookieToggle: document.getElementById('autoDetectCookie'),
      groupIdInput: document.getElementById('groupId'),
      selectedUserSelect: document.getElementById('selected-user'),
      selectedGroupSelect: document.getElementById('selected-group'),
      enableSpoofingToggle: document.getElementById('enable-spoofing'),
      runSpooferBtn: document.getElementById('run-spoofer-btn'),
      retryReplaceBtn: document.getElementById('retry-replace-btn'),
      statusTextElement: document.getElementById('status-text'),
      versionTextElement: document.getElementById('version-text'),
      settingsVersionElement: document.getElementById('settings-version'),
      settingsPluginVersionElement: document.getElementById('settings-plugin-version'),
      logsBtn: document.getElementById('logs-btn'),
      discordBtn: document.getElementById('discord-btn'),
      autoCookieStudioToggle: document.getElementById('auto-cookie-studio'),
      autoCookieBrowsersToggle: document.getElementById('auto-cookie-browsers'),
      skipOwnedCheckToggle: document.getElementById('skip-owned-check'),
      transferModeSelect: document.getElementById('transfer-mode'),
      downloadDirectoryInput: document.getElementById('download-directory'),
      browseDownloadDirectoryBtn: document.getElementById('browse-download-directory'),
      forcePlaceIdInput: document.getElementById('force-placeid'),
      placeIdSearchLimitInput: document.getElementById('placeid-search-limit'),
      pluginPortInput: document.getElementById('plugin-port'),
      excludedUserIdsInput: document.getElementById('excluded-user-ids'),
      excludedGroupIdsInput: document.getElementById('excluded-group-ids'),
      logoTransparencySlider: document.getElementById('logo-transparency'),
      logoTransparencyValue: document.getElementById('logo-transparency-value'),
      minimizeBtn: document.getElementById('minimize-btn'),
      closeBtn: document.getElementById('close-btn'),
    };
    console.log('[cacheElements] robloxCookieInput found:', !!this.elements.robloxCookieInput);
    console.log('[cacheElements] selectedGroupSelect found:', !!this.elements.selectedGroupSelect);
  }

  /**
   * Setup window control buttons
   */
  setupWindowControls() {
    // Minimize button
    if (this.elements.minimizeBtn && window.electronAPI && window.electronAPI.minimize) {
      this.elements.minimizeBtn.addEventListener('click', () => {
        window.electronAPI.minimize();
      });
    } else if (this.elements.minimizeBtn) {
      this.elements.minimizeBtn.disabled = true;
      console.warn('electronAPI.minimize not found');
    }

    // Close button
    if (this.elements.closeBtn && window.electronAPI && window.electronAPI.close) {
      this.elements.closeBtn.addEventListener('click', () => {
        window.electronAPI.close();
      });
    } else if (this.elements.closeBtn) {
      this.elements.closeBtn.disabled = true;
      console.warn('electronAPI.close not found');
    }

    // Logs button
    if (this.elements.logsBtn && window.electronAPI && window.electronAPI.openLogs) {
      this.elements.logsBtn.addEventListener('click', () => {
        window.electronAPI.openLogs();
      });
    }
  }

  /**
   * Setup status update listener
   */
  setupStatusUpdates() {
    if (window.electronAPI && window.electronAPI.onStatusUpdate) {
      window.electronAPI.onStatusUpdate((message) => {
        this.updateStatus(message);
      });
    } else {
      console.warn('electronAPI.onStatusUpdate not found');
    }
  }

  /**
   * Update status bar text and extract progress
   */
  updateStatus(message) {
    if (this.elements.statusTextElement) {
      this.elements.statusTextElement.textContent = message;
    }
    
    // Detect which stage we're in
    let stage = null;
    if (message.includes('Resolving creators')) stage = 'creator';
    else if (message.includes('Getting place IDs')) stage = 'placeId';
    else if (message.includes('Downloading')) stage = 'download';
    else if (message.includes('Uploading')) stage = 'upload';
    
    // Extract progress from status messages like "Resolving creators 5/100"
    const match = message.match(/(\d+)\/(\d+)/);
    if (match && stage) {
      const current = parseInt(match[1]);
      const total = parseInt(match[2]);
      if (total > 0) {
        const stageInfo = this.stages[stage];
        if (stageInfo) {
          // Calculate progress within this stage
          const stageRange = stageInfo.end - stageInfo.start;
          const stageProgress = (current / total) * stageRange;
          // Cumulative progress = stage start + progress within stage
          this.spooferProgress = Math.min(100, stageInfo.start + stageProgress);
          this.currentStage = stage;
          
          if (this.elements.runSpooferBtn) {
            this.elements.runSpooferBtn.style.setProperty('--progress', `${Math.round(this.spooferProgress)}%`);
            console.log(`[Progress Bar] Stage: ${stage} | ${current}/${total} | Overall: ${Math.round(this.spooferProgress)}%`);
          }
        }
      }
    }
  }

  /**
   * Setup clipboard functionality
   */
  setupClipboard() {
    // Copy output button
    if (this.elements.copyOutputBtn && this.elements.outputDataTextarea) {
      this.elements.copyOutputBtn.addEventListener('click', () => {
        this.elements.outputDataTextarea.select();
        try {
          document.execCommand('copy');
          this.updateStatus('Output copied!');
        } catch (err) {
          console.error('Failed to copy:', err);
          this.updateStatus('Failed to copy output.');
        }
        window.getSelection().removeAllRanges();
      });
    }

    // Paste IDs button
    if (
      this.elements.pasteAnimationIdBtn &&
      this.elements.animationIdTextarea &&
      navigator.clipboard
    ) {
      this.elements.pasteAnimationIdBtn.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          this.elements.animationIdTextarea.value = text.trim();
          this.elements.animationIdTextarea.focus();
          this.updateStatus('IDs pasted.');
        } catch (err) {
          console.error('Failed to read clipboard:', err);
          alert('Failed to paste. Please check clipboard permissions.');
          this.updateStatus('Failed to paste IDs.');
        }
      });
    } else if (!navigator.clipboard && this.elements.pasteAnimationIdBtn) {
      this.elements.pasteAnimationIdBtn.style.display = 'none';
    }
  }

  /**
   * Setup toggle logic for cookie input
   */
  setupToggleLogic() {
    console.log('[setupToggleLogic] Initializing...');
    
    // Manual cookie input handlers - only need the cookie input, auto-detect toggle was removed
    if (this.elements.robloxCookieInput) {
      console.log('[setupToggleLogic] Setting up manual cookie input handlers...');
      
      let lastProcessedCookie = ''; // Track last cookie to avoid duplicate calls

      // Fetch groups when manual cookie is entered (on blur/Enter)
      const handleManualCookieGroups = async () => {
        const cookie = (this.elements.robloxCookieInput.value || '').trim();
        console.log(`[ManualCookieGroups] Handler called. Cookie length: ${cookie.length}, lastProcessedCookie length: ${lastProcessedCookie.length}`);
        
        // Skip if same cookie as last time
        if (cookie === lastProcessedCookie) {
          console.log('[ManualCookieGroups] Same cookie as before, skipping...');
          return;
        }
        
        lastProcessedCookie = cookie; // Update last processed
        
        console.log(`[ManualCookieGroups] New cookie detected, processing...`);
        
        if (cookie.length > 50) {
          console.log('[ManualCookieGroups] Cookie is valid length');
          if (!this.elements.selectedGroupSelect) {
            console.warn('[ManualCookieGroups] selectedGroupSelect element not found');
            return;
          }
          if (!window.electronAPI) {
            console.warn('[ManualCookieGroups] electronAPI not available');
            return;
          }
          if (!window.electronAPI.getUserGroups) {
            console.warn('[ManualCookieGroups] getUserGroups function not available');
            return;
          }
          try {
            console.log('[ManualCookieGroups] All checks passed, fetching groups...');
            // Fetch groups directly with the cookie (userId not needed for canmanage endpoint)
            await this.populateGroupsForUser(this.elements.selectedGroupSelect, null, cookie);
            this.updateStatus('Groups loaded from manual cookie.');
            console.log('[ManualCookieGroups] ✓ Groups loaded successfully');
          } catch (err) {
            console.error('[ManualCookieGroups] ✗ Failed to fetch groups:', err);
            this.updateStatus('Failed to load groups from cookie');
          }
        } else {
          console.log(`[ManualCookieGroups] Cookie too short: ${cookie.length} <= 50`);
        }
      };

      this.elements.robloxCookieInput.addEventListener('blur', () => {
        console.log('[ManualCookieGroups] Blur event triggered');
        handleManualCookieGroups();
      });
      this.elements.robloxCookieInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          console.log('[ManualCookieGroups] Enter key pressed');
          handleManualCookieGroups();
        }
      });
      
      // Also trigger on input with debounce for real-time feedback
      let groupsFetchTimeout;
      this.elements.robloxCookieInput.addEventListener('input', () => {
        console.log('[ManualCookieGroups] Input event triggered, starting debounce...');
        clearTimeout(groupsFetchTimeout);
        groupsFetchTimeout = setTimeout(() => {
          const cookie = (this.elements.robloxCookieInput.value || '').trim();
          if (cookie.length > 50) {
            console.log('[ManualCookieGroups] Debounce complete, cookie valid, fetching groups');
            handleManualCookieGroups();
          } else {
            console.log('[ManualCookieGroups] Debounce complete, but cookie too short');
          }
        }, 1000); // Wait 1 second after user stops typing
      });
    }

    // Setup aspect ratio toggle
    const lockAspectRatioToggle = document.getElementById('lock-aspect-ratio');
    if (lockAspectRatioToggle) {
      lockAspectRatioToggle.addEventListener('change', (e) => {
        if (window.electronAPI && window.electronAPI.toggleAspectRatio) {
          window.electronAPI.toggleAspectRatio(e.target.checked);
        }
      });
    }
  }

  /**
   * Update roblox cookie input state based on auto-detect toggle
   */
  updateRobloxCookieInputState() {
    if (this.elements.robloxCookieInput && this.elements.autoDetectCookieToggle) {
      this.elements.robloxCookieInput.disabled = this.elements.autoDetectCookieToggle.checked;
      if (this.elements.autoDetectCookieToggle.checked) {
        this.elements.robloxCookieInput.classList.add('disabled-input');
      } else {
        this.elements.robloxCookieInput.classList.remove('disabled-input');
      }
    }
  }

  /**
   * Setup spoofer button logic
   */
  setupSpooferButton() {
    // Listen for spoofer results
    if (window.electronAPI && window.electronAPI.onSpooferResult) {
      window.electronAPI.onSpooferResult((result) => {
        console.log('Renderer received spoofer result:', result);
        if (this.elements.outputDataTextarea && result && typeof result.output !== 'undefined') {
          if (result.summary === true) {
            // Clear box and show final summary
            this.elements.outputDataTextarea.value = result.output;
          } else {
            // Append to existing output
            this.elements.outputDataTextarea.value += result.output;
          }
          // Auto-scroll to bottom
          this.elements.outputDataTextarea.scrollTop = this.elements.outputDataTextarea.scrollHeight;
        }
        // Re-enable controls only when spoofer process is completed
        if (result && result.completed === true) {
          this.setRunningState(false);
        }
      });
    } else {
      console.warn('electronAPI.onSpooferResult not found');
    }

    // Listen for ID replacement requests from the main process
    if (window.electronAPI && window.electronAPI.onApplyIdReplacements) {
      window.electronAPI.onApplyIdReplacements((data) => {
        console.log('Renderer received apply-id-replacements:', data);
        if (data && data.mappings) {
          this.lastMappings = data.mappings; // Store for retry
          this.applyIdReplacements(data.mappings);
          // Enable retry button
          if (this.elements.retryReplaceBtn) {
            this.elements.retryReplaceBtn.disabled = false;
          }
        }
      });
    }

    // Click handler for run button
    if (this.elements.runSpooferBtn && window.electronAPI && window.electronAPI.runSpooferAction) {
      this.elements.runSpooferBtn.addEventListener('click', () => {
        this.runSpoofer();
      });
    } else {
      if (this.elements.runSpooferBtn) {
        this.elements.runSpooferBtn.disabled = true;
      }
      console.warn('Run Spoofer button or electronAPI.runSpooferAction not available');
    }
  }

  /**
   * Enable/disable UI controls while spoofing runs
   */
  setRunningState(isRunning) {
    try {
      this.isRunning = isRunning;
      if (this.elements.runSpooferBtn) {
        this.elements.runSpooferBtn.disabled = !!isRunning;
        if (isRunning) {
          // Reset progress bar when starting
          this.spooferProgress = 0;
          this.elements.runSpooferBtn.style.setProperty('--progress', '0%');
        } else {
          // Clear progress bar when done
          this.elements.runSpooferBtn.style.setProperty('--progress', '0%');
        }
      }
      if (this.elements.selectedUserSelect) this.elements.selectedUserSelect.disabled = !!isRunning;
      if (this.elements.selectedGroupSelect) this.elements.selectedGroupSelect.disabled = !!isRunning;
      if (this.elements.enableSpoofingToggle) this.elements.enableSpoofingToggle.disabled = !!isRunning;

      const animationToggle = document.getElementById('spoof-animation');
      const audioToggle = document.getElementById('spoof-audio');
      const imagesToggle = document.getElementById('spoof-images');
      if (animationToggle) animationToggle.disabled = !!isRunning;
      if (audioToggle) audioToggle.disabled = !!isRunning;
      if (imagesToggle) imagesToggle.disabled = !!isRunning;

      this.updateStatus(isRunning ? 'Spoofer running…' : 'Ready');
    } catch (e) {
      console.warn('Failed to toggle running state:', e);
    }
  }

  /**
   * Setup retry button for retrying replacements
   */
  setupRetryButton() {
    if (this.elements.retryReplaceBtn) {
      this.elements.retryReplaceBtn.addEventListener('click', () => {
        if (this.lastMappings && this.lastMappings.length > 0) {
          console.log('Retrying ID replacements...');
          if (this.elements.outputDataTextarea) {
            this.elements.outputDataTextarea.value += `\n🔄 Retrying ID replacements...\n`;
            this.elements.outputDataTextarea.scrollTop = this.elements.outputDataTextarea.scrollHeight;
          }
          this.applyIdReplacements(this.lastMappings);
        } else {
          console.warn('No mappings available to retry');
          if (this.elements.outputDataTextarea) {
            this.elements.outputDataTextarea.value += `\n⚠ No mappings available to retry\n`;
            this.elements.outputDataTextarea.scrollTop = this.elements.outputDataTextarea.scrollHeight;
          }
        }
      });
    }
  }

  /**
   * Apply ID replacements to the selected place via the plugin
   */
  async applyIdReplacements(mappings) {
    try {
      if (!Array.isArray(mappings) || mappings.length === 0) {
        console.warn('No mappings to apply');
        return;
      }

      console.log(`Applying ${mappings.length} ID replacements via Electron API...`);

      // Convert mappings for transmission
      const simplifiedMappings = mappings.map(m => ({
        originalId: m.originalId,
        newId: m.newId,
        name: m.name,
        type: m.type
      }));

      // Call the IPC handler to send replacements to plugin via asset server
      if (window.electronAPI && window.electronAPI.replaceAssetIds) {
        const result = await window.electronAPI.replaceAssetIds(simplifiedMappings);
        console.log('Replace Asset IDs result:', result);
        if (result && result.ok) {
          console.log('✓ Sent ID replacement mappings to plugin');
          if (this.elements.outputDataTextarea) {
            this.elements.outputDataTextarea.value += `\n✓ Sent ${simplifiedMappings.length} ID mappings to plugin for replacement\n`;
            this.elements.outputDataTextarea.scrollTop = this.elements.outputDataTextarea.scrollHeight;
          }
        } else {
          console.warn('Failed to send replacements:', result?.error);
          if (this.elements.outputDataTextarea) {
            this.elements.outputDataTextarea.value += `\n✗ Failed to send replacements to plugin: ${result?.error}\n`;
            this.elements.outputDataTextarea.scrollTop = this.elements.outputDataTextarea.scrollHeight;
          }
        }
      }
    } catch (err) {
      console.error('Error applying ID replacements:', err);
      if (this.elements.outputDataTextarea) {
        this.elements.outputDataTextarea.value += `\n✗ Error applying replacements: ${err.message}\n`;
        this.elements.outputDataTextarea.scrollTop = this.elements.outputDataTextarea.scrollHeight;
      }
    }
  }

  /**
   * Execute spoofer action
   */
  runSpoofer() {
    if (!this.elements.runSpooferBtn) return;

    // Prevent multiple simultaneous runs - set flag immediately
    if (this.isRunning) {
      console.log('[Spoofer] Already running, ignoring click');
      return;
    }
    this.isRunning = true;

    // Get selected user and group
    const selectedUserId = this.elements.selectedUserSelect?.value || '';
    const selectedGroupId = this.elements.selectedGroupSelect?.value || '';
    const manualCookie = this.elements.robloxCookieInput?.value || '';

    // Validate that we have a cookie source
    if (!selectedUserId && !manualCookie) {
      this.isRunning = false;
      window.uiManager?.addDebugLine('[Spoofer] Error: No user selected or cookie provided', 'error');
      alert('Please select a user or enter a Roblox cookie before running the spoofer.');
      return;
    }

    // Group is optional - can upload to user account or group
    // If no group selected, will upload to user's account

    // Get selected assets from the tree
    const selectedAssets = window.uiManager?.getSelectedAssets() || [];
    if (selectedAssets.length === 0) {
      this.isRunning = false;
      window.uiManager?.addDebugLine('[Spoofer] Error: No assets selected', 'error');
      alert('Please select at least one asset to spoof.');
      return;
    }

    this.setRunningState(true);
    window.uiManager?.addDebugLine(`[Spoofer] Starting spoofing process for ${selectedAssets.length} assets...`, 'info');
    
    if (this.elements.outputDataTextarea) {
      this.elements.outputDataTextarea.value = '';
    }

    const forcePlaceIdRaw = (this.elements.forcePlaceIdInput?.value || '').trim();
    // Parse comma-separated place IDs into an array
    const forcePlaceIds = forcePlaceIdRaw 
      ? forcePlaceIdRaw.split(',')
          .map(id => parseInt(id.trim(), 10))
          .filter(id => Number.isFinite(id) && id > 0)
      : undefined;
    const transferMode = this.elements.transferModeSelect?.value || 'upload';
    const downloadDirectory = (this.elements.downloadDirectoryInput?.value || '').trim();

    const data = {
      userId: selectedUserId,
      groupId: selectedGroupId,
      cookie: manualCookie,
      assets: selectedAssets,
      advancedSettings: {
        placeIdSearchLimit: parseInt(this.elements.placeIdSearchLimitInput?.value, 10) || undefined,
        forcePlaceIds,
        transferMode,
        downloadOnly: transferMode === 'download',
        downloadDirectory,
      },
    };

    console.log('Renderer sending spoof data to main:', data);
    if (window.electronAPI && window.electronAPI.runSpooferAction) {
      window.electronAPI.runSpooferAction(data);
    } else {
      this.setRunningState(false);
      window.uiManager?.addDebugLine('[Spoofer] Error: electronAPI not available', 'error');
    }
  }

  /**
   * Setup version display
   */
  setupVersion() {
    if (window.electronAPI && window.electronAPI.getAppVersion) {
      window.electronAPI
        .getAppVersion()
        .then((ver) => {
          if (this.elements.versionTextElement) {
            this.elements.versionTextElement.textContent = `v${ver}`;
          }
          if (this.elements.settingsVersionElement) {
            this.elements.settingsVersionElement.textContent = `v${ver}`;
          }
        })
        .catch((err) => {
          console.warn('Failed to get app version:', err);
        });
    } else {
      console.warn('electronAPI.getAppVersion not found');
    }

    if (window.electronAPI && window.electronAPI.getInstalledPluginVersion) {
      window.electronAPI
        .getInstalledPluginVersion()
        .then((res) => {
          const value = res && res.ok ? res.version : null;
          if (this.elements.settingsPluginVersionElement) {
            this.elements.settingsPluginVersionElement.textContent = value ? `v${value}` : 'Not installed';
          }
        })
        .catch((err) => {
          console.warn('Failed to get plugin version:', err);
        });
    } else {
      console.warn('electronAPI.getInstalledPluginVersion not found');
    }
  }

  /**
   * Setup plugin update modal and events
   */
  setupPluginUpdates() {
    const modal = document.getElementById('plugin-update-modal');
    const statusEl = document.getElementById('plugin-update-status');
    const currentVersionEl = document.getElementById('plugin-current-version-display');
    const newVersionEl = document.getElementById('plugin-new-version-display');
    const closeBtn = document.getElementById('plugin-update-close-btn');

    const showModal = () => {
      if (modal) modal.style.display = 'flex';
    };

    const hideModal = () => {
      if (modal) modal.style.display = 'none';
    };

    if (closeBtn) {
      closeBtn.addEventListener('click', () => hideModal());
    }

    if (window.electronAPI && window.electronAPI.onPluginUpdateAvailable) {
      window.electronAPI.onPluginUpdateAvailable((info) => {
        if (currentVersionEl) {
          currentVersionEl.textContent = info.installedVersion ? `v${info.installedVersion}` : 'Not installed';
        }
        if (newVersionEl) {
          newVersionEl.textContent = info.version ? `v${info.version}` : 'v?';
        }
        if (statusEl) {
          statusEl.textContent = 'Downloading plugin update...';
        }
        showModal();
      });
    }

    if (window.electronAPI && window.electronAPI.onPluginUpdateProgress) {
      window.electronAPI.onPluginUpdateProgress((info) => {
        if (statusEl && info && typeof info.percent === 'number') {
          statusEl.textContent = `Downloading plugin update... ${info.percent}%`;
        }
      });
    }

    if (window.electronAPI && window.electronAPI.onPluginUpdateComplete) {
      window.electronAPI.onPluginUpdateComplete((info) => {
        if (statusEl) {
          statusEl.textContent = 'Plugin updated. Restart Roblox Studio if it is open.';
        }
        if (this.elements.settingsPluginVersionElement && info?.version) {
          this.elements.settingsPluginVersionElement.textContent = `v${info.version}`;
        }
      });
    }

    if (window.electronAPI && window.electronAPI.onPluginUpdateError) {
      window.electronAPI.onPluginUpdateError((info) => {
        if (statusEl) {
          statusEl.textContent = `Plugin update failed: ${info?.message || 'Unknown error'}`;
        }
        showModal();
      });
    }
  }

  /**
   * Setup discord button
   */
  setupDiscordButton() {
    if (this.elements.discordBtn) {
      this.elements.discordBtn.addEventListener('click', () => {
        this.openDiscordInvite();
      });
    }

    // Setup home page discord button
    const discordHomeBtn = document.getElementById('discord-home-btn');
    if (discordHomeBtn) {
      discordHomeBtn.addEventListener('click', () => {
        this.openDiscordInvite();
      });
    }
  }

  /**
   * Open Discord invite link
   */
  openDiscordInvite() {
    const invite = 'https://discord.gg/vfVdm9q8SV';
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(invite);
    } else {
      window.open(invite, '_blank', 'noopener');
    }
  }

  /**
   * Setup theme switching
   */
  setupTheme() {
    const themeSelect = document.getElementById('theme-select');
    const themeImportBtn = document.getElementById('theme-import-btn');
    const themeImportFile = document.getElementById('theme-import-file');

    // Load saved theme from localStorage
    const savedTheme = localStorage.getItem('app-theme') || 'dark';

    // Load custom themes from folder and populate dropdown
    this.loadCustomThemesIntoDropdown(themeSelect).then(() => {
      // Restore saved theme (handle both old 'custom' and new custom-file- formats)
      if (savedTheme === 'custom') {
        // Legacy: try to load from localStorage first
        const customTheme = localStorage.getItem('custom-theme');
        if (customTheme) {
          try {
            const parsed = JSON.parse(customTheme);
            this.applyCustomTheme(parsed);
          } catch (err) {
            console.warn('Failed to restore legacy custom theme, using dark:', err);
            this.setTheme('dark');
          }
        } else {
          this.setTheme('dark');
        }
      } else if (savedTheme.startsWith('custom-file-')) {
        // New: load from file
        const fileName = savedTheme.replace('custom-file-', '');
        this.loadCustomThemeFromFile(fileName).then(() => {
          if (themeSelect) themeSelect.value = savedTheme;
        }).catch(err => {
          console.warn('Failed to restore custom theme file, using dark:', err);
          this.setTheme('dark');
        });
      } else {
        // Standard theme
        this.setTheme(savedTheme);
      }
      
      if (themeSelect) themeSelect.value = savedTheme;
    });

    if (themeSelect) {
      // Listen for theme dropdown changes
      themeSelect.addEventListener('change', async (e) => {
        const newTheme = e.target.value;
        if (newTheme === 'custom-import') {
          // Trigger file picker
          themeImportFile.click();
        } else if (newTheme.startsWith('custom-file-')) {
          // Load custom theme from file
          const fileName = newTheme.replace('custom-file-', '');
          await this.loadCustomThemeFromFile(fileName);
          localStorage.setItem('app-theme', newTheme);
        } else {
          this.setTheme(newTheme);
          localStorage.setItem('app-theme', newTheme);
        }
      });
    }

    // Theme import button
    if (themeImportBtn && themeImportFile) {
      themeImportBtn.addEventListener('click', () => {
        themeImportFile.click();
      });

      themeImportFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        this.loadCustomTheme(file);
      });
    }

    // Theme icon button
    const themeIconBtn = document.getElementById('theme-icon-btn');
    const themeIconFile = document.getElementById('theme-icon-file');
    if (themeIconBtn && themeIconFile) {
      themeIconBtn.addEventListener('click', () => {
        themeIconFile.click();
      });

      themeIconFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        this.loadThemeIcon(file);
      });
    }

    // Setup logo transparency control
    if (this.elements.logoTransparencySlider) {
      this.elements.logoTransparencySlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        const percentage = Math.round(value * 100);
        
        // Update the display value
        if (this.elements.logoTransparencyValue) {
          this.elements.logoTransparencyValue.textContent = percentage + '%';
        }

        // Apply transparency to logo
        const logoEl = document.getElementById('logo');
        if (logoEl) {
          logoEl.style.opacity = value;
        }

        // Save to localStorage
        localStorage.setItem('logo-transparency', value.toString());

        // Update current custom theme if loaded
        const customTheme = localStorage.getItem('custom-theme');
        if (customTheme) {
          const theme = JSON.parse(customTheme);
          theme.logoTransparency = value;
          localStorage.setItem('custom-theme', JSON.stringify(theme));
        }
      });

      // Load saved transparency on startup
      const savedTransparency = localStorage.getItem('logo-transparency');
      if (savedTransparency) {
        const value = parseFloat(savedTransparency);
        this.elements.logoTransparencySlider.value = value;
        this.elements.logoTransparencyValue.textContent = Math.round(value * 100) + '%';
        const logoEl = document.getElementById('logo');
        if (logoEl) {
          logoEl.style.opacity = value;
        }
      }
    }
  }

  /**
   * Load and apply icon to current theme
   */
  loadThemeIcon(file) {
    const reader = new FileReader();
    const statusEl = document.getElementById('theme-import-status');

    reader.onload = async (e) => {
      try {
        const iconData = e.target.result; // Base64 encoded image
        
        // Get current theme from localStorage
        const customTheme = localStorage.getItem('custom-theme');
        if (!customTheme) {
          throw new Error('No custom theme loaded. Import a theme first.');
        }

        const theme = JSON.parse(customTheme);
        theme.icon = iconData; // Add icon to theme
        
        // Apply updated theme
        this.applyCustomTheme(theme);

        // Save updated theme to file if it came from file storage
        const appTheme = localStorage.getItem('app-theme');
        if (appTheme && appTheme.startsWith('custom-file-')) {
          const fileName = appTheme.replace('custom-file-', '');
          if (window.electronAPI && window.electronAPI.saveCustomTheme) {
            await window.electronAPI.saveCustomTheme(theme.name, theme);
          }
        }

        if (statusEl) {
          statusEl.textContent = `✓ Icon updated for theme "${theme.name}"!`;
          statusEl.style.color = '#10b981';
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = `✗ Error: ${err.message}`;
          statusEl.style.color = '#ef4444';
        }
        console.error('Icon import error:', err);
      }
    };

    reader.readAsDataURL(file);
  }

  /**
   * Load custom themes from folder into dropdown
   */
  async loadCustomThemesIntoDropdown(themeSelect) {
    if (!themeSelect || !window.electronAPI || !window.electronAPI.getCustomThemes) {
      return;
    }

    try {
      const customThemes = await window.electronAPI.getCustomThemes();
      
      // Remove old custom theme options AND separators (keep default ones)
      const optionsToRemove = [];
      for (let i = 0; i < themeSelect.options.length; i++) {
        const option = themeSelect.options[i];
        if (option.value.startsWith('custom-file-') || 
            option.value === 'custom-import' ||
            (option.disabled && (option.textContent.includes('Custom Themes') || option.textContent.includes('─────')))) {
          optionsToRemove.push(i);
        }
      }
      // Remove in reverse order to maintain indices
      for (let i = optionsToRemove.length - 1; i >= 0; i--) {
        themeSelect.remove(optionsToRemove[i]);
      }

      // Add custom theme options
      if (customThemes && customThemes.length > 0) {
        // Add separator
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '─ Custom Themes ─';
        themeSelect.appendChild(separator);

        for (const customTheme of customThemes) {
          const option = document.createElement('option');
          option.value = `custom-file-${customTheme.fileName}`;
          option.textContent = `📁 ${customTheme.name}`;
          themeSelect.appendChild(option);
        }
      }

      // Add import option at the end
      const separator2 = document.createElement('option');
      separator2.disabled = true;
      separator2.textContent = '─────────────';
      themeSelect.appendChild(separator2);

      const importOption = document.createElement('option');
      importOption.value = 'custom-import';
      importOption.textContent = '➕ Import New Theme...';
      themeSelect.appendChild(importOption);
    } catch (err) {
      console.warn('Failed to load custom themes:', err);
    }
  }

  /**
   * Load custom theme from file
   */
  async loadCustomThemeFromFile(fileName) {
    if (!window.electronAPI || !window.electronAPI.loadCustomThemeFile) {
      console.warn('IPC method not available');
      return;
    }

    const statusEl = document.getElementById('theme-import-status');
    
    try {
      const result = await window.electronAPI.loadCustomThemeFile(fileName);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to load theme');
      }

      const theme = result.theme;
      this.applyCustomTheme(theme);
      
      if (statusEl) {
        statusEl.textContent = `✓ Theme "${theme.name}" loaded!`;
        statusEl.style.color = '#10b981';
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `✗ Error: ${err.message}`;
        statusEl.style.color = '#ef4444';
      }
      console.error('Failed to load custom theme file:', err);
    }
  }

  /**
   * Load and apply custom theme from JSON file
   */
  loadCustomTheme(file) {
    const reader = new FileReader();
    const statusEl = document.getElementById('theme-import-status');

    reader.onload = async (e) => {
      try {
        const theme = JSON.parse(e.target.result);
        if (!theme.name || !theme.colors) {
          throw new Error('Invalid theme format. Must have "name" and "colors" properties.');
        }

        // Save to custom themes folder
        let saveResult = null;
        if (window.electronAPI && window.electronAPI.saveCustomTheme) {
          saveResult = await window.electronAPI.saveCustomTheme(theme.name, theme);
          if (!saveResult.success) {
            throw new Error(saveResult.error || 'Failed to save theme');
          }
        }

        // Apply theme
        this.applyCustomTheme(theme);

        // Update dropdown
        const themeSelect = document.getElementById('theme-select');
        await this.loadCustomThemesIntoDropdown(themeSelect);
        
        // Set to the newly imported theme
        if (saveResult && saveResult.fileName) {
          themeSelect.value = `custom-file-${saveResult.fileName}`;
          localStorage.setItem('app-theme', `custom-file-${saveResult.fileName}`);
        }

        if (statusEl) {
          statusEl.textContent = `✓ Theme "${theme.name}" imported and saved!`;
          statusEl.style.color = '#10b981';
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = `✗ Error: ${err.message}`;
          statusEl.style.color = '#ef4444';
        }
        console.error('Theme import error:', err);
      }
    };

    reader.readAsText(file);
  }

  /**
   * Apply custom theme to the UI
   */
  applyCustomTheme(theme) {
    const root = document.documentElement;

    // Apply custom colors to CSS variables
    Object.entries(theme.colors).forEach(([key, value]) => {
      if (typeof value === 'string' && (value.startsWith('#') || value.startsWith('rgb'))) {
        root.style.setProperty(`--${key}`, value);
        
        // If it's green-accent, also set the RGB version for transparency usage
        if (key === 'green-accent' && value.startsWith('#')) {
          const rgb = this.hexToRgb(value);
          if (rgb) {
            root.style.setProperty('--green-accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
          }
        }
      }
    });

    // Apply transparency/opacity values
    if (theme.transparency) {
      Object.entries(theme.transparency).forEach(([key, value]) => {
        if (typeof value === 'number' && value >= 0 && value <= 1) {
          root.style.setProperty(`--opacity-${key}`, value);
        }
      });
    }

    // Apply background properties to body
    if (theme.background) {
      if (theme.background.image) {
        document.body.style.backgroundImage = `url('${theme.background.image}')`;
        document.body.style.backgroundSize = theme.background.size || 'cover';
        document.body.style.backgroundPosition = theme.background.position || 'center';
        document.body.style.backgroundAttachment = theme.background.attachment || 'fixed';
        document.body.style.backgroundRepeat = theme.background.repeat || 'no-repeat';
      }
      if (theme.background.color) {
        root.style.setProperty('--bg-color', theme.background.color);
      }
    }

    // Apply custom icon if provided (base64 or URL), otherwise use default
    const logoEl = document.getElementById('logo');
    if (logoEl) {
      if (theme.icon && (theme.icon.startsWith('data:image') || theme.icon.startsWith('http'))) {
        // Apply custom icon
        logoEl.src = theme.icon;
        logoEl.style.content = 'unset'; // Override CSS content property
      } else {
        // Use default icon from CSS
        logoEl.src = '';
        logoEl.style.content = ''; // Restore CSS content property
      }
    }

    // Apply logo transparency if provided
    if (theme.logoTransparency !== undefined) {
      const logoEl = document.getElementById('logo');
      if (logoEl) {
        logoEl.style.opacity = theme.logoTransparency;
      }
    }

    // Save to localStorage for fast reload
    localStorage.setItem('custom-theme', JSON.stringify(theme));
    this.setTheme('custom');
  }

  /**
   * Apply theme to the app
   */
  setTheme(theme) {
    const root = document.documentElement;

    if (theme === 'light') {
      document.body.setAttribute('data-theme', 'light');
      document.body.style.backgroundImage = 'none';
      // Change window icon to light version
      if (window.electronAPI && window.electronAPI.setWindowIcon) {
        window.electronAPI.setWindowIcon('light');
      }
      // Clear custom CSS variables
      this.clearCustomCSSVariables();
      // Update icon paths to light theme
      this.updateIconsForTheme('light');
    } else if (theme === 'custom') {
      // Change window icon to dark version for custom theme
      if (window.electronAPI && window.electronAPI.setWindowIcon) {
        window.electronAPI.setWindowIcon('dark');
      }
      document.body.removeAttribute('data-theme');
      // Load custom theme from localStorage
      const customTheme = localStorage.getItem('custom-theme');
      if (customTheme) {
        try {
          const parsed = JSON.parse(customTheme);
          // Apply colors
          Object.entries(parsed.colors).forEach(([key, value]) => {
            if (typeof value === 'string') {
              root.style.setProperty(`--${key}`, value);
              
              // If it's green-accent, also set the RGB version for transparency usage
              if (key === 'green-accent' && value.startsWith('#')) {
                const rgb = this.hexToRgb(value);
                if (rgb) {
                  root.style.setProperty('--green-accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
                }
              }
            }
          });

          // Apply transparency values
          if (parsed.transparency) {
            Object.entries(parsed.transparency).forEach(([key, value]) => {
              if (typeof value === 'number' && value >= 0 && value <= 1) {
                root.style.setProperty(`--opacity-${key}`, value);
              }
            });
          }

          // Apply background
          if (parsed.background && parsed.background.image) {
            document.body.style.backgroundImage = `url('${parsed.background.image}')`;
            document.body.style.backgroundSize = parsed.background.size || 'cover';
            document.body.style.backgroundPosition = parsed.background.position || 'center';
            document.body.style.backgroundAttachment = parsed.background.attachment || 'fixed';
            document.body.style.backgroundRepeat = parsed.background.repeat || 'no-repeat';
          } else {
            document.body.style.backgroundImage = 'none';
          }

          // Apply custom icon if provided
          if (parsed.icon) {
            const logoEl = document.getElementById('logo');
            if (logoEl) {
              if (parsed.icon.startsWith('data:image') || parsed.icon.startsWith('http')) {
                logoEl.src = parsed.icon;
                logoEl.style.content = 'unset';
              }
            }
          }
        } catch (e) {
          console.error('Failed to load custom theme:', e);
        }
      }
    } else {
      // Dark mode (default) - restore default logo
      document.body.removeAttribute('data-theme');
      document.body.style.backgroundImage = 'none';
      const logoEl = document.getElementById('logo');
      if (logoEl) {
        logoEl.src = '';
        logoEl.style.content = '';
      }
      // Change window icon to dark version
      if (window.electronAPI && window.electronAPI.setWindowIcon) {
        window.electronAPI.setWindowIcon('dark');
      }
      // Clear custom CSS variables
      this.clearCustomCSSVariables();
      // Update icon paths to dark theme
      this.updateIconsForTheme('dark');
    }

    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.value = theme;
    }
  }

  /**
   * Update icon paths for theme-aware switching
   */
  updateIconsForTheme(theme) {
    const themeFolder = theme === 'light' ? 'Light' : 'Dark';
    
    // Update sidebar navigation icons
    const navIcons = document.querySelectorAll('.nav-icon');
    navIcons.forEach((icon) => {
      const currentSrc = icon.src;
      // Extract the icon filename (e.g., "Workspace.png")
      const filename = currentSrc.split('/').pop();
      icon.src = `assets/icons/${themeFolder}/Standard/${filename}`;
    });

    // Update toggle icons
    const toggleIcons = document.querySelectorAll('.toggle-icon');
    toggleIcons.forEach((icon) => {
      const currentSrc = icon.src;
      // Extract the icon filename
      const filename = currentSrc.split('/').pop();
      icon.src = `assets/icons/${themeFolder}/Standard/${filename}`;
    });
  }

  /**
   * Clear custom CSS variables to restore defaults
   */
  clearCustomCSSVariables() {
    const root = document.documentElement;
    const colorVars = [
      'bg-color', 'bg-secondary', 'titlebar-bg', 'sidebar-bg', 'input-bg',
      'text-color', 'text-secondary', 'label-color', 'green-accent',
      'green-accent-hover', 'green-accent-rgb', 'accent-text', 'red-accent', 'border-color', 'disabled-input-bg',
      'disabled-input-text', 'shadow-sm', 'shadow-md', 'shadow-lg',
      'debug-info', 'debug-warn', 'debug-error', 'debug-timestamp'
    ];
    colorVars.forEach(varName => {
      root.style.removeProperty(`--${varName}`);
    });
  }

  /**
   * Convert hex color to RGB object
   */
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  /**
   * Get element by key
   */
  getElement(key) {
    return this.elements[key];
  }

  /**
   * Setup cookie source toggles with localStorage persistence
   */
  setupCookieSourceToggles() {
    // Load saved preferences (default: both disabled)
    const includeStudio = localStorage.getItem('auto-cookie-studio') === 'true';
    const includeBrowsers = localStorage.getItem('auto-cookie-browsers') === 'true';
    const storedSkipOwned = localStorage.getItem('skip-owned-check');

    if (this.elements.autoCookieStudioToggle) {
      this.elements.autoCookieStudioToggle.checked = includeStudio;
      this.elements.autoCookieStudioToggle.addEventListener('change', (e) => {
        localStorage.setItem('auto-cookie-studio', e.target.checked ? 'true' : 'false');
        // Re-populate users when source preference changes
        const userSelect = this.elements.selectedUserSelect;
        if (userSelect) {
          const savedUserId = localStorage.getItem('selectedUserId') || '';
          this.populateValidatedUsers(userSelect, savedUserId);
        }
        this.updateSelectedUserState();
      });
    }

    if (this.elements.autoCookieBrowsersToggle) {
      this.elements.autoCookieBrowsersToggle.checked = includeBrowsers;
      this.elements.autoCookieBrowsersToggle.addEventListener('change', (e) => {
        localStorage.setItem('auto-cookie-browsers', e.target.checked ? 'true' : 'false');
        // Re-populate users when source preference changes
        const userSelect = this.elements.selectedUserSelect;
        if (userSelect) {
          const savedUserId = localStorage.getItem('selectedUserId') || '';
          this.populateValidatedUsers(userSelect, savedUserId);
        }
        this.updateSelectedUserState();
      });
    }

    if (this.elements.skipOwnedCheckToggle) {
      // Load server preference first, fallback to local storage, default true
      window.electronAPI.getSkipOwnedCheck().then((value) => {
        const initial = typeof value === 'boolean' ? value : (storedSkipOwned === null ? true : storedSkipOwned === 'true');
        this.elements.skipOwnedCheckToggle.checked = initial;
        localStorage.setItem('skip-owned-check', initial ? 'true' : 'false');
      }).catch(() => {
        const initial = storedSkipOwned === null ? true : storedSkipOwned === 'true';
        this.elements.skipOwnedCheckToggle.checked = initial;
      });

      this.elements.skipOwnedCheckToggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        localStorage.setItem('skip-owned-check', enabled ? 'true' : 'false');
        try {
          await window.electronAPI.setSkipOwnedCheck(enabled);
          this.updateStatus(`Skip owned assets: ${enabled ? 'On' : 'Off'}`);
        } catch (err) {
          console.warn('[setupCookieSourceToggles] Failed to set skip-owned-check:', err);
        }
      });
    }

    // Setup plugin port input with localStorage and config file persistence
    if (this.elements.pluginPortInput) {
      // Load port from main process config file
      window.electronAPI.invoke('get-plugin-port').then(port => {
        this.elements.pluginPortInput.value = port;
        localStorage.setItem('plugin-port', port.toString());
      }).catch(err => {
        console.warn('[setupCookieSourceToggles] Failed to get plugin port from config:', err);
        const savedPort = localStorage.getItem('plugin-port') || '3100';
        this.elements.pluginPortInput.value = savedPort;
      });

      this.elements.pluginPortInput.addEventListener('change', async (e) => {
        const port = parseInt(e.target.value, 10);
        if (port >= 1024 && port <= 65535) {
          localStorage.setItem('plugin-port', port.toString());
          // Save to config file in main process
          try {
            const result = await window.electronAPI.invoke('set-plugin-port', port);
            if (result && result.success) {
              console.log('[setupCookieSourceToggles] Plugin port saved to config:', port);
              // Show restart notification
              const message = `Port set to ${port}. Restart the app for changes to take effect.`;
              this.updateStatus(message);
            } else {
              console.warn('[setupCookieSourceToggles] Failed to save port to config');
            }
          } catch (err) {
            console.warn('[setupCookieSourceToggles] Error saving port:', err);
          }
        } else {
          console.warn('[setupCookieSourceToggles] Invalid port, reverting to saved value');
          const savedPort = localStorage.getItem('plugin-port') || '3100';
          e.target.value = savedPort;
        }
      });
    }

    // Setup exclusion list inputs
    const parseIds = (text) => text.split(/[,\s]+/).map(v => v.trim()).filter(Boolean);

    const loadExclusionList = async () => {
      try {
        const list = await window.electronAPI.getExclusionList();
        const users = (list && Array.isArray(list.userIds)) ? list.userIds : [];
        const groups = (list && Array.isArray(list.groupIds)) ? list.groupIds : [];
        if (this.elements.excludedUserIdsInput) {
          this.elements.excludedUserIdsInput.value = users.join(', ');
        }
        if (this.elements.excludedGroupIdsInput) {
          this.elements.excludedGroupIdsInput.value = groups.join(', ');
        }
      } catch (err) {
        console.warn('[setupCookieSourceToggles] Failed to load exclusion list:', err);
      }
    };

    const saveExclusionList = async () => {
      try {
        const userIds = this.elements.excludedUserIdsInput ? parseIds(this.elements.excludedUserIdsInput.value) : [];
        const groupIds = this.elements.excludedGroupIdsInput ? parseIds(this.elements.excludedGroupIdsInput.value) : [];
        await window.electronAPI.setExclusionList({ userIds, groupIds });
        this.updateStatus(`Saved exclusion list (users: ${userIds.length}, groups: ${groupIds.length})`);
      } catch (err) {
        console.warn('[setupCookieSourceToggles] Failed to save exclusion list:', err);
      }
    };

    if (this.elements.excludedUserIdsInput || this.elements.excludedGroupIdsInput) {
      loadExclusionList();
      const handler = () => saveExclusionList();
      if (this.elements.excludedUserIdsInput) {
        this.elements.excludedUserIdsInput.addEventListener('change', handler);
        this.elements.excludedUserIdsInput.addEventListener('blur', handler);
      }
      if (this.elements.excludedGroupIdsInput) {
        this.elements.excludedGroupIdsInput.addEventListener('change', handler);
        this.elements.excludedGroupIdsInput.addEventListener('blur', handler);
      }
    }

    // Set initial state
    this.updateSelectedUserState();
  }

  /**
   * Configure transfer mode (reupload vs download-only) and download directory
   */
  setupTransferModeControls() {
    const modeSelect = this.elements.transferModeSelect;
    const dirInput = this.elements.downloadDirectoryInput;
    const browseBtn = this.elements.browseDownloadDirectoryBtn;

    if (!modeSelect && !dirInput && !browseBtn) {
      return;
    }

    const getModeValue = () => (modeSelect && modeSelect.value) ? modeSelect.value : 'upload';

    const setUiValues = (mode, directory) => {
      if (modeSelect && mode) {
        modeSelect.value = mode;
      }
      if (dirInput) {
        dirInput.value = directory || '';
      }
    };

    const saveSettings = async (mode, directory) => {
      localStorage.setItem('transfer-mode', mode);
      if (directory) {
        localStorage.setItem('download-directory', directory);
      } else {
        localStorage.removeItem('download-directory');
      }

      if (window.electronAPI && window.electronAPI.setDownloadSettings) {
        try {
          await window.electronAPI.setDownloadSettings({ mode, directory });
        } catch (err) {
          console.warn('[setupTransferModeControls] Failed to persist download settings:', err);
        }
      }
    };

    const loadInitialSettings = async () => {
      let mode = localStorage.getItem('transfer-mode') || 'upload';
      let directory = localStorage.getItem('download-directory') || '';

      if (window.electronAPI && window.electronAPI.getDownloadSettings) {
        try {
          const settings = await window.electronAPI.getDownloadSettings();
          if (settings && settings.mode) {
            mode = settings.mode;
          }
          if (settings && settings.directory) {
            directory = settings.directory;
          }
        } catch (err) {
          console.warn('[setupTransferModeControls] Failed to load download settings from main:', err);
        }
      }

      setUiValues(mode, directory);
    };

    loadInitialSettings();

    if (modeSelect) {
      modeSelect.addEventListener('change', () => {
        const mode = getModeValue();
        const directory = dirInput ? dirInput.value : '';
        saveSettings(mode, directory);
      });
    }

    if (browseBtn) {
      browseBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!window.electronAPI || !window.electronAPI.chooseDownloadDirectory) return;
        try {
          const result = await window.electronAPI.chooseDownloadDirectory();
          if (!result || result.canceled || !result.path) return;
          const mode = getModeValue();
          setUiValues(mode, result.path);
          await saveSettings(mode, result.path);
          this.updateStatus(`Download location set to ${result.path}`);
        } catch (err) {
          console.warn('[setupTransferModeControls] Folder picker failed:', err);
        }
      });
    }
  }

  /**
   * Initialize selections for user/group and persist in localStorage
   */
  setupSpooferSelections() {
    const userSelect = this.elements.selectedUserSelect;
    const groupSelect = this.elements.selectedGroupSelect;

    // Load saved values
    const savedUserId = localStorage.getItem('selectedUserId') || '';
    const savedGroupId = localStorage.getItem('selectedGroupId') || '';

    if (userSelect) {
      // Populate with validated users from cookies via IPC
      this.populateValidatedUsers(userSelect, savedUserId);
      userSelect.addEventListener('change', async (e) => {
        localStorage.setItem('selectedUserId', userSelect.value || '');
        
        // When user is selected, fetch and populate their groups
        if (e.target.value && this.elements.selectedGroupSelect && window.electronAPI && window.electronAPI.getUserGroups) {
          const userId = e.target.value;
          const includeStudio = localStorage.getItem('auto-cookie-studio') === 'true';
          const includeBrowsers = localStorage.getItem('auto-cookie-browsers') === 'true';
          
          if (includeStudio || includeBrowsers) {
            try {
              const cookieRes = await window.electronAPI.getCookieForUser(userId, { includeStudio, includeBrowsers });
              if (cookieRes && cookieRes.ok && cookieRes.cookie) {
                await this.populateGroupsForUser(this.elements.selectedGroupSelect, userId, cookieRes.cookie);
              }
            } catch (err) {
              console.warn('Failed to fetch groups:', err);
            }
          }
        } else {
          // Clear groups if no user selected
          if (this.elements.selectedGroupSelect) {
            this.elements.selectedGroupSelect.innerHTML = '<option value="">None</option>';
          }
        }
      });
      // Set initial state will be handled by updateSelectedUserState in setupCookieSourceToggles
    }

    if (groupSelect) {
      groupSelect.value = savedGroupId;
      // Sync to GroupID input for convenience
      if (this.elements.groupIdInput && savedGroupId) {
        this.elements.groupIdInput.value = savedGroupId;
      }
      groupSelect.addEventListener('change', () => {
        localStorage.setItem('selectedGroupId', groupSelect.value || '');
        if (this.elements.groupIdInput) {
          this.elements.groupIdInput.value = groupSelect.value || '';
        }
      });
    }
  }

  /**
   * Populate Selected Group dropdown based on chosen user
   */
  async populateGroupsForUser(groupSelect, userId, cookie) {
    try {
      console.log(`[populateGroupsForUser] Started. userId=${userId}, hasCookie=${!!cookie}, cookieLength=${cookie?.length || 0}`);
      
      // CLEAR the dropdown completely
      console.log('[populateGroupsForUser] Clearing dropdown, current length:', groupSelect.options.length);
      groupSelect.innerHTML = '';
      console.log('[populateGroupsForUser] Dropdown cleared, new length:', groupSelect.options.length);
      
      const noneOption = document.createElement('option');
      noneOption.value = '';
      noneOption.textContent = 'None';
      groupSelect.appendChild(noneOption);

      if (!cookie || !window.electronAPI || !window.electronAPI.getUserGroups) {
        console.warn('[populateGroupsForUser] Missing cookie or API:', { hasCookie: !!cookie, hasAPI: !!window.electronAPI?.getUserGroups });
        return;
      }

      console.log('[populateGroupsForUser] Calling getUserGroups with:', { userId, cookieLength: cookie.length });
      const res = await window.electronAPI.getUserGroups(userId, cookie);
      console.log('[populateGroupsForUser] Response from IPC:', JSON.stringify(res));
      
      if (!res) {
        console.error('[populateGroupsForUser] Received null/undefined response from IPC');
        return;
      }
      
      if (!res.ok) {
        console.warn('[populateGroupsForUser] Response not OK:', res.error);
        const errorOption = document.createElement('option');
        errorOption.value = '';
        errorOption.textContent = `Error: ${res.error || 'Unknown error'}`;
        errorOption.disabled = true;
        groupSelect.appendChild(errorOption);
        return;
      }
      
      const groups = res.result || [];
      console.log(`[populateGroupsForUser] Got ${groups.length} groups:`, groups.map(g => `${g.name} (${g.id})`));

      if (groups.length === 0) {
        console.log('[populateGroupsForUser] No groups found');
        const noGroupsOption = document.createElement('option');
        noGroupsOption.value = '';
        noGroupsOption.textContent = 'No groups with upload permissions';
        noGroupsOption.disabled = true;
        groupSelect.appendChild(noGroupsOption);
        return;
      }

      groups.forEach(({ id, name }) => {
        console.log(`[populateGroupsForUser] Adding group: ${name} (${id})`);
        const opt = document.createElement('option');
        opt.value = String(id);
        opt.textContent = name;
        groupSelect.appendChild(opt);
      });

      // Restore saved selection if present
      const savedGroupId = localStorage.getItem('selectedGroupId') || '';
      if (savedGroupId && groups.some(g => String(g.id) === String(savedGroupId))) {
        groupSelect.value = String(savedGroupId);
        console.log('[populateGroupsForUser] Restored saved group selection:', savedGroupId);
      }
      console.log('[populateGroupsForUser] Complete - added', groups.length, 'groups. Dropdown now has', groupSelect.options.length, 'options');
    } catch (err) {
      console.error('[populateGroupsForUser] Exception:', err.message, err.stack);
    }
  }

  /**
   * Update Selected User dropdown state based on auto-detect toggles
   */
  updateSelectedUserState() {
    const userSelect = this.elements.selectedUserSelect;
    if (!userSelect) return;

    const includeStudio = localStorage.getItem('auto-cookie-studio') === 'true';
    const includeBrowsers = localStorage.getItem('auto-cookie-browsers') === 'true';
    const anyEnabled = includeStudio || includeBrowsers;

    if (anyEnabled) {
      userSelect.disabled = false;
      userSelect.style.opacity = '1';
      userSelect.style.cursor = 'pointer';
      userSelect.title = '';
    } else {
      userSelect.disabled = true;
      userSelect.style.opacity = '0.5';
      userSelect.style.cursor = 'not-allowed';
      userSelect.title = 'Enable auto-detection in Advanced Settings to populate this list';
    }
  }

  /**
   * Populate the Selected User dropdown with validated Roblox users
   */
  async populateValidatedUsers(userSelect, savedUserId) {
    try {
      // Ensure base option exists
      userSelect.innerHTML = '';
      const noneOption = document.createElement('option');
      noneOption.value = '';
      noneOption.textContent = 'None';
      userSelect.appendChild(noneOption);

      if (!window.electronAPI || !window.electronAPI.discoverValidRobloxUsers) {
        // IPC not available; leave only None
        userSelect.value = savedUserId || '';
        return;
      }

      // Read cookie source preferences
      const includeStudio = localStorage.getItem('auto-cookie-studio') === 'true';
      const includeBrowsers = localStorage.getItem('auto-cookie-browsers') === 'true';
      const preferences = { includeStudio, includeBrowsers };

      // If no sources enabled, don't fetch
      if (!includeStudio && !includeBrowsers) {
        userSelect.value = '';
        return;
      }

      const res = await window.electronAPI.discoverValidRobloxUsers(preferences);
      const users = res && res.ok ? (res.result || []) : [];

      if (users.length === 0) {
        const noUsersOption = document.createElement('option');
        noUsersOption.value = '';
        noUsersOption.textContent = 'No valid users found';
        noUsersOption.disabled = true;
        userSelect.appendChild(noUsersOption);
        userSelect.value = '';
        return;
      }

      users.forEach(({ id, name }) => {
        const opt = document.createElement('option');
        opt.value = String(id);
        opt.textContent = `${name} (ID: ${id})`;
        userSelect.appendChild(opt);
      });

      // Always default to "None" - don't auto-select
      userSelect.value = '';
    } catch (err) {
      console.warn('Failed to populate validated users:', err);
      // Fallback to None
      userSelect.value = '';
    }
  }
  /**
   * Setup update modal and test button
   */
  setupUpdateModal() {
    const checkUpdateBtn = document.getElementById('check-update-btn');
    const updateModal = document.getElementById('update-modal');
    const updateNowBtn = document.getElementById('update-now-btn');
    const updateLaterBtn = document.getElementById('update-later-btn');

    let pendingDownloadUrl = null;

    // Listen for update events from main process
    if (window.electronAPI && window.electronAPI.onUpdateAvailable) {
      window.electronAPI.onUpdateAvailable((info) => {
        pendingDownloadUrl = info.downloadUrl;
        this.showUpdateModal(info.version);
      });
    }

    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener('click', async () => {
        if (!window.electronAPI || !window.electronAPI.checkForUpdates) {
          alert('Update check is not available.');
          return;
        }

        const originalLabel = checkUpdateBtn.textContent;
        checkUpdateBtn.disabled = true;
        checkUpdateBtn.textContent = 'Checking...';

        try {
          const result = await window.electronAPI.checkForUpdates();

          if (result?.ok === false) {
            alert('Update check failed: ' + (result.error || 'Unknown error'));
          } else if (!result?.updateAvailable) {
            alert('You are on the latest version.');
          }
          // If an update is available, the modal will appear via the update-available event.
        } catch (err) {
          alert('Update check failed: ' + err.message);
        } finally {
          checkUpdateBtn.disabled = false;
          checkUpdateBtn.textContent = originalLabel;
        }
      });
    }

    if (updateNowBtn) {
      updateNowBtn.addEventListener('click', async () => {
        if (!pendingDownloadUrl) {
          alert('No download URL available');
          return;
        }

        // Disable button and show progress
        updateNowBtn.disabled = true;
        updateNowBtn.textContent = 'Downloading...';

        if (window.electronAPI && window.electronAPI.downloadAndInstallUpdate) {
          try {
            const res = await window.electronAPI.downloadAndInstallUpdate(pendingDownloadUrl);
            if (!res || !res.ok) {
              alert('Failed to download: ' + (res?.error || 'Unknown error'));
              updateNowBtn.disabled = false;
              updateNowBtn.textContent = 'Update Now';
            }
            // If success, the app will close and installer will run
          } catch (err) {
            alert('Update error: ' + err.message);
            updateNowBtn.disabled = false;
            updateNowBtn.textContent = 'Update Now';
          }
        }
      });
    }

    if (updateLaterBtn) {
      updateLaterBtn.addEventListener('click', () => {
        this.hideUpdateModal();
      });
    }

    // Listen for download progress
    if (window.electronAPI && window.electronAPI.onUpdateDownloadProgress) {
      window.electronAPI.onUpdateDownloadProgress((info) => {
        const updateNowBtnInner = document.getElementById('update-now-btn');
        if (updateNowBtnInner && info.percent) {
          updateNowBtnInner.textContent = `Downloading... ${info.percent}%`;
        }
      });
    }

    // Listen for install message
    if (window.electronAPI && window.electronAPI.onUpdateInstalling) {
      window.electronAPI.onUpdateInstalling(() => {
        const updateNowBtnInner = document.getElementById('update-now-btn');
        if (updateNowBtnInner) {
          updateNowBtnInner.textContent = 'Installing...';
        }
      });
    }

    // Listen for update errors
    if (window.electronAPI && window.electronAPI.onUpdateError) {
      window.electronAPI.onUpdateError((info) => {
        alert('Update failed: ' + info.message);
        const updateNowBtnInner = document.getElementById('update-now-btn');
        if (updateNowBtnInner) {
          updateNowBtnInner.disabled = false;
          updateNowBtnInner.textContent = 'Update Now';
        }
      });
    }
  }

  /**
   * Setup Credits Modal
   */
  setupCreditsModal() {
    const creditsBtn = document.getElementById('credits-btn');
    const creditsModal = document.getElementById('credits-modal');
    const creditsCloseBtn = document.getElementById('credits-close-btn');
    const supportersList = document.getElementById('supporters-list');
    const boostersList = document.getElementById('boosters-list');

    if (creditsBtn && creditsModal) {
      creditsBtn.addEventListener('click', async () => {
        creditsModal.style.display = 'flex';
        
        // Fetch supporters and boosters when modal opens
        if (supportersList && supportersList.textContent === 'Loading...') {
          try {
            const response = await fetch('https://www.incredidev.com/api/supporters', {
              method: 'GET',
              headers: {
                'Accept': 'application/json'
              }
            });
            
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Display supporters
            if (data && data.supporters && Array.isArray(data.supporters) && data.supporters.length > 0) {
              supportersList.innerHTML = data.supporters.map(name => `• ${name}`).join('<br>');
            } else {
              supportersList.textContent = 'No supporters yet. Be the first!';
            }
            
            // Display boosters
            if (data && data.boosters && Array.isArray(data.boosters) && data.boosters.length > 0) {
              boostersList.innerHTML = data.boosters.map(name => `• ${name}`).join('<br>');
            } else {
              boostersList.textContent = 'No boosters yet. Be the first!';
            }
          } catch (error) {
            console.error('Failed to fetch supporters and boosters:', error);
            supportersList.textContent = 'Thank you to all our supporters!';
            boostersList.textContent = 'Thank you to all our boosters!';
          }
        }
      });
    }

    if (creditsCloseBtn && creditsModal) {
      creditsCloseBtn.addEventListener('click', () => {
        creditsModal.style.display = 'none';
      });
    }

    // Close modal when clicking outside
    if (creditsModal) {
      creditsModal.addEventListener('click', (e) => {
        if (e.target === creditsModal) {
          creditsModal.style.display = 'none';
        }
      });
    }
  }

  /**
   * Show update modal with new version
   */
  showUpdateModal(newVersion) {
    const modal = document.getElementById('update-modal');
    const currentVersionDisplay = document.getElementById('current-version-display');
    const newVersionDisplay = document.getElementById('new-version-display');

    if (currentVersionDisplay) {
      currentVersionDisplay.textContent = this.elements.versionTextElement?.textContent || 'v0.0.0';
    }
    if (newVersionDisplay) {
      newVersionDisplay.textContent = newVersion.startsWith('v') ? newVersion : `v${newVersion}`;
    }

    if (modal) {
      modal.style.display = 'flex';
    }
  }

  /**
   * Hide update modal
   */
  hideUpdateModal() {
    const modal = document.getElementById('update-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }
}

// Initialize App Manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    window.appManager = new AppManager();
    // Set initial status
    window.appManager.updateStatus('Ready');
  } catch (e) {
    console.error('Failed to initialize AppManager:', e);
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = 'Initialization error. Check console.';
  }
});
