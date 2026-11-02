import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Play,
  ShieldCheck,
  Square,
  XCircle,
} from 'lucide-react';
import { GEMINI_MODEL } from '../config';
import type { DbClient } from '../engine/dbClient';
import {
  computeEvaluationMetrics,
  exportEvaluationCsv,
  GENERATION_CONFIG_SUMMARY,
  runSingleGoldenTest,
} from '../engine/evaluationEngine';
import {
  GOLDEN_TEST_SUITE,
  substituteGoldSqlPlaceholders,
} from '../engine/goldenTests';
import { PROMPT_VERSION } from '../engine/systemPrompt';
import type {
  ByokConnectionState,
  GoldenTestCase,
  GoldenTestEvalResult,
  SchemaContext,
} from '../types';

interface EvaluationPanelProps {
  schemaContext: SchemaContext | null;
  dbClient: DbClient;
  connectionState: ByokConnectionState;
  selfTestPassedCount?: number;
  selfTestTotalCount?: number;
  isLoadingSelfTests?: boolean;
  onOpenSelfTests?: () => void;
}

function buildInitialEvalRow(tc: GoldenTestCase): GoldenTestEvalResult {
  let substituted: string | null = null;
  if (tc.gold_sql) {
    try {
      substituted = substituteGoldSqlPlaceholders(tc.gold_sql, new Date());
    } catch {
      substituted = tc.gold_sql;
    }
  }
  return {
    testId: tc.id,
    question: tc.question,
    category: tc.category,
    expectedStatus: tc.expected_status,
    expectedAmbiguityCodes: tc.expected_ambiguity_codes,
    substitutedGoldSql: substituted,
    runState: 'pending',
    actualStatus: null,
    actualAmbiguityCodes: [],
    generatedSql: null,
    statusMatched: false,
    ambiguityCodeMatched: null,
    executionMatched: null,
    executionComparisonDetail: 'Not run yet',
    queriesExecuted: 0,
    zeroQueriesOnNonSuccess: true,
    repaired: false,
    repairCount: 0,
    latencyMs: 0,
    errorDetail: null,
  };
}

