import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  ArrowUpRight,
  Check,
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
import { formatSql } from '../engine/sqlFormatter';
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
  onToggleOpen?: () => void;
  onClose?: () => void;
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
  onClose,
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
      className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] overflow-hidden"
    >
      {/* Top Banner & Toggle Header */}
      <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e4e7]/15 bg-[#0c0c0e]">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-none bg-[#121216] border border-[#e4e4e7]/25 text-[#38bdf8]">
            <History className="w-4 h-4 shrink-0" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#e4e4e7]">
                Query History
              </h2>
              <span className="text-xs text-[#38bdf8] font-mono tabular-nums">
                ({history.length} {history.length === 1 ? 'query' : 'queries'})
              </span>
            </div>
            <p className="text-xs text-[#e4e4e7]/60 leading-normal">
              Past SQL queries executed against the SQLite database. Re-run or inspect anytime.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {history.length > 0 && isOpen && (
            <>
              {isConfirmingClear ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono text-[#f87171]">Clear all?</span>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="px-2.5 py-1 text-[11px] font-mono font-bold uppercase tracking-wider rounded-none bg-[#f87171] text-[#0c0c0e] hover:bg-[#f87171]/90 transition-colors cursor-pointer"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsConfirmingClear(false)}
                    className="px-2 py-1 text-[11px] font-mono uppercase tracking-wider rounded-none text-[#e4e4e7]/70 hover:text-[#e4e4e7] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsConfirmingClear(true)}
                  className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/20 text-[#e4e4e7]/70 hover:text-[#f87171] hover:border-[#f87171] transition-colors cursor-pointer"
                  title="Clear all query history"
                >
                  Clear history
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={onClose ?? onToggleOpen}
            aria-label="Close Query History"
            aria-expanded={isOpen}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/35 bg-[#0c0c0e] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Close</span>
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
              <Search className="w-4 h-4 text-[#e4e4e7]/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="query-history-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by question text, SQL keywords, or table name (e.g. orders, revenue)..."
                className="w-full pl-9 pr-8 py-2 text-xs font-mono rounded-none bg-[#0c0c0e] border border-[#e4e4e7]/25 text-[#e4e4e7] placeholder-[#e4e4e7]/40 focus:border-[#38bdf8]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear filter search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#e4e4e7]/60 hover:text-[#38bdf8] p-0.5 rounded-none cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Empty state */}
          {history.length === 0 ? (
            <div className="text-center py-8 px-4 rounded-none border border-dashed border-[#e4e4e7]/25 bg-[#0c0c0e] space-y-2">
              <Code2 className="w-8 h-8 text-[#38bdf8]/70 mx-auto" />
              <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#e4e4e7]">
                No queries executed yet
              </p>
              <p className="text-xs text-[#e4e4e7]/60 max-w-md mx-auto">
                Ask a question in the box above to generate and run SQLite queries.
                Executed queries are automatically saved here so you can re-run them with one click.
              </p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-center py-6 px-4 text-xs font-mono text-[#e4e4e7]/60">
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
                    className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-4 space-y-3 hover:border-[#e4e4e7]/40 transition-colors"
                  >
                    {/* Item Header: User Question + Actions */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1 flex-1 min-w-[200px]">
                        <h3 className="text-xs font-semibold text-[#e4e4e7] leading-snug">
                          {item.question}
                        </h3>

                        {/* Unboxed Metadata */}
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#e4e4e7]/60 font-mono">
                          <span>{item.rowCount} {item.rowCount === 1 ? 'row' : 'rows'}</span>
                          <span aria-hidden="true" className="text-[#e4e4e7]/30">·</span>
                          <span className="tabular-nums">{item.executionTimeMs} ms</span>
                          <span aria-hidden="true" className="text-[#e4e4e7]/30">·</span>
                          <span>{formatRelativeTime(item.timestamp)}</span>
                          {item.tablesUsed.length > 0 && (
                            <>
                              <span aria-hidden="true" className="text-[#e4e4e7]/30">·</span>
                              <span className="text-[#38bdf8] font-bold">
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
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider rounded-none bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8] disabled:opacity-50 transition-colors cursor-pointer"
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
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/30 bg-[#121216] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-colors cursor-pointer"
                          title="Load this question into the input field to re-ask or refine"
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Load Question</span>
                        </button>

                        {/* Copy SQL Button */}
                        <button
                          type="button"
                          onClick={() => void handleCopySql(item.id, item.sql)}
                          className="p-1.5 text-xs font-mono rounded-none border border-[#e4e4e7]/30 bg-[#121216] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-colors cursor-pointer"
                          title={isCopied ? 'Copied to clipboard!' : 'Copy SQL query'}
                          aria-label="Copy SQL query"
                        >
                          {isCopied ? (
                            <Check className="w-3.5 h-3.5 text-[#4ade80]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-[#e4e4e7]/70" />
                          )}
                        </button>

                        {/* Delete Entry */}
                        <button
                          type="button"
                          onClick={() => removeQueryHistoryEntry(item.id)}
                          className="p-1.5 text-xs font-mono rounded-none border border-transparent text-[#e4e4e7]/60 hover:text-[#f87171] hover:border-[#f87171]/40 transition-colors cursor-pointer"
                          title="Remove from history"
                          aria-label="Remove from history"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* SQL Code Block */}
                    <div className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-3 font-mono text-xs text-[#38bdf8] overflow-x-auto whitespace-pre-wrap break-words leading-relaxed tab-size-2">
                      {formatSql(item.sql)}
                    </div>

                    {/* Live Re-run Results Viewer */}
                    {live && (
                      <div className="rounded-none border border-[#38bdf8]/40 bg-[#121216] p-3.5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 font-mono font-bold uppercase tracking-wider text-[#e4e4e7]">
                            <Database className="w-3.5 h-3.5 text-[#38bdf8]" />
                            <span>Live Execution Result</span>
                            {live.result && (
                              <span className="text-[#4ade80] font-mono text-[11px] tabular-nums">
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
                                className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-[#38bdf8] hover:underline cursor-pointer"
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
                              className="text-[#e4e4e7]/60 hover:text-[#e4e4e7] p-0.5 rounded-none cursor-pointer"
                              title="Close live results"
                              aria-label="Close live results"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {live.error ? (
                          <div className="p-2.5 rounded-none bg-[#f87171]/10 border border-[#f87171] text-xs font-mono text-[#f87171]">
                            Error executing query: {live.error}
                          </div>
                        ) : live.result?.isEmpty ? (
                          <div className="p-2.5 rounded-none bg-[#0c0c0e] border border-[#e4e4e7]/20 text-xs font-mono text-[#e4e4e7]/70">
                            Query ran successfully but returned 0 rows.
                          </div>
                        ) : (
                          live.result && (
                            <div className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] overflow-hidden">
                              <div className="overflow-x-auto max-h-64">
                                <table className="w-full text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="border-b border-[#e4e4e7]/25 bg-[#121216] text-[#e4e4e7] font-mono text-[10px] uppercase tracking-wider">
                                      {live.result.columns.map((col, cIdx) => (
                                        <th
                                          key={col}
                                          className="py-2 px-3 whitespace-nowrap font-bold"
                                        >
                                          <button
                                            type="button"
                                            onClick={() => handleSortColumn(item.id, cIdx)}
                                            className="inline-flex items-center gap-1 hover:text-[#38bdf8] cursor-pointer"
                                          >
                                            <span>{col}</span>
                                            <ArrowUpDown className="w-2.5 h-2.5 text-[#38bdf8]" />
                                          </button>
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#e4e4e7]/10 font-mono text-[11px]">
                                    {getSortedLiveRows(item.id, live.result.rows).map(
                                      (row, rIdx) => (
                                        <tr
                                          key={rIdx}
                                          className="hover:bg-[#e4e4e7]/[0.03] transition-colors"
                                        >
                                          {row.map((cell, cIdx) => (
                                            <td
                                              key={cIdx}
                                              className="py-1.5 px-3 whitespace-nowrap text-[#e4e4e7] tabular-nums"
                                            >
                                              {cell === null ? (
                                                <span className="text-[#e4e4e7]/40 italic">
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
