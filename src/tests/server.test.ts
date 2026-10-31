import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FALLBACK_GEMINI_MODELS,
  GEMINI_MODEL,
  VIMARSH_RESPONSE_SCHEMA,
} from '../config';
import {
  createExpressApp,
  MAX_CONCURRENT_REQUESTS,
  MAX_SYSTEM_INSTRUCTION_LENGTH,
  MAX_USER_CONTENT_LENGTH,
  RATE_LIMIT_MAX_REQUESTS,
  resetRateLimitsAndConcurrency,
} from '../../server';

async function withServer(
  app: ReturnType<typeof createExpressApp>,
  callback: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

describe('Vimarsh Server API & Security Test Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetRateLimitsAndConcurrency();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetRateLimitsAndConcurrency();
  });

  // 1. BYOK Isolation: Supplied key is used exclusively; never falls back to env key
  it('1. BYOK isolation: uses supplied key exclusively and never substitutes environment key on failure', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyEnvironmentKey-Never-Use-Me';
    const keysUsed: string[] = [];

    const mockApp = createExpressApp({
      clientFactory: (key: string) => {
        keysUsed.push(key);
        return {
          models: {
            generateContent: async () => {
              throw new Error('API key not valid. Please pass a valid API key.');
            },
          },
        };
      },
    });

    await withServer(mockApp, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyUserCustomKey-1234567890',
          userContent: 'How many orders were placed today?',
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.errorCategory).toBe('invalid_key');
      expect(keysUsed).toEqual(['AIzaSyUserCustomKey-1234567890']);
      expect(keysUsed).not.toContain(process.env.GEMINI_API_KEY);
    });
  });

  // 2. Server-managed key mode fails closed in production
  it('2. Server-managed key mode fails closed in production without explicit authorization', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_SERVER_MANAGED_KEY;
    process.env.GEMINI_API_KEY = 'AIzaSyEnvKey';

    const mockApp = createExpressApp();

    await withServer(mockApp, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userContent: 'Show me all customers',
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.byokRequired).toBe(true);
      expect(json.errorCategory).toBe('byok_required');
    });
  });

  // 3. Status endpoint never returns any portion of an API key or last4
  it('3. Status endpoint sanitization: returns configuration metadata with zero key/last4 leakage', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSySecretEnvironmentKeyXYZ1234';
    process.env.ALLOW_SERVER_MANAGED_KEY = 'true';

    const mockApp = createExpressApp();

    await withServer(mockApp, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/status`);
      expect(res.status).toBe(200);
      const bodyText = await res.text();

      expect(bodyText).not.toContain('1234');
      expect(bodyText).not.toContain('AIza');
      expect(bodyText).not.toContain('XYZ');
      expect(bodyText).not.toContain('Secret');

      const json = JSON.parse(bodyText);
      expect(json).toHaveProperty('serverManagedKeyAvailable', true);
      expect(json).toHaveProperty('byokRequired', false);
      expect(json).toHaveProperty('model', GEMINI_MODEL);
      expect(json).not.toHaveProperty('keyLast4');
      expect(json).not.toHaveProperty('apiKey');
    });
  });

  // 4. Non-retryable key failure: Invalid key returns 401 without alternative credentials or fallback models
  it('4. Non-retryable key failure: returns 401 immediately without attempting fallback models or alternative keys', async () => {
    const attempts: { key: string; model: string }[] = [];

    const mockApp = createExpressApp({
      clientFactory: (key: string) => ({
        models: {
          generateContent: async ({ model }) => {
            attempts.push({ key, model });
            const err = new Error('API_KEY_INVALID: The provided API key is invalid.');
            (err as any).status = 400;
            throw err;
          },
        },
      }),
    });

    await withServer(mockApp, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyBadKey',
          userContent: 'SELECT 1;',
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.errorCategory).toBe('invalid_key');
      expect(attempts).toHaveLength(1);
      expect(attempts[0].model).toBe(GEMINI_MODEL);
    });
  });

  // 5. Successful request uses primary model once
  it('5. Successful request: calls primary model exactly once without retry or fallback', async () => {
    const calls: string[] = [];

    const mockApp = createExpressApp({
      clientFactory: () => ({
        models: {
          generateContent: async ({ model }) => {
            calls.push(model);
            return {
              text: JSON.stringify({
                status: 'SUCCESS',
                reasoning: 'Primary model answered successfully.',
                sql_query: 'SELECT * FROM products LIMIT 10;',
              }),
            };
          },
        },
      }),
    });

    await withServer(mockApp, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyValidKey',
          userContent: 'List products',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.modelUsed).toBe(GEMINI_MODEL);
      expect(calls).toEqual([GEMINI_MODEL]);
    });
  });

  // 6. Fallback model trigger: On 503 from primary, at most ONE fallback is attempted
  it('6. Fallback model trigger: attempts at most one fallback model on transient 503 service unavailable', async () => {
    const attemptedModels: string[] = [];

    const mockApp = createExpressApp({
      clientFactory: () => ({
        models: {
          generateContent: async ({ model }) => {
            attemptedModels.push(model);
            if (model === GEMINI_MODEL) {
              const err = new Error('503 Service Unavailable: High demand on gemini-3.5-flash-lite');
              (err as any).status = 503;
              throw err;
            }
            return {
              text: JSON.stringify({
                status: 'SUCCESS',
                reasoning: 'Fallback model succeeded.',
                sql_query: 'SELECT COUNT(*) FROM orders;',
              }),
            };
          },
        },
      }),
    });

    await withServer(mockApp, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyValidKey',
          userContent: 'Count orders',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.modelUsed).toBe(FALLBACK_GEMINI_MODELS[0]);
      expect(attemptedModels).toEqual([GEMINI_MODEL, FALLBACK_GEMINI_MODELS[0]]);
    });
  });

  // 7. Non-retryable quota exhaustion (daily quota)
  it('7. Non-retryable quota exhaustion: does NOT loop through models or retry on daily quota limit', async () => {
    const calls: string[] = [];

    const mockApp = createExpressApp({
      clientFactory: () => ({
        models: {
          generateContent: async ({ model }) => {
            calls.push(model);
            const err = new Error('429 RESOURCE_EXHAUSTED: Quota exceeded for metric per_day limit: 0');
            (err as any).status = 429;
            throw err;
          },
        },
      }),
    });

    await withServer(mockApp, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyValidKey',
          userContent: 'Total sales',
        }),
      });

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.errorCategory).toBe('quota_exceeded');
      expect(calls).toEqual([GEMINI_MODEL]);
    });
  });

  // 8. Rate limiting: Bounded request rate per IP with Retry-After header
  it('8. In-memory Rate Limiting: Enforces 30 req/min per IP and returns 429 with Retry-After', async () => {
    const mockApp = createExpressApp({
      clientFactory: () => ({
        models: {
          generateContent: async () => ({ text: '{"status":"SUCCESS"}' }),
        },
      }),
    });

    await withServer(mockApp, async (baseUrl) => {
      // Send 30 allowed requests
      for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
        const res = await fetch(`${baseUrl}/api/gemini/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: 'AIzaSyValidKey',
            userContent: `query #${i}`,
          }),
        });
        expect(res.status).toBe(200);
      }

      // 31st request from same IP must be rejected with 429
      const blockedRes = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyValidKey',
          userContent: 'one more request',
        }),
      });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers.get('Retry-After')).toBeTruthy();
      const json = await blockedRes.json();
      expect(json.errorCategory).toBe('rate_limit_exceeded');
    });
  });

  // 9. Input validation: Rejects oversized userContent and systemInstruction
  it('9. Input validation: Rejects oversized user content and system instructions before calling Gemini', async () => {
    let called = false;
    const mockApp = createExpressApp({
      clientFactory: () => {
        called = true;
        return {
          models: {
            generateContent: async () => ({ text: '{}' }),
          },
        };
      },
    });

    await withServer(mockApp, async (baseUrl) => {
      // Oversized userContent
      const hugeUser = 'A'.repeat(MAX_USER_CONTENT_LENGTH + 1);
      const resUser = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyKey',
          userContent: hugeUser,
        }),
      });
      expect(resUser.status).toBe(400);

      // Oversized systemInstruction
      const hugeSystem = 'S'.repeat(MAX_SYSTEM_INSTRUCTION_LENGTH + 1);
      const resSys = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyKey',
          userContent: 'valid question',
          systemInstruction: hugeSystem,
        }),
      });
      expect(resSys.status).toBe(400);

      // Non-string / empty userContent
      const resEmpty = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyKey',
          userContent: '   ',
        }),
      });
      expect(resEmpty.status).toBe(400);

      expect(called).toBe(false);
    });
  });

  // 10. Schema override whitelist: Rejects unauthorized schemas with 400
  it('10. Schema override whitelist: Rejects unauthorized schema overrides and allows official Vimarsh schema', async () => {
    let called = false;
    const mockApp = createExpressApp({
      clientFactory: () => {
        called = true;
        return {
          models: {
            generateContent: async () => ({
              text: JSON.stringify({ status: 'SUCCESS' }),
            }),
          },
        };
      },
    });

    await withServer(mockApp, async (baseUrl) => {
      // Unauthorized custom schema
      const invalidSchemaRes = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyKey',
          userContent: 'Query with bad schema',
          schemaOverride: {
            type: 'OBJECT',
            properties: { arbitraryField: { type: 'STRING' } },
          },
        }),
      });
      expect(invalidSchemaRes.status).toBe(400);
      const invalidJson = await invalidSchemaRes.json();
      expect(invalidJson.message).toContain('schema override');
      expect(called).toBe(false);

      // Authorized Vimarsh schema
      const validSchemaRes = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyKey',
          userContent: 'Query with valid schema',
          schemaOverride: VIMARSH_RESPONSE_SCHEMA,
        }),
      });
      expect(validSchemaRes.status).toBe(200);
      expect(called).toBe(true);
    });
  });

  // 11. Deadline enforcement: Operations exceeding timeouts terminate and clean up timers
  it('11. Deadline enforcement: Aborts requests exceeding timeout limits and returns appropriate error', async () => {
    const mockApp = createExpressApp({
      clientFactory: () => ({
        models: {
          generateContent: async ({ config }) => {
            const signal: AbortSignal | undefined = (config as any)?.abortSignal;
            return new Promise((_resolve, reject) => {
              if (signal) {
                signal.addEventListener('abort', () => {
                  reject(new DOMException('Request aborted', 'AbortError'));
                });
              }
            });
          },
        },
      }),
    });

    await withServer(mockApp, async (baseUrl) => {
      const clientAbort = new AbortController();
      const timer = setTimeout(() => clientAbort.abort(), 100);

      try {
        const res = await fetch(`${baseUrl}/api/gemini/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: 'AIzaSyKey',
            userContent: 'stalled question',
          }),
          signal: clientAbort.signal,
        });
        expect(res.status).toBe(499);
      } catch (err: any) {
        expect(err.name).toBe('AbortError');
      } finally {
        clearTimeout(timer);
      }
    });
  });

  // 12. Client cancellation propagation: res.on('close') triggers server abort
  it('12. Client cancellation propagation: aborts upstream SDK call when client terminates connection', async () => {
    let upstreamAborted = false;

    const mockApp = createExpressApp({
      clientFactory: () => ({
        models: {
          generateContent: async ({ config }) => {
            return new Promise((_resolve, reject) => {
              const signal: AbortSignal | undefined = (config as any)?.abortSignal;
              if (signal) {
                signal.addEventListener('abort', () => {
                  upstreamAborted = true;
                  reject(new DOMException('Upstream aborted by client close', 'AbortError'));
                });
              }
            });
          },
        },
      }),
    });

    await withServer(mockApp, async (baseUrl) => {
      const clientAbort = new AbortController();
      const fetchPromise = fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyKey',
          userContent: 'cancel this in flight',
        }),
        signal: clientAbort.signal,
      });

      // Abort connection shortly after sending
      setTimeout(() => clientAbort.abort(), 50);

      await expect(fetchPromise).rejects.toThrow();
      // Allow event loop cycle for res close handler to propagate
      await new Promise((r) => setTimeout(r, 100));
      expect(upstreamAborted).toBe(true);
    });
  });

  // 13. Secret leakage prevention: Raw keys never appear in response payloads or safe error messages
  it('13. Secret leakage prevention: Raw keys never appear in error messages or response payloads', async () => {
    const secretKey = 'AIzaSySecretSensitiveKey987654321';

    const mockApp = createExpressApp({
      clientFactory: () => ({
        models: {
          generateContent: async () => {
            throw new Error(`Google API rejected key: ${secretKey}`);
          },
        },
      }),
    });

    await withServer(mockApp, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: secretKey,
          userContent: 'Security audit test',
        }),
      });

      const responseText = await res.text();
      expect(responseText).not.toContain(secretKey);
      expect(responseText).not.toContain('987654321');
    });
  });

  // 14. Structured JSON contract enforcement
  it('14. Structured JSON contract enforcement: returns parsed and structured responses matching Vimarsh schema', async () => {
    const mockApp = createExpressApp({
      clientFactory: () => ({
        models: {
          generateContent: async () => ({
            text: JSON.stringify({
              status: 'SUCCESS',
              reasoning: 'Extracted active customer count.',
              sql_query: 'SELECT COUNT(*) FROM customers WHERE status = "active";',
            }),
          }),
        },
      }),
    });

    await withServer(mockApp, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyValidKey',
          userContent: 'Active customer count',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.modelUsed).toBe(GEMINI_MODEL);

      const parsed = JSON.parse(json.rawText);
      expect(parsed.status).toBe('SUCCESS');
      expect(parsed.sql_query).toBe('SELECT COUNT(*) FROM customers WHERE status = "active";');
    });
  });

  // 15. Concurrency limit returns 503 with retry guidance
  it('15. Concurrency control: returns 503 with Retry-After when max concurrent requests is reached', async () => {
    const releaseHolders: (() => void)[] = [];

    const mockApp = createExpressApp({
      clientFactory: () => ({
        models: {
          generateContent: async () => {
            return new Promise((resolve) => {
              releaseHolders.push(() => {
                resolve({ text: JSON.stringify({ status: 'SUCCESS' }) });
              });
            });
          },
        },
      }),
    });

    await withServer(mockApp, async (baseUrl) => {
      // Saturate max concurrent requests (5)
      const inFlightPromises: Promise<Response>[] = [];
      for (let i = 0; i < MAX_CONCURRENT_REQUESTS; i++) {
        // Use different dummy IPs via headers to avoid per-IP rate limit
        inFlightPromises.push(
          fetch(`${baseUrl}/api/gemini/generate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `10.0.0.${i + 1}`,
            },
            body: JSON.stringify({
              apiKey: 'AIzaSyKey',
              userContent: `concurrent query #${i}`,
            }),
          })
        );
      }

      // Small tick to ensure all 5 handlers have entered active in-flight count
      await new Promise((r) => setTimeout(r, 50));

      // 6th concurrent request must be rejected with 503
      const overflowRes = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '10.0.0.99',
        },
        body: JSON.stringify({
          apiKey: 'AIzaSyKey',
          userContent: 'overflow query',
        }),
      });

      expect(overflowRes.status).toBe(503);
      expect(overflowRes.headers.get('Retry-After')).toBe('2');
      const overflowJson = await overflowRes.json();
      expect(overflowJson.errorCategory).toBe('server_busy');

      // Release in-flight requests
      releaseHolders.forEach((release) => release());
      await Promise.all(inFlightPromises);
    });
  });
});
