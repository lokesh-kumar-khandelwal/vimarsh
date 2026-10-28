import { Type, type GenerateContentConfig, type Schema } from '@google/genai';

export const GEMINI_MODEL = 'gemini-flash-latest';

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

export function buildGenerationConfig(
  systemInstruction?: string,
  schemaOverride?: Schema
): GenerateContentConfig {
  const config: GenerateContentConfig = {
    temperature: 0.1,
    responseMimeType: 'application/json',
    responseSchema: schemaOverride ?? VIMARSH_RESPONSE_SCHEMA,
  };
  if (systemInstruction !== undefined) {
    config.systemInstruction = systemInstruction;
  }
  return config;
}
