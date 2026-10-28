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

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <section
        aria-label="Evaluation Suite Controls and Metrics"
        className="rounded-xl border border-slate-800 bg-slate-900/75 p-5 space-y-5"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">
              Golden Test Evaluation Suite ({GOLDEN_TEST_SUITE.length} Date-Proof
              Cases)
            </h2>
            <p className="text-xs text-slate-400">
              11 clear (SUCCESS), 11 ambiguous (CLARIFY), 5 malicious (REJECT),
              and 5 unsupported (REJECT) — including 4 Hindi/Hinglish queries.
              Expected results are computed at test time by substituting{' '}
              <code className="font-mono text-sky-300">
                {'{{dateHelpers}}'}
              </code>{' '}
              placeholders and comparing result sets as multisets.
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
                    : 'Run all 32 golden tests sequentially (concurrency 1)'
                }
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-sky-300"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>
                  {isConnected
                    ? `Run All Golden Tests (${GOLDEN_TEST_SUITE.length})`
                    : 'Connect your API key to start'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopSuite}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-500 transition-colors focus-visible:outline-2 focus-visible:outline-rose-300"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Evaluation</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Metrics Grid (CLARIFY is Positive Class; Zero Denominator shows "n/a") */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 pt-3 border-t border-slate-800">
          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80">
            <div className="text-[11px] text-slate-400">Status Accuracy</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-100">
              {metrics.statusAccuracy}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80">
            <div className="text-[11px] text-slate-400">
              Clarify Precision TP/(TP+FP)
            </div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-amber-300">
              {metrics.clarificationPrecision}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80">
            <div className="text-[11px] text-slate-400">
              Clarify Recall TP/(TP+FN)
            </div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-amber-300">
              {metrics.clarificationRecall}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80">
            <div className="text-[11px] text-slate-400">
              Ambiguity-Code Match
            </div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-sky-300">
              {metrics.ambiguityCodeMatchRate}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80">
            <div className="text-[11px] text-slate-400">Attack Block Rate</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-emerald-400">
              {metrics.attackBlockRate}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80">
            <div className="text-[11px] text-slate-400">Execution Accuracy</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-emerald-400">
              {metrics.executionAccuracy}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80">
            <div className="text-[11px] text-slate-400">Average Latency</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-100">
              {metrics.averageLatencyMs}
            </div>
          </div>
        </div>

        {/* Traceability & Run Status Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs font-mono text-slate-400">
          <div className="flex flex-wrap items-center gap-4">
            <span>
              Completed: <strong className="text-slate-200">{metrics.completedCount}</strong>/{metrics.totalTests}
            </span>
            <span>
              Errored:{' '}
              <strong
                className={
                  metrics.erroredCount > 0 ? 'text-rose-400' : 'text-slate-200'
                }
              >
                {metrics.erroredCount}
              </strong>
            </span>
            <span>
              Skipped: <strong className="text-slate-200">{metrics.skippedCount}</strong>
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                Zero queries on CLARIFY/REJECT:{' '}
                {metrics.allClarifyRejectExecutedZeroQueries ? 'VERIFIED' : 'VIOLATED'}
              </span>
            </span>
          </div>
          <div className="text-[11px] text-slate-400">
            {PROMPT_VERSION} · {GEMINI_MODEL} · {GENERATION_CONFIG_SUMMARY}
          </div>
        </div>
      </section>

      {/* Per-Test Golden Table */}
      <section
        aria-label="Golden Test Cases and Per-Test Evaluation Results"
        className="rounded-xl border border-slate-800 bg-slate-900/75 overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/70 text-[11px] font-medium text-slate-400">
                <th className="py-2.5 px-3">ID &amp; Category</th>
                <th className="py-2.5 px-3">Question</th>
                <th className="py-2.5 px-3">Expected</th>
                <th className="py-2.5 px-3">Actual</th>
                <th className="py-2.5 px-3">Comparison &amp; Zero-Query Check</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
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
                    <tr className="hover:bg-slate-800/35 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap align-top">
                        <div className="font-semibold text-slate-200">
                          {tc.id}
                        </div>
                        <div className="text-slate-400">
                          [{tc.category}
                          {tc.language === 'hi-hinglish' ? ' · HI' : ''}]
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top max-w-xs">
                        <div className="text-slate-100 font-medium break-words">
                          {tc.question}
                        </div>
                        {tc.gold_sql && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRowId(isExpanded ? null : tc.id)
                            }
                            className="mt-1 text-[11px] font-mono text-sky-400 hover:text-sky-300 underline"
                          >
                            {isExpanded
                              ? 'Hide gold_sql & details'
                              : 'Inspect date-proof gold_sql'}
                          </button>
                        )}
                      </td>

                      <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap align-top">
                        <span
                          className={
                            tc.expected_status === 'SUCCESS'
                              ? 'text-emerald-400'
                              : tc.expected_status === 'CLARIFY'
                                ? 'text-amber-400'
                                : 'text-rose-400'
                          }
                        >
                          {tc.expected_status}
                        </span>
                        {tc.expected_ambiguity_codes.length > 0 && (
                          <div className="text-slate-400">
                            codes: {tc.expected_ambiguity_codes.join(', ')}
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap align-top">
                        {row.runState === 'pending' ? (
                          <span className="text-slate-500">Pending</span>
                        ) : row.runState === 'running' || isRowRunning ? (
                          <span className="text-sky-400">Running...</span>
                        ) : row.runState === 'skipped' ? (
                          <span className="text-slate-400">Skipped</span>
                        ) : row.runState === 'errored' ? (
                          <span className="inline-flex items-center gap-1 text-rose-400">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>ERROR</span>
                          </span>
                        ) : (
                          <div>
                            <span
                              className={`inline-flex items-center gap-1 font-semibold ${
                                row.statusMatched
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
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
                              <div className="text-slate-400">
                                codes: {row.actualAmbiguityCodes.join(', ')}
                              </div>
                            )}
                            <div className="text-slate-500 tabular-nums">
                              {row.latencyMs} ms
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300 align-top">
                        <div>{row.executionComparisonDetail}</div>
                        {row.errorDetail && (
                          <div className="text-rose-400 mt-0.5">
                            {row.errorDetail}
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap align-top">
                        <button
                          type="button"
                          disabled={
                            isRunningSuite ||
                            isRowRunning ||
                            (!isConnected && !canRunOffline) ||
                            !schemaContext
                          }
                          onClick={() => void handleRunSingleRow(tc)}
                          className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
                        >
                          Run
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-slate-950/90">
                        <td colSpan={6} className="p-3.5 space-y-2 font-mono text-[11px]">
                          <div>
                            <span className="text-slate-400">
                              Template gold_sql (date-proof):
                            </span>
                            <pre className="mt-1 p-2 rounded bg-slate-900 text-sky-300 overflow-x-auto whitespace-pre-wrap">
                              {tc.gold_sql}
                            </pre>
                          </div>
                          <div>
                            <span className="text-slate-400">
                              Substituted gold_sql (for today&apos;s seeded DB):
                            </span>
                            <pre className="mt-1 p-2 rounded bg-slate-900 text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                              {row.substitutedGoldSql}
                            </pre>
                          </div>
                          {row.generatedSql && (
                            <div>
                              <span className="text-slate-400">
                                Model generated SQL:
                              </span>
                              <pre className="mt-1 p-2 rounded bg-slate-900 text-amber-200 overflow-x-auto whitespace-pre-wrap">
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
