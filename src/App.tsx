import { IsmProvider } from '@codycon/ism-library';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';

import Sidebar from './components/layout/Sidebar';
import StatusBar from './components/layout/StatusBar';
import Titlebar from './components/layout/Titlebar';
import CreditsModal from './components/modals/CreditsModal';
import { RobloxStatusBanner } from './components/RobloxStatusBanner';
import ActivityView from './components/views/ActivityView';
import AssetExplorer from './components/views/AssetExplorer';
import ConfigView from './components/views/ConfigView';
import DebugConsole from './components/views/DebugConsole';
import ExperimentalView from './components/views/ExperimentalView';
import SettingsView from './components/views/SettingsView';
import SpoofingView from './components/views/SpoofingView';
import DiscordLoginScreen from './components/views/DiscordLoginScreen';
import { useConfig } from './contexts/ConfigContext';
import { useThemeAccent } from './contexts/ThemeContext';
import { useCloudThemeSync } from './hooks/useCloudThemeSync';
import { type StoredDiscordAuth } from './types/discordAuth';
import { isTauriRuntime } from './utils/tauriRuntime';

// Resolves custom background paths to something the browser/tauri can actually render
// kinda hacky but it handles local files, blobs, and web URLs
function resolveThemeBackgroundUrl(path: string) {
  if (/^(?:blob:|data:|https?:|asset:|tauri:)/i.test(path)) {
    return path;
  }

  if (path.startsWith('/') || path.startsWith('./') || path.startsWith('../')) {
    return new URL(path, window.location.href).toString();
  }

  if (!isTauriRuntime()) {
    return path;
  }

  return convertFileSrc(path);
}

