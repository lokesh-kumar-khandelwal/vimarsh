import React from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  Database,
  FlaskConical,
  History,
  MessageSquareText,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { GEMINI_MODEL, SQL_JS_VERSION } from '../../config';
import { GOLDEN_TEST_SUITE } from '../../engine/goldenTests';
import { PRIMARY_EXAMPLE_QUESTIONS } from '../workspace/workspaceConstants';
import type { DevToolTab, WorkspaceArea } from './AppHeader';

interface AppNavigationSidebarProps {
  workspaceArea: WorkspaceArea;
  devToolTab: DevToolTab;
  onSelectDevTool: (tab: DevToolTab) => void;
  onTriggerAskAction: (
    type: 'focus_ask' | 'toggle_history' | 'toggle_schema' | 'select_example',
    payload?: string
  ) => void;
  showQueryHistory: boolean;
  showDataReference: boolean;
  historyCount: number;
  tableCount: number;
  isLoading: boolean;
  passedTestsCount: number;
  totalTestsCount: number;
}

export const AppNavigationSidebar: React.FC<AppNavigationSidebarProps> = ({
  workspaceArea,
  devToolTab,
  onSelectDevTool,
  onTriggerAskAction,
  showQueryHistory,
  showDataReference,
  historyCount,
  tableCount,
  isLoading,
  passedTestsCount,
  totalTestsCount,
}) => {
  const allTestsPassed =
    totalTestsCount > 0 && passedTestsCount === totalTestsCount;
  const selfTestCountLabel = isLoading
    ? '...'
    : totalTestsCount === 0
      ? 'UNRUN'
      : `${passedTestsCount}/${totalTestsCount}`;

  const isAskArea = workspaceArea === 'ask';
  const isHistoryActive = isAskArea && showQueryHistory;
  const isDataRefActive = isAskArea && showDataReference;
  const isAskActive = isAskArea && !showQueryHistory && !showDataReference;

  return (
    <div className="flex flex-col justify-between h-full gap-6">
      <div className="space-y-6">
        {workspaceArea === 'devtools' ? (
          <nav aria-label="Developer Tools Sections" className="space-y-1.5">
            <div className="label-mono mb-3">[01] NAVIGATION</div>

            <button
              type="button"
              onClick={() => onSelectDevTool('evaluation')}
              aria-current={devToolTab === 'evaluation' ? 'page' : undefined}
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
              onClick={() => onSelectDevTool('playground')}
              aria-current={devToolTab === 'playground' ? 'page' : undefined}
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
              onClick={() => onSelectDevTool('selftests')}
              aria-current={devToolTab === 'selftests' ? 'page' : undefined}
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
              onClick={() => onSelectDevTool('context')}
              aria-current={devToolTab === 'context' ? 'page' : undefined}
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
              onClick={() => onSelectDevTool('schema')}
              aria-current={devToolTab === 'schema' ? 'page' : undefined}
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
              onClick={() => onSelectDevTool('diagnostics')}
              aria-current={devToolTab === 'diagnostics' ? 'page' : undefined}
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
                onClick={() => onTriggerAskAction('focus_ask')}
                aria-current={isAskActive ? 'page' : undefined}
                aria-pressed={isAskActive}
                className={`w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                  isAskActive
                    ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.04] text-[#38bdf8] font-bold'
                    : 'border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02]'
                }`}
              >
                <span>ASK WORKSPACE</span>
                <MessageSquareText
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isAskActive ? 'text-[#38bdf8]' : 'opacity-75'
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => onTriggerAskAction('toggle_history')}
                aria-expanded={isHistoryActive}
                aria-pressed={isHistoryActive}
                aria-current={isHistoryActive ? 'true' : undefined}
                className={`w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                  isHistoryActive
                    ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.04] text-[#38bdf8] font-bold'
                    : 'border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02]'
                }`}
              >
                <span>QUERY HISTORY ({historyCount})</span>
                <History
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isHistoryActive ? 'text-[#38bdf8]' : 'opacity-75'
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => onTriggerAskAction('toggle_schema')}
                aria-expanded={isDataRefActive}
                aria-pressed={isDataRefActive}
                aria-current={isDataRefActive ? 'true' : undefined}
                className={`w-full text-left px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-none border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                  isDataRefActive
                    ? 'border-[#e4e4e7] bg-[#e4e4e7]/[0.04] text-[#38bdf8] font-bold'
                    : 'border-transparent text-[#e4e4e7]/65 hover:text-[#e4e4e7] hover:bg-[#e4e4e7]/[0.02]'
                }`}
              >
                <span>DATA REFERENCE ({tableCount})</span>
                <Database
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isDataRefActive ? 'text-[#38bdf8]' : 'opacity-75'
                  }`}
                />
              </button>
            </nav>

            <div className="space-y-2 pt-2 border-t border-[#e4e4e7]/15">
              <div className="label-mono">[02] SAMPLE QUERIES</div>
              <div className="space-y-1.5">
                {PRIMARY_EXAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onTriggerAskAction('select_example', q)}
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
};
