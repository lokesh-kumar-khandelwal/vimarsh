import React, { useEffect, useState } from 'react';
import { Activity, BarChart3, Clock, Download, Play } from 'lucide-react';
import {
  CONNECT_PROBE_TIMEOUT_MS,
  GEMINI_MODEL,
  PER_QUESTION_DEADLINE_MS,
  PER_REQUEST_TIMEOUT_MS,
  SQL_JS_VERSION,
} from '../config';
import { auditLog } from '../engine/auditLog';
import type { DbClient } from '../engine/dbClient';
import { runInputGuard } from '../engine/inputGuard';
import { getLastProbeTelemetry } from '../engine/llmClient';
import { runQuestionPipeline } from '../engine/queryPipeline';
import { sessionStore } from '../engine/sessionStore';
import { PROMPT_VERSION } from '../engine/systemPrompt';
import type {
  AssistantConversationTurn,
  AuditLogEvent,
  ByokConnectionState,
  PipelineStageTrace,
  SchemaContext,
  SessionState,
} from '../types';
import {
  DEVELOPER_DIAGNOSTIC_EXAMPLES,
  type DiagnosticStarterQuestion,
} from './workspace/workspaceConstants';

export interface EngineDiagnosticsPanelProps {
  schemaContext?: SchemaContext | null;
  dbClient?: DbClient;
  connectionState?: ByokConnectionState;
  onOpenInAskWorkspace?: () => void;
}

/**
 * Developer Tools View: Adversarial & Security Test Examples, Engine Metadata,
 * Live Engine Trace & Structured Audit Log.
 */
