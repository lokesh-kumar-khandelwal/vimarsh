/**
 * Prompt Builder (/src/engine/promptBuilder.ts)
 *
 * Spec requirements:
 * - Fills ONLY these 7 placeholders in SYSTEM_PROMPT_TEMPLATE:
 *   {{CURRENT_DATE}}, {{DATE_HELPERS}}, {{DB_DIALECT}} = "SQLite",
 *   {{SCHEMA}}, {{ENUM_VALUES}}, {{GLOSSARY}}, {{SENSITIVE_COLUMNS}}
 * - Builds the user message with exact tags:
 *   <mode>ANSWER or REPAIR</mode>
 *   <pending_clarification>true or false</pending_clarification>
 *   <clarification_round>number</clarification_round>
 *   <conversation_history>serialized prior turns</conversation_history>
 *   <user_question>the latest user turn</user_question>
 *   Plus in REPAIR mode:
 *   <error_source>VALIDATION or EXECUTION</error_source>
 *   <failed_sql>...</failed_sql>
 *   <db_error>...</db_error>
 * - Applies safe serialization (length cap + '<' -> '&lt;', '>' -> '&gt;') to every untrusted field.
 */

import type {
  ConversationTurn,
  OperatingMode,
  PendingClarificationState,
  RepairErrorSource,
  SchemaContext,
} from '../types';
import { getDateHelpers, type DateHelpersResult } from './dateHelpers';
import {
  MAX_DB_ERROR_CHARS,
  MAX_FAILED_SQL_CHARS,
  MAX_USER_QUESTION_CHARS,
  safeSerializeUntrustedField,
  serializeConversationHistory,
} from './historySerializer';
import { SYSTEM_PROMPT_TEMPLATE } from './systemPrompt';

export function formatDateHelpersForPrompt(dateHelpers: DateHelpersResult): string {
  return Object.entries(dateHelpers)
    .map(([key, value]) => `  * ${key}: '${value}'`)
    .join('\n');
}

export function formatSchemaForPrompt(schemaContext: SchemaContext): string {
  const tableLines: string[] = [];

  for (const table of schemaContext.tables) {
    tableLines.push(`Table ${table.name}: ${table.description}`);
    for (const col of table.columns) {
      const flags: string[] = [col.type];
      if (col.isPrimaryKey) flags.push('PK');
      if (col.foreignKey) {
        flags.push(`FK -> ${col.foreignKey.toTable}.${col.foreignKey.toColumn}`);
      }
      if (col.isSensitive) {
        flags.push('SENSITIVE - DO NOT QUERY OR EXPOSE');
      } else if (col.isFreeFormText) {
        flags.push('FREE-FORM text');
      }
      tableLines.push(
        `  - ${table.name}.${col.name} (${flags.join(', ')}): ${col.description}`
      );
    }
  }

  if (schemaContext.joinHints.length > 0) {
    tableLines.push('Declared Join Hints:');
    for (const hint of schemaContext.joinHints) {
      tableLines.push(`  - ${hint.expression} (${hint.description})`);
    }
  }

  return tableLines.join('\n');
}

export function formatEnumValuesForPrompt(schemaContext: SchemaContext): string {
  return Object.entries(schemaContext.enumValues)
    .map(([col, vals]) => `  * ${col}: ${vals.map((v) => `'${v}'`).join(', ')}`)
    .join('\n');
}

export function formatGlossaryForPrompt(schemaContext: SchemaContext): string {
  return schemaContext.glossary
    .map(
      (entry) =>
        `  * ${entry.term} [${entry.category}]: ${entry.definition} | Rule/Formula: ${entry.formulaOrRule}`
    )
    .join('\n');
}

/**
 * Replaces a placeholder token without interpreting `$` replacement patterns.
 */
function replaceExactPlaceholder(
  template: string,
  placeholder: string,
  value: string
): string {
  return template.split(placeholder).join(value);
}

/**
 * Builds the systemInstruction string by populating the 7 trusted placeholders in SYSTEM_PROMPT_TEMPLATE.
 */
export function buildSystemPrompt(
  schemaContext: SchemaContext,
  now: Date = new Date()
): string {
  const dateHelpers = getDateHelpers(now);

  let prompt = SYSTEM_PROMPT_TEMPLATE;
  prompt = replaceExactPlaceholder(prompt, '{{CURRENT_DATE}}', dateHelpers.today);
  prompt = replaceExactPlaceholder(
    prompt,
    '{{DATE_HELPERS}}',
    formatDateHelpersForPrompt(dateHelpers)
  );
  prompt = replaceExactPlaceholder(prompt, '{{DB_DIALECT}}', 'SQLite');
  prompt = replaceExactPlaceholder(
    prompt,
    '{{SCHEMA}}',
    formatSchemaForPrompt(schemaContext)
  );
  prompt = replaceExactPlaceholder(
    prompt,
    '{{ENUM_VALUES}}',
    formatEnumValuesForPrompt(schemaContext)
  );
  prompt = replaceExactPlaceholder(
    prompt,
    '{{GLOSSARY}}',
    formatGlossaryForPrompt(schemaContext)
  );
  prompt = replaceExactPlaceholder(
    prompt,
    '{{SENSITIVE_COLUMNS}}',
    schemaContext.sensitiveColumns.join(', ')
  );

  return prompt;
}

export interface BuildUserMessageParams {
  mode: OperatingMode;
  pendingClarification: boolean;
  clarificationRound: number;
  priorTurns: ReadonlyArray<ConversationTurn>;
  pendingState?: PendingClarificationState | null;
  userQuestion: string;
  errorSource?: RepairErrorSource;
  failedSql?: string;
  dbError?: string;
  nudgeMessage?: string;
}

/**
 * Builds the tagged user message sent to the Gemini model.
 * Guarantees safe serialization (length limits + '<'/'>' escaping) on all untrusted fields.
 */
export function buildUserMessage(params: BuildUserMessageParams): string {
  const mode: OperatingMode = params.mode === 'REPAIR' ? 'REPAIR' : 'ANSWER';
  const pendingStr = params.pendingClarification ? 'true' : 'false';
  const roundNum = Math.max(0, Math.floor(params.clarificationRound));

  const serializedHistory = serializeConversationHistory(
    params.priorTurns,
    params.pendingState ?? null
  );
  const serializedQuestion = safeSerializeUntrustedField(
    params.userQuestion,
    MAX_USER_QUESTION_CHARS
  );

  const lines: string[] = [
    `<mode>${mode}</mode>`,
    `<pending_clarification>${pendingStr}</pending_clarification>`,
    `<clarification_round>${roundNum}</clarification_round>`,
    `<conversation_history>${serializedHistory}</conversation_history>`,
    `<user_question>${serializedQuestion}</user_question>`,
  ];

  if (mode === 'REPAIR') {
    const errorSource: RepairErrorSource =
      params.errorSource === 'EXECUTION' ? 'EXECUTION' : 'VALIDATION';
    const serializedFailedSql = safeSerializeUntrustedField(
      params.failedSql ?? '',
      MAX_FAILED_SQL_CHARS
    );
    const serializedDbError = safeSerializeUntrustedField(
      params.dbError ?? '',
      MAX_DB_ERROR_CHARS
    );
    lines.push(`<error_source>${errorSource}</error_source>`);
    lines.push(`<failed_sql>${serializedFailedSql}</failed_sql>`);
    lines.push(`<db_error>${serializedDbError}</db_error>`);
  }

  if (params.nudgeMessage) {
    lines.push(params.nudgeMessage);
  }

  return lines.join('\n');
}
