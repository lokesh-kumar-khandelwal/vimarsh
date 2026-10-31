/**
 * Vimarsh Express Server (/server.ts)
 *
 * Implements a secure backend proxy for Google Gemini API calls, preventing client-side
 * credential exposure and resolving browser iframe proxy restrictions (such as
 * PROXY_GENERATION_DISABLED) in AI Studio Build.
 *
 * Security & Architectural Boundaries:
 * 1. Strict Credential Isolation:
 *    - BYOK Mode: If caller provides an API key, that key is used exclusively.
 *      Under no circumstance does the server fall back to or substitute the environment key.
 *    - Server-Managed Key Mode: Permitted only in development / preview environments
 *      (or when explicitly enabled via ALLOW_SERVER_MANAGED_KEY=true). Fails closed in production.
 * 2. Status Endpoint Privacy:
 *    - /api/gemini/status never exposes API keys or their last-4 characters.
 * 3. Strict Input & Schema Validation:
 *    - Validates userContent (non-empty, <= 5000 chars) and systemInstruction (<= 20000 chars).
 *    - Validates schemaOverride against authorized Vimarsh schemas only; rejects arbitrary schemas.
 * 4. Single-Owner Retry & Deadline Policy:
 *    - Bounded per-model call timeout (20s) and server operation ceiling (30s).
 *    - At most ONE fallback model (gemini-3.1-flash-lite) attempted only for transient 503/404.
 *    - No adaptive schema-stripping or endless key/model loops.
 * 5. In-Memory Rate Limiting & Concurrency Controls:
 *    - Enforces max 5 concurrent requests and 30 requests/minute/IP.
 *    - Documented limitation: In-memory state is local to this single process instance.
 */

import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, type Schema } from '@google/genai';
import {
  buildGenerationConfig,
  FALLBACK_GEMINI_MODELS,
  GEMINI_MODEL,
  isAuthorizedSchemaOverride,
  PER_REQUEST_TIMEOUT_MS,
  SERVER_OPERATION_TIMEOUT_MS,
} from './src/config';
import { sanitizeApiKey } from './src/engine/llmClient';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MAX_USER_CONTENT_LENGTH = 5_000;
export const MAX_SYSTEM_INSTRUCTION_LENGTH = 20_000;
export const MAX_CONCURRENT_REQUESTS = 5;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 30;

interface GenerateRequestBody {
  apiKey?: string;
  systemInstruction?: string;
  userContent?: string;
  schemaOverride?: Schema;
}

export function isValidHeaderAsciiKey(key: string): boolean {
  return key.length > 0 && /^[\x21-\x7E]+$/.test(key);
}

// In-memory rate limiting and concurrency tracking
let activeInFlightRequests = 0;
const ipRequestHistory = new Map<string, number[]>();

