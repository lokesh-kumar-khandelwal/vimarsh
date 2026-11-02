import React from 'react';
import type { ConversationTurn } from '../../types';
import { AssistantResponseCard } from './AssistantResponseCard';

interface ConversationTimelineProps {
  turns: ConversationTurn[];
  isConnected: boolean;
  isSubmitting: boolean;
  onAskQuestion: (question: string) => void;
  onEditQuestion: (question?: string) => void;
  latestTurnRef: React.RefObject<HTMLElement | null>;
  latestResponseRef: React.RefObject<HTMLElement | null>;
}

export const ConversationTimeline: React.FC<ConversationTimelineProps> = ({
  turns,
  isConnected,
  isSubmitting,
  onAskQuestion,
  onEditQuestion,
  latestTurnRef,
  latestResponseRef,
}) => {
  if (turns.length === 0) {
    return null;
  }

  return (
    <section aria-label="Questions and Results" className="space-y-4">
      {turns.map((turn, idx) => {
        if (turn.role === 'user') {
          const isLatestUserTurn = idx === turns.length - 2;
          return (
            <article
              key={turn.id}
              ref={isLatestUserTurn ? latestTurnRef : undefined}
              aria-label="Your Question"
              className="rounded-none border border-[#e4e4e7]/20 bg-[#121216] px-4 py-3 flex items-start justify-between gap-4 scroll-mt-20"
            >
              <div className="space-y-1">
                <div className="label-mono text-[#38bdf8]">Your question</div>
                <p className="text-sm font-medium text-[#e4e4e7] whitespace-pre-wrap break-words">
                  {turn.question}
                </p>
              </div>
              <span className="font-mono text-xs text-[#e4e4e7]/50 shrink-0 tabular-nums">
                {new Date(turn.timestamp).toLocaleTimeString()}
              </span>
            </article>
          );
        }

        const prevUserTurn =
          idx > 0 && turns[idx - 1]?.role === 'user'
            ? (turns[idx - 1] as { question: string })
            : null;
        const isLatestAssistantTurn = idx === turns.length - 1;

        return (
          <AssistantResponseCard
            key={turn.id}
            turn={turn}
            previousUserQuestion={prevUserTurn?.question}
            isConnected={isConnected}
            isSubmitting={isSubmitting}
            onAskQuestion={onAskQuestion}
            onEditQuestion={onEditQuestion}
            cardRef={isLatestAssistantTurn ? latestResponseRef : undefined}
          />
        );
      })}
    </section>
  );
};
