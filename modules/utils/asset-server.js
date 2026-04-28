// Asset Server - Hosts port 3100 for Roblox asset dumping
// Roblox studio script can POST assets here, and the app polls for them

const express = require('express');

const DEVELOPER_MODE = process.env.DEVELOPER_MODE === '1' || process.env.DEVELOPER_MODE === 'true';

function logDev(...args) {
  if (DEVELOPER_MODE) console.log('[asset-server]', ...args);
}

class AssetServer {
  constructor(port = 3100) {
    this.app = express();
    this.server = null;
    this.port = port;
    this.requestSounds = false;
    this.requestAnimations = false;
    this.requestImages = false;
    this.requestMeshes = false;
    this.requestScriptRefs = false;
    this.skipOwnedCheck = true; // skip assets already owned by place creator by default
    this.lastSounds = { assets: [], scanning: false, complete: false, timestamp: null };
    this.lastAnimations = { assets: [], scanning: false, complete: false, timestamp: null };
    this.lastImages = { assets: [], scanning: false, complete: false, timestamp: null };
    this.lastMeshes = { assets: [], scanning: false, complete: false, timestamp: null };
    this.lastScriptRefs = { assets: [], scanning: false, complete: false, timestamp: null };
    this.storedMappings = [];
    this.lastPluginPollTime = null; // Track when plugin last polled
    this._completionTimer = null; // Debounce timer for completion detection (new plugin)
  }

  // Called after every /assets-* POST (ms=2000) or on scan start (ms=15000).
  // Uses the shorter timer once any data arrives; the longer timer is a fallback
  // so empty scans (where the plugin sends nothing) still resolve.
  _scheduleCompletion(ms = 2000) {
    if (this._completionTimer) clearTimeout(this._completionTimer);
    this._completionTimer = setTimeout(() => {
      this._completionTimer = null;
      const complete = (store) => {
        if (store.scanning) {
          store.scanning = false;
          store.complete = true;
          console.log('[ASSET-SERVER] Auto-completing scan for store with', store.assets.length, 'assets');
        }
      };
      complete(this.lastSounds);
      complete(this.lastAnimations);
      complete(this.lastImages);
      complete(this.lastMeshes);
      complete(this.lastScriptRefs);
    }, ms);
  }

  setSkipOwnedCheck(enabled) {
    this.skipOwnedCheck = enabled !== false;
    logDev(`Skip-owned check set to ${this.skipOwnedCheck}`);
  }

