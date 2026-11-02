import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  Database,
  FlaskConical,
  History,
  KeyRound,
  Menu,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import { GEMINI_MODEL, SQL_JS_VERSION } from './config';
import { ByokPanel } from './components/ByokPanel';
import {
  ClarificationEngineWorkspace,
  EngineDiagnosticsPanel,
  PRIMARY_EXAMPLE_QUESTIONS,
} from './components/ClarificationEngineWorkspace';
import { ContextInspector } from './components/ContextInspector';
import { EvaluationPanel } from './components/EvaluationPanel';
import { SelfTestsPanel } from './components/SelfTestsPanel';
import { Sidebar } from './components/Sidebar';
import { ValidatorPlayground } from './components/ValidatorPlayground';
import { dbClient } from './engine/dbClient';
import { GOLDEN_TEST_SUITE } from './engine/goldenTests';
import { getConnectionState, subscribeKeyStore } from './engine/keyStore';
import { getQueryHistory, subscribeQueryHistory } from './engine/queryHistory';
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
  | 'schema'
  | 'evaluation'
  | 'playground'
  | 'selftests'
  | 'context'
  | 'diagnostics';

export function App() {
  const [workspaceArea, setWorkspaceArea] = useState<WorkspaceArea>('ask');
  const [devToolTab, setDevToolTab] = useState<DevToolTab>('evaluation');
  const [showDevKeyBanner, setShowDevKeyBanner] = useState<boolean>(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);
  const [historyCount, setHistoryCount] = useState<number>(() =>
    getQueryHistory().length
  );
  const [askExternalAction, setAskExternalAction] = useState<{
    type: 'focus_ask' | 'toggle_history' | 'toggle_schema' | 'select_example';
    payload?: string;
    seq: number;
  } | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    return subscribeQueryHistory((items) => setHistoryCount(items.length));
  }, []);

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

  const initSequenceRef = useRef<number>(0);

  const initializeOrResetWorker = useCallback(
    async (isReset = false) => {
      const currentSeq = ++initSequenceRef.current;
      setIsLoading(true);
      setErrorMessage(null);
      if (isReset) {
        setSchemaContext(null);
        setSeedReport(null);
      }
      try {
        const initPayload = isReset
          ? await dbClient.reset()
          : await dbClient.init();

        if (initSequenceRef.current !== currentSeq) {
          return;
        }

        const freshSchema = await dbClient.getSchemaContext();
        if (initSequenceRef.current !== currentSeq) {
          return;
        }

        setSeedReport(initPayload.seedReport);
        setSchemaContext(freshSchema);
        await executeAllSelfTests(initPayload.seedReport, freshSchema);
      } catch (err) {
        if (initSequenceRef.current !== currentSeq) {
          return;
        }
        const msg =
          err instanceof Error
            ? err.message
            : 'Failed to initialize SQLite Web Worker.';
        setErrorMessage(msg);
        setSchemaContext(null);
        setSeedReport(null);
      } finally {
        if (initSequenceRef.current === currentSeq) {
          setIsLoading(false);
        }
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
    const currentSeq = ++initSequenceRef.current;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const refreshedSchema = await dbClient.getSchemaContext();
      if (initSequenceRef.current !== currentSeq) return;
      setSchemaContext(refreshedSchema);
      await executeAllSelfTests(seedReport, refreshedSchema);
    } catch (err) {
      if (initSequenceRef.current !== currentSeq) return;
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      if (initSequenceRef.current === currentSeq) {
        setIsLoading(false);
      }
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
        '[aria-label="Gemini API Key Connection Status"]'
      );
      if (keySection instanceof HTMLElement) {
        keySection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      setShowDevKeyBanner((prev) => !prev);
    }
  };

  const triggerAskAction = (
    type: 'focus_ask' | 'toggle_history' | 'toggle_schema' | 'select_example',
    payload?: string
  ) => {
    setWorkspaceArea('ask');
    setIsMobileNavOpen(false);
    setAskExternalAction((prev) => ({
      type,
      payload,
      seq: (prev?.seq ?? 0) + 1,
    }));
  };

  const selectDevTool = (tab: DevToolTab) => {
    setWorkspaceArea('devtools');
    setDevToolTab(tab);
    setIsMobileNavOpen(false);
  };

  const totalTestsCount = testResults.length;
  const passedTestsCount = testResults.filter((t) => t.passed).length;
  const allTestsPassed =
    totalTestsCount > 0 && passedTestsCount === totalTestsCount;
  const selfTestCountLabel = isLoading
    ? '...'
    : totalTestsCount === 0
      ? 'UNRUN'
      : `${passedTestsCount}/${totalTestsCount}`;

  const renderSidebarContent = () => (
    <div className="flex flex-col justify-between h-full gap-6">
      <div className="space-y-6">
        {workspaceArea === 'devtools' ? (
          <nav aria-label="Developer Tools Sections" className="space-y-1.5">
            <div className="label-mono mb-3">[01] NAVIGATION</div>

            <button
              type="button"
              onClick={() => selectDevTool('evaluation')}
              className={`w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                devToolTab === 'evaluation'
                  ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.04] text-[#38bdf8] font-bold'
                  : 'border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02]'
              }`}
            >
              <span>EVALUATION ({GOLDEN_TEST_SUITE.length})</span>
              <FlaskConical className="w-3.5 h-3.5 shrink-0 opacity-75" />
            </button>

            <button
              type="button"
              onClick={() => selectDevTool('playground')}
              className={`w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                devToolTab === 'playground'
                  ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.04] text-[#38bdf8] font-bold'
                  : 'border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02]'
              }`}
            >
              <span>VALIDATOR PLAYGROUND</span>
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 opacity-75" />
            </button>

            <button
              type="button"
              onClick={() => selectDevTool('selftests')}
              className={`w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                devToolTab === 'selftests'
                  ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.04] text-[#38bdf8] font-bold'
                  : 'border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02]'
              }`}
            >
              <span>SELF-TESTS ({selfTestCountLabel})</span>
              <Terminal className="w-3.5 h-3.5 shrink-0 opacity-75" />
            </button>

            <button
              type="button"
              onClick={() => selectDevTool('context')}
              className={`w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                devToolTab === 'context'
                  ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.04] text-[#38bdf8] font-bold'
                  : 'border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02]'
              }`}
            >
              <span>DATE HELPERS</span>
              <Calendar className="w-3.5 h-3.5 shrink-0 opacity-75" />
            </button>

            <button
              type="button"
              onClick={() => selectDevTool('schema')}
              className={`w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                devToolTab === 'schema'
                  ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.04] text-[#38bdf8] font-bold'
                  : 'border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02]'
              }`}
            >
              <span>SCHEMA &amp; RESET DB</span>
              <BookOpen className="w-3.5 h-3.5 shrink-0 opacity-75" />
            </button>

            <button
              type="button"
              onClick={() => selectDevTool('diagnostics')}
              className={`w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                devToolTab === 'diagnostics'
                  ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.04] text-[#38bdf8] font-bold'
                  : 'border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02]'
              }`}
            >
              <span>DIAGNOSTICS</span>
              <Activity className="w-3.5 h-3.5 shrink-0 opacity-75" />
            </button>
          </nav>
        ) : (
          <>
            <nav aria-label="Ask Data Workspace Sections" className="space-y-1.5">
              <div className="label-mono mb-3">[01] NAVIGATION</div>

              <button
                type="button"
                onClick={() => triggerAskAction('focus_ask')}
                className="w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7] bg-[#e4e4e7]/[0.04] text-[#38bdf8] font-bold flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>ASK WORKSPACE</span>
                <MessageSquareText className="w-3.5 h-3.5 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => triggerAskAction('toggle_history')}
                className="w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02] transition-colors flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>QUERY HISTORY ({historyCount})</span>
                <History className="w-3.5 h-3.5 shrink-0 opacity-75" />
              </button>

              <button
                type="button"
                onClick={() => triggerAskAction('toggle_schema')}
                className="w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02] transition-colors flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>
                  DATA REFERENCE ({schemaContext?.tables.length ?? 5})
                </span>
                <Database className="w-3.5 h-3.5 shrink-0 opacity-75" />
              </button>

              <button
                type="button"
                onClick={() => selectDevTool('evaluation')}
                className="w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02] transition-colors flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>EVALUATION ({GOLDEN_TEST_SUITE.length})</span>
                <FlaskConical className="w-3.5 h-3.5 shrink-0 opacity-75" />
              </button>

              <button
                type="button"
                onClick={() => selectDevTool('selftests')}
                className="w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02] transition-colors flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>SELF-TESTS ({selfTestCountLabel})</span>
                <Terminal className="w-3.5 h-3.5 shrink-0 opacity-75" />
              </button>
            </nav>

            <div className="space-y-2 pt-2 border-t border-[#e4e4e7]/15">
              <div className="label-mono">[02] SAMPLE QUERIES</div>
              <div className="space-y-1.5">
                {PRIMARY_EXAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => triggerAskAction('select_example', q)}
                    className="w-full text-left p-2.5 text-[11px] font-mono text-[#e4e4e7]/70 hover:text-[#38bdf8] hover:border-[#38bdf8] border border-[#e4e4e7]/15 bg-[#121216] rounded-none transition-colors leading-snug cursor-pointer"
                  >
                    &ldquo;{q}&rdquo;
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom Database & Runtime Status Block */}
      <div className="pt-4 border-t border-[#e4e4e7]/15 space-y-2">
        <div className="label-mono">DATABASE STATUS</div>
        <div className="space-y-1 font-mono text-xs text-[#e4e4e7]">
          <div>sql.js: {SQL_JS_VERSION}</div>
          <div className="truncate" title={GEMINI_MODEL}>
            Model: {GEMINI_MODEL}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] pt-0.5">
            {isLoading ? (
              <span className="text-[#38bdf8]">Self-Tests: Running...</span>
            ) : totalTestsCount === 0 ? (
              <span className="text-[#e4e4e7]/60">Self-Tests: 0/0 Unrun</span>
            ) : allTestsPassed ? (
              <span className="inline-flex items-center gap-1 text-[#4ade80]">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span>
                  {passedTestsCount}/{totalTestsCount} Self-Tests Passing
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[#f87171]">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>
                  {passedTestsCount}/{totalTestsCount} Passing
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      id="top"
      className="min-h-screen md:h-screen md:overflow-hidden grid grid-rows-[auto_1fr_auto] bg-[#0c0c0e] text-[#e4e4e7] font-sans selection:bg-[#38bdf8] selection:text-[#0c0c0e]"
    >
      {/* Top Bar: Variation 2 layout (Brand System v6.3 | ASK DATA / DEVELOPER TOOLS | API Key Status) */}
      <header className="border-b-2 border-[#e4e4e7] px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4 bg-[#0c0c0e] z-30">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsMobileNavOpen((prev) => !prev)}
            aria-expanded={isMobileNavOpen}
            aria-label="Toggle navigation menu"
            className="md:hidden p-2 rounded-none border border-[#e4e4e7]/35 bg-[#121216] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] cursor-pointer"
          >
            {isMobileNavOpen ? (
              <X className="w-4 h-4" />
            ) : (
              <Menu className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setWorkspaceArea('ask');
              setIsMobileNavOpen(false);
            }}
            className="flex items-center gap-3 text-left rounded-none shrink-0 group cursor-pointer"
          >
            <div>
              <span className="label-mono block leading-none mb-1">
                SYSTEM v6.3
              </span>
              <span className="font-syne font-extrabold text-xl sm:text-2xl tracking-tight text-[#e4e4e7] group-hover:text-[#38bdf8] transition-colors">
                VIMARSH
              </span>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-4 sm:gap-8">
          <nav
            aria-label="Main Navigation"
            className="flex items-center gap-4 sm:gap-6 font-mono text-xs uppercase tracking-wider"
          >
            <button
              type="button"
              onClick={() => {
                setWorkspaceArea('ask');
                setIsMobileNavOpen(false);
              }}
              aria-current={workspaceArea === 'ask' ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 py-1 transition-colors whitespace-nowrap cursor-pointer ${
                workspaceArea === 'ask'
                  ? 'text-[#38bdf8] font-bold border-b-2 border-[#38bdf8]'
                  : 'text-[#e4e4e7]/65 hover:text-[#e4e4e7]'
              }`}
            >
              <MessageSquareText className="w-3.5 h-3.5 hidden sm:inline" />
              <span>Ask Data</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setWorkspaceArea('devtools');
                setIsMobileNavOpen(false);
              }}
              aria-current={workspaceArea === 'devtools' ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 py-1 transition-colors whitespace-nowrap cursor-pointer ${
                workspaceArea === 'devtools'
                  ? 'text-[#38bdf8] font-bold border-b-2 border-[#38bdf8]'
                  : 'text-[#e4e4e7]/65 hover:text-[#e4e4e7]'
              }`}
            >
              <Wrench className="w-3.5 h-3.5 hidden sm:inline" />
              <span>Developer Tools</span>
            </button>
          </nav>

          <button
            type="button"
            onClick={handleTopBarKeyAction}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider rounded-none transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              connectionState.status === 'connected'
                ? 'bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8]'
                : 'border border-[#e4e4e7] bg-[#121216] text-[#e4e4e7] hover:bg-[#e4e4e7] hover:text-[#0c0c0e]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>
              {connectionState.status === 'connected'
                ? `KEY ••••${connectionState.last4}`
                : 'Connect API Key'}
            </span>
          </button>
        </div>
      </header>

      {/* Main Middle Shell: Left Sidebar + Scrollable Main Workspace */}
      <div className="min-h-0 grid grid-cols-1 md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr] md:overflow-hidden relative">
        {/* Desktop & Tablet Left Sidebar */}
        <aside
          aria-label="Workspace Navigation and Database Status"
          className="hidden md:flex md:flex-col justify-between border-r border-[#e4e4e7]/15 bg-[#0c0c0e] p-5 overflow-y-auto"
        >
          {renderSidebarContent()}
        </aside>

        {/* Mobile Collapsible Navigation Drawer */}
        {isMobileNavOpen && (
          <aside
            aria-label="Mobile Navigation Drawer"
            className="md:hidden border-b-2 border-[#e4e4e7] bg-[#121216] p-4 z-20"
          >
            {renderSidebarContent()}
          </aside>
        )}

        {/* Scrollable Primary Workspace */}
        <main className="min-h-0 md:overflow-y-auto overscroll-contain p-4 sm:p-8 lg:p-10 space-y-6">
          {/* Database Worker Initialization Error */}
          {errorMessage && (
            <section
              role="alert"
              aria-label="Database Initialization Error"
              className="rounded-none border border-[#f87171] bg-[#f87171]/10 p-5 space-y-3"
            >
              <div className="flex items-center gap-2 text-[#f87171] font-mono font-bold uppercase text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>Database Worker Initialization Failed</span>
              </div>
              <p className="text-xs text-[#f87171] font-mono break-words">
                {errorMessage}
              </p>
              <p className="text-xs text-[#e4e4e7]/70">
                Query execution remains disabled when the SQLite Web Worker cannot
                be initialized. No main-thread fallback is used.
              </p>
              <button
                type="button"
                onClick={() => void initializeOrResetWorker(false)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono font-bold uppercase tracking-wider rounded-none bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8] transition-colors cursor-pointer"
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
              isLoadingDb={isLoading}
              onResetDatabase={() => void initializeOrResetWorker(true)}
              externalAction={askExternalAction}
            />
          ) : (
            <div className="max-w-5xl mx-auto w-full space-y-6">
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
                  selfTestPassedCount={passedTestsCount}
                  selfTestTotalCount={totalTestsCount}
                  isLoadingSelfTests={isLoading}
                  onOpenSelfTests={() => selectDevTool('selftests')}
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
              ) : devToolTab === 'context' ? (
                <ContextInspector
                  schemaContext={schemaContext}
                  seedReport={seedReport}
                />
              ) : devToolTab === 'schema' ? (
                <Sidebar
                  schemaContext={schemaContext}
                  isLoading={isLoading}
                  onResetDatabase={() => void initializeOrResetWorker(true)}
                  showResetControl={true}
                />
              ) : (
                <EngineDiagnosticsPanel
                  schemaContext={schemaContext}
                  dbClient={dbClient}
                  connectionState={connectionState}
                  onOpenInAskWorkspace={() => setWorkspaceArea('ask')}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {/* Bottom Technical Status Footer */}
      <footer className="border-t border-[#e4e4e7]/15 px-4 sm:px-8 py-2 bg-[#0c0c0e] flex flex-wrap items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-widest text-[#e4e4e7]/60 z-20">
        <div className="flex flex-wrap items-center gap-3">
          <span>PROMPT: {PROMPT_VERSION.toUpperCase()}</span>
          <span aria-hidden="true" className="text-[#e4e4e7]/25">
            ·
          </span>
          <span>SQL.JS: {SQL_JS_VERSION}</span>
          <span aria-hidden="true" className="text-[#e4e4e7]/25">
            ·
          </span>
          <span>MODEL: {GEMINI_MODEL}</span>
        </div>

        <div className="flex flex-wrap items-center gap-4 tabular-nums">
          <span
            className={
              isLoading
                ? 'text-[#38bdf8]'
                : totalTestsCount === 0
                  ? 'text-[#e4e4e7]/50'
                  : allTestsPassed
                    ? 'text-[#4ade80]'
                    : 'text-[#f87171]'
            }
          >
            SELF-TESTS:{' '}
            {isLoading
              ? 'RUNNING...'
              : totalTestsCount === 0
                ? '0/0 UNRUN'
                : `${passedTestsCount}/${totalTestsCount} PASSING`}
          </span>
          <span aria-hidden="true" className="text-[#e4e4e7]/25">
            ·
          </span>
          <span className="text-[#e4e4e7]/75">
            GOLDEN SUITE: {GOLDEN_TEST_SUITE.length} CASES
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
