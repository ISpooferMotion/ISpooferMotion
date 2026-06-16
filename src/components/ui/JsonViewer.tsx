import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../../utils/cn';

interface JsonViewerProps {
  data: unknown;
  name?: string | null;
  defaultExpanded?: boolean;
  level?: number;
}

export function JsonViewer({ data, name, defaultExpanded = false, level = 0 }: JsonViewerProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || level < 2);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const isObject = data !== null && typeof data === 'object';
  const isArray = Array.isArray(data);
  const isEmpty = isObject && Object.keys(data as object).length === 0;

  const renderValue = (val: unknown) => {
    if (val === null) return <span className="text-danger/80">null</span>;
    if (val === undefined) return <span className="text-danger/80">undefined</span>;
    if (typeof val === 'string') return <span className="text-success">"{val}"</span>;
    if (typeof val === 'number') return <span className="text-[#f59e0b]">{val}</span>;
    if (typeof val === 'boolean')
      return <span className="text-[#3b82f6]">{val ? 'true' : 'false'}</span>;
    return <span className="text-text-muted">{String(val)}</span>;
  };

  if (!isObject || isEmpty) {
    return (
      <div
        className={cn(
          'flex items-start gap-1.5 font-mono text-[11px] leading-relaxed',
          level === 0 && 'py-1',
        )}
      >
        {name && <span className="text-text-primary/90 font-medium">{name}:</span>}
        {isEmpty ? (
          <span className="text-text-muted">{isArray ? '[]' : '{}'}</span>
        ) : (
          renderValue(data)
        )}
      </div>
    );
  }

  const keys = Object.keys(data as object);
  const brackets = isArray ? ['[', ']'] : ['{', '}'];

  return (
    <div className={cn('font-mono text-[11px] leading-relaxed', level === 0 && 'py-1')}>
      <div
        className="flex items-center gap-1.5 cursor-pointer hover:bg-bg-elevated/40 rounded px-1 -mx-1 group select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <motion.div
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="text-text-muted shrink-0"
        >
          <ChevronRight size={12} />
        </motion.div>
        {name && <span className="text-text-primary/90 font-medium">{name}:</span>}
        <span className="text-text-muted/80">{brackets[0]}</span>
        {!isExpanded && (
          <span className="text-text-muted/60 italic text-[10px]">
            {isArray ? `${keys.length} items` : `${keys.length} keys`}
          </span>
        )}
        {!isExpanded && <span className="text-text-muted/80">{brackets[1]}</span>}

        {level === 0 && (
          <button
            onClick={handleCopy}
            className="ml-auto opacity-0 group-hover:opacity-100 p-1 hover:bg-primary/10 hover:text-primary text-text-muted rounded transition-all"
            title="Copy JSON"
          >
            {isCopied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pl-4 border-l border-border-subtle/50 ml-1.5 my-0.5 flex flex-col gap-0.5">
              {keys.map((key) => (
                <JsonViewer
                  key={key}
                  name={isArray ? null : key}
                  data={(data as Record<string, unknown>)[key]}
                  level={level + 1}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {isExpanded && <div className="text-text-muted/80 pl-1">{brackets[1]}</div>}
    </div>
  );
}
