import { FormInput, FormToggle, IconButton } from '@codycon/ism-library';
import { AnimatePresence, motion } from 'framer-motion';
import { Info, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useConfig } from '../../contexts/ConfigContext';

type QuickSetting = {
  id:
    | 'spoofing.cookie'
    | 'spoofing.apiKey'
    | 'advanced.autoCookieStudio'
    | 'advanced.autoCookieBrowser'
    | 'advanced.pluginPort'
    | 'advanced.forcePlaceIds'
    | 'advanced.placeIdSearchLimit'
    | 'advanced.assetScanTimeout'
    | 'advanced.excludedUserIds'
    | 'advanced.excludedGroupIds'
    | 'general.desktopNotifications';
  label: string;
  type: 'text' | 'password' | 'number' | 'toggle';
  page: string;
  section: string;
};

export const AVAILABLE_QUICK_SETTINGS: QuickSetting[] = [
  {
    id: 'spoofing.cookie',
    label: 'Roblox Cookie',
    type: 'password',
    page: 'Config',
    section: 'Credentials',
  },
  {
    id: 'spoofing.apiKey',
    label: 'OpenCloud API Key',
    type: 'password',
    page: 'Config',
    section: 'Credentials',
  },
  {
    id: 'advanced.autoCookieStudio',
    label: 'Auto-Cookie (Studio)',
    type: 'toggle',
    page: 'Config',
    section: 'Credentials',
  },
  {
    id: 'advanced.autoCookieBrowser',
    label: 'Auto-Cookie (Browser)',
    type: 'toggle',
    page: 'Config',
    section: 'Credentials',
  },

  {
    id: 'advanced.pluginPort',
    label: 'Plugin Port',
    type: 'text',
    page: 'Config',
    section: 'Routing and Limits',
  },
  {
    id: 'advanced.forcePlaceIds',
    label: 'Force Place IDs',
    type: 'text',
    page: 'Config',
    section: 'Routing and Limits',
  },
  {
    id: 'advanced.placeIdSearchLimit',
    label: 'Place ID Search Limit',
    type: 'number',
    page: 'Config',
    section: 'Routing and Limits',
  },
  {
    id: 'advanced.assetScanTimeout',
    label: 'Asset Scan Timeout (s)',
    type: 'number',
    page: 'Config',
    section: 'Routing and Limits',
  },

  {
    id: 'advanced.excludedUserIds',
    label: 'Excluded User IDs',
    type: 'text',
    page: 'Config',
    section: 'Exclusions',
  },
  {
    id: 'advanced.excludedGroupIds',
    label: 'Excluded Group IDs',
    type: 'text',
    page: 'Config',
    section: 'Exclusions',
  },

  {
    id: 'general.desktopNotifications',
    label: 'Desktop Notifications',
    type: 'toggle',
    page: 'Settings',
    section: 'General',
  },
];

