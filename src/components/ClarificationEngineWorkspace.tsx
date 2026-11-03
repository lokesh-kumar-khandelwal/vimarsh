import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { DbClient } from '../engine/dbClient';
import { runInputGuard } from '../engine/inputGuard';
import {
  getQueryHistory,
  recordQueryExecution,
  subscribeQueryHistory,
} from '../engine/queryHistory';
import { runQuestionPipeline } from '../engine/queryPipeline';
import { sessionStore } from '../engine/sessionStore';
import type {
  ByokConnectionState,
  SchemaContext,
  SessionState,
} from '../types';
import { getScrollBehavior, scrollToTarget } from '../utils/autoScroll';
import { ByokPanel } from './ByokPanel';
import { QueryHistoryPanel } from './QueryHistoryPanel';
import { Sidebar } from './Sidebar';
import { ConversationTimeline } from './workspace/ConversationTimeline';
import { QuestionInputSection } from './workspace/QuestionInputSection';
import type { WorkspaceExternalAction } from './workspace/workspaceConstants';

export {
  DEVELOPER_DIAGNOSTIC_EXAMPLES,
  PRIMARY_EXAMPLE_QUESTIONS,
  type DiagnosticStarterQuestion,
} from './workspace/workspaceConstants';
export { EngineDiagnosticsPanel } from './EngineDiagnosticsPanel';

interface ClarificationEngineWorkspaceProps {
  schemaContext: SchemaContext | null;
  dbClient: DbClient;
  connectionState: ByokConnectionState;
  onConnectionStateChange: (next: ByokConnectionState) => void;
  isLoadingDb?: boolean;
  onResetDatabase: () => void;
  externalAction?: WorkspaceExternalAction | null;
  showQueryHistory: boolean;
  onToggleQueryHistory: () => void;
  showDataReference: boolean;
  onToggleDataReference: () => void;
}

export const ClarificationEngineWorkspace: React.FC<
  ClarificationEngineWorkspaceProps
