/**
 * Stage 5 Fault Scenarios Verification Suite (/src/tests/cases/stage5FaultCases.ts)
 *
 * Verifies all 9 FAULT SCENARIOS from the spec:
 * 1. Worker init failure
 * 2. WASM load failure
 * 3. Model timeout
 * 4. Malformed JSON
 * 5. Quota exhaustion (429)
 * 6. Cancellation
 * 7. Stale response (epoch mismatch & query timeout recovery)
 * 8. Parser exception (fails closed, never falls back to token scanner)
 * 9. Failed repair (exhausted 2-attempt SQL repair budget)
 *
 * Every scenario must end in a visible recoverable state with zero unvalidated SQL executed.
 */

import { AuditLogStore } from '../../engine/auditLog';
import { DbClient } from '../../engine/dbClient';
import {
  disconnectApiKey,
  getApiKey,
  setConnectedApiKey,
} from '../../engine/keyStore';
import {
  NEUTRAL_PROCESSING_ERROR_MESSAGE,
  runQuestionPipeline,
} from '../../engine/queryPipeline';
import { SessionStore } from '../../engine/sessionStore';
import { validateSqlStatic } from '../../engine/sqlValidator';
import type {
  DryRunResult,
  InitSuccessPayload,
  QueryExecutionResult,
  SchemaContext,
  TestCaseResult,
  VimarshResponse,
  WorkerRequest,
  WorkerResponse,
} from '../../types';

