import React from 'react';
import {
  Database,
  HelpCircle,
  History,
  MessageSquarePlus,
  Send,
} from 'lucide-react';
import { PENDING_INPUT_HINT } from '../../engine/sessionStore';
import type { PendingClarificationState, SchemaContext } from '../../types';
import { PRIMARY_EXAMPLE_QUESTIONS } from './workspaceConstants';

interface QuestionInputSectionProps {
  questionInput: string;
  onQuestionInputChange: (value: string) => void;
  onSubmitQuestion: (question: string) => void;
  onSelectExample: (example: string) => void;
  onStartNewQuestion: () => void;
  onClearConversation: () => void;
  pendingClarification: PendingClarificationState | null;
  hasTurns: boolean;
  isSubmitting: boolean;
  schemaContext: SchemaContext | null;
  inputFeedback: string | null;
  showQueryHistory: boolean;
  onToggleQueryHistory: () => void;
  historyCount: number;
  showDataReference: boolean;
  onToggleDataReference: () => void;
  questionInputRef: React.RefObject<HTMLInputElement | null>;
}

export const QuestionInputSection: React.FC<QuestionInputSectionProps> = ({
  questionInput,
  onQuestionInputChange,
  onSubmitQuestion,
  onSelectExample,
  onStartNewQuestion,
  onClearConversation,
  pendingClarification,
  hasTurns,
  isSubmitting,
  schemaContext,
  inputFeedback,
  showQueryHistory,
  onToggleQueryHistory,
  historyCount,
  showDataReference,
  onToggleDataReference,
  questionInputRef,
}) => {
  return (
    <section
      aria-label="Ask a Question"
      className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-5 sm:p-6 space-y-4"
    >
      {/* Active Pending Clarification Banner when in a multi-turn clarification flow */}
      {pendingClarification && (
        <div
          role="status"
          aria-label="Active Clarification Context"
          className="rounded-none border border-[#fbbf24]/60 bg-[#fbbf24]/[0.06] p-3.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-wider text-[#fbbf24]">
              <HelpCircle className="w-4 h-4 shrink-0" />
              <span>
                Clarification in progress (Round {pendingClarification.round} of
                3)
              </span>
            </div>
            <p className="text-xs text-[#e4e4e7]/75">
              Answering for:{' '}
              <strong className="font-mono text-[#e4e4e7]">
                {pendingClarification.original_question}
              </strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onStartNewQuestion}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider rounded-none border border-[#fbbf24] bg-[#fbbf24] text-[#0c0c0e] hover:bg-[#fbbf24]/90 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>Start New Question</span>
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmitQuestion(questionInput);
        }}
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="vimarsh-question-input"
            className="block text-xs font-mono font-bold uppercase tracking-wider text-[#e4e4e7]"
          >
            {pendingClarification
              ? 'Your clarification response'
              : 'Your question'}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onToggleQueryHistory}
              aria-expanded={showQueryHistory}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[#38bdf8] hover:text-[#e4e4e7] cursor-pointer"
            >
              <History className="w-3.5 h-3.5" />
              <span>
                {showQueryHistory
                  ? 'Hide Query History'
                  : `Query History (${historyCount})`}
              </span>
            </button>
            {hasTurns && (
              <>
                {pendingClarification && (
                  <button
                    type="button"
                    onClick={onStartNewQuestion}
                    disabled={isSubmitting}
                    className="text-[11px] font-mono uppercase tracking-wider text-[#fbbf24] hover:underline cursor-pointer"
                  >
                    New question
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClearConversation}
                  disabled={isSubmitting}
                  className="text-[11px] font-mono uppercase tracking-wider text-[#e4e4e7]/60 hover:text-[#f87171] underline cursor-pointer"
                >
                  Clear conversation
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <input
            ref={questionInputRef}
            id="vimarsh-question-input"
            type="text"
            value={questionInput}
            onChange={(e) => onQuestionInputChange(e.target.value)}
            disabled={isSubmitting || !schemaContext}
            placeholder={
              pendingClarification
                ? PENDING_INPUT_HINT
                : 'Ask about customers, products, orders, or revenue...'
            }
            maxLength={500}
            className="flex-1 px-3.5 py-2.5 text-sm font-mono rounded-none bg-[#0c0c0e] border border-[#e4e4e7]/30 text-[#e4e4e7] placeholder-[#e4e4e7]/40 focus:border-[#38bdf8] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={
              isSubmitting ||
              questionInput.trim().length === 0 ||
              !schemaContext
            }
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-mono font-bold uppercase tracking-wider rounded-none bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'Checking...' : 'Ask Vimarsh'}</span>
          </button>
        </div>
      </form>

      {inputFeedback && (
        <p role="status" className="text-xs font-mono text-[#fbbf24]">
          {inputFeedback}
        </p>
      )}

      {/* Three User-Friendly Example Questions + Collapsible Data Reference Toggle */}
      <div className="pt-3 border-t border-[#e4e4e7]/15 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label-mono">TRY AN EXAMPLE QUESTION:</span>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onToggleQueryHistory}
              aria-expanded={showQueryHistory}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[#e4e4e7]/70 hover:text-[#38bdf8] underline cursor-pointer"
            >
              <History className="w-3.5 h-3.5" />
              <span>
                {showQueryHistory
                  ? 'Hide Query History'
                  : `Query History (${historyCount})`}
              </span>
            </button>
            <button
              type="button"
              onClick={onToggleDataReference}
              aria-expanded={showDataReference}
              className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-[#e4e4e7]/70 hover:text-[#38bdf8] underline cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" />
              <span>
                {showDataReference ? 'Hide Data Reference' : 'Data Reference'}
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {PRIMARY_EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={isSubmitting || !schemaContext}
              onClick={() => onSelectExample(q)}
              className="text-left p-3 rounded-none border border-[#e4e4e7]/20 bg-[#0c0c0e] hover:border-[#38bdf8] hover:text-[#38bdf8] disabled:opacity-50 transition-colors text-xs text-[#e4e4e7] font-mono leading-snug cursor-pointer"
            >
              &ldquo;{q}&rdquo;
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