export default function App() {
  const [isCreditsOpen, setCreditsOpen] = useState(false);
  const { customBackground } = useThemeAccent();
  const { config, updateConfig } = useConfig();
  const activeTab = config.ui.activeTab;
  const isExplorerOpen = config.ui.assetExplorerOpen;

  const [isRobloxApiDown, setIsRobloxApiDown] = useState(false);
  const [maintenance, setMaintenance] = useState<{ mode: boolean; message: string }>({
    mode: false,
    message: '',
  });

  const [discordAuth, setDiscordAuth] = useState<StoredDiscordAuth | null | undefined>(undefined);

  useCloudThemeSync();

  useEffect(() => {
    if (!isTauriRuntime()) {
      setDiscordAuth({
        id: 'web-preview',
        username: 'Web Preview',
        discriminator: '0000',
        avatar: '',
        access_token: '',
        refresh_token: '',
        expires_at: Date.now() + 10000000,
        scopes: 'identify'
      });
      return;
    }

    invoke<StoredDiscordAuth | null>('load_discord_report_auth')
      .then((auth) => setDiscordAuth(auth ?? null))
      .catch(() => setDiscordAuth(null));

    const handleDisconnect = () => setDiscordAuth(null);
    window.addEventListener('discord-disconnected', handleDisconnect);
    return () => window.removeEventListener('discord-disconnected', handleDisconnect);
  }, []);

  useEffect(() => {
    // Check if we need to lock the app via live config
    const fetchConfig = async () => {
      try {
        const baseUrl =
          import.meta.env.VITE_API_BASE_URL === undefined
            ? 'https://ispoofermotion.com'
            : import.meta.env.VITE_API_BASE_URL;
        let res;
        if (isTauriRuntime()) {
          const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
          res = await tauriFetch(`${baseUrl}/api/config`);
        } else {
          res = await fetch(`${baseUrl}/api/config`);
        }
        if (res.ok) {
          const data = await res.json();
          if (data.maintenanceMode) {
            setMaintenance({ mode: true, message: data.maintenanceMessage });
          }
        }
      } catch (e) {
        // use warn instead of error so it doesn't look like a critical bug during local dev
        console.warn('Could not connect to app config server:', e);
      }
    };
    fetchConfig();
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    // Check if the Roblox API is throwing a fit so we can warn the user
    const checkStatus = async () => {
      try {
        const isUp: boolean = await invoke('check_roblox_api_status');
        setIsRobloxApiDown(!isUp);
      } catch (e) {
        setIsRobloxApiDown(true);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    // Send a heartbeat every 60 seconds to track active spoofer users
    const sendHeartbeat = async () => {
      try {
        const baseUrl =
          import.meta.env.VITE_API_BASE_URL === undefined
            ? 'https://ispoofermotion.com'
            : import.meta.env.VITE_API_BASE_URL;
        if (isTauriRuntime()) {
          const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
          await tauriFetch(`${baseUrl}/api/dev/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'spoofer' }),
          });
        } else {
          await fetch(`${baseUrl}/api/dev/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'spoofer' }),
          });
        }
      } catch (e) {
        // ignore network errors for heartbeat
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 60000);
    return () => clearInterval(interval);
  }, []);

  const setActiveTab = (tabId: string) => updateConfig('ui', 'activeTab', tabId);
  const setIsExplorerOpen = (isOpen: boolean) => updateConfig('ui', 'assetExplorerOpen', isOpen);
  const backgroundUrl = customBackground ? resolveThemeBackgroundUrl(customBackground.path) : null;

  useEffect(() => {
    const allowedTabs = ['home', 'spoofing', 'activity', 'settings', 'config'];
    // only show the experimental tab if they've explicitly enabled it in debug settings
    if (config.debug?.enableExperimentalTab) {
      allowedTabs.push('experimental');
    }

    if (!allowedTabs.includes(activeTab)) {
      updateConfig('ui', 'activeTab', 'home');
    }
  }, [activeTab, config.debug?.enableExperimentalTab, updateConfig]);

  useEffect(() => {
    const handleCredits = () => setCreditsOpen(true);
    document.addEventListener('open-credits', handleCredits);

    const preventDrag = (e: Event) => e.preventDefault();
    window.addEventListener('dragover', preventDrag);
    window.addEventListener('drop', preventDrag);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i')) {
        invoke('open_frontend_devtools').catch(console.error);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const shortcut = 'Alt+I';
    let isCancelled = false;
    let didRegisterShortcut = false;
    const registerShortcut = async () => {
      if (!isTauriRuntime()) return;
      try {
        if (await isRegistered(shortcut)) return;
        await register(shortcut, async (event) => {
          if (event.state === 'Pressed') {
            const win = getCurrentWindow();
            await win.show();
            await win.setFocus();
          }
        });
        didRegisterShortcut = true;
        if (isCancelled) {
          await unregister(shortcut);
          didRegisterShortcut = false;
        }
      } catch (error) {
        if (!String(error).includes('already registered')) {
          console.error(error);
        }
      }
    };

    void registerShortcut();

    return () => {
      isCancelled = true;
      document.removeEventListener('open-credits', handleCredits);
      window.removeEventListener('dragover', preventDrag);
      window.removeEventListener('drop', preventDrag);
      window.removeEventListener('keydown', handleKeyDown);
      if (!didRegisterShortcut) return;
      unregister(shortcut).catch((error) => {
        if (!String(error).toLowerCase().includes('not registered')) {
          console.error(error);
        }
      });
    };
  }, []);

  useEffect(() => {
    if (config.spoofing.cookie) {
      invoke('get_economy_metadata', { cookie: config.spoofing.cookie }).catch(() => {});
    }
  }, [config.spoofing.cookie]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
  }, []);

  if (maintenance.mode) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen bg-bg-base text-text-primary p-8 text-center space-y-4 font-sans antialiased">
        <div className="text-yellow-500 mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Maintenance Break</h1>
        <p className="text-text-muted max-w-md">
          {maintenance.message ||
            'ISpooferMotion is currently down for maintenance. Please check back later!'}
        </p>
      </div>
    );
  }

  return (
    <IsmProvider config={{ autoScrollAccordions: config.ui.autoScrollSections }}>
      <AnimatePresence mode="wait">
        {discordAuth === undefined ? null : discordAuth === null ? (
          <DiscordLoginScreen key="login" onVerified={(auth) => setDiscordAuth(auth)} />
        ) : (
          <motion.div
            key="app"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col h-screen w-screen overflow-hidden text-foreground relative font-sans selection:bg-primary/30 antialiased"
            style={{ backgroundColor: 'var(--bg-base)' }}
          >
        {customBackground && backgroundUrl && (
          <div className="absolute inset-0 w-full h-full z-0 pointer-events-none overflow-hidden">
            {customBackground.type === 'video' ? (
              <video
                autoPlay
                loop
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
                src={backgroundUrl}
                style={{
                  mixBlendMode: (customBackground.blend_mode as any) || 'normal',
                  filter: customBackground.filter || 'none',
                }}
              />
            ) : (
              <img
                className="absolute inset-0 w-full h-full object-cover"
                src={backgroundUrl}
                alt="Custom background"
                style={{
                  mixBlendMode: (customBackground.blend_mode as any) || 'normal',
                  filter: customBackground.filter || 'none',
                }}
              />
            )}
            <div className="absolute inset-0 bg-background/20" />
          </div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col h-full w-full relative z-10"
        >
          <Titlebar />

          <div className="flex flex-1 overflow-hidden relative">
            <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

            <div className="flex-1 relative overflow-hidden bg-transparent flex flex-col">
              <RobloxStatusBanner isVisible={isRobloxApiDown} />

              <div className="flex-1 relative overflow-hidden">
                <AnimatePresence mode="wait" initial={false}>
                  {activeTab === 'spoofing' && <SpoofingView key="spoofing" />}
                  {activeTab === 'activity' && <ActivityView key="activity" />}
                  {activeTab === 'settings' && <SettingsView key="settings" />}
                  {activeTab === 'config' && <ConfigView key="config" />}
                  {activeTab === 'experimental' && <ExperimentalView key="experimental" />}
                </AnimatePresence>
              </div>

              <DebugConsole
                isOpen={config.debug?.debugMode || false}
                onClose={() => updateConfig('debug', 'debugMode', false)}
              />
            </div>

            <AssetExplorer isOpen={isExplorerOpen} setIsOpen={setIsExplorerOpen} />

            {!isExplorerOpen && (
              <motion.div
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 20, opacity: 0 }}
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-[45] cursor-pointer flex items-center justify-end group"
                onClick={() => setIsExplorerOpen(true)}
              >
                <motion.div
                  whileHover={{
                    width: 28,
                    backgroundColor: 'var(--bg-elevated)',
                  }}
                  className="w-6 h-28 bg-bg-elevated/60 backdrop-blur-xl border border-border-subtle border-r-0 rounded-l-2xl flex items-center justify-center shadow-floating transition-colors"
                >
                  <ChevronLeft
                    size={16}
                    strokeWidth={2.5}
                    className="text-text-secondary group-hover:text-text-primary transition-colors"
                  />
                </motion.div>
              </motion.div>
            )}
          </div>

          <div
            className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none z-[60] opacity-[0.03] mix-blend-screen"
            style={{
              background: 'linear-gradient(to top, var(--primary), transparent)',
            }}
          />

          <StatusBar />
        </motion.div>

        <CreditsModal isOpen={isCreditsOpen} onClose={() => setCreditsOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </IsmProvider>
  );
}