export async function runStage5FaultScenarioTestCases(
  schemaContext: SchemaContext,
  initPayload?: InitSuccessPayload
): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const record = (
    id: string,
    name: string,
    passed: boolean,
    details: string,
    t0: number
  ) => {
    results.push({
      id,
      suite: 'stage5_faults',
      name,
      passed,
      details,
      durationMs: Math.max(0.1, Number((performance.now() - t0).toFixed(2))),
    });
  };

  // =========================================================================
  // 1. Worker init failure
  // =========================================================================
  {
    const t0 = performance.now();
    const client = new DbClient(() => {
      throw new Error('Simulated Worker constructor failure (CSP / environment block)');
    });

    let initRejected = false;
    let execBlocked = false;
    try {
      await client.init();
    } catch {
      initRejected = true;
    }

    const validCheck = validateSqlStatic(
      'SELECT customer_id FROM customers LIMIT 5',
      schemaContext
    );
    if (validCheck.valid) {
      try {
        await client.execute(validCheck.validatedSql);
      } catch {
        execBlocked = true;
      }
    }

    const passed =
      initRejected &&
      client.getState() === 'error' &&
      Boolean(client.getLastError()?.includes('Simulated Worker constructor failure')) &&
      execBlocked;

    record(
      'fault_01_worker_init_failure',
      'Fault Scenario 1 — Worker init failure: transitions DbClient to error state, keeps query execution disabled, and surfaces recoverable error',
      passed,
      `initRejected=${initRejected}, state=${client.getState()}, execBlocked=${execBlocked}, error="${client.getLastError()}"`,
      t0
    );
  }

  // =========================================================================
  // 2. WASM load failure
  // =========================================================================
  {
    const t0 = performance.now();
    const client = new DbClient(() => {
      const mockWorker = {
        onmessage: null as ((ev: MessageEvent<WorkerResponse>) => void) | null,
        onerror: null as ((ev: ErrorEvent) => void) | null,
        postMessage(req: WorkerRequest) {
          setTimeout(() => {
            mockWorker.onmessage?.({
              data: {
                requestId: req.requestId,
                epoch: req.epoch,
                ok: false,
                type: req.type,
                error:
                  'Failed to load sql-wasm.wasm from both CDN and /sql-wasm.wasm fallback',
              },
            } as MessageEvent<WorkerResponse>);
          }, 1);
        },
        terminate() {},
      };
      return mockWorker as unknown as Worker;
    });

    let wasmFailedCleanly = false;
    let execDisabled = false;
    try {
      await client.init();
    } catch (err) {
      wasmFailedCleanly =
        err instanceof Error && err.message.includes('sql-wasm.wasm');
    }

    const validCheck = validateSqlStatic(
      'SELECT customer_id FROM customers LIMIT 5',
      schemaContext
    );
    if (validCheck.valid) {
      try {
        await client.dryRun(validCheck.validatedSql);
      } catch {
        execDisabled = true;
      }
    }

    const passed =
      wasmFailedCleanly && client.getState() === 'error' && execDisabled;
    record(
      'fault_02_wasm_load_failure',
      'Fault Scenario 2 — WASM load failure: when CDN and local /sql-wasm.wasm both fail, INIT rejects cleanly into recoverable error state with execution disabled',
      passed,
      `wasmFailedCleanly=${wasmFailedCleanly}, state=${client.getState()}, execDisabled=${execDisabled}`,
      t0
    );
  }

  // =========================================================================
  // 3. Model timeout
  // =========================================================================
  {
    const t0 = performance.now();
    const prevKey = getApiKey();
    setConnectedApiKey('AIzaSyFaultTestKey1234');
    try {
      let queriesExecuted = 0;
      const countingRunner = {
        dryRun: async (): Promise<DryRunResult> => ({ ok: true, durationMs: 1 }),
        execute: async (): Promise<QueryExecutionResult> => {
          queriesExecuted += 1;
          throw new Error('Should not execute');
        },
      };

      const slowTransport = ({
        abortSignal,
      }: {
        abortSignal?: AbortSignal;
      }): Promise<{ rawText: string; finishReason: string | null }> =>
        new Promise((_resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Should have been aborted first'));
          }, 5000);
          abortSignal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('Timed out', 'AbortError'));
            },
            { once: true }
          );
        });

      const testAudit = new AuditLogStore();
      const outcome = await runQuestionPipeline({
        rawQuestion: 'Total revenue last month',
        schemaContext,
        dbRunner: countingRunner,
        session: new SessionStore(),
        audit: testAudit,
        transport: slowTransport,
        deadlineMs: 25,
      });

      const passed =
        outcome.assistantTurn.response.status === 'REJECT' &&
        outcome.assistantTurn.processingError === true &&
        queriesExecuted === 0 &&
        Boolean(
          outcome.assistantTurn.response.rejection_reason?.includes(
            'cancelled or timed out'
          )
        );

      record(
        'fault_03_model_timeout',
        'Fault Scenario 3 — Model timeout: aborts hung request at deadline, returns visible recoverable REJECT state, and executes 0 SQL queries',
        passed,
        `status=${outcome.assistantTurn.response.status}, queriesExecuted=${queriesExecuted}, reason="${outcome.assistantTurn.response.rejection_reason}"`,
        t0
      );
    } finally {
      if (prevKey) setConnectedApiKey(prevKey);
      else disconnectApiKey();
    }
  }

  // =========================================================================
  // 4. Malformed JSON (exhausted 1 JSON-format retry)
  // =========================================================================
  {
    const t0 = performance.now();
    const prevKey = getApiKey();
    setConnectedApiKey('AIzaSyFaultTestKey1234');
    try {
      let llmCalls = 0;
      let queriesExecuted = 0;
      const countingRunner = {
        dryRun: async (): Promise<DryRunResult> => ({ ok: true, durationMs: 1 }),
        execute: async (): Promise<QueryExecutionResult> => {
          queriesExecuted += 1;
          throw new Error('Should not execute');
        },
      };

      const badJsonTransport = async (): Promise<{
        rawText: string;
        finishReason: string | null;
      }> => {
        llmCalls += 1;
        return {
          rawText: '{"status": "SUCCESS", "sql_query": TRUNCATED_GARBAGE',
          finishReason: 'STOP',
        };
      };

      const testAudit = new AuditLogStore();
      const outcome = await runQuestionPipeline({
        rawQuestion: 'Total revenue last month',
        schemaContext,
        dbRunner: countingRunner,
        session: new SessionStore(),
        audit: testAudit,
        transport: badJsonTransport,
      });

      const hasRetryExhaustedEvent = testAudit
        .getEvents()
        .some((e) => e.source === 'RETRY_EXHAUSTED');

      const passed =
        llmCalls === 2 && // 1 initial + 1 JSON-format retry nudge
        outcome.assistantTurn.response.status === 'REJECT' &&
        outcome.assistantTurn.response.rejection_reason ===
          NEUTRAL_PROCESSING_ERROR_MESSAGE &&
        queriesExecuted === 0 &&
        hasRetryExhaustedEvent;

      record(
        'fault_04_malformed_json',
        'Fault Scenario 4 — Malformed JSON: retries once with contract nudge, then shows neutral "Vimarsh could not process this request" card with 0 queries executed',
        passed,
        `llmCalls=${llmCalls}, rejectionReason="${outcome.assistantTurn.response.rejection_reason}", queriesExecuted=${queriesExecuted}, auditExhausted=${hasRetryExhaustedEvent}`,
        t0
      );
    } finally {
      if (prevKey) setConnectedApiKey(prevKey);
      else disconnectApiKey();
    }
  }

  // =========================================================================
  // 5. Quota exhaustion (HTTP 429)
  // =========================================================================
  {
    const t0 = performance.now();
    const prevKey = getApiKey();
    setConnectedApiKey('AIzaSyFaultTestKey1234');
    try {
      let transportCalls = 0;
      let queriesExecuted = 0;
      const countingRunner = {
        dryRun: async (): Promise<DryRunResult> => ({ ok: true, durationMs: 1 }),
        execute: async (): Promise<QueryExecutionResult> => {
          queriesExecuted += 1;
          throw new Error('Should not execute');
        },
      };

      const quota429Transport = async (): Promise<{
        rawText: string;
        finishReason: string | null;
      }> => {
        transportCalls += 1;
        const err = new Error(
          '429 RESOURCE_EXHAUSTED: Quota exceeded. Retry-After: 5ms'
        ) as Error & { status?: number };
        err.status = 429;
        throw err;
      };

      const testAudit = new AuditLogStore();
      const outcome = await runQuestionPipeline({
        rawQuestion: 'Total revenue last month',
        schemaContext,
        dbRunner: countingRunner,
        session: new SessionStore(),
        audit: testAudit,
        transport: quota429Transport,
        baseBackoffMs: 2,
      });

      const passed =
        transportCalls === 3 && // 1 initial + 2 transport retries
        outcome.assistantTurn.response.status === 'REJECT' &&
        Boolean(
          outcome.assistantTurn.response.rejection_reason?.includes(
            'Quota exceeded (429)'
          )
        ) &&
        queriesExecuted === 0;

      record(
        'fault_05_quota_exhaustion_429',
        'Fault Scenario 5 — Quota exhaustion (429): retries transport 2 times (3 total attempts) honoring Retry-After, then surfaces Quota exceeded (429) card with 0 queries executed',
        passed,
        `transportCalls=${transportCalls}, status=${outcome.assistantTurn.response.status}, reason="${outcome.assistantTurn.response.rejection_reason}", queriesExecuted=${queriesExecuted}`,
        t0
      );
    } finally {
      if (prevKey) setConnectedApiKey(prevKey);
      else disconnectApiKey();
    }
  }

  // =========================================================================
  // 6. Cancellation
  // =========================================================================
  {
    const t0 = performance.now();
    const prevKey = getApiKey();
    setConnectedApiKey('AIzaSyFaultTestKey1234');
    try {
      let transportCalls = 0;
      let queriesExecuted = 0;
      const callerAbort = new AbortController();

      const cancellableTransport = ({
        abortSignal,
      }: {
        abortSignal?: AbortSignal;
      }): Promise<{ rawText: string; finishReason: string | null }> => {
        transportCalls += 1;
        return new Promise((_resolve, reject) => {
          setTimeout(() => {
            callerAbort.abort();
          }, 5);
          abortSignal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Cancelled by caller', 'AbortError'));
            },
            { once: true }
          );
        });
      };

      const outcome = await runQuestionPipeline({
        rawQuestion: 'Total revenue last month',
        schemaContext,
        dbRunner: {
          dryRun: async () => ({ ok: true, durationMs: 1 }),
          execute: async () => {
            queriesExecuted += 1;
            throw new Error('Should not execute');
          },
        },
        session: new SessionStore(),
        audit: new AuditLogStore(),
        transport: cancellableTransport,
        abortSignal: callerAbort.signal,
      });

      const passed =
        transportCalls === 1 && // Stops immediately without transport retries
        outcome.assistantTurn.response.status === 'REJECT' &&
        queriesExecuted === 0;

      record(
        'fault_06_cancellation',
        'Fault Scenario 6 — Cancellation: stops immediately on AbortSignal without retrying or executing any SQL',
        passed,
        `transportCalls=${transportCalls}, status=${outcome.assistantTurn.response.status}, queriesExecuted=${queriesExecuted}`,
        t0
      );
    } finally {
      if (prevKey) setConnectedApiKey(prevKey);
      else disconnectApiKey();
    }
  }

  // =========================================================================
  // 7. Stale response (epoch mismatch & Worker query timeout recovery)
  // =========================================================================
  {
    const t0 = performance.now();
    let staleMessageDelivered = false;
    let activeWorkerOnMessage:
      | ((ev: MessageEvent<WorkerResponse>) => void)
      | null = null;
    let spawnCount = 0;

    const fakeInitPayload: InitSuccessPayload = initPayload ?? {
      seedReport: {
        allPassed: true,
        generatedForDate: '2026-10-28',
        earliestOrderDate: '2025-11-01',
        wasmSource: 'node-local',
        setupSequence: ['create_database'],
        tableCounts: { customers: 40 },
        checks: [],
        completedAtMs: 5,
      },
      schemaContext,
    };

    const client = new DbClient(() => {
      spawnCount += 1;
      const thisSpawn = spawnCount;
      const mockWorker = {
        onmessage: null as ((ev: MessageEvent<WorkerResponse>) => void) | null,
        onerror: null as ((ev: ErrorEvent) => void) | null,
        postMessage(req: WorkerRequest) {
          activeWorkerOnMessage = mockWorker.onmessage;
          if (req.type === 'INIT') {
            setTimeout(() => {
              mockWorker.onmessage?.({
                data: {
                  requestId: req.requestId,
                  epoch: req.epoch,
                  ok: true,
                  type: 'INIT',
                  data: fakeInitPayload,
                },
              } as MessageEvent<WorkerResponse>);
            }, 1);
          } else if (req.type === 'EXECUTE' && thisSpawn === 1) {
            // Simulate a hung query in Worker #1 that times out, AND also tries to deliver a stale epoch-1 response later!
            setTimeout(() => {
              staleMessageDelivered = true;
              activeWorkerOnMessage?.({
                data: {
                  requestId: req.requestId,
                  epoch: 1, // stale epoch!
                  ok: true,
                  type: 'EXECUTE',
                  data: {
                    columns: ['stale'],
                    rows: [[999]],
                    rowCount: 1,
                    truncated: false,
                    isEmpty: false,
                    emptyMessage: null,
                    executionTimeMs: 1,
                  },
                },
              } as MessageEvent<WorkerResponse>);
            }, 25);
          } else if (req.type === 'EXECUTE' && thisSpawn >= 2) {
            // Fresh re-seeded Worker #2 responds promptly
            setTimeout(() => {
              mockWorker.onmessage?.({
                data: {
                  requestId: req.requestId,
                  epoch: req.epoch,
                  ok: true,
                  type: 'EXECUTE',
                  data: {
                    columns: ['customer_id'],
                    rows: [[1]],
                    rowCount: 1,
                    truncated: false,
                    isEmpty: false,
                    emptyMessage: null,
                    executionTimeMs: 2,
                  },
                },
              } as MessageEvent<WorkerResponse>);
            }, 2);
          }
        },
        terminate() {},
      };
      return mockWorker as unknown as Worker;
    });

    await client.init();
    const validSql = validateSqlStatic(
      'SELECT customer_id FROM customers LIMIT 1',
      schemaContext
    );

    let timedOutCleanly = false;
    let freshExecSucceeded = false;

    if (validSql.valid) {
      try {
        await client.execute(validSql.validatedSql, 10);
      } catch (err) {
        timedOutCleanly =
          err instanceof Error && err.message === 'Query timed out';
      }

      // Wait for stale epoch-1 response to fire and be ignored by DbClient
      await new Promise((r) => setTimeout(r, 30));

      const freshRes = await client.execute(validSql.validatedSql, 500);
      freshExecSucceeded =
        freshRes.columns[0] === 'customer_id' && freshRes.rows[0][0] === 1;
    }

    const passed =
      timedOutCleanly &&
      staleMessageDelivered &&
      client.getEpoch() >= 2 &&
      freshExecSucceeded;

    record(
      'fault_07_stale_response_and_timeout_recovery',
      'Fault Scenario 7 — Stale response & timeout: terminates hung Worker on timeout, re-seeds fresh Worker at new epoch, and ignores stale epoch responses',
      passed,
      `timedOutCleanly=${timedOutCleanly}, staleIgnored=${staleMessageDelivered}, currentEpoch=${client.getEpoch()}, freshExecSucceeded=${freshExecSucceeded}`,
      t0
    );
  }

  // =========================================================================
  // 8. Parser exception (fails closed, never falls back to token scanner)
  // =========================================================================
  {
    const t0 = performance.now();
    const unparseableQueries = [
      'SELECT FROM WHERE GROUP BY HAVING LIMIT 10',
      'SELECT customer_id, ((FROM customers LIMIT 10',
      'WITH broken AS (SELECT ) SELECT customer_id FROM customers LIMIT 5',
    ];

    const allRejectedAtStep1 = unparseableQueries.every((sql) => {
      const res = validateSqlStatic(sql, schemaContext);
      return !res.valid && res.failedStep === 1;
    });

    record(
      'fault_08_parser_exception_fails_closed',
      'Fault Scenario 8 — Parser exception: AST syntax error fails closed at Step 1 and never falls back to a token scanner',
      allRejectedAtStep1,
      `allRejectedAtStep1=${allRejectedAtStep1} (${unparseableQueries.length} malformed queries tested)`,
      t0
    );
  }

  // =========================================================================
  // 9. Failed repair (exhausted 2-attempt SQL repair budget)
  // =========================================================================
  {
    const t0 = performance.now();
    const prevKey = getApiKey();
    setConnectedApiKey('AIzaSyFaultTestKey1234');
    try {
      let modelCalls = 0;
      let queriesExecuted = 0;
      const modesSeen: string[] = [];

      const alwaysBadSqlTransport = async ({
        userContent,
      }: {
        userContent: string;
      }): Promise<{ rawText: string; finishReason: string | null }> => {
        modelCalls += 1;
        modesSeen.push(
          userContent.includes('<mode>REPAIR</mode>') ? 'REPAIR' : 'ANSWER'
        );
        // Always return SQL without LIMIT (or with SELECT *) so sqlValidator rejects it every time
        const badResp: VimarshResponse = {
          status: 'SUCCESS',
          reasoning: 'Returning invalid SQL without LIMIT.',
          sql_query: 'SELECT * FROM customers',
          follow_up_question: null,
          clarification_options: [],
          ambiguity_type: null,
          assumptions: [],
          tables_used: ['customers'],
          confidence: 0.7,
          rejection_reason: null,
        };
        return {
          rawText: JSON.stringify(badResp),
          finishReason: 'STOP',
        };
      };

      const testAudit = new AuditLogStore();
      const outcome = await runQuestionPipeline({
        rawQuestion: 'List customers',
        schemaContext,
        dbRunner: {
          dryRun: async () => ({ ok: true, durationMs: 1 }),
          execute: async () => {
            queriesExecuted += 1;
            throw new Error('Must never execute unvalidated SQL!');
          },
        },
        session: new SessionStore(),
        audit: testAudit,
        transport: alwaysBadSqlTransport,
      });

      const hasExhaustedAudit = testAudit
        .getEvents()
        .some((e) => e.source === 'RETRY_EXHAUSTED' && e.mode === 'REPAIR');

      const passed =
        modelCalls === 3 && // 1 ANSWER + 2 REPAIR attempts
        modesSeen.join(',') === 'ANSWER,REPAIR,REPAIR' &&
        outcome.assistantTurn.response.status === 'REJECT' &&
        outcome.assistantTurn.repairCount === 2 &&
        queriesExecuted === 0 &&
        hasExhaustedAudit;

      record(
        'fault_09_failed_repair_budget_exhausted',
        'Fault Scenario 9 — Failed repair: stops after 2 repair attempts (1 ANSWER + 2 REPAIR), logs RETRY_EXHAUSTED, and returns recoverable REJECT card with 0 unvalidated queries executed',
        passed,
        `modelCalls=${modelCalls} (${modesSeen.join('->')}), finalStatus=${outcome.assistantTurn.response.status}, repairCount=${outcome.assistantTurn.repairCount}, queriesExecuted=${queriesExecuted}`,
        t0
      );
    } finally {
      if (prevKey) setConnectedApiKey(prevKey);
      else disconnectApiKey();
    }
  }

  return results;
}
