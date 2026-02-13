// modules/utils/asset-downloader.js
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const { DEVELOPER_MODE } = require('./common');
const { getMultiplePlaceIds, validateCookieAndGetUser } = require('./roblox-api');

/**
 * Downloads multiple assets using batch API endpoint
 * @param {Array} assets - Assets to download
 * @param {Array} placeIds - Array of placeIds to try
 * @param {string} cookie - Roblox cookie
 * @param {string} downloadsDir - Download directory
 * @param {Function} sendOutput - Output callback
 * @param {Function} sendTransferUpdate - Transfer update callback
 * @returns {Promise<Object>} - { success: boolean, downloadedAssets: {} }
 */
async function downloadAssetsBatch(assets, placeIds, cookie, downloadsDir, sendOutput, sendTransferUpdate, onProgress) {
  const downloadedAssets = {};
  
  // Separate images/decals from other assets - they use asset delivery endpoint directly
  const imageAssets = assets.filter(a => a.assetType === 'Image' || a.assetType === 'Decal');
  const otherAssets = assets.filter(a => a.assetType !== 'Image' && a.assetType !== 'Decal');
  
  // Download images directly first (in parallel)
  if (imageAssets.length > 0) {
    if (DEVELOPER_MODE) console.log(`(Dev) Downloading ${imageAssets.length} image assets directly via asset delivery`);
    sendOutput({ output: `  Downloading ${imageAssets.length} image assets directly...\n`, success: null });
    
    // Download images in parallel (up to 5 at a time)
    const downloadImage = async (asset) => {
      const transferId = crypto.randomUUID();
      try {
        const downloadPath = path.join(downloadsDir, `${asset.assetId}.png`);
        const assetDeliveryUrl = `https://assetdelivery.roblox.com/v1/asset/?id=${asset.assetId}`;
        
        sendOutput({ output: `    ↓ Downloading image ${asset.name} (${asset.assetId})...\n`, success: null });
        if (DEVELOPER_MODE) console.log(`(Dev) Image download URL: ${assetDeliveryUrl}`);
        
        sendTransferUpdate({
          id: transferId,
          name: asset.name,
          direction: 'download',
          status: 'processing',
          progress: 0,
        });
        
        const assetResp = await fetch(assetDeliveryUrl, { 
          redirect: 'follow',
          headers: {
            'Cookie': `.ROBLOSECURITY=${cookie}`,
          }
        });
        
        if (!assetResp.ok) {
          throw new Error(`Asset delivery failed with status ${assetResp.status}`);
        }
        
        const arrayBuffer = await assetResp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (DEVELOPER_MODE) console.log(`(Dev) Image downloaded: ${asset.assetId}, Size: ${buffer.length} bytes`);
        
        await fs.writeFile(downloadPath, buffer);
        
        sendTransferUpdate({
          id: transferId,
          name: asset.name,
          direction: 'download',
          status: 'completed',
          progress: 100,
        });
        
        sendOutput({ output: `      ✓ Downloaded to ${downloadPath}\n`, success: true });
        if (onProgress) onProgress();

        return {
          assetId: asset.assetId,
          data: {
            filePath: downloadPath,
            name: asset.name,
            type: asset.assetType,
            transferId: transferId,
          }
        };
      } catch (err) {
        if (DEVELOPER_MODE) console.error(`(Dev) Failed to download image ${asset.assetId}:`, err.message);
        sendOutput({ output: `      ✗ Failed to download: ${err.message}\n`, success: false });
        return null;
      }
    };
    
    // Process in batches of 10 concurrent downloads
    const concurrency = 10;
    for (let i = 0; i < imageAssets.length; i += concurrency) {
      const batch = imageAssets.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(downloadImage));
      results.forEach(result => {
        if (result) downloadedAssets[result.assetId] = result.data;
      });
    }
  }
  
  // If no other assets to batch download, return early
  if (otherAssets.length === 0) {
    return { success: Object.keys(downloadedAssets).length > 0, downloadedAssets };
  }
  
  for (const placeId of placeIds) {
    try {
      sendOutput({ output: `  Trying batch download with placeId ${placeId}...\n`, success: null });
      if (DEVELOPER_MODE) console.log(`(Dev) Attempting batch download with placeId ${placeId} for ${otherAssets.length} assets`);

      // Split into chunks of 50 assets to avoid overwhelming the API
      const chunkSize = 50;
      const chunks = [];
      for (let i = 0; i < otherAssets.length; i += chunkSize) {
        chunks.push(otherAssets.slice(i, i + chunkSize));
      }
      
      if (DEVELOPER_MODE && chunks.length > 1) {
        console.log(`(Dev) Splitting ${otherAssets.length} assets into ${chunks.length} chunks of max ${chunkSize}`);
      }

      // Process each chunk
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const batchPayload = chunk.map(a => ({
          requestId: crypto.randomUUID(),
          assetId: a.assetId,
          assetType: a.assetType,
        }));
        const batchUrl = 'https://assetdelivery.roblox.com/v2/assets/batch';
        const batchHeaders = {
          'Content-Type': 'application/json',
          'Cookie': `.ROBLOSECURITY=${cookie}`,
          'User-Agent': 'Roblox/WinInet',
          'Roblox-Place-Id': String(placeId),
        };

        if (chunks.length > 1) {
          sendOutput({ output: `    Processing chunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} assets)...\n`, success: null });
        }

        const batchResp = await fetch(batchUrl, {
          method: 'POST',
          headers: batchHeaders,
          body: JSON.stringify(batchPayload),
        });

        if (!batchResp.ok) {
          const errText = await batchResp.text();
          if (DEVELOPER_MODE) {
            console.warn('[BATCH DEBUG] URL:', batchUrl);
            console.warn('[BATCH DEBUG] Headers:', JSON.stringify(batchHeaders));
            console.warn('[BATCH DEBUG] Payload:', JSON.stringify(batchPayload));
            console.warn('[BATCH DEBUG] Error:', errText);
          }
          throw new Error(`Batch failed (${batchResp.status}): ${errText.substring(0, 200)}`);
        }

        const batchData = await batchResp.json();
        if (!Array.isArray(batchData)) {
          throw new Error('Invalid batch response format');
        }

      // Download each asset from the batch response (in parallel)
      const downloadAsset = async (item) => {
        const asset = otherAssets.find(a => a.assetId === item.assetId);
        if (!asset || !item.location) return null;

        const transferId = crypto.randomUUID();
        const extensions = {
          'Sound': '.ogg',
          'Audio': '.ogg',
          'Animation': '.rbxm',
        };
        const ext = extensions[asset.assetType] || '.dat';
        const downloadPath = path.join(downloadsDir, `${asset.assetId}${ext}`);

        sendOutput({ output: `    ↓ Downloading ${asset.name} (${asset.assetId})...\n`, success: null });

        sendTransferUpdate({
          id: transferId,
          name: asset.name,
          direction: 'download',
          status: 'processing',
          progress: 0,
        });

        try {
          const assetResp = await fetch(item.location, { redirect: 'follow' });
          if (!assetResp.ok) {
            throw new Error(`Asset download failed: ${assetResp.status}`);
          }

          const buffer = await assetResp.buffer();
          await fs.writeFile(downloadPath, buffer);

          sendTransferUpdate({
            id: transferId,
            name: asset.name,
            direction: 'download',
            status: 'completed',
            progress: 100,
          });

          sendOutput({ output: `      ✓ Downloaded to ${downloadPath}\n`, success: true });
          
          return {
            assetId: asset.assetId,
            data: {
              filePath: downloadPath,
              name: asset.name,
              type: asset.assetType,
              transferId: transferId,
            }
          };
        } catch (err) {
          sendOutput({ output: `      ✗ Failed: ${err.message}\n`, success: false });
          return null;
        }
      };
      
        // Download all batch assets in parallel
        const results = await Promise.all(batchData.map(downloadAsset));
        results.forEach(result => {
          if (result) downloadedAssets[result.assetId] = result.data;
        });
      }

      if (Object.keys(downloadedAssets).length === assets.length) {
        sendOutput({ output: `  ✓ Batch download successful\n`, success: true });
        return { success: true, downloadedAssets };
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn(`(Dev) Batch download failed with placeId ${placeId}:`, err.message);
      sendOutput({ output: `  ✗ Batch failed: ${err.message}\n`, success: false });
    }
  }

  return { success: false, downloadedAssets };
}

