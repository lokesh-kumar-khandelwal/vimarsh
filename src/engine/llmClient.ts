/**
 * Browser-Only Gemini LLM Client (/src/engine/llmClient.ts)
 *
 * Spec requirements:
 * - Uses @google/genai ONLY (pinned version 2.31.0).
 * - Uses GEMINI_MODEL and buildGenerationConfig() from /config.ts.
 * - NEVER switches configurations at runtime or on error.
 * - Reads the visitor's API key exclusively via /engine/keyStore.ts.
 * - Transport retry budget: at most 2 retries on HTTP 429/503 with exponential backoff,
 *   honoring Retry-After headers when present. Stop immediately on cancellation or non-retryable errors.
 * - Connect flow: makes ONE tiny structured-output probe using buildGenerationConfig() and GEMINI_MODEL
 *   asking for {"ok": true}, classifying outcomes into Connected (last 4 chars), Invalid key (401/403),
 *   Quota exceeded (429), Model unavailable (names GEMINI_MODEL in /config.ts),
 *   Configuration rejected (names buildGenerationConfig in /config.ts), or Network error.
 */

import { GoogleGenAI, type Schema } from '@google/genai';
import {
  buildGenerationConfig,
  CONNECT_PROBE_SCHEMA,
  GEMINI_MODEL,
} from '../config';
import type { ByokConnectionState } from '../types';
import {
  getApiKey,
  setConnectedApiKey,
  setConnectionStatus,
} from './keyStore';
import { parseStrictJsonResponse } from './responseValidator';

export const MAX_TRANSPORT_RETRIES = 2;
export const BASE_BACKOFF_MS = 600;

export interface RawLlmCallParams {
  apiKey: string;
  systemInstruction?: string;
  userContent: string;
  schemaOverride?: Schema;
  abortSignal?: AbortSignal;
}

export interface RawLlmCallOutput {
  rawText: string;
  finishReason: string | null;
}

export type LlmTransportFn = (params: RawLlmCallParams) => Promise<RawLlmCallOutput>;

/**
 * Default browser transport using @google/genai SDK directly with the visitor's key.
 */
export const defaultGeminiTransport: LlmTransportFn = async (
  params: RawLlmCallParams
): Promise<RawLlmCallOutput> => {
  const ai = new GoogleGenAI({ apiKey: params.apiKey });
  const config = buildGenerationConfig(
    params.systemInstruction,
    params.schemaOverride
  );
  if (params.abortSignal) {
    config.abortSignal = params.abortSignal;
  }

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: params.userContent,
    config,
  });

  const rawText =
    typeof response.text === 'function'
      ? (response.text as () => string)()
      : (response.text ?? '');
  const finishReason =
    response.candidates && response.candidates.length > 0
      ? String(response.candidates[0]?.finishReason ?? 'STOP')
      : null;

  return {
    rawText,
    finishReason,
  };
};

export interface ClassifiedApiError {
  httpStatus: number | null;
  retryable: boolean;
  retryAfterMs: number | null;
  category:
    | 'invalid_key'
    | 'quota_exceeded'
    | 'model_unavailable'
    | 'config_rejected'
    | 'service_unavailable'
    | 'aborted'
    | 'network_error';
  safeMessage: string;
}

/**
 * Extracts HTTP status, Retry-After header (if any), and safe classification without leaking raw API key or body.
 */
