import {
  ThinkingLevel,
  Type,
  type GenerateContentConfig,
  type Schema,
} from '@google/genai';

/**
 * Primary Model: gemini-3.5-flash-lite
 * Official stable Google Gemini model recommended for low-latency text and structured output.
 * Fully supports responseSchema and thinkingConfig (thinkingLevel: MINIMAL).
 */
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';

/**
 * Fallback Model: gemini-3.1-flash-lite
 * Exactly ONE fallback model, invoked ONLY for temporary service unavailability (HTTP 503)
 * or model unavailability (HTTP 404) when at least 10 seconds of request-deadline budget remains.
 */
export const FALLBACK_GEMINI_MODELS = ['gemini-3.1-flash-lite'] as const;

/**
 * Explicit timing policy:
 * - Connection-probe timeout: 15 seconds maximum.
 * - Individual model request timeout: 20 seconds maximum.
 * - Entire server-side generation operation (including allowed fallback): 30 seconds maximum.
 * - Entire question pipeline deadline: 60 seconds maximum (including JSON retries and SQL repairs).
 */
export const CONNECT_PROBE_TIMEOUT_MS = 15_000;
export const PER_REQUEST_TIMEOUT_MS = 25_000;
export const SERVER_OPERATION_TIMEOUT_MS = 30_000;
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

/**
 * Validates whether an incoming schemaOverride is one of the known, authorized schemas.
 * Permitted: CONNECT_PROBE_SCHEMA and VIMARSH_RESPONSE_SCHEMA.
 */
export function isAuthorizedSchemaOverride(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  const s = schema as Record<string, unknown>;
  if (s.type !== 'OBJECT' && s.type !== Type.OBJECT) {
    return false;
  }
  const props = s.properties as Record<string, unknown> | undefined;
  if (!props || typeof props !== 'object') {
    return false;
  }

  // Probe schema check: exactly { ok: { type: BOOLEAN } }
  const isProbe =
    Object.keys(props).length === 1 &&
    props.ok !== undefined &&
    Array.isArray(s.required) &&
    s.required.length === 1 &&
    s.required[0] === 'ok';
  if (isProbe) {
    return true;
  }

  // Vimarsh response schema check: all 10 required keys
  const requiredKeys = [
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
  ];
  const hasAllKeys = requiredKeys.every((k) => k in props);
  return hasAllKeys;
}

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
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.MINIMAL,
    },
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


