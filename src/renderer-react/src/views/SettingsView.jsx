import { useEffect, useRef, useState } from 'react';

function hsvToRgb(h, s, v) {
  let r, g, b;
  let i = Math.floor(h * 6);
  let f = h * 6 - i;
  let p = v * (1 - s);
  let q = v * (1 - f * s);
  let t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s,
    v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h, s, v };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export default function SettingsView({ isActive }) {
  const [activeProfileId, setActiveProfileId] = useState(null);

  // Settings states
  const [notifications, setNotifications] = useState(true);
  const [defRetries, setDefRetries] = useState(3);
  const [defDelay, setDefDelay] = useState(3000);
  const [renameToggle, setRenameToggle] = useState(false);
  const [renamePrefix, setRenamePrefix] = useState('');
  const [renameSuffix, setRenameSuffix] = useState('');
  const [renameFind, setRenameFind] = useState('');
  const [renameReplace, setRenameReplace] = useState('');
  const [concurrent, setConcurrent] = useState(false);
  const [maxConcurrentDownload, setMaxConcurrentDownload] = useState(32);
  const [maxConcurrent, setMaxConcurrent] = useState(12);

  // Color Picker states
  const [colorOpen, setColorOpen] = useState(false);
  const [color, setColor] = useState({ r: 124, g: 134, b: 241 });

  const [clearText, setClearText] = useState('Clear');
  const [uninstallStatus, setUninstallStatus] = useState('');

  const colorPickerRef = useRef(null);

  async function fetchProfile() {
    try {
      const secrets = await window.electronAPI?.loadProfileSecrets?.();
      if (!secrets) return;
      setActiveProfileId(secrets.activeProfileId);
      const profile = secrets.profiles[secrets.activeProfileId] || {};

      setNotifications(profile.notifications ?? true);
      setDefRetries(profile.defRetries ?? 3);
      setDefDelay(profile.defDelay ?? 3000);
      setRenameToggle(profile.renameToggle ?? false);
      setRenamePrefix(profile.renamePrefix ?? '');
      setRenameSuffix(profile.renameSuffix ?? '');
      setRenameFind(profile.renameFind ?? '');
      setRenameReplace(profile.renameReplace ?? '');
      setConcurrent(profile.concurrent ?? true);
      setMaxConcurrentDownload(profile.maxConcurrentDownloads ?? 32);
      setMaxConcurrent(profile.maxConcurrentUploads ?? 12);

      if (profile.colorR !== undefined) {
        handleColorChange(profile.colorR, profile.colorG, profile.colorB, false);
      }
    } catch (error) {
      console.error('Failed to load settings profile', error);
    }
  }

  useEffect(() => {
    fetchProfile();
    const handler = () => fetchProfile();
    window.addEventListener('profile-changed', handler);
    return () => window.removeEventListener('profile-changed', handler);
  }, []);

  async function updateSetting(key, val) {
    if (!activeProfileId) return;
    try {
      await window.electronAPI?.saveProfileSecrets?.({
        action: 'patchProfile',
        profileId: activeProfileId,
        secrets: { [key]: val },
      });
    } catch (error) {
      console.error('Failed to update setting', error);
    }
  }

  function handleColorChange(r, g, b, save = true) {
    setColor({ r, g, b });
    const hex = rgbToHex(r, g, b);
    const root = document.documentElement;
    root.style.setProperty('--accent', hex);
    root.style.setProperty(
      '--accent-hover',
      `rgb(${Math.min(255, r + 20)}, ${Math.min(255, g + 20)}, ${Math.min(255, b + 20)})`,
    );
    root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.09)`);
    root.style.setProperty('--accent-line', `rgba(${r}, ${g}, ${b}, 0.28)`);

    if (save && activeProfileId) {
      updateSetting('colorR', r);
      updateSetting('colorG', g);
      updateSetting('colorB', b);
    }
  }

  const hsv = rgbToHsv(color.r, color.g, color.b);
  const pureHue = hsvToRgb(hsv.h, 1, 1);
  const hexColor = rgbToHex(color.r, color.g, color.b);

  const startTour = () => {
    window.dispatchEvent(new Event('start-tour'));
  };

  const uninstallApp = async () => {
    if (
      !window.confirm(
        'Are you sure you want to uninstall ISpooferMotion? This will delete all your settings, profiles, and data.',
      )
    ) {
      return;
    }

    setUninstallStatus('Starting uninstaller...');
    try {
      const result = await window.electronAPI?.uninstallApp?.();
      if (result === true || result?.ok) {
        setUninstallStatus(result?.message || 'Uninstaller started.');
        return;
      }
      setUninstallStatus(result?.message || 'Could not start the uninstaller.');
    } catch (error) {
      setUninstallStatus(error.message || 'Could not start the uninstaller.');
    }
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target)) {
        setColorOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <section
      className={`view settings-view ${isActive ? 'is-active' : ''}`}
      data-view-panel="settings"
      aria-label="Settings"
    >
      <div className="settings-page" id="settings-page">
        <div className="settings-grid">
          <div className="settings-col">
            <div className="bento-card settings-card">
              <div className="settings-header">
                <h3>App Preferences</h3>
                <p>General UI and behavior settings.</p>
              </div>
              <div className="bento-fields">
                <div className="option-row custom-color-row" ref={colorPickerRef}>
                  <span>Accent Color</span>
                  <div
                    className="color-preview-trigger"
                    id="color-preview-trigger"
                    style={{ backgroundColor: hexColor }}
                    onClick={() => setColorOpen(!colorOpen)}
                  ></div>
                  <div
                    className={`color-picker-popup ${colorOpen ? 'is-open' : ''}`}
                    id="color-picker-popup"
                  >
                    <div
                      className="cp-map"
                      id="cp-map"
                      onMouseDown={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const updateMap = (ev) => {
                          const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                          const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
                          const rgb = hsvToRgb(hsv.h, x, 1 - y);
                          handleColorChange(rgb.r, rgb.g, rgb.b);
                        };
                        updateMap(e);
                        const handleMove = (ev) => updateMap(ev);
                        const handleUp = () => {
                          window.removeEventListener('mousemove', handleMove);
                          window.removeEventListener('mouseup', handleUp);
                        };
                        window.addEventListener('mousemove', handleMove);
                        window.addEventListener('mouseup', handleUp);
                      }}
                    >
                      <div
                        className="cp-map-bg"
                        id="cp-map-bg"
                        style={{ backgroundColor: `rgb(${pureHue.r}, ${pureHue.g}, ${pureHue.b})` }}
                      ></div>
                      <div className="cp-map-white"></div>
                      <div className="cp-map-black"></div>
                      <div
                        className="cp-map-thumb"
                        id="cp-map-thumb"
                        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
                      ></div>
                    </div>
                    <div className="cp-controls">
                      <div
                        className="cp-preview"
                        id="cp-preview"
                        style={{ backgroundColor: hexColor }}
                      ></div>
                      <div
                        className="cp-hue-slider"
                        id="cp-hue-slider"
                        onMouseDown={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const updateHue = (ev) => {
                            const x = Math.max(
                              0,
                              Math.min(1, (ev.clientX - rect.left) / rect.width),
                            );
                            const rgb = hsvToRgb(x, hsv.s, hsv.v);
                            handleColorChange(rgb.r, rgb.g, rgb.b);
                          };
                          updateHue(e);
                          const handleMove = (ev) => updateHue(ev);
                          const handleUp = () => {
                            window.removeEventListener('mousemove', handleMove);
                            window.removeEventListener('mouseup', handleUp);
                          };
                          window.addEventListener('mousemove', handleMove);
                          window.addEventListener('mouseup', handleUp);
                        }}
                      >
                        <div
                          className="cp-hue-thumb"
                          id="cp-hue-thumb"
                          style={{ left: `${hsv.h * 100}%` }}
                        ></div>
                      </div>
                    </div>
                    <div className="cp-inputs">
                      <label>
                        <input
                          type="number"
                          id="cp-r"
                          min="0"
                          max="255"
                          value={color.r}
                          onChange={(e) =>
                            handleColorChange(parseInt(e.target.value) || 0, color.g, color.b)
                          }
                        />
                        <span>R</span>
                      </label>
                      <label>
                        <input
                          type="number"
                          id="cp-g"
                          min="0"
                          max="255"
                          value={color.g}
                          onChange={(e) =>
                            handleColorChange(color.r, parseInt(e.target.value) || 0, color.b)
                          }
                        />
                        <span>G</span>
                      </label>
                      <label>
                        <input
                          type="number"
                          id="cp-b"
                          min="0"
                          max="255"
                          value={color.b}
                          onChange={(e) =>
                            handleColorChange(color.r, color.g, parseInt(e.target.value) || 0)
                          }
                        />
                        <span>B</span>
                      </label>
                    </div>
                  </div>
                </div>
                <label className="option-row" htmlFor="setting-notifications">
                  <span>Desktop Notifications</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      id="setting-notifications"
                      checked={notifications}
                      onChange={(e) => {
                        setNotifications(e.target.checked);
                        updateSetting('notifications', e.target.checked);
                      }}
                    />
                    <i></i>
                  </span>
                </label>
                <div className="action-item" style={{ borderBottom: 'none', padding: 0 }}>
                  <span>Welcome Tour</span>
                  <button
                    className="ui-button"
                    type="button"
                    id="btn-start-tour"
                    onClick={startTour}
                  >
                    Replay Welcome Tour
                  </button>
                </div>
              </div>
            </div>

            <div className="bento-card settings-card danger-card">
              <div className="settings-header">
                <h3>Data & Storage</h3>
                <p>Manage local files and application state.</p>
              </div>
              <div className="settings-actions-list">
                <div className="action-item">
                  <span>Open Data Folder</span>
                  <button
                    className="ui-button"
                    type="button"
                    id="btn-open-data"
                    onClick={() => window.electronAPI?.openDataFolder?.()}
                  >
                    Open
                  </button>
                </div>
                <div className="action-item">
                  <span>Open Logs Folder</span>
                  <button
                    className="ui-button"
                    type="button"
                    id="btn-open-logs"
                    onClick={() => window.electronAPI?.openLogsFolder?.()}
                  >
                    Open
                  </button>
                </div>
                <div className="action-item" style={{ borderBottom: 'none' }}>
                  <span>Clear App Data</span>
                  <button
                    className="ui-button ui-button-danger"
                    type="button"
                    id="btn-clear-cache"
                    onClick={async () => {
                      await window.electronAPI?.clearAppCache?.();
                    }}
                  >
                    Clear All
                  </button>
                </div>
                <div className="action-item">
                  <span>Uninstall App</span>
                  <button
                    className="ui-button ui-button-danger"
                    type="button"
                    id="btn-uninstall-app"
                    onClick={uninstallApp}
                  >
                    Uninstall
                  </button>
                  {uninstallStatus && <span className="field-status">{uninstallStatus}</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="settings-col">
            <div className="bento-card settings-card">
              <div className="settings-header">
                <h3>Upload Engine Settings</h3>
                <p>Advanced rules for the upload process.</p>
              </div>
              <label
                className="option-row"
                htmlFor="setting-rename-toggle"
                style={{ marginTop: '12px' }}
              >
                <span>Rename on Upload</span>
                <span className="switch">
                  <input
                    type="checkbox"
                    id="setting-rename-toggle"
                    checked={renameToggle}
                    onChange={(e) => {
                      setRenameToggle(e.target.checked);
                      updateSetting('renameToggle', e.target.checked);
                    }}
                  />
                  <i></i>
                </span>
              </label>
              <div
                className={`rename-options-wrap ${renameToggle ? 'is-visible' : ''}`}
                id="rename-options-group"
              >
                <div className="rename-options-inner bento-fields advanced-fields">
                  <label className="floating-label" style={{ gridColumn: '1 / -1' }}>
                    <input
                      className="ui-input"
                      type="text"
                      id="renamePrefix"
                      placeholder=" "
                      value={renamePrefix}
                      onChange={(e) => {
                        setRenamePrefix(e.target.value);
                        updateSetting('renamePrefix', e.target.value);
                      }}
                    />
                    <span>Name Prefix (e.g. [Spoofed])</span>
                  </label>
                  <label className="floating-label" style={{ gridColumn: '1 / -1' }}>
                    <input
                      className="ui-input"
                      type="text"
                      id="renameSuffix"
                      placeholder=" "
                      value={renameSuffix}
                      onChange={(e) => {
                        setRenameSuffix(e.target.value);
                        updateSetting('renameSuffix', e.target.value);
                      }}
                    />
                    <span>Name Suffix</span>
                  </label>
                  <div style={{ display: 'flex', gap: '10px', gridColumn: '1 / -1' }}>
                    <label className="floating-label" style={{ flex: 1 }}>
                      <input
                        className="ui-input"
                        type="text"
                        id="renameFind"
                        placeholder=" "
                        value={renameFind}
                        onChange={(e) => {
                          setRenameFind(e.target.value);
                          updateSetting('renameFind', e.target.value);
                        }}
                      />
                      <span>Find in name</span>
                    </label>
                    <label className="floating-label" style={{ flex: 1 }}>
                      <input
                        className="ui-input"
                        type="text"
                        id="renameReplace"
                        placeholder=" "
                        value={renameReplace}
                        onChange={(e) => {
                          setRenameReplace(e.target.value);
                          updateSetting('renameReplace', e.target.value);
                        }}
                      />
                      <span>Replace with</span>
                    </label>
                  </div>
                </div>
              </div>
              <label
                className="option-row"
                htmlFor="setting-concurrent"
                style={{ marginTop: '12px' }}
              >
                <span>Concurrency</span>
                <span className="switch">
                  <input
                    type="checkbox"
                    id="setting-concurrent"
                    checked={concurrent}
                    onChange={(e) => {
                      setConcurrent(e.target.checked);
                      updateSetting('concurrent', e.target.checked);
                    }}
                  />
                  <i></i>
                </span>
              </label>
              <div
                className={`concurrent-options-wrap ${concurrent ? 'is-visible' : ''}`}
                id="concurrent-options-group"
              >
                <div className="concurrent-options-inner" style={{ display: 'flex', gap: '10px' }}>
                  <label className="floating-label" style={{ flex: 1 }}>
                    <input
                      className="ui-input"
                      type="number"
                      id="setting-max-concurrent-download"
                      value={maxConcurrentDownload}
                      min="2"
                      max="50"
                      placeholder=" "
                      onChange={(e) => {
                        setMaxConcurrentDownload(Number(e.target.value));
                        updateSetting('maxConcurrentDownloads', Number(e.target.value));
                      }}
                    />
                    <span>Max Download Threads</span>
                  </label>
                  <label className="floating-label" style={{ flex: 1 }}>
                    <input
                      className="ui-input"
                      type="number"
                      id="setting-max-concurrent"
                      value={maxConcurrent}
                      min="2"
                      max="50"
                      placeholder=" "
                      onChange={(e) => {
                        setMaxConcurrent(Number(e.target.value));
                        updateSetting('maxConcurrentUploads', Number(e.target.value));
                      }}
                    />
                    <span>Max Upload Threads</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
