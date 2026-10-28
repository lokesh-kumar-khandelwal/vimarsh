import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wrench,
} from 'lucide-react';
import { GEMINI_MODEL, SQL_JS_VERSION } from './config';
import { ByokPanel } from './components/ByokPanel';
import {
  ClarificationEngineWorkspace,
  EngineDiagnosticsPanel,
} from './components/ClarificationEngineWorkspace';
import { ContextInspector } from './components/ContextInspector';
import { EvaluationPanel } from './components/EvaluationPanel';
import { SelfTestsPanel } from './components/SelfTestsPanel';
import { Sidebar } from './components/Sidebar';
import { ValidatorPlayground } from './components/ValidatorPlayground';
import { dbClient } from './engine/dbClient';
import { GOLDEN_TEST_SUITE } from './engine/goldenTests';
import { getConnectionState, subscribeKeyStore } from './engine/keyStore';
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

type WorkspaceArea = 'ask' | 'devtools';
type DevToolTab =
  | 'evaluation'
  | 'playground'
  | 'selftests'
  | 'schema'
  | 'context'
  | 'diagnostics';

export function App() {
  const [workspaceArea, setWorkspaceArea] = useState<WorkspaceArea>('ask');
  const [devToolTab, setDevToolTab] = useState<DevToolTab>('evaluation');
  const [showDevKeyBanner, setShowDevKeyBanner] = useState<boolean>(false);
  const [confirmingDbReset, setConfirmingDbReset] = useState<boolean>(false);

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
        setSchemaContext(refreshedOrInitial(freshSchema));
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

  const handleTopBarKeyAction = () => {
    if (workspaceArea === 'ask') {
      const keyInput = document.getElementById('byok-api-key-input');
      if (keyInput) {
        keyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        keyInput.focus();
        return;
      }
      const keySection = document.querySelector(
        '[aria-label="Gemini API Key Connection"]'
      );
      if (keySection instanceof HTMLElement) {
        keySection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      setShowDevKeyBanner((prev) => !prev);
    }
  };

  const handleConfirmedDbReset = () => {
    setConfirmingDbReset(false);
    void initializeOrResetWorker(true);
  };

  const passedTestsCount = testResults.filter((t) => t.passed).length;
  const allTestsPassed =
    testResults.length > 0 && passedTestsCount === testResults.length;

  return (
    <div
      id="top"
      className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans"
    >
      {/* Top Bar: 3 zones (Brand wordmark | Primary vs Developer navigation | API Key status/action) */}
      <header className="h-14 flex items-center justify-between gap-4 px-4 sm:px-6 border-b border-slate-800/90 bg-slate-950/95 sticky top-0 z-20 backdrop-blur-xs">
        <button
          type="button"
          onClick={() => setWorkspaceArea('ask')}
          className="flex items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-sky-400 rounded-xs shrink-0"
        >
          <span className="text-base font-bold tracking-tight text-slate-100">
            Vimarsh
          </span>
          <span className="hidden sm:inline-block text-xs text-slate-400 font-normal">
            Text-to-SQL Clarification Engine
          </span>
        </button>

        <nav
          aria-label="Main Navigation"
          className="flex items-center gap-2 sm:gap-4 text-xs font-medium"
        >
          <button
            type="button"
            onClick={() => setWorkspaceArea('ask')}
            aria-current={workspaceArea === 'ask' ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-sky-400 ${
              workspaceArea === 'ask'
                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <MessageSquareText className="w-3.5 h-3.5" />
            <span>Ask Data</span>
          </button>

          <button
            type="button"
            onClick={() => setWorkspaceArea('devtools')}
            aria-current={workspaceArea === 'devtools' ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-sky-400 ${
              workspaceArea === 'devtools'
                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Developer Tools</span>
          </button>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleTopBarKeyAction}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-sky-400 ${
              connectionState.status === 'connected'
                ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40'
                : 'border-sky-600/60 bg-sky-600/15 text-sky-200 hover:bg-sky-600/25'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>
              {connectionState.status === 'connected'
                ? `Key ••••${connectionState.last4}`
                : 'Connect API Key'}
            </span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Database Worker Initialization Error */}
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
              Query execution remains disabled when the SQLite Web Worker cannot
              be initialized. No main-thread fallback is used.
            </p>
            <button
              type="button"
              onClick={() => void initializeOrResetWorker(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-rose-800 text-white hover:bg-rose-700 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Worker Initialization</span>
            </button>
          </section>
        )}

        {workspaceArea === 'ask' ? (
          <ClarificationEngineWorkspace
            schemaContext={schemaContext}
            dbClient={dbClient}
            connectionState={connectionState}
            onConnectionStateChange={setConnectionState}
          />
        ) : (
          <div className="space-y-6">
            {/* Developer Tools Header & Database Reset Control */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-100 tracking-tight">
                    Developer Tools &amp; Verification Suite
                  </h1>
                  <p className="text-xs text-slate-400 mt-1">
                    Inspect the sample database schema, test the 10-step SQL
                    safety validator, run golden evaluations, and verify all
                    engine self-tests.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  {!errorMessage && testResults.length > 0 && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono tabular-nums border ${
                        allTestsPassed
                          ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300'
                          : 'border-rose-800/60 bg-rose-950/30 text-rose-300'
                      }`}
                    >
                      {allTestsPassed ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {passedTestsCount}/{testResults.length} Self-Tests
                        Passing
                      </span>
                    </span>
                  )}

                  {!confirmingDbReset && (
                    <button
                      type="button"
                      onClick={() => setConfirmingDbReset(true)}
                      disabled={isLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
                      />
                      <span>Reset Sample Database</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Explicit Confirmation Step for Database Reset */}
              {confirmingDbReset && (
                <div
                  role="alert"
                  className="rounded-lg border border-amber-700/70 bg-amber-950/40 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-2.5 text-xs text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-amber-100">
                        Recreate the in-memory sample database?
                      </span>{' '}
                      This will destroy and re-seed the SQLite Web Worker
                      database back to its initial sample state.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmingDbReset(false)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-slate-900 text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmedDbReset}
                      disabled={isLoading}
                      className="px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-600 text-slate-950 hover:bg-amber-500 disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
                    >
                      Confirm Reset
                    </button>
                  </div>
                </div>
              )}

              {/* Developer Tools Sub-Navigation */}
              <nav
                aria-label="Developer Tools Sections"
                className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-slate-800/80"
              >
                <button
                  type="button"
                  onClick={() => setDevToolTab('evaluation')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    devToolTab === 'evaluation'
                      ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  <span>Evaluation ({GOLDEN_TEST_SUITE.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDevToolTab('playground')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    devToolTab === 'playground'
                      ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Validator Playground</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDevToolTab('selftests')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    devToolTab === 'selftests'
                      ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>
                    Self-Tests ({passedTestsCount}/{testResults.length})
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setDevToolTab('schema')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    devToolTab === 'schema'
                      ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Schema &amp; Glossary</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDevToolTab('context')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    devToolTab === 'context'
                      ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Date Helpers &amp; Context</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDevToolTab('diagnostics')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    devToolTab === 'diagnostics'
                      ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Engine Trace &amp; Audit Log</span>
                </button>
              </nav>
            </div>

            {/* Optional API Key connection panel inside Developer Tools when toggled or needed for Evaluation */}
            {(showDevKeyBanner ||
              (devToolTab === 'evaluation' &&
                connectionState.status !== 'connected')) && (
              <ByokPanel
                connectionState={connectionState}
                onStateChange={setConnectionState}
                compact
              />
            )}

            {/* Active Developer Tool View */}
            {devToolTab === 'evaluation' ? (
              <EvaluationPanel
                schemaContext={schemaContext}
                dbClient={dbClient}
                connectionState={connectionState}
              />
            ) : devToolTab === 'playground' ? (
              <ValidatorPlayground
                schemaContext={schemaContext}
                dbClient={dbClient}
              />
            ) : devToolTab === 'selftests' ? (
              <SelfTestsPanel
                seedReport={seedReport}
                testResults={testResults}
                isRunning={isLoading}
                onRerunTests={() => void handleRerunSelfTests()}
              />
            ) : devToolTab === 'schema' ? (
              <Sidebar
                schemaContext={schemaContext}
                isLoading={isLoading}
                onResetDatabase={() => void initializeOrResetWorker(true)}
                showResetControl={false}
              />
            ) : devToolTab === 'context' ? (
              <ContextInspector
                schemaContext={schemaContext}
                seedReport={seedReport}
              />
            ) : (
              <EngineDiagnosticsPanel />
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
        <div>
          Vimarsh: Text-to-SQL Clarification Engine · Client-Side SQLite Web
          Worker
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums text-slate-400">
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

function refreshedOrInitial(schema: SchemaContext): SchemaContext {
  return schema;
}

export default App;
