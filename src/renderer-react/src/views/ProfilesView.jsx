import { useEffect, useRef, useState } from 'react';

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM8 9h8v10H8V9Zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5Z" />
  </svg>
);

export default function ProfilesView({ isActive }) {
  const [profiles, setProfiles] = useState({});
  const [activeId, setActiveId] = useState(null);

  const [profileName, setProfileName] = useState('');
  const [cookie, setCookie] = useState('');
  const [autoDetect, setAutoDetect] = useState(true);
  const [groupId, setGroupId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState('');

  const [robloxData, setRobloxData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Confirm-before-delete state: null | 'confirm'
  const [deleteState, setDeleteState] = useState(null);
  const deleteTimeoutRef = useRef(null);

  useEffect(() => {
    loadProfiles();
  }, []);

  // Clean up confirm timeout on unmount
  useEffect(() => {
    return () => clearTimeout(deleteTimeoutRef.current);
  }, []);

  async function loadProfiles() {
    try {
      const secrets = await window.electronAPI?.loadProfileSecrets?.();
      if (secrets) {
        setProfiles(secrets.profiles || {});
        let newActiveId = secrets.activeProfileId;
        if (!secrets.profiles[newActiveId]) {
          const remaining = Object.keys(secrets.profiles);
          if (remaining.length > 0) newActiveId = remaining[0];
        }
        setActiveId(newActiveId);
        applyProfileToState(newActiveId, secrets.profiles);
      }
    } catch (error) {
      console.error('Failed to load profiles', error);
    }
  }

  function applyProfileToState(id, allProfiles) {
    setDeleteState(null);
    const profile = allProfiles[id];
    if (profile) {
      setProfileName(profile.name || 'Unnamed Profile');
      setCookie(profile.cookie || '');
      setAutoDetect(profile.autoDetectCookie ?? true);
      setGroupId(profile.groupId || '');
      setApiKey(profile.apiKey || '');
      fetchRobloxData(profile.cookie, profile.groupId, profile.autoDetectCookie ?? true, id);
    } else {
      setRobloxData(null);
    }
  }

  async function fetchRobloxData(cookieVal, groupIdVal, autoDetectVal, profileId = activeId) {
    if (!cookieVal && !autoDetectVal) {
      setRobloxData(null);
      return;
    }
    setIsLoading(true);
    try {
      const data = await window.electronAPI?.getRobloxProfile?.({
        cookie: cookieVal,
        groupId: groupIdVal,
        autoDetect: autoDetectVal,
        profileId,
      });
      setRobloxData(data);
    } catch {
      setRobloxData(null);
    }
    setIsLoading(false);
  }

  const makeUniqueProfileName = (name, excludeId = null) => {
    const baseName = String(name || 'Unnamed Profile').trim() || 'Unnamed Profile';
    const existingNames = new Set(
      Object.entries(profiles)
        .filter(([id]) => id !== excludeId)
        .map(([, profile]) =>
          String(profile.name || '')
            .trim()
            .toLowerCase(),
        ),
    );
    if (!existingNames.has(baseName.toLowerCase())) return baseName;

    let index = 2;
    let candidate = `${baseName} ${index}`;
    while (existingNames.has(candidate.toLowerCase())) {
      index += 1;
      candidate = `${baseName} ${index}`;
    }
    return candidate;
  };

  const updateProfile = async (updates) => {
    if (!activeId) return;
    const normalizedUpdates = { ...updates };
    if (normalizedUpdates.name !== undefined) {
      normalizedUpdates.name = makeUniqueProfileName(normalizedUpdates.name, activeId);
    }
    const newProfiles = { ...profiles };
    newProfiles[activeId] = { ...newProfiles[activeId], ...normalizedUpdates };
    setProfiles(newProfiles);

    if (normalizedUpdates.name !== undefined) setProfileName(normalizedUpdates.name);
    if (normalizedUpdates.cookie !== undefined) setCookie(normalizedUpdates.cookie);
    if (normalizedUpdates.autoDetectCookie !== undefined)
      setAutoDetect(normalizedUpdates.autoDetectCookie);
    if (normalizedUpdates.groupId !== undefined) setGroupId(normalizedUpdates.groupId);
    if (normalizedUpdates.apiKey !== undefined) setApiKey(normalizedUpdates.apiKey);

    await window.electronAPI?.saveProfileSecrets?.({
      action: 'patchProfile',
      profileId: activeId,
      secrets: normalizedUpdates,
    });

    window.dispatchEvent(new Event('profile-changed'));

    if (
      normalizedUpdates.cookie !== undefined ||
      normalizedUpdates.groupId !== undefined ||
      normalizedUpdates.autoDetectCookie !== undefined
    ) {
      const p = newProfiles[activeId];
      fetchRobloxData(p.cookie, p.groupId, p.autoDetectCookie ?? true, activeId);
    }
  };

  const createProfile = async () => {
    const newId = `profile_${Date.now()}`;
    const newProfile = {
      name: makeUniqueProfileName('New Profile'),
      cookie: '',
      apiKey: '',
      groupId: '',
    };
    await window.electronAPI?.saveProfileSecrets?.({
      action: 'saveProfile',
      profileId: newId,
      secrets: newProfile,
    });
    const updatedProfiles = { ...profiles, [newId]: newProfile };
    setProfiles(updatedProfiles);
    await window.electronAPI?.saveProfileSecrets?.({ action: 'setActive', profileId: newId });
    setActiveId(newId);
    applyProfileToState(newId, updatedProfiles);
    window.dispatchEvent(new Event('profile-changed'));
  };

  const saveApiKey = async () => {
    if (!activeId) return;
    const trimmed = apiKey.trim();
    setApiKey(trimmed);
    if (!trimmed) {
      await updateProfile({ apiKey: '' });
      setApiKeyStatus('API key removed.');
      return;
    }

    setApiKeyStatus('Checking API key…');
    try {
      const result = await window.electronAPI?.validateOpenCloudApiKey?.(trimmed);
      if (!result?.ok) {
        setApiKeyStatus(result?.message || 'API key is invalid.');
        return;
      }
      await updateProfile({ apiKey: trimmed });
      setApiKeyStatus(result.message || 'API key saved.');
    } catch (err) {
      setApiKeyStatus(`Could not validate API key: ${err.message}`);
    }
  };

  const handleDeleteClick = async () => {
    if (Object.keys(profiles).length <= 1) return;

    if (deleteState !== 'confirm') {
      // First click: enter confirm mode, auto-cancel after 3s
      setDeleteState('confirm');
      deleteTimeoutRef.current = setTimeout(() => setDeleteState(null), 3000);
      return;
    }

    // Second click: actually delete
    clearTimeout(deleteTimeoutRef.current);
    setDeleteState(null);
    await window.electronAPI?.saveProfileSecrets?.({
      action: 'deleteProfile',
      profileId: activeId,
    });
    loadProfiles();
  };

  const selectProfile = async (id) => {
    if (!profiles[id]) return;
    await window.electronAPI?.saveProfileSecrets?.({ action: 'setActive', profileId: id });
    setActiveId(id);
    applyProfileToState(id, profiles);
    window.dispatchEvent(new Event('profile-changed'));
  };

  const profileCount = Object.keys(profiles).length;
  const canDelete = profileCount > 1;

  return (
    <section
      className={`view profiles-view ${isActive ? 'is-active' : ''}`}
      data-view-panel="profiles"
      aria-label="Profiles"
    >
      <div className="profiles-page" id="profiles-page">
        <div className="profiles-sidebar">
          <div className="profiles-list" id="profiles-list">
            {Object.entries(profiles).map(([id, profile]) => (
              <button
                key={id}
                className={`profile-list-item ${id === activeId ? 'active' : ''}`}
                onClick={() => selectProfile(id)}
              >
                {profile.name || 'Unnamed Profile'}
              </button>
            ))}
          </div>
          <button
            className="ui-button add-profile-btn"
            id="btn-add-profile"
            type="button"
            onClick={createProfile}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            New Profile
          </button>
        </div>

        <div className="profiles-detail" id="profiles-detail-view">
          <div className="profile-detail-header">
            <input
              type="text"
              className="ui-input profile-name-input"
              id="profile-name"
              placeholder="Profile Name"
              spellCheck="false"
              value={profileName}
              onChange={(e) => updateProfile({ name: e.target.value })}
            />
            <button
              className={`ui-button profile-delete-btn ${deleteState === 'confirm' ? 'confirming' : ''}`}
              id="btn-delete-profile"
              type="button"
              aria-label={deleteState === 'confirm' ? 'Confirm delete' : 'Delete Profile'}
              title={
                !canDelete
                  ? 'Cannot delete the last profile'
                  : deleteState === 'confirm'
                    ? 'Click again to confirm deletion'
                    : 'Delete Profile'
              }
              disabled={!canDelete}
              onClick={handleDeleteClick}
            >
              <TrashIcon />
              <span>{deleteState === 'confirm' ? 'Confirm?' : 'Delete'}</span>
            </button>
          </div>

          <div className="bento-fields profile-fields">
            <label className="floating-label">
              <input
                className="ui-input"
                type="password"
                id="profile-cookie"
                placeholder=" "
                autoComplete="off"
                spellCheck="false"
                disabled={autoDetect}
                value={cookie}
                onChange={(e) => updateProfile({ cookie: e.target.value })}
              />
              <span>Roblox Cookie {autoDetect && !cookie ? '(Auto detect on)' : ''}</span>
            </label>
            <label className="option-row inline-option" htmlFor="profile-autoDetectCookie">
              <span>Auto detect cookie</span>
              <span className="switch">
                <input
                  type="checkbox"
                  id="profile-autoDetectCookie"
                  checked={autoDetect}
                  onChange={(e) => updateProfile({ autoDetectCookie: e.target.checked })}
                />
                <i></i>
              </span>
            </label>
            <label className="floating-label">
              <input
                className="ui-input"
                type="text"
                id="profile-groupid"
                placeholder=" "
                autoComplete="off"
                spellCheck="false"
                value={groupId}
                onChange={(e) => updateProfile({ groupId: e.target.value.replace(/\D/g, '') })}
              />
              <span>Roblox Group ID</span>
            </label>
            <label className="floating-label api-key-row">
              <div className="input-button-row embedded-button-row">
                <input
                  className="ui-input"
                  type="password"
                  id="profile-apikey"
                  placeholder=" "
                  autoComplete="off"
                  spellCheck="false"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setApiKeyStatus('Unsaved changes. Leave the field to validate and save.');
                  }}
                  onBlur={saveApiKey}
                />
                <span>Open Cloud API Key</span>
                <button
                  className="ui-button get-api-key-btn"
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
          </div>

          <div
            className="roblox-data-bento"
            id="profile-roblox-data"
            style={{ display: !cookie && !autoDetect ? 'none' : 'flex' }}
          >
            <div className="roblox-data-col" id="profile-user-data" style={{ display: 'flex' }}>
              {robloxData?.user?.avatarUrl && (
                <img
                  src={robloxData.user.avatarUrl}
                  className="roblox-avatar"
                  id="profile-user-avatar"
                  alt="User Avatar"
                />
              )}
              <div className="roblox-data-info">
                <span className={`roblox-data-name ${isLoading ? 'loading-dots' : ''}`} id="profile-user-name">
                  {isLoading ? 'Loading' : robloxData?.user?.name || 'Invalid Cookie'}
                </span>
                <span className="roblox-data-id" id="profile-user-id">
                  {robloxData?.user ? `@${robloxData.user.name} · ${robloxData.user.id}` : ''}
                </span>
              </div>
            </div>

            {(groupId || robloxData?.group) && (
              <>
                <div
                  className="roblox-data-divider"
                  id="profile-data-divider"
                  style={{ display: 'block' }}
                ></div>
                <div
                  className="roblox-data-col"
                  id="profile-group-data"
                  style={{ display: 'flex' }}
                >
                  {robloxData?.group?.iconUrl && (
                    <img
                      src={robloxData.group.iconUrl}
                      className="roblox-avatar"
                      id="profile-group-icon"
                      alt="Group Icon"
                    />
                  )}
                  <div className="roblox-data-info">
                    <span className={`roblox-data-name ${isLoading ? 'loading-dots' : ''}`} id="profile-group-name">
                      {isLoading ? 'Loading' : robloxData?.group?.name || 'Invalid Group ID'}
                    </span>
                    <span className="roblox-data-id" id="profile-group-id">
                      {robloxData?.group ? `Group ID: ${robloxData.group.id}` : ''}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
