/**
 * Browser-Only Gemini LLM Client (/src/engine/llmClient.ts)
 *
 * Spec requirements:
 * - Uses @google/genai ONLY (pinned version 2.31.0).
 * - Uses GEMINI_MODEL and buildGenerationConfig() from /config.ts.
 * - NEVER switches configurations at runtime or on error.
 * - Reads the visitor's API key exclusively via /engine/keyStore.ts.
 * - Disables hidden internal SDK retry multiplication (httpOptions.retryOptions.attempts = 1)
 *   so Vimarsh's explicit, bounded transport retry policy is the single source of retries.
 * - Enforces an explicit 15s timeout on connectAndVerifyApiKey() and 22s per-request timeout
 *   (bounded by the 60s overall question deadline) with AbortController cancellation.
 */

import { GoogleGenAI, type Schema } from '@google/genai';
import {
  buildGenerationConfig,
  CONNECT_PROBE_SCHEMA,
  CONNECT_PROBE_TIMEOUT_MS,
  FALLBACK_GEMINI_MODELS,
  GEMINI_MODEL,
  MAX_RETRY_AFTER_CAP_MS,
  PER_REQUEST_TIMEOUT_MS,
} from '../config';
import type { ByokConnectionState, ByokStatus, ProbeTelemetry } from '../types';
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
  timeoutMs?: number;
}

export interface RawLlmCallOutput {
  rawText: string;
  finishReason: string | null;
}

export type LlmTransportFn = (params: RawLlmCallParams) => Promise<RawLlmCallOutput>;

/**
 * Strips invisible zero-width characters, surrounding quotes, and whitespace
 * that can cause browser fetch() Headers.append('x-goog-api-key', ...) to throw a TypeError.
 */