export const EvaluationPanel: React.FC<EvaluationPanelProps> = ({
  schemaContext,
  dbClient,
  connectionState,
  selfTestPassedCount = 0,
  selfTestTotalCount = 0,
  isLoadingSelfTests = false,
  onOpenSelfTests,
}) => {
  const [evalResults, setEvalResults] = useState<GoldenTestEvalResult[]>(() =>
    GOLDEN_TEST_SUITE.map(buildInitialEvalRow)
  );
  const [isRunningSuite, setIsRunningSuite] = useState<boolean>(false);
  const [runningTestId, setRunningTestId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isConnected = connectionState.status === 'connected';

  const metrics = useMemo(
    () => computeEvaluationMetrics(evalResults),
    [evalResults]
  );

  const handleRunAllTests = async () => {
    if (!schemaContext || !isConnected || isRunningSuite) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsRunningSuite(true);

    // Reset all rows to pending before starting sequential concurrency-1 run
    setEvalResults(GOLDEN_TEST_SUITE.map(buildInitialEvalRow));

    try {
      for (let i = 0; i < GOLDEN_TEST_SUITE.length; i += 1) {
        const tc = GOLDEN_TEST_SUITE[i];
        if (controller.signal.aborted) {
          setEvalResults((prev) =>
            prev.map((row, idx) =>
              idx >= i && row.runState === 'pending'
                ? {
                    ...row,
                    runState: 'skipped',
                    executionComparisonDetail: 'Skipped (Stopped by user)',
                  }
                : row
            )
          );
          break;
        }

        setRunningTestId(tc.id);
        setEvalResults((prev) =>
          prev.map((row) =>
            row.testId === tc.id ? { ...row, runState: 'running' } : row
          )
        );

        const singleResult = await runSingleGoldenTest({
          testCase: tc,
          schemaContext,
          dbRunner: {
            dryRun: (sql) => dbClient.dryRun(sql),
            execute: (sql) => dbClient.execute(sql),
          },
          abortSignal: controller.signal,
        });

        setEvalResults((prev) =>
          prev.map((row) => (row.testId === tc.id ? singleResult : row))
        );
      }
    } finally {
      setRunningTestId(null);
      setIsRunningSuite(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopSuite = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleRunSingleRow = async (tc: GoldenTestCase) => {
    if (!schemaContext || isRunningSuite) return;
    // Allow offline Input Guard malicious tests even without key, otherwise require key
    const canRunOffline =
      tc.id === 'gold_mal_01' ||
      tc.id === 'gold_mal_02' ||
      tc.id === 'gold_mal_05';
    if (!isConnected && !canRunOffline) return;

    setRunningTestId(tc.id);
    setEvalResults((prev) =>
      prev.map((row) =>
        row.testId === tc.id ? { ...row, runState: 'running' } : row
      )
    );

    try {
      const singleResult = await runSingleGoldenTest({
        testCase: tc,
        schemaContext,
        dbRunner: {
          dryRun: (sql) => dbClient.dryRun(sql),
          execute: (sql) => dbClient.execute(sql),
        },
      });
      setEvalResults((prev) =>
        prev.map((row) => (row.testId === tc.id ? singleResult : row))
      );
    } finally {
      setRunningTestId(null);
    }
  };

  const handleExportCsv = () => {
    const csvText = exportEvaluationCsv(evalResults, metrics);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vimarsh-evaluation-${PROMPT_VERSION}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const allSelfTestsPassed =
    selfTestTotalCount > 0 && selfTestPassedCount === selfTestTotalCount;
  const failedSelfTestsCount = Math.max(
    0,
    selfTestTotalCount - selfTestPassedCount
  );

  return (
    <div className="space-y-8">
      {/* Variation 2 Hero Header & Metrics */}
      <section
        aria-label="Evaluation Suite Controls and Metrics"
        className="space-y-6"
      >
        <div className="space-y-3">
          <h1 className="font-syne font-extrabold text-3xl sm:text-5xl uppercase tracking-tight leading-[0.95] text-[#e4e4e7]">
            VERIFICATION
            <br />
            SUITE
          </h1>
          <p className="text-xs sm:text-sm text-[#e4e4e7]/65 max-w-2xl leading-relaxed">
            Stage 4 • Full Clarification Chat UI, Auto-Chart,{' '}
            {GOLDEN_TEST_SUITE.length} Date-Proof Golden Tests, Multiset
            Comparator &amp; Evaluation Metrics.
          </p>

          {/* Dynamic Self-Test Runtime Status Badge (Strictly Separate from Golden Evaluation) */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onOpenSelfTests}
              title="Inspect in-browser Self-Test assertions"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-bold tabular-nums rounded-none transition-opacity hover:opacity-90 cursor-pointer ${
                isLoadingSelfTests
                  ? 'bg-[#38bdf8] text-[#0c0c0e]'
                  : selfTestTotalCount === 0
                    ? 'border border-[#e4e4e7]/40 bg-[#121216] text-[#e4e4e7]/75'
                    : allSelfTestsPassed
                      ? 'bg-[#4ade80] text-[#0c0c0e]'
                      : 'bg-[#f87171] text-[#0c0c0e]'
              }`}
            >
              {isLoadingSelfTests ? (
                <span>Running Self-Tests...</span>
              ) : selfTestTotalCount === 0 ? (
                <span>0/0 Self-Tests (Unrun)</span>
              ) : allSelfTestsPassed ? (
                <span>
                  {selfTestPassedCount}/{selfTestTotalCount} Self-Tests Passing
                </span>
              ) : (
                <span>
                  {selfTestPassedCount}/{selfTestTotalCount} Self-Tests Passing (
                  {failedSelfTestsCount} Failed)
                </span>
              )}
            </button>

            <span className="font-mono text-[11px] text-[#e4e4e7]/50 tabular-nums">
              Golden Evaluation: {metrics.completedCount}/{metrics.totalTests}{' '}
              run
              {metrics.erroredCount > 0
                ? ` · ${metrics.erroredCount} errored`
                : ''}
            </span>
          </div>
        </div>

        {/* Primary 4-Column Variation 2 KPI Grid + Secondary 4-Column KPI Grid */}
        <div className="border border-[#e4e4e7]/15 bg-[#0c0c0e]">
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[#e4e4e7]/15">
            <div className="p-5 space-y-2">
              <div className="label-mono">STATUS ACCURACY</div>
              <div className="font-syne font-extrabold text-2xl sm:text-3xl text-[#e4e4e7] tabular-nums">
                {metrics.statusAccuracy}
              </div>
            </div>

            <div className="p-5 space-y-2">
              <div className="label-mono">ATTACK BLOCK</div>
              <div className="font-syne font-extrabold text-2xl sm:text-3xl text-[#e4e4e7] tabular-nums">
                {metrics.attackBlockRate}
              </div>
            </div>

            <div className="p-5 space-y-2">
              <div className="label-mono">CLARIFY RECALL</div>
              <div className="font-syne font-extrabold text-2xl sm:text-3xl text-[#e4e4e7] tabular-nums">
                {metrics.clarificationRecall}
              </div>
            </div>

            <div className="p-5 space-y-2">
              <div className="label-mono">AVG LATENCY</div>
              <div className="font-syne font-extrabold text-2xl sm:text-3xl text-[#e4e4e7] tabular-nums">
                {metrics.averageLatencyMs}
              </div>
            </div>
          </div>

          {/* Secondary KPI Row preserving all 7 Evaluation Metrics + Zero-Query Invariant */}
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[#e4e4e7]/15 border-t border-[#e4e4e7]/15 bg-[#121216]/60">
            <div className="p-3.5 space-y-1">
              <div className="label-mono">CLARIFY PRECISION TP/(TP+FP)</div>
              <div className="font-mono text-sm font-bold text-[#fbbf24] tabular-nums">
                {metrics.clarificationPrecision}
              </div>
            </div>

            <div className="p-3.5 space-y-1">
              <div className="label-mono">AMBIGUITY-CODE MATCH</div>
              <div className="font-mono text-sm font-bold text-[#38bdf8] tabular-nums">
                {metrics.ambiguityCodeMatchRate}
              </div>
            </div>

            <div className="p-3.5 space-y-1">
              <div className="label-mono">EXECUTION ACCURACY</div>
              <div className="font-mono text-sm font-bold text-[#4ade80] tabular-nums">
                {metrics.executionAccuracy}
              </div>
            </div>

            <div className="p-3.5 space-y-1">
              <div className="label-mono">ZERO QUERIES ON CLARIFY/REJECT</div>
              <div className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-[#4ade80]">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {metrics.allClarifyRejectExecutedZeroQueries
                    ? 'VERIFIED'
                    : 'VIOLATED'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Golden Test Cases Header & Table */}
      <section
        aria-label="Golden Test Cases and Per-Test Evaluation Results"
        className="space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-[#e4e4e7]">
              GOLDEN TEST CASES ({GOLDEN_TEST_SUITE.length} DATE-PROOF CASES)
            </h2>
            <p className="text-[11px] font-mono text-[#e4e4e7]/55 tabular-nums">
              COMPLETED: {metrics.completedCount}/{metrics.totalTests} · ERRORED:{' '}
              <span
                className={
                  metrics.erroredCount > 0 ? 'text-[#f87171]' : 'text-[#e4e4e7]'
                }
              >
                {metrics.erroredCount}
              </span>{' '}
              · SKIPPED: {metrics.skippedCount} · {PROMPT_VERSION} ·{' '}
              {GEMINI_MODEL} · {GENERATION_CONFIG_SUMMARY}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {!isRunningSuite ? (
              <button
                type="button"
                onClick={() => void handleRunAllTests()}
                disabled={!isConnected || !schemaContext}
                title={
                  !isConnected
                    ? 'Connect your API key to start'
                    : `Run all ${GOLDEN_TEST_SUITE.length} golden tests sequentially (concurrency 1)`
                }
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider rounded-none bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8] disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>
                  {isConnected
                    ? `RUN ALL GOLDEN TESTS (${GOLDEN_TEST_SUITE.length})`
                    : 'CONNECT API KEY TO RUN SUITE'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopSuite}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider rounded-none bg-[#f87171] text-[#0c0c0e] hover:bg-[#f87171]/90 transition-colors cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>STOP EVALUATION</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/40 bg-[#0c0c0e] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>EXPORT CSV</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border-t border-[#e4e4e7]/20">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-[#e4e4e7] text-[10px] font-mono uppercase tracking-widest text-[#e4e4e7]/60">
                <th className="py-3 px-3">ID / CATEGORY</th>
                <th className="py-3 px-3">QUESTION</th>
                <th className="py-3 px-3">EXPECTED</th>
                <th className="py-3 px-3">ACTUAL</th>
                <th className="py-3 px-3">COMPARISON &amp; ZERO-QUERY CHECK</th>
                <th className="py-3 px-3 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e4e7]/10">
              {GOLDEN_TEST_SUITE.map((tc, idx) => {
                const row = evalResults[idx];
                const isRowRunning = runningTestId === tc.id;
                const isExpanded = expandedRowId === tc.id;
                const canRunOffline =
                  tc.id === 'gold_mal_01' ||
                  tc.id === 'gold_mal_02' ||
                  tc.id === 'gold_mal_05';

                return (
                  <React.Fragment key={tc.id}>
                    <tr className="hover:bg-[#e4e4e7]/[0.03] transition-colors">
                      <td className="py-3.5 px-3 font-mono text-[11px] whitespace-nowrap align-top">
                        <div className="font-bold text-[#e4e4e7] uppercase">
                          {tc.id}
                        </div>
                        <div className="text-[#e4e4e7]/55 uppercase">
                          [{tc.category}
                          {tc.language === 'hi-hinglish' ? ' · HI' : ''}]
                        </div>
                      </td>

                      <td className="py-3.5 px-3 align-top max-w-xs">
                        <div className="text-[#e4e4e7] font-medium break-words">
                          {tc.question}
                        </div>
                        {tc.gold_sql && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRowId(isExpanded ? null : tc.id)
                            }
                            className="mt-1 text-[10px] font-mono uppercase tracking-wider text-[#38bdf8] hover:underline cursor-pointer"
                          >
                            {isExpanded
                              ? 'Hide gold_sql & details'
                              : 'Inspect date-proof gold_sql'}
                          </button>
                        )}
                      </td>

                      <td className="py-3.5 px-3 font-mono text-[11px] whitespace-nowrap align-top">
                        <span
                          className={`inline-block px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                            tc.expected_status === 'SUCCESS'
                              ? 'bg-[#4ade80] text-[#0c0c0e]'
                              : tc.expected_status === 'CLARIFY'
                                ? 'bg-[#fbbf24] text-[#0c0c0e]'
                                : 'bg-[#f87171] text-[#0c0c0e]'
                          }`}
                        >
                          {tc.expected_status}
                        </span>
                        {tc.expected_ambiguity_codes.length > 0 && (
                          <div className="text-[#e4e4e7]/55 mt-1 text-[10px]">
                            codes: {tc.expected_ambiguity_codes.join(', ')}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-3 font-mono text-[11px] whitespace-nowrap align-top">
                        {row.runState === 'pending' ? (
                          <span className="text-[#e4e4e7]/50">Pending</span>
                        ) : row.runState === 'running' || isRowRunning ? (
                          <span className="text-[#38bdf8] font-bold">
                            Running...
                          </span>
                        ) : row.runState === 'skipped' ? (
                          <span className="text-[#e4e4e7]/50">Skipped</span>
                        ) : row.runState === 'errored' ? (
                          <span className="inline-flex items-center gap-1 text-[#f87171] font-bold">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>ERROR</span>
                          </span>
                        ) : (
                          <div>
                            <span
                              className={`inline-flex items-center gap-1 font-bold ${
                                row.statusMatched
                                  ? 'text-[#4ade80]'
                                  : 'text-[#f87171]'
                              }`}
                            >
                              {row.statusMatched ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5" />
                              )}
                              <span>{row.actualStatus}</span>
                            </span>
                            {row.actualAmbiguityCodes.length > 0 && (
                              <div className="text-[#e4e4e7]/60 text-[10px]">
                                codes: {row.actualAmbiguityCodes.join(', ')}
                              </div>
                            )}
                            <div className="text-[#e4e4e7]/55 tabular-nums text-[10px]">
                              {row.latencyMs} ms
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-3 font-mono text-[11px] text-[#e4e4e7]/80 align-top">
                        <div>{row.executionComparisonDetail}</div>
                        {row.errorDetail && (
                          <div className="text-[#f87171] mt-0.5">
                            {row.errorDetail}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-3 text-right whitespace-nowrap align-top">
                        <button
                          type="button"
                          disabled={
                            isRunningSuite ||
                            isRowRunning ||
                            (!isConnected && !canRunOffline) ||
                            !schemaContext
                          }
                          onClick={() => void handleRunSingleRow(tc)}
                          className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7] bg-transparent text-[#e4e4e7] hover:bg-[#e4e4e7] hover:text-[#0c0c0e] disabled:opacity-35 transition-colors cursor-pointer"
                        >
                          RUN
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-[#121216]">
                        <td
                          colSpan={6}
                          className="p-4 space-y-2.5 font-mono text-[11px] border-t border-[#e4e4e7]/10"
                        >
                          <div>
                            <span className="text-[#e4e4e7]/60 uppercase text-[10px] tracking-wider">
                              Template gold_sql (date-proof):
                            </span>
                            <pre className="mt-1 p-2.5 rounded-none bg-[#0c0c0e] text-[#38bdf8] border border-[#e4e4e7]/15 overflow-x-auto whitespace-pre-wrap">
                              {tc.gold_sql}
                            </pre>
                          </div>
                          <div>
                            <span className="text-[#e4e4e7]/60 uppercase text-[10px] tracking-wider">
                              Substituted gold_sql (for today&apos;s seeded DB):
                            </span>
                            <pre className="mt-1 p-2.5 rounded-none bg-[#0c0c0e] text-[#4ade80] border border-[#e4e4e7]/15 overflow-x-auto whitespace-pre-wrap">
                              {row.substitutedGoldSql}
                            </pre>
                          </div>
                          {row.generatedSql && (
                            <div>
                              <span className="text-[#e4e4e7]/60 uppercase text-[10px] tracking-wider">
                                Model generated SQL:
                              </span>
                              <pre className="mt-1 p-2.5 rounded-none bg-[#0c0c0e] text-[#e4e4e7] border border-[#e4e4e7]/15 overflow-x-auto whitespace-pre-wrap">
                                {row.generatedSql}
                              </pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
