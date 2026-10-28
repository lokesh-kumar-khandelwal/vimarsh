/**
 * End-to-End Query & Repair Pipeline (/src/engine/queryPipeline.ts)
 *
 * Spec pipeline & independent budgets:
 *   inputGuard -> historySerializer + promptBuilder -> llmClient -> strict parse ->
 *   responseValidator -> (round-3 enforcement) -> (if SUCCESS) sqlValidator (Steps 1-8) ->
 *   dry run (Step 9) -> Worker execute (Step 10) -> results.
 *
 * Budgets:
 * - Transport retries (HTTP 429/503): at most 2 retries with exponential backoff (in llmClient)
 * - JSON-format / contract retry: exactly 1 retry with a "return valid JSON matching the contract only" nudge,
 *   then show a neutral "Vimarsh could not process this request" card.
 * - SQL repair: at most 2 repair attempts (so at most 3 total SQL validations/executions),
 *   each re-validated by the full 10-step validator.
 * - Per-question deadline: 60 seconds.
 * - UI tables_used is derived from the validated SQL's AST, ignoring response.tables_used if it disagrees.
 * - A repaired result sets `repaired: true` with `repairCount` and `originalError`.
 */

import type {
  AssistantConversationTurn,
  DryRunResult,
  OperatingMode,
  PipelineStageTrace,
  QueryExecutionResult,
  RepairErrorSource,
  SchemaContext,
  SessionState,
  UserConversationTurn,
  ValidatedSql,
  VimarshResponse,
} from '../types';
import { auditLog, type AuditLogStore } from './auditLog';
import { runInputGuard } from './inputGuard';
import {
  callLlmWithTransportRetries,
  type LlmTransportFn,
} from './llmClient';
import { buildSystemPrompt, buildUserMessage } from './promptBuilder';
import {
  parseStrictJsonResponse,
  validateVimarshResponse,
} from './responseValidator';
import {
  enforceClarificationRoundLimit,
  sessionStore,
  type SessionStore,
} from './sessionStore';
import { validateSqlStatic } from './sqlValidator';

export const MAX_JSON_FORMAT_RETRIES = 1;
export const MAX_SQL_REPAIR_ATTEMPTS = 2;
export const PER_QUESTION_DEADLINE_MS = 60_000;

export const JSON_CONTRACT_NUDGE =
  'SYSTEM NUDGE: Your previous output failed strict JSON parsing or did not match the 10-key VimarshResponse contract. Return valid JSON matching the contract only.';

export const NEUTRAL_PROCESSING_ERROR_MESSAGE =
  'Vimarsh could not process this request';

export interface PipelineDbRunner {
  dryRun: (sql: ValidatedSql) => Promise<DryRunResult>;
  execute: (sql: ValidatedSql) => Promise<QueryExecutionResult>;
}

export interface RunQuestionPipelineParams {
  rawQuestion: string;
  schemaContext: SchemaContext;
  dbRunner: PipelineDbRunner;
  session?: SessionStore;
  audit?: AuditLogStore;
  transport?: LlmTransportFn;
  now?: Date;
  abortSignal?: AbortSignal;
  deadlineMs?: number;
  baseBackoffMs?: number;
}

export interface RunQuestionPipelineOutcome {
  userTurn: UserConversationTurn;
  assistantTurn: AssistantConversationTurn;
  sessionState: SessionState;
}

function createTurnId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Executes a single model generation + strict JSON parse + responseValidator cycle,
 * applying at most 1 JSON-format/contract retry with `JSON_CONTRACT_NUDGE`.
 */
async function obtainValidatedModelResponse(params: {
  mode: OperatingMode;
  systemInstruction: string;
  baseUserMessageParams: Parameters<typeof buildUserMessage>[0];
  schemaContext: SchemaContext;
  trace: PipelineStageTrace[];
  audit: AuditLogStore;
  repairCount: number;
  failedSqlForAudit: string | null;
  transport?: LlmTransportFn;
  abortSignal?: AbortSignal;
  baseBackoffMs?: number;
}): Promise<
  | { ok: true; response: VimarshResponse }
  | { ok: false; errorReason: string }