  getSkipOwnedCheck() {
    return this.skipOwnedCheck !== false;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.app.use(express.json({ limit: '50mb' }));

      // ===== Unified Poll Endpoint (new plugin-optimized.lua) =====
      // Single poll: triggers a full multi-type scan when any dump has been requested.
      this.app.get('/poll', (req, res) => {
        this.lastPluginPollTime = Date.now();
        const requestAssets = this.requestSounds || this.requestAnimations || this.requestImages
          || this.requestMeshes || this.requestScriptRefs;
        if (requestAssets) {
          const now = Date.now();
          this.lastSounds     = { assets: [], scanning: true, complete: false, timestamp: now };
          this.lastAnimations = { assets: [], scanning: true, complete: false, timestamp: now };
          this.lastImages     = { assets: [], scanning: true, complete: false, timestamp: now };
          this.lastMeshes     = { assets: [], scanning: true, complete: false, timestamp: now };
          this.lastScriptRefs = { assets: [], scanning: true, complete: false, timestamp: now };
          this.requestSounds = false;
          this.requestAnimations = false;
          this.requestImages = false;
          this.requestMeshes = false;
          this.requestScriptRefs = false;
          console.log('[ASSET-SERVER] Unified /poll hit — full scan initiated');
          // Start a generous fallback timer so empty scans (plugin sends no POSTs)
          // still resolve. Any incoming POST will reset this to the normal 2s.
          this._scheduleCompletion(15000);
        }
        res.json({ requestAssets });
      });

      // ===== Sound Endpoints =====
      // Poll endpoint: Roblox script checks if sounds should be scanned
      this.app.get('/poll-sounds', (req, res) => {
        this.lastPluginPollTime = Date.now();
        const result = { requestAssets: this.requestSounds, skipOwnedCheck: this.getSkipOwnedCheck() };
        if (this.requestSounds) {
          this.lastSounds = { assets: [], scanning: true, complete: false, timestamp: Date.now() };
          console.log('[ASSET-SERVER] Sound scan initiated, cleared previous data');
        }
        this.requestSounds = false;
        res.json(result);
        logDev('Poll-sounds request, responding with requestAssets flag');
      });

      // Asset receive endpoint: Roblox POSTs sound data here
      this.app.post('/assets-sounds', (req, res) => {
        const batch = req.body;
        console.log('[ASSET-SERVER] Received sound batch:', batch.assetCount || 0, 'assets');
        if (batch.assets && Array.isArray(batch.assets)) {
          this.lastSounds.assets.push(...batch.assets);
          console.log('[ASSET-SERVER] Total sounds accumulated:', this.lastSounds.assets.length);
        }
        this._scheduleCompletion();
        res.send('ok');
      });

      // Completion signal: Roblox signals scan is done
      this.app.post('/sounds-complete', (req, res) => {
        this.lastSounds.scanning = false;
        this.lastSounds.complete = true;
        console.log('[ASSET-SERVER] Sound scan complete, total:', this.lastSounds.assets.length);
        res.send('ok');
      });

      // ===== Animation Endpoints =====
      // Poll endpoint: Roblox script checks if animations should be scanned
      this.app.get('/poll-animations', (req, res) => {
        this.lastPluginPollTime = Date.now();
        const result = { requestAssets: this.requestAnimations, skipOwnedCheck: this.getSkipOwnedCheck() };
        console.log('[ASSET-SERVER] Plugin polled /poll-animations - requestAssets:', result.requestAssets);
        if (this.requestAnimations) {
          this.lastAnimations = { assets: [], scanning: true, complete: false, timestamp: Date.now() };
          console.log('[ASSET-SERVER] ✓ Animation scan initiated, cleared previous data');
        }
        this.requestAnimations = false;
        res.json(result);
        logDev('Poll-animations request, responding with requestAssets flag');
      });

      // Asset receive endpoint: Roblox POSTs animation data here
      this.app.post('/assets-animations', (req, res) => {
        const batch = req.body;
        console.log('[ASSET-SERVER] Received animation batch:', batch.assetCount || 0, 'assets (scanning:', this.lastAnimations.scanning + ')');
        if (batch.assets && Array.isArray(batch.assets)) {
          this.lastAnimations.assets.push(...batch.assets);
          console.log('[ASSET-SERVER] Total animations accumulated:', this.lastAnimations.assets.length);
        }
        this._scheduleCompletion();
        res.send('ok');
      });

      // Completion signal: Roblox signals scan is done
      this.app.post('/animations-complete', (req, res) => {
        this.lastAnimations.scanning = false;
        this.lastAnimations.complete = true;
        console.log('[ASSET-SERVER] Animation scan complete, total:', this.lastAnimations.assets.length);
        res.send('ok');
      });

      // ===== Image Endpoints =====
      // Poll endpoint: Roblox script checks if images should be scanned
      this.app.get('/poll-images', (req, res) => {
        this.lastPluginPollTime = Date.now();
        const result = { requestAssets: this.requestImages, skipOwnedCheck: this.getSkipOwnedCheck() };
        if (this.requestImages) {
          this.lastImages = { assets: [], scanning: true, complete: false, timestamp: Date.now() };
          console.log('[ASSET-SERVER] Image scan initiated, cleared previous data');
        }
        this.requestImages = false;
        res.json(result);
        logDev('Poll-images request, responding with requestAssets flag');
      });

      // Asset receive endpoint: Roblox POSTs image data here
      this.app.post('/assets-images', (req, res) => {
        const batch = req.body;
        console.log('[ASSET-SERVER] Received image batch:', batch.assetCount || 0, 'assets');
        if (batch.assets && Array.isArray(batch.assets)) {
          this.lastImages.assets.push(...batch.assets);
          console.log('[ASSET-SERVER] Total images accumulated:', this.lastImages.assets.length);
        }
        this._scheduleCompletion();
        res.send('ok');
      });

      // Completion signal: Roblox signals scan is done
      this.app.post('/images-complete', (req, res) => {
        this.lastImages.scanning = false;
        this.lastImages.complete = true;
        console.log('[ASSET-SERVER] Image scan complete, total:', this.lastImages.assets.length);
        res.send('ok');
      });

      // ===== Mesh Endpoints (new plugin) =====
      this.app.post('/assets-meshes', (req, res) => {
        const batch = req.body;
        console.log('[ASSET-SERVER] Received mesh batch:', batch.assetCount || 0, 'assets');
        if (batch.assets && Array.isArray(batch.assets)) {
          this.lastMeshes.assets.push(...batch.assets);
          console.log('[ASSET-SERVER] Total meshes accumulated:', this.lastMeshes.assets.length);
        }
        this._scheduleCompletion();
        res.send('ok');
      });

      // ===== Script Reference Endpoints (new plugin) =====
      this.app.post('/assets-script-refs', (req, res) => {
        const batch = req.body;
        console.log('[ASSET-SERVER] Received script-ref batch:', batch.assetCount || 0, 'assets');
        if (batch.assets && Array.isArray(batch.assets)) {
          this.lastScriptRefs.assets.push(...batch.assets);
          console.log('[ASSET-SERVER] Total script-refs accumulated:', this.lastScriptRefs.assets.length);
        }
        this._scheduleCompletion();
        res.send('ok');
      });

      // ===== ID Replacement Endpoint =====
      // Poll endpoint: Plugin checks if there are replacements to do
      this.app.get('/poll-replacements', (req, res) => {
        const mappings = this.getStoredMappings();
        res.json({ mappings });
        if (mappings.length > 0) {
          console.log(`[ASSET-SERVER] Sent ${mappings.length} mappings to plugin for replacement`);
        }
      });

      // Receive ID replacement mappings and trigger plugin replacement
      this.app.post('/replace-ids', (req, res) => {
        const { mappings } = req.body;
        if (!mappings || !Array.isArray(mappings)) {
          return res.status(400).json({ ok: false, error: 'Invalid mappings' });
        }
        console.log(`[ASSET-SERVER] Received ${mappings.length} ID replacement mappings`);
        mappings.forEach(m => {
          console.log(`[ASSET-SERVER]   ${m.originalId} → ${m.newId} (${m.name} | ${m.type})`);
        });
        this.storedMappings = mappings;
        res.json({ ok: true, message: `Stored ${mappings.length} mappings for plugin replacement` });
      });

      // ===== End Endpoints =====

      // ===== Query Endpoints =====
      // Query endpoint: Backend fetches latest assets
      this.app.get('/last-sounds', (req, res) => {
        res.json(this.lastSounds || {});
        logDev('Sent last sounds to backend');
      });

      this.app.get('/last-animations', (req, res) => {
        res.json(this.lastAnimations || {});
        logDev('Sent last animations to backend');
      });

      this.app.get('/last-images', (req, res) => {
        res.json(this.lastImages || {});
        logDev('Sent last images to backend');
      });

      this.app.get('/last-meshes', (req, res) => {
        res.json(this.lastMeshes || {});
        logDev('Sent last meshes to backend');
      });

      this.app.get('/last-script-refs', (req, res) => {
        res.json(this.lastScriptRefs || {});
        logDev('Sent last script-refs to backend');
      });

      // ===== Request Endpoints =====
      // Trigger sound dump request
      this.app.post('/request-sounds', (req, res) => {
        this.requestSounds = true;
        logDev('Sound dump requested');
        res.send('sound request queued');
      });

      // Trigger animation dump request
      this.app.post('/request-animations', (req, res) => {
        this.requestAnimations = true;
        logDev('Animation dump requested');
        res.send('animation request queued');
      });

      // Trigger image dump request
      this.app.post('/request-images', (req, res) => {
        this.requestImages = true;
        logDev('Image dump requested');
        res.send('image request queued');
      });

      // Trigger mesh dump request
      this.app.post('/request-meshes', (req, res) => {
        this.requestMeshes = true;
        logDev('Mesh dump requested');
        res.send('mesh request queued');
      });

      // Trigger script-ref dump request
      this.app.post('/request-script-refs', (req, res) => {
        this.requestScriptRefs = true;
        logDev('Script-ref dump requested');
        res.send('script-ref request queued');
      });

      this.server = this.app.listen(this.port, () => {
        console.log(`[ASSET-SERVER] Asset server listening on localhost:${this.port}`);
        resolve();
      }).on('error', (err) => {
        console.warn('Asset server failed to start:', err.message);
        reject(err);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logDev('Asset server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getLastSounds() {
    // Check if data is stale (older than 60 seconds and not scanning)
    const now = Date.now();
    if (this.lastSounds.timestamp && !this.lastSounds.scanning && !this.lastSounds.complete) {
      const age = now - this.lastSounds.timestamp;
      if (age > 60000) {
        console.log('[ASSET-SERVER] Clearing stale sound data (age:', Math.round(age/1000), 'seconds)');
        this.lastSounds = { assets: [], scanning: false, complete: false, timestamp: null };
      }
    }

    // Deep copy to prevent race conditions
    const data = {
      assets: [...this.lastSounds.assets],
      scanning: this.lastSounds.scanning,
      complete: this.lastSounds.complete,
      timestamp: this.lastSounds.timestamp
    };
    if (this.lastSounds.complete) {
      this.lastSounds = { assets: [], scanning: false, complete: false, timestamp: null };
      console.log('[ASSET-SERVER] Returning', data.assets.length, 'sounds and resetting');
    }
    return data;
  }

  getLastAnimations() {
    // Check if data is stale (older than 60 seconds and not scanning)
    const now = Date.now();
    if (this.lastAnimations.timestamp && !this.lastAnimations.scanning && !this.lastAnimations.complete) {
      const age = now - this.lastAnimations.timestamp;
      if (age > 60000) {
        console.log('[ASSET-SERVER] Clearing stale animation data (age:', Math.round(age/1000), 'seconds)');
        this.lastAnimations = { assets: [], scanning: false, complete: false, timestamp: null };
      }
    }

    // Deep copy to prevent race conditions
    const data = {
      assets: [...this.lastAnimations.assets],
      scanning: this.lastAnimations.scanning,
      complete: this.lastAnimations.complete,
      timestamp: this.lastAnimations.timestamp
    };
    if (this.lastAnimations.complete) {
      this.lastAnimations = { assets: [], scanning: false, complete: false, timestamp: null };
      console.log('[ASSET-SERVER] Returning', data.assets.length, 'animations and resetting');
    }
    return data;
  }

  requestSoundDump() {
    // Clear any stale data immediately when a new scan is requested
    if (!this.lastSounds.scanning) {
      const hadOldData = this.lastSounds.assets.length > 0;
      this.lastSounds = { assets: [], scanning: false, complete: false, timestamp: null };
      if (hadOldData) {
        console.log('[ASSET-SERVER] Cleared stale sound data before new scan request');
      }
    }
    this.requestSounds = true;
    logDev('Sound dump request triggered');
  }

  requestAnimationDump() {
    // Clear any stale data immediately when a new scan is requested
    if (!this.lastAnimations.scanning) {
      const hadOldData = this.lastAnimations.assets.length > 0;
      this.lastAnimations = { assets: [], scanning: false, complete: false, timestamp: null };
      if (hadOldData) {
        console.log('[ASSET-SERVER] Cleared stale animation data before new scan request');
      }
    }
    this.requestAnimations = true;
    console.log('[ASSET-SERVER] ✓ Animation dump request triggered - waiting for plugin to poll');
    logDev('Animation dump request triggered');
  }

  getLastImages() {
    // Check if data is stale (older than 60 seconds and not scanning)
    const now = Date.now();
    if (this.lastImages.timestamp && !this.lastImages.scanning && !this.lastImages.complete) {
      const age = now - this.lastImages.timestamp;
      if (age > 60000) {
        console.log('[ASSET-SERVER] Clearing stale image data (age:', Math.round(age/1000), 'seconds)');
        this.lastImages = { assets: [], scanning: false, complete: false, timestamp: null };
      }
    }

    // Deep copy to prevent race conditions
    const data = {
      assets: [...this.lastImages.assets],
      scanning: this.lastImages.scanning,
      complete: this.lastImages.complete,
      timestamp: this.lastImages.timestamp
    };
    if (this.lastImages.complete) {
      this.lastImages = { assets: [], scanning: false, complete: false, timestamp: null };
      console.log('[ASSET-SERVER] Returning', data.assets.length, 'images and resetting');
    }
    return data;
  }

  requestImageDump() {
    // Clear any stale data immediately when a new scan is requested
    if (!this.lastImages.scanning) {
      const hadOldData = this.lastImages.assets.length > 0;
      this.lastImages = { assets: [], scanning: false, complete: false, timestamp: null };
      if (hadOldData) {
        console.log('[ASSET-SERVER] Cleared stale image data before new scan request');
      }
    }
    this.requestImages = true;
    logDev('Image dump request triggered');
  }

  requestMeshDump() {
    if (!this.lastMeshes.scanning) {
      this.lastMeshes = { assets: [], scanning: false, complete: false, timestamp: null };
    }
    this.requestMeshes = true;
    logDev('Mesh dump request triggered');
  }

  getLastMeshes() {
    const now = Date.now();
    if (this.lastMeshes.timestamp && !this.lastMeshes.scanning && !this.lastMeshes.complete) {
      if (now - this.lastMeshes.timestamp > 60000) {
        this.lastMeshes = { assets: [], scanning: false, complete: false, timestamp: null };
      }
    }
    const data = {
      assets: [...this.lastMeshes.assets],
      scanning: this.lastMeshes.scanning,
      complete: this.lastMeshes.complete,
      timestamp: this.lastMeshes.timestamp
    };
    if (this.lastMeshes.complete) {
      this.lastMeshes = { assets: [], scanning: false, complete: false, timestamp: null };
      console.log('[ASSET-SERVER] Returning', data.assets.length, 'meshes and resetting');
    }
    return data;
  }

  requestScriptRefDump() {
    if (!this.lastScriptRefs.scanning) {
      this.lastScriptRefs = { assets: [], scanning: false, complete: false, timestamp: null };
    }
    this.requestScriptRefs = true;
    logDev('Script-ref dump request triggered');
  }

  getLastScriptRefs() {
    const now = Date.now();
    if (this.lastScriptRefs.timestamp && !this.lastScriptRefs.scanning && !this.lastScriptRefs.complete) {
      if (now - this.lastScriptRefs.timestamp > 60000) {
        this.lastScriptRefs = { assets: [], scanning: false, complete: false, timestamp: null };
      }
    }
    const data = {
      assets: [...this.lastScriptRefs.assets],
      scanning: this.lastScriptRefs.scanning,
      complete: this.lastScriptRefs.complete,
      timestamp: this.lastScriptRefs.timestamp
    };
    if (this.lastScriptRefs.complete) {
      this.lastScriptRefs = { assets: [], scanning: false, complete: false, timestamp: null };
      console.log('[ASSET-SERVER] Returning', data.assets.length, 'script-refs and resetting');
    }
    return data;
  }

  getStoredMappings() {
    const mappings = this.storedMappings;
    this.storedMappings = [];
    return mappings;
  }

  isPluginConnected() {
    if (!this.lastPluginPollTime) return false;
    const timeSinceLastPoll = Date.now() - this.lastPluginPollTime;
    return timeSinceLastPoll < 2000; // Consider connected if polled within last 2 seconds
  }

  getPluginStatus() {
    if (!this.lastPluginPollTime) {
      return { connected: false, message: 'Plugin has never connected' };
    }
    const timeSinceLastPoll = Date.now() - this.lastPluginPollTime;
    const connected = timeSinceLastPoll < 2000;
    return {
      connected,
      message: connected ? 'Connected' : `Last seen ${Math.round(timeSinceLastPoll / 1000)}s ago`,
      lastPollTime: this.lastPluginPollTime
    };
  }
}

module.exports = { AssetServer };
