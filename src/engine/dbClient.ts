/**
 * Typed Database Client (/src/engine/dbClient.ts)
 *
 * Manages the SQLite Web Worker lifecycle and typed request/response protocol:
 * - Unique request IDs and worker epoch counters
 * - Explicit init state ('uninitialized' | 'initializing' | 'ready' | 'error')
 * - Rejects all pending requests when the worker is terminated
 * - Ignores stale responses from previous epochs or unknown request IDs
 * - Stage 2:
 *   - dryRun(sql: ValidatedSql): runs EXPLAIN QUERY PLAN in Worker (Step 9)
 *   - execute(sql: ValidatedSql): executes query in Worker with 1000-row cap and 5-second timeout (Step 10).
 *     On timeout, terminates the worker, re-creates it with a fresh deterministic seed, and reports "Query timed out".
 */

import type {
  DryRunResult,
  InitSuccessPayload,
  QueryExecutionResult,
  SchemaContext,
  ValidatedSql,
  WorkerRequest,
  WorkerRequestType,
  WorkerResponse,
} from '../types';

export type DbClientState = 'uninitialized' | 'initializing' | 'ready' | 'error';

export const WORKER_QUERY_TIMEOUT_MS = 5000;

interface PendingRequest {
  requestId: string;
  epoch: number;
  type: WorkerRequestType;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

const TIMEOUT_SENTINEL = '__VIMARSH_WORKER_TIMEOUT__';

export class DbClient {
  private worker: Worker | null = null;
  private state: DbClientState = 'uninitialized';
  private lastError: string | null = null;
  private epoch = 0;
  private requestCounter = 0;
  private pending = new Map<string, PendingRequest>();
  private lastInitPayload: InitSuccessPayload | null = null;
  private lastNowIsoLocal: string | undefined = undefined;
  private readonly workerFactory?: () => Worker;

  constructor(workerFactory?: () => Worker) {
    this.workerFactory = workerFactory;
  }

  public getState(): DbClientState {
    return this.state;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getLastInitPayload(): InitSuccessPayload | null {
    return this.lastInitPayload;
  }

  public getEpoch(): number {
    return this.epoch;
  }

  private spawnWorker(): Worker {
    if (!this.workerFactory && typeof Worker === 'undefined') {
      this.state = 'error';
      this.lastError =
        'Web Workers are not supported in this environment. Query execution is disabled (no main-thread fallback is permitted).';
      throw new Error(this.lastError);
    }

    this.epoch += 1;
    const currentEpoch = this.epoch;

    const worker = this.workerFactory
      ? this.workerFactory()
      : new Worker(new URL('./dbWorker.ts', import.meta.url), {
          type: 'module',
        });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (!msg || typeof msg.requestId !== 'string') {
        return;
      }

      // Ignore stale responses from an older worker epoch
      if (msg.epoch !== currentEpoch) {
        return;
      }

      const entry = this.pending.get(msg.requestId);
      if (!entry) {
        // Ignore stale or unknown requestId
        return;
      }

      this.pending.delete(msg.requestId);
      if (entry.timeoutId !== undefined) {
        clearTimeout(entry.timeoutId);
      }

      if (msg.ok) {
        entry.resolve(msg.data);
      } else {
        entry.reject(new Error(msg.error));
      }
    };

    worker.onerror = (errEvent: ErrorEvent) => {
      const errMsg =
        errEvent.message || 'Web Worker encountered an unexpected runtime error.';
      this.state = 'error';
      this.lastError = errMsg;
      this.rejectAllPending(new Error(errMsg));
    };

    this.worker = worker;
    return worker;
  }

  private rejectAllPending(reason: Error): void {
    for (const [, entry] of this.pending.entries()) {
      if (entry.timeoutId !== undefined) {
        clearTimeout(entry.timeoutId);
      }
      entry.reject(reason);
    }
    this.pending.clear();
  }

  /**
   * Terminates the current Web Worker and immediately rejects all pending requests.
   */
  public terminate(reasonMessage = 'Worker terminated'): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.epoch += 1;
    this.rejectAllPending(new Error(reasonMessage));
    this.state = 'uninitialized';
  }

