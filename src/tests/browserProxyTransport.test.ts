import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disconnectApiKey, setConnectedApiKey } from '../engine/keyStore';
import {
  callLlmWithTransportRetries,
  classifyGeminiError,
  defaultGeminiTransport,
} from '../engine/llmClient';

describe('Browser-to-Proxy Transport & Retry Ownership (/src/engine/llmClient.ts)', () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setConnectedApiKey('AIzaSyClientKey1234');
    // Simulate browser window environment with window.fetch
    (globalThis as any).window = {
      fetch: vi.fn(),
    };
  });

  afterEach(() => {
    disconnectApiKey();
    (globalThis as any).window = originalWindow;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('15. Sends exactly one generation POST per user call when successful', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        ok: true,
        rawText: '{"status":"SUCCESS"}',
        finishReason: 'STOP',
      }),
    });
    (globalThis.window as any).fetch = mockFetch;

    const res = await callLlmWithTransportRetries({
      systemInstruction: 'sys',
      userContent: 'user',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(res.rawText).toBe('{"status":"SUCCESS"}');
    expect(res.transportRetriesUsed).toBe(0);
  });

  it('16. Does NOT automatically repeat browser POST after server HTTP 429', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '5' }),
      json: async () => ({
        ok: false,
        status: 429,
        errorCategory: 'rate_limit_exceeded',
        message: 'Too many requests. Please wait 5 seconds before trying again.',
        retryable: false,
        retryAfterSeconds: 5,
      }),
    });
    (globalThis.window as any).fetch = mockFetch;

    await expect(
      callLlmWithTransportRetries({
        systemInstruction: 'sys',
        userContent: 'user',
      })
    ).rejects.toThrow(/Too many requests/);

    // Strictly 1 POST attempt; browser never replays
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('17. Does NOT automatically repeat browser POST after server HTTP 503', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers({ 'Retry-After': '2' }),
      json: async () => ({
        ok: false,
        status: 503,
        errorCategory: 'service_unavailable',
        message: 'Server is handling maximum concurrent Gemini requests.',
        retryable: false,
        retryAfterSeconds: 2,
      }),
    });
    (globalThis.window as any).fetch = mockFetch;

    await expect(
      callLlmWithTransportRetries({
        systemInstruction: 'sys',
        userContent: 'user',
      })
    ).rejects.toThrow(/maximum concurrent Gemini requests/);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('18. Does NOT automatically repeat browser POST after ambiguous network failure (TypeError: Failed to fetch)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    (globalThis.window as any).fetch = mockFetch;

    await expect(
      callLlmWithTransportRetries({
        systemInstruction: 'sys',
        userContent: 'user',
      })
    ).rejects.toThrow(/Failed to reach Vimarsh server proxy/);

    // Strictly 1 attempt: failed fetch does not prove server never received request, so no automatic retry
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('19. Immediately aborts without retrying on client cancellation', async () => {
    const controller = new AbortController();
    const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
      if (options?.signal?.aborted) {
        throw new DOMException('Request aborted', 'AbortError');
      }
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Request aborted', 'AbortError'));
        });
      });
    });
    (globalThis.window as any).fetch = mockFetch;

    // Trigger abort right away
    setTimeout(() => controller.abort(), 10);

    await expect(
      callLlmWithTransportRetries({
        systemInstruction: 'sys',
        userContent: 'user',
        abortSignal: controller.signal,
      })
    ).rejects.toThrow(/cancelled or timed out/i);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('21. Propagates Retry-After correctly to classified error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '7' }),
      json: async () => ({
        ok: false,
        status: 429,
        errorCategory: 'rate_limit_exceeded',
        message: 'Rate limit exceeded',
        retryAfterSeconds: 7,
      }),
    });
    (globalThis.window as any).fetch = mockFetch;

    try {
      await defaultGeminiTransport({
        apiKey: 'AIzaSyKey',
        systemInstruction: 'sys',
        userContent: 'user',
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      const classified = classifyGeminiError(err);
      expect(classified.httpStatus).toBe(429);
      expect(classified.retryAfterMs).toBe(7000);
      expect(classified.retryable).toBe(false);
      expect(classified.category).toBe('rate_limit_exceeded');
    }
  });
});
