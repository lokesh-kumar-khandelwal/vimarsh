import React, { useState } from 'react';
import { ArrowUpDown, CheckCircle2, Download } from 'lucide-react';
import { exportRowsToCsv, generateCsvFilename } from '../../engine/csvExport';
import type { QueryExecutionResult } from '../../types';
import { buildFactualResultSummary, sortResultRows } from './resultHelpers';

interface QueryResultTableProps {
  turnId: string;
  executionResult: QueryExecutionResult;
  question?: string;
}

export const QueryResultTable: React.FC<QueryResultTableProps> = ({
  turnId,
  executionResult,
  question,
}) => {
  const [sortState, setSortState] = useState<
    { colIndex: number; direction: 'asc' | 'desc' } | undefined
  >(undefined);
  const [isDownloaded, setIsDownloaded] = useState<boolean>(false);

  const factualSummary = buildFactualResultSummary(executionResult);
  const sortedRows = sortResultRows(executionResult.rows, sortState);

  const handleSortColumn = (colIndex: number) => {
    setSortState((prev) => {
      const nextDirection =
        prev && prev.colIndex === colIndex && prev.direction === 'asc'
          ? 'desc'
          : 'asc';
      return { colIndex, direction: nextDirection };
    });
  };

  const handleDownloadCsv = () => {
    const filename = generateCsvFilename(question);
    exportRowsToCsv(executionResult.columns, sortedRows, filename);
    setIsDownloaded(true);
    setTimeout(() => {
      setIsDownloaded(false);
    }, 2000);
  };

  return (
    <div data-turn-id={turnId} className="space-y-4">
      <div className="rounded-none border border-[#e4e4e7]/20 bg-[#0c0c0e] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5 min-w-[200px]">
          {factualSummary ? (
            <>
              <div className="text-base font-bold text-[#e4e4e7] font-mono tabular-nums">
                {factualSummary.headline}
              </div>
              <div className="text-xs text-[#e4e4e7]/60 font-mono tabular-nums">
                {factualSummary.subline}
              </div>
            </>
          ) : (
            <div className="text-sm font-bold text-[#e4e4e7] font-mono tabular-nums">
              Query Results ({executionResult.rowCount}{' '}
              {executionResult.rowCount === 1 ? 'row' : 'rows'})
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleDownloadCsv}
          aria-label="Download query results as CSV"
          title="Download query results as CSV"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider rounded-none border border-[#e4e4e7]/40 bg-[#121216] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-colors shrink-0 cursor-pointer"
        >
          {isDownloaded ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-[#4ade80]" />
              <span className="text-[#4ade80]">Downloaded CSV</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5 text-[#38bdf8]" />
              <span>Download CSV</span>
            </>
          )}
        </button>
      </div>

      <div className="rounded-none border border-[#e4e4e7]/20 bg-[#0c0c0e] overflow-hidden">
        {executionResult.truncated && (
          <div className="px-3.5 py-2 border-b border-[#fbbf24]/40 text-xs font-mono text-[#fbbf24] bg-[#fbbf24]/10">
            Showing the first 1,000 rows (maximum query row limit).
          </div>
        )}
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-[#e4e4e7] bg-[#121216] text-[#e4e4e7] font-mono text-[11px] uppercase tracking-wider">
                {executionResult.columns.map((col, cIdx) => (
                  <th
                    key={col}
                    className="py-2.5 px-3.5 whitespace-nowrap font-bold"
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn(cIdx)}
                      className="inline-flex items-center gap-1.5 hover:text-[#38bdf8] cursor-pointer"
                    >
                      <span>{col}</span>
                      <ArrowUpDown className="w-3 h-3 text-[#38bdf8]" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e4e7]/10 font-mono text-xs">
              {sortedRows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="hover:bg-[#e4e4e7]/[0.03] transition-colors"
                >
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="py-2.5 px-3.5 whitespace-nowrap text-[#e4e4e7] tabular-nums"
                    >
                      {cell === null ? (
                        <span className="text-[#e4e4e7]/40 italic">NULL</span>
                      ) : typeof cell === 'number' ? (
                        cell.toLocaleString()
                      ) : (
                        String(cell)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
