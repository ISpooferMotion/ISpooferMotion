import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence,motion } from 'framer-motion';
import { Hash,Link2, Loader2, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';


export interface PlaceIdSelectorProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalValue(val);

    // If empty
    if (!val.trim()) {
      onChange('');
      setResults([]);
      setShowDropdown(false);
      return;
    }

    // Check if it's a direct place ID (all numbers)
    if (/^\d+$/.test(val.trim())) {
      onChange(val.trim());
      setResults([]);
      setShowDropdown(false);
      return;
    }

    // Check if it's a URL
    const urlMatch = val.match(/(?:roblox\.com\/games\/|roblox\.com\/discover\/#\/)(\d+)/i);
    if (urlMatch && urlMatch[1]) {
      const extractedId = urlMatch[1];
      setLocalValue(extractedId); // replace input with just the ID
      onChange(extractedId);
      setResults([]);
      setShowDropdown(false);
      return;
    }

    // Otherwise, treat as a keyword search
    setShowDropdown(true);
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!localValue.trim() || /^\d+$/.test(localValue.trim())) return;
      const urlMatch = localValue.match(
        /(?:roblox\.com\/games\/|roblox\.com\/discover\/#\/)(\d+)/i,
      );
      if (urlMatch) return;

      const search = async () => {
        setIsSearching(true);
        try {
          // any type casting because rust specta doesn't know about this nested structure
          const res = await invoke<any>('search_global_places', {
            keyword: localValue.trim(),
            limit: 15,
          });
          if (res && res.data) {
            setResults(res.data);
          } else {
            setResults([]);
          }
        } catch (e) {
          console.error('Place search failed', e);
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
    <div className="flex flex-col gap-[6px] relative">
      <label className="text-[13px] font-medium text-text-primary ml-1">{label}</label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
          {/^\d+$/.test(localValue) ? (
            <Hash size={16} />
          ) : localValue.includes('roblox.com') ? (
            <Link2 size={16} />
          ) : (
            <Search size={16} />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={localValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (results.length > 0) setShowDropdown(true);
          }}
          placeholder={placeholder || 'Paste URL, Place ID, or Search by Name...'}
          className="w-full h-10 bg-bg-elevated text-text-primary text-[13px] rounded-[var(--radius-md)] border border-border-strong px-9 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-text-muted"
        />
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">
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