export function sanitizeApiKey(rawKey: string): string {
  return (rawKey ?? '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

function isValidHeaderAsciiKey(key: string): boolean {
  return key.length > 0 && /^[\x21-\x7E]+$/.test(key);
}

function isApiKeyAuthError(status: number | null, msg: string): boolean {
  if (status === 401 || status === 403) {
    return true;
  }
  return /\b(?:401|403|API_KEY_INVALID|API_KEY_EXPIRED|API_KEY_NOT_FOUND|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_SERVICE_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED|PERMISSION_DENIED|UNAUTHENTICATED|invalid api key|api key not valid|api key expired|pass a valid api key)\b/i.test(
    msg
  );
}

function extractStatusAndMessage(err: unknown): {
  status: number | null;
  msg: string;
} {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const errObj =
    typeof err === 'object' && err !== null
      ? (err as Record<string, unknown>)
      : {};
  const status =
    typeof errObj.status === 'number'
      ? errObj.status
      : typeof errObj.statusCode === 'number'
        ? errObj.statusCode
        : null;
  return { status, msg };
}

function shouldTryFallbackModel(err: unknown): boolean {
  const { status, msg } = extractStatusAndMessage(err);
  if (isApiKeyAuthError(status, msg)) {
    return false;
  }
  // Permit fallback ONLY for temporary service unavailability (503) or model unavailability (404)
  return (
    status === 404 ||
    status === 503 ||
    /\b(?:503|404|UNAVAILABLE|NOT_FOUND|model.*not found)\b/i.test(msg)
  );
}

/**
 * Default transport that routes browser requests through the server-side `/api/gemini/generate`
 * endpoint (eliminating `PROXY_GENERATION_DISABLED: generateContent is not supported` in AI Studio's
 * browser preview iframe) while supporting direct Node.js SDK execution in CLI/Node test contexts.
 */
export const defaultGeminiTransport: LlmTransportFn = async (
  params: RawLlmCallParams
): Promise<RawLlmCallOutput> => {
  const cleanKey = sanitizeApiKey(params.apiKey);
  if (!isValidHeaderAsciiKey(cleanKey)) {
    const invalidErr = new Error(
      '401 API_KEY_INVALID: API key contains invalid characters.'
    ) as Error & { status?: number };
    invalidErr.status = 401;
    throw invalidErr;
  }

  // In the browser, call the Express server-side proxy (/api/gemini/generate)
  // so @google/genai runs server-side and never triggers PROXY_GENERATION_DISABLED.
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    const response = await window.fetch('/api/gemini/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: cleanKey,
        systemInstruction: params.systemInstruction,
        userContent: params.userContent,
        schemaOverride: params.schemaOverride,
      }),
      signal: params.abortSignal,
    });

    let payload: {
      ok?: boolean;
      rawText?: string;
      finishReason?: string | null;
      status?: number;
      message?: string;
    } | null;

    try {
      payload = (await response.json()) as {
        ok?: boolean;
        rawText?: string;
        finishReason?: string | null;
        status?: number;
        message?: string;
      };
    } catch {
      payload = null;
    }

    if (response.ok && payload && payload.ok) {
      return {
        rawText: typeof payload.rawText === 'string' ? payload.rawText : '',
        finishReason: payload.finishReason ?? 'STOP',
      };
    }

    const errStatus = payload?.status ?? response.status ?? 500;
    const errMsg =
      payload?.message ??
      `Gemini proxy request failed with HTTP ${response.status}.`;
    const proxyErr = new Error(errMsg) as Error & { status?: number };
    proxyErr.status = errStatus;
    throw proxyErr;
  }

  // Node.js execution (CLI / Vitest runner)
  const ai = new GoogleGenAI({
    apiKey: cleanKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
      retryOptions: {
        attempts: 1,
      },
    },
  });

  const modelsToTry = [GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS];
  let lastErr: unknown;

  const extractResponseOutput = (response: {
    text?: string | (() => string);
    candidates?: Array<{ finishReason?: unknown }>;
  }): RawLlmCallOutput => {
    const rawText =
      typeof response.text === 'function'
        ? (response.text as () => string)()
        : (response.text ?? '');
    const finishReason =
      response.candidates && response.candidates.length > 0
        ? String(response.candidates[0]?.finishReason ?? 'STOP')
        : 'STOP';
    return { rawText, finishReason };
  };

  for (let i = 0; i < modelsToTry.length; i++) {
    if (params.abortSignal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }
    const candidateModel = modelsToTry[i];
    try {
      const config = buildGenerationConfig(
        params.systemInstruction,
        params.schemaOverride,
        {
          abortSignal: params.abortSignal,
        }
      );
      const response = await ai.models.generateContent({
        model: candidateModel,
        contents: params.userContent,
        config,
      });
      return extractResponseOutput(response);
    } catch (err) {
      lastErr = err;
      if (
        i < modelsToTry.length - 1 &&
        !params.abortSignal?.aborted &&
        shouldTryFallbackModel(lastErr)
      ) {
        continue;
      }
      throw lastErr;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error('Gemini request failed.');
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
    | 'timeout'
    | 'aborted'
    | 'network_error';
  safeMessage: string;
}

function createTimeoutError(timeoutMs: number, contextLabel: string): Error {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const err = new Error(
    `${contextLabel} was cancelled or timed out after ${seconds}s waiting for Gemini (${GEMINI_MODEL}). Please check your connection or retry.`
  );
  err.name = 'TimeoutError';
  return err;
}

/**
 * Executes a single transport call with a linked AbortController and hard timeout.
 * Guarantees that timers and abort listeners are cleaned up on every exit path,
 * and aborts the underlying request immediately on timeout or caller cancellation.
 */
async function runTransportWithAbortAndTimeout(
  transport: LlmTransportFn,
  params: RawLlmCallParams,
  timeoutMs: number,
  callerSignal?: AbortSignal,
  contextLabel: string = 'Gemini request'
): Promise<RawLlmCallOutput> {
  if (callerSignal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }
  const boundedTimeoutMs = Math.max(1, Math.ceil(timeoutMs));
  const attemptController = new AbortController();
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let onCallerAbort: (() => void) | null = null;

  const raceAbortPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      const timeoutErr = createTimeoutError(boundedTimeoutMs, contextLabel);
      attemptController.abort(timeoutErr);
      reject(timeoutErr);
    }, boundedTimeoutMs);

    if (callerSignal) {
      onCallerAbort = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        const abortReason = callerSignal.reason;
        const abortErr =
          abortReason instanceof Error && abortReason.name === 'TimeoutError'
            ? abortReason
            : new DOMException('Request aborted', 'AbortError');
        attemptController.abort(abortErr);
        reject(abortErr);
      };
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  });

  try {
    return await Promise.race([
      transport({
        ...params,
        abortSignal: attemptController.signal,
        timeoutMs: boundedTimeoutMs,
      }),
      raceAbortPromise,
    ]);
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    if (callerSignal && onCallerAbort) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
}

