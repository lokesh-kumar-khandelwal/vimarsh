/**
 * Vimarsh: Text-to-SQL Clarification Engine (spec v6.3)
 * Core domain types, JSON contract, SQL validator types, Worker protocol, and Stage 3 LLM/Pipeline types.
 */

/**
 * Branded type for SQL strings that have passed all static safety checks (Steps 1-8)
 * in sqlValidator. Only sqlValidator may construct this type.
 */
declare const ValidatedSqlBrand: unique symbol;
export type ValidatedSql = string & { readonly [ValidatedSqlBrand]: 'ValidatedSql' };

/**
 * Single source of truth for the LLM JSON response contract.
 * Exact 10 keys required by spec v6.3.
 */
export type VimarshStatus = 'SUCCESS' | 'CLARIFY' | 'REJECT';

export interface VimarshResponse {
  status: VimarshStatus;
  reasoning: string;
  sql_query: string | null;
  follow_up_question: string | null;
  clarification_options: string[];
  ambiguity_type: string | null;
  assumptions: string[];
  tables_used: string[];
  confidence: number;
  rejection_reason: string | null;
}

/**
 * Schema metadata structures built by /engine/schemaLoader.ts and /engine/context.ts
 */
export interface ForeignKeyInfo {
  id: number;
  seq: number;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onUpdate: string;
  onDelete: string;
}

export interface ColumnSchema {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  description: string;
  isSensitive: boolean;
  enumValues?: readonly string[];
  isFreeFormText?: boolean;
  foreignKey?: {
    toTable: string;
    toColumn: string;
  };
}

export interface TableSchema {
  name: string;
  description: string;
  rowCount: number;
  columns: ColumnSchema[];
  foreignKeys: ForeignKeyInfo[];
}

export interface JoinHint {
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
  expression: string;
  description: string;
}

export interface GlossaryEntry {
  term: string;
  category: 'metric' | 'entity' | 'date_rule' | 'default_rule';
  definition: string;
  formulaOrRule: string;
}

export interface SchemaContext {
  dialect: 'SQLite';
  tables: TableSchema[];
  joinHints: JoinHint[];
  enumValues: Record<string, readonly string[]>;
  freeFormColumns: readonly string[];
  glossary: GlossaryEntry[];
  sensitiveColumns: readonly string[];
  pragmaQueryOnly: boolean;
  pragmaForeignKeys: boolean;
}

/**
 * Trusted seed validation report returned by the Worker during initialization.
 */
export interface SeedCheckResult {
  id: string;
  name: string;
  category:
    | 'foreign_keys'
    | 'date_integrity'
    | 'coverage'
    | 'distinguishability'
    | 'connection_setup';
  passed: boolean;
  details: string;
}

export interface SeedReport {
  allPassed: boolean;
  generatedForDate: string;
  earliestOrderDate: string;
  wasmSource: 'cdn' | 'public-fallback' | 'node-local';
  setupSequence: string[];
  tableCounts: Record<string, number>;
  checks: SeedCheckResult[];
  completedAtMs: number;
}

/**
 * SQL Safety Engine (Steps 1-10) Types
 */
export type ValidationStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ValidationStepTrace {
  step: ValidationStepNumber;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  detail: string;
}

export interface SqlStaticValidationSuccess {
  valid: true;
  validatedSql: ValidatedSql;
  tablesUsed: string[];
  limitValue: number;
  steps: ValidationStepTrace[];
}

export interface SqlStaticValidationFailure {
  valid: false;
  failedStep: ValidationStepNumber;
  error: string;
  steps: ValidationStepTrace[];
}

export type SqlStaticValidationResult =
  | SqlStaticValidationSuccess
  | SqlStaticValidationFailure;

export interface SqlFullValidationResult {
  valid: boolean;
  validatedSql?: ValidatedSql;
  tablesUsed: string[];
  limitValue?: number;
  failedStep?: ValidationStepNumber;
  error?: string;
  steps: ValidationStepTrace[];
  dryRunDurationMs?: number;
}

/**
 * Worker Dry Run (Step 9) and Execution (Step 10) Results
 */
export interface DryRunResult {
  ok: true;
  durationMs: number;
}

export type SqlCellValue = string | number | null;

export interface QueryExecutionResult {
  columns: string[];
  rows: SqlCellValue[][];
  rowCount: number;
  truncated: boolean;
  isEmpty: boolean;
  emptyMessage: string | null;
  executionTimeMs: number;
}

/**
 * Typed Worker Message Protocol
 */
export type WorkerRequestType =
  | 'INIT'
  | 'RESET'
  | 'GET_SCHEMA_CONTEXT'
  | 'DRY_RUN'
  | 'EXECUTE';

export interface WorkerRequest {
  requestId: string;
  epoch: number;
  type: WorkerRequestType;
  payload?: {
    nowIsoLocal?: string;
    sql?: ValidatedSql;
  };
}

export interface InitSuccessPayload {
  seedReport: SeedReport;
  schemaContext: SchemaContext;
}

export interface WorkerSuccessResponse {
  requestId: string;
  epoch: number;
  ok: true;
  type: WorkerRequestType;
  data: InitSuccessPayload | SchemaContext | DryRunResult | QueryExecutionResult | unknown;
}

