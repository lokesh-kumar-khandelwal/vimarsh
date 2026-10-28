import React from 'react';
import { CheckCircle2, Play, ShieldCheck, XCircle } from 'lucide-react';
import type { SeedReport, TestCaseResult } from '../types';

interface SelfTestsPanelProps {
  seedReport: SeedReport | null;
  testResults: TestCaseResult[];
  isRunning: boolean;
  onRerunTests: () => void;
}

const SUITE_TITLES: Record<TestCaseResult['suite'], string> = {
  stage5_faults:
    'Stage 5 Fault Scenarios Suite (9 Scenarios — Worker Init, WASM Load, Model Timeout, Malformed JSON, 429 Quota, Cancellation, Stale Response, Parser Exception, Failed Repair)',
  golden_date_proof:
    'Golden Test Set Date-Proofing, Substituted gold_sql Execution & Multiset Comparator (/engine/goldenTests.ts & /engine/evaluationEngine.ts)',
  strict_json_parser:
    'Strict JSON Parser Suite — Fenced, Plain, Prefixed/Suffixed, Two Objects, Truncated, Empty & Blocked finishReason (/engine/responseValidator.ts)',
  history_serializer:
    'History Serializer Suite — Zero Row Values, Current Message Excluded, Original Question Pinned & Tag Escaping (/engine/historySerializer.ts)',
  request_builder:
    'Request-Builder Contract Suite — Exact XML Tags, Single Current Question & 7 System Prompt Placeholders (/engine/promptBuilder.ts)',
  session_store:
    'Session Store Suite — Pending Clarification State & Deterministic Round-3 CLARIFY -> REJECT Enforcement (/engine/sessionStore.ts)',
  stage3_engine:
    'Stage 3 Pipeline & Repair Suite — systemPrompt v6.0, inputGuard, responseValidator & 2x SQL Repair Loop',
  sql_validator: 'SQL Safety Engine Validator Suite (47 Cases — Steps 1 to 8)',
  worker_executor: 'Worker Dry Run (Step 9) & Executor (Step 10, 1000-Row Cap, Empty Result)',
  seed_report: 'Worker Trusted Seed Validation & Setup Sequence',
  date_helpers: 'Local Calendar Date Helpers (/engine/dateHelpers.ts)',
  schema_context: 'Schema Metadata, Enums, Glossary & Sensitive Columns',
  parser_smoke: 'SQLite AST Parser Smoke Test & Config Contract',
};

export const SelfTestsPanel: React.FC<SelfTestsPanelProps> = ({
  seedReport,
  testResults,
  isRunning,
  onRerunTests,
}) => {
  const totalCount = testResults.length;
  const passedCount = testResults.filter((t) => t.passed).length;
  const failedCount = totalCount - passedCount;

  const suitesOrder: TestCaseResult['suite'][] = [
    'stage5_faults',
    'golden_date_proof',
    'strict_json_parser',
    'history_serializer',
    'request_builder',
    'session_store',
    'stage3_engine',
    'sql_validator',
    'worker_executor',
    'seed_report',
    'date_helpers',
    'schema_context',
    'parser_smoke',
  ];

  return (
    <div className="space-y-6">
      {/* Header & Summary Strip */}
      <section
        aria-label="Self-Tests Summary"
        className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">
              In-Browser Self-Tests &amp; Worker Seed Report
            </h2>
            <p className="text-xs text-slate-400">
              Authoritative browser verification of the 10-step SQL Safety Engine (47 validator cases + Worker dryRun &amp; executor tests), deterministic seed guarantees, local-calendar date math, and live SQLite schema inspection. Requires no API key.
            </p>
          </div>
          <button
            type="button"
            onClick={onRerunTests}
            disabled={isRunning}
            className="inline-flex items-center gap-2 py-2 px-4 text-xs font-medium rounded-lg bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isRunning ? 'Running Checks...' : 'Re-run All Checks'}</span>
          </button>
        </div>

        {/* Summary Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800">
          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80">
            <div className="text-xs text-slate-400">Total Checks Executed</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-100">
              {totalCount}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80">
            <div className="text-xs text-slate-400">Passed</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-emerald-400">
              {passedCount}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80">
            <div className="text-xs text-slate-400">Failed</div>
            <div
              className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
                failedCount === 0 ? 'text-slate-400' : 'text-rose-400'
              }`}
            >
              {failedCount}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80">
            <div className="text-xs text-slate-400">Worker Seed &amp; Setup</div>
            <div className="mt-1 text-sm font-mono tabular-nums text-slate-200">
              {seedReport
                ? `${seedReport.completedAtMs} ms (${seedReport.wasmSource})`
                : 'Pending...'}
            </div>
          </div>
        </div>

        {/* Connection Setup Order Trace */}
        {seedReport && (
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                Worker Connection Setup Order (Anchored to Local Date:{' '}
                <strong className="font-mono text-slate-200">
                  {seedReport.generatedForDate}
                </strong>
                , Earliest Order Window:{' '}
                <strong className="font-mono text-slate-200">
                  {seedReport.earliestOrderDate}
                </strong>
                )
              </span>
              <span className="font-mono text-[11px] text-emerald-400">
                PRAGMA foreign_keys = ON · PRAGMA query_only = ON
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-300 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              {seedReport.setupSequence.map((step, index) => (
                <React.Fragment key={step}>
                  <span>{step}</span>
                  {index < seedReport.setupSequence.length - 1 && (
                    <span className="text-slate-600" aria-hidden="true">
                      &rarr;
                    </span>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Suite Tables */}
      {suitesOrder.map((suiteKey) => {
        const suiteCases = testResults.filter((t) => t.suite === suiteKey);
        if (suiteCases.length === 0) return null;
        const suiteAllPassed = suiteCases.every((c) => c.passed);

        return (
          <section
            key={suiteKey}
            aria-label={SUITE_TITLES[suiteKey]}
            className="rounded-xl border border-slate-800 bg-slate-900/70 overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <ShieldCheck
                  className={`w-4 h-4 ${
                    suiteAllPassed ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                />
                <h3 className="text-sm font-semibold text-slate-100">
                  {SUITE_TITLES[suiteKey]}
                </h3>
              </div>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                {suiteCases.filter((c) => c.passed).length} / {suiteCases.length} passed
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-slate-950/50">
                    <th className="py-2.5 px-4 w-24">Status</th>
                    <th className="py-2.5 px-4">Check / Assertion</th>
                    <th className="py-2.5 px-4">Verified Output &amp; Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {suiteCases.map((tc) => (
                    <tr
                      key={tc.id}
                      className="hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-2.5 px-4 whitespace-nowrap align-top">
                        {tc.passed ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            PASS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-rose-400">
                            <XCircle className="w-3.5 h-3.5 shrink-0" />
                            FAIL
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-200 align-top">
                        {tc.name}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-400 tabular-nums align-top break-all">
                        {tc.details}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
};
