import {
  Accordion,
  AccordionItem,
  Button,
  Divider,
  FormColorPickerRow,
  FormDropdown,
  FormToggle,
  Group,
  itemVariants,
  pageVariants,
  Row,
  Window,
} from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FolderOpen,
  Globe,
  Loader2,
  Settings2,
  SlidersHorizontal,
  Trash2,
  User2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { HexAlphaColorPicker } from 'react-colorful';
import { createPortal } from 'react-dom';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useThemeAccent } from '../../contexts/ThemeContext';
import { useDiscordLogin } from '../../hooks/useDiscordLogin';
import { type StoredDiscordAuth } from '../../types/discordAuth';
import { logIsm } from '../../utils/robloxProfiles';
import { AVAILABLE_QUICK_SETTINGS } from '../layout/QuickSettingsMenu';

export default function SettingsView() {
  const { t, lang, setLang } = useLanguage();
  const { accentColor, setAccentColor, themeMode, setThemeMode } = useThemeAccent();
  const { config, updateConfig, resetConfig } = useConfig();
  const [localAccent, setLocalAccent] = useState(accentColor);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [pickerCoords, setPickerCoords] = useState({ top: 0, left: 0 });
  const [discordAuth, setDiscordAuth] = useState<StoredDiscordAuth | null>(null);

  useEffect(() => {
    invoke<StoredDiscordAuth | null>('load_discord_report_auth')
      .then((auth) => setDiscordAuth(auth ?? null))
      .catch(() => {});
  }, []);

  const {
    loginState,
    errorMessage: loginError,
    startLogin,
    cancelLogin,
  } = useDiscordLogin((auth) => {
    setDiscordAuth(auth);
    logIsm('success', 'Account connected! Cloud themes will now sync.');
  });

  const langOptions = { en: '🇬🇧 English', es: '🇪🇸 Español', ru: '🇷🇺 Русский', fr: '🇫🇷 Français' };

  const langDropdownOptions = Object.entries(langOptions).map(([value, label]) => ({
    value,
    label,
  }));

  useEffect(() => {
    setLocalAccent(accentColor);
  }, [accentColor]);

  useEffect(() => {
    if (!isColorPickerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsColorPickerOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isColorPickerOpen]);

  const handleColorChange = useCallback(
    (hex: string) => {
      setLocalAccent(hex);
      setAccentColor(hex);
    },
    [setAccentColor],
  );

  async function handleClearCache(successMessage = 'Cache cleared.') {
    try {
      await Promise.all([
        invoke('clear_asset_cache'),
        invoke('clear_plugin_cache'),
        invoke('clear_app_cache'),
      ]);

      Object.keys(localStorage).forEach((key) => {
        if (
          key.startsWith('ISpooferMotion_DetectedGroups_') ||
          key === 'ISpooferMotion_AssetExplorerState'
        ) {
          localStorage.removeItem(key);
        }
      });
      sessionStorage.clear();
      logIsm('success', successMessage);
    } catch (err) {
      logIsm('error', `Failed to clear cache: ${String(err)}`);
    }
  }

  const handleDesktopNotificationsChange = async (enabled: boolean) => {
    updateConfig('general', 'desktopNotifications', enabled);
    if (!enabled) {
      logIsm('info', 'Desktop notifications disabled.');
      return;
    }

    try {
      const shown = await invoke<boolean>('show_notification', {
        options: {
          title: 'ISpooferMotion',
          body: 'Desktop notifications are enabled.',
        },
      });
      logIsm(
        shown ? 'success' : 'warn',
        shown ? 'Desktop notifications enabled.' : 'Desktop notifications could not be shown.',
      );
    } catch (err) {
      logIsm('error', `Desktop notifications failed: ${String(err)}`);
    }
  };

  const handleCacheChange = async (enabled: boolean) => {
    updateConfig('debug', 'enableCache', enabled);
    if (enabled) {
      logIsm('success', 'Cache enabled.');
      return;
    }

    await handleClearCache('Cache disabled. Cached runtime data cleared.');
  };

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      className="w-full h-full"
    >
      <Window>
        <motion.div variants={itemVariants} className="w-full flex flex-col gap-8">
          <Accordion
            selectionMode="multiple"
            expandedKeys={config.ui.settingsSections}
            onExpandedChange={(keys: any) => updateConfig('ui', 'settingsSections', keys)}
            className="flex flex-col gap-6"
          >
            <AccordionItem
              value="account"
              aria-label="Account"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <User2 size={18} className="text-primary" /> Account
                </span>
              }
            >
              <Group>
                <div className="flex flex-col gap-4 px-1 pb-1">
                  {discordAuth?.user ? (
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {discordAuth.user?.avatarUrl ? (
                          <img
                            src={discordAuth.user.avatarUrl}
                            alt="Avatar"
                            className="w-9 h-9 rounded-full border border-border-subtle"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center text-sm font-bold text-text-secondary">
                            {(discordAuth.user?.globalName || discordAuth.user?.username || 'U')
                              .charAt(0)
                              .toUpperCase()}
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-text-primary">
                            {discordAuth.user?.globalName ||
                              discordAuth.user?.username ||
                              'Unknown User'}
                          </span>
                          <span className="text-xs text-text-muted">
                            Connected · Cloud themes sync enabled
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="bordered"
                        color="danger"
                        className="text-xs font-medium shrink-0"
                        onClick={async () => {
                          await invoke('clear_discord_report_auth');
                          setDiscordAuth(null);
                          logIsm('info', 'Account disconnected.');
                        }}
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm text-text-muted leading-relaxed">
                        Connect your ISM account to sync cloud themes. Your browser will open to
                        authenticate.
                      </p>
                      {loginState === 'waiting' ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 text-sm text-text-secondary">
                            <Loader2 size={16} className="animate-spin text-primary" />
                            Waiting for browser authentication...
                          </div>
                          <button
                            onClick={cancelLogin}
                            className="text-xs text-text-muted hover:text-text-secondary underline self-start"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <Button
                            color="primary"
                            variant="solid"
                            className="font-semibold"
                            onClick={startLogin}
                            disabled={loginState === 'opening'}
                          >
                            {loginState === 'opening' ? (
                              <>
                                <Loader2 size={14} className="animate-spin" /> Opening browser...
                              </>
                            ) : (
                              'Connect Account'
                            )}
                          </Button>
                          {loginState === 'error' && loginError && (
                            <p className="text-xs text-red-400 px-1">{loginError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Group>
            </AccordionItem>

            <AccordionItem
              value="general"
              aria-label={t('settings.general')}
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <Globe size={18} className="text-primary" /> {t('settings.general')}
                </span>
              }
            >
              <Group>
                <FormToggle
                  label={t('settings.desktopNotifications')}
                  checked={config.general.desktopNotifications}
                  onChange={handleDesktopNotificationsChange}
                />

                <FormToggle
                  label="Hide to Tray"
                  description="When closing the app, it will minimize to the system tray instead of quitting."
                  checked={config.general.hideToTrayOnClose}
                  onChange={(v: any) => updateConfig('general', 'hideToTrayOnClose', v)}
                />

                <FormDropdown
                  label={t('settings.language')}
                  options={langDropdownOptions}
                  value={lang}
                  onChange={setLang}
                  width="w-[140px]"
                />

                <div className="flex items-center justify-between w-full">
                  <span className="text-sm font-medium text-text-primary">
                    {t('settings.theme')}
                  </span>
                  <div className="flex bg-bg-surface border border-border-subtle rounded-[calc(var(--radius-md)-2px)] p-1 overflow-hidden w-[160px] shrink-0">
                    {(['light', 'dark'] as const).map((tMode) => (
                      <button
                        key={tMode}
                        onClick={() => setThemeMode(tMode)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-[calc(var(--radius-md)-4px)] transition-all ${
                          themeMode === tMode
                            ? 'bg-text-primary text-bg-base shadow-sm'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                        }`}
                      >
                        {t(`settings.theme${tMode.charAt(0).toUpperCase() + tMode.slice(1)}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="relative">
                  <FormColorPickerRow
                    label={t('settings.accentColor')}
                    color={accentColor}
                    onClick={(e: any) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setPickerCoords({ top: rect.bottom + 8, left: rect.right - 200 });
                      setIsColorPickerOpen((prev) => !prev);
                    }}
                  />

                  {createPortal(
                    <AnimatePresence>
                      {isColorPickerOpen && (
                        <div className="fixed inset-0 z-[9999] pointer-events-none">
                          <div
                            className="absolute inset-0 z-[490] pointer-events-auto"
                            onClick={(e: any) => {
                              e.stopPropagation();
                              setIsColorPickerOpen(false);
                            }}
                          />

                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -10 }}
                            className="absolute z-[500] p-0 border border-border-subtle rounded-xl overflow-hidden shadow-floating bg-bg-surface flex flex-col pointer-events-auto"
                            onPointerDown={(e: any) => e.stopPropagation()}
                            onClick={(e: any) => e.stopPropagation()}
                            style={{
                              top: pickerCoords.top,
                              left: pickerCoords.left,
                            }}
                          >
                            <HexAlphaColorPicker color={localAccent} onChange={handleColorChange} />
                            <div className="p-3 border-t border-border-subtle flex items-center justify-between bg-bg-elevated">
                              <span className="text-xs font-bold text-text-muted">HEX</span>
                              <input
                                type="text"
                                value={localAccent.toUpperCase()}
                                onChange={(e: any) => handleColorChange(e.target.value)}
                                className="bg-bg-base text-text-primary text-xs font-mono px-2 py-1 rounded w-20 text-center border border-border-strong outline-none focus:border-primary transition-colors"
                              />
                            </div>
                          </motion.div>
                        </div>
                      )}
                    </AnimatePresence>,
                    document.body,
                  )}
                </div>
                <Divider className="my-2 !border-0 bg-gradient-to-r from-transparent via-border-subtle to-transparent h-px opacity-75" />
                <div className="pt-2">
                  <Button
                    color="primary"
                    variant="solid"
                    fullWidth={true}
                    className="w-full h-10 font-bold text-sm shadow-elevated"
                    onClick={async () => {
                      const confirmed = await ask(
                        'Are you sure you want to reset all settings to their default values? This action cannot be undone.',
                        { title: 'Confirm Reset', kind: 'warning' },
                      );
                      if (confirmed) {
                        resetConfig();
                        window.ismLog?.(
                          'success',
                          'All settings have been reset to their default values.',
                        );
                      }
                    }}
                  >
                    Reset All Settings to Default
                  </Button>
                </div>
              </Group>
            </AccordionItem>

            <AccordionItem
              value="quickSettings"
              aria-label="Quick Settings"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <SlidersHorizontal size={18} className="text-primary" /> Quick Settings
                </span>
              }
            >
              <Group>
                <div className="text-sm text-text-muted mb-3 font-medium px-5">
                  Select which settings you want to appear in the Quick Settings menu located in the
                  top bar.
                </div>
                <div className="flex flex-col gap-0 pb-2">
                  {Object.entries(
                    AVAILABLE_QUICK_SETTINGS.reduce(
                      (acc, setting) => {
                        const groupKey = `${setting.page} > ${setting.section}`;
                        if (!acc[groupKey]) acc[groupKey] = [];
                        acc[groupKey].push(setting);
                        return acc;
                      },
                      {} as Record<string, typeof AVAILABLE_QUICK_SETTINGS>,
                    ),
                  ).map(([groupKey, settings]) => (
                    <Group key={groupKey} title={groupKey} className="!pt-2">
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                        {settings.map((setting) => (
                          <FormToggle
                            key={setting.id}
                            label={setting.label}
                            checked={config.ui.quickSettings.includes(setting.id)}
                            onChange={(checked: any) => {
                              const newSettings = checked
                                ? [...config.ui.quickSettings, setting.id]
                                : config.ui.quickSettings.filter((id) => id !== setting.id);
                              updateConfig('ui', 'quickSettings', newSettings);
                            }}
                          />
                        ))}
                      </div>
                    </Group>
                  ))}
                </div>
              </Group>
            </AccordionItem>

            <AccordionItem
              value="debug"
              aria-label="Debug & Display"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <Settings2 size={18} className="text-primary" /> Debug & Display
                </span>
              }
            >
              <Group>
                <Row>
                  <FormToggle
                    label={t('settings.debugMode')}
                    checked={config.debug.debugMode}
                    onChange={(v: any) => updateConfig('debug', 'debugMode', v)}
                  />

                  <FormToggle
                    label={t('settings.enableCache')}
                    checked={config.debug.enableCache}
                    onChange={handleCacheChange}
                  />
                </Row>
                <Row>
                  <FormToggle
                    label="Enable Experimental Tab"
                    checked={config.debug.enableExperimentalTab}
                    onChange={(v: any) => updateConfig('debug', 'enableExperimentalTab', v)}
                  />
                </Row>
                <div className="mt-2 w-full flex gap-2">
                  <Button
                    label={t('settings.clearCache')}
                    variant="bordered"
                    fullWidth={true}
                    startContent={<Trash2 size={16} />}
                    onClick={() => handleClearCache()}
                  />

                  <Button
                    label="Open Logs Folder"
                    variant="bordered"
                    fullWidth={true}
                    startContent={<FolderOpen size={16} />}
                    onClick={() =>
                      invoke('open_logs_folder').catch((err) =>
                        logIsm('error', `Failed to open logs folder: ${err}`),
                      )
                    }
                  />
                </div>
              </Group>
            </AccordionItem>
          </Accordion>
        </motion.div>
      </Window>
    </motion.div>
  );
}
