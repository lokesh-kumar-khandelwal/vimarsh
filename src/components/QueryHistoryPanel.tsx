import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Database,
  Download,
  History,
  Play,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { DbClient } from '../engine/dbClient';
import {
  clearQueryHistory,
  getQueryHistory,
  removeQueryHistoryEntry,
  subscribeQueryHistory,
} from '../engine/queryHistory';
import { exportRowsToCsv, generateCsvFilename } from '../engine/csvExport';
import type {
  QueryExecutionResult,
  QueryHistoryEntry,
  SqlCellValue,
  ValidatedSql,
} from '../types';

interface QueryHistoryPanelProps {
  dbClient: DbClient;
  onLoadQuestion: (question: string) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
}

function formatRelativeTime(isoString: string): string {
  try {
    const then = new Date(isoString).getTime();
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((now - then) / 1000));
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(isoString).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Recently';
  }
}

export const QueryHistoryPanel: React.FC<QueryHistoryPanelProps> = ({
  dbClient,
  onLoadQuestion,
  isOpen,
  onToggleOpen,
}) => {
  const [history, setHistory] = useState<QueryHistoryEntry[]>(() =>
    getQueryHistory()
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [liveResults, setLiveResults] = useState<
    Record<
      string,
      {
        result?: QueryExecutionResult;
        error?: string;
        executedAt: string;
      }
    >
  >({});
  const [sortConfigs, setSortConfigs] = useState<
    Record<string, { colIndex: number; direction: 'asc' | 'desc' }>
  >({});
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  useEffect(() => {
    return subscribeQueryHistory(setHistory);
  }, []);

  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (item) =>
        item.question.toLowerCase().includes(q) ||
        item.sql.toLowerCase().includes(q) ||
        item.tablesUsed.some((t) => t.toLowerCase().includes(q))
    );
  }, [history, searchQuery]);

  const handleCopySql = async (id: string, sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
      setCopiedId(null);
    }
  };

  const handleRerunSql = async (entry: QueryHistoryEntry) => {
    if (runningId) return;
    setRunningId(entry.id);
    try {
      const res = await dbClient.execute(entry.sql as ValidatedSql);
      setLiveResults((prev) => ({
        ...prev,
        [entry.id]: {
          result: res,
          executedAt: new Date().toISOString(),
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLiveResults((prev) => ({
        ...prev,
        [entry.id]: {
          error: msg,
          executedAt: new Date().toISOString(),
        },
      }));
    } finally {
      setRunningId(null);
    }
  };

  const handleSortColumn = (entryId: string, colIndex: number) => {
    setSortConfigs((prev) => {
      const curr = prev[entryId];
      const nextDir =
        curr && curr.colIndex === colIndex && curr.direction === 'asc'
          ? 'desc'
          : 'asc';
      return {
        ...prev,
        [entryId]: { colIndex, direction: nextDir },
      };
    });
  };

  const getSortedLiveRows = (entryId: string, rows: SqlCellValue[][]): SqlCellValue[][] => {
    const cfg = sortConfigs[entryId];
    if (!cfg) return rows;
    const { colIndex, direction } = cfg;
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = a[colIndex];
      const vb = b[colIndex];
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return direction === 'asc' ? va - vb : vb - va;
      }
      return direction === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return copy;
  };

  const handleClear = () => {
    clearQueryHistory();
    setLiveResults({});
    setIsConfirmingClear(false);
  };

  return (
    <section
      aria-label="Recent Query History"
      className="rounded-xl border border-slate-800 bg-slate-900/90 overflow-hidden transition-all duration-200"
    >
      {/* Top Banner & Toggle Header */}
      <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-900/95">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-950/60 border border-sky-800/50 text-sky-400">
            <History className="w-5 h-5 shrink-0" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-100">
                Query History
              </h2>
              <span className="text-xs text-slate-400 font-mono">
                ({history.length} {history.length === 1 ? 'query' : 'queries'})
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-normal">
              Past SQL queries executed against the SQLite database. Re-run or inspect anytime.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {history.length > 0 && isOpen && (
            <>
              {isConfirmingClear ? (
                <div className="flex items-center gap-1.5 animate-fadeIn">
                  <span className="text-xs text-rose-300">Clear all?</span>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="px-2.5 py-1 text-xs font-semibold rounded-md bg-rose-600 text-white hover:bg-rose-500 transition-colors focus-visible:outline-2 focus-visible:outline-rose-400"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsConfirmingClear(false)}
                    className="px-2 py-1 text-xs font-medium rounded-md text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsConfirmingClear(true)}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-950/30 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
                  title="Clear all query history"
                >
                  Clear history
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={isOpen}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:text-white hover:bg-slate-700 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <span>{isOpen ? 'Collapse' : 'View History'}</span>
            {isOpen ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="p-4 sm:p-5 space-y-4">
          {/* Search bar when history is populated */}
          {history.length > 0 && (
            <div className="relative">
              <label htmlFor="query-history-search" className="sr-only">
                Filter query history
              </label>
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="query-history-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by question text, SQL keywords, or table name (e.g. orders, revenue)..."
                className="w-full pl-9 pr-8 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus-visible:outline-2 focus-visible:outline-sky-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear filter search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-0.5 rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Empty state */}
          {history.length === 0 ? (
            <div className="text-center py-8 px-4 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 space-y-2">
              <Code2 className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-sm font-medium text-slate-300">
                No queries executed yet
              </p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Ask a question in the box above to generate and run SQLite queries.
                Executed queries are automatically saved here so you can re-run them with one click.
              </p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-center py-6 px-4 text-xs text-slate-400">
              No queries match &ldquo;{searchQuery}&rdquo;. Try clearing your search filter.
            </div>
          ) : (
            <div className="space-y-3.5 max-h-[540px] overflow-y-auto pr-1">
              {filteredHistory.map((item) => {
                const live = liveResults[item.id];
                const isRunningThis = runningId === item.id;
                const isCopied = copiedId === item.id;

                return (
                  <article
                    key={item.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/80 p-4 space-y-3 hover:border-slate-700 transition-colors"
                  >
                    {/* Item Header: User Question + Actions */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1 flex-1 min-w-[200px]">
                        <h3 className="text-xs font-semibold text-slate-200 leading-snug">
                          {item.question}
                        </h3>

                        {/* Unboxed Metadata (Zero-Pill discipline) */}
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono">
                          <span>{item.rowCount} {item.rowCount === 1 ? 'row' : 'rows'}</span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="tabular-nums">{item.executionTimeMs} ms</span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span>{formatRelativeTime(item.timestamp)}</span>
                          {item.tablesUsed.length > 0 && (
                            <>
                              <span aria-hidden="true" className="text-slate-600">·</span>
                              <span className="text-sky-400/90">
                                tables: {item.tablesUsed.join(', ')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Re-run SQL Button */}
                        <button
                          type="button"
                          disabled={isRunningThis}
                          onClick={() => void handleRerunSql(item)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-sky-300"
                          title="Execute this SQL query now in the SQLite database"
                        >
                          {isRunningThis ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current" />
                          )}
                          <span>{isRunningThis ? 'Running...' : 'Re-run'}</span>
                        </button>

                        {/* Load Question Button */}
                        <button
                          type="button"
                          onClick={() => onLoadQuestion(item.question)}
                          className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
                          title="Load this question into the input field to re-ask or refine"
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Load Question</span>
                        </button>

                        {/* Copy SQL Button */}
                        <button
                          type="button"
                          onClick={() => void handleCopySql(item.id, item.sql)}
                          className="p-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
                          title={isCopied ? 'Copied to clipboard!' : 'Copy SQL query'}
                          aria-label="Copy SQL query"
                        >
                          {isCopied ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {/* Delete Entry */}
                        <button
                          type="button"
                          onClick={() => removeQueryHistoryEntry(item.id)}
                          className="p-1.5 text-xs font-medium rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
                          title="Remove from history"
                          aria-label="Remove from history"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* SQL Code Block */}
                    <div className="rounded-md border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-sky-200 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
                      {item.sql}
                    </div>

                    {/* Live Re-run Results Viewer */}
                    {live && (
                      <div className="rounded-lg border border-sky-900/60 bg-slate-900/90 p-3.5 space-y-3 animate-fadeIn">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 font-medium text-slate-200">
                            <Database className="w-3.5 h-3.5 text-sky-400" />
                            <span>Live Execution Result</span>
                            {live.result && (
                              <span className="text-slate-400 font-mono text-[11px] tabular-nums">
                                ({live.result.rowCount} rows · {live.result.executionTimeMs} ms)
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {live.result && live.result.rows.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  exportRowsToCsv(
                                    live.result!.columns,
                                    getSortedLiveRows(item.id, live.result!.rows),
                                    generateCsvFilename(item.question)
                                  )
                                }
                                className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-medium underline"
                              >
                                <Download className="w-3 h-3" />
                                <span>Export CSV</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() =>
                                setLiveResults((prev) => {
                                  const copy = { ...prev };
                                  delete copy[item.id];
                                  return copy;
                                })
                              }
                              className="text-slate-400 hover:text-slate-200 p-0.5 rounded"
                              title="Close live results"
                              aria-label="Close live results"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {live.error ? (
                          <div className="p-2.5 rounded bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300">
                            Error executing query: {live.error}
                          </div>
                        ) : live.result?.isEmpty ? (
                          <div className="p-2.5 rounded bg-slate-950 text-xs text-slate-400">
                            Query ran successfully but returned 0 rows.
                          </div>
                        ) : (
                          live.result && (
                            <div className="rounded border border-slate-800 bg-slate-950 overflow-hidden">
                              <div className="overflow-x-auto max-h-64">
                                <table className="w-full text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-200 font-mono text-[11px]">
                                      {live.result.columns.map((col, cIdx) => (
                                        <th
                                          key={col}
                                          className="py-2 px-3 whitespace-nowrap"
                                        >
                                          <button
                                            type="button"
                                            onClick={() => handleSortColumn(item.id, cIdx)}
                                            className="inline-flex items-center gap-1 hover:text-sky-300 font-medium"
                                          >
                                            <span>{col}</span>
                                            <ArrowUpDown className="w-2.5 h-2.5 text-slate-500" />
                                          </button>
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                                    {getSortedLiveRows(item.id, live.result.rows).map(
                                      (row, rIdx) => (
                                        <tr
                                          key={rIdx}
                                          className="hover:bg-slate-900/50"
                                        >
                                          {row.map((cell, cIdx) => (
                                            <td
                                              key={cIdx}
                                              className="py-1.5 px-3 whitespace-nowrap text-slate-200 tabular-nums"
                                            >
                                              {cell === null ? (
                                                <span className="text-slate-500 italic">
                                                  NULL
                                                </span>
                                              ) : typeof cell === 'number' ? (
                                                cell.toLocaleString()
                                              ) : (
                                                String(cell)
                                              )}
                                            </td>
                                          ))}
                                        </tr>
                                      )
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
