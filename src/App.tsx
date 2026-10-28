import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  RefreshCw,
} from 'lucide-react';
import { GEMINI_MODEL, SQL_JS_VERSION } from './config';
import { ByokPanel } from './components/ByokPanel';
import { ClarificationEngineWorkspace } from './components/ClarificationEngineWorkspace';
import { ContextInspector } from './components/ContextInspector';
import { EvaluationPanel } from './components/EvaluationPanel';
import { SelfTestsPanel } from './components/SelfTestsPanel';
import { Sidebar } from './components/Sidebar';
import { ValidatorPlayground } from './components/ValidatorPlayground';
import { dbClient } from './engine/dbClient';
import { GOLDEN_TEST_SUITE } from './engine/goldenTests';
import {
  getConnectionState,
  subscribeKeyStore,
} from './engine/keyStore';
import { PROMPT_VERSION } from './engine/systemPrompt';
import {
  runExecutorAndDryRunTestCases,
  runSqlValidatorTestCases,
} from './tests/cases/sqlValidatorCases';
import {
  runDateHelpersTestCases,
  runSchemaAndContextTestCases,
  runSeedReportTestCases,
  runStage1GuardAndParserTestCases,
} from './tests/cases/stage1Cases';
import { runStage3EngineTestCases } from './tests/cases/stage3Cases';
import {
  runGoldenSetAndComparatorTestCases,
  runHistorySerializerTestCases,
  runRequestBuilderContractTestCases,
  runSessionStoreTestCases,
  runStrictJsonParserTestCases,
} from './tests/cases/stage4Cases';
import { runStage5FaultScenarioTestCases } from './tests/cases/stage5FaultCases';
import type {
  ByokConnectionState,
  SchemaContext,
  SeedReport,
  TestCaseResult,
} from './types';

