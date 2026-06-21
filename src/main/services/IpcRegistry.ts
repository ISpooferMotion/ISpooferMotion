import { extractNumericId } from './common';
// @ts-nocheck
import { app, dialog, ipcMain, shell, Notification, nativeImage, session } from 'electron';
import * as path from 'path';
import * as fsLib from 'fs';
import { spawn } from 'child_process';
import { DEVELOPER_MODE } from './common';
import { loadJobs, deleteJobRecord } from './jobs';
import { loadSession, clearSession } from './session';
import { pushReplacement } from './localhost-plugin-server';
import { getCookieFromAutoDetect } from './auth';
import { createRobloxSession } from './roblox-session';
import { pauseSpoofer, resumeSpoofer, cancelSpoofer } from './ProcessManager';
const fs = fsLib.promises;

import { ProfileService } from './ProfileService';
import { RobloxApiService } from './RobloxApiService';
import { AssetService } from './AssetService';
import { SpooferController } from './SpooferController';

function normalizePayload(value: any) {
  return value && typeof value === 'object' ? value : {};
}


function canOpenExternalUrl(value: any) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}


function resetIpcChannel(channel: any, mode = 'listener') {
  if (mode === 'handler') {
    try {
      ipcMain.removeHandler(channel);
    } catch {}
    return;
  }
  ipcMain.removeAllListeners(channel);
}


function onIpc(channel: any, listener: any) {
  resetIpcChannel(channel);
  ipcMain.on(channel, listener);
}


function handleIpc(channel: any, handler: any) {
  resetIpcChannel(channel, 'handler');
  ipcMain.handle(channel, handler);
}


async function pathExists(filePath: any) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}


function uniquePaths(paths: any[]) {
  return [...new Set(paths.filter(Boolean).map((entry: any) => path.normalize(entry)))];
}


function spawnDetached(filePath: any, args: any[] = []) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(filePath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve(true);
    });
  });
}




function parsePlaceLookupInput(input: any, explicitType: any) {
  const raw = String(input || '').trim();
  const compact = raw.replace(/[,\s]+/g, ' ');
  const lower = compact.toLowerCase();
  const requestedType = String(explicitType || '').toLowerCase();

  if (requestedType === 'place' || lower.includes('/games/') || lower.includes('place')) {
    const placeId = extractNumericId(compact);
    if (!placeId) throw new Error('Enter a numeric Place ID or Roblox game URL.');
    return { lookupType: 'place', placeId };
  }

  const id = extractNumericId(compact);
  let creatorType = requestedType === 'group' || requestedType === 'user' ? requestedType : '';

  if (!creatorType) {
    if (lower.includes('group') || lower.startsWith('g:')) creatorType = 'group';
    else if (lower.includes('user') || lower.startsWith('u:')) creatorType = 'user';
  }

  if (!id) {
    throw new Error('Enter a numeric User ID, Group ID, Place ID, or Roblox game URL.');
  }
  if (!creatorType) {
    creatorType = 'place';
  }
  if (creatorType === 'user' && id === '1') {
    throw new Error('User ID 1 is ignored by design.');
  }

  return { lookupType: 'creator', creatorType, creatorId: id };
}