function getClientIp(req: Request): string {
  // If behind a trusted reverse proxy in Cloud Run, use the first address in x-forwarded-for, else req.ip
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp.length > 0) return firstIp;
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const timestamps = (ipRequestHistory.get(ip) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = timestamps[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  timestamps.push(now);
  ipRequestHistory.set(ip, timestamps);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimitsAndConcurrency(): void {
  activeInFlightRequests = 0;
  ipRequestHistory.clear();
}

export function extractSafeErrorDetails(err: unknown): {
  status: number;
  category: string;
  message: string;
} {
  const rawMsg = err instanceof Error ? err.message : String(err ?? '');
  const errObj =
    typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
  const rawStatus =
    typeof errObj.status === 'number'
      ? errObj.status
      : typeof errObj.statusCode === 'number'
        ? errObj.statusCode
        : null;

  if (
    rawStatus === 401 ||
    rawStatus === 403 ||
    /\b(?:401|403|API_KEY_INVALID|API_KEY_EXPIRED|PERMISSION_DENIED|UNAUTHENTICATED|api key not valid)\b/i.test(
      rawMsg
    )
  ) {
    return {
      status: 401,
      category: 'invalid_key',
      message: 'Invalid key (401/403): the Gemini API rejected this key.',
    };
  }

  if (
    rawStatus === 429 ||
    /\b(?:429|RESOURCE_EXHAUSTED|quota|rate limit|too many requests)\b/i.test(rawMsg)
  ) {
    const isDaily =
      /\b(?:limit:\s*0|per_?day|daily|billing|plan and billing|quota_exceeded_for_metric)\b/i.test(
        rawMsg
      );
    return {
      status: 429,
      category: 'quota_exceeded',
      message: isDaily
        ? 'Quota exceeded (429): daily or project quota is exhausted for this API key.'
        : 'Quota exceeded (429): rate limit reached. Please wait and try again.',
    };
  }

  if (
    rawStatus === 500 ||
    rawStatus === 502 ||
    rawStatus === 503 ||
    /\b(?:502|503|UNAVAILABLE|BAD_GATEWAY|overloaded|high demand)\b/i.test(rawMsg)
  ) {
    return {
      status: rawStatus ?? 503,
      category: 'service_unavailable',
      message: 'Service temporarily unavailable (503): Gemini is experiencing high demand.',
    };
  }

  if (
    rawStatus === 404 ||
    /\b(?:404|NOT_FOUND|model.*not found|is not found for API version)\b/i.test(rawMsg)
  ) {
    return {
      status: 404,
      category: 'model_unavailable',
      message: 'Model unavailable: requested Gemini model is not supported or not found.',
    };
  }

  if (
    rawStatus === 504 ||
    /\b(?:504|DEADLINE_EXCEEDED|Deadline expired|timed out|TimeoutError)\b/i.test(rawMsg)
  ) {
    return {
      status: 504,
      category: 'timeout',
      message: 'Request timed out waiting for the Gemini API.',
    };
  }

  if (
    err instanceof Error &&
    (err.name === 'AbortError' || /\b(?:aborted|cancelled)\b/i.test(rawMsg))
  ) {
    return {
      status: 499,
      category: 'aborted',
      message: 'Request was cancelled by client.',
    };
  }

  if (
    rawStatus === 400 ||
    /\b(?:400|INVALID_ARGUMENT|response_schema|responseSchema)\b/i.test(rawMsg)
  ) {
    return {
      status: 400,
      category: 'config_rejected',
      message: 'Configuration rejected: Gemini rejected the request parameters or schema.',
    };
  }

  return {
    status: 500,
    category: 'network_error',
    message: 'Upstream Gemini request failed.',
  };
}

export interface ServerAppOptions {
  clientFactory?: (apiKey: string) => {
    models: {
      generateContent: (params: {
        model: string;
        contents: unknown;
        config?: unknown;
      }) => Promise<any>;
    };
  };
}

export function createExpressApp(options?: ServerAppOptions): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Status endpoint: minimum non-sensitive info only, never leaking keys or last4
  app.get('/api/gemini/status', (_req: Request, res: Response) => {
    const envKey = sanitizeApiKey(
      process.env.GEMINI_API_KEY || process.env.API_KEY || ''
    );
    const isProduction = process.env.NODE_ENV === 'production';
    const allowManagedKey =
      process.env.ALLOW_SERVER_MANAGED_KEY === 'true' || !isProduction;
    const serverManagedKeyAvailable =
      isValidHeaderAsciiKey(envKey) && allowManagedKey;

    res.json({
      serverManagedKeyAvailable,
      byokRequired: !serverManagedKeyAvailable,
      model: GEMINI_MODEL,
    });
  });

  // Generation proxy endpoint
  app.post('/api/gemini/generate', async (req: Request, res: Response) => {
    const clientIp = getClientIp(req);

    // 1. In-memory Rate Limiting
    const rateCheck = checkRateLimit(clientIp);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
      res.status(429).json({
        ok: false,
        status: 429,
        errorCategory: 'rate_limit_exceeded',
        message: `Too many requests. Please wait ${rateCheck.retryAfterSeconds} seconds before trying again.`,
      });
      return;
    }

    // 2. Concurrency Control
    if (activeInFlightRequests >= MAX_CONCURRENT_REQUESTS) {
      res.setHeader('Retry-After', '2');
      res.status(503).json({
        ok: false,
        status: 503,
        errorCategory: 'server_busy',
        message: 'Server is handling maximum concurrent Gemini requests. Please retry in 2 seconds.',
      });
      return;
    }

    // 3. Request Validation
    const body = (req.body ?? {}) as GenerateRequestBody;

    if (typeof body.userContent !== 'string' || body.userContent.trim().length === 0) {
      res.status(400).json({
        ok: false,
        status: 400,
        errorCategory: 'validation_error',
        message: 'userContent must be a non-empty string.',
      });
      return;
    }

    if (body.userContent.length > MAX_USER_CONTENT_LENGTH) {
      res.status(400).json({
        ok: false,
        status: 400,
        errorCategory: 'validation_error',
        message: `userContent exceeds maximum length of ${MAX_USER_CONTENT_LENGTH} characters.`,
      });
      return;
    }

    if (
      body.systemInstruction !== undefined &&
      (typeof body.systemInstruction !== 'string' ||
        body.systemInstruction.length > MAX_SYSTEM_INSTRUCTION_LENGTH)
    ) {
      res.status(400).json({
        ok: false,
        status: 400,
        errorCategory: 'validation_error',
        message: `systemInstruction must be a string <= ${MAX_SYSTEM_INSTRUCTION_LENGTH} characters.`,
      });
      return;
    }

    if (body.schemaOverride !== undefined && !isAuthorizedSchemaOverride(body.schemaOverride)) {
      res.status(400).json({
        ok: false,
        status: 400,
        errorCategory: 'unauthorized_schema',
        message: 'Unsupported or unauthorized response schema override.',
      });
      return;
    }

    // 4. Credential Selection Policy
    const clientKey = sanitizeApiKey(body.apiKey ?? '');
    const envKey = sanitizeApiKey(
      process.env.GEMINI_API_KEY || process.env.API_KEY || ''
    );
    const isProduction = process.env.NODE_ENV === 'production';
    const allowManagedKey =
      process.env.ALLOW_SERVER_MANAGED_KEY === 'true' || !isProduction;

    let activeKey: string;
    let credentialMode: 'BYOK' | 'SERVER_MANAGED';

    if (clientKey.length > 0) {
      // BYOK Mode: Use strictly and exclusively the user's key.
      if (!isValidHeaderAsciiKey(clientKey)) {
        res.status(401).json({
          ok: false,
          status: 401,
          errorCategory: 'invalid_key',
          message: 'Invalid key (401/403): supplied API key contains invalid characters.',
        });
        return;
      }
      activeKey = clientKey;
      credentialMode = 'BYOK';
    } else {
      // Server-Managed Key Mode
      if (!allowManagedKey) {
        res.status(401).json({
          ok: false,
          status: 401,
          byokRequired: true,
          errorCategory: 'byok_required',
          message: 'Authentication required: server-managed key mode is restricted. Please provide your own Gemini API key (BYOK).',
        });
        return;
      }

      if (!isValidHeaderAsciiKey(envKey)) {
        res.status(401).json({
          ok: false,
          status: 401,
          errorCategory: 'key_missing',
          message: 'No API key provided and no server-managed key is configured.',
        });
        return;
      }

      activeKey = envKey;
      credentialMode = 'SERVER_MANAGED';
    }

    // 5. Execution with Strict Bounded Timeouts & Cancellation Propagation
    activeInFlightRequests += 1;
    const requestStartTime = Date.now();
    const serverAbortController = new AbortController();

    const onClientClose = () => {
      if (!res.writableEnded) {
        serverAbortController.abort(new DOMException('Client connection closed', 'AbortError'));
      }
    };
    res.on('close', onClientClose);

    // Hard ceiling for entire server generation operation (30s)
    const serverDeadlineTimer = setTimeout(() => {
      serverAbortController.abort(new Error('Server operation timed out (30s)'));
    }, SERVER_OPERATION_TIMEOUT_MS);

    try {
      const ai = options?.clientFactory
        ? options.clientFactory(activeKey)
        : new GoogleGenAI({
            apiKey: activeKey,
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              },
              retryOptions: {
                attempts: 1, // Single attempt in SDK; server controls retries
              },
            },
          });

      const config = buildGenerationConfig(
        body.systemInstruction,
        body.schemaOverride,
        {
          abortSignal: serverAbortController.signal,
        }
      );

      // Model sequence: primary model first, followed by at most ONE fallback for recoverable errors
      const candidateModels = [GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS];
      let lastCallError: unknown = null;
      let modelUsed = GEMINI_MODEL;

      for (let i = 0; i < candidateModels.length; i++) {
        if (serverAbortController.signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        const currentModel = candidateModels[i];
        const perModelController = new AbortController();
        const perModelTimer = setTimeout(() => {
          perModelController.abort(new Error(`Model request timed out (${PER_REQUEST_TIMEOUT_MS}ms)`));
        }, PER_REQUEST_TIMEOUT_MS);

        const onServerAbort = () => perModelController.abort(serverAbortController.signal.reason);
        serverAbortController.signal.addEventListener('abort', onServerAbort, { once: true });

        try {
          const modelConfig = {
            ...config,
            abortSignal: perModelController.signal,
          };
          const response = await ai.models.generateContent({
            model: currentModel,
            contents: body.userContent,
            config: modelConfig,
          });

          const rawText =
            typeof response.text === 'function'
              ? (response.text as () => string)()
              : (response.text ?? '');
          const resObj = response as any;
          const finishReason =
            resObj.candidates && resObj.candidates.length > 0
              ? String(resObj.candidates[0]?.finishReason ?? 'STOP')
              : 'STOP';

          clearTimeout(perModelTimer);
          serverAbortController.signal.removeEventListener('abort', onServerAbort);

          res.status(200).json({
            ok: true,
            rawText,
            finishReason,
            modelUsed: currentModel,
            credentialMode,
            durationMs: Date.now() - requestStartTime,
          });
          return;
        } catch (err) {
          clearTimeout(perModelTimer);
          serverAbortController.signal.removeEventListener('abort', onServerAbort);
          lastCallError = err;

          const errDetails = extractSafeErrorDetails(err);

          // BYOK credential failure must fail immediately; never fallback to other models or keys
          if (errDetails.category === 'invalid_key') {
            break;
          }

          // Non-retryable client errors (400, quota exhausted, abort) must not attempt fallback models
          if (
            errDetails.status === 400 ||
            errDetails.category === 'quota_exceeded' ||
            errDetails.category === 'aborted'
          ) {
            break;
          }

          // Permit at most one fallback model for recoverable 503 or 404, only if budget remains >= 10s
          const remainingBudgetMs = SERVER_OPERATION_TIMEOUT_MS - (Date.now() - requestStartTime);
          const canAttemptFallback =
            i === 0 &&
            candidateModels.length > 1 &&
            (errDetails.status === 503 || errDetails.status === 404) &&
            remainingBudgetMs >= 10_000 &&
            !serverAbortController.signal.aborted;

          if (canAttemptFallback) {
            modelUsed = candidateModels[1];
            continue;
          }

          break;
        }
      }

      // If loop exited without returning, format and return safe error
      const safeErr = extractSafeErrorDetails(lastCallError);
      res.status(safeErr.status).json({
        ok: false,
        status: safeErr.status,
        errorCategory: safeErr.category,
        message: safeErr.message,
        modelAttempted: modelUsed,
      });
    } finally {
      clearTimeout(serverDeadlineTimer);
      res.removeListener('close', onClientClose);
      activeInFlightRequests = Math.max(0, activeInFlightRequests - 1);
    }
  });

  return app;
}

export async function startServer(): Promise<void> {
  const app = createExpressApp();
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vimarsh server listening on http://0.0.0.0:${PORT} (model: ${GEMINI_MODEL})`);
  });
}

// Start server if executed directly
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  void startServer();
}