/**
 * Downloads assets individually (fallback when batch fails or creator unknown)
 * @param {Array} assets - Assets to download
 * @param {string} cookie - Roblox cookie
 * @param {string} downloadsDir - Download directory
 * @param {Function} sendOutput - Output callback
 * @param {Function} sendTransferUpdate - Transfer update callback
 * @returns {Promise<Object>} - { success: boolean, downloadedAssets: {} }
 */
async function downloadAssetsIndividual(assets, cookie, downloadsDir, sendOutput, sendTransferUpdate, placeIdsFromCreator = [], placeIdSearchLimit = 20, onProgress) {
  const downloadedAssets = {};
  
  sendOutput({ output: `  Resolving creators for individual downloads...\n`, success: null });
  
  // Process individual downloads in parallel (3 at a time to avoid rate limits)
  const downloadAsset = async (asset) => {
    const transferId = crypto.randomUUID();
    
    try {
      // First, get the asset's creator info if we don't have it
      let assetCreatorId = asset.creatorId;
      let assetCreatorType = asset.creatorType || 'User';
      
      if (!assetCreatorId) {
        sendOutput({ output: `    Looking up creator for asset ${asset.assetId}...\n`, success: null });
        
        // Retry logic for rate limiting
        let assetDetailsResp;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          const delay = 300 + (retryCount * 500); // Reduced delays: 300ms, 800ms, 1300ms
          await new Promise(resolve => setTimeout(resolve, delay));
          
          assetDetailsResp = await fetch(`https://apis.roblox.com/assets/user-auth/v1/assets/${asset.assetId}`, {
            headers: { 
              'Host': 'apis.roblox.com',
              'Sec-Ch-Ua-Platform': '"Windows"',
              'Accept-Language': 'en-US,en;q=0.9',
              'Sec-Ch-Ua': '"Chromium";v="143", "Not A(Brand";v="24"',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
              'Sec-Ch-Ua-Mobile': '?0',
              'Accept': '*/*',
              'Origin': 'https://create.roblox.com',
              'Sec-Fetch-Site': 'same-site',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Dest': 'empty',
              'Referer': 'https://create.roblox.com/',
              'Accept-Encoding': 'gzip, deflate, br',
              'Priority': 'u=1, i',
              'Cookie': `.ROBLOSECURITY=${cookie}`
            }
          });
          
          if (assetDetailsResp.status !== 429) break;
          retryCount++;
        }
        
        if (assetDetailsResp.ok) {
          const assetDetails = await assetDetailsResp.json();
          if (assetDetails.creationContext && assetDetails.creationContext.creator) {
            const creator = assetDetails.creationContext.creator;
            if (creator.userId) {
              assetCreatorId = creator.userId;
              assetCreatorType = 'User';
              sendOutput({ output: `      ✓ Found creator: User ${assetCreatorId}\n`, success: true });
            } else if (creator.groupId) {
              assetCreatorId = creator.groupId;
              assetCreatorType = 'Group';
              sendOutput({ output: `      ✓ Found creator: Group ${assetCreatorId}\n`, success: true });
            }
          }
        }
      }
      
      // Build candidate placeIds to try (use provided list first, then fetch minimal if empty)
      let candidatePlaceIds = Array.isArray(placeIdsFromCreator)
        ? Array.from(
            new Set(
              placeIdsFromCreator
                .map((p) => Number(p))
                .filter((p) => Number.isFinite(p) && p > 0)
            )
          )
        : [];

      if (candidatePlaceIds.length === 0 && assetCreatorId) {
        try {
          const placeIds = await getMultiplePlaceIds(assetCreatorType, assetCreatorId, cookie, placeIdSearchLimit);
          candidatePlaceIds.push(...placeIds);
          if (DEVELOPER_MODE && placeIds.length > 0) console.log(`(Dev) Got placeIds ${placeIds.join(',')} for asset ${asset.assetId} from ${assetCreatorType} ${assetCreatorId}`);
        } catch (err) {
          if (DEVELOPER_MODE) console.warn(`(Dev) Failed to get placeId for creator ${assetCreatorId}:`, err.message);
        }
      }

      // If still none, try user's own games as last resort
      if (candidatePlaceIds.length === 0) {
        try {
          const userInfo = await validateCookieAndGetUser(cookie);
          if (userInfo && userInfo.userId) {
            const userPlaceIds = await getMultiplePlaceIds('User', userInfo.userId, cookie, placeIdSearchLimit);
            candidatePlaceIds.push(...userPlaceIds);
            if (DEVELOPER_MODE && userPlaceIds.length > 0) console.log(`(Dev) Using fallback placeIds ${userPlaceIds.join(',')} from user ${userInfo.userId}`);
          }
        } catch (err) {
          if (DEVELOPER_MODE) console.warn(`(Dev) Failed to get fallback placeId:`, err.message);
        }
      }

      if (candidatePlaceIds.length === 0) {
        candidatePlaceIds.push(null); // Try without placeId as last resort
      }
      
      const extensions = {
        'Sound': '.ogg',
        'Audio': '.ogg',
        'Animation': '.rbxm',
        'Image': '.png',
        'Decal': '.png',
      };
      const ext = extensions[asset.assetType] || '.dat';
      const downloadPath = path.join(downloadsDir, `${asset.assetId}${ext}`);

      sendOutput({ output: `    ↓ Downloading ${asset.name} (${asset.assetId})...\n`, success: null });

      sendTransferUpdate({
        id: transferId,
        name: asset.name,
        direction: 'download',
        status: 'processing',
        progress: 0,
      });

      let downloaded = false;
      for (const placeId of candidatePlaceIds) {
        try {
          // Use individual asset endpoint with placeId header
          const assetUrl = `https://assetdelivery.roblox.com/v1/asset/?id=${asset.assetId}`;
          const headers = {
            'Cookie': `.ROBLOSECURITY=${cookie}`,
            'User-Agent': 'Roblox/WinInet',
          };
          
          if (placeId) {
            headers['Roblox-Place-Id'] = String(placeId);
            sendOutput({ output: `      Using placeId: ${placeId}\n`, success: null });
            if (DEVELOPER_MODE) console.log(`(Dev) Downloading ${asset.assetId} with placeId ${placeId}`);
          } else {
            sendOutput({ output: `      ⚠ No placeId available\n`, success: false });
            if (DEVELOPER_MODE) console.log(`(Dev) Downloading ${asset.assetId} without placeId`);
          }
          
          const downloadResp = await fetch(assetUrl, {
            headers: headers,
            redirect: 'follow',
          });

          if (!downloadResp.ok) {
            throw new Error(`Download failed: ${downloadResp.status}`);
          }

          // In Electron/Node fetch, use arrayBuffer → Buffer to avoid undefined buffer()
          const arrayBuffer = await downloadResp.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          await fs.writeFile(downloadPath, buffer);

          downloadedAssets[asset.assetId] = {
            filePath: downloadPath,
            name: asset.name,
            type: asset.assetType,
            transferId: transferId,
          };

          sendTransferUpdate({
            id: transferId,
            name: asset.name,
            direction: 'download',
            status: 'completed',
            progress: 100,
          });

          sendOutput({ output: `      ✓ Downloaded\n`, success: true });
                    if (onProgress) onProgress();
          downloaded = true;
          break;
        } catch (errInner) {
          if (DEVELOPER_MODE) console.warn(`(Dev) Individual download failed for ${asset.assetId} with placeId ${placeId}:`, errInner.message);
          sendOutput({ output: `      ✗ Download failed${placeId ? ` (placeId ${placeId})` : ''}: ${errInner.message}\n`, success: false });
          // try next placeId
        }
      }

      if (!downloaded) {
        throw new Error('All placeId attempts failed');
      }
      
      return { assetId: asset.assetId, success: true };
    } catch (err) {
      if (DEVELOPER_MODE) console.warn(`(Dev) Individual download failed for ${asset.assetId}:`, err.message);
      sendOutput({ output: `      ✗ Download failed: ${err.message}\n`, success: false });
      
      sendTransferUpdate({
        id: transferId,
        name: asset.name,
        direction: 'download',
        status: 'error',
        progress: 0,
      });
      
      return { assetId: asset.assetId, success: false };
    }
  };
  
  // Process 3 downloads at a time to avoid overwhelming the API
  const concurrency = 3;
  for (let i = 0; i < assets.length; i += concurrency) {
    const batch = assets.slice(i, i + concurrency);
    await Promise.all(batch.map(downloadAsset));
  }
  
  const success = Object.keys(downloadedAssets).length > 0;
  return { success, downloadedAssets };
}

module.exports = {
  downloadAssetsBatch,
  downloadAssetsIndividual
};