> {
  let jsonRetriesUsed = 0;

  while (true) {
    const nudgeMessage =
      jsonRetriesUsed > 0 ? JSON_CONTRACT_NUDGE : undefined;
    const userContent = buildUserMessage({
      ...params.baseUserMessageParams,
      nudgeMessage,
    });

    const llmStart = performance.now();
    let rawText = '';
    let finishReason: string | null = null;

    try {
      const llmRes = await callLlmWithTransportRetries({
        systemInstruction: params.systemInstruction,
        userContent,
        abortSignal: params.abortSignal,
        transport: params.transport,
        baseBackoffMs: params.baseBackoffMs,
      });
      rawText = llmRes.rawText;
      finishReason = llmRes.finishReason;
      params.trace.push({
        stage: 'LLM_CALL',
        status: 'passed',
        detail: `Model responded (${params.mode}${jsonRetriesUsed > 0 ? ', JSON retry #1' : ''}${llmRes.transportRetriesUsed > 0 ? `, transport retries=${llmRes.transportRetriesUsed}` : ''})`,
        durationMs: llmRes.latencyMs,
      });
      params.audit.record({
        mode: params.mode,
        status: 'SUCCESS',
        source: 'MODEL',
        validatorResult: `Model response received (finishReason=${finishReason ?? 'STOP'})`,
        latencyMs: llmRes.latencyMs,
        repairCount: params.repairCount,
        failedSql: params.failedSqlForAudit,
      });
    } catch (err) {
      const llmDur = Math.max(1, Math.round(performance.now() - llmStart));
      const msg = err instanceof Error ? err.message : String(err);
      params.trace.push({
        stage: 'LLM_CALL',
        status: 'failed',
        detail: msg,
        durationMs: llmDur,
      });
      params.audit.record({
        mode: params.mode,
        status: 'ERROR',
        source: 'RETRY_EXHAUSTED',
        validatorResult: msg,
        latencyMs: llmDur,
        repairCount: params.repairCount,
        failedSql: params.failedSqlForAudit,
      });
      return { ok: false, errorReason: msg };
    }

    // Strict JSON Parse
    const parseStart = performance.now();
    const parsed = parseStrictJsonResponse(rawText, finishReason);
    const parseDur = Math.max(1, Math.round(performance.now() - parseStart));

    if (!parsed.ok) {
      params.trace.push({
        stage: 'STRICT_JSON_PARSE',
        status: 'failed',
        detail: parsed.error,
        durationMs: parseDur,
      });
      params.audit.record({
        mode: params.mode,
        status: 'ERROR',
        source: 'RESPONSE_VALIDATOR',
        validatorResult: parsed.error,
        latencyMs: parseDur,
        repairCount: params.repairCount,
        failedSql: params.failedSqlForAudit,
      });

      if (jsonRetriesUsed < MAX_JSON_FORMAT_RETRIES) {
        jsonRetriesUsed += 1;
        continue;
      }

      params.audit.record({
        mode: params.mode,
        status: 'ERROR',
        source: 'RETRY_EXHAUSTED',
        validatorResult: `JSON parse failed after ${jsonRetriesUsed} retry: ${parsed.error}`,
        latencyMs: parseDur,
        repairCount: params.repairCount,
        failedSql: params.failedSqlForAudit,
      });
      return { ok: false, errorReason: NEUTRAL_PROCESSING_ERROR_MESSAGE };
    }

    params.trace.push({
      stage: 'STRICT_JSON_PARSE',
      status: 'passed',
      detail: 'Single top-level JSON object parsed cleanly',
      durationMs: parseDur,
    });

    // Runtime Contract Validation
    const valStart = performance.now();
    const contractRes = validateVimarshResponse(
      parsed.data,
      params.schemaContext,
      params.mode
    );
    const valDur = Math.max(1, Math.round(performance.now() - valStart));

    if (!contractRes.valid) {
      params.trace.push({
        stage: 'RESPONSE_VALIDATOR',
        status: 'failed',
        detail: contractRes.error,
        durationMs: valDur,
      });
      params.audit.record({
        mode: params.mode,
        status: 'ERROR',
        source: 'RESPONSE_VALIDATOR',
        validatorResult: contractRes.error,
        latencyMs: valDur,
        repairCount: params.repairCount,
        failedSql: params.failedSqlForAudit,
      });

      if (jsonRetriesUsed < MAX_JSON_FORMAT_RETRIES) {
        jsonRetriesUsed += 1;
        continue;
      }

      params.audit.record({
        mode: params.mode,
        status: 'ERROR',
        source: 'RETRY_EXHAUSTED',
        validatorResult: `Contract validation failed after ${jsonRetriesUsed} retry: ${contractRes.error}`,
        latencyMs: valDur,
        repairCount: params.repairCount,
        failedSql: params.failedSqlForAudit,
      });
      return { ok: false, errorReason: NEUTRAL_PROCESSING_ERROR_MESSAGE };
    }

    params.trace.push({
      stage: 'RESPONSE_VALIDATOR',
      status: 'passed',
      detail: `Valid 10-key VimarshResponse (status=${contractRes.response.status})`,
      durationMs: valDur,
    });
    params.audit.record({
      mode: params.mode,
      status: contractRes.response.status,
      source: 'RESPONSE_VALIDATOR',
      validatorResult: 'Passed 10-key contract check',
      latencyMs: valDur,
      repairCount: params.repairCount,
      failedSql: params.failedSqlForAudit,
      finalSql: contractRes.response.sql_query,
    });

    return { ok: true, response: contractRes.response };
  }
}

