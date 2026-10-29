import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, type Schema } from '@google/genai';
import {
  buildGenerationConfig,
  FALLBACK_GEMINI_MODELS,
  GEMINI_MODEL,
} from './src/config';
import { sanitizeApiKey } from './src/engine/llmClient';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface GenerateProxyRequestBody {
  apiKey?: string;
  systemInstruction?: string;
  userContent?: string;
  schemaOverride?: Schema;
}

function isValidHeaderAsciiKey(key: string): boolean {
  return key.length > 0 && /^[\x21-\x7E]+$/.test(key);
}

function extractErrorDetails(err: unknown): {
  status: number;
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err ?? 'Unknown Gemini error');
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

  if (rawStatus !== null && rawStatus >= 400 && rawStatus < 600) {
    return { status: rawStatus, message };
  }
  if (/\b(?:401|403|API_KEY_INVALID|API_KEY_EXPIRED|PERMISSION_DENIED|UNAUTHENTICATED|api key not valid)\b/i.test(message)) {
    return { status: 401, message };
  }
  if (/\b(?:429|RESOURCE_EXHAUSTED|quota|rate limit)\b/i.test(message)) {
    return { status: 429, message };
  }
  if (/\b(?:503|502|UNAVAILABLE|overloaded|high demand)\b/i.test(message)) {
    return { status: 503, message };
  }
  if (/\b(?:404|NOT_FOUND|model.*not found)\b/i.test(message)) {
    return { status: 404, message };
  }
  if (/\b(?:504|DEADLINE_EXCEEDED|Deadline expired|timed out|AbortError|aborted)\b/i.test(message)) {
    return { status: 504, message };
  }
  if (/\b(?:400|INVALID_ARGUMENT)\b/i.test(message)) {
    return { status: 400, message };
  }
  return { status: 500, message };
}

