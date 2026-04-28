// modules/utils/asset-downloader.js
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const { DEVELOPER_MODE } = require('./common');
const { getMultiplePlaceIds, validateCookieAndGetUser } = require('./roblox-api');
const { convertMeshToObj } = require('./mesh-converter');

function isMeshType(assetType) {
  return assetType === 'Mesh' || assetType === 'Model';
}

function looksLikeMesh(buffer) {
  const header = buffer.toString('ascii', 0, 8);
  // Raw mesh format starts with "version ", RBXM container starts with "<roblox!"
  return header.startsWith('version ') || header === '<roblox!';
}

async function saveAsset(buffer, assetType, downloadPath, convertToObj = false) {
  if (convertToObj && (isMeshType(assetType) || looksLikeMesh(buffer))) {
    try {
      const objStr = convertMeshToObj(buffer);
      const objPath = downloadPath.replace(/\.[^.]+$/, '.obj');
      await fs.writeFile(objPath, objStr, 'utf8');
      return objPath;
    } catch {
      // Fall back to raw file if conversion fails
      await fs.writeFile(downloadPath, buffer);
      return downloadPath;
    }
  }
  await fs.writeFile(downloadPath, buffer);
  return downloadPath;
}

const CHUNK_SIZE = 100;        // assets per batch API request (was 50)
const CHUNK_CONCURRENCY = 4;   // parallel chunk requests per placeId attempt (was 1)
const IMAGE_CONCURRENCY = 15;  // parallel image downloads (was 10)
const INDIVIDUAL_CONCURRENCY = 8; // parallel individual downloads (was 3)

/**
 * Downloads multiple assets using batch API endpoint
 */
