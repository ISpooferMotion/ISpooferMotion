import { useEffect, useState } from 'react';
import appIcon from '../assets/app_icon.png';

function formatVersionTag(version) {
  const value = String(version || '1.3.13-hotfix.2').replace(/^-?v/i, '');
  return `v${value.replace(/-hotfix\./i, '.hotfix.')}`;
}

export default function Sidebar({ currentView, setCurrentView }) {
  const [version, setVersion] = useState('v1.3.13.hotfix.2');
  const [source, setSource] = useState('Release source...');

  useEffect(() => {
    const fetchMeta = async () => {
      try {
        const appVersion = await window.electronAPI?.getAppVersion?.();
        if (appVersion) setVersion(formatVersionTag(appVersion));
        const releaseSource = await window.electronAPI?.getReleaseSource?.();
        if (releaseSource) setSource(releaseSource);
      } catch (err) {
        console.error('Failed to get release source', err);
      }
    };
    fetchMeta();
  }, []);

  const openDonate = () => {
    window.electronAPI?.openExternal?.('https://buymeacoffee.com/incredidev/membership');
  };

  return (
    <aside className="side-panel" aria-label="Application navigation">
      <div className="brand-block">
        <img className="brand-logo" src={appIcon} alt="" />
        <div className="brand-copy">
          <strong>ISpooferMotion</strong>
          <span>@IncredibroXP</span>
        </div>
      </div>

      <nav className="side-nav" aria-label="Primary">
        <button
          className={`side-link ${currentView === 'spoofer' ? 'active' : ''}`}
          type="button"
          title="Spoofer"
          onClick={() => setCurrentView('spoofer')}
          aria-current={currentView === 'spoofer' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3.1 4.5 7v10l7.5 3.9 7.5-3.9V7L12 3.1Zm0 2.25L16.9 8 12 10.55 7.1 8 12 5.35ZM6.5 9.65l4.5 2.35v6.05l-4.5-2.35V9.65Zm6.5 8.4V12l4.5-2.35v6.05L13 18.05Z" />
          </svg>
          <span>Spoofer</span>
        </button>
        <button
          className={`side-link ${currentView === 'queue' ? 'active' : ''}`}
          type="button"
          title="Activity"
          onClick={() => setCurrentView('queue')}
          aria-current={currentView === 'queue' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5.75 4h7.5a1.75 1.75 0 0 1 1.75 1.75v2.5A1.75 1.75 0 0 1 13.25 10h-7.5A1.75 1.75 0 0 1 4 8.25v-2.5A1.75 1.75 0 0 1 5.75 4Zm5 10h7.5A1.75 1.75 0 0 1 20 15.75v2.5A1.75 1.75 0 0 1 18.25 20h-7.5A1.75 1.75 0 0 1 9 18.25v-2.5A1.75 1.75 0 0 1 10.75 14ZM6 15h1.5v2H6v2H4v-2H2.5v-2H4v-2h2v2Zm11-9.25h-3v2.5h3v-2.5Zm1 10h-7v2.5h7v-2.5Z" />
          </svg>
          <span>Activity</span>
        </button>
        <button
          className={`side-link ${currentView === 'profiles' ? 'active' : ''}`}
          type="button"
          title="Profiles"
          onClick={() => setCurrentView('profiles')}
          aria-current={currentView === 'profiles' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3a4.25 4.25 0 1 1 0 8.5A4.25 4.25 0 0 1 12 3Zm0 2a2.25 2.25 0 1 0 0 4.5A2.25 2.25 0 0 0 12 5Zm-7 14.15C5 15.9 7.92 13.5 12 13.5s7 2.4 7 5.65V21H5v-1.85Zm2.08-.15h9.84c-.13-1.97-2.05-3.5-4.92-3.5S7.21 17.03 7.08 19Z" />
          </svg>
          <span>Profiles</span>
        </button>
        <button
          className={`side-link ${currentView === 'settings' ? 'active' : ''}`}
          type="button"
          title="Settings"
          onClick={() => setCurrentView('settings')}
          aria-current={currentView === 'settings' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10.65 3h2.7l.42 2.14c.53.18 1.03.4 1.5.7l1.82-1.2 1.91 1.91-1.2 1.82c.29.47.52.97.7 1.5l2.14.42v2.7l-2.14.42c-.18.53-.41 1.03-.7 1.5l1.2 1.82-1.91 1.91-1.82-1.2c-.47.29-.97.52-1.5.7L13.35 21h-2.7l-.42-2.14a7.08 7.08 0 0 1-1.5-.7l-1.82 1.2L5 17.45l1.2-1.82a7.08 7.08 0 0 1-.7-1.5L3.36 13.7V11l2.14-.42c.18-.53.41-1.03.7-1.5L5 7.26l1.91-1.91 1.82 1.2c.47-.29.97-.52 1.5-.7L10.65 3ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
          </svg>
          <span>Settings</span>
        </button>
      </nav>
      <div className="build-meta" id="build-meta" aria-label="Version and release source">
        <span id="build-version">{version}</span>
        <strong id="build-source">{source}</strong>
        <button
          className="build-donate-button ui-button"
          id="build-donate"
          type="button"
          onClick={openDonate}
        >
          Donate
        </button>
      </div>
    </aside>
  );
}
