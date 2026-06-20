import { ListChecks, Trash2 } from 'lucide-react';
import { useEffect,useRef } from 'react';

import { useLanguage } from '../../../contexts/LanguageContext';

interface ExecutionLogsProps {
  logs: string[];
  setLogs: (logs: string[]) => void;
  lastReplacements: Record<string, string>;
  setResultsModalOpen: (open: boolean) => void;
}

export default function ExecutionLogs({
  logs,
  setLogs,
  lastReplacements,
  setResultsModalOpen,
}: ExecutionLogsProps) {
  const { t } = useLanguage();
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">
          {t('spoof.output')}
        </span>
        <div className="flex items-center gap-3">
          {Object.keys(lastReplacements).length > 0 && (
            <button
              onClick={() => setResultsModalOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              <ListChecks size={14} /> View Results
            </button>
          )}
          {logs && logs.length > 0 && (
            <button
              onClick={() => setLogs([])}
              className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-danger transition-colors"
            >
              <Trash2 size={14} /> Clear Logs
            </button>
          )}
        </div>
      </div>
      <div
        ref={outputRef}
        className="w-full rounded-[var(--radius-md)] border border-border-strong bg-bg-surface p-3 font-mono text-[13px] font-medium text-text-primary shadow-inner overflow-y-auto whitespace-pre-wrap break-words"
        style={{ height: '13rem' }}
      >
        {logs && logs.length > 0 ? (
          <div className="flex flex-col">
            {logs.map((line, idx) => {
              if (!line) return null;
              const colorClass = line.includes('[SUCCESS]')
                ? 'text-success'
                : line.includes('[WARN]')
                  ? 'text-warning'
                  : line.includes('[ERROR]')
                    ? 'text-danger'
                    : line.includes('[INFO]')
                      ? 'text-[#87ceeb]'
                      : 'text-text-primary';
              return (
                <div key={idx} className={colorClass}>
                  {line}
                </div>
              );
            })}
          </div>
        ) : (
          <span className="opacity-50">{t('spoof.outputPlaceholder')}</span>
        )}
      </div>
    </div>
  );
}
