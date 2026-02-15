/**
 * UI Module
 * Handles dropdowns, navigation, and general UI interactions
 */

class UIManager {
  constructor() {
    this.currentSection = 'home';
    this.debugMode = false;
    this.isLoadingAssets = false;
    this.init();
  }

  init() {
    this.setupNavigation();
    this.setupDropdowns();
    this.setupInputSelection();
    this.setupDebugTerminal();
    this.checkDebugMode();
    this.setupAssetExplorer();
    this.setupIdInputToggle();
    this.setupIdInputListener();
  }

  /**
   * Setup sidebar navigation
   */
  setupNavigation() {
    const buttons = Array.from(document.querySelectorAll('.nav-button'));
    const sections = Array.from(document.querySelectorAll('.content-section'));
    const activate = (sectionId) => {
      buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.section === sectionId));
      sections.forEach(sec => sec.classList.toggle('active', sec.id === `section-${sectionId}`));
      this.currentSection = sectionId;
    };
    buttons.forEach(btn => {
      btn.addEventListener('click', () => activate(btn.dataset.section));
    });
    // Initialize to current
    activate(this.currentSection);
  }

  /**
   * Setup dropdown toggles
   */
  setupDropdowns() {
    document.querySelectorAll('.dropdown .dropdown-header').forEach(header => {
      header.addEventListener('click', () => {
        const dropdown = header.closest('.dropdown');
        if (!dropdown) return;
        const content = dropdown.querySelector('.dropdown-content');
        const toggle = header.querySelector('.dropdown-toggle');
        header.classList.toggle('active');
        content?.classList.toggle('active');
        toggle?.classList.toggle('active');
      });
    });
  }

  /**
   * Allow text selection in inputs/outputs
   */
  setupInputSelection() {
    const selectable = document.querySelectorAll('input, textarea, .output-area textarea');
    selectable.forEach(el => {
      el.style.webkitUserSelect = 'text';
      el.style.userSelect = 'text';
    });
  }

  /**
   * Get current active section
   */
  getActiveSection() {
    return this.currentSection;
  }

  /**
   * Toggle a specific dropdown by ID
   */
  toggleDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) {
      const header = dropdown.querySelector('.dropdown-header');
      const content = dropdown.querySelector('.dropdown-content');
      const toggle = header.querySelector('.dropdown-toggle');

      header.classList.toggle('active');
      content.classList.toggle('active');
      if (toggle) {
        toggle.classList.toggle('active');
      }
    }
  }

  /**
   * Open a specific dropdown by ID
   */
  openDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) {
      const header = dropdown.querySelector('.dropdown-header');
      const content = dropdown.querySelector('.dropdown-content');
      const toggle = header.querySelector('.dropdown-toggle');

      header.classList.add('active');
      content.classList.add('active');
      if (toggle) {
        toggle.classList.add('active');
      }
    }
  }

  /**
   * Close a specific dropdown by ID
   */
  closeDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) {
      const header = dropdown.querySelector('.dropdown-header');
      const content = dropdown.querySelector('.dropdown-content');
      const toggle = header.querySelector('.dropdown-toggle');

      header.classList.remove('active');
      content.classList.remove('active');
      if (toggle) {
        toggle.classList.remove('active');
      }
    }
  }

  /**
   * Setup debug terminal functionality
   */
  setupDebugTerminal() {
    const clearBtn = document.getElementById('clear-debug-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearDebugOutput();
      });
    }

    // Setup resize functionality
    this.setupDebugTerminalResize();

    // Override console methods to capture output
    if (this.debugMode) {
      this.overrideConsole();
    }
  }

  /**
   * Setup debug terminal resize functionality
   */
  setupDebugTerminalResize() {
    const terminal = document.getElementById('debug-terminal');
    const handle = document.getElementById('debug-resize-handle');

    if (!terminal || !handle) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startY = e.clientY;
      startHeight = terminal.clientHeight;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const deltaY = startY - e.clientY; // Negative = resize down, positive = resize up
      let newHeight = startHeight + deltaY;

      // Constrain height between min and max
      newHeight = Math.max(150, Math.min(400, newHeight));

      terminal.style.height = newHeight + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.userSelect = 'auto';
        document.body.style.cursor = 'default';
      }
    });
  }

  /**
   * Check if debug mode is enabled
   */
  checkDebugMode() {
    // Check if debug mode setting exists
    const debugToggle = document.getElementById('debug-mode');
    if (debugToggle) {
      this.debugMode = debugToggle.checked;
      this.toggleDebugTerminal(this.debugMode);

      // Listen for changes
      debugToggle.addEventListener('change', (e) => {
        this.debugMode = e.target.checked;
        this.toggleDebugTerminal(this.debugMode);
        if (this.debugMode) {
          this.overrideConsole();
          this.addDebugLine('Debug mode enabled', 'success');
        } else {
          this.restoreConsole();
        }
      });
    }
  }

  /**
   * Setup ID Input toggle
   */
  setupIdInputToggle() {
    const toggle = document.getElementById('show-id-input');
    const idInputSection = document.getElementById('id-input-section');
    
    if (toggle && idInputSection) {
      // Set initial state from localStorage
      const savedState = localStorage.getItem('showIdInput') === 'true';
      toggle.checked = savedState;
      idInputSection.style.display = savedState ? 'block' : 'none';
      
      // Listen for changes
      toggle.addEventListener('change', (e) => {
        const show = e.target.checked;
        idInputSection.style.display = show ? 'block' : 'none';
        localStorage.setItem('showIdInput', String(show));
      });
    }
  }

  /**
   * Setup listener for asset ID input changes
   */
  setupIdInputListener() {
    const idInput = document.getElementById('animationId');
    if (!idInput) return;

    let debounceTimer;
    const handleInput = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Set flag to prevent _updateIdBoxFromTree from overwriting during this operation
        this._updatingFromManualInput = true;
        this.handleManualIdInput();
        this._updatingFromManualInput = false;
      }, 500); // Debounce for 500ms
    };

    idInput.addEventListener('input', handleInput);
    idInput.addEventListener('paste', handleInput);
  }

  /**
   * Parse manually entered IDs and display them in explorer
   */
  handleManualIdInput() {
    const idInput = document.getElementById('animationId');
    if (!idInput) return;

    const inputText = idInput.value.trim();
    if (!inputText) {
      // If input is empty, rebuild tree without imported assets
      if (this._explorerTree && this._hasImportedAssets) {
        this.buildExplorerTree();
        this._hasImportedAssets = false;
      }
      return;
    }

    // Parse IDs from input (numbers only, separated by newlines, commas, or spaces)
    const ids = inputText
      .split(/[\n,\s]+/)
      .map(id => id.trim())
      .filter(id => /^\d+$/.test(id))
      .map(id => parseInt(id, 10))
      .filter((id, index, self) => self.indexOf(id) === index); // Remove duplicates

    if (ids.length === 0) {
      // No valid IDs found
      if (this._explorerTree && this._hasImportedAssets) {
        this.buildExplorerTree();
        this._hasImportedAssets = false;
      }
      return;
    }

    // Store imported IDs and update explorer
    this._importedAssetIds = ids;
    this._hasImportedAssets = true;
    this.displayImportedAssets(ids);
  }

  /**
   * Display imported assets in the explorer tree
   */
  displayImportedAssets(ids) {
    if (!this._explorerTree || !ids || ids.length === 0) return;

    // Create imported assets structure
    const importedAssets = {
      Imported: ids.map(id => ({
        name: `Asset ${id}`,
        assetId: id.toString(),
        assetType: 'Animation', // Default type, user can change this if needed
        kind: 'Manual',
        creator: 'Manual Import',
        fullInfo: {
          assetId: id.toString(),
          assetName: `Asset ${id}`,
          creator: 'Manual Import',
          creatorType: 'User'
        },
        iconName: 'Animation'
      }))
    };

    // Populate explorer with imported assets
    this.populateExplorerWithAssets(importedAssets);
    this.addDebugLine(`[Imported] ${ids.length} asset(s) loaded into explorer`, 'info');
  }

  /**
   * Toggle debug terminal visibility
   */
  toggleDebugTerminal(show) {
    const terminal = document.getElementById('debug-terminal');
    if (terminal) {
      terminal.style.display = show ? 'flex' : 'none';
    }
  }

  /**
   * Add a line to debug output
   */
  addDebugLine(message, type = 'info') {
    const output = document.getElementById('debug-output');
    if (!output) return;

    // Only log to console if DEVELOPER_MODE is explicitly enabled, not for all debug lines
    const shouldLogToConsole = type === 'error' || type === 'warn' || window.DEVELOPER_MODE;
    if (shouldLogToConsole) {
      const prefix = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : type === 'success' ? '✓' : 'ℹ️';
      console.log(`${prefix} ${message}`);
    }

    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `debug-line ${type}`;
    line.innerHTML = `<span class="debug-timestamp">[${timestamp}]</span>${this.escapeHtml(message)}`;
    
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  /**
   * Clear debug output
   */
  clearDebugOutput() {
    const output = document.getElementById('debug-output');
    if (output) {
      output.innerHTML = '';
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Override console methods to capture output
   */
  overrideConsole() {
    if (this._originalConsole) return; // Already overridden

    this._originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
    };

    const self = this;

    console.log = function(...args) {
      self._originalConsole.log.apply(console, args);
      if (self.debugMode) {
        self.addDebugLine(args.join(' '), 'info');
      }
    };

    console.warn = function(...args) {
      self._originalConsole.warn.apply(console, args);
      if (self.debugMode) {
        self.addDebugLine(args.join(' '), 'warn');
      }
    };

    console.error = function(...args) {
      self._originalConsole.error.apply(console, args);
      if (self.debugMode) {
        self.addDebugLine(args.join(' '), 'error');
      }
    };

    console.info = function(...args) {
      self._originalConsole.info.apply(console, args);
      if (self.debugMode) {
        self.addDebugLine(args.join(' '), 'success');
      }
    };
  }

  /**
   * Restore original console methods
   */
  restoreConsole() {
    if (!this._originalConsole) return;

    console.log = this._originalConsole.log;
    console.warn = this._originalConsole.warn;
    console.error = this._originalConsole.error;
    console.info = this._originalConsole.info;

    this._originalConsole = null;
  }

  /**
   * Setup Asset Explorer UI: splitter, filters, refresh
   */
  setupAssetExplorer() {
    const splitter = document.getElementById('asset-splitter');
    const assetPanel = document.getElementById('asset-explorer');
    const expandTab = document.getElementById('asset-expand-tab');
    const collapseBtn = document.getElementById('asset-collapse-btn');
    const refreshBtn = document.getElementById('asset-refresh-btn');
    const assetsOnlyToggle = document.getElementById('assets-only-toggle-input');
    const explorerTree = document.getElementById('explorer-tree');
    this._assetProgressEl = document.getElementById('asset-progress');
    this._assetsOnlyMode = false;

    if (!splitter || !assetPanel) return;

    // Splitter resize
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    splitter.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = assetPanel.clientWidth;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const deltaX = startX - e.clientX;
      let newWidth = startWidth + deltaX;
      newWidth = Math.max(260, Math.min(600, newWidth));
      assetPanel.style.width = newWidth + 'px';
      try { localStorage.setItem('assetPanelWidth', String(newWidth)); } catch {}
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
    });

    // Collapse / expand
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => this.collapseAssetPanel());
    }
    if (expandTab) {
      expandTab.addEventListener('click', () => this.expandAssetPanel());
    }

    // Assets Only Toggle
    if (assetsOnlyToggle) {
      assetsOnlyToggle.addEventListener('change', (e) => {
        this._assetsOnlyMode = e.target.checked;
        this._filterExplorerTree();
      });
    }

    // Refresh button: fetch assets based on spoof selections
    if (refreshBtn) {
      this._refreshBtn = refreshBtn;
      refreshBtn.addEventListener('click', async () => {
        await this.loadServerAssets();
      });
    }

    // Build default explorer tree
    if (explorerTree) {
      this._explorerTree = explorerTree;
      this.buildExplorerTree();
    }

    // Save for later use
    this._assetPanel = assetPanel;
    this._expandTab = expandTab;
  }

  /**
   * Get the scan timeout from settings (in seconds)
   */
  _getScanTimeout() {
    const input = document.getElementById('scan-timeout');
    if (input && input.value) {
      const value = parseInt(input.value, 10);
      if (value >= 5 && value <= 120) {
        return value;
      }
    }
    return 20; // Default 20 seconds
  }

  async loadServerAssets() {
    if (!window.electronAPI?.fetchServerSounds && !window.electronAPI?.fetchServerAnimations && !window.electronAPI?.fetchServerImages) return;
    
    // Prevent multiple simultaneous loads
    if (this.isLoadingAssets) {
      this.addDebugLine('Asset scan already in progress, please wait...', 'warn');
      return;
    }
    this.isLoadingAssets = true;
    if (this._refreshBtn) this._refreshBtn.disabled = true;
    
    const assets = {};
    let hasAudio = false;
    let hasAnimation = false;
    let hasImages = false;

    // Check spoof selections
    const audioEnabled = document.getElementById('spoof-audio')?.checked;
    const animationEnabled = document.getElementById('spoof-animation')?.checked;
    const imagesEnabled = document.getElementById('spoof-images')?.checked;

    this._setAssetProgress('Requesting...', true);
    this.addDebugLine('Loading assets from Roblox dump...', 'info');

    try {
      // Fetch sounds if Audio is enabled
      if (audioEnabled && window.electronAPI?.requestSoundDump && window.electronAPI?.fetchServerSounds) {
        this.addDebugLine('Requesting sounds from Roblox...', 'info');
        this._setAssetProgress('Scanning sounds...', true);
        await window.electronAPI.requestSoundDump();
        
        // Poll until data arrives or timeout (check every 100ms for faster response)
        let attempts = 0;
        const scanTimeout = this._getScanTimeout();
        const maxAttempts = scanTimeout * 10; // Convert seconds to 100ms intervals
        const startTime = Date.now();
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const soundResp = await window.electronAPI.fetchServerSounds();
          
          if (soundResp?.ok && soundResp.result?.complete) {
            const sounds = soundResp.result.assets;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            if (Array.isArray(sounds) && sounds.length > 0) {
              assets.Sounds = sounds;
              hasAudio = true;
              this.addDebugLine(`✓ Loaded ${sounds.length} sounds in ${elapsed}s`, 'success');
            } else {
              this.addDebugLine('Scan complete but no sounds found', 'warn');
            }
            break;
          }
          
          if (soundResp?.ok && soundResp.result?.scanning && attempts % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const eta = attempts > 0 ? ((elapsed / attempts) * (maxAttempts - attempts) / 10).toFixed(0) : '?';
            this._setAssetProgress(`Scanning sounds... ${soundResp.result.assets.length} found`, true);
            this.addDebugLine(`Scanning sounds... (${soundResp.result.assets.length} found, ${elapsed}s elapsed, ~${eta}s remaining)`, 'info');
          }
          attempts++;
        }
        
        if (attempts >= maxAttempts) {
          this.addDebugLine(`Sound scan timed out after ${scanTimeout}s`, 'warn');
        }
      }

      // Fetch animations if Animation is enabled
      if (animationEnabled && window.electronAPI?.requestAnimationDump && window.electronAPI?.fetchServerAnimations) {
        this.addDebugLine('Requesting animations from Roblox...', 'info');
        this._setAssetProgress('Scanning animations...', true);
        await window.electronAPI.requestAnimationDump();
        
        // Poll until data arrives or timeout (check every 100ms for faster response)
        let attempts = 0;
        const scanTimeout = this._getScanTimeout();
        const maxAttempts = scanTimeout * 10; // Convert seconds to 100ms intervals
        const startTime = Date.now();
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const animResp = await window.electronAPI.fetchServerAnimations();
          
          if (animResp?.ok && animResp.result?.complete) {
            const animations = animResp.result.assets;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            if (Array.isArray(animations) && animations.length > 0) {
              assets.Animations = animations;
              hasAnimation = true;
              this.addDebugLine(`✓ Loaded ${animations.length} animations in ${elapsed}s`, 'success');
            } else {
              this.addDebugLine('Scan complete but no animations found', 'warn');
            }
            break;
          }
          
          if (animResp?.ok && animResp.result?.scanning && attempts % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const eta = attempts > 0 ? ((elapsed / attempts) * (maxAttempts - attempts) / 10).toFixed(0) : '?';
            this._setAssetProgress(`Scanning animations... ${animResp.result.assets.length} found`, true);
            this.addDebugLine(`Scanning animations... (${animResp.result.assets.length} found, ${elapsed}s elapsed, ~${eta}s remaining)`, 'info');
          }
          attempts++;
        }
        
        if (attempts >= maxAttempts) {
          this.addDebugLine(`Animation scan timed out after ${scanTimeout}s`, 'warn');
        }
      }

      // Fetch images if Images is enabled
      if (imagesEnabled && window.electronAPI?.requestImageDump && window.electronAPI?.fetchServerImages) {
        this.addDebugLine('Requesting images from Roblox...', 'info');
        this._setAssetProgress('Scanning images...', true);
        await window.electronAPI.requestImageDump();
        
        // Poll until data arrives or timeout (check every 100ms for faster response)
        let attempts = 0;
        const scanTimeout = this._getScanTimeout();
        const maxAttempts = scanTimeout * 10; // Convert seconds to 100ms intervals
        const startTime = Date.now();
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const imageResp = await window.electronAPI.fetchServerImages();
          
          if (imageResp?.ok && imageResp.result?.complete) {
            const images = imageResp.result.assets;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            if (Array.isArray(images) && images.length > 0) {
              assets.Images = images;
              hasImages = true;
              this.addDebugLine(`✓ Loaded ${images.length} images in ${elapsed}s`, 'success');
            } else {
              this.addDebugLine('Scan complete but no images found', 'warn');
            }
            break;
          }
          
          if (imageResp?.ok && imageResp.result?.scanning && attempts % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const eta = attempts > 0 ? ((elapsed / attempts) * (maxAttempts - attempts) / 10).toFixed(0) : '?';
            this._setAssetProgress(`Scanning images... ${imageResp.result.assets.length} found`, true);
            this.addDebugLine(`Scanning images... (${imageResp.result.assets.length} found, ${elapsed}s elapsed, ~${eta}s remaining)`, 'info');
          }
          attempts++;
        }
        
        if (attempts >= maxAttempts) {
          this.addDebugLine(`Image scan timed out after ${scanTimeout}s`, 'warn');
        }
      }

      if (!hasAudio && !hasAnimation && !hasImages) {
        this._setAssetProgress('No data', false);
        this.addDebugLine('No sounds, animations, or images selected or received', 'warn');
        this.isLoadingAssets = false;
        if (this._refreshBtn) this._refreshBtn.disabled = false;
        return;
      }

      this.populateExplorerWithAssets(assets);
      this._setAssetProgress('Done', false);
    } catch (err) {
      this._setAssetProgress('Error', false);
      this.addDebugLine(`Explorer exception: ${err.message}`, 'error');
    } finally {
      this.isLoadingAssets = false;
      if (this._refreshBtn) this._refreshBtn.disabled = false;
    }
  }

  _setAssetProgress(text, isActive) {
    if (!this._assetProgressEl) return;
    this._assetProgressEl.textContent = text;
    if (isActive) this._assetProgressEl.classList.add('active');
    else this._assetProgressEl.classList.remove('active');
  }

  populateExplorerWithAssets(assets) {
    // Base Roblox services
    const data = [
      { name: 'Workspace', children: [] },
      { name: 'Players', children: [] },
      { name: 'Lighting', children: [] },
      { name: 'ReplicatedStorage', children: [] },
      { name: 'ReplicatedFirst', children: [] },
      { name: 'StarterGui', children: [] },
      { name: 'StarterPack', children: [] },
      { name: 'StarterPlayer', children: [
        { name: 'StarterPlayerScripts', children: [] },
        { name: 'StarterCharacterScripts', children: [] },
      ]},
      { name: 'ServerScriptService', children: [] },
      { name: 'ServerStorage', children: [] },
      { name: 'SoundService', children: [] },
      { name: 'Chat', children: [] },
      { name: 'LocalizationService', children: [] },
      { name: 'TestService', children: [] },
      { name: 'Teams', children: [] },
    ];

    const iconHints = {
      // Services
      Workspace: 'Workspace', Players: 'Players', Lighting: 'Lighting',
      ReplicatedStorage: 'ReplicatedStorage', ReplicatedFirst: 'ReplicatedFirst',
      StarterGui: 'StarterGui', StarterPack: 'StarterPack', StarterPlayer: 'StarterPlayer',
      StarterPlayerScripts: 'StarterPlayerScripts', StarterCharacterScripts: 'StarterCharacterScripts',
      ServerScriptService: 'ServerScriptService', ServerStorage: 'ServerStorage',
      SoundService: 'SoundService', Chat: 'Chat', LocalizationService: 'LocalizationService',
      TestService: 'TestService', Teams: 'Teams',
      // Assets & Common Types
      Script: 'Script', LocalScript: 'LocalScript', ModuleScript: 'ModuleScript',
      Folder: 'Folder', Model: 'Model', Tool: 'Tool', Part: 'Part', MeshPart: 'MeshPart',
      Animation: 'Animation', Sound: 'Sound', 
      Humanoid: 'Humanoid', Animator: 'Animator', Camera: 'Camera',
      // Folders
      Sounds: 'Sound', Animations: 'Animation', Assets: 'Folder', Models: 'Model',
      Imported: 'Folder',
      // Values
      StringValue: 'Value', IntValue: 'Value', BoolValue: 'BoolValue', 
      ObjectValue: 'Value', NumberValue: 'Value',
      // UI
      ScreenGui: 'ScreenGui', Frame: 'Frame', TextLabel: 'TextLabel', 
      TextButton: 'TextButton', ImageLabel: 'ImageLabel',
      // Misc
      RemoteEvent: 'RemoteEvent', RemoteFunction: 'RemoteFunction',
      BindableEvent: 'BindableEvent', BindableFunction: 'BindableFunction',
      Configuration: 'Configuration', Attachment: 'Attachment'
    };

    const findOrCreate = (list, name, iconName) => {
      let node = list.find(n => n.name === name);
      if (!node) {
        node = { name, children: [], iconName: iconName || name };
        list.push(node);
      }
      return node;
    };

    const ensurePath = (segments) => {
      let currentList = data;
      let node = { children: data };
      segments.forEach(seg => {
        node = findOrCreate(currentList, seg, iconHints[seg] || seg);
        currentList = node.children;
      });
      return node;
    };

    // Sounds placed by location; script references nest under their script node
    if (Array.isArray(assets.Sounds)) {
      assets.Sounds.forEach(sound => {
        const fullPath = (sound.script || sound.fullName || '').split('.').filter(Boolean);
        if (fullPath.length === 0) {
          // fallback to assets root
          const assetsRoot = findOrCreate(data, 'Assets', 'Folder');
          const soundFolder = findOrCreate(assetsRoot.children, 'Sounds', 'Sound');
          soundFolder.children.push({
            name: sound.assetName || `Sound ${sound.assetId}`,
            assetId: sound.assetId,
            assetType: 'Sound',
            kind: sound.kind,
            creator: sound.creator,
            fullInfo: sound,
            iconName: 'Sound'
          });
          return;
        }

        // Parent path is everything except the leaf name
        const parentPath = fullPath.slice(0, -1);
        const leafName = fullPath[fullPath.length - 1];

        const parentNode = ensurePath(parentPath);
        if (!parentNode.children) parentNode.children = [];

        // If this is a script reference, ensure the script node exists and attach under it
        let scriptNode = parentNode;
        if (sound.kind === 'ScriptReference') {
          scriptNode = findOrCreate(parentNode.children, leafName, 'Script');
        }

        const targetChildren = scriptNode.children || (scriptNode.children = []);
        targetChildren.push({
          name: sound.assetName || `Sound ${sound.assetId}`,
          assetId: sound.assetId,
          assetType: 'Sound',
          kind: sound.kind,
          creator: sound.creator,
          fullInfo: sound,
          iconName: 'Sound'
        });
      });
    }

    // Animations placed by location; script references nest under their script node
    if (Array.isArray(assets.Animations)) {
      assets.Animations.forEach(anim => {
        const fullPath = (anim.script || anim.fullName || '').split('.').filter(Boolean);
        if (fullPath.length === 0) {
          // fallback to assets root
          const assetsRoot = findOrCreate(data, 'Assets', 'Folder');
          const animFolder = findOrCreate(assetsRoot.children, 'Animations', 'Animation');
          animFolder.children.push({
            name: anim.assetName || `Animation ${anim.assetId}`,
            assetId: anim.assetId,
            assetType: 'Animation',
            kind: anim.kind,
            creator: anim.creator,
            fullInfo: anim,
            iconName: 'Animation'
          });
          return;
        }

        // Parent path is everything except the leaf name
        const parentPath = fullPath.slice(0, -1);
        const leafName = fullPath[fullPath.length - 1];

        const parentNode = ensurePath(parentPath);
        if (!parentNode.children) parentNode.children = [];

        // If this is a script reference, ensure the script node exists and attach under it
        let scriptNode = parentNode;
        if (anim.kind === 'ScriptReference') {
          scriptNode = findOrCreate(parentNode.children, leafName, 'Script');
        }

        const targetChildren = scriptNode.children || (scriptNode.children = []);
        targetChildren.push({
          name: anim.assetName || `Animation ${anim.assetId}`,
          assetId: anim.assetId,
          assetType: 'Animation',
          kind: anim.kind,
          creator: anim.creator,
          fullInfo: anim,
          iconName: 'Animation'
        });
      });
    }

    // Images placed by location; script references nest under their script node
    if (Array.isArray(assets.Images)) {
      assets.Images.forEach(img => {
        const fullPath = (img.script || img.fullName || '').split('.').filter(Boolean);
        if (fullPath.length === 0) {
          // fallback to assets root
          const assetsRoot = findOrCreate(data, 'Assets', 'Folder');
          const imgFolder = findOrCreate(assetsRoot.children, 'Images', 'Decal');
          imgFolder.children.push({
            name: img.assetName || `Image ${img.assetId}`,
            assetId: img.assetId,
            assetType: 'Image',
            kind: img.kind,
            creator: img.creator,
            fullInfo: img,
            iconName: 'Decal'
          });
          return;
        }

        // Parent path is everything except the leaf name
        const parentPath = fullPath.slice(0, -1);
        const leafName = fullPath[fullPath.length - 1];

        const parentNode = ensurePath(parentPath);
        if (!parentNode.children) parentNode.children = [];

        // If this is a script reference, ensure the script node exists and attach under it
        let scriptNode = parentNode;
        if (img.kind === 'ScriptReference') {
          scriptNode = findOrCreate(parentNode.children, leafName, 'Script');
        }

        const targetChildren = scriptNode.children || (scriptNode.children = []);
        targetChildren.push({
          name: img.assetName || `Image ${img.assetId}`,
          assetId: img.assetId,
          assetType: 'Image',
          kind: img.kind,
          creator: img.creator,
          fullInfo: img,
          iconName: 'Decal'
        });
      });
    }

    // Handle manually imported assets
    if (Array.isArray(assets.Imported)) {
      // Create imported folder at the top of the tree
      const importedFolder = {
        name: 'Imported',
        iconName: 'Folder',
        children: assets.Imported.map(asset => ({
          name: asset.name || `Asset ${asset.assetId}`,
          assetId: asset.assetId,
          assetType: asset.assetType || 'Animation',
          kind: asset.kind || 'Manual',
          creator: asset.creator || 'Manual Import',
          fullInfo: asset.fullInfo || asset,
          iconName: asset.iconName || 'Animation'
        }))
      };
      // Insert at the beginning of the tree
      data.unshift(importedFolder);
    }

    this._explorerTree.innerHTML = '';
    data.forEach(node => {
      this._explorerTree.appendChild(this._createTreeNode(node));
    });

    // After building the tree, default-select all assets and update the ID box
    this._updateIdBoxFromTree();
    
    // Reapply assets-only filter if it was active
    if (this._assetsOnlyMode) {
      this._filterExplorerTree();
    }
  }

  collapseAssetPanel() {
    if (!this._assetPanel || !this._expandTab) return;
    const currentWidth = this._assetPanel.clientWidth;
    try { localStorage.setItem('assetPanelWidth', String(currentWidth)); } catch {}
    this._assetPanel.style.display = 'none';
    this._expandTab.style.display = 'flex';
  }

  expandAssetPanel() {
    if (!this._assetPanel || !this._expandTab) return;
    const saved = parseInt(localStorage.getItem('assetPanelWidth') || '360', 10);
    this._assetPanel.style.display = 'flex';
    this._assetPanel.style.width = Math.max(260, Math.min(600, saved)) + 'px';
    this._expandTab.style.display = 'none';
  }

  buildExplorerTree() {
    const data = [
      { name: 'Workspace', children: [] },
      { name: 'Players', children: [] },
      { name: 'Lighting', children: [] },
      { name: 'ReplicatedStorage', children: [] },
      { name: 'ReplicatedFirst', children: [] },
      { name: 'StarterGui', children: [] },
      { name: 'StarterPack', children: [] },
      { name: 'StarterPlayer', children: [
        { name: 'StarterPlayerScripts', children: [] },
        { name: 'StarterCharacterScripts', children: [] },
      ]},
      { name: 'ServerScriptService', children: [] },
      { name: 'ServerStorage', children: [] },
      { name: 'SoundService', children: [] },
      { name: 'Chat', children: [] },
      { name: 'LocalizationService', children: [] },
      { name: 'TestService', children: [] },
      { name: 'Teams', children: [] },
    ];

    this._explorerTree.innerHTML = '';
    data.forEach(node => {
      this._explorerTree.appendChild(this._createTreeNode(node));
    });

    // Watch for theme changes to refresh icons
    if (!this._themeObserver) {
      this._themeObserver = new MutationObserver(() => {
        const newTheme = document.body.getAttribute('data-theme') || 'dark';
        if (newTheme !== this._currentTheme) {
          this._currentTheme = newTheme;
          this.buildExplorerTree();
        }
      });
      this._themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    }
  }

  _getIconPath(name) {
    const theme = document.body.getAttribute('data-theme') || 'dark';
    const iconName = name || 'Folder';
    const path = `assets/icons/${theme === 'light' ? 'Light' : 'Dark'}/Standard/${iconName}.png`;
    return path;
  }

  _createTreeNode(node) {
    const container = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'tree-node';
    const caret = document.createElement('span');
    caret.className = 'tree-caret';
    caret.textContent = node.children && node.children.length ? '▶' : '';
    const icon = document.createElement('img');
    icon.className = 'tree-icon';
    const iconName = node.iconName || node.name || 'Folder';
    icon.src = this._getIconPath(iconName);
    icon.alt = node.name;
    // Fallback if icon doesn't exist
    icon.onerror = () => {
      icon.onerror = null;
      icon.src = this._getIconPath('Folder');
    };
    const label = document.createElement('span');
    label.className = 'tree-label';
    // Add asset count for nodes with children (count only spoofable assets)
    if (node.children && node.children.length > 0) {
      const assetCount = this._countAssets(node);
      if (assetCount > 0) {
        label.textContent = `${node.name} (${assetCount})`;
      } else {
        label.textContent = node.name;
      }
    } else {
      label.textContent = node.name;
    }
    row.appendChild(caret);
    row.appendChild(icon);
    row.appendChild(label);

    // Add checkbox for both folders and leaf nodes
    const isFolder = node.children && node.children.length > 0;
    const isAsset = node.assetId;

    if (isFolder || isAsset) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = isFolder ? 'folder-checkbox' : 'asset-checkbox';
      cb.checked = true;
      
      if (isFolder) {
        cb.title = `Toggle all in ${node.name}`;
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          this._toggleFolderChildren(container, cb.checked);
          this._updateFolderCheckboxState(container);
          this._updateIdBoxFromTree();
        });
      } else {
        cb.title = `Include ${node.assetType || 'Asset'} ${node.assetId}`;
        cb.dataset.assetId = String(node.assetId);
        if (node.assetType) cb.dataset.assetType = String(node.assetType);
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          // Update parent folder checkbox state
          let parent = container.parentElement?.closest('.tree-node');
          while (parent) {
            this._updateFolderCheckboxState(parent.parentElement);
            parent = parent.parentElement?.closest('.tree-node');
          }
          this._updateIdBoxFromTree();
        });
      }
      
      // Prevent row click when toggling checkbox
      cb.addEventListener('click', (e) => e.stopPropagation());
      row.appendChild(cb);
    }

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';
    childrenContainer.style.display = 'none';

    if (isFolder) {
      row.addEventListener('click', () => {
        const open = childrenContainer.style.display === 'block';
        childrenContainer.style.display = open ? 'none' : 'block';
        caret.textContent = open ? '▶' : '▼';
      });
    } else {
      row.addEventListener('click', () => {
        // Selection highlight for leaf
        this._clearTreeSelection();
        row.classList.add('selected');
        this.addDebugLine(`Selected ${node.name}`, 'info');
      });

      // Right-click context menu for assets
      if (node.assetId) {
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Pass the container and row to the node for later use
          node.element = row;
          node.container = container;
          this._showAssetContextMenu(e, node);
        });
      }
    }

    // Render children
    (node.children || []).forEach(child => {
      childrenContainer.appendChild(this._createTreeNode(child));
    });

    container.appendChild(row);
    container.appendChild(childrenContainer);
    return container;
  }

  // Recursively toggle all leaf checkboxes in a folder
  _toggleFolderChildren(container, isChecked) {
    const checkboxes = container.querySelectorAll('input.asset-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = isChecked;
    });
  }

  // Update folder checkbox state based on children
  _updateFolderCheckboxState(container) {
    const folderCheckbox = container.querySelector('input.folder-checkbox');
    if (!folderCheckbox) return;

    const childCheckboxes = container.querySelectorAll(':scope > .tree-children input.asset-checkbox');
    if (childCheckboxes.length === 0) return;

    const checkedCount = Array.from(childCheckboxes).filter(cb => cb.checked).length;
    const totalCount = childCheckboxes.length;

    if (checkedCount === totalCount) {
      folderCheckbox.checked = true;
      folderCheckbox.indeterminate = false;
    } else if (checkedCount === 0) {
      folderCheckbox.checked = false;
      folderCheckbox.indeterminate = false;
    } else {
      folderCheckbox.checked = false;
      folderCheckbox.indeterminate = true;
    }
  }

  _clearTreeSelection() {
    if (!this._explorerTree) return;
    this._explorerTree.querySelectorAll('.tree-node.selected')
      .forEach(el => el.classList.remove('selected'));
  }

  // Collect all checked asset checkboxes and populate the ID textarea
  _updateIdBoxFromTree() {
    // Skip if we're currently updating from manual input
    if (this._updatingFromManualInput) return;
    
    const ids = [];
    if (this._explorerTree) {
      this._explorerTree.querySelectorAll('input.asset-checkbox:checked')
        .forEach((cb) => {
          const id = cb.getAttribute('data-asset-id') || cb.dataset.assetId;
          if (id) ids.push(id);
        });
    }
    const idBox = document.getElementById('animationId');
    if (idBox) {
      idBox.value = ids.join('\n');
    }
  }

  _countAssets(node) {
    // Count only leaf nodes that are spoofable assets (have assetId or assetType)
    if (!node.children || node.children.length === 0) {
      return (node.assetId || node.assetType) ? 1 : 0;
    }
    let count = 0;
    node.children.forEach(child => {
      count += this._countAssets(child);
    });
    return count;
  }

  /**
   * Filter explorer tree to show only assets when in assets-only mode
   */
  _filterExplorerTree() {
    if (!this._explorerTree) return;

    if (this._assetsOnlyMode) {
      // Hide all nodes and children first
      this._explorerTree.querySelectorAll('.tree-node').forEach(node => {
        node.style.display = 'none';
      });
      this._explorerTree.querySelectorAll('.tree-children').forEach(child => {
        child.style.display = 'none';
      });

      // Show only asset nodes and their parent containers
      this._explorerTree.querySelectorAll('input.asset-checkbox').forEach((checkbox) => {
        const treeNode = checkbox.closest('.tree-node');
        if (treeNode) {
          // Show the asset node itself
          treeNode.style.display = 'flex';
          treeNode.style.marginLeft = '0px';
          
          // Hide the caret for flat appearance
          const caret = treeNode.querySelector('.tree-caret');
          if (caret) {
            caret.style.visibility = 'hidden';
            caret.style.width = '0px';
          }
          
          // Show all parent tree-children containers in the path
          let parent = treeNode.parentElement;
          while (parent) {
            if (parent.classList.contains('tree-children')) {
              parent.style.display = '';
            }
            parent = parent.parentElement;
          }
        }
      });
    } else {
      // Restore normal view
      this._explorerTree.querySelectorAll('.tree-node').forEach(node => {
        node.style.display = '';
        node.style.marginLeft = '';
      });

      this._explorerTree.querySelectorAll('.tree-children').forEach(child => {
        child.style.display = 'none'; // Keep collapsed by default
      });

      // Restore carets
      this._explorerTree.querySelectorAll('.tree-caret').forEach(caret => {
        caret.style.visibility = '';
        caret.style.width = '';
      });
    }
  }

  /**
   * Check if a tree node contains any assets in its subtree
   */
  _nodeContainsAssets(node) {
    const childrenContainer = node.querySelector('.tree-children');
    if (!childrenContainer) return false;

    const assetCheckboxes = childrenContainer.querySelectorAll('input.asset-checkbox');
    return assetCheckboxes.length > 0;
  }

  /**
   * Show context menu for asset right-click
   */
  _showAssetContextMenu(event, node) {
    // Remove any existing context menu
    this._hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'asset-context-menu';

    const locateInTreeItem = document.createElement('div');
    locateInTreeItem.className = 'context-menu-item';
    locateInTreeItem.textContent = '📍 Locate in Tree';
    locateInTreeItem.addEventListener('click', () => {
      this._locateAssetInTree(node);
      this._hideContextMenu();
    });

    const copyIdItem = document.createElement('div');
    copyIdItem.className = 'context-menu-item';
    copyIdItem.textContent = '📋 Copy Asset ID';
    copyIdItem.addEventListener('click', () => {
      navigator.clipboard.writeText(String(node.assetId));
      this.addDebugLine(`Copied ID ${node.assetId}`, 'success');
      this._hideContextMenu();
    });

    menu.appendChild(locateInTreeItem);

    // Add "Play Sound" option for sound assets (only if enabled in settings)
    if (node.assetType === 'Sound') {
      const enableSoundPlayback = document.getElementById('enable-sound-playback')?.checked ?? true;
      
      if (enableSoundPlayback) {
        const playSoundItem = document.createElement('div');
        playSoundItem.className = 'context-menu-item';
        playSoundItem.textContent = '🔊 Play Sound';
        playSoundItem.addEventListener('click', () => {
          this._playSound(node);
          this._hideContextMenu();
        });
        menu.appendChild(playSoundItem);
      }
    }

    // Add "Preview Image" option for image assets
    if (node.assetType === 'Image') {
      const previewImageItem = document.createElement('div');
      previewImageItem.className = 'context-menu-item';
      previewImageItem.textContent = '🖼️ Preview Image';
      previewImageItem.addEventListener('click', () => {
        this._previewImage(node);
        this._hideContextMenu();
      });
      menu.appendChild(previewImageItem);
    }

    menu.appendChild(copyIdItem);

    document.body.appendChild(menu);

    // Position menu at cursor
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';

    // Close menu when clicking elsewhere
    document.addEventListener('click', () => this._hideContextMenu(), { once: true });
  }

  /**
   * Hide context menu
   */
  _hideContextMenu() {
    const menu = document.getElementById('asset-context-menu');
    if (menu) {
      menu.remove();
    }
  }

  /**
   * Play sound asset from Roblox
   */
  _playSound(node) {
    if (!node.assetId) {
      this.addDebugLine('Cannot play sound - no asset ID', 'warn');
      return;
    }

    // Check if user/cookie is selected
    if (!this._hasCookieSelected()) {
      this._showCookieRequiredModal('play sounds');
      return;
    }

    if (!window.electronAPI?.playSound) {
      this.addDebugLine('Cannot play sound - API not available', 'warn');
      return;
    }

    try {
      this.addDebugLine(`Downloading and playing ${node.name}...`, 'info');
      window.electronAPI.playSound(String(node.assetId));
    } catch (err) {
      this.addDebugLine(`Failed to play sound: ${err.message}`, 'error');
    }
  }

  /**
   * Preview image asset in modal
   */
  _previewImage(node) {
    if (!node.assetId) {
      this.addDebugLine('Cannot preview image - no asset ID', 'warn');
      return;
    }

    // Check if user/cookie is selected
    const hasCookie = this._hasCookieSelected();
    this.addDebugLine(`[Image Preview] Checking cookie: hasCookie=${hasCookie}`, 'info');
    
    if (!hasCookie) {
      const cookieInput = document.getElementById('roblox-cookie');
      const cookieValue = cookieInput?.value || '';
      this.addDebugLine(`[Image Preview] ✗ No cookie found. Cookie input value length: ${cookieValue.length}`, 'warn');
      this._showCookieRequiredModal('preview images');
      return;
    }

    this.addDebugLine(`[Image Preview] ✓ Cookie verified. Opening preview for: ${node.name} (ID: ${node.assetId})`, 'info');

    // Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'image-preview-modal';
    modal.id = 'image-preview-modal';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'image-preview-content';

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'image-preview-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      modal.remove();
      this.addDebugLine(`[Image Preview] Closed preview for: ${node.name}`, 'info');
    });

    // Create image title
    const imageTitle = document.createElement('div');
    imageTitle.className = 'image-preview-title';
    imageTitle.textContent = node.name || `Image ${node.assetId}`;

    // Create image container
    const imgContainer = document.createElement('div');
    imgContainer.className = 'image-preview-img-container';

    // Create loading indicator
    const loadingText = document.createElement('div');
    loadingText.className = 'image-preview-loading';
    loadingText.textContent = 'Loading image...';
    imgContainer.appendChild(loadingText);

    // Create image element
    const img = document.createElement('img');
    img.className = 'image-preview-img';
    img.alt = node.name || 'Asset Image';
    
    // Use direct asset delivery endpoint for the actual image
    const assetDeliveryUrl = `https://assetdelivery.roblox.com/v1/asset/?id=${node.assetId}`;
    
    this.addDebugLine(`[Image Preview] Fetching image from asset delivery for asset ${node.assetId}`, 'info');
    console.log(`[Image Preview] Asset delivery URL: ${assetDeliveryUrl}`);
    
    // Fetch the actual image directly
    fetch(assetDeliveryUrl)
      .then(response => {
        console.log(`[Image Preview] Asset delivery response status: ${response.status}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Failed to fetch asset`);
        }
        return response.blob();
      })
      .then(blob => {
        console.log(`[Image Preview] Received blob. Type: ${blob.type}, Size: ${blob.size} bytes`);
        // Convert blob to data URL for display
        const objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
        this.addDebugLine(`[Image Preview] Image blob created successfully (${(blob.size / 1024).toFixed(2)} KB)`, 'info');
      })
      .catch(err => {
        loadingText.textContent = 'Failed to load image';
        loadingText.style.color = 'var(--red-accent)';
        this.addDebugLine(`[Image Preview] ✗ Failed to fetch image (ID: ${node.assetId})`, 'error');
        this.addDebugLine(`[Image Preview] Error: ${err.message}`, 'error');
        console.error(`[Image Preview] Fetch error:`, err);
      });
    
    img.onload = () => {
      loadingText.remove();
      this.addDebugLine(`[Image Preview] ✓ Successfully loaded: ${node.name} (${img.naturalWidth}x${img.naturalHeight}px)`, 'success');
    };
    
    img.onerror = () => {
      loadingText.textContent = 'Failed to load image';
      loadingText.style.color = 'var(--red-accent)';
      this.addDebugLine(`[Image Preview] ✗ Image failed to render`, 'error');
      console.error(`[Image Preview] Image element error`);
    };
    
    imgContainer.appendChild(img);

    // Create asset ID label
    const assetIdLabel = document.createElement('div');
    assetIdLabel.className = 'image-preview-asset-id';
    assetIdLabel.textContent = `Asset ID: ${node.assetId}`;

    // Assemble modal
    modalContent.appendChild(closeBtn);
    modalContent.appendChild(imageTitle);
    modalContent.appendChild(imgContainer);
    modalContent.appendChild(assetIdLabel);
    modal.appendChild(modalContent);

    // Close modal when clicking outside content
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        this.addDebugLine(`[Image Preview] Closed preview (clicked outside)`, 'info');
      }
    });

    // Add modal to body
    document.body.appendChild(modal);
  }

  /**
   * Locate asset in tree - disable assets-only mode and expand to show the asset
   */
  _locateAssetInTree(node) {
    try {
      // Turn off Assets Only mode to see the full tree
      const toggle = document.getElementById('assets-only-toggle-input');
      if (toggle && toggle.checked) {
        toggle.checked = false;
        this._assetsOnlyMode = false;
        this._filterExplorerTree();
      }

      // Expand all parent folders to show the asset in context
      let parent = node.element?.parentElement;
      while (parent) {
        if (parent.classList.contains('tree-children')) {
          parent.style.display = 'block';
          const parentNode = parent.parentElement?.querySelector('.tree-node');
          if (parentNode) {
            const caret = parentNode.querySelector('.tree-caret');
            if (caret) caret.textContent = '▼';
          }
        }
        parent = parent.parentElement;
      }

      // Highlight this asset node
      const assetNode = node.element;
      if (assetNode) {
        this._clearTreeSelection();
        assetNode.classList.add('selected');
      }

      this.addDebugLine(`Located ${node.name} in tree`, 'success');
    } catch (err) {
      this.addDebugLine(`Failed to locate in tree: ${err.message}`, 'error');
    }
  }

  /**
   * Show asset in file explorer (reveal in Windows Explorer)
   */
  _showAssetInExplorer(node) {
    if (!node.assetId || !window.electronAPI?.revealAsset) {
      this.addDebugLine('Cannot open asset in explorer - API not available', 'warn');
      return;
    }

    try {
      // Turn off Assets Only mode to see the full tree
      const toggle = document.getElementById('assets-only-toggle-input');
      if (toggle && toggle.checked) {
        toggle.checked = false;
        this._assetsOnlyMode = false;
        this._filterExplorerTree();
      }

      // Expand all parent folders to show the asset in context
      let parent = node.element?.parentElement;
      while (parent) {
        if (parent.classList.contains('tree-children')) {
          parent.style.display = 'block';
          const parentNode = parent.parentElement?.querySelector('.tree-node');
          if (parentNode) {
            const caret = parentNode.querySelector('.tree-caret');
            if (caret) caret.textContent = '▼';
          }
        }
        parent = parent.parentElement;
      }

      // Highlight this asset node
      const assetNode = node.element;
      if (assetNode) {
        this._clearTreeSelection();
        assetNode.classList.add('selected');
      }

      // Open in file explorer
      window.electronAPI.revealAsset(String(node.assetId), node.assetType || 'unknown');
      this.addDebugLine(`Opening ${node.name} (${node.assetId}) in explorer...`, 'info');
    } catch (err) {
      this.addDebugLine(`Failed to open in explorer: ${err.message}`, 'error');
    }
  }

  /**
   * Check if a cookie/user is selected
   */
  _hasCookieSelected() {
    const robloxCookieInput = document.getElementById('roblox-cookie');
    const hasCookie = robloxCookieInput && robloxCookieInput.value.trim() !== '';
    
    if (robloxCookieInput) {
      const cookieLength = robloxCookieInput.value.length;
      const cookieTrimmed = robloxCookieInput.value.trim().length;
      console.log(`[_hasCookieSelected] Cookie input found. Length: ${cookieLength}, Trimmed: ${cookieTrimmed}, Result: ${hasCookie}`);
    } else {
      console.log(`[_hasCookieSelected] Cookie input NOT found`);
    }
    
    // Check if manual cookie is entered
    if (hasCookie) {
      return true;
    }
    
    return false;
  }

  /**
   * Show modal requiring cookie selection
   */
  _showCookieRequiredModal(actionName) {
    // Remove any existing modal
    const existingModal = document.getElementById('cookie-required-modal');
    if (existingModal) existingModal.remove();

    // Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'image-preview-modal';
    modal.id = 'cookie-required-modal';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'image-preview-content';
    modalContent.style.maxWidth = '500px';

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'image-preview-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      modal.remove();
    });

    // Create title
    const title = document.createElement('div');
    title.className = 'image-preview-title';
    title.textContent = 'Cookie Required';
    title.style.color = 'var(--red-accent)';

    // Create message
    const message = document.createElement('div');
    message.style.color = 'var(--text-secondary)';
    message.style.fontSize = '14px';
    message.style.lineHeight = '1.6';
    message.style.padding = '20px 0';
    message.innerHTML = `
      <p style="margin: 0 0 15px 0;">To ${actionName}, you need to have a valid Roblox cookie configured.</p>
      <p style="margin: 0 0 10px 0;"><strong>Please do one of the following:</strong></p>
      <ul style="margin: 0; padding-left: 20px;">
        <li style="margin-bottom: 8px;">Select a user from the "Selected User" dropdown in the Spoofing tab</li>
        <li style="margin-bottom: 8px;">Enable auto-detection in Advanced Options</li>
        <li>Manually enter a Roblox cookie in the cookie input field</li>
      </ul>
    `;

    // Create OK button
    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = `
      background-color: var(--green-accent);
      color: white;
      border: none;
      padding: 10px 30px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s ease;
    `;
    okBtn.addEventListener('click', () => {
      modal.remove();
    });
    okBtn.addEventListener('mouseenter', () => {
      okBtn.style.backgroundColor = 'var(--green-accent-hover)';
    });
    okBtn.addEventListener('mouseleave', () => {
      okBtn.style.backgroundColor = 'var(--green-accent)';
    });

    // Assemble modal
    modalContent.appendChild(closeBtn);
    modalContent.appendChild(title);
    modalContent.appendChild(message);
    modalContent.appendChild(okBtn);
    modal.appendChild(modalContent);

    // Close modal when clicking outside content
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });

    // Add modal to body
    document.body.appendChild(modal);
    
    this.addDebugLine(`[Cookie Required] User attempted to ${actionName} without a cookie`, 'warn');
  }

  /**
   * Get all selected assets from the explorer tree
   */
  getSelectedAssets() {
    const selectedAssets = [];
    const checkedBoxes = this._explorerTree.querySelectorAll('input.asset-checkbox:checked');
    
    checkedBoxes.forEach(checkbox => {
      // Get asset data from checkbox dataset or _nodeData
      const assetId = checkbox.dataset.assetId || checkbox._nodeData?.assetId;
      const assetType = checkbox.dataset.assetType || checkbox._nodeData?.assetType;
      
      if (assetId && assetType) {
        selectedAssets.push({
          assetId: assetId,
          assetType: assetType,
          name: checkbox.title?.replace(/Include .*? /, '') || `Asset ${assetId}`,
          fullName: checkbox._nodeData?.fullInfo?.fullName || '',
          creator: checkbox._nodeData?.fullInfo?.creator || 'Unknown',
          creatorType: checkbox._nodeData?.fullInfo?.creatorType || 'User', // Default to User if not specified
        });
      }
    });
    
    console.log('[UIManager] getSelectedAssets() found:', selectedAssets.length, 'assets');
    return selectedAssets;
  }
}

// Initialize UI Manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    window.uiManager = new UIManager();
  } catch (e) {
    console.error('Failed to initialize UIManager:', e);
  }
});
