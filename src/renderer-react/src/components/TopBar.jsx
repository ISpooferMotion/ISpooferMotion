import { useEffect, useRef, useState } from 'react';
import appIcon from '../assets/app_icon.png';

function formatVersionTag(version) {
  const value = String(version || '1.3.15').replace(/^-?v/i, '');
  return `v${value.replace(/-hotfix\./i, '.hotfix.')}`;
}

export default function TopBar() {
  const [profilesInfo, setProfilesInfo] = useState({ activeId: null, profiles: {} });
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [version, setVersion] = useState('');
  const pickerRef = useRef(null);

  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const secrets = await window.electronAPI?.loadProfileSecrets?.();
        if (secrets) {
          setProfilesInfo({
            activeId: secrets.activeProfileId,
            profiles: secrets.profiles || {},
          });
        }
      } catch (err) {
        console.error('Failed to load profiles for top bar', err);
      }
    };
    fetchProfiles();
    window.addEventListener('profile-changed', fetchProfiles);

    const fetchMeta = async () => {
      try {
        const appVersion = await window.electronAPI?.getAppVersion?.();
        if (appVersion) setVersion(formatVersionTag(appVersion));
      } catch (err) {
        console.error('Failed to get app version for top bar', err);
      }
    };
    fetchMeta();

    return () => window.removeEventListener('profile-changed', fetchProfiles);
  }, []);

  useEffect(() => {
    if (!isProfileMenuOpen) return;
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isProfileMenuOpen]);

  const activeProfileName = profilesInfo.profiles[profilesInfo.activeId]?.name || 'Profile 1';

  return (
    <header className="top-bar">
      <div className="brand-block">
        <img className="brand-logo" src={appIcon} alt="" />
        <div className="brand-copy">
          <strong>ISpooferMotion</strong>
          <span>{version}</span>
        </div>
      </div>

      <div className="top-spacer" />

      <div
        ref={pickerRef}
        className={`profile-picker ${isProfileMenuOpen ? 'open' : ''}`}
        aria-label="Profile selector"
      >
        <button
          className="profile-trigger ui-button"
          id="profile-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isProfileMenuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setIsProfileMenuOpen((o) => !o);
          }}
        >
          <svg
            className="profile-trigger-icon"
            viewBox="0 0 24 24"
            width="15"
            height="15"
            aria-hidden="true"
          >
            <path d="M12 3a4.25 4.25 0 1 1 0 8.5A4.25 4.25 0 0 1 12 3Zm0 2a2.25 2.25 0 1 0 0 4.5A2.25 2.25 0 0 0 12 5Zm-7 14.15C5 15.9 7.92 13.5 12 13.5s7 2.4 7 5.65V21H5v-1.85Zm2.08-.15h9.84c-.13-1.97-2.05-3.5-4.92-3.5S7.21 17.03 7.08 19Z" />
          </svg>
          <span className="profile-trigger-label" id="profile-trigger-label">
            {activeProfileName}
          </span>
          <svg className="profile-trigger-arrow" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.4 9.2 12 13.8l4.6-4.6L18 10.6l-6 6-6-6 1.4-1.4Z" />
          </svg>
        </button>
        {isProfileMenuOpen && (
          <div
            className="profile-menu ui-dropdown"
            id="profile-menu"
            role="listbox"
            aria-label="Profiles"
            tabIndex="-1"
          >
            {Object.entries(profilesInfo.profiles).map(([id, profile]) => (
              <button
                key={id}
                className={`profile-option ui-button ${id === profilesInfo.activeId ? 'selected' : ''}`}
                type="button"
                role="option"
                aria-selected={id === profilesInfo.activeId}
                data-profile={id}
                onClick={async () => {
                  await window.electronAPI?.saveProfileSecrets?.({
                    action: 'setActive',
                    profileId: id,
                  });
                  setProfilesInfo((prev) => ({ ...prev, activeId: id }));
                  setIsProfileMenuOpen(false);
                  window.dispatchEvent(new Event('profile-changed'));
                }}
              >
                <span>{profile.name || 'Unnamed Profile'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="top-spacer" />

      <button
        className="top-social ui-icon-button"
        type="button"
        aria-label="Open GitHub"
        title="GitHub"
        onClick={() =>
          window.electronAPI?.openExternal?.('https://github.com/IncrediDev/ISpooferMotion')
        }
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.25A9.75 9.75 0 0 0 8.92 21.25c.48.09.66-.2.66-.46v-1.72c-2.7.59-3.27-1.16-3.27-1.16-.44-1.12-1.07-1.42-1.07-1.42-.88-.6.07-.59.07-.59.97.07 1.48 1 1.48 1 .86 1.47 2.25 1.05 2.8.8.09-.63.34-1.05.61-1.29-2.15-.24-4.42-1.08-4.42-4.79 0-1.06.38-1.92 1-2.6-.1-.25-.43-1.23.1-2.56 0 0 .81-.26 2.67.99A9.15 9.15 0 0 1 12 7.12c.83 0 1.65.11 2.43.33 1.85-1.25 2.66-.99 2.66-.99.54 1.33.2 2.31.1 2.56.62.68 1 1.54 1 2.6 0 3.72-2.27 4.54-4.43 4.78.35.31.66.9.66 1.82v2.57c0 .26.17.56.67.46A9.75 9.75 0 0 0 12 2.25Z" />
        </svg>
      </button>

      <button
        className="top-social ui-icon-button discord-button"
        type="button"
        aria-label="Open Discord"
        title="Discord"
        onClick={() => window.electronAPI?.openExternal?.('https://discord.gg/d5cJzAURBH')}
      >
        <svg viewBox="0 0 127.14 96.36" aria-hidden="true">
          <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.35 2.66-2.06a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.4 2.66 2.06a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z" />
        </svg>
      </button>

      <div className="window-controls">
        <button
          className="ui-icon-button"
          id="minimize-btn"
          type="button"
          aria-label="Minimize"
          onClick={() => window.electronAPI?.minimize?.()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 11h12v2H6v-2Z" />
          </svg>
        </button>
        <button
          className="ui-icon-button"
          id="close-btn"
          type="button"
          aria-label="Close"
          onClick={() => window.electronAPI?.close?.()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
