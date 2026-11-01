import { describe, expect, it, vi } from 'vitest';
import { DbClient } from '../engine/dbClient';
import type {
  InitSuccessPayload,
  SchemaContext,
  WorkerRequest,
  WorkerResponse,
} from '../types';

const mockSchemaContext: SchemaContext = {
  dialect: 'SQLite',
  tables: [
    {
      name: 'customers',
      description: 'Customer records',
      columns: [
        {
          cid: 0,
          name: 'customer_id',
          type: 'INTEGER',
          notNull: true,
          defaultValue: null,
          isPrimaryKey: true,
          description: 'Primary key',
          isSensitive: false,
        },
        {
          cid: 1,
          name: 'email',
          type: 'TEXT',
          notNull: false,
          defaultValue: null,
          isPrimaryKey: false,
          description: 'Email address',
          isSensitive: true,
        },
      ],
      foreignKeys: [],
      rowCount: 40,
    },
  ],
  joinHints: [],
  enumValues: {},
  freeFormColumns: [],
  glossary: [],
  sensitiveColumns: ['customers.email'],
  pragmaQueryOnly: true,
  pragmaForeignKeys: true,
};

const mockInitPayload: InitSuccessPayload = {
  seedReport: {
    allPassed: true,
    generatedForDate: '2026-11-01',
    earliestOrderDate: '2025-11-01',
    wasmSource: 'cdn',
    setupSequence: ['create_database'],
    tableCounts: { customers: 40 },
    checks: [],
    completedAtMs: 12,
  },
  schemaContext: mockSchemaContext,
};

