/**
 * Deterministic Input Guard (/src/engine/inputGuard.ts)
 *
 * Spec requirements:
 * - Trim and length-limit user input (500 characters max).
 * - Perform a DETERMINISTIC hard reject (no LLM call, no query) ONLY for clear
 *   instruction-override or prompt-exfiltration phrases (e.g., "ignore previous/all/your
 *   instructions or rules", "reveal/show your system prompt", "you are now",
 *   "developer mode", "jailbreak", "act as admin").
 * - Must NOT reject benign words like "drop", "delete", or "update" in ordinary analytical
 *   questions, nor data-modification questions like "Delete all cancelled orders" that belong
 *   to the model safety scan.
 * - If any instruction-override or prompt-exfiltration phrase is detected, reject the WHOLE
 *   request, even when a legitimate analytical question is mixed in.
 */

import type { InputGuardResult } from '../types';

export const MAX_USER_QUESTION_LENGTH = 500;

interface GuardPattern {
  id: string;
  regex: RegExp;
  reason: string;
}

const INSTRUCTION_OVERRIDE_AND_EXFIL_PATTERNS: ReadonlyArray<GuardPattern> = [
  {
    id: 'ignore_instructions_or_rules',
    regex:
      /\b(?:ignore|disregard|forget|bypass|override)\s+(?:all\s+|any\s+|previous\s+|prior\s+|earlier\s+|above\s+|your\s+|the\s+|system\s+|safety\s+)*(?:instructions?|rules?|constraints?|guidelines?|prompts?|directives?|guardrails?)\b/i,
    reason:
      'Blocked by Input Guard: instruction-override phrase detected ("ignore/bypass/override instructions or rules"). Please ask your analytical question without rule-override instructions.',
  },
  {
    id: 'reveal_system_prompt',
    regex:
      /\b(?:reveal|show|print|display|dump|output|repeat|recite|expose|leak|give\s+me|tell\s+me)\s+(?:me\s+)?(?:all\s+|the\s+|your\s+|full\s+|entire\s+|hidden\s+|secret\s+|system\s+|developer\s+|initial\s+|internal\s+)*(?:prompt|instructions?|rules?)\b/i,
    reason:
      'Blocked by Input Guard: system-prompt exfiltration attempt detected. Vimarsh only answers analytical questions about the dataset.',
  },
  {
    id: 'you_are_now_roleplay',
    regex:
      /\byou\s+are\s+now\s+(?:a\s+|an\s+|in\s+|operating\s+as\s+|acting\s+as\s+|no\s+longer\s+|free\s+|unrestricted\s+|dan\b|admin\b|root\b|developer\b|a\s+different\b|[a-z0-9_-]+)/i,
    reason:
      'Blocked by Input Guard: persona-override attempt ("you are now ...") detected.',
  },
  {
    id: 'developer_or_god_mode',
    regex:
      /\b(?:developer\s+mode|dan\s+mode|god\s+mode|sudo\s+mode|unrestricted\s+mode|maintenance\s+mode)\b/i,
    reason:
      'Blocked by Input Guard: restricted mode-switch phrase ("developer mode") detected.',
  },
  {
    id: 'jailbreak_keyword',
    regex: /\b(?:jailbreak|jailbroken)\b/i,
    reason: 'Blocked by Input Guard: jailbreak attempt detected.',
  },
  {
    id: 'act_as_privileged_role',
    regex:
      /\b(?:act\s+as|pretend\s+to\s+be|roleplay\s+as|simulate\s+being)\s+(?:an?\s+|the\s+)?(?:admin|administrator|root|superuser|system\s+administrator|unrestricted\s+ai|unfiltered\s+ai|dba\s+with\s+write\s+access)\b/i,
    reason:
      'Blocked by Input Guard: privileged role-assumption phrase ("act as admin") detected.',
  },
  {
    id: 'new_system_instructions',
    regex: /\b(?:new\s+system\s+instructions?|system\s+override\s*:)\b/i,
    reason:
      'Blocked by Input Guard: system instruction injection phrase detected.',
  },
];

/**
 * Evaluates raw user input deterministically before any LLM call or history serialization.
 */
export function runInputGuard(rawInput: string): InputGuardResult {
  const trimmed = (rawInput ?? '').trim();
  const bounded = trimmed.slice(0, MAX_USER_QUESTION_LENGTH);

  if (bounded.length === 0) {
    return {
      allowed: false,
      sanitizedQuestion: '',
      rejectionReason: 'Please enter a question about the dataset.',
      matchedPattern: 'empty_input',
    };
  }

  for (const pattern of INSTRUCTION_OVERRIDE_AND_EXFIL_PATTERNS) {
    if (pattern.regex.test(bounded) || pattern.regex.test(trimmed)) {
      return {
        allowed: false,
        sanitizedQuestion: bounded,
        rejectionReason: pattern.reason,
        matchedPattern: pattern.id,
      };
    }
  }

  return {
    allowed: true,
    sanitizedQuestion: bounded,
  rejectionReason: null,
  };
}