> = ({
  schemaContext,
  dbClient,
  connectionState,
  onConnectionStateChange,
  isLoadingDb = false,
  onResetDatabase,
  externalAction,
  showQueryHistory,
  onToggleQueryHistory,
  showDataReference,
  onToggleDataReference,
}) => {
  const [sessionState, setSessionState] = useState<SessionState>(() =>
    sessionStore.getState()
  );
  const [questionInput, setQuestionInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submittingQuestion, setSubmittingQuestion] = useState<string | null>(
    null
  );
  const [inputFeedback, setInputFeedback] = useState<string | null>(null);

  const [historyCount, setHistoryCount] = useState<number>(() =>
    getQueryHistory().length
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const questionInputRef = useRef<HTMLInputElement | null>(null);
  const loadingBannerRef = useRef<HTMLElement | null>(null);
  const latestTurnRef = useRef<HTMLElement | null>(null);
  const latestResponseRef = useRef<HTMLElement | null>(null);
  const pendingAutoScrollRef = useRef<'loading' | 'response' | null>(null);
  const lastExternalSeqRef = useRef<number>(0);

  const historyPanelRef = useRef<HTMLDivElement | null>(null);
  const dataRefPanelRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll effect 1: Smoothly bring the loading banner into view when a question is submitted
  useEffect(() => {
    if (isSubmitting && pendingAutoScrollRef.current === 'loading') {
      const rafId = requestAnimationFrame(() => {
        scrollToTarget(loadingBannerRef.current, 'start');
      });
      pendingAutoScrollRef.current = 'response';
      return () => cancelAnimationFrame(rafId);
    }
  }, [isSubmitting]);

  // Auto-scroll effect 2: Smoothly bring the newly rendered response and question into view
  useEffect(() => {
    if (!isSubmitting && pendingAutoScrollRef.current === 'response') {
      pendingAutoScrollRef.current = null;
      setSubmittingQuestion(null);
      let innerRafId: number;
      const outerRafId = requestAnimationFrame(() => {
        innerRafId = requestAnimationFrame(() => {
          const target = latestTurnRef.current ?? latestResponseRef.current;
          scrollToTarget(target, 'start');
        });
      });
      return () => {
        cancelAnimationFrame(outerRafId);
        if (innerRafId) cancelAnimationFrame(innerRafId);
      };
    }
  }, [sessionState.turns.length, isSubmitting]);

  // Auto-scroll effect 3: Smoothly bring Query History into view when opened
  useEffect(() => {
    if (showQueryHistory && historyPanelRef.current) {
      const rafId = requestAnimationFrame(() => {
        scrollToTarget(historyPanelRef.current, 'start');
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [showQueryHistory]);

  // Auto-scroll effect 4: Smoothly bring Data Reference into view when opened
  useEffect(() => {
    if (showDataReference && dataRefPanelRef.current) {
      const rafId = requestAnimationFrame(() => {
        scrollToTarget(dataRefPanelRef.current, 'start');
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [showDataReference]);

  useEffect(() => {
    const unsubSession = sessionStore.subscribe(setSessionState);
    return () => {
      unsubSession();
    };
  }, []);

  useEffect(() => {
    return subscribeQueryHistory((h) => setHistoryCount(h.length));
  }, []);

  // Seed history from any existing session turns if queryHistory is currently empty
  useEffect(() => {
    const existing = getQueryHistory();
    if (existing.length === 0 && sessionState.turns.length > 0) {
      for (let i = 0; i < sessionState.turns.length; i++) {
        const turn = sessionState.turns[i];
        if (
          turn.role === 'assistant' &&
          turn.response.status === 'SUCCESS' &&
          turn.response.sql_query
        ) {
          const prevUser =
            i > 0 && sessionState.turns[i - 1]?.role === 'user'
              ? (sessionState.turns[i - 1] as { question: string })
              : null;
          recordQueryExecution({
            question: prevUser?.question ?? 'Executed SQL query',
            sql: turn.response.sql_query,
            rowCount: turn.executionResult?.rowCount ?? 0,
            executionTimeMs: turn.executionResult?.executionTimeMs ?? 0,
            tablesUsed: turn.validatedTablesUsed ?? [],
            status: 'SUCCESS',
            timestamp: turn.timestamp,
          });
        }
      }
    }
  }, [sessionState.turns]);

  const handleLoadQuestionFromHistory = (question: string) => {
    setQuestionInput(question);
    setInputFeedback(null);
    questionInputRef.current?.scrollIntoView({
      behavior: getScrollBehavior(),
      block: 'center',
    });
    setTimeout(() => {
      questionInputRef.current?.focus();
    }, 50);
  };

  const isConnected = connectionState.status === 'connected';

  const handleAskQuestion = async (rawText: string) => {
    if (!schemaContext || isSubmitting) return;
    const trimmed = rawText.trim();
    if (!trimmed) return;

    // Check if the input can be handled offline by inputGuard even when disconnected
    const guardPreview = runInputGuard(trimmed);
    if (!isConnected && guardPreview.allowed) {
      setQuestionInput(trimmed);
      setInputFeedback(
        'Connect your Gemini API key above to run this question.'
      );
      document.getElementById('byok-api-key-input')?.focus();
      return;
    }

    setInputFeedback(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setSubmittingQuestion(trimmed);
    pendingAutoScrollRef.current = 'loading';
    setIsSubmitting(true);
    setQuestionInput('');

    try {
      await runQuestionPipeline({
        rawQuestion: trimmed,
        schemaContext,
        dbRunner: {
          dryRun: (sql) => dbClient.dryRun(sql),
          execute: (sql) => dbClient.execute(sql),
        },
        abortSignal: controller.signal,
      });
    } finally {
      abortControllerRef.current = null;
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleSelectExample = (exampleQuestion: string) => {
    if (isSubmitting) return;
    if (isConnected) {
      void handleAskQuestion(exampleQuestion);
    } else {
      setQuestionInput(exampleQuestion);
      setInputFeedback(
        'Example loaded into the question box. Connect your Gemini API key above, then click Ask Vimarsh.'
      );
      questionInputRef.current?.focus();
    }
  };

  // Handle sidebar quick actions from App shell
  useEffect(() => {
    if (!externalAction || externalAction.seq === lastExternalSeqRef.current) {
      return;
    }
    lastExternalSeqRef.current = externalAction.seq;
    if (externalAction.type === 'focus_ask') {
      questionInputRef.current?.scrollIntoView({
        behavior: getScrollBehavior(),
        block: 'center',
      });
      questionInputRef.current?.focus();
    } else if (
      externalAction.type === 'select_example' &&
      externalAction.payload
    ) {
      handleSelectExample(externalAction.payload);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalAction]);

  return (
    <div className="max-w-4xl mx-auto w-full space-y-6">
      {/* Primary Workspace Heading & Supporting Description */}
      <header className="space-y-2">
        <span className="label-mono text-[#38bdf8] block">
          NATURAL-LANGUAGE CLARIFICATION WORKSPACE
        </span>
        <h1 className="font-syne font-extrabold text-3xl sm:text-4xl uppercase text-[#e4e4e7] tracking-tight leading-[0.95]">
          ASK QUESTIONS ABOUT YOUR DATA
        </h1>
        <p className="text-xs sm:text-sm text-[#e4e4e7]/65 leading-relaxed max-w-2xl">
          Ask in plain English. Vimarsh checks your question, clarifies ambiguity
          when necessary, and safely retrieves results from the sample database.
        </p>
        <p className="text-[11px] font-mono text-[#e4e4e7]/50 uppercase tracking-wider">
          Ask a question &rarr; clarify if needed &rarr; review your results.
        </p>
      </header>

      {/* API-Key Connection Setup / Status Bar */}
      <ByokPanel
        connectionState={connectionState}
        onStateChange={(next) => {
          onConnectionStateChange(next);
          if (next.status === 'connected') {
            setInputFeedback(null);
          }
        }}
      />

      {/* Primary Question Input & Three User-Friendly Example Questions */}
      <QuestionInputSection
        questionInput={questionInput}
        onQuestionInputChange={(val) => {
          setQuestionInput(val);
          if (inputFeedback) setInputFeedback(null);
        }}
        onSubmitQuestion={(q) => void handleAskQuestion(q)}
        onSelectExample={handleSelectExample}
        onStartNewQuestion={() => sessionStore.startNewQuestion()}
        onClearConversation={() => {
          sessionStore.clearAll();
          setInputFeedback(null);
        }}
        pendingClarification={sessionState.pending}
        hasTurns={sessionState.turns.length > 0}
        isSubmitting={isSubmitting}
        schemaContext={schemaContext}
        inputFeedback={inputFeedback}
        showQueryHistory={showQueryHistory}
        onToggleQueryHistory={onToggleQueryHistory}
        historyCount={historyCount}
        showDataReference={showDataReference}
        onToggleDataReference={onToggleDataReference}
        questionInputRef={questionInputRef}
      />

      {/* Query History Panel (Stores & Displays Recent SQL Queries, with Direct Re-run) */}
      {showQueryHistory && (
        <div ref={historyPanelRef} className="scroll-mt-20">
          <QueryHistoryPanel
            dbClient={dbClient}
            onLoadQuestion={handleLoadQuestionFromHistory}
            isOpen={true}
            onClose={onToggleQueryHistory}
          />
        </div>
      )}

      {/* Collapsible Data Reference (Schema, Join Hints & Business Glossary) */}
      {showDataReference && (
        <div ref={dataRefPanelRef} className="scroll-mt-20">
          <Sidebar
            schemaContext={schemaContext}
            isLoading={isLoadingDb}
            onResetDatabase={onResetDatabase}
            showResetControl={false}
            onClose={onToggleDataReference}
          />
        </div>
      )}

      {/* Query Interaction & Results Timeline */}
      <ConversationTimeline
        turns={sessionState.turns}
        isConnected={isConnected}
        isSubmitting={isSubmitting}
        onAskQuestion={(q) => void handleAskQuestion(q)}
        onEditQuestion={(q) => {
          if (q) {
            setQuestionInput(q);
          }
          questionInputRef.current?.focus();
        }}
        latestTurnRef={latestTurnRef}
        latestResponseRef={latestResponseRef}
      />

      {/* Loading State Banner */}
      {isSubmitting && (
        <section
          ref={loadingBannerRef}
          role="status"
          aria-live="polite"
          aria-label="Checking question and preparing query"
          className="rounded-none border border-[#38bdf8] bg-[#121216] p-5 flex flex-wrap items-center justify-between gap-4 scroll-mt-20"
        >
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-[#38bdf8] animate-spin shrink-0" />
            <div className="space-y-0.5">
              <p className="text-sm font-mono font-bold text-[#e4e4e7]">
                Checking your question and preparing the query...
              </p>
              {submittingQuestion && (
                <p className="text-xs text-[#38bdf8] font-mono whitespace-pre-wrap break-words">
                  &ldquo;{submittingQuestion}&rdquo;
                </p>
              )}
              <p className="text-xs text-[#e4e4e7]/65">
                Validating against schema rules, checking for ambiguity, and
                verifying read-only SQL safety.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCancelRequest}
            className="px-3.5 py-1.5 text-xs font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/40 bg-[#0c0c0e] text-[#e4e4e7] hover:border-[#f87171] hover:text-[#f87171] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Cancel
          </button>
        </section>
      )}
    </div>
  );
};