export const EngineDiagnosticsPanel: React.FC<EngineDiagnosticsPanelProps> = ({
  schemaContext,
  dbClient,
  connectionState,
  onOpenInAskWorkspace,
}) => {
  const [sessionState, setSessionState] = useState<SessionState>(() =>
    sessionStore.getState()
  );
  const [auditEvents, setAuditEvents] = useState<AuditLogEvent[]>(() =>
    auditLog.getEvents()
  );
  const [runningExample, setRunningExample] = useState<string | null>(null);
  const [diagnosticNotice, setDiagnosticNotice] = useState<string | null>(null);

  useEffect(() => {
    const unsubSession = sessionStore.subscribe(setSessionState);
    const unsubAudit = auditLog.subscribe(setAuditEvents);
    return () => {
      unsubSession();
      unsubAudit();
    };
  }, []);

  const isConnected = connectionState?.status === 'connected';

  const handleRunDiagnosticExample = async (item: DiagnosticStarterQuestion) => {
    if (!schemaContext || !dbClient || runningExample) return;

    const guardCheck = runInputGuard(item.question);
    if (!isConnected && guardCheck.allowed) {
      setDiagnosticNotice(
        `"${item.label}" requires a connected Gemini API key. Offline guardrail examples (like DROP TABLE) can run without a key.`
      );
      return;
    }

    setDiagnosticNotice(null);
    setRunningExample(item.question);
    try {
      await runQuestionPipeline({
        rawQuestion: item.question,
        schemaContext,
        dbRunner: {
          dryRun: (sql) => dbClient.dryRun(sql),
          execute: (sql) => dbClient.execute(sql),
        },
      });
      if (onOpenInAskWorkspace) {
        onOpenInAskWorkspace();
      }
    } finally {
      setRunningExample(null);
    }
  };

  const assistantTurnsWithContext = sessionState.turns.reduce<
    Array<{
      turnIndex: number;
      assistantTurn: AssistantConversationTurn;
      userQuestion: string;
    }>
  >((acc, turn, idx) => {
    if (turn.role === 'assistant') {
      let userQuestion = 'Diagnostic query';
      for (let i = idx - 1; i >= 0; i--) {
        const prev = sessionState.turns[i];
        if (prev && prev.role === 'user') {
          userQuestion = prev.question;
          break;
        }
      }
      acc.push({
        turnIndex: acc.length + 1,
        assistantTurn: turn,
        userQuestion,
      });
    }
    return acc;
  }, []);

  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [timelineViewMode, setTimelineViewMode] = useState<
    'waterfall' | 'session_comparison'
  >('waterfall');

  const activeTurnEntry =
    assistantTurnsWithContext.find(
      (entry) => entry.assistantTurn.id === selectedTurnId
    ) ??
    (assistantTurnsWithContext.length > 0
      ? assistantTurnsWithContext[assistantTurnsWithContext.length - 1]
      : null);

  const latestAssistantTurn = activeTurnEntry?.assistantTurn ?? null;
  const latestTrace: PipelineStageTrace[] = latestAssistantTurn?.trace ?? [];
  const latestPerf = latestAssistantTurn?.performanceTelemetry ?? null;
  const lastProbe = getLastProbeTelemetry();

  // Compute timeline metrics for the active turn
  const totalTurnMs = Math.max(
    1,
    latestPerf?.totalLatencyMs ??
      latestAssistantTurn?.latencyMs ??
      latestTrace.reduce((sum, st) => sum + st.durationMs, 0)
  );

  const aiPromptRoundMs =
    latestPerf?.totalLlmDurationMs ??
    latestTrace
      .filter((st) => st.stage === 'LLM_CALL' || st.stage === 'REPAIR_ATTEMPT')
      .reduce((sum, st) => sum + st.durationMs, 0);

  const sqlStaticMs =
    latestPerf?.sqlStaticValidationDurationMs ??
    latestTrace
      .filter((st) => st.stage === 'SQL_VALIDATOR')
      .reduce((sum, st) => sum + st.durationMs, 0);

  const sqlDryRunMs =
    latestPerf?.sqliteDryRunDurationMs ??
    latestTrace
      .filter((st) => st.stage === 'DRY_RUN')
      .reduce((sum, st) => sum + st.durationMs, 0);

  const sqlExecMs =
    latestPerf?.sqliteExecutionDurationMs ??
    latestTrace
      .filter((st) => st.stage === 'WORKER_EXECUTE')
      .reduce((sum, st) => sum + st.durationMs, 0);

  const totalSqlMs = sqlStaticMs + sqlDryRunMs + sqlExecMs;
  const prepAndParseMs = Math.max(
    0,
    totalTurnMs - aiPromptRoundMs - totalSqlMs
  );

  const aiSharePct = latestAssistantTurn
    ? Math.min(100, Math.round((aiPromptRoundMs / totalTurnMs) * 100))
    : 0;
  const sqlSharePct = latestAssistantTurn
    ? Math.min(100, Math.round((totalSqlMs / totalTurnMs) * 100))
    : 0;
  const prepSharePct = latestAssistantTurn
    ? Math.max(0, 100 - aiSharePct - sqlSharePct)
    : 0;

  // Build cumulative waterfall offsets for each stage in latestTrace
  const waterfallItems: Array<{
    index: number;
    stage: (typeof latestTrace)[0]['stage'];
    status: (typeof latestTrace)[0]['status'];
    detail: string;
    startMs: number;
    durationMs: number;
    category: 'ai' | 'sql' | 'guard';
  }> = [];
  let cumulativeOffsetMs = 0;
  for (let index = 0; index < latestTrace.length; index++) {
    const st = latestTrace[index];
    const startMs = cumulativeOffsetMs;
    const durationMs = Math.max(0, st.durationMs);
    cumulativeOffsetMs += durationMs;
    const category: 'ai' | 'sql' | 'guard' =
      st.stage === 'LLM_CALL' || st.stage === 'REPAIR_ATTEMPT'
        ? 'ai'
        : st.stage === 'SQL_VALIDATOR' ||
            st.stage === 'DRY_RUN' ||
            st.stage === 'WORKER_EXECUTE'
          ? 'sql'
          : 'guard';
    waterfallItems.push({
      index,
      stage: st.stage,
      status: st.status,
      detail: st.detail,
      startMs,
      durationMs,
      category,
    });
  }
  const waterfallTotalSpanMs = Math.max(1, cumulativeOffsetMs, totalTurnMs);

  const maxSessionTurnLatencyMs = Math.max(
    1,
    ...assistantTurnsWithContext.map(
      (entry) =>
        entry.assistantTurn.performanceTelemetry?.totalLatencyMs ??
        entry.assistantTurn.latencyMs ??
        1
    )
  );

  const handleDownloadAuditLog = () => {
    const jsonText = auditLog.exportJson();
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vimarsh-audit-log-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Engine Build & Runtime Diagnostics Metadata */}
      <section
        aria-label="Engine Runtime Diagnostics"
        className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-4 flex flex-wrap items-center justify-between gap-4 text-xs"
      >
        <div className="space-y-0.5">
          <div className="font-mono font-bold uppercase tracking-wider text-[#e4e4e7]">
            Stage 4 Engine Architecture &amp; Runtime Metadata
          </div>
          <p className="text-[#e4e4e7]/65">
            Full Clarification Chat UI, Auto-Chart, 32 Date-Proof Golden Tests,
            Multiset Comparator &amp; 10-Step Fail-Closed SQL Validator
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums text-[#38bdf8] bg-[#0c0c0e] px-3 py-1.5 rounded-none border border-[#e4e4e7]/20">
          <span>PROMPT_VERSION: {PROMPT_VERSION}</span>
          <span aria-hidden="true" className="text-[#e4e4e7]/30">
            ·
          </span>
          <span>MODEL: {GEMINI_MODEL}</span>
          <span aria-hidden="true" className="text-[#e4e4e7]/30">
            ·
          </span>
          <span>sql.js: {SQL_JS_VERSION}</span>
          <span aria-hidden="true" className="text-[#e4e4e7]/30">
            ·
          </span>
          <span>
            TIMEOUTS: probe={Math.round(CONNECT_PROBE_TIMEOUT_MS / 1000)}s /
            req={Math.round(PER_REQUEST_TIMEOUT_MS / 1000)}s / total=
            {Math.round(PER_QUESTION_DEADLINE_MS / 1000)}s
          </span>
        </div>
      </section>

      {/* Performance & Latency Telemetry Breakdown + Visual Performance Timeline */}
      <section
        aria-label="Performance and Latency Telemetry"
        className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#38bdf8]" />
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#e4e4e7]">
              Performance &amp; Latency Telemetry
            </h2>
          </div>
          <span className="font-mono text-xs text-[#e4e4e7]/60 tabular-nums">
            SDK internal retries: disabled (attempts=1) · App transport retries:
            max 2
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs font-mono">
          <div className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-3 space-y-1">
            <div className="label-mono">API-Key Probe</div>
            <div className="text-sm font-bold text-[#e4e4e7] tabular-nums">
              {lastProbe
                ? `${lastProbe.durationMs} ms`
                : latestPerf?.probeDurationMs !== null &&
                    latestPerf?.probeDurationMs !== undefined
                  ? `${latestPerf.probeDurationMs} ms`
                  : '—'}
            </div>
            {lastProbe && (
              <div className="text-[10px] text-[#e4e4e7]/55">
                status={lastProbe.status} (retries=
                {lastProbe.transportRetriesUsed})
              </div>
            )}
          </div>

          <div className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-3 space-y-1">
            <div className="label-mono">Gemini Calls</div>
            <div className="text-sm font-bold text-[#38bdf8] tabular-nums">
              {latestPerf ? `${latestPerf.totalLlmDurationMs} ms` : '—'}
            </div>
            <div className="text-[10px] text-[#e4e4e7]/55">
              {latestPerf
                ? `${latestPerf.llmCalls.length} call(s)`
                : 'No turn yet'}
            </div>
          </div>

          <div className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-3 space-y-1">
            <div className="label-mono">Transport Retries</div>
            <div className="text-sm font-bold text-[#e4e4e7] tabular-nums">
              {latestPerf ? latestPerf.transportRetriesUsed : '—'}
            </div>
            <div className="text-[10px] text-[#e4e4e7]/55">
              {latestPerf
                ? `delay=${latestPerf.transportRetryDelayMs} ms`
                : '429/503'}
            </div>
          </div>

          <div className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-3 space-y-1">
            <div className="label-mono">JSON Retries</div>
            <div className="text-sm font-bold text-[#e4e4e7] tabular-nums">
              {latestPerf ? `${latestPerf.jsonRetriesUsed} / 1` : '—'}
            </div>
            <div className="text-[10px] text-[#e4e4e7]/55">Contract nudge</div>
          </div>

          <div className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-3 space-y-1">
            <div className="label-mono">SQL Repairs</div>
            <div className="text-sm font-bold text-[#fbbf24] tabular-nums">
              {latestPerf ? `${latestPerf.sqlRepairCount} / 2` : '—'}
            </div>
            <div className="text-[10px] text-[#e4e4e7]/55">
              {latestPerf
                ? `${latestPerf.sqlRepairDurationMs} ms`
                : 'REPAIR loop'}
            </div>
          </div>

          <div className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-3 space-y-1">
            <div className="label-mono">Static SQL Check</div>
            <div className="text-sm font-bold text-[#e4e4e7] tabular-nums">
              {latestPerf
                ? `${latestPerf.sqlStaticValidationDurationMs} ms`
                : '—'}
            </div>
            <div className="text-[10px] text-[#e4e4e7]/55">Steps 1–8 AST</div>
          </div>

          <div className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-3 space-y-1">
            <div className="label-mono">SQLite Dry-Run / Exec</div>
            <div className="text-sm font-bold text-[#4ade80] tabular-nums">
              {latestPerf
                ? `${latestPerf.sqliteDryRunDurationMs} / ${latestPerf.sqliteExecutionDurationMs} ms`
                : '—'}
            </div>
            <div className="text-[10px] text-[#e4e4e7]/55">Steps 9 &amp; 10</div>
          </div>

          <div className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-3 space-y-1">
            <div className="label-mono">Total Question</div>
            <div className="text-sm font-bold text-[#38bdf8] tabular-nums">
              {latestPerf
                ? `${latestPerf.totalLatencyMs} ms`
                : latestAssistantTurn
                  ? `${latestAssistantTurn.latencyMs} ms`
                  : '—'}
            </div>
            <div className="text-[10px] text-[#e4e4e7]/55">End-to-end</div>
          </div>
        </div>

        {/* Visual Performance Timeline: AI Prompt Rounds & SQL Query Execution */}
        <div
          aria-label="Visual Performance Timeline"
          className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-4 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e4e7]/15 pb-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#38bdf8]" />
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#e4e4e7]">
                  Visual Performance Timeline · AI Prompt Rounds &amp; SQL
                  Execution
                </h3>
              </div>
              <p className="text-xs text-[#e4e4e7]/60">
                Tracks execution latency across Gemini prompt rounds (ANSWER,
                JSON_RETRY, REPAIR) and 10-step SQLite validation &amp; worker
                execution.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {assistantTurnsWithContext.length > 1 && (
                <div
                  role="group"
                  aria-label="Select conversation turn"
                  className="flex items-center gap-1 bg-[#121216] p-1 rounded-none border border-[#e4e4e7]/20"
                >
                  {assistantTurnsWithContext.map((entry) => {
                    const isSelected =
                      entry.assistantTurn.id === latestAssistantTurn?.id;
                    return (
                      <button
                        key={entry.assistantTurn.id}
                        type="button"
                        onClick={() =>
                          setSelectedTurnId(entry.assistantTurn.id)
                        }
                        className={`px-2 py-1 text-[11px] font-mono rounded-none transition-colors tabular-nums cursor-pointer ${
                          isSelected
                            ? 'bg-[#e4e4e7] text-[#0c0c0e] font-bold'
                            : 'text-[#e4e4e7]/65 hover:text-[#38bdf8]'
                        }`}
                        title={entry.userQuestion}
                      >
                        Turn #{entry.turnIndex}
                      </button>
                    );
                  })}
                </div>
              )}

              <div
                role="group"
                aria-label="Timeline view mode"
                className="flex items-center bg-[#121216] p-1 rounded-none border border-[#e4e4e7]/20 text-xs font-mono"
              >
                <button
                  type="button"
                  onClick={() => setTimelineViewMode('waterfall')}
                  className={`px-2.5 py-1 rounded-none transition-colors cursor-pointer ${
                    timelineViewMode === 'waterfall'
                      ? 'bg-[#e4e4e7] text-[#0c0c0e] font-bold'
                      : 'text-[#e4e4e7]/65 hover:text-[#38bdf8]'
                  }`}
                >
                  Turn Breakdown
                </button>
                <button
                  type="button"
                  onClick={() => setTimelineViewMode('session_comparison')}
                  className={`px-2.5 py-1 rounded-none transition-colors cursor-pointer ${
                    timelineViewMode === 'session_comparison'
                      ? 'bg-[#e4e4e7] text-[#0c0c0e] font-bold'
                      : 'text-[#e4e4e7]/65 hover:text-[#38bdf8]'
                  }`}
                >
                  Session History ({assistantTurnsWithContext.length})
                </button>
              </div>
            </div>
          </div>

          {!latestAssistantTurn ? (
            <div className="py-6 text-center space-y-2">
              <p className="text-xs font-mono text-[#e4e4e7]/65">
                No SQL queries or AI prompt rounds recorded yet in this session.
              </p>
              <p className="text-[11px] text-[#e4e4e7]/45 font-mono">
                Submit a question in Ask Data or click &ldquo;Run Test
                Prompt&rdquo; below to populate the live execution timeline.
              </p>
            </div>
          ) : timelineViewMode === 'session_comparison' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#e4e4e7]/60">
                <span>
                  Comparing {assistantTurnsWithContext.length} turn(s) · Peak
                  turn latency: {maxSessionTurnLatencyMs} ms
                </span>
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-[#38bdf8] inline-block" />
                    AI Prompt Rounds
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-[#4ade80] inline-block" />
                    SQL Validation &amp; Exec
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-[#e4e4e7]/50 inline-block" />
                    Guard &amp; Parse
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {assistantTurnsWithContext.map((entry) => {
                  const perf = entry.assistantTurn.performanceTelemetry;
                  const turnTotal = Math.max(
                    1,
                    perf?.totalLatencyMs ?? entry.assistantTurn.latencyMs ?? 1
                  );
                  const turnAiMs = perf?.totalLlmDurationMs ?? 0;
                  const turnSqlMs =
                    (perf?.sqlStaticValidationDurationMs ?? 0) +
                    (perf?.sqliteDryRunDurationMs ?? 0) +
                    (perf?.sqliteExecutionDurationMs ?? 0);
                  const turnOtherMs = Math.max(
                    0,
                    turnTotal - turnAiMs - turnSqlMs
                  );

                  const scalePct = Math.max(
                    6,
                    Math.min(
                      100,
                      Math.round((turnTotal / maxSessionTurnLatencyMs) * 100)
                    )
                  );
                  const aiW = Math.round((turnAiMs / turnTotal) * 100);
                  const sqlW = Math.round((turnSqlMs / turnTotal) * 100);
                  const otherW = Math.max(0, 100 - aiW - sqlW);

                  return (
                    <button
                      key={entry.assistantTurn.id}
                      type="button"
                      onClick={() => {
                        setSelectedTurnId(entry.assistantTurn.id);
                        setTimelineViewMode('waterfall');
                      }}
                      className="w-full text-left rounded-none border border-[#e4e4e7]/15 bg-[#121216] hover:border-[#38bdf8] p-3 space-y-2 transition-colors cursor-pointer"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[#38bdf8] font-bold tabular-nums">
                            #{entry.turnIndex}
                          </span>
                          <span className="text-[#e4e4e7] truncate max-w-md font-medium">
                            {entry.userQuestion}
                          </span>
                          <span className="font-mono text-[11px] text-[#e4e4e7]/60">
                            · {entry.assistantTurn.response.status}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-[#e4e4e7]/60 tabular-nums">
                          AI: {turnAiMs} ms · SQL: {turnSqlMs} ms · Total:{' '}
                          <span className="text-[#38bdf8] font-bold">
                            {turnTotal} ms
                          </span>
                        </div>
                      </div>

                      <div className="w-full bg-[#0c0c0e] rounded-none h-3 overflow-hidden p-0.5 border border-[#e4e4e7]/20">
                        <div
                          className="h-full flex rounded-none overflow-hidden"
                          style={{ width: `${scalePct}%` }}
                        >
                          {turnAiMs > 0 && (
                            <div
                              className="bg-[#38bdf8] h-full"
                              style={{ width: `${Math.max(4, aiW)}%` }}
                              title={`AI Prompt Rounds: ${turnAiMs} ms`}
                            />
                          )}
                          {turnSqlMs > 0 && (
                            <div
                              className="bg-[#4ade80] h-full"
                              style={{ width: `${Math.max(4, sqlW)}%` }}
                              title={`SQL Validation & Execution: ${turnSqlMs} ms`}
                            />
                          )}
                          {turnOtherMs > 0 && (
                            <div
                              className="bg-[#e4e4e7]/50 h-full"
                              style={{ width: `${Math.max(2, otherW)}%` }}
                              title={`Input Guard & Prompt Build: ${turnOtherMs} ms`}
                            />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Active Turn Summary Bar */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[#38bdf8] font-bold tabular-nums">
                      Turn #{activeTurnEntry?.turnIndex ?? 1}
                    </span>
                    <span className="text-[#e4e4e7] font-medium truncate max-w-xl">
                      &ldquo;{activeTurnEntry?.userQuestion}&rdquo;
                    </span>
                    <span className="font-mono text-[11px] text-[#e4e4e7]/60">
                      · {latestAssistantTurn.response.status}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-[#e4e4e7]/60 tabular-nums">
                    Total Execution:{' '}
                    <span className="text-[#38bdf8] font-bold">
                      {totalTurnMs} ms
                    </span>{' '}
                    <span className="text-[#e4e4e7]/40">
                      / {PER_QUESTION_DEADLINE_MS} ms deadline
                    </span>
                  </div>
                </div>

                {/* Proportional Split Bar */}
                <div
                  aria-label="Execution time proportion bar"
                  className="h-3.5 w-full rounded-none bg-[#121216] border border-[#e4e4e7]/20 overflow-hidden flex p-0.5 gap-0.5"
                >
                  {aiPromptRoundMs > 0 && (
                    <div
                      className="h-full bg-[#38bdf8] transition-all"
                      style={{ width: `${Math.max(4, aiSharePct)}%` }}
                      title={`AI Prompt Rounds: ${aiPromptRoundMs} ms (${aiSharePct}%)`}
                    />
                  )}
                  {totalSqlMs > 0 && (
                    <div
                      className="h-full bg-[#4ade80] transition-all"
                      style={{ width: `${Math.max(4, sqlSharePct)}%` }}
                      title={`SQL Validation & Execution: ${totalSqlMs} ms (${sqlSharePct}%)`}
                    />
                  )}
                  {prepAndParseMs > 0 && (
                    <div
                      className="h-full bg-[#e4e4e7]/50 transition-all"
                      style={{ width: `${Math.max(3, prepSharePct)}%` }}
                      title={`Input Guard, Prompt Build & JSON Parse: ${prepAndParseMs} ms (${prepSharePct}%)`}
                    />
                  )}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-[#e4e4e7]/60 pt-0.5">
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 bg-[#38bdf8] inline-block" />
                      <span className="text-[#e4e4e7]">AI Prompt Rounds:</span>{' '}
                      <span className="tabular-nums text-[#38bdf8] font-bold">
                        {aiPromptRoundMs} ms
                      </span>{' '}
                      ({aiSharePct}%)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 bg-[#4ade80] inline-block" />
                      <span className="text-[#e4e4e7]">
                        SQL Validation &amp; Execution:
                      </span>{' '}
                      <span className="tabular-nums text-[#4ade80] font-bold">
                        {totalSqlMs} ms
                      </span>{' '}
                      ({sqlSharePct}%)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 bg-[#e4e4e7]/50 inline-block" />
                      <span className="text-[#e4e4e7]">
                        Guard, Prompt &amp; Parse:
                      </span>{' '}
                      <span className="tabular-nums text-[#e4e4e7]/70">
                        {prepAndParseMs} ms
                      </span>{' '}
                      ({prepSharePct}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Dual-Track Detail Grid: AI Prompt Rounds Track vs SQL Query Track */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
                {/* Track 1: AI Prompt Rounds Track */}
                <div className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#38bdf8] font-mono">
                      1. AI Prompt Rounds ({latestPerf?.llmCalls.length ?? 0}{' '}
                      round
                      {(latestPerf?.llmCalls.length ?? 0) === 1 ? '' : 's'})
                    </span>
                    <span className="text-[11px] font-mono text-[#e4e4e7]/60 tabular-nums">
                      Budget: {PER_REQUEST_TIMEOUT_MS} ms / round
                    </span>
                  </div>

                  {!latestPerf || latestPerf.llmCalls.length === 0 ? (
                    <div className="text-xs font-mono text-[#e4e4e7]/60 py-3">
                      0 ms · Deterministic Input Guard handled this turn without
                      invoking Gemini.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {latestPerf.llmCalls.map((call, idx) => {
                        const widthPct = Math.max(
                          5,
                          Math.min(
                            100,
                            Math.round((call.durationMs / totalTurnMs) * 100)
                          )
                        );
                        const budgetPct = Math.min(
                          100,
                          Math.round(
                            (call.durationMs / PER_REQUEST_TIMEOUT_MS) * 100
                          )
                        );
                        const barColor =
                          call.phase === 'REPAIR'
                            ? 'bg-[#fbbf24]'
                            : call.phase === 'JSON_RETRY'
                              ? 'bg-[#e4e4e7]'
                              : 'bg-[#38bdf8]';

                        return (
                          <div
                            key={`${call.phase}_${idx}`}
                            className="space-y-1 text-xs font-mono"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[#e4e4e7] font-medium">
                                Round #{idx + 1} · {call.phase}
                              </span>
                              <span className="tabular-nums text-[#e4e4e7]/60">
                                <span className="font-bold text-[#38bdf8]">
                                  {call.durationMs} ms
                                </span>{' '}
                                <span className="text-[#e4e4e7]/40">
                                  ({budgetPct}% of 25s cap)
                                </span>
                              </span>
                            </div>
                            <div className="h-2 w-full rounded-none bg-[#0c0c0e] overflow-hidden border border-[#e4e4e7]/20">
                              <div
                                className={`h-full ${barColor}`}
                                style={{ width: `${widthPct}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-[#e4e4e7]/50 tabular-nums">
                              <span>
                                transportRetries={call.transportRetriesUsed}
                              </span>
                              <span>backoffDelay={call.retryDelayMs} ms</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Track 2: SQL Query Validation & Execution Track */}
                <div className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#4ade80] font-mono">
                      2. SQL Query Pipeline ({totalSqlMs} ms total)
                    </span>
                    <span className="text-[11px] font-mono text-[#e4e4e7]/60 tabular-nums">
                      {latestAssistantTurn.executionResult
                        ? `${latestAssistantTurn.executionResult.rowCount} row(s) returned`
                        : '0 queries executed'}
                    </span>
                  </div>

                  <div className="space-y-2.5 text-xs font-mono">
                    {[
                      {
                        label: 'Steps 1–8 · AST Static Validation',
                        ms: sqlStaticMs,
                        barClass: 'bg-[#e4e4e7]/70',
                        note:
                          sqlStaticMs > 0 ||
                          latestTrace.some((t) => t.stage === 'SQL_VALIDATOR')
                            ? 'Read-only SELECT, allowlist & sensitive-column check'
                            : 'Skipped (non-SQL turn)',
                      },
                      {
                        label: 'Step 9 · SQLite EXPLAIN QUERY PLAN Dry-Run',
                        ms: sqlDryRunMs,
                        barClass: 'bg-[#38bdf8]',
                        note:
                          sqlDryRunMs > 0 ||
                          latestTrace.some((t) => t.stage === 'DRY_RUN')
                            ? 'Verified query plan in SQLite Worker'
                            : 'Not reached',
                      },
                      {
                        label: 'Step 10 · SQLite Web Worker Execution',
                        ms: sqlExecMs,
                        barClass: 'bg-[#4ade80]',
                        note: latestAssistantTurn.executionResult
                          ? `Executed in ${latestAssistantTurn.executionResult.executionTimeMs} ms · ${latestAssistantTurn.executionResult.columns.length} cols`
                          : 'Zero queries executed on CLARIFY/REJECT',
                      },
                    ].map((sqlPhase) => {
                      const pct =
                        totalSqlMs > 0
                          ? Math.max(
                              sqlPhase.ms > 0 ? 6 : 0,
                              Math.min(
                                100,
                                Math.round(
                                  (sqlPhase.ms / Math.max(1, totalSqlMs)) * 100
                                )
                              )
                            )
                          : 0;
                      return (
                        <div key={sqlPhase.label} className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[#e4e4e7]">
                              {sqlPhase.label}
                            </span>
                            <span className="tabular-nums font-bold text-[#4ade80]">
                              {sqlPhase.ms} ms
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-none bg-[#0c0c0e] overflow-hidden border border-[#e4e4e7]/20">
                            <div
                              className={`h-full ${sqlPhase.barClass}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-[#e4e4e7]/50">
                            {sqlPhase.note}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Chronological Stage Waterfall */}
              {waterfallItems.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[11px] font-mono text-[#e4e4e7]/60">
                    <span>
                      Chronological Pipeline Waterfall (0 ms &rarr;{' '}
                      {waterfallTotalSpanMs} ms)
                    </span>
                    <span>Offset · Duration</span>
                  </div>
                  <div className="space-y-1.5">
                    {waterfallItems.map((item) => {
                      const leftPct = Math.min(
                        94,
                        Math.round((item.startMs / waterfallTotalSpanMs) * 100)
                      );
                      const widthPct = Math.max(
                        2,
                        Math.min(
                          100 - leftPct,
                          Math.round(
                            (item.durationMs / waterfallTotalSpanMs) * 100
                          )
                        )
                      );
                      const barClass =
                        item.status === 'failed'
                          ? 'bg-[#f87171]'
                          : item.category === 'ai'
                            ? 'bg-[#38bdf8]'
                            : item.category === 'sql'
                              ? 'bg-[#4ade80]'
                              : 'bg-[#e4e4e7]/60';

                      return (
                        <div
                          key={`${item.stage}_${item.index}`}
                          className="grid grid-cols-12 items-center gap-2 text-[11px] font-mono"
                        >
                          <div className="col-span-4 sm:col-span-3 truncate text-[#e4e4e7]">
                            <span
                              className={
                                item.status === 'failed'
                                  ? 'text-[#f87171]'
                                  : item.category === 'ai'
                                    ? 'text-[#38bdf8]'
                                    : item.category === 'sql'
                                      ? 'text-[#4ade80]'
                                      : 'text-[#e4e4e7]/65'
                              }
                            >
                              {item.stage}
                            </span>
                          </div>
                          <div className="col-span-5 sm:col-span-6 h-2.5 rounded-none bg-[#121216] border border-[#e4e4e7]/20 relative overflow-hidden">
                            <div
                              className={`absolute top-0 bottom-0 ${barClass}`}
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                              }}
                              title={`${item.stage}: +${item.startMs} ms, duration ${item.durationMs} ms (${item.detail})`}
                            />
                          </div>
                          <div className="col-span-3 text-right tabular-nums text-[#e4e4e7]/60">
                            +{item.startMs}ms ·{' '}
                            <span className="text-[#e4e4e7] font-bold">
                              {item.durationMs}ms
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Adversarial, Security & Ambiguity Diagnostic Examples (kept in Developer Tools) */}
      <section
        aria-label="Adversarial and Ambiguity Test Prompts"
        className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-5 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#e4e4e7]">
              Adversarial, Security &amp; Ambiguity Test Prompts
            </h2>
            <p className="text-xs text-[#e4e4e7]/65 mt-0.5">
              Run security-guardrail and ambiguity test cases through the
              question pipeline and inspect the resulting trace.
            </p>
          </div>
        </div>

        {diagnosticNotice && (
          <p role="status" className="text-xs font-mono text-[#fbbf24]">
            {diagnosticNotice}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {DEVELOPER_DIAGNOSTIC_EXAMPLES.map((item) => (
            <div
              key={item.label}
              className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] p-3.5 flex flex-col justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono font-bold text-[#38bdf8]">
                    {item.category}
                  </span>
                  {item.worksOfflineGuard && (
                    <span className="text-[10px] font-mono text-[#4ade80]">
                      Offline Guardrail
                    </span>
                  )}
                </div>
                <div className="text-xs font-bold text-[#e4e4e7] font-mono">
                  &ldquo;{item.question}&rdquo;
                </div>
                <p className="text-xs text-[#e4e4e7]/65">{item.description}</p>
              </div>

              <div>
                <button
                  type="button"
                  disabled={
                    !schemaContext || !dbClient || Boolean(runningExample)
                  }
                  onClick={() => void handleRunDiagnosticExample(item)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/35 bg-[#121216] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Play className="w-3 h-3" />
                  <span>
                    {runningExample === item.question
                      ? 'Running...'
                      : 'Run Test Prompt'}
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Live Engine Trace */}
        <section
          aria-label="Live Engine Trace"
          className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#38bdf8]" />
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#e4e4e7]">
                Latest Pipeline Stage Trace
              </h2>
            </div>
            <span className="font-mono text-xs text-[#38bdf8] tabular-nums">
              {latestTrace.length} stages
            </span>
          </div>

          {latestTrace.length === 0 ? (
            <p className="text-xs font-mono text-[#e4e4e7]/60 py-6 text-center">
              Ask a question or run a test prompt above to inspect stage-by-stage
              pass/fail status and timing.
            </p>
          ) : (
            <div className="space-y-2.5">
              {latestTrace.map((st, idx) => (
                <div
                  key={`${st.stage}_${idx}`}
                  className="p-3 rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-mono">
                    <span
                      className={`font-bold ${
                        st.status === 'passed'
                          ? 'text-[#4ade80]'
                          : st.status === 'failed'
                            ? 'text-[#f87171]'
                            : 'text-[#e4e4e7]/60'
                      }`}
                    >
                      {st.status === 'passed' ? 'PASS' : 'FAIL'} · {st.stage}
                    </span>
                    <span className="text-[#e4e4e7]/60 tabular-nums">
                      {st.durationMs} ms
                    </span>
                  </div>
                  <p className="text-xs text-[#e4e4e7]/80 font-mono break-words">
                    {st.detail}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Structured Audit Log */}
        <section
          aria-label="Structured Audit Log"
          className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#e4e4e7]">
                Structured Audit Log ({auditEvents.length})
              </h2>
              <p className="text-xs text-[#e4e4e7]/60 mt-0.5">
                Records pipeline stages without API keys, result rows, or raw
                prompts.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadAuditLog}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/35 bg-[#0c0c0e] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Audit Log (JSON)</span>
            </button>
          </div>

          {auditEvents.length === 0 ? (
            <p className="text-xs font-mono text-[#e4e4e7]/60 py-6 text-center">
              No audit events recorded in this session yet.
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {[...auditEvents].reverse().map((ev) => (
                <div
                  key={ev.id}
                  className="p-3 rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] text-xs font-mono space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#38bdf8] font-bold">
                      {ev.source} · {ev.mode}
                    </span>
                    <span
                      className={`tabular-nums font-bold ${
                        ev.status === 'SUCCESS'
                          ? 'text-[#4ade80]'
                          : ev.status === 'CLARIFY'
                            ? 'text-[#fbbf24]'
                            : 'text-[#f87171]'
                      }`}
                    >
                      {ev.status} ({ev.latencyMs} ms)
                    </span>
                  </div>
                  <div className="text-[#e4e4e7] break-words">
                    {ev.validatorResult}
                  </div>
                  {ev.repairCount > 0 && (
                    <div className="text-[#fbbf24]">
                      repairCount: {ev.repairCount}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
