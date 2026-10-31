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
 *    - Server-Managed Key Mode: Disabled by default in all environments.
 *      Permitted only when explicitly authorized (ALLOW_SERVER_MANAGED_KEY=true) AND
 *      authenticated via genuine platform identity in production, or local loopback in development.
 * 2. Status Endpoint Privacy:
 *    - /api/gemini/status never exposes API keys, key hashes, or last-4 characters.
 * 3. Strict Input & Schema Validation:
 *    - Validates userContent (non-empty, <= 5000 chars) and systemInstruction (<= 20000 chars).
 *    - Arbitrary client-supplied JSON schema objects are strictly rejected.
 *    - Requires authorized schemaId ('vimarsh_response' or 'connection_probe') matching the request purpose.
 * 4. Single-Owner Retry & Deadline Policy:
 *    - Bounded per-model call timeout (25s) and server operation ceiling (30s).
 *    - At most ONE fallback model (gemini-3.1-flash-lite) attempted only for transient 503/404.
 *    - No adaptive schema-stripping or endless key/model loops.
 * 5. Trusted Proxy & In-Memory Rate Limiting:
 *    - Express 'trust proxy' disabled by default; strictly validates TRUST_PROXY if configured.
 *    - Enforces max 5 concurrent requests and 30 requests/minute/IP with bounded map memory.
 */

