import { Dropdown, MultiSelectDropdown } from '@codycon/ism-library';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, Check, Copy, Terminal, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '../../utils/cn';
import {
  clearDebugLogs,
  getDebugLogs,
  LogEntry,
  subscribeDebugLogs,
} from '../../utils/debugLogger';
import { JsonViewer } from '../ui/JsonViewer';

export function useLogs() {
  const [logs, setLogs] = useState<LogEntry[]>(getDebugLogs());
  useEffect(() => {
    return subscribeDebugLogs(setLogs);
  }, []);
  return logs;
}

interface DebugConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DebugConsole({ isOpen, onClose }: DebugConsoleProps) {
  const logs = useLogs();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterLevels, setFilterLevels] = useState<string[]>(['info', 'success', 'warn', 'error']);
  const [isCopied, setIsCopied] = useState(false);
  const [showGoToBottom, setShowGoToBottom] = useState(false);
  const isAutoScrollEnabled = useRef(true);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      // auto-scroll to bottom like a real terminal unless they scroll up manually
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
      isAutoScrollEnabled.current = atBottom;
      setShowGoToBottom(!atBottom);
    }
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior: 'smooth',
          });
        }
      });
      isAutoScrollEnabled.current = true;
      setShowGoToBottom(false);
    }
  };

  const filteredLogs = logs.filter(
    (log) =>
      (filterSource === 'all' || log.source === filterSource) && filterLevels.includes(log.level),
  );

  const groupedLogs = filteredLogs.reduce(
    (acc, currentLog) => {
      // group identical spammy logs together so they don't blow up the view
      const lastLog = acc[acc.length - 1];
      if (
        lastLog &&
        lastLog.message === currentLog.message &&
        lastLog.source === currentLog.source &&
        lastLog.level === currentLog.level
      ) {
        lastLog.count += 1;
        lastLog.timestamp = currentLog.timestamp;
      } else {
        acc.push({ ...currentLog, count: 1 });
      }
      return acc;
    },
    [] as (LogEntry & { count: number })[],
  );

  useEffect(() => {
    if (isOpen && scrollContainerRef.current && isAutoScrollEnabled.current) {
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [groupedLogs, isOpen]);

  const clearLogs = () => {
    clearDebugLogs();
  };

  const handleCopy = () => {
    const text = filteredLogs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.source.toUpperCase()}] ${l.level.toUpperCase()}: ${l.message}`,
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const filterOptions = [
    { value: 'all', label: 'All Logs' },
    { value: 'console', label: 'DevTools Console' },
    { value: 'ism', label: 'ISM Logs' },
  ];

  const levelOptions = [
    { value: 'info', label: 'Info' },
    { value: 'success', label: 'Success' },
    { value: 'warn', label: 'Warnings' },
    { value: 'error', label: 'Errors' },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="debug-console"
          initial={{ y: '100%', opacity: 0.5, height: 288 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0.5 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="absolute bottom-0 left-0 right-0 bg-bg-surface/95 backdrop-blur-2xl border-t border-border-strong shadow-[0_-10px_40px_rgba(0,0,0,0.3)] flex flex-col z-40"
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-bg-elevated/80 shrink-0">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-text-secondary text-[13px] font-bold uppercase tracking-wider">
                <Terminal size={15} className="text-primary" /> Debug Console
              </div>
              <div className="w-45 z-50">
                <Dropdown options={filterOptions} value={filterSource} onChange={setFilterSource} />
              </div>
              <div className="w-55 z-50">
                <MultiSelectDropdown
                  options={levelOptions}
                  values={filterLevels}
                  onChange={setFilterLevels}
                  placeholder="Log Levels"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="p-1.5 text-text-muted hover:text-primary hover:bg-primary/10 rounded-md transition-colors"
                aria-label="Copy Logs"
              >
                {isCopied ? <Check size={15} /> : <Copy size={15} />}
              </button>
              <button
                onClick={clearLogs}
                className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded-md transition-colors"
                aria-label="Clear Logs"
              >
                <Trash2 size={15} />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-base rounded-md transition-colors"
                aria-label="Hide Console"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          <AnimatePresence>
            {showGoToBottom && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                onClick={scrollToBottom}
                className="absolute bottom-4 right-6 bg-bg-elevated text-text-primary border border-border-strong px-3 py-1.5 rounded-full text-[11px] font-semibold flex items-center gap-1.5 shadow-lg hover:bg-bg-surface hover:text-primary transition-colors z-50"
              >
                <ArrowDown size={14} /> Go to Bottom
              </motion.button>
            )}
          </AnimatePresence>
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-2 font-mono text-[11px] flex flex-col gap-0.5 selection:bg-primary/30"
            style={{ overflowAnchor: 'none' }}
          >
            {groupedLogs.length === 0 ? (
              <div className="text-text-muted italic flex items-center justify-center h-full">
                No logs available.
              </div>
            ) : (
              groupedLogs.map((log, index) => (
                <div
                  key={`${log.id}-${index}`}
                  className={cn(
                    'flex items-start gap-3 py-1.5 px-3 rounded border border-transparent',
                    log.level === 'error'
                      ? 'text-danger bg-danger/5 border-danger/10'
                      : log.level === 'warn'
                        ? 'text-warning bg-warning/5 border-warning/10'
                        : log.level === 'success'
                          ? 'text-success bg-success/5 border-success/10'
                          : 'text-text-primary hover:bg-bg-elevated/50',
                  )}
                >
                  <span className="text-text-muted shrink-0 min-w-17.5 select-none opacity-60 flex items-center gap-1.5">
                    {log.timestamp}
                    {log.count > 1 && (
                      <span className="bg-border-strong/40 text-text-primary px-1 rounded font-bold text-[9px] shadow-sm">
                        x{log.count}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'uppercase shrink-0 min-w-15 font-bold select-none',
                      log.level === 'error'
                        ? 'text-danger'
                        : log.level === 'warn'
                          ? 'text-warning'
                          : log.level === 'success'
                            ? 'text-success'
                            : 'text-primary/70',
                    )}
                  >
                    {log.level}
                  </span>
                  <span className="text-text-muted shrink-0 min-w-12.5 font-bold select-none opacity-40">
                    [{log.source === 'ism' ? 'ISM' : 'DEV'}]
                  </span>
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {log.message && (
                      <span className="wrap-break-word whitespace-pre-wrap leading-relaxed">
                        {log.message.split('\n').map((line, i) => {
                          const isTrace = /^\s*at\s+/.test(line);
                          if (isTrace) {
                            return (
                              <div key={i} className="text-text-muted opacity-80 pl-4">
                                {line.replace(/^\s*at\s+/, '↳ at ')}
                              </div>
                            );
                          }
                          return <div key={i}>{line}</div>;
                        })}
                      </span>
                    )}
                    {log.payload && log.payload.length > 0 && (
                      <div className="flex flex-col gap-2 mt-1">
                        {log.payload.map((p, i) => (
                          <div
                            key={i}
                            className="bg-bg-base/50 rounded-md p-1.5 border border-border-subtle/30 overflow-x-auto"
                          >
                            <JsonViewer data={p} defaultExpanded={log.level === 'error'} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
