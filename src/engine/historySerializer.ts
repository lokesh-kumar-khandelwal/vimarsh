/**
 * Safe Conversation History Serializer (/src/engine/historySerializer.ts)
 *
 * Spec requirements:
 * - Only /engine/historySerializer.ts decides what reaches the LLM.
 * - Serializes the most recent 6 PRIOR turns (never the current message) plus the pinned
 *   original question of a pending clarification:
 *   * user turns as their question text
 *   * assistant turns as short summaries:
 *     - SUCCESS -> "answered; sql: ...; assumptions: ..."
 *     - CLARIFY -> the question and options
 *     - REJECT  -> "rejected"
 * - NEVER includes result rows, cell values, table exports, chart data, or the API key.
 * - SAFE SERIALIZATION for EVERY untrusted field:
 *   first apply length bounds (user question 500 chars, each history entry 500,
 *   failed_sql 2000, db_error 500), then replace "<" with "&lt;" and ">" with "&gt;"
 *   so untrusted text can never create a tag.
 */

import type {
  AssistantConversationTurn,
  ConversationTurn,
  PendingClarificationState,
} from '../types';

export const MAX_HISTORY_TURNS = 6;
export const MAX_USER_QUESTION_CHARS = 500;
export const MAX_HISTORY_ENTRY_CHARS = 500;
export const MAX_FAILED_SQL_CHARS = 2000;
export const MAX_DB_ERROR_CHARS = 500;

/**
 * Truncates `raw` to `maxLength` characters FIRST, then escapes `<` -> `&lt;` and `>` -> `&gt;`.
 */
export function safeSerializeUntrustedField(
  raw: string | null | undefined,
  maxLength: number
): string {
  const str = (raw ?? '').trim();
  const truncated = str.slice(0, maxLength);
  return truncated.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Summarizes an assistant turn strictly from its metadata—never touching executionResult.rows!
 */
export function formatAssistantTurnSummary(turn: AssistantConversationTurn): string {
  const { response } = turn;
  if (response.status === 'SUCCESS') {
    const sqlText = (response.sql_query ?? '').replace(/\s+/g, ' ').trim();
    const assumptionsText =
      response.assumptions && response.assumptions.length > 0
        ? response.assumptions.join('; ')
        : 'none';
    return `assistant: answered; sql: ${sqlText}; assumptions: ${assumptionsText}`;
  }
  if (response.status === 'CLARIFY') {
    const questionText = (response.follow_up_question ?? '').replace(/\s+/g, ' ').trim();
    const optionsText =
      response.clarification_options && response.clarification_options.length > 0
        ? response.clarification_options.join(' | ')
        : '';
    return `assistant: clarify; question: ${questionText}; options: [${optionsText}]`;
  }
  return 'assistant: rejected';
}

/**
 * Serializes prior conversation turns (excluding the current user message) and pins
 * `pending.original_question` when a clarification is active.
 */
export function serializeConversationHistory(
  priorTurns: ReadonlyArray<ConversationTurn>,
  pending: PendingClarificationState | null = null
): string {
  const recentPrior = priorTurns.slice(-MAX_HISTORY_TURNS);
  const lines: string[] = [];

  if (pending && pending.original_question.trim().length > 0) {
    const pinnedRaw = `pinned_original_question: ${pending.original_question.trim()}`;
    lines.push(safeSerializeUntrustedField(pinnedRaw, MAX_HISTORY_ENTRY_CHARS));
  }

  for (const turn of recentPrior) {
    if (turn.role === 'user') {
      const rawEntry = `user: ${turn.question.replace(/\s+/g, ' ').trim()}`;
      lines.push(safeSerializeUntrustedField(rawEntry, MAX_HISTORY_ENTRY_CHARS));
    } else {
      const rawEntry = formatAssistantTurnSummary(turn);
      lines.push(safeSerializeUntrustedField(rawEntry, MAX_HISTORY_ENTRY_CHARS));
    }
  }

  return lines.join('\n');
}
