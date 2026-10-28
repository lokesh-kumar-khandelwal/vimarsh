/**
 * Strict JSON Parser & Runtime Response Validator (/src/engine/responseValidator.ts)
 *
 * Spec requirements:
 * - Strict JSON parsing:
 *   trim, remove at most one surrounding Markdown code fence, then JSON.parse the ENTIRE
 *   remaining text inside try/catch. Reject extra text, multiple objects, truncated output,
 *   empty or safety-blocked responses; no brace scanning.
 * - Runtime contract validation (/engine/responseValidator.ts):
 *   * Exactly the 10 keys: status, reasoning, sql_query, follow_up_question,
 *     clarification_options, ambiguity_type, assumptions, tables_used, confidence, rejection_reason
 *   * Correct types, status enum ("SUCCESS" | "CLARIFY" | "REJECT")
 *   * confidence in 0..1
 *   * ambiguity_type null or comma-separated codes from A1-A11
 *   * clarification_options unique non-empty strings (2-4 for CLARIFY, [] otherwise)
 *   * tables_used entries exist in the schema ([] when status !== "SUCCESS")
 *   * Status rules:
 *     - SUCCESS: non-empty sql_query, null follow_up_question, null rejection_reason
 *     - CLARIFY: null sql_query, non-empty follow_up_question, null rejection_reason
 *     - REJECT:  null sql_query, null follow_up_question, non-empty rejection_reason
 *   * Mode rule: in REPAIR mode CLARIFY is invalid.
 */

import type { OperatingMode, SchemaContext, VimarshResponse } from '../types';

export const REQUIRED_VIMARSH_KEYS: readonly (keyof VimarshResponse)[] = [
  'status',
  'reasoning',
  'sql_query',
  'follow_up_question',
  'clarification_options',
  'ambiguity_type',
  'assumptions',
  'tables_used',
  'confidence',
  'rejection_reason',
] as const;

export const VALID_AMBIGUITY_CODES = new Set<string>([
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A7',
  'A8',
  'A9',
  'A10',
  'A11',
]);

export const BLOCKED_FINISH_REASONS = new Set<string>([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'MAX_TOKENS',
  'MALFORMED_FUNCTION_CALL',
  'IMAGE_SAFETY',
  'LANGUAGE',
  'OTHER',
]);

export interface StrictJsonParseSuccess {
  ok: true;
  data: Record<string, unknown>;
}

export interface StrictJsonParseFailure {
  ok: false;
  error: string;
}

export type StrictJsonParseResult = StrictJsonParseSuccess | StrictJsonParseFailure;

/**
 * Strictly parses raw model output text (and optional finishReason) into a single JSON object.
 * Never performs brace scanning or substring extraction.
 */
