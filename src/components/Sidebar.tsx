import React, { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Database,
  EyeOff,
  Link2,
  RefreshCw,
} from 'lucide-react';
import type { SchemaContext } from '../types';

interface SidebarProps {
  schemaContext: SchemaContext | null;
  isLoading: boolean;
  onResetDatabase: () => void;
  showResetControl?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  schemaContext,
  isLoading,
  onResetDatabase,
  showResetControl = true,
}) => {
  const [sidebarTab, setSidebarTab] = useState<'schema' | 'joins' | 'glossary'>(
    'schema'
  );
  const [confirmingReset, setConfirmingReset] = useState<boolean>(false);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({
    customers: true,
    products: true,
    orders: true,
    order_items: false,
    returns: false,
  });

  const toggleTable = (tableName: string) => {
    setExpandedTables((prev) => ({
      ...prev,
      [tableName]: !prev[tableName],
    }));
  };

  const handleConfirmReset = () => {
    setConfirmingReset(false);
    onResetDatabase();
  };

  return (
    <section
      aria-label="Sample Database Reference: Schema, Join Hints, and Business Glossary"
      className="w-full rounded-none border border-[#e4e4e7]/15 bg-[#121216] overflow-hidden flex flex-col"
    >
      {/* Header Tabs & Reset Trigger */}
      <div className="p-4 border-b border-[#e4e4e7]/15 bg-[#0c0c0e] flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Data Reference Sections"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'schema'}
            onClick={() => setSidebarTab('schema')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-none border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sidebarTab === 'schema'
                ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.06] text-[#38bdf8] font-bold'
                : 'border-[#e4e4e7]/20 bg-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:border-[#e4e4e7]/50'
            }`}
          >
            <Database className="w-3.5 h-3.5 shrink-0" />
            <span>Tables &amp; Columns ({schemaContext?.tables.length ?? 5})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'glossary'}
            onClick={() => setSidebarTab('glossary')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-none border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sidebarTab === 'glossary'
                ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.06] text-[#38bdf8] font-bold'
                : 'border-[#e4e4e7]/20 bg-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:border-[#e4e4e7]/50'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            <span>
              Business Glossary ({schemaContext?.glossary.length ?? 11})
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'joins'}
            onClick={() => setSidebarTab('joins')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-none border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sidebarTab === 'joins'
                ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.06] text-[#38bdf8] font-bold'
                : 'border-[#e4e4e7]/20 bg-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:border-[#e4e4e7]/50'
            }`}
          >
            <Link2 className="w-3.5 h-3.5 shrink-0" />
            <span>Join Hints ({schemaContext?.joinHints.length ?? 4})</span>
          </button>
        </div>

        {showResetControl && !confirmingReset && (
          <button
            type="button"
            onClick={() => setConfirmingReset(true)}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/40 bg-[#0c0c0e] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Reset Sample Database</span>
          </button>
        )}
      </div>

      {/* Explicit Confirmation Banner before resetting database */}
      {showResetControl && confirmingReset && (
        <div
          role="alert"
          aria-label="Confirm Database Reset"
          className="px-4 py-3.5 border-b border-[#f87171]/60 bg-[#f87171]/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs text-[#f87171]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-mono font-bold uppercase tracking-wider text-[#f87171]">
                Recreate the in-memory sample database?
              </p>
              <p className="text-[#e4e4e7]/75">
                This will destroy and re-seed the SQLite Web Worker database back
                to its initial sample state.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmingReset(false)}
              className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/30 bg-[#0c0c0e] text-[#e4e4e7] hover:border-[#e4e4e7] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmReset}
              disabled={isLoading}
              className="px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider rounded-none bg-[#f87171] text-[#0c0c0e] hover:bg-[#f87171]/90 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Confirm Reset
            </button>
          </div>
        </div>
      )}

      {/* Body Content */}
      <div className="p-4 space-y-3">
        {!schemaContext ? (
          <div className="p-4 text-xs font-mono text-[#e4e4e7]/65">
            {isLoading
              ? 'Loading sample database schema from SQLite Web Worker...'
              : 'Database schema is currently unavailable.'}
          </div>
        ) : sidebarTab === 'schema' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
              {schemaContext.tables.map((table) => {
                const isOpen = Boolean(expandedTables[table.name]);
                return (
                  <div
                    key={table.name}
                    className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleTable(table.name)}
                      aria-expanded={isOpen}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-[#e4e4e7]/[0.04] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-[#e4e4e7]/60 shrink-0" />
                        )}
                        <span className="font-mono text-xs font-bold text-[#e4e4e7] truncate">
                          {table.name}
                        </span>
                        <span className="text-xs text-[#e4e4e7]/60 truncate hidden sm:inline">
                          — {table.description}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-[#38bdf8] tabular-nums shrink-0 ml-2">
                        {table.rowCount} rows
                      </span>
                    </button>

                    {isOpen && (
                      <div className="border-t border-[#e4e4e7]/15 bg-[#121216] px-3.5 py-2.5 space-y-1.5">
                        <p className="text-xs text-[#e4e4e7]/65 sm:hidden pb-1">
                          {table.description}
                        </p>
                        {table.columns.map((col) => (
                          <div
                            key={col.name}
                            className="space-y-0.5 py-1.5 border-b border-[#e4e4e7]/10 last:border-b-0"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className={`font-mono truncate ${
                                    col.isSensitive
                                      ? 'text-[#f87171] line-through'
                                      : 'text-[#e4e4e7]'
                                  }`}
                                >
                                  {col.name}
                                </span>
                                {col.isPrimaryKey && (
                                  <span className="text-[10px] font-mono text-[#fbbf24] font-bold">
                                    PK
                                  </span>
                                )}
                                {col.foreignKey && (
                                  <span
                                    title={`Foreign Key -> ${col.foreignKey.toTable}.${col.foreignKey.toColumn}`}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-mono text-[#38bdf8]"
                                  >
                                    <Link2 className="w-2.5 h-2.5" />
                                    <span>
                                      FK&rarr;{col.foreignKey.toTable}
                                    </span>
                                  </span>
                                )}
                                {col.isSensitive && (
                                  <span className="text-[10px] font-mono text-[#f87171] font-bold uppercase">
                                    Protected
                                  </span>
                                )}
                              </div>
                              <span className="font-mono text-[11px] text-[#e4e4e7]/60 shrink-0">
                                {col.type}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#e4e4e7]/65">
                              {col.description}
                            </p>
                            {col.enumValues && col.enumValues.length > 0 && (
                              <div className="font-mono text-[10px] text-[#38bdf8]/80 truncate">
                                Values: {col.enumValues.join(' | ')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Protected Columns Notice */}
            {schemaContext.sensitiveColumns.length > 0 && (
              <div className="p-3.5 rounded-none border border-[#fbbf24]/30 bg-[#fbbf24]/[0.05] flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-[#e4e4e7]">
                  <EyeOff className="w-4 h-4 text-[#fbbf24] shrink-0" />
                  <span>
                    Protected columns (automatically blocked from queries):
                  </span>
                </div>
                <span className="font-mono text-[#fbbf24]">
                  {schemaContext.sensitiveColumns.join(', ')}
                </span>
              </div>
            )}
          </div>
        ) : sidebarTab === 'glossary' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {schemaContext.glossary.map((entry) => (
              <article
                key={entry.term}
                aria-label={`Glossary definition for ${entry.term}`}
                className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-mono text-xs font-bold text-[#38bdf8]">
                    {entry.term}
                  </h3>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[#e4e4e7]/60">
                    {entry.category}
                  </span>
                </div>
                <p className="text-xs text-[#e4e4e7]/85 leading-relaxed">
                  {entry.definition}
                </p>
                <div className="font-mono text-[11px] text-[#4ade80] bg-[#121216] p-2 rounded-none border border-[#e4e4e7]/15 break-words">
                  {entry.formulaOrRule}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {schemaContext.joinHints.map((hint) => (
              <div
                key={hint.expression}
                className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-3.5 space-y-1.5"
              >
                <div className="font-mono text-xs font-bold text-[#38bdf8]">
                  {hint.expression}
                </div>
                <p className="text-xs text-[#e4e4e7]/70">{hint.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
