import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { formatSql } from '../../engine/sqlFormatter';

interface SqlDisplayBlockProps {
  turnId: string;
  sqlQuery: string;
  validatedTablesUsed: string[];
}

export const SqlDisplayBlock: React.FC<SqlDisplayBlockProps> = ({
  turnId,
  sqlQuery,
  validatedTablesUsed,
}) => {
  const [isRawMode, setIsRawMode] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const displayedSql = isRawMode ? sqlQuery : formatSql(sqlQuery);

  const handleCopySql = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(displayedSql);
        setIsCopied(true);
        setTimeout(() => {
          setIsCopied(false);
        }, 2000);
      }
    } catch {
      setIsCopied(false);
    }
  };

  return (
    <div
      data-turn-id={turnId}
      className="rounded-none border border-[#e4e4e7]/20 bg-[#0c0c0e] p-3.5 space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-[#e4e4e7]/65 font-mono">
          <span className="font-bold uppercase tracking-wider text-[#e4e4e7]">
            Validated Read-Only SQLite Query
          </span>
          {validatedTablesUsed.length > 0 && (
            <span>
              Tables used:{' '}
              <span className="text-[#38bdf8] font-bold">
                {validatedTablesUsed.join(', ')}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsRawMode((prev) => !prev)}
            className="px-2 py-1 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/30 bg-[#121216] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-colors cursor-pointer"
            title="Toggle between formatted indented SQL and compact single-line SQL"
          >
            {isRawMode ? 'Format SQL' : 'Compact SQL'}
          </button>

          <button
            type="button"
            onClick={() => void handleCopySql()}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/30 bg-[#121216] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-colors cursor-pointer"
            title="Copy SQL query to clipboard"
            aria-label="Copy SQL query to clipboard"
          >
            {isCopied ? (
              <>
                <Check className="w-3 h-3 text-[#4ade80]" />
                <span className="text-[#4ade80]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-[#e4e4e7]/70" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-3 overflow-x-auto">
        <pre className="font-mono text-xs text-[#38bdf8] whitespace-pre-wrap break-words leading-relaxed tab-size-2">
          {displayedSql}
        </pre>
      </div>
    </div>
  );
};