export interface WorkerErrorResponse {
  requestId: string;
  epoch: number;
  ok: false;
  type: WorkerRequestType;
  error: string;
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

/**
 * Stage 3: BYOK Key Store & Connection States
 */
export type ByokStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'invalid_key'
  | 'quota_exceeded'
  | 'model_unavailable'
  | 'config_rejected'
  | 'network_error';

export interface ByokConnectionState {
  status: ByokStatus;
  last4: string | null;
  message: string;
}

/**
 * Stage 3: Input Guard
 */
export interface InputGuardResult {
  allowed: boolean;
  sanitizedQuestion: string;
  rejectionReason: string | null;
  matchedPattern?: string;
}

/**
 * Stage 3: Conversation Timeline & Session Store
 */
export type OperatingMode = 'ANSWER' | 'REPAIR';
export type RepairErrorSource = 'VALIDATION' | 'EXECUTION';

export interface PendingClarificationState {
  original_question: string;
  round: number;
}

export interface UserConversationTurn {
  id: string;
  role: 'user';
  question: string;
  timestamp: string;
}

export interface AssistantConversationTurn {
  id: string;
  role: 'assistant';
  response: VimarshResponse;
  /**
   * Authoritative schema table names derived from the validated SQL's AST
   * (overrides response.tables_used in the UI when status is SUCCESS).
   */
  validatedTablesUsed: string[];
  executionResult?: QueryExecutionResult;
  repaired?: boolean;
  repairCount?: number;
  originalError?: string;
  blockedByGuard?: boolean;
  processingError?: boolean;
  latencyMs: number;
  trace: PipelineStageTrace[];
  timestamp: string;
}

export type ConversationTurn = UserConversationTurn | AssistantConversationTurn;

export interface SessionState {
  turns: ConversationTurn[];
  pending: PendingClarificationState | null;
}

/**
 * Stage 3: Audit Log (/engine/auditLog.ts)
 */
export type AuditEventSource =
  | 'INPUT_GUARD'
  | 'MODEL'
  | 'RESPONSE_VALIDATOR'
  | 'SQL_VALIDATOR'
  | 'EXECUTOR'
  | 'REPAIR'
  | 'RETRY_EXHAUSTED';

export interface AuditLogEvent {
  id: string;
  timestamp: string;
  promptVersion: string;
  modelName: string;
  mode: OperatingMode;
  status: VimarshStatus | 'ERROR';
  source: AuditEventSource;
  validatorResult: string;
  rowCount: number | null;
  latencyMs: number;
  repairCount: number;
  failedSql: string | null;
  finalSql: string | null;
}

/**
 * Stage 3: Engine Trace Stages for UI Inspection
 */
export interface PipelineStageTrace {
  stage:
    | 'INPUT_GUARD'
    | 'PROMPT_BUILD'
    | 'LLM_CALL'
    | 'STRICT_JSON_PARSE'
    | 'RESPONSE_VALIDATOR'
    | 'ROUND_LIMIT_CHECK'
    | 'SQL_VALIDATOR'
    | 'DRY_RUN'
    | 'WORKER_EXECUTE'
    | 'REPAIR_ATTEMPT';
  status: 'passed' | 'failed' | 'skipped';
  detail: string;
  durationMs: number;
}

/**
 * Stage 4: Evaluation & Date-Proof Golden Test Types
 */
export type GoldenTestCategory =
  | 'clear'
  | 'ambiguous'
  | 'malicious'
  | 'unsupported';

export interface GoldenTestCase {
  id: string;
  question: string;
  category: GoldenTestCategory;
  language?: 'en' | 'hi-hinglish';
  expected_status: VimarshStatus;
  expected_ambiguity_codes: string[];
  gold_sql: string | null;
}

export type EvaluationRunState = 'pending' | 'running' | 'completed' | 'errored' | 'skipped';

export interface GoldenTestEvalResult {
  testId: string;
  question: string;
  category: GoldenTestCategory;
  expectedStatus: VimarshStatus;
  expectedAmbiguityCodes: string[];
  substitutedGoldSql: string | null;
  runState: EvaluationRunState;
  actualStatus: VimarshStatus | null;
  actualAmbiguityCodes: string[];
  generatedSql: string | null;
  statusMatched: boolean;
  ambiguityCodeMatched: boolean | null;
  executionMatched: boolean | null;
  executionComparisonDetail: string;
  queriesExecuted: number;
  zeroQueriesOnNonSuccess: boolean;
  repaired: boolean;
  repairCount: number;
  latencyMs: number;
  errorDetail: string | null;
}

export interface EvaluationSummaryMetrics {
  totalTests: number;
  completedCount: number;
  erroredCount: number;
  skippedCount: number;
  statusAccuracy: string;
  clarificationPrecision: string;
  clarificationRecall: string;
  ambiguityCodeMatchRate: string;
  attackBlockRate: string;
  executionAccuracy: string;
  averageLatencyMs: string;
  allClarifyRejectExecutedZeroQueries: boolean;
}

/**
 * Pure test case result structure for Vitest and the Self-Tests UI panel.
 */
export interface TestCaseResult {
  id: string;
  suite:
    | 'seed_report'
    | 'sql_validator'
    | 'worker_executor'
    | 'date_helpers'
    | 'schema_context'
    | 'parser_smoke'
    | 'strict_json_parser'
    | 'history_serializer'
    | 'request_builder'
    | 'session_store'
    | 'golden_date_proof'
    | 'stage3_engine'
    | 'stage5_faults';
  name: string;
  passed: boolean;
  details: string;
  durationMs: number;
}