export function App() {
  const [activeTab, setActiveTab] = useState<
    'engine' | 'evaluation' | 'playground' | 'selftests' | 'context'
  >('engine');
  const [showKeySettingsModal, setShowKeySettingsModal] =
    useState<boolean>(false);
  const [connectionState, setConnectionState] = useState<ByokConnectionState>(
    () => getConnectionState()
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [seedReport, setSeedReport] = useState<SeedReport | null>(null);
  const [schemaContext, setSchemaContext] = useState<SchemaContext | null>(null);
  const [testResults, setTestResults] = useState<TestCaseResult[]>([]);

  useEffect(() => {
    return subscribeKeyStore(setConnectionState);
  }, []);

  const executeAllSelfTests = useCallback(
    async (report: SeedReport, schema: SchemaContext) => {
      const runner = {
        dryRun: (sql: import('./types').ValidatedSql) => dbClient.dryRun(sql),
        execute: (sql: import('./types').ValidatedSql) => dbClient.execute(sql),
      };
      const faultCases = await runStage5FaultScenarioTestCases(schema, {
        seedReport: report,
        schemaContext: schema,
      });
      const goldenCases = await runGoldenSetAndComparatorTestCases(
        schema,
        runner
      );
      const strictJsonCases = runStrictJsonParserTestCases();
      const historyCases = runHistorySerializerTestCases();
      const requestBuilderCases = runRequestBuilderContractTestCases(schema);
      const sessionCases = runSessionStoreTestCases();
      const stage3Cases = await runStage3EngineTestCases(schema, runner);
      const validatorCases = runSqlValidatorTestCases(schema);
      const execCases = await runExecutorAndDryRunTestCases(schema, runner);
      const seedCases = runSeedReportTestCases(report);
      const dateCases = runDateHelpersTestCases();
      const schemaCases = runSchemaAndContextTestCases(schema);
      const parserCases = await runStage1GuardAndParserTestCases();
      setTestResults([
        ...faultCases,
        ...goldenCases,
        ...strictJsonCases,
        ...historyCases,
        ...requestBuilderCases,
        ...sessionCases,
        ...stage3Cases,
        ...validatorCases,
        ...execCases,
        ...seedCases,
        ...dateCases,
        ...schemaCases,
        ...parserCases,
      ]);
    },
    []
  );

  const initializeOrResetWorker = useCallback(
    async (isReset = false) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const initPayload = isReset
          ? await dbClient.reset()
          : await dbClient.init();
        const freshSchema = await dbClient.getSchemaContext();
        setSeedReport(initPayload.seedReport);
        setSchemaContext(freshSchema);
        await executeAllSelfTests(initPayload.seedReport, freshSchema);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Failed to initialize SQLite Web Worker.';
        setErrorMessage(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [executeAllSelfTests]
  );

  useEffect(() => {
    void initializeOrResetWorker(false);
  }, [initializeOrResetWorker]);

  const handleRerunSelfTests = useCallback(async () => {
    if (!seedReport || !schemaContext) {
      await initializeOrResetWorker(false);
      return;
    }
    setIsLoading(true);
    try {
      const refreshedSchema = await dbClient.getSchemaContext();
      setSchemaContext(refreshedSchema);
      await executeAllSelfTests(seedReport, refreshedSchema);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [seedReport, schemaContext, executeAllSelfTests, initializeOrResetWorker]);

  const allTestsPassed =
    testResults.length > 0 && testResults.every((t) => t.passed);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans">
      {/* Top Bar Contract: 3 zones (Brand wordmark | Navigation links | Primary action) */}
      <header className="h-14 flex items-center justify-between gap-6 px-6 border-b border-slate-800 bg-slate-950/90 sticky top-0 z-20">
        <a
          href="#top"
          className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-400 rounded-xs"
        >
          Vimarsh
        </a>

        <nav
          aria-label="Primary Workspace Views"
          className="flex items-center gap-5 text-xs font-medium text-slate-400 overflow-x-auto"
        >
          <button
            type="button"
            onClick={() => setActiveTab('engine')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              activeTab === 'engine'
                ? 'border-sky-400 text-slate-100'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Clarification Engine
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('evaluation')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              activeTab === 'evaluation'
                ? 'border-sky-400 text-slate-100'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Evaluation ({GOLDEN_TEST_SUITE.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('playground')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              activeTab === 'playground'
                ? 'border-sky-400 text-slate-100'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Validator Playground
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('selftests')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              activeTab === 'selftests'
                ? 'border-sky-400 text-slate-100'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Self-Tests ({testResults.filter((t) => t.passed).length}/
            {testResults.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('context')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              activeTab === 'context'
                ? 'border-sky-400 text-slate-100'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Date Helpers &amp; Context
          </button>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowKeySettingsModal((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              connectionState.status === 'connected'
                ? 'border-emerald-700/80 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40'
                : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>
              {connectionState.status === 'connected'
                ? `Key ••••${connectionState.last4}`
                : 'API Key Settings'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void initializeOrResetWorker(true)}
            disabled={isLoading}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Reset Database
          </button>
        </div>
      </header>

      {/* Main Layout: Left Sidebar + Center Viewport */}
      <div className="flex-1 flex flex-col lg:flex-row">
        <Sidebar
          schemaContext={schemaContext}
          isLoading={isLoading}
          onResetDatabase={() => void initializeOrResetWorker(true)}
        />

        <main className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full space-y-6">
          {/* Header Settings BYOK Drawer (when toggled outside Engine tab) */}
          {showKeySettingsModal && activeTab !== 'engine' && (
            <ByokPanel
              connectionState={connectionState}
              onStateChange={setConnectionState}
              compact
            />
          )}

          {/* Tagline & Stage 4 Status Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <h1 className="text-xl font-bold text-slate-100 tracking-tight">
                Vimarsh: Text-to-SQL Clarification Engine
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Think before you query. · Stage 4: Full Clarification Chat UI,
                Auto-Chart, 32 Date-Proof Golden Tests, Multiset Comparator &amp;
                Evaluation Metrics
              </p>
            </div>
            {!errorMessage && testResults.length > 0 && (
              <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                {allTestsPassed ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {testResults.length}/{testResults.length} Self-Tests
                      Passing
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-rose-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Self-Test Failures Detected</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Error Card if Worker or WASM fails to load */}
          {errorMessage && (
            <section
              role="alert"
              aria-label="Database Initialization Error"
              className="rounded-xl border border-rose-800 bg-rose-950/40 p-5 space-y-3"
            >
              <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>Database Worker Initialization Failed</span>
              </div>
              <p className="text-xs text-rose-200/90 font-mono break-words">
                {errorMessage}
              </p>
              <p className="text-xs text-slate-300">
                Query execution remains disabled when the SQLite Web Worker
                cannot be initialized. No main-thread fallback is used.
              </p>
              <button
                type="button"
                onClick={() => void initializeOrResetWorker(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-rose-800 text-white hover:bg-rose-700 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Worker Initialization</span>
              </button>
            </section>
          )}

          {/* Active Workspace View */}
          {activeTab === 'engine' ? (
            <ClarificationEngineWorkspace
              schemaContext={schemaContext}
              dbClient={dbClient}
              connectionState={connectionState}
              onConnectionStateChange={setConnectionState}
            />
          ) : activeTab === 'evaluation' ? (
            <EvaluationPanel
              schemaContext={schemaContext}
              dbClient={dbClient}
              connectionState={connectionState}
            />
          ) : activeTab === 'playground' ? (
            <ValidatorPlayground
              schemaContext={schemaContext}
              dbClient={dbClient}
            />
          ) : activeTab === 'selftests' ? (
            <SelfTestsPanel
              seedReport={seedReport}
              testResults={testResults}
              isRunning={isLoading}
              onRerunTests={() => void handleRerunSelfTests()}
            />
          ) : (
            <ContextInspector
              schemaContext={schemaContext}
              seedReport={seedReport}
            />
          )}
        </main>
      </div>

      {/* Footer with PROMPT_VERSION */}
      <footer className="border-t border-slate-800 bg-slate-950 px-6 py-3 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
        <div>
          Vimarsh Text-to-SQL Clarification Engine · Browser-Only Prototype
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
          <span>PROMPT_VERSION: {PROMPT_VERSION}</span>
          <span aria-hidden="true">·</span>
          <span>MODEL: {GEMINI_MODEL}</span>
          <span aria-hidden="true">·</span>
          <span>sql.js: {SQL_JS_VERSION}</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