import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import {
  buildGenerationConfig,
  FALLBACK_GEMINI_MODELS,
  GEMINI_MODEL,
  PER_REQUEST_TIMEOUT_MS,
  resolveAuthorizedSchema,
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
export const MAX_RATE_LIMIT_TRACKED_IPS = 1_000;

export interface GenerateRequestBody {
  apiKey?: string;
  systemInstruction?: string;
  userContent?: string;
  purpose?: string;
  schemaId?: string;
  schemaOverride?: unknown;
}

export function isValidHeaderAsciiKey(key: string): boolean {
  return key.length > 0 && /^[\x21-\x7E]+$/.test(key);
}

// In-memory rate limiting and concurrency tracking
let activeInFlightRequests = 0;
const ipRequestHistory = new Map<string, number[]>();

/**
 * Configures Express proxy trust safely.
 * Disabled by default. Only enabled when TRUST_PROXY is explicitly configured
 * with a valid hop count (integer) or trusted subnet descriptor.
 */
export function configureTrustProxy(app: express.Express): void {
  const rawTrust = process.env.TRUST_PROXY;
  if (!rawTrust || rawTrust === 'false' || rawTrust === '0') {
    app.set('trust proxy', false);
    return;
  }
  if (/^\d+$/.test(rawTrust.trim())) {
    const hops = parseInt(rawTrust.trim(), 10);
    app.set('trust proxy', hops > 0 ? hops : false);
    return;
  }
  if (/^(?:loopback|linklocal|uniquelocal)(?:,\s*(?:loopback|linklocal|uniquelocal))*$/.test(rawTrust.trim())) {
    app.set('trust proxy', rawTrust.trim());
    return;
  }
  // Safe fail-closed fallback on invalid or unrecognized proxy configuration
  app.set('trust proxy', false);
}

/**
 * Retrieves the effective client IP from Express req.ip.
 * When trust proxy is disabled (default), Express reads the socket address directly
 * and ignores client-supplied X-Forwarded-For headers.
 */
export function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Checks in-memory rate limits with opportunistic pruning of expired timestamps
 * and bounded map memory to prevent leak when queried by many distinct IPs.
 */
export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();

  // Opportunistic memory pruning if tracked map size exceeds threshold
  if (ipRequestHistory.size > MAX_RATE_LIMIT_TRACKED_IPS) {
    cleanupExpiredRateLimits(now);
  }

  const activeTimestamps = (ipRequestHistory.get(ip) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );

  if (activeTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = activeTimestamps[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  activeTimestamps.push(now);
  ipRequestHistory.set(ip, activeTimestamps);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function cleanupExpiredRateLimits(referenceTimeMs: number = Date.now()): void {
  for (const [key, tList] of ipRequestHistory.entries()) {
    const active = tList.filter((t) => referenceTimeMs - t < RATE_LIMIT_WINDOW_MS);
    if (active.length === 0) {
      ipRequestHistory.delete(key);
    } else {
      ipRequestHistory.set(key, active);
    }
  }
}

export function resetRateLimitsAndConcurrency(): void {
  activeInFlightRequests = 0;
  ipRequestHistory.clear();
}

/**
 * Evaluates whether a server-managed key is authorized for the given request.
 * Policy:
 * 1. Disabled by default in all environments (including development).
 * 2. Requires ALLOW_SERVER_MANAGED_KEY=true AND an environment API key.
 * 3. In production, requires verified trusted platform identity header (e.g. Google Cloud IAP header 'x-goog-authenticated-user-email' or verified reverse proxy 'x-authenticated-user').
 * 4. In development, requires loopback client IP (127.0.0.1, ::1, or localhost) to prevent exposing shared keys on public dev tunnels.
 */
export function isServerManagedKeyAuthorized(req: Request): boolean {
  const envKey = sanitizeApiKey(process.env.GEMINI_API_KEY || process.env.API_KEY || '');
  if (!isValidHeaderAsciiKey(envKey)) {
    return false;
  }
  if (process.env.ALLOW_SERVER_MANAGED_KEY !== 'true') {
    return false;
  }
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    // Production requires genuine platform identity
    const iapUser = req.headers['x-goog-authenticated-user-email'];
    const authUser = req.headers['x-authenticated-user'];
    return (
      (typeof iapUser === 'string' && iapUser.length > 0) ||
      (typeof authUser === 'string' && authUser.length > 0)
    );
  }
  // In development, require local loopback request
  const ip = req.ip || req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

export function extractSafeErrorDetails(err: unknown): {
  status: number;
  category:
    | 'invalid_key'
    | 'quota_exceeded'
    | 'service_unavailable'
    | 'model_unavailable'
    | 'timeout'
    | 'aborted'
    | 'config_rejected'
    | 'network_error';
  message: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
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
      retryable: false,
      retryAfterSeconds: null,
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
      retryable: !isDaily,
      retryAfterSeconds: isDaily ? null : 5,
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
      retryable: true,
      retryAfterSeconds: 3,
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
      retryable: false,
      retryAfterSeconds: null,
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
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  if (
    err instanceof Error &&
    (err.name === 'AbortError' || /\b(?:aborted|cancelled)\b/i.test(rawMsg))
  ) {
    return {
      status: 499,
      category: 'aborted',
      message: 'Request was cancelled before completion.',
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  if (rawStatus === 400 || /\b(?:INVALID_ARGUMENT|schema.*invalid|bad request)\b/i.test(rawMsg)) {
    return {
      status: 400,
      category: 'config_rejected',
      message: 'Configuration rejected: Gemini rejected the request parameters or schema.',
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  return {
    status: typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500,
    category: 'network_error',
    message: 'Upstream Gemini request failed.',
    retryable: false,
    retryAfterSeconds: null,
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
  configureTrustProxy(app);
  app.use(express.json({ limit: '1mb' }));

  // Status endpoint: minimum non-sensitive info only, never leaking keys, hashes, or last4
  app.get('/api/gemini/status', (req: Request, res: Response) => {
    const serverManagedKeyAvailable = isServerManagedKeyAuthorized(req);

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
        retryable: false,
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      });
      return;
    }

    // 2. Concurrency Control
    if (activeInFlightRequests >= MAX_CONCURRENT_REQUESTS) {
      res.setHeader('Retry-After', '2');
      res.status(503).json({
        ok: false,
        status: 503,
        errorCategory: 'service_unavailable',
        message: 'Server is handling maximum concurrent Gemini requests. Please retry in 2 seconds.',
        retryable: true,
        retryAfterSeconds: 2,
      });
      return;
    }

    // 3. Request Validation
    const body = (req.body ?? {}) as GenerateRequestBody;

    if (typeof body.userContent !== 'string' || body.userContent.trim().length === 0) {
      res.status(400).json({
        ok: false,
        status: 400,
        errorCategory: 'config_rejected',
        message: 'userContent must be a non-empty string.',
        retryable: false,
      });
      return;
    }

    if (body.userContent.length > MAX_USER_CONTENT_LENGTH) {
      res.status(400).json({
        ok: false,
        status: 400,
        errorCategory: 'config_rejected',
        message: `userContent exceeds maximum length of ${MAX_USER_CONTENT_LENGTH} characters.`,
        retryable: false,
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
        errorCategory: 'config_rejected',
        message: `systemInstruction must be a string <= ${MAX_SYSTEM_INSTRUCTION_LENGTH} characters.`,
        retryable: false,
      });
      return;
    }

    // Strict Schema Validation: Client schema objects are strictly rejected.
    // Client must pass supported schemaId and valid purpose.
    if (body.schemaOverride !== undefined && typeof body.schemaOverride === 'object' && body.schemaOverride !== null) {
      res.status(400).json({
        ok: false,
        status: 400,
        errorCategory: 'config_rejected',
        message: 'Arbitrary schemaOverride objects are rejected. Use trusted schemaId and purpose instead.',
        retryable: false,
      });
      return;
    }

    const purpose = body.purpose ?? 'query';
    if (purpose !== 'query' && purpose !== 'connection_probe') {
      res.status(400).json({
        ok: false,
        status: 400,
        errorCategory: 'config_rejected',
        message: `Invalid purpose "${purpose}". Allowed purposes: query, connection_probe.`,
        retryable: false,
      });
      return;
    }

    const targetSchema = resolveAuthorizedSchema(body.schemaId, purpose);
    if (!targetSchema) {
      res.status(400).json({
        ok: false,
        status: 400,
        errorCategory: 'config_rejected',
        message: `Unauthorized or mismatched schemaId "${body.schemaId}" for purpose "${purpose}".`,
        retryable: false,
      });
      return;
    }

    // 4. Credential Selection Policy
    const clientKey = sanitizeApiKey(body.apiKey ?? '');
    const envKey = sanitizeApiKey(
      process.env.GEMINI_API_KEY || process.env.API_KEY || ''
    );

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
          retryable: false,
        });
        return;
      }
      activeKey = clientKey;
      credentialMode = 'BYOK';
    } else {
      // Server-Managed Key Mode: strictly protected
      if (!isServerManagedKeyAuthorized(req)) {
        res.status(401).json({
          ok: false,
          status: 401,
          byokRequired: true,
          errorCategory: 'byok_required',
          message: 'BYOK required: please connect your Google Gemini API key to use Vimarsh.',
          retryable: false,
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
        targetSchema,
        {
          abortSignal: serverAbortController.signal,
        }
      );

      // Omit thinkingConfig on connection probes to achieve sub-second verification latency
      if (purpose === 'connection_probe') {
        delete (config as Record<string, unknown>).thinkingConfig;
      }

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
      if (safeErr.retryAfterSeconds) {
        res.setHeader('Retry-After', String(safeErr.retryAfterSeconds));
      }
      res.status(safeErr.status).json({
        ok: false,
        status: safeErr.status,
        errorCategory: safeErr.category,
        message: safeErr.message,
        retryable: safeErr.retryable,
        retryAfterSeconds: safeErr.retryAfterSeconds,
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