export default function QuickSettingsMenu() {
  const { config, updateConfig } = useConfig();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

  const openMenu = () => {
    if (buttonRef.current) {
      // calculate position so the menu pops out correctly aligned under the button
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 320;
      setCoords({
        top: rect.bottom + 8,
        left: rect.right - menuWidth,
        width: menuWidth,
      });
      setOpen((current) => !current);
    }
  };

  useEffect(() => {
    const handleResize = () => setOpen(false);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // close the menu if they click outside of it and not on the toggle button
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  // filter the main config to only show settings they pinned
  const activeSettings = config.ui.quickSettings
    .map((id) => AVAILABLE_QUICK_SETTINGS.find((s) => s.id === id))
    .filter((setting): setting is QuickSetting => Boolean(setting));

  // group them by section so it doesn't look like a total mess
  const groupedSettings = activeSettings.reduce(
    (acc, setting) => {
      const groupKey = `${setting.page} > ${setting.section}`;
      if (!acc[groupKey]) acc[groupKey] = [];
      acc[groupKey].push(setting);
      return acc;
    },
    {} as Record<string, typeof AVAILABLE_QUICK_SETTINGS>,
  );

  // kinda repetitive but safely maps IDs to their actual config fields
  const quickSettingValue = (id: QuickSetting['id']) => {
    switch (id) {
      case 'spoofing.cookie':
        return config.spoofing.cookie;
      case 'spoofing.apiKey':
        return config.spoofing.apiKey;
      case 'advanced.autoCookieStudio':
        return config.advanced.autoCookieStudio;
      case 'advanced.autoCookieBrowser':
        return config.advanced.autoCookieBrowser;
      case 'advanced.pluginPort':
        return config.advanced.pluginPort;
      case 'advanced.forcePlaceIds':
        return config.advanced.forcePlaceIds;
      case 'advanced.placeIdSearchLimit':
        return config.advanced.placeIdSearchLimit;
      case 'advanced.assetScanTimeout':
        return config.advanced.assetScanTimeout;
      case 'advanced.excludedUserIds':
        return config.advanced.excludedUserIds;
      case 'advanced.excludedGroupIds':
        return config.advanced.excludedGroupIds;
      case 'general.desktopNotifications':
        return config.general.desktopNotifications;
    }
  };

  const updateQuickSetting = (id: QuickSetting['id'], value: string | boolean) => {
    switch (id) {
      case 'spoofing.cookie':
        updateConfig('spoofing', 'cookie', String(value));
        break;
      case 'spoofing.apiKey':
        updateConfig('spoofing', 'apiKey', String(value));
        break;
      case 'advanced.autoCookieStudio':
        updateConfig('advanced', 'autoCookieStudio', Boolean(value));
        break;
      case 'advanced.autoCookieBrowser':
        updateConfig('advanced', 'autoCookieBrowser', Boolean(value));
        break;
      case 'advanced.pluginPort':
        updateConfig('advanced', 'pluginPort', String(value));
        break;
      case 'advanced.forcePlaceIds':
        updateConfig('advanced', 'forcePlaceIds', String(value));
        break;
      case 'advanced.placeIdSearchLimit':
        updateConfig('advanced', 'placeIdSearchLimit', String(value));
        break;
      case 'advanced.assetScanTimeout':
        updateConfig('advanced', 'assetScanTimeout', String(value));
        break;
      case 'advanced.excludedUserIds':
        updateConfig('advanced', 'excludedUserIds', String(value));
        break;
      case 'advanced.excludedGroupIds':
        updateConfig('advanced', 'excludedGroupIds', String(value));
        break;
      case 'general.desktopNotifications':
        updateConfig('general', 'desktopNotifications', Boolean(value));
        break;
    }
  };

  return (
    <>
      <div ref={buttonRef} className="inline-flex">
        <IconButton
          label="Quick Settings"
          onClick={openMenu}
          className={open ? 'text-primary' : 'text-text-muted'}
        >
          <SlidersHorizontal size={16} />
        </IconButton>
      </div>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              onPointerDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              className="fixed z-500 rounded-md border border-border-subtle bg-bg-surface shadow-floating overflow-hidden flex flex-col"
              style={{
                top: coords.top,
                left: coords.left,
                width: coords.width,
              }}
            >
              <div className="px-4 py-3 border-b border-border-subtle bg-bg-elevated/30 flex justify-between items-center">
                <h3 className="text-[12px] font-bold text-text-primary uppercase tracking-wider">
                  Quick Settings
                </h3>
              </div>

              <div
                className="max-h-[60vh] overflow-y-auto overscroll-contain py-2 custom-scrollbar flex flex-col gap-1"
                data-lenis-prevent="true"
              >
                {Object.keys(groupedSettings).length === 0 ? (
                  <div className="px-4 py-6 text-center text-text-muted flex flex-col items-center gap-2">
                    <Info size={24} className="opacity-50" />
                    <div className="text-sm font-medium">No Quick Settings</div>
                    <div className="text-[12px]">Add items from the Settings page.</div>
                  </div>
                ) : (
                  Object.entries(groupedSettings).map(([groupKey, settings]) => (
                    <div
                      key={groupKey}
                      className="flex flex-col mb-1 pb-2 border-b border-border-subtle last:border-b-0 last:pb-0"
                    >
                      <div className="px-4 py-2 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                        {groupKey}
                      </div>
                      {settings.map((setting) => {
                        const value = quickSettingValue(setting.id);
                        return (
                          <div key={setting.id} className="flex flex-col px-4 py-1.5">
                            {setting.type === 'toggle' ? (
                              <FormToggle
                                label={setting.label}
                                checked={value as boolean}
                                onChange={(val: boolean) => updateQuickSetting(setting.id, val)}
                              />
                            ) : (
                              <FormInput
                                label={setting.label}
                                type={setting.type as 'text' | 'password' | 'number'}
                                value={value as string}
                                onChange={(val: string) => updateQuickSetting(setting.id, val)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
