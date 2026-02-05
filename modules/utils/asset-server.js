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
    this.skipOwnedCheck = true; // skip assets already owned by place creator by default
    this.lastSounds = { assets: [], scanning: false, complete: false };
    this.lastAnimations = { assets: [], scanning: false, complete: false };
    this.lastImages = { assets: [], scanning: false, complete: false };
    this.storedMappings = [];
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
      this.app.use(express.json());

      // ===== Sound Endpoints =====
      // Poll endpoint: Roblox script checks if sounds should be scanned
      this.app.get('/poll-sounds', (req, res) => {
        const result = { requestAssets: this.requestSounds, skipOwnedCheck: this.getSkipOwnedCheck() };
        if (this.requestSounds) {
          this.lastSounds = { assets: [], scanning: true, complete: false };
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
        const result = { requestAssets: this.requestAnimations, skipOwnedCheck: this.getSkipOwnedCheck() };
        if (this.requestAnimations) {
          this.lastAnimations = { assets: [], scanning: true, complete: false };
          console.log('[ASSET-SERVER] Animation scan initiated, cleared previous data');
        }
        this.requestAnimations = false;
        res.json(result);
        logDev('Poll-animations request, responding with requestAssets flag');
      });

      // Asset receive endpoint: Roblox POSTs animation data here
      this.app.post('/assets-animations', (req, res) => {
        const batch = req.body;
        console.log('[ASSET-SERVER] Received animation batch:', batch.assetCount || 0, 'assets');
        if (batch.assets && Array.isArray(batch.assets)) {
          this.lastAnimations.assets.push(...batch.assets);
          console.log('[ASSET-SERVER] Total animations accumulated:', this.lastAnimations.assets.length);
        }
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
        const result = { requestAssets: this.requestImages, skipOwnedCheck: this.getSkipOwnedCheck() };
        if (this.requestImages) {
          this.lastImages = { assets: [], scanning: true, complete: false };
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
        res.send('ok');
      });

      // Completion signal: Roblox signals scan is done
      this.app.post('/images-complete', (req, res) => {
        this.lastImages.scanning = false;
        this.lastImages.complete = true;
        console.log('[ASSET-SERVER] Image scan complete, total:', this.lastImages.assets.length);
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

      // Poll endpoint: Plugin checks for ID replacements
      this.app.get('/poll-replacements', (req, res) => {
        const mappings = this.getStoredMappings();
        if (mappings && mappings.length > 0) {
          console.log(`[ASSET-SERVER] Plugin polling replacements, sending ${mappings.length} mappings`);
          res.json({ mappings: mappings });
        } else {
          res.json({ mappings: [] });
        }
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
    const data = { ...this.lastSounds };
    if (this.lastSounds.complete) {
      this.lastSounds = { assets: [], scanning: false, complete: false };
      console.log('[ASSET-SERVER] Returning', data.assets.length, 'sounds and resetting');
    }
    return data;
  }

  getLastAnimations() {
    const data = { ...this.lastAnimations };
    if (this.lastAnimations.complete) {
      this.lastAnimations = { assets: [], scanning: false, complete: false };
      console.log('[ASSET-SERVER] Returning', data.assets.length, 'animations and resetting');
    }
    return data;
  }

  requestSoundDump() {
    this.requestSounds = true;
    logDev('Sound dump request triggered');
  }

  requestAnimationDump() {
    this.requestAnimations = true;
    logDev('Animation dump request triggered');
  }

  getLastImages() {
    const data = { ...this.lastImages };
    if (this.lastImages.complete) {
      this.lastImages = { assets: [], scanning: false, complete: false };
      console.log('[ASSET-SERVER] Returning', data.assets.length, 'images and resetting');
    }
    return data;
  }

  requestImageDump() {
    this.requestImages = true;
    logDev('Image dump request triggered');
  }

  getStoredMappings() {
    const mappings = this.storedMappings;
    this.storedMappings = [];
    return mappings;
  }
}

module.exports = { AssetServer };
