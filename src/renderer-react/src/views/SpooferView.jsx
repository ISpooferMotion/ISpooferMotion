import { useEffect, useRef, useState } from 'react';

export default function SpooferView({ isActive }) {
  const [animationId, setAnimationId] = useState('');
  const [robloxCookie, setRobloxCookie] = useState('');
  const [openCloudApiKey, setOpenCloudApiKey] = useState('');
  const [groupId, setGroupId] = useState('');

  const [autoDetectCookie, setAutoDetectCookie] = useState(true);
  const [downloadOnly, setDownloadOnly] = useState(false);
  const [spoofSounds, setSpoofSounds] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);

  const [downloadFolder, setDownloadFolder] = useState('');

  const [maxPlaceIds, setMaxPlaceIds] = useState(10);
  const [maxPlaceIdRetries, setMaxPlaceIdRetries] = useState(3);
  const [overridePlaceId, setOverridePlaceId] = useState('');
  const [placeSearchInput, setPlaceSearchInput] = useState('');
  const [placeCreatorType, setPlaceCreatorType] = useState('user');
  const [placeLookupOpen, setPlaceLookupOpen] = useState(false);
  const [placeTypeOpen, setPlaceTypeOpen] = useState(false);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [placeSearchMessage, setPlaceSearchMessage] = useState('');
  const [placeSuggestions, setPlaceSuggestions] = useState([]);
  const [uploadRetries, setUploadRetries] = useState(3);
  const [uploadRetryDelay, setUploadRetryDelay] = useState(5000);

  const [outputData, setOutputData] = useState('');
  const [statusText, setStatusText] = useState('No run yet');
  const [apiKeyStatus, setApiKeyStatus] = useState('');
  const [inlineQuotaText, setInlineQuotaText] = useState('Checking quota...');
  const [inlineQuotaError, setInlineQuotaError] = useState(false);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);

  // transfers tracking
  const transfersRef = useRef({
    download: { total: 0, completed: 0, failed: 0, seen: new Map() },
    upload: { total: 0, completed: 0, failed: 0, seen: new Map() },
  });

  const getActiveProfileSettings = async () => {
    try {
      const secrets = await window.electronAPI?.loadProfileSecrets?.();
      if (!secrets) return null;
      return secrets.profiles[secrets.activeProfileId];
    } catch {
      return null;
    }
  };

  const normalizePastedLine = (line) =>
    String(line || '')
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\u2060]/g, '')
      .replace(/\u00A0/g, ' ')
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })
      .join('')
      .trim();

  const handleInputTextChange = (val) => {
    setAnimationId(val);
    const markerText = val
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = normalizePastedLine(line);
        const stripped = trimmed
          .replace(/--\[\[/g, '')
          .replace(/--\]\]/g, '')
          .replace(/\bTYPE\s*:\s*(SOUND|ANIMATION)\b/gi, '')
          .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
          .replace(/[\s,\u00A0]+/g, '')
          .replace(/[-_[\]{}()*=;:|/\\]+/g, '');
        return stripped === '';
      })
      .join('\n');
    const hasSoundMarker = /\bTYPE\s*:\s*SOUND\b/i.test(markerText);
    const hasAnimationMarker = /\bTYPE\s*:\s*ANIMATION\b/i.test(markerText);
    if (hasSoundMarker && !hasAnimationMarker) {
      setSpoofSounds(true);
    } else if (hasAnimationMarker && !hasSoundMarker) {
      setSpoofSounds(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!spoofSounds) return;

    setInlineQuotaText('Checking quota...');
    setInlineQuotaError(false);

    window.electronAPI
      ?.getAudioQuota?.({ cookie: robloxCookie, autoDetect: autoDetectCookie })
      .then((result) => {
        if (!active) return;
        if (result && result.error) {
          setInlineQuotaError(true);
          setInlineQuotaText(`Quota error: ${result.error}`);
          return;
        }

        let used;
        let capacity;
        if (Array.isArray(result.quotas)) {
          const quota =
            result.quotas.find((q) => String(q?.duration).toLowerCase() === 'month') ||
            result.quotas[0];
          used = Number(quota?.usage ?? quota?.used ?? quota?.consumed ?? 0);
          capacity = Number(quota?.capacity ?? quota?.limit ?? quota?.total ?? 0);
        } else if (result.usage && typeof result.usage === 'object') {
          used = Number(result.usage.used ?? result.usage.usage ?? 0);
          capacity = Number(result.usage.capacity ?? result.usage.total ?? result.usage.limit ?? 0);
        } else {
          used = Number(result.usage ?? result.used ?? 0);
          capacity = Number(result.capacity ?? result.total ?? result.limit ?? 0);
        }

        if (!Number.isFinite(used) || !Number.isFinite(capacity) || capacity <= 0) {
          setInlineQuotaText('Quota data unavailable.');
        } else {
          const remaining = Math.max(0, capacity - used);
          setInlineQuotaText(
            `Audio quota: ${used.toLocaleString()} / ${capacity.toLocaleString()} used (${remaining.toLocaleString()} remaining)`,
          );
        }
      })
      .catch((err) => {
        if (!active) return;
        setInlineQuotaError(true);
        setInlineQuotaText(`Quota error: ${err.message}`);
      });

    return () => {
      active = false;
    };
  }, [spoofSounds, robloxCookie, autoDetectCookie]);

  useEffect(() => {
    // When profile changes, we want to update the fields
    const handleProfileChanged = async () => {
      const profile = await getActiveProfileSettings();
      if (profile) {
        setRobloxCookie(profile.cookie ?? '');
        setOpenCloudApiKey(profile.apiKey ?? '');
        setGroupId(profile.groupId ?? '');
        setAutoDetectCookie(profile.autoDetectCookie ?? true);
        setDownloadOnly(profile.downloadOnly ?? false);
        setSpoofSounds(profile.spoofSounds ?? false);
        setOverridePlaceId(profile.overridePlaceId ?? '');
        setPlaceSearchInput(profile.placeSearchInput ?? profile.groupId ?? '');
        setPlaceCreatorType(profile.placeCreatorType ?? (profile.groupId ? 'group' : 'user'));
      }
    };
    window.addEventListener('profile-changed', handleProfileChanged);
    handleProfileChanged();

    // IPC listeners
    const cleanupStatus = window.electronAPI?.onStatusUpdate?.((msg) => {
      setStatusText(msg || 'Ready'); // Basic normalization logic here
    });

    const cleanupResult = window.electronAPI?.onSpooferResult?.((result) => {
      setRunning(false);
      setPaused(false);
      if (result) {
        const output = typeof result === 'string' ? result : result.output;
        if (output != null) setOutputData(String(output));
        const isSuccess = result.success !== false;
        setStatusText(isSuccess ? 'Complete' : 'Failed');
      }
    });

    const cleanupTransfer = window.electronAPI?.onTransferUpdate?.((update) => {
      if (!update) return;
      const direction = update.direction === 'upload' ? 'upload' : 'download';
      const phase = transfersRef.current[direction];
      const id = update.id ? String(update.id) : `${direction}:${phase.seen.size}`;
      const previous = phase.seen.get(id) || { status: null };
      const status = String(update.status || previous.status || '').toLowerCase();

      if (!phase.seen.has(id)) {
        phase.seen.set(id, { status });
        phase.total = phase.seen.size;
      }

      if (status === 'completed' && previous.status !== 'completed') phase.completed += 1;
      if (status === 'error' && previous.status !== 'error') phase.failed += 1;

      phase.seen.set(id, { status });

    });

    const cleanupLocalhostScan = window.electronAPI?.onLocalhostScanResults?.((scan) => {
      if (!scan) return;
      const importedText = String(scan.text || '').trim();
      const scannedPlaceId = String(scan.placeId || '').replace(/\D/g, '');
      const hasScannedPlaceId = scannedPlaceId && scannedPlaceId !== '0';
      handleInputTextChange(importedText);
      setSpoofSounds(scan.kind === 'sound');
      void updateProfileValue('spoofSounds', scan.kind === 'sound');
      if (hasScannedPlaceId) {
        setOverridePlaceId(scannedPlaceId);
        setPlaceSearchInput(scannedPlaceId);
        setPlaceCreatorType('place');
        void updateProfileValue('overridePlaceId', scannedPlaceId);
        void updateProfileValue('placeSearchInput', scannedPlaceId);
        void updateProfileValue('placeCreatorType', 'place');
      }
      setStatusText(
        `${scan.label || 'Plugin'} scan imported: ${scan.count || 0} ID${scan.count === 1 ? '' : 's'}.${hasScannedPlaceId ? ` Selected Studio place ${scannedPlaceId}.` : ''}`,
      );
    });

    return () => {
      window.removeEventListener('profile-changed', handleProfileChanged);
      cleanupStatus && cleanupStatus();
      cleanupResult && cleanupResult();
      cleanupTransfer && cleanupTransfer();
      cleanupLocalhostScan && cleanupLocalhostScan();
    };
  }, []);

  const handleRun = async () => {
    if (running) {
      window.electronAPI?.cancelSpoofer?.();
      setRunning(false);
      setStatusText('Cancelled');
      return;
    }

    if (!animationId.trim()) {
      setStatusText('Paste at least one asset entry first.');
      return;
    }
    if (downloadOnly && !downloadFolder) {
      setStatusText('Choose a download folder for Download only mode.');
      return;
    }
    if (!downloadOnly && !openCloudApiKey) {
      setStatusText('Open Cloud API key is required for upload/spoofing.');
      return;
    }
    if (!autoDetectCookie && !robloxCookie) {
      setStatusText('Enter a Roblox cookie or enable Auto detect cookie.');
      return;
    }

    const normalizedApiKey = openCloudApiKey.trim();
    if (!downloadOnly) {
      setStatusText('Checking API key...');
      const apiKeyValidation = await window.electronAPI?.validateOpenCloudApiKey?.(normalizedApiKey);
      if (!apiKeyValidation?.ok) {
        setApiKeyStatus(apiKeyValidation?.message || 'API key is invalid.');
        setStatusText('API key validation failed.');
        return;
      }
      setOpenCloudApiKey(normalizedApiKey);
      setApiKeyStatus(apiKeyValidation.message || 'API key saved.');
      await updateProfileValue('apiKey', normalizedApiKey);
    }

    setRunning(true);
    setPaused(false);
    setStatusText('Starting...');
    setOutputData('');
    transfersRef.current = {
      download: { total: 0, completed: 0, failed: 0, seen: new Map() },
      upload: { total: 0, completed: 0, failed: 0, seen: new Map() },
    };
    // Fetch the rest of the settings from active profile
    const profile = (await getActiveProfileSettings()) || {};

    const payload = {
      animationId,
      robloxCookie,
      apiKey: normalizedApiKey,
      groupId,
      spoofSounds,
      enableSpoofing: !downloadOnly,
      downloadOnly,
      autoDetectCookie,
      downloadFolder,
      maxPlaceIds,
      maxPlaceIdRetries,
      overridePlaceId,
      uploadRetries,
      uploadRetryDelay,

      // Defaults from profile/settings
      batchRetries: profile.defRetries ?? 3,
      batchRetryDelay: profile.defDelay ?? 5000,
      batchTimeoutMs: 15000,
      batchChunkSize: overridePlaceId ? 50 : 20,
      downloadRetries: 2,
      downloadRetryDelayMs: 2000,
      downloadTimeoutMs: 15000,
      concurrentUploads: profile.concurrent ?? true,
      maxConcurrentUploads: profile.maxConcurrentUploads ?? 10,
      replaceExisting,
      renamePrefix: profile.renameToggle ? profile.renamePrefix ?? '' : '',
      renameSuffix: profile.renameToggle ? profile.renameSuffix ?? '' : '',
      renameFind: profile.renameToggle ? profile.renameFind ?? '' : '',
      renameReplace: profile.renameToggle ? profile.renameReplace ?? '' : '',
      maxConcurrentDownloads: profile.maxConcurrentDownloads ?? 20,
      desktopNotifications: profile.notifications ?? true,
    };

    window.electronAPI?.runSpooferAction?.(payload);
  };

  const handlePauseResume = () => {
    if (!running) return;
    if (paused) {
      window.electronAPI?.resumeSpoofer?.();
      setPaused(false);
      setStatusText('Resuming...');
    } else {
      window.electronAPI?.pauseSpoofer?.();
      setPaused(true);
      setStatusText('Paused');
    }
  };

  const handleSelectFolder = async (e) => {
    e.preventDefault();
    try {
      const folder = await window.electronAPI?.selectFolder?.();
      if (folder) setDownloadFolder(folder);
    } catch {
      setStatusText('Could not select folder.');
    }
  };

  // Profile saving helper
  const updateProfileValue = async (key, value) => {
    try {
      const secrets = await window.electronAPI?.loadProfileSecrets?.();
      const activeId = secrets?.activeProfileId;
      if (!activeId) return;
      await window.electronAPI?.saveProfileSecrets?.({
        action: 'patchProfile',
        profileId: activeId,
        secrets: { [key]: value },
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleApiKeyBlur = async () => {
    const trimmed = openCloudApiKey.trim();
    setOpenCloudApiKey(trimmed);
    if (!trimmed) {
      setApiKeyStatus('API key removed.');
      await updateProfileValue('apiKey', '');
      return;
    }

    setApiKeyStatus('Checking API key...');
    try {
      const result = await window.electronAPI?.validateOpenCloudApiKey?.(trimmed);
      if (!result?.ok) {
        setApiKeyStatus(result?.message || 'API key is invalid.');
        return;
      }
      await updateProfileValue('apiKey', trimmed);
      setApiKeyStatus(result.message || 'API key saved.');
    } catch (err) {
      setApiKeyStatus(`Could not validate API key: ${err.message}`);
    }
  };

  const handlePlaceSearch = async () => {
    const rawInput = placeSearchInput.trim();
    const lookupInput = placeCreatorType === 'place' ? rawInput : rawInput.replace(/\D/g, '');
    setPlaceSuggestions([]);
    if (!lookupInput) {
      setPlaceSearchMessage(placeCreatorType === 'place' ? 'Enter a Place ID or Roblox game URL.' : 'Enter a numeric User ID or Group ID.');
      return;
    }

    if (placeCreatorType !== 'place') setPlaceSearchInput(lookupInput);
    setPlaceSearchLoading(true);
    setPlaceSearchMessage('Searching places...');
    try {
      const result = await window.electronAPI?.searchPlaceIds?.({
        input: lookupInput,
        creatorType: placeCreatorType,
        cookie: robloxCookie,
        autoDetect: autoDetectCookie,
        maxPlaceIds,
      });
      const places = result?.places || [];
      setPlaceSuggestions(places);
      await updateProfileValue('placeSearchInput', lookupInput);
      const resolvedCreatorType = result?.creatorType === 'group' ? 'group' : result?.creatorType === 'place' ? 'place' : 'user';
      if (resolvedCreatorType !== placeCreatorType) {
        setPlaceCreatorType(resolvedCreatorType);
      }
      await updateProfileValue('placeCreatorType', resolvedCreatorType);

      if (places.length === 1) {
        setOverridePlaceId(places[0].placeId);
        await updateProfileValue('overridePlaceId', places[0].placeId);
        setPlaceSearchMessage(
          `${result?.message || 'Found 1 place.'} Selected ${places[0].placeId}.`,
        );
      } else if (places.length > 1) {
        setPlaceSearchMessage(result?.message || `Found ${places.length} places. Choose one below.`);
      } else {
        setPlaceSearchMessage(
          result?.message ||
            'No places found. Check the ID, owner type, cookie, and creator permissions.',
        );
      }
    } catch (err) {
      setPlaceSearchMessage(err.message || 'Place search failed.');
    } finally {
      setPlaceSearchLoading(false);
    }
  };

  const selectSuggestedPlace = async (place) => {
    setOverridePlaceId(place.placeId);
    setPlaceSearchMessage(`Selected ${place.name} (${place.placeId}).`);
    await updateProfileValue('overridePlaceId', place.placeId);
  };

  return (
    <section
      className={`view spoofer-view ${isActive ? 'is-active' : ''}`}
      data-view-panel="spoofer"
      aria-label="Spoofer"
    >
      <div className="spoofer-page" id="spoofer-page">
        <div className="bento-grid">
          <div className="bento-card asset-card">
            <div className="asset-input-wrapper">
              <div className="asset-header">
                <h3>Asset IDs</h3>
                <span className="asset-hint">Supports [assetId], [name], and [User:123] / [Group:123]</span>
              </div>
              <textarea
                className="ui-textarea code-input asset-textarea"
                id="animationId"
                name="animationId"
                placeholder="[12345678] [ExampleAsset] [User:12345]"
                value={animationId}
                onChange={(e) => handleInputTextChange(e.target.value)}
              ></textarea>
            </div>
            <div className="asset-actions">
              <button
                className={`primary-action ${running ? 'is-cancel-mode' : ''}`}
                id="run-spoofer-btn"
                type="button"
                onClick={handleRun}
              >
                {running ? 'Cancel' : 'Start'}
              </button>
              <button
                className="ui-button"
                id="pause-resume-spoofer-btn"
                type="button"
                disabled={!running}
                onClick={handlePauseResume}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
            </div>
          </div>

          <div className="bento-card setup-card">
            <h3>Quick Setup</h3>
            <div className="bento-fields">
              <label className="floating-label">
                <input
                  className="ui-input"
                  type="password"
                  id="robloxCookie"
                  name="robloxCookie"
                  placeholder=" "
                  autoComplete="off"
                  disabled={autoDetectCookie}
                  value={robloxCookie}
                  onChange={(e) => {
                    setRobloxCookie(e.target.value);
                    updateProfileValue('cookie', e.target.value);
                  }}
                />
                <span>Roblox Cookie {autoDetectCookie && '(Auto detect on)'}</span>
              </label>
              <label className="floating-label api-key-row">
                <div className="input-button-row embedded-button-row">
                  <input
                    className="ui-input"
                    type="password"
                    id="openCloudApiKey"
                    name="openCloudApiKey"
                    placeholder=" "
                    autoComplete="off"
                  value={openCloudApiKey}
                  onChange={(e) => {
                    setOpenCloudApiKey(e.target.value);
                    setApiKeyStatus('Unsaved changes. Leave the field to validate and save.');
                  }}
                  onBlur={handleApiKeyBlur}
                />
                  <span>Open Cloud API Key</span>
                  <button
                    className="ui-button get-api-key-btn"
                    id="get-api-key-btn"
                    type="button"
                    onClick={() =>
                      window.electronAPI?.openExternal?.(
                        'https://create.roblox.com/dashboard/credentials',
                      )
                    }
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3m-2 16H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7Z" />
                    </svg>
                    Get Key
                  </button>
                </div>
                {apiKeyStatus && <span className="field-status">{apiKeyStatus}</span>}
              </label>
              <label className="floating-label">
                <input
                  className="ui-input"
                  type="text"
                  id="groupId"
                  name="groupId"
                  placeholder=" "
                  autoComplete="off"
                  disabled={downloadOnly}
                  value={groupId}
                  onChange={(e) => {
                    const next = e.target.value.replace(/\D/g, '');
                    setGroupId(next);
                    updateProfileValue('groupId', next);
                  }}
                />
                <span>Group ID (Blank for user)</span>
              </label>
              <div className="switches-row">
                <label className="option-row inline-option" htmlFor="autoDetectCookie">
                  <span>Auto detect cookie</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      id="autoDetectCookie"
                      checked={autoDetectCookie}
                      onChange={(e) => {
                        setAutoDetectCookie(e.target.checked);
                        updateProfileValue('autoDetectCookie', e.target.checked);
                      }}
                    />
                    <i></i>
                  </span>
                </label>
                <label className="option-row" htmlFor="download-only">
                  <span>Download only</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      id="download-only"
                      checked={downloadOnly}
                      onChange={(e) => {
                        setDownloadOnly(e.target.checked);
                        updateProfileValue('downloadOnly', e.target.checked);
                      }}
                    />
                    <i></i>
                  </span>
                </label>
                <label className="option-row" htmlFor="spoof-sounds">
                  <span>Sound mode</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      id="spoof-sounds"
                      checked={spoofSounds}
                      onChange={(e) => {
                        setSpoofSounds(e.target.checked);
                        updateProfileValue('spoofSounds', e.target.checked);
                      }}
                    />
                    <i></i>
                  </span>
                </label>
                <label className="option-row" htmlFor="replace-existing">
                  <span>Replace existing</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      id="replace-existing"
                      checked={replaceExisting}
                      onChange={(e) => setReplaceExisting(e.target.checked)}
                    />
                    <i></i>
                  </span>
                </label>
              </div>

              <div
                className={`download-folder-wrap ${downloadOnly ? 'is-visible' : ''}`}
                id="download-folder-group"
              >
                <div className="download-folder-inner">
                  <label className="floating-label api-key-row">
                    <div className="input-button-row embedded-button-row">
                      <input
                        className="ui-input"
                        type="text"
                        id="downloadFolder"
                        name="downloadFolder"
                        placeholder=" "
                        readOnly
                        value={downloadFolder}
                      />
                      <span>Download folder</span>
                      <button
                        className="ui-button get-api-key-btn"
                        id="select-folder-btn"
                        type="button"
                        onClick={handleSelectFolder}
                      >
                        Select
                      </button>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="setup-divider"></div>

            <div className="advanced-setup-card">
              <h3>Advanced Settings</h3>
              <div className="bento-fields advanced-fields">
                <label className="floating-label">
                  <input
                    className="ui-input"
                    type="number"
                    id="uploadRetries"
                    name="uploadRetries"
                    value={uploadRetries}
                    min="1"
                    max="10"
                    placeholder=" "
                    onChange={(e) => setUploadRetries(Number(e.target.value))}
                  />
                  <span>Upload retries</span>
                </label>
                <label className="floating-label">
                  <input
                    className="ui-input"
                    type="number"
                    id="uploadRetryDelay"
                    name="uploadRetryDelay"
                    value={uploadRetryDelay}
                    min="1000"
                    step="1000"
                    placeholder=" "
                    onChange={(e) => setUploadRetryDelay(Number(e.target.value))}
                  />
                  <span>Retry delay (ms)</span>
                </label>
                <div className={`advanced-dropdown ${placeLookupOpen ? 'is-open' : ''}`}>
                  <button
                    className="advanced-dropdown-trigger ui-button"
                    type="button"
                    aria-expanded={placeLookupOpen}
                    onClick={() => setPlaceLookupOpen((open) => !open)}
                  >
                    <span>Place ID lookup</span>
                    <strong>{overridePlaceId ? `Selected: ${overridePlaceId}` : 'Auto discover'}</strong>
                    <svg className="profile-trigger-arrow" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7.4 9.2 12 13.8l4.6-4.6L18 10.6l-6 6-6-6 1.4-1.4Z" />
                    </svg>
                  </button>
                  <div className="advanced-dropdown-panel">
                    <label className="floating-label">
                      <input
                        className="ui-input"
                        type="text"
                        id="overridePlaceId"
                        name="overridePlaceId"
                        placeholder=" "
                        value={overridePlaceId}
                        onChange={(e) => {
                          const next = e.target.value.replace(/\D/g, '');
                          setOverridePlaceId(next);
                          updateProfileValue('overridePlaceId', next);
                        }}
                      />
                      <span>Override place ID</span>
                    </label>
                    <div className="place-options-grid">
                      <label className="floating-label">
                        <input
                          className="ui-input"
                          type="number"
                          id="maxPlaceIds"
                          name="maxPlaceIds"
                          value={maxPlaceIds}
                          min="10"
                          max="50"
                          placeholder=" "
                          onChange={(e) => setMaxPlaceIds(Number(e.target.value))}
                        />
                        <span>Max places</span>
                      </label>
                      <label className="floating-label">
                        <input
                          className="ui-input"
                          type="number"
                          id="maxPlaceIdRetries"
                          name="maxPlaceIdRetries"
                          value={maxPlaceIdRetries}
                          min="1"
                          max="10"
                          placeholder=" "
                          onChange={(e) => setMaxPlaceIdRetries(Number(e.target.value))}
                        />
                        <span>Max retries</span>
                      </label>
                    </div>
                    <div className="place-search-block">
                      <div className="place-search-row">
                    <div className={`profile-picker place-type-picker ${placeTypeOpen ? 'open' : ''}`}>
                      <button
                        className="profile-trigger ui-button"
                        type="button"
                        aria-label="Place owner type"
                        aria-expanded={placeTypeOpen}
                        onClick={() => setPlaceTypeOpen((open) => !open)}
                      >
                        <span className="profile-trigger-label">
                          {placeCreatorType === 'group' ? 'Group ID' : placeCreatorType === 'place' ? 'Place ID / URL' : 'User ID'}
                        </span>
                        <svg className="profile-trigger-arrow" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M7.4 9.2 12 13.8l4.6-4.6L18 10.6l-6 6-6-6 1.4-1.4Z" />
                        </svg>
                      </button>
                      {placeTypeOpen && (
                        <div className="profile-menu ui-dropdown" role="listbox">
                          {[
                            ['user', 'User ID'],
                            ['group', 'Group ID'],
                            ['place', 'Place ID / URL'],
                          ].map(([value, label]) => (
                            <button
                              key={value}
                              className={`profile-option ui-button ${placeCreatorType === value ? 'selected' : ''}`}
                              type="button"
                              role="option"
                              aria-selected={placeCreatorType === value}
                              onClick={() => {
                                setPlaceCreatorType(value);
                                setPlaceTypeOpen(false);
                                updateProfileValue('placeCreatorType', value);
                              }}
                            >
                              <span>{label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <label className="floating-label place-search-input">
                      <input
                        className="ui-input"
                        type="text"
                        inputMode={placeCreatorType === 'place' ? 'text' : 'numeric'}
                        id="placeSearchInput"
                        name="placeSearchInput"
                        placeholder=" "
                        value={placeSearchInput}
                        onChange={(e) =>
                          setPlaceSearchInput(placeCreatorType === 'place' ? e.target.value : e.target.value.replace(/\D/g, ''))
                        }
                      />
                      <span>{placeCreatorType === 'group' ? 'Group ID for place search' : placeCreatorType === 'place' ? 'Place ID or Roblox game URL' : 'User ID for place search'}</span>
                    </label>
                    <button
                      className="ui-button place-search-button"
                      type="button"
                      disabled={placeSearchLoading}
                      onClick={handlePlaceSearch}
                    >
                      {placeSearchLoading ? 'Searching...' : placeCreatorType === 'place' ? 'Use Place' : 'Find Places'}
                    </button>
                      </div>
                      {placeSearchMessage && <div className="field-status">{placeSearchMessage}</div>}
                      {placeSuggestions.length > 1 && (
                        <div className="place-suggestion-list">
                          {placeSuggestions.map((place) => (
                            <button
                              className={`place-suggestion ${overridePlaceId === place.placeId ? 'is-selected' : ''}`}
                              key={place.placeId}
                              type="button"
                              onClick={() => selectSuggestedPlace(place)}
                            >
                              <span>{place.name}</span>
                              <strong>{place.placeId}</strong>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bento-card output-card">
            <div className="output-header section-heading">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h3>Output</h3>
                <div
                  className={`inline-quota ${spoofSounds ? 'show' : ''} ${inlineQuotaError ? 'error' : ''}`}
                  id="inline-quota"
                  aria-live="polite"
                >
                  <span id="inline-quota-text">{inlineQuotaText}</span>
                </div>
              </div>
              <span className="spoofer-status-text" id="status-text">
                {statusText}
              </span>
            </div>
            <textarea
              className="ui-textarea output-textarea"
              id="output-data"
              readOnly
              placeholder="Run output appears here."
              value={outputData}
            ></textarea>
            <div className="output-actions">
              <button
                className="ui-button push-to-studio-btn"
                id="push-to-studio-btn"
                type="button"
                disabled={!outputData || running}
                onClick={async () => {
                  if (!outputData) {
                    setStatusText('No output to push — run a spoof first.');
                    return;
                  }
                  setStatusText('Pushing to Studio...');
                  try {
                    const result = await window.electronAPI?.pushToStudio?.(outputData);
                    if (result?.ok) {
                      setStatusText(
                        `Pushed ${result.count} replacement${result.count === 1 ? '' : 's'} to Studio — plugin will auto-replace shortly.`,
                      );
                    } else {
                      setStatusText(`Push failed: ${result?.error || 'Unknown error'}`);
                    }
                  } catch (err) {
                    setStatusText(`Push failed: ${err.message}`);
                  }
                }}
              >
                Push to Studio
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
