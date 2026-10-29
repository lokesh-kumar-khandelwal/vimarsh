/**
 * Structured Audit Log (/src/engine/auditLog.ts)
 *
 * Spec requirements:
 * - Structured events with source enum:
 *   INPUT_GUARD, MODEL, RESPONSE_VALIDATOR, SQL_VALIDATOR, EXECUTOR, REPAIR, RETRY_EXHAUSTED
 * - Fields: timestamp, PROMPT_VERSION, model name, mode, status, source,
 *   validator result, row count, latency, repair count, and the failed and final SQL
 *   (each truncated to 2000 chars).
 * - Never record the API key, result rows, raw prompts, or raw API error bodies.
 * - Exportable as JSON ("Download audit log (JSON)" button).
 */

import { GEMINI_MODEL } from '../config';
import type {
  AuditEventSource,
  AuditLogEvent,
  OperatingMode,
  VimarshStatus,
} from '../types';
import { getApiKey } from './keyStore';
import { PROMPT_VERSION } from './systemPrompt';

export const MAX_AUDIT_SQL_LENGTH = 2000;

export interface RecordAuditEventInput {
  mode: OperatingMode;
  status: VimarshStatus | 'ERROR';
  source: AuditEventSource;
  validatorResult: string;
  rowCount?: number | null;
  latencyMs: number;
  repairCount?: number;
  failedSql?: string | null;
  finalSql?: string | null;
  timestamp?: string;
  transportRetriesUsed?: number;
  retryDelayMs?: number;
  jsonRetriesUsed?: number;
}

/**
 * Redacts the active visitor API key if it ever accidentally appears in a string,
 * and truncates to `maxLength` characters.
 */
function sanitizeAndTruncateAuditString(
  value: string | null | undefined,
  maxLength: number
): string | null {
  if (typeof value !== 'string') return null;
  let cleaned = value.trim();
  if (cleaned.length === 0) return null;

  const activeKey = getApiKey();
  if (activeKey && activeKey.length >= 4 && cleaned.includes(activeKey)) {
    cleaned = cleaned.split(activeKey).join('[REDACTED_KEY]');
  }

  return cleaned.slice(0, maxLength);
}

let auditCounter = 0;

export function createAuditLogEvent(input: RecordAuditEventInput): AuditLogEvent {
  auditCounter += 1;
  const validatorResultClean =
    sanitizeAndTruncateAuditString(input.validatorResult, 500) ?? 'n/a';

  return {
    id: `audit_${Date.now()}_${auditCounter}`,
    timestamp: input.timestamp ?? new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    modelName: GEMINI_MODEL,
    mode: input.mode === 'REPAIR' ? 'REPAIR' : 'ANSWER',
    status: input.status,
    source: input.source,
    validatorResult: validatorResultClean,
    rowCount:
      typeof input.rowCount === 'number' && Number.isFinite(input.rowCount)
        ? input.rowCount
        : null,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    repairCount: Math.max(0, Math.floor(input.repairCount ?? 0)),
    failedSql: sanitizeAndTruncateAuditString(
      input.failedSql,
      MAX_AUDIT_SQL_LENGTH
    ),
    finalSql: sanitizeAndTruncateAuditString(
      input.finalSql,
      MAX_AUDIT_SQL_LENGTH
    ),
    ...(input.transportRetriesUsed !== undefined
      ? { transportRetriesUsed: Math.max(0, Math.floor(input.transportRetriesUsed)) }
      : {}),
    ...(input.retryDelayMs !== undefined
      ? { retryDelayMs: Math.max(0, Math.round(input.retryDelayMs)) }
      : {}),
    ...(input.jsonRetriesUsed !== undefined
      ? { jsonRetriesUsed: Math.max(0, Math.floor(input.jsonRetriesUsed)) }
      : {}),
  };
}


type AuditLogListener = (events: AuditLogEvent[]) => void;

export class AuditLogStore {
  private events: AuditLogEvent[] = [];
  private listeners = new Set<AuditLogListener>();

  record(input: RecordAuditEventInput): AuditLogEvent {
    const event = createAuditLogEvent(input);
    this.events.push(event);
    this.notify();
    return event;
  }

  getEvents(): AuditLogEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
    this.notify();
  }

  exportJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        promptVersion: PROMPT_VERSION,
        modelName: GEMINI_MODEL,
        eventCount: this.events.length,
        events: this.events,
      },
      null,
      2
    );
  }

  subscribe(listener: AuditLogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getEvents();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export const auditLog = new AuditLogStore();
