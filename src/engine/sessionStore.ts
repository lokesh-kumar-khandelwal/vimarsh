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
 * Detects whether an initial user question asks for a breakdown or split of a metric
 * (e.g. "Break down revenue for last quarter.") without naming the grouping dimension.
 */
export function hasUnspecifiedBreakdownDimension(userQuestion: string): boolean {
  const cleaned = userQuestion.trim();
  if (!/\b(?:break\s*down|breakdown|split)\b/i.test(cleaned)) {
    return false;
  }

  // Strip relative time-range filter phrases (e.g. "for last quarter", "last month", "in the past 90 days")
  // so period filter nouns are not confused with a grouping grain.
  const withoutPeriodFilters = cleaned.replace(
    /\b(?:for|in|during|over|from)?\s*(?:the\s+)?(?:this|last|previous|past|next|prior)\s+(?:\d+\s+)?(?:day|days|week|weeks|month|months|quarter|quarters|year|years)\b/gi,
    ' '
  );

  // Check for explicit grouping prepositions ("by ...", "per ...", "across ...", "for each ...")
  if (/\b(?:by|per|across|into|for\s+each|in\s+each)\s+[a-z_]+/i.test(withoutPeriodFilters)) {
    return false;
  }

  // Check for explicit schema or time-grain dimension nouns/adjectives
  if (
    /\b(?:categor(?:y|ies)|segment(?:s)?|product(?:s)?|customer(?:s)?|cit(?:y|ies)|state(?:s)?|region(?:s)?|status(?:es)?|reason(?:s)?|daily|weekly|monthly|quarterly|yearly|annual(?:ly)?|day(?:s)?|week(?:s)?|month(?:s)?|quarter(?:s)?|year(?:s)?)\b/i.test(
      withoutPeriodFilters
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Deterministic clarification policy enforcer for A7 (missing breakdown dimension):
 * When `pendingClarification` is false and the user asks to break down a metric without
 * specifying any grouping dimension, prevents the engine from assuming a dimension
 * (such as product category) or generating/executing SQL before the user clarifies.
 */
export function enforceBreakdownDimensionClarification(
  response: VimarshResponse,
  userQuestion: string,
  pendingClarification: boolean
): { response: VimarshResponse; enforcedA7Clarify: boolean } {
  if (
    pendingClarification ||
    response.status === 'REJECT' ||
    !hasUnspecifiedBreakdownDimension(userQuestion)
  ) {
    return { response, enforcedA7Clarify: false };
  }

  const mentionsRevenue = /\brevenue\b/i.test(userQuestion);
  const defaultFollowUp = mentionsRevenue
    ? 'Which dimension should I use for the revenue breakdown?'
    : 'Which dimension should I use for the breakdown?';
  const defaultOptions = [
    'By product category',
    'By customer segment',
    'By month',
    'By customer state',
  ];

  if (response.status === 'CLARIFY') {
    const existingCodes = (response.ambiguity_type ?? '')
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c.length > 0);
    const hasA7 = existingCodes.includes('A7');
    const normalizedAmbiguityType = hasA7
      ? response.ambiguity_type
      : ['A7', ...existingCodes].join(', ');

    return {
      enforcedA7Clarify: !hasA7,
      response: {
        ...response,
        status: 'CLARIFY',
        ambiguity_type: normalizedAmbiguityType,
        sql_query: null,
        follow_up_question:
          response.follow_up_question && response.follow_up_question.trim().length > 0
            ? response.follow_up_question
            : defaultFollowUp,
        clarification_options:
          response.clarification_options.length >= 2 &&
          response.clarification_options.length <= 4
            ? response.clarification_options
            : defaultOptions,
        assumptions: [],
        tables_used: [],
        rejection_reason: null,
      },
    };
  }

  // response.status === 'SUCCESS': model falsely assumed a breakdown dimension (e.g. products.category)
  return {
    enforcedA7Clarify: true,
    response: {
      status: 'CLARIFY',
      reasoning:
        "The request asks to break down a metric without naming the grouping dimension. Grouping by product category, customer segment, month, or customer state produces materially different results, so clarification is required before generating or executing SQL (A7).",
      ambiguity_type: 'A7',
      sql_query: null,
      follow_up_question: defaultFollowUp,
      clarification_options: defaultOptions,
      assumptions: [],
      tables_used: [],
      confidence: Math.min(response.confidence, 0.35),
      rejection_reason: null,
    },
  };
}

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