describe('DbClient Worker Initialization & Re-initialization Suite (/src/engine/dbClient.ts)', () => {
  it('1. Deduplicates concurrent init() calls, reusing the active in-flight promise and spawning only one worker', async () => {
    let spawnCount = 0;
    const client = new DbClient(() => {
      spawnCount += 1;
      const worker = {
        onmessage: null as ((ev: MessageEvent<WorkerResponse>) => void) | null,
        onerror: null as ((ev: ErrorEvent) => void) | null,
        postMessage(req: WorkerRequest) {
          setTimeout(() => {
            worker.onmessage?.({
              data: {
                requestId: req.requestId,
                epoch: req.epoch,
                ok: true,
                type: req.type,
                data: mockInitPayload,
              },
            } as MessageEvent<WorkerResponse>);
          }, 10);
        },
        terminate: vi.fn(),
      };
      return worker as unknown as Worker;
    });

    expect(client.getState()).toBe('uninitialized');

    // Trigger two concurrent inits
    const p1 = client.init();
    expect(client.getState()).toBe('initializing');
    const p2 = client.init();

    const [res1, res2] = await Promise.all([p1, p2]);

    expect(spawnCount).toBe(1);
    expect(res1).toBe(res2);
    expect(client.getState()).toBe('ready');
    expect(client.isReady()).toBe(true);
    expect(client.getLastError()).toBeNull();
    expect(client.getLastInitPayload()).toEqual(mockInitPayload);
  });

  it('2. Calling reset() terminates the existing worker, increments epoch, and forces fresh initialization', async () => {
    let spawnCount = 0;
    const terminateSpies: ReturnType<typeof vi.fn>[] = [];

    const client = new DbClient(() => {
      spawnCount += 1;
      const terminateSpy = vi.fn();
      terminateSpies.push(terminateSpy);

      const worker = {
        onmessage: null as ((ev: MessageEvent<WorkerResponse>) => void) | null,
        onerror: null as ((ev: ErrorEvent) => void) | null,
        postMessage(req: WorkerRequest) {
          setTimeout(() => {
            worker.onmessage?.({
              data: {
                requestId: req.requestId,
                epoch: req.epoch,
                ok: true,
                type: req.type,
                data: mockInitPayload,
              },
            } as MessageEvent<WorkerResponse>);
          }, 5);
        },
        terminate: terminateSpy,
      };
      return worker as unknown as Worker;
    });

    const initialPayload = await client.init();
    expect(initialPayload).toBeDefined();
    expect(spawnCount).toBe(1);
    expect(client.getEpoch()).toBe(2);

    // Now call reset()
    const resetPayload = await client.reset();
    expect(resetPayload).toBeDefined();
    expect(spawnCount).toBe(2);
    expect(client.getEpoch()).toBe(4); // init epoch 2 -> reset terminates (epoch 3) -> spawn (epoch 4)
    expect(terminateSpies[0]).toHaveBeenCalled();
    expect(client.getState()).toBe('ready');
  });

  it('3. Reports initialization failure and transitions to error state when Worker constructor fails', async () => {
    const client = new DbClient(() => {
      throw new Error('Worker constructor CSP violation');
    });

    await expect(client.init()).rejects.toThrow(/Worker constructor CSP violation/);
    expect(client.getState()).toBe('error');
    expect(client.getLastError()).toBe('Worker constructor CSP violation');
    expect(client.isReady()).toBe(false);

    // Subsequent schema/dryRun/execute calls must fail closed
    await expect(client.getSchemaContext()).rejects.toThrow(
      'Database is not ready. Call init() before getSchemaContext().'
    );
  });

  it('4. Reports error state when Worker sends an ok: false response on INIT', async () => {
    const client = new DbClient(() => {
      const worker = {
        onmessage: null as ((ev: MessageEvent<WorkerResponse>) => void) | null,
        onerror: null as ((ev: ErrorEvent) => void) | null,
        postMessage(req: WorkerRequest) {
          setTimeout(() => {
            worker.onmessage?.({
              data: {
                requestId: req.requestId,
                epoch: req.epoch,
                ok: false,
                type: req.type,
                error: 'Failed to load SQLite WebAssembly binary',
              },
            } as MessageEvent<WorkerResponse>);
          }, 5);
        },
        terminate: vi.fn(),
      };
      return worker as unknown as Worker;
    });

    await expect(client.init()).rejects.toThrow('Failed to load SQLite WebAssembly binary');
    expect(client.getState()).toBe('error');
    expect(client.getLastError()).toBe('Failed to load SQLite WebAssembly binary');
  });

  it('5. Converts __VIMARSH_WORKER_TIMEOUT__ sentinel to clean user-facing error message', async () => {
    const client = new DbClient(() => {
      const worker = {
        onmessage: null,
        onerror: null,
        postMessage() {
          // Never respond, letting the request timeout
        },
        terminate: vi.fn(),
      };
      return worker as unknown as Worker;
    });

    // Use a small timeout to keep test fast
    const initPromise = (client as any).sendRequest('INIT', undefined, 20);

    await expect(initPromise).rejects.toThrow('__VIMARSH_WORKER_TIMEOUT__');
  });

  it('6. Does NOT corrupt state to error when an older in-flight init is superseded by a reset()', async () => {
    let spawnCount = 0;
    const client = new DbClient(() => {
      spawnCount += 1;
      const thisSpawn = spawnCount;
      const worker = {
        onmessage: null as ((ev: MessageEvent<WorkerResponse>) => void) | null,
        onerror: null as ((ev: ErrorEvent) => void) | null,
        postMessage(req: WorkerRequest) {
          if (thisSpawn === 1) {
            // First worker takes 50ms (simulating slow CDN download)
            setTimeout(() => {
              worker.onmessage?.({
                data: {
                  requestId: req.requestId,
                  epoch: req.epoch,
                  ok: true,
                  type: req.type,
                  data: mockInitPayload,
                },
              } as MessageEvent<WorkerResponse>);
            }, 50);
          } else {
            // Second worker from reset responds fast
            setTimeout(() => {
              worker.onmessage?.({
                data: {
                  requestId: req.requestId,
                  epoch: req.epoch,
                  ok: true,
                  type: req.type,
                  data: mockInitPayload,
                },
              } as MessageEvent<WorkerResponse>);
            }, 5);
          }
        },
        terminate: vi.fn(),
      };
      return worker as unknown as Worker;
    });

    // Start slow init 1
    const init1 = client.init();

    // Immediately trigger reset() which terminates init 1
    const resetPromise = client.reset();

    // Init 1 rejects with rejection from terminate
    await expect(init1).rejects.toThrow();

    // Reset completes successfully
    const res = await resetPromise;
    expect(res).toBeDefined();

    // Client state must remain 'ready', NOT overwritten by init 1's catch block!
    expect(client.getState()).toBe('ready');
    expect(client.getLastError()).toBeNull();
  });

  it('7. Fails closed with descriptive errors when uninitialized', async () => {
    const client = new DbClient();
    expect(client.getState()).toBe('uninitialized');
    expect(client.isReady()).toBe(false);

    await expect(client.getSchemaContext()).rejects.toThrow('Database is not ready');
  });
});
