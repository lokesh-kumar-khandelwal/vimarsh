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
        className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-5 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <span className="label-mono text-[#38bdf8] block">
              IN-BROWSER VERIFICATION HARNESS
            </span>
            <h2 className="font-syne font-extrabold text-2xl uppercase tracking-tight text-[#e4e4e7]">
              SELF-TESTS &amp; WORKER SEED REPORT
            </h2>
            <p className="text-xs text-[#e4e4e7]/65 max-w-3xl leading-relaxed">
              Authoritative browser verification of the 10-step SQL Safety Engine (47 validator cases + Worker dryRun &amp; executor tests), deterministic seed guarantees, local-calendar date math, and live SQLite schema inspection. Requires no API key.
            </p>
          </div>
          <button
            type="button"
            onClick={onRerunTests}
            disabled={isRunning}
            className="inline-flex items-center gap-2 py-2 px-4 text-xs font-mono font-bold uppercase tracking-wider rounded-none bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isRunning ? 'Running Checks...' : 'Re-run All Checks'}</span>
          </button>
        </div>

        {/* Summary Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#e4e4e7]/15 border border-[#e4e4e7]/15 bg-[#0c0c0e]">
          <div className="p-4">
            <div className="label-mono">Total Checks Executed</div>
            <div className="mt-1 font-syne font-extrabold text-2xl tabular-nums text-[#e4e4e7]">
              {isRunning ? '...' : totalCount}
            </div>
          </div>
          <div className="p-4">
            <div className="label-mono">Passed</div>
            <div className="mt-1 font-syne font-extrabold text-2xl tabular-nums text-[#4ade80]">
              {isRunning ? '...' : passedCount}
            </div>
          </div>
          <div className="p-4">
            <div className="label-mono">Failed</div>
            <div
              className={`mt-1 font-syne font-extrabold text-2xl tabular-nums ${
                failedCount === 0 ? 'text-[#e4e4e7]/50' : 'text-[#f87171]'
              }`}
            >
              {isRunning ? '...' : failedCount}
            </div>
          </div>
          <div className="p-4">
            <div className="label-mono">Worker Seed &amp; Setup</div>
            <div className="mt-2 text-xs font-mono tabular-nums text-[#38bdf8]">
              {seedReport
                ? `${seedReport.completedAtMs} ms (${seedReport.wasmSource})`
                : 'Pending...'}
            </div>
          </div>
        </div>

        {/* Connection Setup Order Trace */}
        {seedReport && (
          <div className="pt-3 border-t border-[#e4e4e7]/15 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#e4e4e7]/65">
              <span>
                Worker Connection Setup Order (Anchored to Local Date:{' '}
                <strong className="font-mono text-[#e4e4e7]">
                  {seedReport.generatedForDate}
                </strong>
                , Earliest Order Window:{' '}
                <strong className="font-mono text-[#e4e4e7]">
                  {seedReport.earliestOrderDate}
                </strong>
                )
              </span>
              <span className="font-mono text-[11px] text-[#4ade80] font-bold">
                PRAGMA foreign_keys = ON · PRAGMA query_only = ON
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[#38bdf8] bg-[#0c0c0e] p-2.5 rounded-none border border-[#e4e4e7]/15">
              {seedReport.setupSequence.map((step, index) => (
                <React.Fragment key={step}>
                  <span>{step}</span>
                  {index < seedReport.setupSequence.length - 1 && (
                    <span className="text-[#e4e4e7]/40" aria-hidden="true">
                      &rarr;
                    </span>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Unrun State Notice */}
      {!isRunning && totalCount === 0 && (
        <section className="rounded-none border border-[#e4e4e7]/20 bg-[#121216] p-6 text-center space-y-2">
          <p className="font-mono text-xs uppercase tracking-wider text-[#e4e4e7]/70">
            Self-test suites have not been executed yet.
          </p>
          <p className="text-xs text-[#e4e4e7]/50">
            Click &ldquo;Re-run All Checks&rdquo; above to run all in-browser verification suites.
          </p>
        </section>
      )}

      {/* Suite Tables */}
      {suitesOrder.map((suiteKey) => {
        const suiteCases = testResults.filter((t) => t.suite === suiteKey);
        if (suiteCases.length === 0) return null;
        const suiteAllPassed = suiteCases.every((c) => c.passed);

        return (
          <section
            key={suiteKey}
            aria-label={SUITE_TITLES[suiteKey]}
            className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-[#e4e4e7]/15 bg-[#121216] flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <ShieldCheck
                  className={`w-4 h-4 shrink-0 ${
                    suiteAllPassed ? 'text-[#4ade80]' : 'text-[#f87171]'
                  }`}
                />
                <h3 className="text-xs font-mono font-bold text-[#e4e4e7]">
                  {SUITE_TITLES[suiteKey]}
                </h3>
              </div>
              <span
                className={`font-mono text-xs font-bold tabular-nums shrink-0 ${
                  suiteAllPassed ? 'text-[#4ade80]' : 'text-[#f87171]'
                }`}
              >
                {suiteCases.filter((c) => c.passed).length} / {suiteCases.length} passed
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#e4e4e7]/15 text-[10px] font-mono uppercase tracking-widest text-[#e4e4e7]/60 bg-[#0c0c0e]">
                    <th className="py-2.5 px-4 w-24">STATUS</th>
                    <th className="py-2.5 px-4">CHECK / ASSERTION</th>
                    <th className="py-2.5 px-4">VERIFIED OUTPUT &amp; DETAILS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e4e7]/10 text-xs">
                  {suiteCases.map((tc) => (
                    <tr
                      key={tc.id}
                      className="hover:bg-[#e4e4e7]/[0.03] transition-colors"
                    >
                      <td className="py-2.5 px-4 whitespace-nowrap align-top">
                        {tc.passed ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-[#4ade80]">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            PASS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-[#f87171]">
                            <XCircle className="w-3.5 h-3.5 shrink-0" />
                            FAIL
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-[#e4e4e7] align-top">
                        {tc.name}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-[#e4e4e7]/65 tabular-nums align-top break-all">
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
