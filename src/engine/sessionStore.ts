/**
 * Conversation Session Store & Round-3 Clarification Enforcer (/src/engine/sessionStore.ts)
 *
 * Spec requirements:
 * - state.pending = null | { original_question, round }
 * - A CLARIFY response sets pending (keeps original_question if already set, increments round).
 * - SUCCESS or REJECT sets pending = null.
 * - A "New question" button clears pending.
 * - While pending, the input hint reads: "Answer, or click New question to ask something else".
 * - In code: if round is already 3 and the model returns CLARIFY, convert it to a REJECT
 *   that names the details to specify and asks the user to rephrase.
 */

import type {
  AssistantConversationTurn,
  ConversationTurn,
  PendingClarificationState,
  SessionState,
  UserConversationTurn,
  VimarshResponse,
} from '../types';

export const MAX_CLARIFICATION_ROUNDS = 3;

export const PENDING_INPUT_HINT =
  'Answer, or click New question to ask something else';

export const DEFAULT_INPUT_HINT =
  'Ask a question about customers, products, orders, order_items, or returns...';

/**
 * Deterministic code enforcement for the 3-round clarification limit:
 * If `currentRound >= 3` and the model returns `CLARIFY`, converts the response to `REJECT`
 * naming the unresolved details and asking the user to rephrase.
 */
export function enforceClarificationRoundLimit(
  response: VimarshResponse,
  currentRound: number
): { response: VimarshResponse; convertedFromClarify: boolean } {
  if (response.status !== 'CLARIFY' || currentRound < MAX_CLARIFICATION_ROUNDS) {
    return { response, convertedFromClarify: false };
  }

  const optionsHint =
    response.clarification_options.length > 0
      ? ` (${response.clarification_options.join(', ')})`
      : '';
  const unresolvedDetail = response.follow_up_question
    ? `${response.follow_up_question}${optionsHint}`
    : `the unresolved details${optionsHint}`;

  return {
    convertedFromClarify: true,
    response: {
      status: 'REJECT',
      reasoning: `${response.reasoning} [Enforced round-${currentRound} clarification limit in code: converted CLARIFY to REJECT.]`,
      sql_query: null,
      follow_up_question: null,
      clarification_options: [],
      ambiguity_type: response.ambiguity_type,
      assumptions: [],
      tables_used: [],
      confidence: response.confidence,
      rejection_reason: `After ${MAX_CLARIFICATION_ROUNDS} clarification rounds, a blocking ambiguity still remains regarding: ${unresolvedDetail}. Please rephrase your question and explicitly state those details.`,
    },
  };
}

/**
 * Pure state transition for `pending` after receiving a final (post-round-limit) `VimarshResponse`.
 */
export function computeNextPendingState(
  currentPending: PendingClarificationState | null,
  userQuestion: string,
  finalResponse: VimarshResponse
): PendingClarificationState | null {
  if (finalResponse.status === 'CLARIFY') {
    const pinnedQuestion =
      currentPending && currentPending.original_question.trim().length > 0
        ? currentPending.original_question
        : userQuestion.trim();
    const nextRound = (currentPending?.round ?? 0) + 1;
    return {
      original_question: pinnedQuestion,
      round: nextRound,
    };
  }
  // SUCCESS or REJECT clears pending clarification state
  return null;
}

type SessionListener = (state: SessionState) => void;

export class SessionStore {
  private state: SessionState = {
    turns: [],
    pending: null,
  };

  private listeners = new Set<SessionListener>();

  getState(): SessionState {
    return {
      turns: [...this.state.turns],
      pending: this.state.pending ? { ...this.state.pending } : null,
    };
  }

  getInputHint(): string {
    return this.state.pending ? PENDING_INPUT_HINT : DEFAULT_INPUT_HINT;
  }

  /**
   * Appends a user turn and its corresponding assistant turn, updating `pending` per spec.
   */
  recordTurnPair(
    userTurn: UserConversationTurn,
    assistantTurn: AssistantConversationTurn
  ): SessionState {
    const nextPending = computeNextPendingState(
      this.state.pending,
      userTurn.question,
      assistantTurn.response
    );
    this.state = {
      turns: [...this.state.turns, userTurn, assistantTurn],
      pending: nextPending,
    };
    this.notify();
    return this.getState();
  }

  /**
   * Clears `pending` when the user clicks "New question" without erasing the timeline.
   */
  startNewQuestion(): SessionState {
    if (this.state.pending !== null) {
      this.state = {
        ...this.state,
        pending: null,
      };
      this.notify();
    }
    return this.getState();
  }

  /**
   * Resets both the conversation timeline and pending clarification state.
   */
  clearAll(): SessionState {
    this.state = {
      turns: [],
      pending: null,
    };
    this.notify();
    return this.getState();
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export const sessionStore = new SessionStore();
