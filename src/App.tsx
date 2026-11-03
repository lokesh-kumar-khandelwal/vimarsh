import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ByokPanel } from './components/ByokPanel';
import {
  ClarificationEngineWorkspace,
  EngineDiagnosticsPanel,
} from './components/ClarificationEngineWorkspace';
import { ContextInspector } from './components/ContextInspector';
import { EvaluationPanel } from './components/EvaluationPanel';
import {
  AppHeader,
  type DevToolTab,
  type WorkspaceArea,
} from './components/layout/AppHeader';
import { AppNavigationSidebar } from './components/layout/AppNavigationSidebar';
import { AppStatusFooter } from './components/layout/AppStatusFooter';
import { SelfTestsPanel } from './components/SelfTestsPanel';
import { Sidebar } from './components/Sidebar';
import { ValidatorPlayground } from './components/ValidatorPlayground';
import type { WorkspaceExternalAction } from './components/workspace/workspaceConstants';
import { dbClient } from './engine/dbClient';
import { getConnectionState, subscribeKeyStore } from './engine/keyStore';
import { getQueryHistory, subscribeQueryHistory } from './engine/queryHistory';
import { useDatabaseLifecycle } from './hooks/useDatabaseLifecycle';
import type { ByokConnectionState } from './types';

export function App() {
  const [workspaceArea, setWorkspaceArea] = useState<WorkspaceArea>('ask');
  const [devToolTab, setDevToolTab] = useState<DevToolTab>('evaluation');
  const [showDevKeyBanner, setShowDevKeyBanner] = useState<boolean>(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);
  const [historyCount, setHistoryCount] = useState<number>(() =>
    getQueryHistory().length
  );
  const [showQueryHistory, setShowQueryHistory] = useState<boolean>(false);
  const [showDataReference, setShowDataReference] = useState<boolean>(false);
  const [askExternalAction, setAskExternalAction] =
    useState<WorkspaceExternalAction | null>(null);

  const [connectionState, setConnectionState] = useState<ByokConnectionState>(
    () => getConnectionState()
  );

  const {
    isLoading,
    errorMessage,
    seedReport,
    schemaContext,
    testResults,
    initializeOrResetWorker,
    handleRerunSelfTests,
  } = useDatabaseLifecycle();

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    return subscribeQueryHistory((items) => setHistoryCount(items.length));
  }, []);

  useEffect(() => {
    return subscribeKeyStore(setConnectionState);
  }, []);

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

  const selectAskWorkspace = () => {
    setWorkspaceArea('ask');
    setShowQueryHistory(false);
    setShowDataReference(false);
    setIsMobileNavOpen(false);
    setAskExternalAction((prev) => ({
      type: 'focus_ask',
      seq: (prev?.seq ?? 0) + 1,
    }));
  };

  const toggleQueryHistory = () => {
    setWorkspaceArea('ask');
    setIsMobileNavOpen(false);
    setShowDataReference(false);
    setShowQueryHistory((prev) => !prev);
  };

  const toggleDataReference = () => {
    setWorkspaceArea('ask');
    setIsMobileNavOpen(false);
    setShowQueryHistory(false);
    setShowDataReference((prev) => !prev);
  };

  const triggerAskAction = (
    type: 'focus_ask' | 'toggle_history' | 'toggle_schema' | 'select_example',
    payload?: string
  ) => {
    setWorkspaceArea('ask');
    setIsMobileNavOpen(false);

    if (type === 'focus_ask') {
      selectAskWorkspace();
    } else if (type === 'toggle_history') {
      toggleQueryHistory();
    } else if (type === 'toggle_schema') {
      toggleDataReference();
    } else if (type === 'select_example' && payload) {
      setAskExternalAction((prev) => ({
        type: 'select_example',
        payload,
        seq: (prev?.seq ?? 0) + 1,
      }));
    }
  };

  const selectDevTool = (tab: DevToolTab) => {
    setWorkspaceArea('devtools');
    setDevToolTab(tab);
    setIsMobileNavOpen(false);
  };

  const totalTestsCount = testResults.length;
  const passedTestsCount = testResults.filter((t) => t.passed).length;

  return (
    <div
      id="top"
      className="min-h-screen md:h-screen md:overflow-hidden grid grid-rows-[auto_1fr_auto] bg-[#0c0c0e] text-[#e4e4e7] font-sans selection:bg-[#38bdf8] selection:text-[#0c0c0e]"
    >
      <AppHeader
        workspaceArea={workspaceArea}
        onSelectWorkspaceArea={(area) => {
          setWorkspaceArea(area);
          if (area === 'ask') {
            setShowQueryHistory(false);
            setShowDataReference(false);
          }
          setIsMobileNavOpen(false);
        }}
        isMobileNavOpen={isMobileNavOpen}
        onToggleMobileNav={() => setIsMobileNavOpen((prev) => !prev)}
        connectionState={connectionState}
        onTopBarKeyAction={handleTopBarKeyAction}
      />

      {/* Main Middle Shell: Left Sidebar + Scrollable Main Workspace */}
      <div className="min-h-0 grid grid-cols-1 md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr] md:overflow-hidden relative">
        {/* Desktop & Tablet Left Sidebar */}
        <aside
          aria-label="Workspace Navigation and Database Status"
          className="hidden md:flex md:flex-col justify-between border-r border-[#e4e4e7]/15 bg-[#0c0c0e] p-5 overflow-y-auto"
        >
          <AppNavigationSidebar
            workspaceArea={workspaceArea}
            devToolTab={devToolTab}
            onSelectDevTool={selectDevTool}
            onTriggerAskAction={triggerAskAction}
            showQueryHistory={showQueryHistory}
            showDataReference={showDataReference}
            historyCount={historyCount}
            tableCount={schemaContext?.tables.length ?? 5}
            isLoading={isLoading}
            passedTestsCount={passedTestsCount}
            totalTestsCount={totalTestsCount}
          />
        </aside>

        {/* Mobile Collapsible Navigation Drawer */}
        {isMobileNavOpen && (
          <aside
            aria-label="Mobile Navigation Drawer"
            className="md:hidden border-b-2 border-[#e4e4e7] bg-[#121216] p-4 z-20"
          >
            <AppNavigationSidebar
              workspaceArea={workspaceArea}
              devToolTab={devToolTab}
              onSelectDevTool={selectDevTool}
              onTriggerAskAction={triggerAskAction}
              showQueryHistory={showQueryHistory}
              showDataReference={showDataReference}
              historyCount={historyCount}
              tableCount={schemaContext?.tables.length ?? 5}
              isLoading={isLoading}
              passedTestsCount={passedTestsCount}
              totalTestsCount={totalTestsCount}
            />
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
                Query execution remains disabled when the SQLite Web Worker
                cannot be initialized. No main-thread fallback is used.
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
              showQueryHistory={showQueryHistory}
              onToggleQueryHistory={toggleQueryHistory}
              showDataReference={showDataReference}
              onToggleDataReference={toggleDataReference}
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

      <AppStatusFooter
        isLoading={isLoading}
        passedTestsCount={passedTestsCount}
        totalTestsCount={totalTestsCount}
      />
    </div>
  );
}

export default App;
