import { useCallback, useState } from 'react';

import { ThemeConfig } from '../contexts/ThemeContext';

export function useThemeHistory(initialTheme: ThemeConfig) {
  const [history, setHistory] = useState<ThemeConfig[]>([initialTheme]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentTheme = history[currentIndex];

  const pushState = useCallback(
    (newTheme: ThemeConfig) => {
      if (JSON.stringify(newTheme) === JSON.stringify(currentTheme)) return;

      setHistory((prev) => {
        const updatedHistory = prev.slice(0, currentIndex + 1);
        return [...updatedHistory, newTheme];
      });
      setCurrentIndex((prev) => prev + 1);
    },
    [currentIndex, currentTheme],
  );

  const undo = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const redo = useCallback(() => {
    if (currentIndex < history.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, history.length]);

  return {
    currentTheme,
    pushState,
    undo,
    redo,
    canUndo: currentIndex > 0,
    canRedo: currentIndex < history.length - 1,
  };
}
