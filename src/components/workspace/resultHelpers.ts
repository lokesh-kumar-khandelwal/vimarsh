import type { QueryExecutionResult, SqlCellValue } from '../../types';

export interface AutoChartModel {
  labelColumn: string;
  valueColumn: string;
  items: Array<{ label: string; value: number }>;
  maxValue: number;
}

/**
 * Detects whether a QueryExecutionResult is suitable for an automatic bar chart:
 * requires 2 to 20 rows, at least 2 columns, a numeric metric column, and a label column.
 */
export function buildAutoChartModel(
  execResult?: QueryExecutionResult
): AutoChartModel | null {
  if (
    !execResult ||
    execResult.isEmpty ||
    execResult.rows.length < 2 ||
    execResult.rows.length > 20 ||
    execResult.columns.length < 2
  ) {
    return null;
  }

  let numericColIdx = -1;
  for (let c = execResult.columns.length - 1; c >= 0; c -= 1) {
    const colName = execResult.columns[c].toLowerCase();
    if (colName.endsWith('_id') && c === 0 && execResult.columns.length > 2) {
      continue;
    }
    const allNumeric = execResult.rows.every(
      (r) => typeof r[c] === 'number' && Number.isFinite(r[c] as number)
    );
    if (allNumeric) {
      numericColIdx = c;
      break;
    }
  }

  if (numericColIdx === -1) return null;

  let labelColIdx = -1;
  for (let c = 0; c < execResult.columns.length; c += 1) {
    if (c === numericColIdx) continue;
    const hasString = execResult.rows.some((r) => typeof r[c] === 'string');
    if (hasString) {
      labelColIdx = c;
      break;
    }
  }
  if (labelColIdx === -1) {
    labelColIdx = numericColIdx === 0 ? 1 : 0;
  }

  const items = execResult.rows.map((r) => ({
    label: r[labelColIdx] === null ? 'NULL' : String(r[labelColIdx]),
    value: Number(r[numericColIdx] ?? 0),
  }));

  const maxAbs = Math.max(...items.map((i) => Math.abs(i.value)), 0);
  if (maxAbs <= 0) return null;

  return {
    labelColumn: execResult.columns[labelColIdx],
    valueColumn: execResult.columns[numericColIdx],
    items,
    maxValue: maxAbs,
  };
}

/**
 * Derives a concise, factual summary strictly from the existing QueryExecutionResult.
 */
export function buildFactualResultSummary(execResult?: QueryExecutionResult): {
  headline: string;
  subline: string;
} | null {
  if (!execResult || execResult.isEmpty) {
    return null;
  }

  const { columns, rows, rowCount, executionTimeMs, truncated } = execResult;

  if (rowCount === 1 && columns.length === 1) {
    const cellVal = rows[0]?.[0];
    const formattedVal =
      typeof cellVal === 'number'
        ? cellVal.toLocaleString()
        : cellVal === null
          ? 'NULL'
          : String(cellVal);
    return {
      headline: `${columns[0]}: ${formattedVal}`,
      subline: `1 row returned in ${executionTimeMs} ms`,
    };
  }

  return {
    headline: `Returned ${rowCount} ${rowCount === 1 ? 'row' : 'rows'}${
      truncated ? ' (capped at 1,000 rows)' : ''
    }`,
    subline: `${columns.length} ${
      columns.length === 1 ? 'column' : 'columns'
    } (${columns.join(', ')}) · executed in ${executionTimeMs} ms`,
  };
}

export interface ErrorTurnClassification {
  title: string;
  category:
    | 'cancelled'
    | 'api_key'
    | 'quota'
    | 'service_unavailable'
    | 'network'
    | 'repair'
    | 'general';
}

/**
 * Classifies a processingError turn into a user-understandable error heading.
 */
export function classifyErrorTurnHeading(
  reason: string | null
): ErrorTurnClassification {
  const text = reason ?? '';
  if (/cancelled|canceled|aborted/i.test(text)) {
    return { title: 'Question Cancelled', category: 'cancelled' };
  }
  if (/401|403|invalid key|connect your api key/i.test(text)) {
    return { title: 'API Key Problem', category: 'api_key' };
  }
  if (/429|quota|rate limit/i.test(text)) {
    return { title: 'API Quota or Rate Limit Reached', category: 'quota' };
  }
  if (/\b503\b|temporarily unavailable|overloaded|high demand/i.test(text)) {
    return {
      title: 'Gemini Service Temporarily Unavailable (503)',
      category: 'service_unavailable',
    };
  }
  if (/network error|unavailable|404/i.test(text)) {
    return { title: 'Gemini API Connection Error', category: 'network' };
  }
  if (/repair attempts|verified safe query/i.test(text)) {
    return {
      title: 'Could Not Produce a Verified Query',
      category: 'repair',
    };
  }
  return { title: 'Could Not Process Request', category: 'general' };
}

/**
 * Sorts result rows deterministically by column index and direction, placing NULLs last.
 */
export function sortResultRows(
  rows: SqlCellValue[][],
  sortConfig?: { colIndex: number; direction: 'asc' | 'desc' }
): SqlCellValue[][] {
  if (!sortConfig) return rows;
  const { colIndex, direction } = sortConfig;
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
    const sa = String(va);
    const sb = String(vb);
    return direction === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
  });
  return copy;
}