async function downloadAssetsBatch(assets, placeIds, cookie, downloadsDir, sendOutput, sendTransferUpdate, onProgress, convertMeshesToObj = false) {
  const downloadedAssets = {};
  // Track which assets have already been counted in progress to avoid double-counting
  // across multiple placeId retry attempts
  const progressReported = new Set();

  // Separate images/decals — they use asset delivery directly and don't need a placeId
  const imageAssets = assets.filter(a => a.assetType === 'Image' || a.assetType === 'Decal');
  const otherAssets = assets.filter(a => a.assetType !== 'Image' && a.assetType !== 'Decal');

  // Download images in parallel
  if (imageAssets.length > 0) {
    sendOutput({ output: `  📷 Downloading ${imageAssets.length} image(s)...\n`, success: null });
    let imageOk = 0, imageFail = 0;

    const downloadImage = async (asset) => {
      const transferId = crypto.randomUUID();
      try {
        const sanitizedName = (asset.name || `Image_${asset.assetId}`).replace(/[<>:"/\\|?*]/g, '_').substring(0, 150);
        const downloadPath = path.join(downloadsDir, `${sanitizedName}_${asset.assetId}.png`);
        sendTransferUpdate({ id: transferId, name: asset.name, direction: 'download', status: 'processing', progress: 0 });

        const assetResp = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${asset.assetId}`, {
          redirect: 'follow',
          headers: { 'Cookie': `.ROBLOSECURITY=${cookie}` },
        });
        if (!assetResp.ok) throw new Error(`Status ${assetResp.status}`);

        const buffer = Buffer.from(await assetResp.arrayBuffer());
        await fs.writeFile(downloadPath, buffer);

        sendTransferUpdate({ id: transferId, name: asset.name, direction: 'download', status: 'completed', progress: 100 });
        imageOk++;
        if (onProgress && !progressReported.has(asset.assetId)) { progressReported.add(asset.assetId); onProgress(); }
        return { assetId: asset.assetId, data: { filePath: downloadPath, name: asset.name, type: asset.assetType, transferId } };
      } catch (err) {
        if (DEVELOPER_MODE) console.error(`(Dev) Failed to download image ${asset.assetId}:`, err.message);
        sendOutput({ output: `    ✗ ${asset.name} (${asset.assetId}): ${err.message}\n`, success: false });
        imageFail++;
        if (onProgress && !progressReported.has(asset.assetId)) { progressReported.add(asset.assetId); onProgress(); }
        return null;
      }
    };

    for (let i = 0; i < imageAssets.length; i += IMAGE_CONCURRENCY) {
      const results = await Promise.all(imageAssets.slice(i, i + IMAGE_CONCURRENCY).map(downloadImage));
      results.forEach(r => { if (r) downloadedAssets[r.assetId] = r.data; });
    }
    sendOutput({ output: `  ✓ Images: ${imageOk} downloaded${imageFail > 0 ? `, ${imageFail} failed` : ''}\n`, success: imageFail === 0 });
  }

  if (otherAssets.length === 0) {
    return { success: Object.keys(downloadedAssets).length > 0, downloadedAssets };
  }

  // Try each placeId in sequence, but only for assets not yet downloaded
  let placeIdAttempt = 0;
  for (const placeId of placeIds) {
    const remainingAssets = otherAssets.filter(a => !downloadedAssets[a.assetId]);
    if (remainingAssets.length === 0) break;
    placeIdAttempt++;

    const beforeCount = Object.keys(downloadedAssets).length;

    try {
      if (DEVELOPER_MODE) console.log(`(Dev) Batch attempt #${placeIdAttempt} placeId=${placeId} for ${remainingAssets.length} assets`);

      const chunks = [];
      for (let i = 0; i < remainingAssets.length; i += CHUNK_SIZE) {
        chunks.push(remainingAssets.slice(i, i + CHUNK_SIZE));
      }

      let batchFailed = false;
      for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
        const parallelChunks = chunks.slice(i, i + CHUNK_CONCURRENCY);

        await Promise.all(parallelChunks.map(async (chunk) => {
          if (batchFailed) return;

          const batchPayload = chunk.map(a => ({
            requestId: crypto.randomUUID(),
            assetId: a.assetId,
            assetType: a.assetType,
          }));

          const batchResp = await fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `.ROBLOSECURITY=${cookie}`,
              'User-Agent': 'Roblox/WinInet',
              'Roblox-Place-Id': String(placeId),
            },
            body: JSON.stringify(batchPayload),
          });

          if (!batchResp.ok) {
            const errText = await batchResp.text();
            throw new Error(`Batch API error (${batchResp.status}): ${errText.substring(0, 200)}`);
          }

          const batchData = await batchResp.json();
          if (!Array.isArray(batchData)) throw new Error('Invalid batch response format');

          const downloadItem = async (item) => {
            const asset = remainingAssets.find(a => a.assetId === item.assetId);
            if (!asset) return;

            const isMeshAsset = asset.assetType === 'Mesh' || asset.assetType === 'Model';
            if (!item.location && !isMeshAsset) return;

            const transferId = crypto.randomUUID();
            const ext = { Sound: '.ogg', Audio: '.ogg', Animation: '.rbxm', Mesh: '.mesh', Model: '.mesh' }[asset.assetType] || '.dat';
            const sanitizedName = (asset.name || `Asset_${asset.assetId}`).replace(/[<>:"/\\|?*]/g, '_').substring(0, 150);
            const downloadPath = path.join(downloadsDir, `${sanitizedName}_${asset.assetId}${ext}`);

            sendTransferUpdate({ id: transferId, name: asset.name, direction: 'download', status: 'processing', progress: 0 });

            try {
              let buffer;
              if (isMeshAsset) {
                // Fetch raw mesh binary directly — bypasses assetType mislabelling
                const meshResp = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${asset.assetId}`, {
                  headers: { 'Cookie': `.ROBLOSECURITY=${cookie}`, 'User-Agent': 'Roblox/WinInet' },
                  redirect: 'follow',
                });
                if (!meshResp.ok) throw new Error(`v1/asset error ${meshResp.status}`);
                buffer = Buffer.from(await meshResp.arrayBuffer());
              } else {
                const assetResp = await fetch(item.location, { redirect: 'follow' });
                if (!assetResp.ok) throw new Error(`CDN error ${assetResp.status}`);
                buffer = Buffer.from(await assetResp.arrayBuffer());
              }

              const savedPath = await saveAsset(buffer, asset.assetType, downloadPath, convertMeshesToObj);

              sendTransferUpdate({ id: transferId, name: asset.name, direction: 'download', status: 'completed', progress: 100 });
              downloadedAssets[asset.assetId] = { filePath: savedPath, name: asset.name, type: asset.assetType, transferId, assetId: asset.assetId };
              if (onProgress && !progressReported.has(asset.assetId)) { progressReported.add(asset.assetId); onProgress(); }
            } catch (err) {
              sendTransferUpdate({ id: transferId, name: asset.name, direction: 'download', status: 'error', progress: 0 });
              if (DEVELOPER_MODE) console.warn(`(Dev) Download failed for ${asset.assetId}: ${err.message}`);
              // Do NOT call onProgress — asset may succeed on the next placeId attempt
            }
          };

          await Promise.all(batchData.map(downloadItem));
        }));

        if (batchFailed) break;
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn(`(Dev) Batch failed with placeId ${placeId}:`, err.message);
      sendOutput({ output: `  ✗ Batch attempt #${placeIdAttempt} failed: ${err.message}\n`, success: false });
    }

    const afterCount = Object.keys(downloadedAssets).length;
    const gained = afterCount - beforeCount;
    const stillNeeded = otherAssets.filter(a => !downloadedAssets[a.assetId]).length;

    if (gained > 0 || stillNeeded === 0) {
      sendOutput({
        output: `  ✓ Batch #${placeIdAttempt}: ${gained} downloaded${stillNeeded > 0 ? `, ${stillNeeded} remaining` : ', all done'}\n`,
        success: true,
      });
    }

    if (stillNeeded === 0) break;
  }

  // Count progress for any non-image assets that failed all placeId attempts
  if (onProgress) {
    for (const asset of otherAssets) {
      if (!progressReported.has(asset.assetId)) {
        progressReported.add(asset.assetId);
        onProgress();
      }
    }
  }

  return { success: false, downloadedAssets };
}

/**
 * Downloads assets individually (fallback when batch fails or creator unknown)
 */
async function downloadAssetsIndividual(assets, cookie, downloadsDir, sendOutput, sendTransferUpdate, placeIdsFromCreator = [], placeIdSearchLimit = 20, onProgress, convertMeshesToObj = false) {
  const downloadedAssets = {};

  sendOutput({ output: `  📥 Individual download mode (${assets.length} assets)...\n`, success: null });
  let indivOk = 0, indivFail = 0;

  const downloadAsset = async (asset) => {
    const transferId = crypto.randomUUID();

    try {
      let assetCreatorId = asset.creatorId;
      let assetCreatorType = asset.creatorType || 'User';

      // Look up creator only if we don't already have it
      if (!assetCreatorId) {
        let assetDetailsResp;
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
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
              'Cookie': `.ROBLOSECURITY=${cookie}`,
            },
          });

          if (assetDetailsResp.status !== 429) break;

          // Only delay on actual 429s
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
        }

        if (assetDetailsResp && assetDetailsResp.ok) {
          const assetDetails = await assetDetailsResp.json();
          const creator = assetDetails?.creationContext?.creator;
          if (creator?.userId) {
            assetCreatorId = creator.userId;
            assetCreatorType = 'User';
          } else if (creator?.groupId) {
            assetCreatorId = creator.groupId;
            assetCreatorType = 'Group';
          }
        }
      }

      // Build list of placeIds to try
      let candidatePlaceIds = Array.isArray(placeIdsFromCreator)
        ? Array.from(new Set(placeIdsFromCreator.map(Number).filter(p => Number.isFinite(p) && p > 0)))
        : [];

      if (candidatePlaceIds.length === 0 && assetCreatorId) {
        try {
          const placeIds = await getMultiplePlaceIds(assetCreatorType, assetCreatorId, cookie, placeIdSearchLimit);
          candidatePlaceIds.push(...placeIds);
        } catch (err) {
          if (DEVELOPER_MODE) console.warn(`(Dev) Failed to get placeIds for creator ${assetCreatorId}:`, err.message);
        }
      }

      if (candidatePlaceIds.length === 0) {
        candidatePlaceIds.push(null); // try without placeId as last resort
      }

      const ext = { Sound: '.ogg', Audio: '.ogg', Animation: '.rbxm', Image: '.png', Decal: '.png', Mesh: '.mesh', Model: '.mesh' }[asset.assetType] || '.dat';
      const sanitizedName = (asset.name || `Asset_${asset.assetId}`).replace(/[<>:"/\\|?*]/g, '_').substring(0, 150);
      const downloadPath = path.join(downloadsDir, `${sanitizedName}_${asset.assetId}${ext}`);

      sendTransferUpdate({ id: transferId, name: asset.name, direction: 'download', status: 'processing', progress: 0 });

      let downloaded = false;
      for (const placeId of candidatePlaceIds) {
        try {
          const headers = { 'Cookie': `.ROBLOSECURITY=${cookie}`, 'User-Agent': 'Roblox/WinInet' };
          if (placeId) headers['Roblox-Place-Id'] = String(placeId);

          const downloadResp = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${asset.assetId}`, {
            headers,
            redirect: 'follow',
          });

          if (!downloadResp.ok) throw new Error(`Download failed: ${downloadResp.status}`);

          const buffer = Buffer.from(await downloadResp.arrayBuffer());
          const savedPath = await saveAsset(buffer, asset.assetType, downloadPath, convertMeshesToObj);

          downloadedAssets[asset.assetId] = { filePath: savedPath, name: asset.name, type: asset.assetType, transferId, assetId: asset.assetId };
          sendTransferUpdate({ id: transferId, name: asset.name, direction: 'download', status: 'completed', progress: 100 });
          if (onProgress) onProgress();
          indivOk++;
          downloaded = true;
          break;
        } catch (errInner) {
          if (DEVELOPER_MODE) console.warn(`(Dev) Individual download failed for ${asset.assetId} with placeId ${placeId}:`, errInner.message);
        }
      }

      if (!downloaded) throw new Error('All placeId attempts failed');
    } catch (err) {
      if (DEVELOPER_MODE) console.warn(`(Dev) Individual download failed for ${asset.assetId}:`, err.message);
      sendOutput({ output: `    ✗ ${asset.name} (${asset.assetId}): ${err.message}\n`, success: false });
      sendTransferUpdate({ id: transferId, name: asset.name, direction: 'download', status: 'error', progress: 0 });
      if (onProgress) onProgress();
      indivFail++;
    }
  };

  for (let i = 0; i < assets.length; i += INDIVIDUAL_CONCURRENCY) {
    await Promise.all(assets.slice(i, i + INDIVIDUAL_CONCURRENCY).map(downloadAsset));
  }

  sendOutput({ output: `  ✓ Individual: ${indivOk} downloaded${indivFail > 0 ? `, ${indivFail} failed` : ''}\n`, success: indivFail === 0 });
  return { success: Object.keys(downloadedAssets).length > 0, downloadedAssets };
}

module.exports = {
  downloadAssetsBatch,
  downloadAssetsIndividual,
};
