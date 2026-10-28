import React, { useState } from 'react';
import {
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
}

export const Sidebar: React.FC<SidebarProps> = ({
  schemaContext,
  isLoading,
  onResetDatabase,
}) => {
  const [sidebarTab, setSidebarTab] = useState<'schema' | 'glossary'>('schema');
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({
    customers: true,
    products: true,
    orders: true,
    order_items: true,
    returns: true,
  });

  const toggleTable = (tableName: string) => {
    setExpandedTables((prev) => ({
      ...prev,
      [tableName]: !prev[tableName],
    }));
  };

  return (
    <aside
      aria-label="Schema Explorer, Business Glossary, and Database Controls"
      className="w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-900/80 flex flex-col"
    >
      {/* Header & Reset Button */}
      <div className="p-3.5 border-b border-slate-800 flex items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Sidebar Reference Tabs"
          className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'schema'}
            onClick={() => setSidebarTab('schema')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
              sidebarTab === 'schema'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>Schema</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'glossary'}
            onClick={() => setSidebarTab('glossary')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
              sidebarTab === 'glossary'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>Glossary ({schemaContext?.glossary.length ?? 11})</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onResetDatabase}
          disabled={isLoading}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
          title="Destroy and re-seed the in-memory SQLite database"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Reset</span>
        </button>
      </div>

      {/* Body: Schema Explorer or Business Glossary Cards */}
      <div className="p-3 space-y-2.5 overflow-y-auto flex-1 max-h-[calc(100vh-7rem)]">
        {!schemaContext ? (
          <div className="p-4 text-xs text-slate-400">
            {isLoading
              ? 'Loading live schema from SQLite Web Worker...'
              : 'Schema unavailable.'}
          </div>
        ) : sidebarTab === 'schema' ? (
          <>
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
                    className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-800/60 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <span className="font-mono text-xs font-semibold text-slate-100 truncate">
                        {table.name}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                      {table.rowCount} rows
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-800/80 px-3 py-2 space-y-1">
                      {table.columns.map((col) => (
                        <div
                          key={col.name}
                          className="space-y-0.5 py-0.5 border-b border-slate-900 last:border-b-0"
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
                                <span className="text-[10px] font-mono uppercase text-amber-400">
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
                                <span className="text-[10px] font-mono uppercase text-rose-400 font-semibold">
                                  SENSITIVE
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-[11px] text-slate-400 shrink-0">
                              {col.type}
                            </span>
                          </div>
                          {col.enumValues && col.enumValues.length > 0 && (
                            <div className="font-mono text-[10px] text-slate-400 truncate">
                              enum: {col.enumValues.join(' | ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Sensitive Columns Notice */}
            {schemaContext.sensitiveColumns.length > 0 && (
              <div className="mt-3 p-3 rounded-lg border border-amber-900/50 bg-amber-950/20 space-y-1.5">
                <div className="flex items-center gap-1.5 text-amber-300 text-xs font-medium">
                  <EyeOff className="w-3.5 h-3.5 shrink-0" />
                  <span>Designated Sensitive Columns</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Blocked in SELECT, WHERE, GROUP BY, ORDER BY, subqueries, CTEs,
                  and aliases by Step 7 of the SQL validator:
                </p>
                <ul className="space-y-0.5">
                  {schemaContext.sensitiveColumns.map((col: string) => (
                    <li
                      key={col}
                      className="font-mono text-[11px] text-amber-200/90"
                    >
                      • {col}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          /* Business Glossary Cards */
          <div className="space-y-2.5">
            {schemaContext.glossary.map((entry) => (
              <article
                key={entry.term}
                aria-label={`Glossary term ${entry.term}`}
                className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-mono text-xs font-semibold text-sky-300">
                    {entry.term}
                  </h3>
                  <span className="font-mono text-[10px] uppercase text-slate-400">
                    {entry.category}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {entry.definition}
                </p>
                <div className="font-mono text-[11px] text-slate-400 bg-slate-900/90 p-2 rounded border border-slate-800/80 break-words">
                  {entry.formulaOrRule}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
