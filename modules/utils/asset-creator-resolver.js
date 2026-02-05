// modules/utils/asset-creator-resolver.js
const { DEVELOPER_MODE } = require('./common');

/**
 * Resolves "Unknown" asset creators by querying Roblox asset API
 * @param {Array} assets - Array of asset objects with assetId, creator, etc.
 * @param {string} cookie - Roblox authentication cookie
 * @param {function} onProgress - Optional progress callback (resolvedCount, total)
 * @returns {Promise<Array>} - Assets array with resolved creator info
 */
async function resolveAssetCreators(assets, cookie, sendOutput, onProgress) {
  if (DEVELOPER_MODE) console.log(`(Dev) Starting creator resolution for ${assets.length} assets`);
  
  sendOutput({ output: `\n🔍 Resolving asset creators...\n`, success: null });
  const assetsNeedingResolution = assets.filter((asset) => asset.creator === 'Unknown' || !asset.creator);
  const concurrency = Math.min(8, assetsNeedingResolution.length || 1);
  let resolvedCount = 0;

  const processAsset = async (asset) => {
    try {
      sendOutput({ output: `  Looking up creator for asset ${asset.assetId}...\n`, success: null });
      
      // Retry logic for rate limiting
      let assetDetailsResp;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        // On timeout/429, wait 5s and retry
        if (retryCount > 0) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        const requestUrl = `https://apis.roblox.com/assets/user-auth/v1/assets/${asset.assetId}`;
        const requestHeaders = { 
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
        };
        
        if (DEVELOPER_MODE) {
          console.log(`(Dev) Request URL:`, requestUrl);
        }
        
        assetDetailsResp = await fetch(requestUrl, {
          headers: requestHeaders
        });
        
        if (assetDetailsResp.status !== 429) break; // Success or other error
        
        retryCount++;
        if (DEVELOPER_MODE) console.log(`(Dev) Rate limited, retry ${retryCount}/${maxRetries} for asset ${asset.assetId}`);
        sendOutput({ output: `    ⚠ Rate limited, retrying (${retryCount}/${maxRetries})...\n`, success: null });
      }
      
      if (DEVELOPER_MODE) console.log(`(Dev) Asset ${asset.assetId} details response status:`, assetDetailsResp.status);
      
      if (assetDetailsResp.ok) {
        const assetDetails = await assetDetailsResp.json();
        
        if (DEVELOPER_MODE) console.log(`(Dev) Asset ${asset.assetId} details:`, JSON.stringify(assetDetails).substring(0, 500));
        
        // Capture original asset name for upload reuse (always override with API value)
        const originalName = assetDetails.displayName || assetDetails.name;
        if (originalName) {
          asset.name = originalName;
          if (DEVELOPER_MODE) console.log(`(Dev) Set asset.name to "${originalName}" for asset ${asset.assetId}`);
        }
        
        if (assetDetails.creationContext && assetDetails.creationContext.creator) {
          const creator = assetDetails.creationContext.creator;
          if (creator.userId) {
            asset.creatorId = creator.userId;
            asset.creatorType = 'User';
            asset.creator = creator.userId; // Will be replaced with name if needed
            sendOutput({ output: `    ✓ Found: User ${asset.creatorId}\n`, success: true });
            if (DEVELOPER_MODE) console.log(`(Dev) Resolved asset ${asset.assetId} creator: User ${asset.creatorId}`);
          } else if (creator.groupId) {
            asset.creatorId = creator.groupId;
            asset.creatorType = 'Group';
            asset.creator = creator.groupId;
            sendOutput({ output: `    ✓ Found: Group ${asset.creatorId}\n`, success: true });
            if (DEVELOPER_MODE) console.log(`(Dev) Resolved asset ${asset.assetId} creator: Group ${asset.creatorId}`);
          }
        } else {
          if (DEVELOPER_MODE) console.log(`(Dev) Asset ${asset.assetId} has no creator in response`);
          sendOutput({ output: `    ⚠ No creator info in response\n`, success: false });
        }
      } else {
        const errorText = await assetDetailsResp.text();
        if (DEVELOPER_MODE) console.log(`(Dev) Asset ${asset.assetId} details failed:`, assetDetailsResp.status, errorText.substring(0, 200));
        sendOutput({ output: `    ⚠ API returned ${assetDetailsResp.status}\n`, success: false });
      }
      resolvedCount++;
      if (onProgress) onProgress(resolvedCount, assetsNeedingResolution.length || assets.length || 1);
    } catch (err) {
      if (DEVELOPER_MODE) console.warn(`(Dev) Failed to resolve creator for asset ${asset.assetId}:`, err.message);
      sendOutput({ output: `    ⚠ Error: ${err.message}\n`, success: false });
      resolvedCount++;
      if (onProgress) onProgress(resolvedCount, assetsNeedingResolution.length || assets.length || 1);
    }
  };

  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const currentIndex = cursor++;
      const asset = assetsNeedingResolution[currentIndex];
      if (!asset) break;
      await processAsset(asset);
    }
  });

  await Promise.all(workers);
  return assets;
}

module.exports = {
  resolveAssetCreators
};
