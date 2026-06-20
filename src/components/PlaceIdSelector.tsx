import { FormInput } from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence,motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';


export interface PlaceIdSelectorProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

interface SearchResult {
  id: number;
  name: string;
  creator: { id: number; name: string };
  playerCount: number;
}

export default function PlaceIdSelector({
  label,
  placeholder,
  value,
  onChange,
  className = '',
}: PlaceIdSelectorProps) {
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // keep local state in sync with external value
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (val: string) => {
    setLocalValue(val);

    // If empty
    if (!val.trim()) {
      onChange('');
      setResults([]);
      setShowDropdown(false);
      return;
    }

    onChange(val);
  };

  useEffect(() => {
    if (!localValue.trim() || /^\d+$/.test(localValue.trim())) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    const timeout = setTimeout(() => {
      const search = async () => {
        setIsSearching(true);
        try {
          const res = await invoke<string>('search_roblox_games', { query: localValue });
          const parsed = JSON.parse(res);
          setResults(parsed.data || []);
          setShowDropdown(true);
        } catch (e) {
          console.error('Failed to search games:', e);
          setResults([]);
        } finally {
          setIsSearching(false);
        }
      };
      search();
    }, 500);

    return () => clearTimeout(timeout);
  }, [localValue]);

  const selectPlace = (placeId: number) => {
    const idStr = String(placeId);
    setLocalValue(idStr);
    onChange(idStr);
    setShowDropdown(false);
  };

  return (
    <div className={`relative flex-1 min-w-0 ${className}`} ref={dropdownRef}>
      <div 
        ref={inputRef} 
        className="relative"
        onFocusCapture={() => {
          if (results.length > 0) setShowDropdown(true);
        }}
      >
        <FormInput
          label={label}
          placeholder={placeholder || 'Paste URL, Place ID, or Search...'}
          value={localValue}
          onChange={handleInputChange}
        />
        {isSearching && (
          <div className="absolute right-3 top-[34px] text-text-muted pointer-events-none">
            <Loader2 size={16} className="animate-spin opacity-70" />
          </div>
        )}
      </div>

      <AnimatePresence>
        {showDropdown && localValue.trim() && !/^\d+$/.test(localValue.trim()) && (
          <motion.div
            ref={dropdownRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute top-[68px] left-0 w-full z-50 bg-bg-elevated border border-border-strong rounded-[var(--radius-md)] shadow-floating overflow-hidden flex flex-col max-h-[300px]"
          >
            {isSearching && results.length === 0 ? (
              <div className="p-4 flex items-center justify-center text-[13px] text-text-secondary">
                Searching Roblox...
              </div>
            ) : results.length === 0 ? (
              <div className="p-4 flex items-center justify-center text-[13px] text-text-secondary">
                No games found for "{localValue}"
              </div>
            ) : (
              <div className="overflow-y-auto custom-scrollbar p-1">
                {results.map((game) => (
                  <button
                    key={game.id}
                    className="w-full flex flex-col items-start p-2.5 rounded-[var(--radius-sm)] hover:bg-bg-base/60 transition-colors text-left focus:outline-none"
                    onClick={() => selectPlace(game.id)}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[13px] font-medium text-text-primary truncate max-w-[80%]">
                        {game.name}
                      </span>
                      <span className="text-[11px] text-text-muted font-mono">{game.id}</span>
                    </div>
                    <div className="flex items-center justify-between w-full mt-1">
                      <span className="text-[11px] text-text-secondary truncate">
                        By {game.creator?.name || 'Unknown'}
                      </span>
                      {game.playerCount > 0 && (
                        <span className="text-[11px] text-green-500/80">
                          {game.playerCount.toLocaleString()} Playing
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