/**
 * Runs the full Stage 3 Vimarsh pipeline for a user question.
 */
export async function runQuestionPipeline(
  params: RunQuestionPipelineParams
): Promise<RunQuestionPipelineOutcome> {
  const pipelineStart = performance.now();
  const session = params.session ?? sessionStore;
  const audit = params.audit ?? auditLog;
  const trace: PipelineStageTrace[] = [];

  const deadlineMs = params.deadlineMs ?? PER_QUESTION_DEADLINE_MS;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => {
    deadlineController.abort();
  }, deadlineMs);

  const onCallerAbort = () => deadlineController.abort();
  if (params.abortSignal) {
    if (params.abortSignal.aborted) {
      deadlineController.abort();
    } else {
      params.abortSignal.addEventListener('abort', onCallerAbort, {
        once: true,
      });
    }
  }

  try {
    // 1. Input Guard
    const guardStart = performance.now();
    const guardRes = runInputGuard(params.rawQuestion);
    const guardDur = Math.max(1, Math.round(performance.now() - guardStart));

    const userTurn: UserConversationTurn = {
      id: createTurnId('user'),
      role: 'user',
      question: guardRes.sanitizedQuestion || params.rawQuestion.trim(),
      timestamp: new Date().toISOString(),
    };

    if (!guardRes.allowed) {
      trace.push({
        stage: 'INPUT_GUARD',
        status: 'failed',
        detail: guardRes.rejectionReason ?? 'Blocked by Input Guard',
        durationMs: guardDur,
      });

      const totalLatency = Math.max(
        1,
        Math.round(performance.now() - pipelineStart)
      );
      audit.record({
        mode: 'ANSWER',
        status: 'REJECT',
        source: 'INPUT_GUARD',
        validatorResult: `Blocked (${guardRes.matchedPattern ?? 'policy'}): ${guardRes.rejectionReason ?? ''}`,
        rowCount: null,
        latencyMs: totalLatency,
        repairCount: 0,
      });

      const rejectResponse: VimarshResponse = {
        status: 'REJECT',
        reasoning:
          'Deterministic Input Guard detected an instruction-override or prompt-exfiltration phrase and blocked the request before any model or database call.',
        sql_query: null,
        follow_up_question: null,
        clarification_options: [],
        ambiguity_type: null,
        assumptions: [],
        tables_used: [],
        confidence: 1.0,
        rejection_reason:
          guardRes.rejectionReason ??
          'Request blocked by deterministic Input Guard.',
      };

      const assistantTurn: AssistantConversationTurn = {
        id: createTurnId('assistant'),
        role: 'assistant',
        response: rejectResponse,
        validatedTablesUsed: [],
        blockedByGuard: true,
        latencyMs: totalLatency,
        trace,
        timestamp: new Date().toISOString(),
      };

      const nextSession = session.recordTurnPair(userTurn, assistantTurn);
      return { userTurn, assistantTurn, sessionState: nextSession };
    }

    trace.push({
      stage: 'INPUT_GUARD',
      status: 'passed',
      detail: `Allowed (${guardRes.sanitizedQuestion.length} chars)`,
      durationMs: guardDur,
    });
    audit.record({
      mode: 'ANSWER',
      status: 'SUCCESS',
      source: 'INPUT_GUARD',
      validatorResult: 'Passed deterministic inputGuard',
      latencyMs: guardDur,
      repairCount: 0,
    });

    // 2. Prompt Build & History Serialization
    const promptStart = performance.now();
    const currentSession = session.getState();
    const pendingClarification = currentSession.pending !== null;
    const clarificationRound = currentSession.pending?.round ?? 0;
    const systemInstruction = buildSystemPrompt(
      params.schemaContext,
      params.now
    );
    const promptDur = Math.max(1, Math.round(performance.now() - promptStart));

    trace.push({
      stage: 'PROMPT_BUILD',
      status: 'passed',
      detail: `Built prompt (mode=ANSWER, pending=${pendingClarification}, round=${clarificationRound}, priorTurns=${Math.min(currentSession.turns.length, 6)})`,
      durationMs: promptDur,
    });

    // 3. Initial ANSWER Mode Call
    const initialModelOutcome = await obtainValidatedModelResponse({
      mode: 'ANSWER',
      systemInstruction,
      baseUserMessageParams: {
        mode: 'ANSWER',
        pendingClarification,
        clarificationRound,
        priorTurns: currentSession.turns,
        pendingState: currentSession.pending,
        userQuestion: guardRes.sanitizedQuestion,
      },
      schemaContext: params.schemaContext,
      trace,
      audit,
      repairCount: 0,
      failedSqlForAudit: null,
      transport: params.transport,
      abortSignal: deadlineController.signal,
      baseBackoffMs: params.baseBackoffMs,
    });

    if (!initialModelOutcome.ok) {
      const totalLatency = Math.max(
        1,
        Math.round(performance.now() - pipelineStart)
      );
      const fallbackResponse: VimarshResponse = {
        status: 'REJECT',
        reasoning:
          'Model output failed strict validation or transport retries were exhausted.',
        sql_query: null,
        follow_up_question: null,
        clarification_options: [],
        ambiguity_type: null,
        assumptions: [],
        tables_used: [],
        confidence: 0,
        rejection_reason: initialModelOutcome.errorReason,
      };
      const assistantTurn: AssistantConversationTurn = {
        id: createTurnId('assistant'),
        role: 'assistant',
        response: fallbackResponse,
        validatedTablesUsed: [],
        processingError: true,
        latencyMs: totalLatency,
        trace,
        timestamp: new Date().toISOString(),
      };
      const nextSession = session.recordTurnPair(userTurn, assistantTurn);
      return { userTurn, assistantTurn, sessionState: nextSession };
    }

    // 4. Deterministic Round-3 Clarification Limit Check
    const roundCheckStart = performance.now();
    const { response: postRoundResponse, convertedFromClarify } =
      enforceClarificationRoundLimit(
        initialModelOutcome.response,
        clarificationRound
      );
    const roundCheckDur = Math.max(
      1,
      Math.round(performance.now() - roundCheckStart)
    );

    if (convertedFromClarify) {
      trace.push({
        stage: 'ROUND_LIMIT_CHECK',
        status: 'passed',
        detail: `Round ${clarificationRound} limit reached: converted CLARIFY to REJECT in code`,
        durationMs: roundCheckDur,
      });
    } else {
      trace.push({
        stage: 'ROUND_LIMIT_CHECK',
        status: 'passed',
        detail: `Round ${clarificationRound} within limit (status=${postRoundResponse.status})`,
        durationMs: roundCheckDur,
      });
    }

    // If CLARIFY or REJECT, no SQL is validated or executed!
    if (postRoundResponse.status !== 'SUCCESS') {
      const totalLatency = Math.max(
        1,
        Math.round(performance.now() - pipelineStart)
      );
      const assistantTurn: AssistantConversationTurn = {
        id: createTurnId('assistant'),
        role: 'assistant',
        response: postRoundResponse,
        validatedTablesUsed: [],
        latencyMs: totalLatency,
        trace,
        timestamp: new Date().toISOString(),
      };
      const nextSession = session.recordTurnPair(userTurn, assistantTurn);
      return { userTurn, assistantTurn, sessionState: nextSession };
    }

    // 5. status === 'SUCCESS': Validate SQL (Steps 1-8) -> Dry Run (Step 9) -> Execute (Step 10)
    //    with up to 2 REPAIR attempts if validation, dryRun, or execution fails.
    let activeResponse: VimarshResponse = postRoundResponse;
    let repairCount = 0;
    let firstFailureError: string | undefined;

    while (true) {
      const candidateSql = activeResponse.sql_query ?? '';
      const currentMode: OperatingMode = repairCount === 0 ? 'ANSWER' : 'REPAIR';

      // Steps 1-8: Static SQL Validator
      const valStart = performance.now();
      const staticRes = validateSqlStatic(candidateSql, params.schemaContext);
      const valDur = Math.max(1, Math.round(performance.now() - valStart));

      let validationOrExecError: {
        source: RepairErrorSource;
        message: string;
      } | null = null;
      let validatedSql: ValidatedSql | null = null;
      let astTablesUsed: string[] = [];
      let executionResult: QueryExecutionResult | undefined;

      if (!staticRes.valid) {
        const errMsg = `Step ${staticRes.failedStep} validation failed: ${staticRes.error}`;
        validationOrExecError = { source: 'VALIDATION', message: errMsg };
        trace.push({
          stage: 'SQL_VALIDATOR',
          status: 'failed',
          detail: errMsg,
          durationMs: valDur,
        });
        audit.record({
          mode: currentMode,
          status: 'ERROR',
          source: 'SQL_VALIDATOR',
          validatorResult: errMsg,
          latencyMs: valDur,
          repairCount,
          failedSql: candidateSql,
        });
      } else {
        validatedSql = staticRes.validatedSql;
        astTablesUsed = staticRes.tablesUsed;
        trace.push({
          stage: 'SQL_VALIDATOR',
          status: 'passed',
          detail: `Steps 1-8 passed (tables=[${astTablesUsed.join(', ')}], LIMIT=${staticRes.limitValue})`,
          durationMs: valDur,
        });
        audit.record({
          mode: currentMode,
          status: 'SUCCESS',
          source: 'SQL_VALIDATOR',
          validatorResult: `Steps 1-8 passed (tables=${astTablesUsed.join(',')})`,
          latencyMs: valDur,
          repairCount,
          finalSql: validatedSql,
        });

        // Step 9: Worker Dry Run (EXPLAIN QUERY PLAN)
        const dryStart = performance.now();
        try {
          const dryRes = await params.dbRunner.dryRun(validatedSql);
          trace.push({
            stage: 'DRY_RUN',
            status: 'passed',
            detail: 'Step 9 EXPLAIN QUERY PLAN succeeded',
            durationMs: Math.max(1, Math.round(dryRes.durationMs)),
          });
        } catch (err) {
          const dryDur = Math.max(1, Math.round(performance.now() - dryStart));
          const dryMsg =
            err instanceof Error
              ? err.message
              : `EXPLAIN QUERY PLAN failed: ${String(err)}`;
          validationOrExecError = {
            source: 'VALIDATION',
            message: `Step 9 Dry Run failed: ${dryMsg}`,
          };
          trace.push({
            stage: 'DRY_RUN',
            status: 'failed',
            detail: dryMsg,
            durationMs: dryDur,
          });
          audit.record({
            mode: currentMode,
            status: 'ERROR',
            source: 'SQL_VALIDATOR',
            validatorResult: `Step 9 Dry Run failed: ${dryMsg}`,
            latencyMs: dryDur,
            repairCount,
            failedSql: validatedSql,
          });
        }

        // Step 10: Worker Execute (only if Step 9 succeeded)
        if (!validationOrExecError && validatedSql) {
          const execStart = performance.now();
          try {
            executionResult = await params.dbRunner.execute(validatedSql);
            trace.push({
              stage: 'WORKER_EXECUTE',
              status: 'passed',
              detail: executionResult.isEmpty
                ? 'Executed cleanly (0 rows: No rows matched)'
                : `Executed cleanly (${executionResult.rowCount} rows${executionResult.truncated ? ', truncated at 1000' : ''})`,
              durationMs: Math.max(
                1,
                Math.round(executionResult.executionTimeMs)
              ),
            });
            audit.record({
              mode: currentMode,
              status: 'SUCCESS',
              source: 'EXECUTOR',
              validatorResult: 'Step 10 execution succeeded',
              rowCount: executionResult.rowCount,
              latencyMs: Math.max(
                1,
                Math.round(executionResult.executionTimeMs)
              ),
              repairCount,
              finalSql: validatedSql,
            });
          } catch (err) {
            const execDur = Math.max(
              1,
              Math.round(performance.now() - execStart)
            );
            const execMsg = err instanceof Error ? err.message : String(err);
            validationOrExecError = {
              source: 'EXECUTION',
              message: execMsg,
            };
            trace.push({
              stage: 'WORKER_EXECUTE',
              status: 'failed',
              detail: execMsg,
              durationMs: execDur,
            });
            audit.record({
              mode: currentMode,
              status: 'ERROR',
              source: 'EXECUTOR',
              validatorResult: `Execution failed: ${execMsg}`,
              latencyMs: execDur,
              repairCount,
              failedSql: validatedSql,
            });
          }
        }
      }

      // If all 10 steps succeeded, return the SUCCESS turn (with AST-derived tables_used)
      if (!validationOrExecError && executionResult && validatedSql) {
        const totalLatency = Math.max(
          1,
          Math.round(performance.now() - pipelineStart)
        );
        const finalResponse: VimarshResponse = {
          ...activeResponse,
          sql_query: validatedSql,
          tables_used: astTablesUsed,
        };
        const assistantTurn: AssistantConversationTurn = {
          id: createTurnId('assistant'),
          role: 'assistant',
          response: finalResponse,
          validatedTablesUsed: astTablesUsed,
          executionResult,
          repaired: repairCount > 0,
          repairCount,
          originalError: firstFailureError,
          latencyMs: totalLatency,
          trace,
          timestamp: new Date().toISOString(),
        };
        const nextSession = session.recordTurnPair(userTurn, assistantTurn);
        return { userTurn, assistantTurn, sessionState: nextSession };
      }

      // Otherwise, an error occurred in SQL validation, dryRun, or execution.
      const failureInfo = validationOrExecError ?? {
        source: 'VALIDATION' as RepairErrorSource,
        message: 'Unknown SQL validation error',
      };
      if (!firstFailureError) {
        firstFailureError = failureInfo.message;
      }

      if (repairCount >= MAX_SQL_REPAIR_ATTEMPTS) {
        const totalLatency = Math.max(
          1,
          Math.round(performance.now() - pipelineStart)
        );
        audit.record({
          mode: 'REPAIR',
          status: 'REJECT',
          source: 'RETRY_EXHAUSTED',
          validatorResult: `SQL repair exhausted after ${repairCount} attempts. Last error: ${failureInfo.message}`,
          latencyMs: totalLatency,
          repairCount,
          failedSql: candidateSql,
        });

        const exhaustedResponse: VimarshResponse = {
          status: 'REJECT',
          reasoning: `Generated SQL failed validation or execution after ${repairCount} automatic repair attempts (${failureInfo.message}). Unvalidated SQL is never executed.`,
          sql_query: null,
          follow_up_question: null,
          clarification_options: [],
          ambiguity_type: null,
          assumptions: [],
          tables_used: [],
          confidence: 0,
          rejection_reason:
            'Vimarsh could not produce a verified safe query after 2 automatic repair attempts. Please rephrase your question.',
        };

        const assistantTurn: AssistantConversationTurn = {
          id: createTurnId('assistant'),
          role: 'assistant',
          response: exhaustedResponse,
          validatedTablesUsed: [],
          repaired: false,
          repairCount,
          originalError: firstFailureError,
          processingError: true,
          latencyMs: totalLatency,
          trace,
          timestamp: new Date().toISOString(),
        };
        const nextSession = session.recordTurnPair(userTurn, assistantTurn);
        return { userTurn, assistantTurn, sessionState: nextSession };
      }

      // Trigger REPAIR attempt
      repairCount += 1;
      const repairStart = performance.now();
      trace.push({
        stage: 'REPAIR_ATTEMPT',
        status: 'passed',
        detail: `Starting REPAIR attempt #${repairCount} (error_source=${failureInfo.source}: ${failureInfo.message})`,
        durationMs: 1,
      });
      audit.record({
        mode: 'REPAIR',
        status: 'SUCCESS',
        source: 'REPAIR',
        validatorResult: `Initiating repair #${repairCount} (${failureInfo.source}): ${failureInfo.message}`,
        latencyMs: 1,
        repairCount,
        failedSql: candidateSql,
      });

      const repairOutcome = await obtainValidatedModelResponse({
        mode: 'REPAIR',
        systemInstruction,
        baseUserMessageParams: {
          mode: 'REPAIR',
          pendingClarification,
          clarificationRound,
          priorTurns: currentSession.turns,
          pendingState: currentSession.pending,
          userQuestion: guardRes.sanitizedQuestion,
          errorSource: failureInfo.source,
          failedSql: candidateSql,
          dbError: failureInfo.message,
        },
        schemaContext: params.schemaContext,
        trace,
        audit,
        repairCount,
        failedSqlForAudit: candidateSql,
        transport: params.transport,
        abortSignal: deadlineController.signal,
        baseBackoffMs: params.baseBackoffMs,
      });

      const repairDur = Math.max(1, Math.round(performance.now() - repairStart));
      if (!repairOutcome.ok) {
        const totalLatency = Math.max(
          1,
          Math.round(performance.now() - pipelineStart)
        );
        const failResponse: VimarshResponse = {
          status: 'REJECT',
          reasoning: `Repair attempt #${repairCount} failed to return a valid contract response (${repairDur}ms).`,
          sql_query: null,
          follow_up_question: null,
          clarification_options: [],
          ambiguity_type: null,
          assumptions: [],
          tables_used: [],
          confidence: 0,
          rejection_reason: repairOutcome.errorReason,
        };
        const assistantTurn: AssistantConversationTurn = {
          id: createTurnId('assistant'),
          role: 'assistant',
          response: failResponse,
          validatedTablesUsed: [],
          repairCount,
          originalError: firstFailureError,
          processingError: true,
          latencyMs: totalLatency,
          trace,
          timestamp: new Date().toISOString(),
        };
        const nextSession = session.recordTurnPair(userTurn, assistantTurn);
        return { userTurn, assistantTurn, sessionState: nextSession };
      }

      // If the model decided to REJECT in REPAIR mode (e.g. security violation that cannot be safely fixed)
      if (repairOutcome.response.status === 'REJECT') {
        const totalLatency = Math.max(
          1,
          Math.round(performance.now() - pipelineStart)
        );
        const assistantTurn: AssistantConversationTurn = {
          id: createTurnId('assistant'),
          role: 'assistant',
          response: repairOutcome.response,
          validatedTablesUsed: [],
          repaired: false,
          repairCount,
          originalError: firstFailureError,
          latencyMs: totalLatency,
          trace,
          timestamp: new Date().toISOString(),
        };
        const nextSession = session.recordTurnPair(userTurn, assistantTurn);
        return { userTurn, assistantTurn, sessionState: nextSession };
      }

      // Otherwise repairOutcome.response.status === 'SUCCESS' (CLARIFY is rejected by responseValidator in REPAIR mode)
      activeResponse = repairOutcome.response;
    }
  } finally {
    clearTimeout(deadlineTimer);
    if (params.abortSignal) {
      params.abortSignal.removeEventListener('abort', onCallerAbort);
    }
  }
}