  private sendRequest<T>(
    type: WorkerRequestType,
    payload?: WorkerRequest['payload'],
    timeoutMs = 15000
  ): Promise<T> {
    if (!this.worker) {
      this.spawnWorker();
    }

    const worker = this.worker!;
    const currentEpoch = this.epoch;
    this.requestCounter += 1;
    const requestId = `req_${currentEpoch}_${this.requestCounter}`;

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          reject(new Error(TIMEOUT_SENTINEL));
        }
      }, timeoutMs);

      this.pending.set(requestId, {
        requestId,
        epoch: currentEpoch,
        type,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      const req: WorkerRequest = {
        requestId,
        epoch: currentEpoch,
        type,
        ...(payload ? { payload } : {}),
      };

      worker.postMessage(req);
    });
  }

  /**
   * Initializes the Worker database, runs the connection setup sequence,
   * seeds deterministic data, validates all seed guarantees, and loads the schema.
   */
  public async init(nowIsoLocal?: string): Promise<InitSuccessPayload> {
    this.state = 'initializing';
    this.lastError = null;
    this.lastNowIsoLocal = nowIsoLocal;

    try {
      this.terminate('Re-initializing worker');
      this.state = 'initializing';
      this.spawnWorker();

      const result = await this.sendRequest<InitSuccessPayload>(
        'INIT',
        nowIsoLocal ? { nowIsoLocal } : undefined
      );
      this.lastInitPayload = result;
      this.state = 'ready';
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.state = 'error';
      this.lastError = msg;
      throw err;
    }
  }

  /**
   * Resets the database by terminating the existing worker, spawning a fresh worker,
   * and re-running the full connection setup sequence.
   */
  public async reset(nowIsoLocal?: string): Promise<InitSuccessPayload> {
    return this.init(nowIsoLocal ?? this.lastNowIsoLocal);
  }

  /**
   * Retrieves the current SchemaContext from the Worker.
   */
  public async getSchemaContext(): Promise<SchemaContext> {
    if (this.state !== 'ready') {
      throw new Error('Database is not ready. Call init() before getSchemaContext().');
    }
    const schema = await this.sendRequest<SchemaContext>('GET_SCHEMA_CONTEXT');
    if (this.lastInitPayload) {
      this.lastInitPayload = {
        ...this.lastInitPayload,
        schemaContext: schema,
      };
    }
    return schema;
  }

  /**
   * Step 9: Runs EXPLAIN QUERY PLAN in the Worker.
   * Accepts ONLY the branded type ValidatedSql.
   * On 5-second timeout: terminates the worker, re-creates it with fresh deterministic seed,
   * and throws "Query timed out".
   */
  public async dryRun(
    sql: ValidatedSql,
    timeoutMs: number = WORKER_QUERY_TIMEOUT_MS
  ): Promise<DryRunResult> {
    if (this.state !== 'ready') {
      throw new Error('Database is not ready. Call init() before dryRun().');
    }
    try {
      return await this.sendRequest<DryRunResult>('DRY_RUN', { sql }, timeoutMs);
    } catch (err) {
      if (err instanceof Error && err.message === TIMEOUT_SENTINEL) {
        this.terminate('Query timed out');
        try {
          await this.init(this.lastNowIsoLocal);
        } catch {
          // If re-init fails, state is already set to error
        }
        throw new Error('Query timed out');
      }
      throw err;
    }
  }

  /**
   * Step 10: Executes a ValidatedSql query in the Worker (reading at most 1000 rows while stepping).
   * Accepts ONLY the branded type ValidatedSql.
   * Execution timeout 5 seconds: on timeout terminates the worker, re-creates it (fresh deterministic seed),
   * and throws "Query timed out".
   */
  public async execute(
    sql: ValidatedSql,
    timeoutMs: number = WORKER_QUERY_TIMEOUT_MS
  ): Promise<QueryExecutionResult> {
    if (this.state !== 'ready') {
      throw new Error('Database is not ready. Call init() before execute().');
    }
    try {
      return await this.sendRequest<QueryExecutionResult>('EXECUTE', { sql }, timeoutMs);
    } catch (err) {
      if (err instanceof Error && err.message === TIMEOUT_SENTINEL) {
        this.terminate('Query timed out');
        try {
          await this.init(this.lastNowIsoLocal);
        } catch {
          // If re-init fails, state is already set to error
        }
        throw new Error('Query timed out');
      }
      throw err;
    }
  }
}

export const dbClient = new DbClient();
