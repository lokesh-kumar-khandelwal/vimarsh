import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  HelpCircle,
  Info,
  RefreshCw,
  ShieldAlert,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { AssistantConversationTurn } from '../../types';
import { QueryResultTable } from './QueryResultTable';
import { ResultBarChart } from './ResultBarChart';
import { SqlDisplayBlock } from './SqlDisplayBlock';
import {
  buildAutoChartModel,
  classifyErrorTurnHeading,
} from './resultHelpers';

interface AssistantResponseCardProps {
  turn: AssistantConversationTurn;
  previousUserQuestion?: string;
  isConnected: boolean;
  isSubmitting: boolean;
  onAskQuestion: (question: string) => void;
  onEditQuestion: (question?: string) => void;
  cardRef?: React.Ref<HTMLElement>;
}

export const AssistantResponseCard: React.FC<AssistantResponseCardProps> = ({
  turn,
  previousUserQuestion,
  isConnected,
  isSubmitting,
  onAskQuestion,
  onEditQuestion,
  cardRef,
}) => {
  const [isReasoningOpen, setIsReasoningOpen] = useState<boolean>(false);
  const [isSqlOpen, setIsSqlOpen] = useState<boolean>(false);

  const { response } = turn;
  const autoChart = buildAutoChartModel(turn.executionResult);
  const errorClassification = turn.processingError
    ? classifyErrorTurnHeading(response.rejection_reason)
    : null;

  return (
    <article
      ref={cardRef}
      aria-label={`Vimarsh ${
        turn.processingError ? 'Error' : response.status
      } Response`}
      className={`rounded-none border p-5 space-y-4 scroll-mt-20 ${
        response.status === 'SUCCESS'
          ? 'border-[#e4e4e7]/25 bg-[#121216]'
          : response.status === 'CLARIFY'
            ? 'border-[#fbbf24]/60 bg-[#fbbf24]/[0.04]'
            : 'border-[#f87171]/60 bg-[#f87171]/[0.04]'
      }`}
    >
      {/* State Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {response.status === 'SUCCESS' ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-none bg-[#4ade80] text-[#0c0c0e]">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                {turn.executionResult?.isEmpty
                  ? 'Query Completed (No Matching Rows)'
                  : 'Answer Ready'}
              </span>
            </span>
          ) : response.status === 'CLARIFY' ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-none bg-[#fbbf24] text-[#0c0c0e]">
              <HelpCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Clarification Needed</span>
            </span>
          ) : turn.processingError && errorClassification ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-none bg-[#f87171] text-[#0c0c0e]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{errorClassification.title}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-none bg-[#f87171] text-[#0c0c0e]">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {turn.blockedByGuard
                  ? 'Blocked by Safety Guard'
                  : 'Request Cannot Be Answered'}
              </span>
            </span>
          )}

          {turn.repaired && (
            <span className="inline-flex items-center gap-1 text-xs font-mono text-[#fbbf24]">
              <Wrench className="w-3.5 h-3.5" />
              <span>
                Automatically repaired query ({turn.repairCount}{' '}
                {turn.repairCount === 1 ? 'attempt' : 'attempts'})
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 font-mono text-xs text-[#e4e4e7]/60 tabular-nums">
          <Clock className="w-3.5 h-3.5" />
          <span>{turn.latencyMs} ms</span>
        </div>
      </div>

      {/* 1. CLARIFICATION STATE */}
      {response.status === 'CLARIFY' && (
        <div className="space-y-3.5">
          <p className="text-base font-semibold text-[#e4e4e7]">
            {response.follow_up_question}
          </p>
          <p className="text-xs font-mono text-[#e4e4e7]/65">
            Select an option below or type your answer in the box above:
          </p>
          <div
            role="group"
            aria-label="Clarification Options"
            className="flex flex-wrap gap-2.5"
          >
            {response.clarification_options.map((option) => (
              <button
                key={option}
                type="button"
                disabled={!isConnected || isSubmitting}
                onClick={() => onAskQuestion(option)}
                className="px-3.5 py-2 text-xs font-mono font-bold rounded-none border border-[#fbbf24] bg-[#0c0c0e] text-[#fbbf24] hover:bg-[#fbbf24] hover:text-[#0c0c0e] disabled:opacity-50 transition-colors cursor-pointer"
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 2. REJECTION OR ERROR STATE */}
      {response.status === 'REJECT' && (
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 text-sm text-[#f87171]">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="whitespace-pre-wrap break-words leading-relaxed font-medium">
              {response.rejection_reason}
            </p>
          </div>

          {turn.processingError &&
            errorClassification?.category === 'service_unavailable' && (
              <div
                role="alert"
                aria-label="503 Service Unavailable Recovery Details"
                className="rounded-none border border-[#fbbf24]/50 bg-[#0c0c0e] p-4 text-xs text-[#e4e4e7] space-y-1.5"
              >
                <div className="font-mono font-bold uppercase tracking-wider text-[#fbbf24]">
                  What happened &amp; how to recover without reloading
                </div>
                <p className="text-[#e4e4e7]/75 leading-relaxed">
                  Google&apos;s Gemini service returned HTTP 503 (Service
                  Unavailable) due to a temporary capacity spike. Vimarsh
                  automatically retried your request with exponential backoff and
                  executed 0 SQL queries to keep your session clean. Click{' '}
                  <strong className="text-[#e4e4e7]">Retry Question</strong>{' '}
                  below to re-send your question in place.
                </p>
              </div>
            )}

          {turn.processingError && (
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {previousUserQuestion && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => onAskQuestion(previousUserQuestion)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-mono font-bold uppercase tracking-wider rounded-none bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Question</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onEditQuestion(previousUserQuestion)}
                className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/35 bg-[#0c0c0e] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-colors cursor-pointer"
              >
                Edit Question
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3. SUCCESSFUL OR EMPTY RESULT STATE */}
      {response.status === 'SUCCESS' && (
        <div className="space-y-4">
          {turn.executionResult?.isEmpty ? (
            <div className="rounded-none border border-[#e4e4e7]/20 bg-[#0c0c0e] p-5 space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-mono font-bold text-[#e4e4e7]">
                <Info className="w-4 h-4 text-[#38bdf8] shrink-0" />
                <span>No results matched your question.</span>
              </div>
              <p className="text-xs text-[#e4e4e7]/65">
                The query ran safely against the sample database, but 0 rows
                matched your filters. Try broadening the time range or checking
                the sample values in the database reference.
              </p>
            </div>
          ) : (
            turn.executionResult && (
              <>
                <QueryResultTable
                  turnId={turn.id}
                  executionResult={turn.executionResult}
                  question={previousUserQuestion}
                />
                {autoChart && <ResultBarChart chart={autoChart} />}
              </>
            )
          )}
        </div>
      )}

      {/* Expandable Details Footer: View SQL & How was this calculated? */}
      <div className="pt-3 border-t border-[#e4e4e7]/15 space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          {response.sql_query && (
            <button
              type="button"
              onClick={() => setIsSqlOpen((prev) => !prev)}
              aria-expanded={isSqlOpen}
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-[#38bdf8] hover:text-[#e4e4e7] cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>{isSqlOpen ? 'Hide SQL' : 'View SQL'}</span>
              {isSqlOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsReasoningOpen((prev) => !prev)}
            aria-expanded={isReasoningOpen}
            className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-[#e4e4e7]/65 hover:text-[#e4e4e7] cursor-pointer"
          >
            {isReasoningOpen ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>
              {response.status === 'SUCCESS'
                ? 'How was this calculated?'
                : 'How Vimarsh decided'}
            </span>
          </button>
        </div>

        {isSqlOpen && response.sql_query && (
          <SqlDisplayBlock
            turnId={turn.id}
            sqlQuery={response.sql_query}
            validatedTablesUsed={turn.validatedTablesUsed}
          />
        )}

        {isReasoningOpen && (
          <div className="rounded-none border border-[#e4e4e7]/20 bg-[#0c0c0e] p-3.5 space-y-2.5 text-xs text-[#e4e4e7]">
            {response.assumptions.length > 0 && (
              <div className="space-y-1">
                <div className="font-mono font-bold uppercase tracking-wider text-[#38bdf8]">
                  Assumptions &amp; Business Rules Applied:
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[#e4e4e7]/75">
                  {response.assumptions.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1">
              <div className="font-mono font-bold uppercase tracking-wider text-[#38bdf8]">
                Decision Summary:
              </div>
              <p className="text-[#e4e4e7]/75 leading-relaxed whitespace-pre-wrap">
                {response.reasoning}
              </p>
            </div>

            {turn.repaired && turn.originalError && (
              <div className="pt-1 border-t border-[#e4e4e7]/15 text-[#fbbf24] font-mono text-[11px]">
                Automatic repair note: {turn.originalError}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
};
