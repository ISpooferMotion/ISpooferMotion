import {
  Button,
  Divider,
  FormColorPickerRow,
  FormDropdown,
  FormToggle,
  Group,
} from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { HexAlphaColorPicker } from 'react-colorful';
import { createPortal } from 'react-dom';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useThemeAccent } from '../../../contexts/ThemeContext';
import { cn } from '../../../utils/cn';
import { logIsm } from '../../../utils/robloxProfiles';

export default function GeneralSection() {
  const { t, lang, setLang } = useLanguage();
  const { accentColor, setAccentColor, themeMode, setThemeMode } = useThemeAccent();
  const { config, updateConfig, resetConfig } = useConfig();
  const [localAccent, setLocalAccent] = useState(accentColor);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [pickerCoords, setPickerCoords] = useState({ top: 0, left: 0 });

  const langOptions = {
    en: '🇬🇧 English',
    es: '🇪🇸 Español',
    ru: '🇷🇺 Русский',
    fr: '🇫🇷 Français',
  };

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

  return (
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
        onChange={(v: boolean) => updateConfig('general', 'hideToTrayOnClose', v)}
      />

      <FormToggle
        label="Telemetry & Error Reporting"
        description="Allow ISpooferMotion to automatically send anonymous crash reports and telemetry to the developers."
        checked={config.general.telemetryEnabled}
        onChange={(v: boolean) => updateConfig('general', 'telemetryEnabled', v)}
      />

      <FormDropdown
        label={t('settings.language')}
        options={langDropdownOptions}
        value={lang}
        onChange={setLang}
        width="w-[140px]"
      />

      <div className="flex items-center justify-between w-full">
        <span className="text-sm font-medium text-text-primary">{t('settings.theme')}</span>
        <div className="flex bg-bg-surface border border-border-subtle rounded-[calc(var(--radius-md)-2px)] p-1 overflow-hidden w-[160px] shrink-0">
          {(['light', 'dark'] as const).map((tMode) => (
            <button
              key={tMode}
              onClick={() => setThemeMode(tMode)}
              className={cn(
                'flex-1 py-1.5 text-xs font-medium rounded-[calc(var(--radius-md)-4px)] transition-all',
                themeMode === tMode
                  ? 'bg-text-primary text-bg-base shadow-sm'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
              )}
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
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setPickerCoords({
              top: rect.bottom + 8,
              left: rect.right - 200,
            });
            setIsColorPickerOpen((prev) => !prev);
          }}
        />

        {createPortal(
          <AnimatePresence>
            {isColorPickerOpen && (
              <div className="fixed inset-0 z-[9999] pointer-events-none">
                <div
                  className="absolute inset-0 z-[490] pointer-events-auto"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    setIsColorPickerOpen(false);
                  }}
                />

                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  className="absolute z-[500] p-0 border border-border-subtle rounded-xl overflow-hidden shadow-floating bg-bg-surface flex flex-col pointer-events-auto"
                  onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
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
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleColorChange(e.target.value)
                      }
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
              window.ismLog?.('success', 'All settings have been reset to their default values.');
            }
          }}
        >
          Reset All Settings to Default
        </Button>
      </div>
    </Group>
  );
}
