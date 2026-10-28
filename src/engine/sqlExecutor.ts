/**
 * Trusted Worker SQL Executor (/src/engine/sqlExecutor.ts)
 *
 * Implements Step 9 (Dry Run EXPLAIN QUERY PLAN) and Step 10 (Execute with 1000-row cap)
 * on an sql.js Database instance.
 *
 * CRITICAL CONTRACT (spec v6.3):
 * - Both functions accept ONLY the branded type `ValidatedSql`.
 * - Step 9 runs `EXPLAIN QUERY PLAN` only to confirm SQLite accepts the statement and NEVER parses its output.
 * - Step 10 prepares the exact `ValidatedSql` string without editing the SQL text, steps at most 1000 rows,
 *   and treats 0 rows as a valid result with `emptyMessage: "No rows matched"`.
 */

import type { Database } from 'sql.js';
import type {
  DryRunResult,
  QueryExecutionResult,
  SqlCellValue,
  ValidatedSql,
} from '../types';

export const MAX_EXECUTION_ROWS = 1000;

/**
 * Step 9: Dry run EXPLAIN QUERY PLAN on the SQLite database.
 * Confirms SQLite accepts the query without parsing the query plan output.
 */
export function runDryRunOnDb(db: Database, sql: ValidatedSql): DryRunResult {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('Dry run requires a non-empty ValidatedSql string.');
  }

  const t0 = performance.now();
  const stmt = db.prepare(`EXPLAIN QUERY PLAN ${sql}`);
  try {
    while (stmt.step()) {
      // Intentionally do not read or parse EXPLAIN QUERY PLAN rows.
    }
  } finally {
    stmt.free();
  }

  return {
    ok: true,
    durationMs: Math.max(0.1, Number((performance.now() - t0).toFixed(2))),
  };
}

/**
 * Step 10: Execute a ValidatedSql query on the SQLite database, reading at most 1000 rows
 * while stepping and never editing the SQL text.
 */
export function runExecuteOnDb(
  db: Database,
  sql: ValidatedSql
): QueryExecutionResult {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('Execute requires a non-empty ValidatedSql string.');
  }

  const t0 = performance.now();
  const stmt = db.prepare(sql);
  const columns = stmt.getColumnNames();
  const rows: SqlCellValue[][] = [];
  let truncated = false;

  try {
    while (stmt.step()) {
      if (rows.length < MAX_EXECUTION_ROWS) {
        const rawRow = stmt.get();
        const mappedRow: SqlCellValue[] = rawRow.map((val) => {
          if (val === null || val === undefined) return null;
          if (typeof val === 'number' || typeof val === 'string') return val;
          return String(val);
        });
        rows.push(mappedRow);
      } else {
        // 1001st row reached: cap at 1000 rows without reading further
        truncated = true;
        break;
      }
    }
  } finally {
    stmt.free();
  }

  const isEmpty = rows.length === 0;

  return {
    columns,
    rows,
    rowCount: rows.length,
    truncated,
    isEmpty,
    emptyMessage: isEmpty ? 'No rows matched' : null,
    executionTimeMs: Math.max(0.1, Number((performance.now() - t0).toFixed(2))),
  };
}