/**
 * Extracts HTTP status, Retry-After header (if any), and safe classification without leaking raw API key or body.
 * Never marks timeout, abort, invalid_key, model_unavailable, config_rejected, or permanent quota exhaustion as retryable.
 */
export function classifyGeminiError(err: unknown): ClassifiedApiError {
  if (err instanceof Error && err.name === 'TimeoutError') {
    return {
      httpStatus: null,
      retryable: false,
      retryAfterMs: null,
      category: 'timeout',
      safeMessage: err.message,
    };
  }

  const { status: rawStatus, msg } = extractStatusAndMessage(err);

  if (
    rawStatus === 504 ||
    /timed?\s*out|timeout|deadline[_\s]+exceeded|deadline\s+expired/i.test(msg)
  ) {
    return {
      httpStatus: rawStatus === 504 ? 504 : null,
      retryable: false,
      retryAfterMs: null,
      category: 'timeout',
      safeMessage:
        'Request was cancelled or timed out while waiting for Gemini. Please check your connection and try again.',
    };
  }

  if (
    err instanceof Error &&
    (err.name === 'AbortError' || /aborted|cancelled|canceled/i.test(msg))
  ) {
    return {
      httpStatus: null,
      retryable: false,
      retryAfterMs: null,
      category: 'aborted',
      safeMessage: 'Request was cancelled or timed out.',
    };
  }

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

  if (isApiKeyAuthError(rawStatus, msg)) {
    return {
      httpStatus: rawStatus ?? 401,
      retryable: false,
      retryAfterMs: null,
      category: 'invalid_key',
      safeMessage:
        'Invalid key (401/403): the Gemini API rejected this key. Please verify that your Google AI Studio API key is active and valid.',
    };
  }

  const is429 =
    rawStatus === 429 ||
    /\b(?:429|RESOURCE_EXHAUSTED|quota|rate limit|too many requests)\b/i.test(msg);
  if (is429) {
    // Distinguish permanent/daily/zero-limit quota exhaustion from transient per-minute rate limits
    const isPermanentQuota =
      /\b(?:limit:\s*0|per_?day|perday|daily|billing|plan and billing|quota_exceeded_for_metric|exceeded your current quota)\b/i.test(
        msg
      ) ||
      (retryAfterMs !== null && retryAfterMs > MAX_RETRY_AFTER_CAP_MS);

    if (isPermanentQuota) {
      return {
        httpStatus: 429,
        retryable: false,
        retryAfterMs,
        category: 'quota_exceeded',
        safeMessage:
          'Quota exceeded (429): daily or project quota is exhausted for this API key. Check your Google AI Studio quota/billing or use another key.',
      };
    }

    return {
      httpStatus: 429,
      retryable: true,
      retryAfterMs,
      category: 'quota_exceeded',
      safeMessage: 'Quota exceeded (429): rate limit or quota reached.',
    };
  }

  const is502or503 =
    rawStatus === 500 ||
    rawStatus === 502 ||
    rawStatus === 503 ||
    /\b(?:502|503|UNAVAILABLE|BAD_GATEWAY|overloaded|temporarily unavailable|high demand)\b/i.test(
      msg
    );
  if (is502or503) {
    return {
      httpStatus: rawStatus ?? 503,
      retryable: true,
      retryAfterMs,
      category: 'service_unavailable',
      safeMessage:
        'Service temporarily unavailable (503): Google Gemini is experiencing high demand. Automatic retries with exponential backoff were exhausted — please click Retry to try again without reloading.',
    };
  }

  const is404 =
    rawStatus === 404 ||
    /\b(?:404|NOT_FOUND|model.*not found|is not found for API version|not supported for generateContent|no longer available to new users)\b/i.test(
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
    /\b(?:400|INVALID_ARGUMENT|response_schema|responseSchema|response_mime_type|responseMimeType|responseFormat)\b/i.test(
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

  const isTransientFetchError =
    err instanceof TypeError &&
    /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(
      msg
    );

  return {
    httpStatus: rawStatus,
    retryable: isTransientFetchError,
    retryAfterMs: null,
    category: 'network_error',
    safeMessage:
      "Network error: could not reach Google's Gemini API. Check your connection and try again.",
  };
}

/**
 * Computes exponential backoff delay (baseBackoffMs * 2^(attempt - 1)),
 * honoring an explicit Retry-After header when present and capping at maxBackoffMs.
 */
export function computeExponentialBackoffMs(
  attempt: number,
  baseBackoffMs: number = BASE_BACKOFF_MS,
  retryAfterMs: number | null = null,
  maxBackoffMs: number = MAX_RETRY_AFTER_CAP_MS
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  if (retryAfterMs !== null && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(Math.round(retryAfterMs), maxBackoffMs);
  }
  const exponentialDelay = baseBackoffMs * Math.pow(2, safeAttempt - 1);
  return Math.min(Math.round(exponentialDelay), maxBackoffMs);
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const reason = signal.reason;
      reject(
        reason instanceof Error && reason.name === 'TimeoutError'
          ? reason
          : new DOMException('Aborted', 'AbortError')
      );
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
      const reason = signal?.reason;
      reject(
        reason instanceof Error && reason.name === 'TimeoutError'
          ? reason
          : new DOMException('Aborted', 'AbortError')
      );
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
  requestTimeoutMs?: number;
  deadlineTimestampMs?: number;
}

export interface LlmCallWithRetriesResult {
  rawText: string;
  finishReason: string | null;
  transportRetriesUsed: number;
  retryDelayMs: number;
  latencyMs: number;
}

/**
 * Calls the Gemini model using the key in `keyStore`, retrying transient HTTP 429/503
 * at most 2 times with exponential backoff (honoring Retry-After if present).
 * Enforces both a per-request timeout (~22s) and the caller's overall question deadline.
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
  const perRequestTimeoutMs = options.requestTimeoutMs ?? PER_REQUEST_TIMEOUT_MS;
  const startTime = performance.now();
  let transportRetriesUsed = 0;
  let retryDelayMs = 0;

  while (true) {
    if (options.abortSignal?.aborted) {
      const reason = options.abortSignal.reason;
      const errToThrow =
        reason instanceof Error && reason.name === 'TimeoutError'
          ? reason
          : new DOMException('Request aborted', 'AbortError');
      const classified = classifyGeminiError(errToThrow);
      const wrapped = new Error(classified.safeMessage);
      (wrapped as Error & { classified?: ClassifiedApiError }).classified =
        classified;
      throw wrapped;
    }

    let effectiveTimeoutMs = perRequestTimeoutMs;
    if (options.deadlineTimestampMs !== undefined) {
      const remainingDeadlineMs = options.deadlineTimestampMs - performance.now();
      if (remainingDeadlineMs <= 0) {
        const timeoutErr = createTimeoutError(
          perRequestTimeoutMs,
          'Question pipeline deadline'
        );
        const classified = classifyGeminiError(timeoutErr);
        const wrapped = new Error(classified.safeMessage);
        (wrapped as Error & { classified?: ClassifiedApiError }).classified =
          classified;
        throw wrapped;
      }
      effectiveTimeoutMs = Math.min(perRequestTimeoutMs, remainingDeadlineMs);
    }

    try {
      const output = await runTransportWithAbortAndTimeout(
        transport,
        {
          apiKey,
          systemInstruction: options.systemInstruction,
          userContent: options.userContent,
        },
        effectiveTimeoutMs,
        options.abortSignal,
        'Gemini request'
      );
      return {
        rawText: output.rawText,
        finishReason: output.finishReason,
        transportRetriesUsed,
        retryDelayMs,
        latencyMs: Math.max(1, Math.round(performance.now() - startTime)),
      };
    } catch (err) {
      const classified = classifyGeminiError(err);
      if (
        classified.retryable &&
        transportRetriesUsed < MAX_TRANSPORT_RETRIES &&
        !options.abortSignal?.aborted
      ) {
        const nextAttempt = transportRetriesUsed + 1;
        const waitMs = computeExponentialBackoffMs(
          nextAttempt,
          baseBackoff,
          classified.retryAfterMs,
          MAX_RETRY_AFTER_CAP_MS
        );

        // Do not sleep or retry if the backoff delay would exceed the remaining question deadline
        const withinDeadline =
          options.deadlineTimestampMs === undefined ||
          performance.now() + waitMs < options.deadlineTimestampMs;

        if (withinDeadline) {
          transportRetriesUsed = nextAttempt;
          retryDelayMs += waitMs;
          try {
            await sleepWithAbort(waitMs, options.abortSignal);
          } catch (sleepErr) {
            const sleepClassified = classifyGeminiError(sleepErr);
            const wrappedSleep = new Error(sleepClassified.safeMessage);
            (
              wrappedSleep as Error & { classified?: ClassifiedApiError }
            ).classified = sleepClassified;
            throw wrappedSleep;
          }
          continue;
        }
      }

      const wrapped = new Error(classified.safeMessage);
      (wrapped as Error & { classified?: ClassifiedApiError }).classified =
        classified;
      throw wrapped;
    }
  }
}

export interface ConnectVerifyOptions {
  baseBackoffMs?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  onStatusUpdate?: (state: ByokConnectionState) => void;
}

let activeConnectProbePromise: Promise<ByokConnectionState> | null = null;
let activeConnectProbeController: AbortController | null = null;
let lastProbeTelemetry: ProbeTelemetry | null = null;

export function isConnectProbeInFlight(): boolean {
  return activeConnectProbePromise !== null;
}

export function cancelActiveConnectProbe(): void {
  if (activeConnectProbeController) {
    activeConnectProbeController.abort(
      new DOMException('Connection probe cancelled', 'AbortError')
    );
    activeConnectProbeController = null;
  }
}

export function getLastProbeTelemetry(): ProbeTelemetry | null {
  return lastProbeTelemetry ? { ...lastProbeTelemetry } : null;
}

function recordProbeTelemetry(
  t0: number,
  status: ByokStatus,
  transportRetriesUsed: number,
  retryDelayMs: number
): ByokStatus {
  lastProbeTelemetry = {
    durationMs: Math.max(1, Math.round(performance.now() - t0)),
    status,
    transportRetriesUsed,
    retryDelayMs,
    timestamp: new Date().toISOString(),
  };
  return status;
}

/**
 * Connects and verifies a visitor-typed Gemini API key by making ONE tiny structured-output
 * request using `buildGenerationConfig()` and `GEMINI_MODEL` in `/config.ts`,
 * bounded by an explicit 15-second connection timeout (`CONNECT_PROBE_TIMEOUT_MS`) and
 * guarded against concurrent duplicate connection probes.
 */
export async function connectAndVerifyApiKey(
  candidateKey: string,
  transport: LlmTransportFn = defaultGeminiTransport,
  options?: ConnectVerifyOptions
): Promise<ByokConnectionState> {
  if (activeConnectProbePromise) {
    return activeConnectProbePromise;
  }

  const runProbe = async (): Promise<ByokConnectionState> => {
    const t0 = performance.now();
    const trimmed = sanitizeApiKey(candidateKey);
    if (trimmed.length === 0) {
      recordProbeTelemetry(t0, 'invalid_key', 0, 0);
      return setConnectionStatus(
        'invalid_key',
        'Invalid key (401/403): please enter a non-empty Gemini API key.'
      );
    }
    if (!isValidHeaderAsciiKey(trimmed)) {
      recordProbeTelemetry(t0, 'invalid_key', 0, 0);
      return setConnectionStatus(
        'invalid_key',
        'Invalid key (401/403): API key contains invalid or non-ASCII characters. Please paste a valid Gemini API key.'
      );
    }

    const baseBackoff = options?.baseBackoffMs ?? BASE_BACKOFF_MS;
    const probeTimeoutMs = options?.timeoutMs ?? CONNECT_PROBE_TIMEOUT_MS;
    const probeDeadlineTimestampMs = t0 + probeTimeoutMs;
    const probeController = new AbortController();
    activeConnectProbeController = probeController;

    let onCallerAbort: (() => void) | null = null;
    if (options?.abortSignal) {
      if (options.abortSignal.aborted) {
        recordProbeTelemetry(t0, 'network_error', 0, 0);
        return setConnectionStatus(
          'network_error',
          'Connection verification was cancelled.'
        );
      }
      onCallerAbort = () => {
        probeController.abort(
          options.abortSignal?.reason ??
            new DOMException('Connection probe aborted', 'AbortError')
        );
      };
      options.abortSignal.addEventListener('abort', onCallerAbort, {
        once: true,
      });
    }

    const initialConnecting = setConnectionStatus(
      'connecting',
      'Verifying your API key with Gemini...'
    );
    options?.onStatusUpdate?.(initialConnecting);

    let attempt = 0;
    let totalRetryDelayMs = 0;

    try {
      while (true) {
        const remainingMs = probeDeadlineTimestampMs - performance.now();
        if (remainingMs <= 0) {
          throw createTimeoutError(probeTimeoutMs, 'API key verification');
        }

        try {
          const probeOutput = await runTransportWithAbortAndTimeout(
            transport,
            {
              apiKey: trimmed,
              systemInstruction:
                'Return only the exact JSON object {"ok": true}.',
              userContent: 'Respond with JSON {"ok": true}',
              schemaOverride: CONNECT_PROBE_SCHEMA,
            },
            remainingMs,
            probeController.signal,
            'API key verification'
          );

          const parsed = parseStrictJsonResponse(
            probeOutput.rawText,
            probeOutput.finishReason
          );
          if (!parsed.ok || parsed.data.ok !== true) {
            recordProbeTelemetry(
              t0,
              'config_rejected',
              attempt,
              totalRetryDelayMs
            );
            return setConnectionStatus(
              'config_rejected',
              'Configuration rejected: buildGenerationConfig() in /config.ts did not return a valid {"ok": true} object.'
            );
          }

          recordProbeTelemetry(t0, 'connected', attempt, totalRetryDelayMs);
          return setConnectedApiKey(trimmed);
        } catch (err) {
          const classified = classifyGeminiError(err);

          if (
            classified.retryable &&
            attempt < MAX_TRANSPORT_RETRIES &&
            !probeController.signal.aborted
          ) {
            const nextAttempt = attempt + 1;
            const waitMs = computeExponentialBackoffMs(
              nextAttempt,
              baseBackoff,
              classified.retryAfterMs,
              MAX_RETRY_AFTER_CAP_MS
            );

            // Only retry if the backoff delay and next attempt fit inside the 15s probe deadline
            if (performance.now() + waitMs < probeDeadlineTimestampMs) {
              attempt = nextAttempt;
              totalRetryDelayMs += waitMs;
              const retryLabel =
                classified.category === 'service_unavailable'
                  ? `Gemini service busy (503). Retrying with exponential backoff (attempt ${attempt} of ${MAX_TRANSPORT_RETRIES})...`
                  : `Rate limit reached (429). Retrying with exponential backoff (attempt ${attempt} of ${MAX_TRANSPORT_RETRIES})...`;
              const retryState = setConnectionStatus('connecting', retryLabel);
              options?.onStatusUpdate?.(retryState);
              await sleepWithAbort(waitMs, probeController.signal);
              continue;
            }
          }

          let finalStatus: ByokStatus = 'network_error';
          switch (classified.category) {
            case 'invalid_key':
              finalStatus = 'invalid_key';
              break;
            case 'quota_exceeded':
              finalStatus = 'quota_exceeded';
              break;
            case 'service_unavailable':
              finalStatus = 'service_unavailable';
              break;
            case 'model_unavailable':
              finalStatus = 'model_unavailable';
              break;
            case 'config_rejected':
              finalStatus = 'config_rejected';
              break;
            default:
              finalStatus = 'network_error';
              break;
          }

          recordProbeTelemetry(t0, finalStatus, attempt, totalRetryDelayMs);
          return setConnectionStatus(finalStatus, classified.safeMessage);
        }
      }
    } finally {
      if (options?.abortSignal && onCallerAbort) {
        options.abortSignal.removeEventListener('abort', onCallerAbort);
      }
      if (activeConnectProbeController === probeController) {
        activeConnectProbeController = null;
      }
    }
  };

  activeConnectProbePromise = runProbe().finally(() => {
    activeConnectProbePromise = null;
  });

  return activeConnectProbePromise;
}

