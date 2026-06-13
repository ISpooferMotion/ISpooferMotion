import type { ThemeConfig } from '@codycon/ism-library';
import { ThemeProvider as UIThemeProvider, useThemeAccent } from '@codycon/ism-library';
import React, { useEffect } from 'react';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <UIThemeProvider>
      <ThemeSync />
      <ThemeModeGuard />
      {children}
    </UIThemeProvider>
  );
};

const ThemeSync = () => {
  const { themeMode } = useThemeAccent();

  useEffect(() => {
    if (themeMode === 'light') {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    } else if (themeMode === 'dark') {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
    }
  }, [themeMode]);

  return null;
};

const ThemeModeGuard = () => {
  const { clearCustomTheme, setThemeMode, loadThemeFromJson } = useThemeAccent();

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'INJECT_THEME' && event.data.theme) {
        try {
          loadThemeFromJson(event.data.theme);
        } catch (e) {
          console.error('Failed to inject theme:', e);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [loadThemeFromJson]);

  useEffect(() => {
    const normalizeThemeMode = () => {
      const savedTheme = localStorage.getItem('theme');

      if (savedTheme === 'custom') {
        const customJson = localStorage.getItem('active_custom_theme_json');
        if (customJson) {
          try {
            loadThemeFromJson(customJson);
            return;
          } catch (e) {
            console.error('Failed to load local custom theme:', e);
          }
        }
      }

      clearCustomTheme();
      if (savedTheme !== 'light' && savedTheme !== 'dark') {
        setThemeMode('dark');
      }
    };

    normalizeThemeMode();
    const timer = window.setTimeout(normalizeThemeMode, 0);
    return () => window.clearTimeout(timer);
  }, [clearCustomTheme, setThemeMode, loadThemeFromJson]);

  return null;
};

export { useThemeAccent };
export type { ThemeConfig };