let spooferRunActive = false;
export function registerIpcHandlers(
  getMainWindowFn: any,
  sendTransferUpdate: any,
  sendSpooferResultToRenderer: any,
  sendStatusMessage: any,
  sendSpooferLog: any,
  sendSpooferProgress: any,
) {
  onIpc('window-minimize', () => getMainWindowFn()?.minimize());
  onIpc('window-close', () => getMainWindowFn()?.close());

  handleIpc('get-app-version', () => {
    try {
      return app.getVersion();
    } catch (err: any) {
      if (DEVELOPER_MODE) console.warn('Failed to get app version:', err);
      return '0.0.0';
    }
  });

  handleIpc('load-profile-secrets', () => ProfileService.loadProfileSecrets());
  handleIpc('save-profile-secrets', (_event: any, data: any) => ProfileService.saveProfileSecrets(data));
  handleIpc('get-roblox-profile', (_event: any, context: any) => RobloxApiService.getRobloxProfile(context));
  handleIpc('validate-opencloud-api-key', async (_event: any, apiKey: any) => {
    const validation = await RobloxApiService.validateOpenCloudApiKey(apiKey);

    if (validation.ok) {
      try {
        const owner = await RobloxApiService.detectOpenCloudApiKeyOwner(apiKey);
        if (owner.ok && owner.ownerUserId) {
          validation.ownerUserId = owner.ownerUserId;
        }
      } catch {}
    }
    return validation;
  });

  handleIpc('detect-opencloud-api-key-owner', async (_event: any, apiKey: any) =>
    RobloxApiService.detectOpenCloudApiKeyOwner(apiKey),
  );
  handleIpc('search-place-ids', async (_event: any, payload: any) => {
    const context = normalizePayload(payload);
    const lookup = parsePlaceLookupInput(context.creatorId || context.input, context.creatorType);
    const maxPlaceIds = Number.parseInt(context.maxPlaceIds, 10) || 10;
    let cookie = context.cookie;

    if (lookup.lookupType === 'place') {
      if (context.autoDetect && !cookie) {
        cookie = await getCookieFromAutoDetect();
      }

      const place = await AssetService.getPlaceSuggestionByPlaceId(lookup.placeId, cookie);
      const warnings = place.warning ? [place.warning] : [];
      const message = place.verified
        ? `Verified place ${place.placeId}${place.name ? ` (${place.name})` : ''}. Selected it as the override place ID.`
        : `Using place ${place.placeId} as an override. Roblox could not verify it${place.warning ? `: ${place.warning}` : '.'}`;

      return {
        creatorType: 'place',
        requestedCreatorType: 'place',
        creatorId: '',
        placeId: place.placeId,
        places: [place],
        warnings,
        message,
        usedCookie: Boolean(cookie),
      };
    }

    const { creatorType, creatorId } = lookup;
    if (context.autoDetect && !cookie) {
      cookie = await getCookieFromAutoDetect(creatorType === 'user' ? creatorId : null);
    }

    const primary = await AssetService.getPlaceSuggestionsFromCreator(
      creatorType,
      creatorId,
      cookie,
      maxPlaceIds,
    );
    const warnings = [...(primary.errors || [])];
    let places = primary.places || [];
    let resolvedCreatorType = creatorType;

    if (places.length === 0 && context.tryAlternateType !== false) {
      const alternateType = creatorType === 'group' ? 'user' : 'group';
      if (!(alternateType === 'user' && creatorId === '1')) {
        const alternate = await AssetService.getPlaceSuggestionsFromCreator(
          alternateType,
          creatorId,
          cookie,
          maxPlaceIds,
        );
        warnings.push(
          ...(alternate.errors || []).map((message: any) => `${alternateType} fallback ${message}`),
        );
        if (alternate.places?.length) {
          places = alternate.places;
          resolvedCreatorType = alternateType;
          warnings.push(
            `No ${creatorType}-owned places were found, but ${alternate.places.length} ${alternateType}-owned place(s) matched the same ID.`,
          );
        }
      }
    }

    let message;
    if (places.length === 0) {
      const ownerLabel = creatorType === 'group' ? 'Group ID' : 'User ID';
      message = `No places found for that ${ownerLabel}. Check the ID, try the other owner type, paste a game URL, or use Override place ID if the experience is private.`;
      if (!cookie) {
        message +=
          ' Add a Roblox cookie or enable Auto detect cookie to include places visible only to your account.';
      }
    } else if (resolvedCreatorType !== creatorType) {
      message = `Found ${places.length} place(s), but under ${resolvedCreatorType} ownership instead of ${creatorType}.`;
    } else {
      message = `Found ${places.length} place${places.length === 1 ? '' : 's'}.`;
    }

    return {
      creatorType: resolvedCreatorType,
      requestedCreatorType: creatorType,
      creatorId,
      places,
      warnings,
      message,
      usedCookie: Boolean(cookie),
    };
  });
  handleIpc('open-data-folder', async () => {
    try {
      await shell.openPath(app.getPath('userData'));
      return true;
    } catch (e: any) {
      if (DEVELOPER_MODE) console.warn('Failed to open data folder', e);
      return false;
    }
  });

  handleIpc('uninstall-app', async () => {
    try {
      if (process.platform === 'win32') {
        const uninstallerPaths = uniquePaths([
          path.join(path.dirname(process.execPath), 'Uninstall ISpooferMotion.exe'),
          path.join(process.resourcesPath, '..', 'Uninstall ISpooferMotion.exe'),
        ]);

        for (const uninstallerPath of uninstallerPaths) {
          if (!(await pathExists(uninstallerPath))) continue;
          try {
            await spawnDetached(uninstallerPath);
            app.quit();
            return { ok: true, message: 'Uninstaller started.' };
          } catch (err: any) {
            return {
              ok: false,
              message: `Could not start the Windows uninstaller: ${err.message}`,
            };
          }
        }

        return {
          ok: false,
          message:
            'The Windows uninstaller was not found. This usually means the app is running from an unpacked build or the install folder is incomplete.',
        };
      }

      const userDataPath = app.getPath('userData');
      await fs.rm(userDataPath, { recursive: true, force: true });
      app.quit();
      return { ok: true, message: 'App data removed.' };
    } catch (e: any) {
      if (DEVELOPER_MODE) console.warn('Failed to uninstall app', e);
      return { ok: false, message: e.message || 'Failed to uninstall app.' };
    }
  });

  handleIpc('get-jobs', async () => {
    return await loadJobs();
  });

  handleIpc('delete-job', async (_event: any, jobId: any) => {
    await deleteJobRecord(jobId);
    return true;
  });

  handleIpc('push-to-studio', async (_event: any, text: any) => {
    try {
      const safeText = String(text || '').trim();
      if (!safeText) return { ok: false, error: 'No output text provided.' };
      
      const count = pushReplacement(safeText);
      if (!count || count === 0) return { ok: false, error: 'No replacement pairs found in output.' };
      
      return { ok: true, count };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown error' };
    }
  });

  handleIpc('clear-app-cache', async () => {
    try {
      await session.defaultSession.clearStorageData();
      await clearSession();
      try {
        await fs.unlink(path.join(app.getPath('userData'), 'profile-secrets.json'));
      } catch {}
      return true;
    } catch (e: any) {
      if (DEVELOPER_MODE) console.warn('Failed to clear app data', e);
      return false;
    }
  });

  handleIpc('uninstall-app', async () => {
    try {
      const exeDir = path.dirname(app.getPath('exe'));
      const uninstallerPath = path.join(exeDir, 'Uninstall ISpooferMotion.exe');
      if (fsLib.existsSync(uninstallerPath)) {
        spawn(uninstallerPath, [], { detached: true, stdio: 'ignore' }).unref();
        setTimeout(() => app.quit(), 100);
        return true;
      }
      return false;
    } catch (e: any) {
      if (DEVELOPER_MODE) console.warn('Failed to run uninstaller', e);
      return false;
    }
  });

  handleIpc('open-dev-console', async () => {
    try {
      const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
      const files = await fs.readdir(logsDir);
      const logFiles = files.filter((f: any) => f.startsWith('debug-') && f.endsWith('.txt')).sort();
      if (logFiles.length === 0) return false;
      const latestLog = path.join(logsDir, logFiles[logFiles.length - 1]);

      let child;
      if (process.platform === 'win32') {
        child = spawn(
          'powershell.exe',
          ['-NoExit', '-Command', `Get-Content -Path '${latestLog}' -Wait`],
          { detached: true, stdio: 'ignore' },
        );
      } else if (process.platform === 'darwin') {
        child = spawn(
          'osascript',
          ['-e', `tell application "Terminal" to do script "tail -f '${latestLog}'"`],
          { detached: true, stdio: 'ignore' },
        );
      } else {
        child = spawn(
          'x-terminal-emulator',
          ['-e', 'tail', '-f', latestLog],
          { detached: true, stdio: 'ignore' },
        );
      }
      child.unref();
      return true;
    } catch (e: any) {
      if (DEVELOPER_MODE) console.warn('Failed to open dev console', e);
      return false;
    }
  });

  onIpc('open-external', (event: any, url: any) => {
    try {
      if (canOpenExternalUrl(url)) {
        void shell.openExternal(String(url));
      } else if (DEVELOPER_MODE) {
        console.warn('open-external called with invalid url:', url);
      }
    } catch (err: any) {
      if (DEVELOPER_MODE) console.warn('Failed to open external URL:', err);
    }
  });

  handleIpc('open-logs-folder', async () => {
    const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
    try {
      await fs.mkdir(logsDir, { recursive: true });
      const errorMessage = await shell.openPath(logsDir);
      if (errorMessage) {
        if (DEVELOPER_MODE) console.warn('Failed to open logs folder:', errorMessage);
        return false;
      }
      return true;
    } catch (err: any) {
      console.error('Failed to open logs folder:', err);
      return false;
    }
  });

  onIpc('run-spoofer-action', async (_event: any, data: any) => {
    if (spooferRunActive) {
      sendStatusMessage(
        'A spoofing operation is already running. Cancel it before starting another.',
      );
      return;
    }
    spooferRunActive = true;

    const originalConsoleLog = console.log;
    const originalConsoleWarn = console.warn;
    const originalConsoleError = console.error;

    const formatArgs = (args: any[]) =>
      args
        .map((a) => {
          if (a instanceof Error) return a.stack || a.message || String(a);
          if (typeof a === 'object') {
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          }
          return String(a);
        })
        .join(' ');

    console.log = (...args) => {
      originalConsoleLog(...args);
      sendSpooferLog({ level: 'info', message: formatArgs(args) });
    };
    console.warn = (...args) => {
      originalConsoleWarn(...args);
      sendSpooferLog({ level: 'warn', message: formatArgs(args) });
    };
    console.error = (...args) => {
      originalConsoleError(...args);
      sendSpooferLog({ level: 'error', message: formatArgs(args) });
    };

    try {
      await SpooferController.handleSpooferAction(
        data,
        getMainWindowFn,
        sendTransferUpdate,
        sendSpooferResultToRenderer,
        sendStatusMessage,
        sendSpooferLog,
        sendSpooferProgress,
      );
    } catch (err: any) {
      if (err?.message === 'Operation cancelled') {
        sendSpooferResultToRenderer({
          output: 'Operation cancelled.',
          success: false,
        });
        sendStatusMessage('Cancelled');
        return;
      }
      console.error('Unhandled spoofer action error:', err);
      sendSpooferResultToRenderer({
        output: `Unexpected error: ${err.message}`,
        success: false,
      });
      sendStatusMessage('Error occurred');
    } finally {
      console.log = originalConsoleLog;
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;
      spooferRunActive = false;
    }
  });

  onIpc('spoofer-pause', () => {
    pauseSpoofer();
    sendStatusMessage('Paused');
  });
  onIpc('spoofer-resume', () => {
    resumeSpoofer();
    sendStatusMessage('Resuming...');
  });
  onIpc('spoofer-cancel', () => {
    cancelSpoofer();
    sendStatusMessage('Cancelled');
  });
  handleIpc('check-session', () => loadSession());
  onIpc('clear-session', () => {
    void clearSession();
  });

  handleIpc('fetch-audio-quota', async (_event: any, data: any) => {
    data = normalizePayload(data);
    try {
      if (DEVELOPER_MODE)
        console.log('(Dev) Fetching audio quota with data:', {
          hasCookie: !!data.cookie,
          autoDetect: data.autoDetect,
        });

      let cookie = data.cookie;
      if (data.autoDetect && !cookie) {
        if (DEVELOPER_MODE) console.log('(Dev) Auto-detecting cookie...');
        cookie = await getCookieFromAutoDetect();
        if (DEVELOPER_MODE)
          console.log('(Dev) Auto-detected cookie:', cookie ? 'Found' : 'Not found');
      }
      if (!cookie) {
        if (DEVELOPER_MODE) console.log('(Dev) No cookie available for quota check');
        return { error: 'No cookie provided' };
      }

      const robloxSession = createRobloxSession(cookie);
      if (!robloxSession.getCookieHeader()) {
        return { error: 'Invalid ROBLOSECURITY cookie format' };
      }

      if (DEVELOPER_MODE) console.log('(Dev) Fetching from Roblox API...');
      const response = await robloxSession.fetch(
        'https://publish.roblox.com/v1/asset-quotas?resourceType=RateLimitUpload&assetType=Audio',
        {
          headers: {
            'User-Agent': 'RobloxStudio/WinInet',
          },
        },
      );

      if (DEVELOPER_MODE) console.log('(Dev) Quota API response status:', response.status);
      if (!response.ok) {
        try {
          const errorText = await response.text();
          if (DEVELOPER_MODE) console.log('(Dev) Quota API error:', errorText);
        } catch {}
        return { error: `Failed to fetch quota: ${response.status}` };
      }

      const quotaData = await response.json();
      if (DEVELOPER_MODE) console.log('(Dev) Quota data received:', quotaData);
      return quotaData;
    } catch (err: any) {
      console.error('Error fetching audio quota:', err);
      return { error: err.message };
    }
  });

  handleIpc('select-folder', async (_event: any) => {
    try {
      const result = await dialog.showOpenDialog(getMainWindowFn(), {
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    } catch (err: any) {
      console.error('Error selecting folder:', err);
      return null;
    }
  });
}
export function showDesktopNotification(title, body) { try { if (!require('electron').Notification.isSupported()) return false; const iconName = process.platform === 'win32' ? 'app_icon.ico' : 'app_icon.png'; const rawIconPath = require('path').join(__dirname, '..', 'src', 'assets', iconName); const iconPath = require('electron').app.isPackaged ? rawIconPath.replace('app.asar', 'app.asar.unpacked') : rawIconPath; new require('electron').Notification({ title: title || 'ISpooferMotion', body: body || '', icon: require('electron').nativeImage.createFromPath(iconPath) }).show(); return true; } catch (e) { return false; } }
