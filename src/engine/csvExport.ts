/**
 * Vimarsh CSV Export Utility (/src/engine/csvExport.ts)
 *
 * Implements RFC 4180 compliant CSV formatting and file downloading for tabular query results.
 * - Proper cell escaping for quotes, commas, CRLF newlines, and null/undefined values.
 * - Prepending UTF-8 BOM (\uFEFF) to guarantee correct Excel encoding on Windows and macOS.
 * - Question-derived filename slugs with timestamped fallback.
 */

import type { SqlCellValue } from '../types';

/**
 * Escapes an individual cell value according to RFC 4180 rules.
 * - null or undefined -> empty string
 * - numbers -> standard string representation without commas (preserves raw numeric value)
 * - strings containing ", comma, \r, or \n -> wrapped in double quotes with embedded quotes escaped as ""
 */
export function escapeCsvCell(val: SqlCellValue | unknown): string {
  if (val === null || val === undefined) {
    return '';
  }

  if (typeof val === 'number') {
    // Preserve raw numeric representation (avoid locale thousands commas)
    return Number.isFinite(val) ? String(val) : '';
  }

  const str = String(val);
  if (
    str.includes('"') ||
    str.includes(',') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Formats columns and rows into an RFC 4180 compliant CSV string using \r\n line terminators.
 */
export function generateCsv(
  columns: readonly string[],
  rows: readonly (readonly SqlCellValue[])[]
): string {
  const headerLine = columns.map((c) => escapeCsvCell(c)).join(',');
  const rowLines = rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(','));
  return [headerLine, ...rowLines].join('\r\n');
}

/**
 * Generates a clean, descriptive filename slug from a natural language question.
 * Fallback to timestamped name if question is empty or slug is blank.
 *
 * Example:
 *   "Total revenue by product line?" -> "vimarsh_total_revenue_by_product_line.csv"
 */
export function generateCsvFilename(
  question?: string | null,
  timestamp: number = Date.now()
): string {
  if (!question || typeof question !== 'string') {
    return `vimarsh_query_results_${timestamp}.csv`;
  }

  const cleaned = question
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned) {
    return `vimarsh_query_results_${timestamp}.csv`;
  }

  // Cap slug length at 48 chars to prevent excessively long filesystem filenames
  const slug = cleaned.length > 48 ? cleaned.slice(0, 48).replace(/_+$/, '') : cleaned;
  return `vimarsh_${slug}.csv`;
}

/**
 * Triggers a client-side CSV download using a UTF-8 Blob with BOM.
 * Safe to call in both browser and test/SSR environments.
 */
export function exportRowsToCsv(
  columns: readonly string[],
  rows: readonly (readonly SqlCellValue[])[],
  filename?: string
): { csvContent: string; filename: string } {
  const targetFilename = filename || generateCsvFilename();
  const csvContent = generateCsv(columns, rows);

  if (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    // Prepend UTF-8 BOM (\uFEFF) so Excel on Windows/macOS correctly opens UTF-8 encoded text
    const blob = new Blob(['\uFEFF' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = targetFilename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return { csvContent, filename: targetFilename };
}
