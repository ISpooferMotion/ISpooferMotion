import { useEffect } from 'react';

export default function DevConsoleGate() {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'd') return;
      event.preventDefault();
      window.electronAPI?.openDevConsole?.();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return null;
}