async function callModelWithAdaptiveConfig(
  ai: GoogleGenAI,
  model: string,
  userContent: string,
  systemInstruction?: string,
  schemaOverride?: Schema,
  abortSignal?: AbortSignal
): Promise<{ rawText: string; finishReason: string | null }> {
  const extractOutput = (response: {
    text?: string | (() => string);
    candidates?: Array<{ finishReason?: unknown }>;
  }) => {
    const rawText =
      typeof response.text === 'function'
        ? (response.text as () => string)()
        : (response.text ?? '');
    const finishReason =
      response.candidates && response.candidates.length > 0
        ? String(response.candidates[0]?.finishReason ?? 'STOP')
        : null;
    return { rawText, finishReason };
  };

  try {
    const config = buildGenerationConfig(systemInstruction, schemaOverride, {
      abortSignal,
    });
    const res = await ai.models.generateContent({
      model,
      contents: userContent,
      config,
    });
    return extractOutput(res);
  } catch (err1) {
    const { status, message } = extractErrorDetails(err1);
    const isKeyErr =
      status === 401 ||
      status === 403 ||
      /\b(?:API_KEY_INVALID|API_KEY_EXPIRED|API_KEY_NOT_FOUND|api key not valid)\b/i.test(
        message
      );
    const isModelMissing =
      status === 404 ||
      /\b(?:model.*not found|not supported for generateContent|no longer available)\b/i.test(
        message
      );

    if (status === 400 && !isKeyErr && !isModelMissing && !abortSignal?.aborted) {
      try {
        const configNoThinking = buildGenerationConfig(
          systemInstruction,
          schemaOverride,
          {
            abortSignal,
            omitThinkingConfig: true,
          }
        );
        const res2 = await ai.models.generateContent({
          model,
          contents: userContent,
          config: configNoThinking,
        });
        return extractOutput(res2);
      } catch (err2) {
        const d2 = extractErrorDetails(err2);
        if (d2.status === 400 && !abortSignal?.aborted) {
          const configJsonOnly = buildGenerationConfig(
            systemInstruction,
            schemaOverride,
            {
              abortSignal,
              omitThinkingConfig: true,
              omitResponseSchema: true,
            }
          );
          const res3 = await ai.models.generateContent({
            model,
            contents: userContent,
            config: configJsonOnly,
          });
          return extractOutput(res3);
        }
        throw err2;
      }
    }
    throw err1;
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/gemini/status', (_req, res) => {
    const envKey = sanitizeApiKey(
      process.env.GEMINI_API_KEY || process.env.API_KEY || ''
    );
    res.json({
      configured: isValidHeaderAsciiKey(envKey),
      last4: envKey.length >= 4 ? envKey.slice(-4) : null,
    });
  });

  app.post('/api/gemini/generate', async (req, res) => {
    const body = (req.body ?? {}) as GenerateProxyRequestBody;
    const userContent =
      typeof body.userContent === 'string' ? body.userContent : '';
    const systemInstruction =
      typeof body.systemInstruction === 'string'
        ? body.systemInstruction
        : undefined;
    const schemaOverride = body.schemaOverride;

    const clientKey = sanitizeApiKey(body.apiKey ?? '');
    const envKey = sanitizeApiKey(
      process.env.GEMINI_API_KEY || process.env.API_KEY || ''
    );

    if (!isValidHeaderAsciiKey(clientKey) && !isValidHeaderAsciiKey(envKey)) {
      res.status(401).json({
        ok: false,
        status: 401,
        message: '401 API_KEY_INVALID: Please provide a valid Gemini API key.',
      });
      return;
    }

    // Build candidate keys:
    // In AI Studio Cloud Run containers, the sidecar proxy authenticates using process.env.GEMINI_API_KEY.
    // We try the user's key first if it differs from envKey, and seamlessly fall back to envKey
    // if the container proxy requires the environment key (or vice versa).
    const keysToTry: string[] = [];
    if (isValidHeaderAsciiKey(envKey)) {
      keysToTry.push(envKey);
    }
    if (isValidHeaderAsciiKey(clientKey) && !keysToTry.includes(clientKey)) {
      keysToTry.push(clientKey);
    }

    const modelsToTry = [GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS];
    let lastError: unknown = new Error('Gemini request failed.');

    const requestAbortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        requestAbortController.abort();
      }
    });

    for (const activeKey of keysToTry) {
      const ai = new GoogleGenAI({
        apiKey: activeKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
          retryOptions: {
            attempts: 1,
          },
        },
      });

      for (let i = 0; i < modelsToTry.length; i++) {
        if (requestAbortController.signal.aborted) {
          res.status(499).json({
            ok: false,
            status: 499,
            message: 'Request aborted by client.',
          });
          return;
        }

        const candidateModel = modelsToTry[i];
        const perModelController = new AbortController();
        const perModelTimeoutMs = 10_000;
        const timer = setTimeout(() => {
          perModelController.abort();
        }, perModelTimeoutMs);

        const onReqAbort = () => perModelController.abort();
        requestAbortController.signal.addEventListener('abort', onReqAbort, {
          once: true,
        });

        try {
          const output = await callModelWithAdaptiveConfig(
            ai,
            candidateModel,
            userContent,
            systemInstruction,
            schemaOverride,
            perModelController.signal
          );
          res.status(200).json({
            ok: true,
            rawText: output.rawText,
            finishReason: output.finishReason,
            modelUsed: candidateModel,
          });
          return;
        } catch (err) {
          lastError = err;
          const { status, message } = extractErrorDetails(err);
          const isKeyErr =
            status === 401 ||
            status === 403 ||
            /\b(?:API_KEY_INVALID|API_KEY_EXPIRED|API_KEY_NOT_FOUND|api key not valid)\b/i.test(
              message
            );
          if (isKeyErr) {
            // Try next key in keysToTry if available; do not loop across other models with the same rejected key
            break;
          }
          // Otherwise try the next model in modelsToTry
        } finally {
          clearTimeout(timer);
          requestAbortController.signal.removeEventListener(
            'abort',
            onReqAbort
          );
        }
      }
    }

    const finalDetails = extractErrorDetails(lastError);
    res.status(finalDetails.status).json({
      ok: false,
      status: finalDetails.status,
      message: finalDetails.message,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vimarsh server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