export function classifyGeminiError(err: unknown): ClassifiedApiError {
  if (
    err instanceof Error &&
    (err.name === 'AbortError' || /aborted|cancelled|canceled/i.test(err.message))
  ) {
    return {
      httpStatus: null,
      retryable: false,
      retryAfterMs: null,
      category: 'aborted',
      safeMessage: 'Request was cancelled or timed out.',
    };
  }

  const errObj =
    typeof err === 'object' && err !== null
      ? (err as Record<string, unknown>)
      : {};
  const rawStatus =
    typeof errObj.status === 'number'
      ? errObj.status
      : typeof errObj.statusCode === 'number'
        ? errObj.statusCode
        : null;
  const msg = err instanceof Error ? err.message : String(err ?? '');

  // Check for Retry-After in error headers or message
  let retryAfterMs: number | null = null;
  const retryMatch = /retry[-_\s]?after[:\s]+(\d+(?:\.\d+)?)\s*(ms|s|sec)?/i.exec(
    msg
  );
  if (retryMatch) {
    const val = Number(retryMatch[1]);
    const unit = (retryMatch[2] ?? 's').toLowerCase();
    if (Number.isFinite(val) && val > 0) {
      retryAfterMs = unit === 'ms' ? Math.round(val) : Math.round(val * 1000);
    }
  }

  const is401or403 =
    rawStatus === 401 ||
    rawStatus === 403 ||
    /\b(?:401|403|API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED|invalid api key)\b/i.test(
      msg
    );
  if (is401or403) {
    return {
      httpStatus: rawStatus ?? 401,
      retryable: false,
      retryAfterMs: null,
      category: 'invalid_key',
      safeMessage: 'Invalid key (401/403): the Gemini API rejected this key.',
    };
  }

  const is429 =
    rawStatus === 429 ||
    /\b(?:429|RESOURCE_EXHAUSTED|quota|rate limit|too many requests)\b/i.test(msg);
  if (is429) {
    return {
      httpStatus: 429,
      retryable: true,
      retryAfterMs,
      category: 'quota_exceeded',
      safeMessage: 'Quota exceeded (429): rate limit or quota reached.',
    };
  }

  const is503 =
    rawStatus === 503 ||
    /\b(?:503|UNAVAILABLE|overloaded|temporarily unavailable)\b/i.test(msg);
  if (is503) {
    return {
      httpStatus: 503,
      retryable: true,
      retryAfterMs,
      category: 'service_unavailable',
      safeMessage: 'Service temporarily unavailable (503).',
    };
  }

  const is404 =
    rawStatus === 404 ||
    /\b(?:404|NOT_FOUND|model.*not found|is not found for API version|not supported for generateContent)\b/i.test(
      msg
    );
  if (is404) {
    return {
      httpStatus: 404,
      retryable: false,
      retryAfterMs: null,
      category: 'model_unavailable',
      safeMessage: `Model unavailable: '${GEMINI_MODEL}' (configured in /config.ts) is unavailable or not supported.`,
    };
  }

  const is400 =
    rawStatus === 400 ||
    /\b(?:400|INVALID_ARGUMENT|response_schema|responseSchema|response_mime_type|responseMimeType|responseFormat|schema)\b/i.test(
      msg
    );
  if (is400) {
    return {
      httpStatus: 400,
      retryable: false,
      retryAfterMs: null,
      category: 'config_rejected',
      safeMessage:
        'Configuration rejected: buildGenerationConfig() in /config.ts was rejected by the Gemini API.',
    };
  }

  return {
    httpStatus: rawStatus,
    retryable: false,
    retryAfterMs: null,
    category: 'network_error',
    safeMessage:
      "Network error: could not reach Google's Gemini API. Check your connection and try again.",
  };
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export interface LlmCallWithRetriesOptions {
  systemInstruction: string;
  userContent: string;
  abortSignal?: AbortSignal;
  transport?: LlmTransportFn;
  baseBackoffMs?: number;
}

export interface LlmCallWithRetriesResult {
  rawText: string;
  finishReason: string | null;
  transportRetriesUsed: number;
  latencyMs: number;
}

/**
 * Calls the Gemini model using the key in `keyStore`, retrying HTTP 429/503 at most 2 times
 * with exponential backoff (honoring Retry-After if present).
 */
export async function callLlmWithTransportRetries(
  options: LlmCallWithRetriesOptions
): Promise<LlmCallWithRetriesResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Connect your API key to start');
  }

  const transport = options.transport ?? defaultGeminiTransport;
  const baseBackoff = options.baseBackoffMs ?? BASE_BACKOFF_MS;
  const startTime = performance.now();
  let transportRetriesUsed = 0;

  while (true) {
    if (options.abortSignal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    try {
      const output = await transport({
        apiKey,
        systemInstruction: options.systemInstruction,
        userContent: options.userContent,
        abortSignal: options.abortSignal,
      });
      return {
        rawText: output.rawText,
        finishReason: output.finishReason,
        transportRetriesUsed,
        latencyMs: Math.max(1, Math.round(performance.now() - startTime)),
      };
    } catch (err) {
      const classified = classifyGeminiError(err);
      if (
        classified.retryable &&
        transportRetriesUsed < MAX_TRANSPORT_RETRIES &&
        !options.abortSignal?.aborted
      ) {
        transportRetriesUsed += 1;
        const waitMs =
          classified.retryAfterMs !== null
            ? Math.min(classified.retryAfterMs, 10_000)
            : baseBackoff * Math.pow(2, transportRetriesUsed - 1);
        await sleepWithAbort(waitMs, options.abortSignal);
        continue;
      }

      const wrapped = new Error(classified.safeMessage);
      (wrapped as Error & { classified?: ClassifiedApiError }).classified =
        classified;
      throw wrapped;
    }
  }
}

/**
 * Connects and verifies a visitor-typed Gemini API key by making ONE tiny structured-output
 * request using `buildGenerationConfig()` and `GEMINI_MODEL` in `/config.ts`.
 */
export async function connectAndVerifyApiKey(
  candidateKey: string,
  transport: LlmTransportFn = defaultGeminiTransport
): Promise<ByokConnectionState> {
  const trimmed = (candidateKey ?? '').trim();
  if (trimmed.length === 0) {
    return setConnectionStatus(
      'invalid_key',
      'Invalid key (401/403): please enter a non-empty Gemini API key.'
    );
  }

  setConnectionStatus('connecting', 'Verifying API key and model configuration...');

  try {
    const probeOutput = await transport({
      apiKey: trimmed,
      userContent: 'Respond with JSON {"ok": true}',
      schemaOverride: CONNECT_PROBE_SCHEMA,
    });

    const parsed = parseStrictJsonResponse(
      probeOutput.rawText,
      probeOutput.finishReason
    );
    if (!parsed.ok || parsed.data.ok !== true) {
      return setConnectionStatus(
        'config_rejected',
        'Configuration rejected: buildGenerationConfig() in /config.ts did not return a valid {"ok": true} object.'
      );
    }

    return setConnectedApiKey(trimmed);
  } catch (err) {
    const classified = classifyGeminiError(err);
    switch (classified.category) {
      case 'invalid_key':
        return setConnectionStatus('invalid_key', classified.safeMessage);
      case 'quota_exceeded':
        return setConnectionStatus('quota_exceeded', classified.safeMessage);
      case 'model_unavailable':
        return setConnectionStatus('model_unavailable', classified.safeMessage);
      case 'config_rejected':
        return setConnectionStatus('config_rejected', classified.safeMessage);
      default:
        return setConnectionStatus('network_error', classified.safeMessage);
    }
  }
}
