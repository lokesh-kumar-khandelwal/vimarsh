import { Type, type GenerateContentConfig, type Schema } from '@google/genai';

export const GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const FALLBACK_GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
] as const;

export const CONNECT_PROBE_TIMEOUT_MS = 15_000;
export const PER_REQUEST_TIMEOUT_MS = 25_000;
export const PER_QUESTION_DEADLINE_MS = 60_000;
export const MAX_RETRY_AFTER_CAP_MS = 8_000;

export const SQL_JS_VERSION = '1.15.2';

export function getSqlWasmCdnUrl(file: string): string {
  return `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${SQL_JS_VERSION}/${file}`;
}

export function getSqlWasmFallbackUrl(file: string): string {
  return `/${file}`;
}

export const VIMARSH_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    status: {
      type: Type.STRING,
      enum: ['SUCCESS', 'CLARIFY', 'REJECT'],
      description: 'Outcome of analyzing the user question.',
    },
    reasoning: {
      type: Type.STRING,
      description: 'Concise explanation of how Vimarsh decided on this response.',
    },
    sql_query: {
      type: Type.STRING,
      nullable: true,
      description: 'Read-only SQLite SELECT query when status is SUCCESS; null otherwise.',
    },
    follow_up_question: {
      type: Type.STRING,
      nullable: true,
      description: 'Single focused clarifying question when status is CLARIFY; null otherwise.',
    },
    clarification_options: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '2 to 4 unique clickable options when status is CLARIFY; empty array otherwise.',
    },
    ambiguity_type: {
      type: Type.STRING,
      nullable: true,
      description: 'Comma-separated ambiguity codes from A1-A11 when status is CLARIFY; null otherwise.',
    },
    assumptions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Explicit defaults or assumptions applied.',
    },
    tables_used: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Schema table names referenced by the query.',
    },
    confidence: {
      type: Type.NUMBER,
      description: 'Model self-rating in [0, 1].',
    },
    rejection_reason: {
      type: Type.STRING,
      nullable: true,
      description: 'Clear reason why the request was rejected when status is REJECT; null otherwise.',
    },
  },
  required: [
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
  ],
};

export const CONNECT_PROBE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    ok: {
      type: Type.BOOLEAN,
      description: 'Must be true.',
    },
  },
  required: ['ok'],
};

export interface GenerationConfigOptions {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

export function buildGenerationConfig(
  systemInstruction?: string,
  schemaOverride?: Schema,
  options?: GenerationConfigOptions
): GenerateContentConfig {
  const config: GenerateContentConfig = {
    temperature: 0.1,
    responseMimeType: 'application/json',
    responseSchema: schemaOverride ?? VIMARSH_RESPONSE_SCHEMA,
    httpOptions: {
      retryOptions: {
        attempts: 1,
      },
      ...(options?.timeoutMs !== undefined && options.timeoutMs > 0
        ? { timeout: Math.ceil(options.timeoutMs) }
        : {}),
    },
  };
  if (systemInstruction !== undefined) {
    config.systemInstruction = systemInstruction;
  }
  if (options?.abortSignal) {
    config.abortSignal = options.abortSignal;
  }
  return config;
}

