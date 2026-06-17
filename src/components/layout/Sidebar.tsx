import { Button } from '@codycon/ism-library';
import { open } from '@tauri-apps/plugin-shell';
import { AnimatePresence, motion } from 'framer-motion';
import { Beaker, FileCog, Heart, Home, Info, ScanLine, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '../../utils/cn';

function DonateButton() {
  const [isHovered, setIsHovered] = useState(false);
  const [hearts, setHearts] = useState<{ id: number; left: number }[]>([]);

  useEffect(() => {
    if (!isHovered) {
      setHearts([]);
      return;
    }

    // cool little effect where hearts float up when you hover over the support button
    // looks nice and grabs attention without being annoying
    const intervalId = setInterval(() => {
      setHearts((prev) => [...prev.slice(-5), { id: Date.now(), left: 10 + Math.random() * 80 }]);
    }, 300);
    return () => clearInterval(intervalId);
  }, [isHovered]);

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <div
      className="mt-auto w-full relative group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
    >
      <AnimatePresence>
        {hearts.map((h) => (
          <motion.div
            key={h.id}
            initial={{ opacity: 0, y: 0, scale: 0.5, x: 0 }}
            animate={{
              opacity: [0, 1, 0],
              y: -50,
              scale: [0.5, 1.2, 1],
              x: (Math.random() - 0.5) * 20,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            className="absolute z-50 pointer-events-none flex justify-center items-center"
            style={{ left: `${h.left}%`, bottom: '20px' }}
          >
            <Heart
              size={14}
              className="drop-shadow-md"
              stroke="url(#rose-gradient)"
              fill="url(#rose-gradient)"
            />
          </motion.div>
        ))}
      </AnimatePresence>

      <svg width="0" height="0" className="absolute">
        <defs>
          <linearGradient id="rose-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#fb7185" />
          </linearGradient>
        </defs>
      </svg>

      <Button
        variant="ghost"
        className="w-full h-10 px-3 text-text-secondary hover:text-text-primary hover:bg-bg-elevated font-medium justify-start rounded-[var(--radius-md)] transition-colors duration-150 relative z-30 flex items-center gap-3"
        onClick={() => open('https://buymeacoffee.com/incredidev/membership')}
      >
        <div className={`transition-opacity ${isHovered ? 'opacity-100' : 'opacity-60'}`}>
          <Heart
            size={16}
            className={`transition-colors ${isHovered ? 'drop-shadow-sm' : 'text-text-secondary group-hover:text-primary'}`}
            stroke={isHovered ? 'url(#rose-gradient)' : 'currentColor'}
            fill={isHovered ? 'url(#rose-gradient)' : 'none'}
          />
        </div>
        <span
          className={`text-[13px] tracking-wide transition-colors ${isHovered ? 'text-primary font-semibold' : 'text-text-secondary group-hover:text-primary'}`}
        >
          Support Me
        </span>
      </Button>
    </div>
  );
}

export default function Sidebar({
  activeTab,
  onTabChange,
}: {
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  const { t } = useLanguage();

  const tabs = [
    { id: 'spoofing', label: t('nav.spoofing'), icon: <ScanLine size={18} /> },
    { id: 'config', label: t('nav.config'), icon: <FileCog size={18} /> },
    { id: 'settings', label: t('nav.settings'), icon: <Settings size={18} /> },
  ];

  const { config } = useConfig();
  // only show the experimental tab if they actually enabled it in their debug config
  if (config.debug?.enableExperimentalTab) {
    tabs.push({
      id: 'experimental',
      label: 'Experimental',
      icon: <Beaker size={18} />,
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="w-[220px] h-full bg-transparent border-r border-border-subtle p-5 flex flex-col shrink-0 relative z-20"
    >
      {}
      <div className="flex-1 flex flex-col gap-1.5 mt-2">
        <AnimatePresence initial={false}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <motion.button
                type="button"
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                whileTap={{ scale: 0.96 }}
                whileHover={{ scale: 1.01 }}
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'w-full text-left h-10 px-3 transition-colors duration-150 flex items-center gap-3 rounded-[var(--radius-md)] relative outline-none [-webkit-tap-highlight-color:transparent]',
                  isActive
                    ? 'bg-bg-elevated text-text-primary border border-border-strong shadow-subtle'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated/70',
                )}
              >
                <div className={cn('transition-opacity', isActive ? 'opacity-100' : 'opacity-60')}>
                  {tab.icon}
                </div>
                <span
                  className={cn(
                    'text-[13px] tracking-wide',
                    isActive ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {tab.label}
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      {}
      <div className="flex flex-col gap-1.5">
        <Button
          variant="ghost"
          aria-label="Credits"
          className="w-full h-10 px-3 text-text-secondary hover:text-text-primary hover:bg-bg-elevated font-medium justify-start rounded-[var(--radius-md)] transition-colors duration-150 flex items-center gap-3"
          onClick={() => document.dispatchEvent(new CustomEvent('open-credits'))}
        >
          <div className="opacity-60">
            <Info size={16} />
          </div>
          <span className="text-[13px] tracking-wide">Credits</span>
        </Button>

        <DonateButton />
      </div>
    </motion.div>
  );
}
