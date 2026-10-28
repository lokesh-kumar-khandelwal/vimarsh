/**
 * SQLite Web Worker (/src/engine/dbWorker.ts)
 *
 * Runs sql.js inside a dedicated Web Worker.
 * Initializes sql.js with locateFile pointing to:
 *   https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.15.2/<file>
 * with automatic fallback to local /<file> (/public/sql-wasm.wasm).
 *
 * Stage 2 capabilities:
 * - INIT / RESET: runs connection setup order, deterministic seed, trusted seed validation,
 *   schema loading, and sets PRAGMA query_only = ON.
 * - GET_SCHEMA_CONTEXT: returns the loaded SchemaContext.
 * - DRY_RUN (Step 9): runs EXPLAIN QUERY PLAN on ValidatedSql.
 * - EXECUTE (Step 10): steps at most 1000 rows on ValidatedSql without editing SQL text.
 */

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { getSqlWasmCdnUrl, getSqlWasmFallbackUrl } from '../config';
import type {
  DryRunResult,
  InitSuccessPayload,
  QueryExecutionResult,
  SchemaContext,
  ValidatedSql,
  WorkerRequest,
  WorkerResponse,
} from '../types';
import { parseLocalYMD } from './dateHelpers';
import { loadSchemaContextFromDb } from './schemaLoader';
import { createAndSeedDatabase } from './seedDatabase';
import { runDryRunOnDb, runExecuteOnDb } from './sqlExecutor';

let sqlEngine: SqlJsStatic | null = null;
let wasmSourceUsed: 'cdn' | 'public-fallback' = 'cdn';
let activeDb: Database | null = null;
let cachedInitPayload: InitSuccessPayload | null = null;

async function ensureSqlEngine(): Promise<{
  SQL: SqlJsStatic;
  wasmSource: 'cdn' | 'public-fallback';
}> {
  if (sqlEngine) {
    return { SQL: sqlEngine, wasmSource: wasmSourceUsed };
  }

  try {
    const SQL = await initSqlJs({
      locateFile: (file: string) => getSqlWasmCdnUrl(file),
    });
    sqlEngine = SQL;
    wasmSourceUsed = 'cdn';
    return { SQL, wasmSource: 'cdn' };
  } catch {
    // Fallback to /sql-wasm.wasm in /public
    const SQL = await initSqlJs({
      locateFile: (file: string) => getSqlWasmFallbackUrl(file),
    });
    sqlEngine = SQL;
    wasmSourceUsed = 'public-fallback';
    return { SQL, wasmSource: 'public-fallback' };
  }
}

function resolveNowDate(nowIsoLocal?: string): Date {
  if (nowIsoLocal) {
    const { year, monthIndex, day } = parseLocalYMD(nowIsoLocal);
    return new Date(year, monthIndex, day, 12, 0, 0, 0);
  }
  return new Date();
}

async function handleInitOrReset(nowIsoLocal?: string): Promise<InitSuccessPayload> {
  const { SQL, wasmSource } = await ensureSqlEngine();
  if (activeDb) {
    try {
      activeDb.close();
    } catch {
      // ignore close errors on old instance
    }
    activeDb = null;
  }

  const now = resolveNowDate(nowIsoLocal);
  const { db, initPayload } = createAndSeedDatabase(SQL, now, wasmSource);
  activeDb = db;
  cachedInitPayload = initPayload;
  return initPayload;
}

function handleGetSchemaContext(): SchemaContext {
  if (!activeDb || !cachedInitPayload) {
    throw new Error('Database is not initialized. Call init() first.');
  }
  return loadSchemaContextFromDb(activeDb);
}

function handleDryRun(sql?: ValidatedSql): DryRunResult {
  if (!activeDb || !cachedInitPayload) {
    throw new Error('Database is not initialized. Call init() first.');
  }
  if (!sql) {
    throw new Error('DRY_RUN requires a ValidatedSql payload.');
  }
  return runDryRunOnDb(activeDb, sql);
}

function handleExecute(sql?: ValidatedSql): QueryExecutionResult {
  if (!activeDb || !cachedInitPayload) {
    throw new Error('Database is not initialized. Call init() first.');
  }
  if (!sql) {
    throw new Error('EXECUTE requires a ValidatedSql payload.');
  }
  return runExecuteOnDb(activeDb, sql);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (!req || typeof req.requestId !== 'string') {
    return;
  }

  const { requestId, epoch, type, payload } = req;

  try {
    switch (type) {
      case 'INIT':
      case 'RESET': {
        const initData = await handleInitOrReset(payload?.nowIsoLocal);
        const res: WorkerResponse = {
          requestId,
          epoch,
          ok: true,
          type,
          data: initData,
        };
        self.postMessage(res);
        break;
      }

      case 'GET_SCHEMA_CONTEXT': {
        const schema = handleGetSchemaContext();
        const res: WorkerResponse = {
          requestId,
          epoch,
          ok: true,
          type,
          data: schema,
        };
        self.postMessage(res);
        break;
      }

      case 'DRY_RUN': {
        const dryRunData = handleDryRun(payload?.sql);
        const res: WorkerResponse = {
          requestId,
          epoch,
          ok: true,
          type,
          data: dryRunData,
        };
        self.postMessage(res);
        break;
      }

      case 'EXECUTE': {
        const execData = handleExecute(payload?.sql);
        const res: WorkerResponse = {
          requestId,
          epoch,
          ok: true,
          type,
          data: execData,
        };
        self.postMessage(res);
        break;
      }

      default: {
        throw new Error(`Unsupported worker request type: ${String(type)}`);
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const res: WorkerResponse = {
      requestId,
      epoch,
      ok: false,
      type,
      error: errorMsg,
    };
    self.postMessage(res);
  }
};
