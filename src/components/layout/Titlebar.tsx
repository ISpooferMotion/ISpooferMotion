import { IconButton, Toolbar } from '@codycon/ism-library';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { motion } from 'framer-motion';
import { Minus, Terminal, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import AppIconDark from '../../assets/app_icon.png';
import AppIconLight from '../../assets/app_icon_light.png';
import { useConfig } from '../../contexts/ConfigContext';
import { useThemeAccent } from '../../contexts/ThemeContext';
import { cn } from '../../utils/cn';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import QuickSettingsMenu from './QuickSettingsMenu';

export default function Titlebar() {
  const { customLogo } = useThemeAccent();
  const { config, updateConfig } = useConfig();
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    // grab the current version from tauri to display under the app name
    invoke<string>('get_app_version')
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion(''));
  }, []);

  const logoOpacity = Number.parseFloat(customLogo?.opacity ?? '1');
  const isLogoHidden = Number.isFinite(logoOpacity) && logoOpacity <= 0;

  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleClose = async () => {
    // if they enabled hide-to-tray, just hide the window instead of fully killing the process
    if (config.general.hideToTrayOnClose) {
      await getCurrentWindow().hide();
      return;
    }
    await invoke('quit_app');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      // this attribute allows the user to drag the window by clicking anywhere on the titlebar
      data-tauri-drag-region
      className="h-14 w-full flex items-center justify-between px-5 bg-transparent border-b border-border-subtle select-none shrink-0 z-50 relative"
    >
      {/* App Logo & Name */}
      <div className={cn('flex items-center pointer-events-none', isLogoHidden ? 'pl-1' : 'gap-3')}>
        {!isLogoHidden && (
          <div className="w-8 h-8 flex items-center justify-center">
            {/* user can override the default logo in themes, apply that here if it exists */}
            {customLogo?.image ? (
              <img
                src={isTauriRuntime() ? convertFileSrc(customLogo.image) : customLogo.image}
                className="w-full h-full object-cover rounded-[calc(var(--radius-md)-4px)]"
                style={{ opacity: customLogo?.opacity ?? 1 }}
                alt="Custom Logo"
              />
            ) : isTauriRuntime() ? (
              <>
                <img
                  src={AppIconLight}
                  className="w-full h-full object-contain block dark:hidden"
                  style={{ opacity: customLogo?.opacity ?? 1 }}
                  alt="Logo Light"
                />

                <img
                  src={AppIconDark}
                  className="w-full h-full object-contain hidden dark:block"
                  style={{ opacity: customLogo?.opacity ?? 1 }}
                  alt="Logo Dark"
                />
              </>
            ) : null}
          </div>
        )}
        <div className="flex flex-col justify-center">
          <span className="text-[13px] font-semibold tracking-tight text-text-primary leading-tight">
            ISpooferMotion
          </span>
          <span className="text-[9px] font-mono text-text-muted mt-0.5 opacity-80">
            {appVersion ? `v${appVersion}` : 'v?'}
          </span>
        </div>
      </div>

      {}
      <Toolbar>
        <div className="flex items-center mx-1">
          <QuickSettingsMenu />
        </div>
        <IconButton
          label="Toggle Debug Console"
          tone="primary"
          onClick={() => updateConfig('debug', 'debugMode', !config.debug?.debugMode)}
        >
          <Terminal size={16} />
        </IconButton>
        <div className="mx-1 h-5 w-px shrink-0 bg-border-subtle" aria-hidden="true" />
        <IconButton label="Minimize" onClick={handleMinimize}>
          <Minus size={16} />
        </IconButton>
        <IconButton label="Close" tone="danger" onClick={handleClose}>
          <X size={16} />
        </IconButton>
      </Toolbar>
    </motion.div>
  );
}
