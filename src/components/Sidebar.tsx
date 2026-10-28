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
      className="w-full rounded-xl border border-slate-800 bg-slate-900/75 overflow-hidden flex flex-col"
    >
      {/* Header Tabs & Reset Trigger */}
      <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Data Reference Sections"
          className="flex flex-wrap items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'schema'}
            onClick={() => setSidebarTab('schema')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              sidebarTab === 'schema'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>Tables &amp; Columns ({schemaContext?.tables.length ?? 5})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'glossary'}
            onClick={() => setSidebarTab('glossary')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              sidebarTab === 'glossary'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>
              Business Glossary ({schemaContext?.glossary.length ?? 11})
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'joins'}
            onClick={() => setSidebarTab('joins')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              sidebarTab === 'joins'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Link2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>Join Hints ({schemaContext?.joinHints.length ?? 4})</span>
          </button>
        </div>

        {showResetControl && !confirmingReset && (
          <button
            type="button"
            onClick={() => setConfirmingReset(true)}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-400"
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
          className="px-4 py-3.5 border-b border-amber-700/80 bg-amber-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs text-amber-100">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-amber-200">
                Recreate the in-memory sample database?
              </p>
              <p className="text-slate-300">
                This will destroy and re-seed the SQLite Web Worker database back
                to its initial sample state.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmingReset(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmReset}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-amber-300"
            >
              Confirm Reset
            </button>
          </div>
        </div>
      )}

      {/* Body Content */}
      <div className="p-4 space-y-3">
        {!schemaContext ? (
          <div className="p-4 text-xs text-slate-400">
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
                    className="rounded-lg border border-slate-800 bg-slate-950/60 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleTable(table.name)}
                      aria-expanded={isOpen}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-800/50 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className="font-mono text-xs font-semibold text-slate-100 truncate">
                          {table.name}
                        </span>
                        <span className="text-xs text-slate-400 truncate hidden sm:inline">
                          — {table.description}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0 ml-2">
                        {table.rowCount} rows
                      </span>
                    </button>

                    {isOpen && (
                      <div className="border-t border-slate-800/80 px-3.5 py-2.5 space-y-1.5">
                        <p className="text-xs text-slate-400 sm:hidden pb-1">
                          {table.description}
                        </p>
                        {table.columns.map((col) => (
                          <div
                            key={col.name}
                            className="space-y-0.5 py-1 border-b border-slate-900 last:border-b-0"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className={`font-mono truncate ${
                                    col.isSensitive
                                      ? 'text-rose-400 line-through'
                                      : 'text-slate-200'
                                  }`}
                                >
                                  {col.name}
                                </span>
                                {col.isPrimaryKey && (
                                  <span className="text-[10px] font-mono text-amber-400">
                                    PK
                                  </span>
                                )}
                                {col.foreignKey && (
                                  <span
                                    title={`Foreign Key -> ${col.foreignKey.toTable}.${col.foreignKey.toColumn}`}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-mono text-sky-400"
                                  >
                                    <Link2 className="w-2.5 h-2.5" />
                                    <span>
                                      FK&rarr;{col.foreignKey.toTable}
                                    </span>
                                  </span>
                                )}
                                {col.isSensitive && (
                                  <span className="text-[10px] font-mono text-rose-400 font-semibold">
                                    Protected
                                  </span>
                                )}
                              </div>
                              <span className="font-mono text-[11px] text-slate-400 shrink-0">
                                {col.type}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400">
                              {col.description}
                            </p>
                            {col.enumValues && col.enumValues.length > 0 && (
                              <div className="font-mono text-[10px] text-slate-400 truncate">
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
              <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <EyeOff className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Protected columns (automatically blocked from queries):
                  </span>
                </div>
                <span className="font-mono text-amber-300">
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
                className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-mono text-xs font-semibold text-sky-300">
                    {entry.term}
                  </h3>
                  <span className="font-mono text-[11px] text-slate-400">
                    {entry.category}
                  </span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {entry.definition}
                </p>
                <div className="font-mono text-[11px] text-slate-300 bg-slate-900/90 p-2 rounded border border-slate-800/80 break-words">
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
                className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5"
              >
                <div className="font-mono text-xs font-semibold text-sky-300">
                  {hint.expression}
                </div>
                <p className="text-xs text-slate-300">{hint.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