export function parseStrictJsonResponse(
  rawText: string | null | undefined,
  finishReason?: string | null
): StrictJsonParseResult {
  if (finishReason) {
    const normalizedReason = String(finishReason).toUpperCase().trim();
    if (BLOCKED_FINISH_REASONS.has(normalizedReason)) {
      return {
        ok: false,
        error: `Model response terminated with non-complete finishReason: ${normalizedReason}`,
      };
    }
  }

  if (typeof rawText !== 'string') {
    return {
      ok: false,
      error: 'Model response text is empty or missing.',
    };
  }

  let candidate = rawText.trim();
  if (candidate.length === 0) {
    return {
      ok: false,
      error: 'Model response text is empty after trimming.',
    };
  }

  // Remove at most ONE surrounding Markdown code fence if it wraps the entire string
  // and does not contain closing fences inside the body.
  const fenceMatch = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(candidate);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    if (inner.includes('```')) {
      return {
        ok: false,
        error: 'Multiple markdown code fences detected in model response.',
      };
    }
    candidate = inner;
  }

  if (!candidate.startsWith('{') || !candidate.endsWith('}')) {
    return {
      ok: false,
      error: 'Model response is not a single top-level JSON object.',
    };
  }

  try {
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        error: 'Parsed JSON is not a plain object.',
      };
    }
    return {
      ok: true,
      data: parsed as Record<string, unknown>,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Strict JSON.parse failed: ${msg}`,
    };
  }
}

export interface ResponseValidationSuccess {
  valid: true;
  response: VimarshResponse;
}

export interface ResponseValidationFailure {
  valid: false;
  error: string;
}

export type ResponseValidationResult =
  | ResponseValidationSuccess
  | ResponseValidationFailure;

/**
 * Validates a parsed JSON object against the 10-key VimarshResponse contract,
 * schema table names, and operating mode constraints.
 */
export function validateVimarshResponse(
  rawObj: unknown,
  schemaContext: SchemaContext,
  mode: OperatingMode = 'ANSWER'
): ResponseValidationResult {
  if (typeof rawObj !== 'object' || rawObj === null || Array.isArray(rawObj)) {
    return { valid: false, error: 'Response must be a non-null JSON object.' };
  }

  const obj = rawObj as Record<string, unknown>;
  const actualKeys = Object.keys(obj);
  const expectedKeySet = new Set<string>(REQUIRED_VIMARSH_KEYS);

  if (actualKeys.length !== REQUIRED_VIMARSH_KEYS.length) {
    const missing = REQUIRED_VIMARSH_KEYS.filter((k) => !(k in obj));
    const extra = actualKeys.filter((k) => !expectedKeySet.has(k));
    return {
      valid: false,
      error: `Response must have exactly the 10 contract keys (missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]).`,
    };
  }

  for (const key of REQUIRED_VIMARSH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      return {
        valid: false,
        error: `Missing required key '${key}'.`,
      };
    }
  }

  // 1. status
  const status = obj.status;
  if (status !== 'SUCCESS' && status !== 'CLARIFY' && status !== 'REJECT') {
    return {
      valid: false,
      error: `Invalid status '${String(status)}'. Must be 'SUCCESS', 'CLARIFY', or 'REJECT'.`,
    };
  }

  if (mode === 'REPAIR' && status === 'CLARIFY') {
    return {
      valid: false,
      error: 'CLARIFY is prohibited when operating in REPAIR mode.',
    };
  }

  // 2. reasoning
  if (typeof obj.reasoning !== 'string' || obj.reasoning.trim().length === 0) {
    return {
      valid: false,
      error: "'reasoning' must be a non-empty string.",
    };
  }

  // 3. confidence
  if (
    typeof obj.confidence !== 'number' ||
    !Number.isFinite(obj.confidence) ||
    obj.confidence < 0 ||
    obj.confidence > 1
  ) {
    return {
      valid: false,
      error: `'confidence' must be a finite number in [0, 1], got ${String(obj.confidence)}.`,
    };
  }

  // 4. ambiguity_type
  const ambiguityType = obj.ambiguity_type;
  if (ambiguityType !== null) {
    if (typeof ambiguityType !== 'string' || ambiguityType.trim().length === 0) {
      return {
        valid: false,
        error: "'ambiguity_type' must be null or a comma-separated string of A1-A11 codes.",
      };
    }
    const codes = ambiguityType
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (codes.length === 0) {
      return {
        valid: false,
        error: "'ambiguity_type' cannot be an empty string.",
      };
    }
    for (const code of codes) {
      if (!VALID_AMBIGUITY_CODES.has(code)) {
        return {
          valid: false,
          error: `Invalid ambiguity_type code '${code}'. Allowed codes are A1 through A11.`,
        };
      }
    }
  }

  // 5. clarification_options
  if (!Array.isArray(obj.clarification_options)) {
    return {
      valid: false,
      error: "'clarification_options' must be an array of strings.",
    };
  }
  const clarificationOptions: string[] = [];
  const seenOptions = new Set<string>();
  for (const item of obj.clarification_options) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return {
        valid: false,
        error: "Every entry in 'clarification_options' must be a non-empty string.",
      };
    }
    const normalized = item.trim().toLowerCase();
    if (seenOptions.has(normalized)) {
      return {
        valid: false,
        error: `'clarification_options' contains duplicate option '${item.trim()}'.`,
      };
    }
    seenOptions.add(normalized);
    clarificationOptions.push(item.trim());
  }

  // 6. assumptions
  if (!Array.isArray(obj.assumptions)) {
    return {
      valid: false,
      error: "'assumptions' must be an array of strings.",
    };
  }
  const assumptions: string[] = [];
  for (const item of obj.assumptions) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return {
        valid: false,
        error: "Every entry in 'assumptions' must be a non-empty string.",
      };
    }
    assumptions.push(item.trim());
  }

  // 7. tables_used
  if (!Array.isArray(obj.tables_used)) {
    return {
      valid: false,
      error: "'tables_used' must be an array of strings.",
    };
  }
  const knownTables = new Set<string>(
    schemaContext.tables.map((t) => t.name.toLowerCase())
  );
  const tablesUsed: string[] = [];
  for (const item of obj.tables_used) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return {
        valid: false,
        error: "Every entry in 'tables_used' must be a non-empty string.",
      };
    }
    const normalizedTable = item.trim().toLowerCase();
    if (!knownTables.has(normalizedTable)) {
      return {
        valid: false,
        error: `Unknown table '${item}' in 'tables_used'.`,
      };
    }
    tablesUsed.push(normalizedTable);
  }

  // 8. Status-specific field rules
  const sqlQuery = obj.sql_query;
  const followUp = obj.follow_up_question;
  const rejectionReason = obj.rejection_reason;

  if (status === 'SUCCESS') {
    if (typeof sqlQuery !== 'string' || sqlQuery.trim().length === 0) {
      return {
        valid: false,
        error: "When status is 'SUCCESS', 'sql_query' must be a non-empty string.",
      };
    }
    if (followUp !== null) {
      return {
        valid: false,
        error: "When status is 'SUCCESS', 'follow_up_question' must be null.",
      };
    }
    if (rejectionReason !== null) {
      return {
        valid: false,
        error: "When status is 'SUCCESS', 'rejection_reason' must be null.",
      };
    }
    if (clarificationOptions.length !== 0) {
      return {
        valid: false,
        error: "When status is 'SUCCESS', 'clarification_options' must be [].",
      };
    }
  } else if (status === 'CLARIFY') {
    if (sqlQuery !== null) {
      return {
        valid: false,
        error: "When status is 'CLARIFY', 'sql_query' must be null.",
      };
    }
    if (typeof followUp !== 'string' || followUp.trim().length === 0) {
      return {
        valid: false,
        error: "When status is 'CLARIFY', 'follow_up_question' must be a non-empty string.",
      };
    }
    if (rejectionReason !== null) {
      return {
        valid: false,
        error: "When status is 'CLARIFY', 'rejection_reason' must be null.",
      };
    }
    if (clarificationOptions.length < 2 || clarificationOptions.length > 4) {
      return {
        valid: false,
        error: `When status is 'CLARIFY', 'clarification_options' must have 2 to 4 unique items, got ${clarificationOptions.length}.`,
      };
    }
    if (tablesUsed.length !== 0) {
      return {
        valid: false,
        error: "When status is 'CLARIFY', 'tables_used' must be [].",
      };
    }
  } else {
    // status === 'REJECT'
    if (sqlQuery !== null) {
      return {
        valid: false,
        error: "When status is 'REJECT', 'sql_query' must be null.",
      };
    }
    if (followUp !== null) {
      return {
        valid: false,
        error: "When status is 'REJECT', 'follow_up_question' must be null.",
      };
    }
    if (clarificationOptions.length !== 0) {
      return {
        valid: false,
        error: "When status is 'REJECT', 'clarification_options' must be [].",
      };
    }
    if (typeof rejectionReason !== 'string' || rejectionReason.trim().length === 0) {
      return {
        valid: false,
        error: "When status is 'REJECT', 'rejection_reason' must be a non-empty string.",
      };
    }
    if (tablesUsed.length !== 0) {
      return {
        valid: false,
        error: "When status is 'REJECT', 'tables_used' must be [].",
      };
    }
  }

  return {
    valid: true,
    response: {
      status,
      reasoning: obj.reasoning.trim(),
      sql_query: typeof sqlQuery === 'string' ? sqlQuery.trim() : null,
      follow_up_question: typeof followUp === 'string' ? followUp.trim() : null,
      clarification_options: clarificationOptions,
      ambiguity_type:
        typeof ambiguityType === 'string' ? ambiguityType.trim() : null,
      assumptions,
      tables_used: tablesUsed,
      confidence: obj.confidence,
      rejection_reason:
        typeof rejectionReason === 'string' ? rejectionReason.trim() : null,
    },
  };
}
