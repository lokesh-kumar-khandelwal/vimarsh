# Vimarsh: Text-to-SQL Clarification Engine (v6.3)

> **Think before you query.**

Vimarsh is a full-stack Text-to-SQL Clarification Engine built with React 19, TypeScript, Tailwind CSS, `sql.js` (SQLite WebAssembly executed client-side in a dedicated Web Worker), `node-sql-parser/build/sqlite`, Express proxy backend, and the Google Gen AI SDK (`@google/genai`).

Instead of guessing when a natural-language question is ambiguous, Vimarsh enforces a strict **3-state decision contract**:
1. **`SUCCESS`** — Generates read-only SQLite SQL that passes a 10-step fail-closed safety engine, dry-runs via `EXPLAIN QUERY PLAN`, and executes inside an isolated Web Worker.
2. **`CLARIFY`** — Asks **exactly one** focused business question with 2–4 clickable options when multiple interpretations would materially change the result (capped at 3 rounds in deterministic code).
3. **`REJECT`** — Refuses write/DDL operations, sensitive-column access (`customers.email`), prompt-injection/override attempts, off-topic chat, and unsupported schema requests.

---

## Architecture: Full-Stack Express Proxy & Browser Engine

Vimarsh operates as a full-stack TypeScript application on **port 3000**:
- **Backend (`server.ts`)**: Express server mounting Vite in development (`middlewareMode`) and serving static assets in production, exposing `/api/gemini/generate` and `/api/gemini/status`.
- **Client (`src/`)**: Single-page application rendering the interactive Clarification Workspace, Schema Viewer, BYOK Connection Panel, Validator Playground, Golden Set Evaluation, and Performance Diagnostics.
- **SQLite Engine (`src/engine/dbWorker.ts`)**: Pure WebAssembly SQLite running in a dedicated browser Web Worker, keeping data execution isolated and responsive.

### Request Lifecycle

```
User Query in Browser
   │
   ▼
[Layer 1] Deterministic Input Guard (Trims to 500 chars, rejects injection/exfiltration phrases)
   │
   ▼
[Layer 2] History Serialization & Prompt Assembly (Escapes XML tags, hides db rows/keys)
   │
   ▼
Client LLM Transport (`src/engine/llmClient.ts`) ─── POST /api/gemini/generate ───┐
                                                                                  │
┌──────────────────────────────── Express Proxy (`server.ts`) ─────────────────────┘
│
├─► [1] In-Memory Rate Limiting: 30 requests/minute per IP (Retry-After header)
├─► [2] Concurrency Control: Max 5 concurrent Gemini requests (returns 503 if busy)
├─► [3] Input & Schema Validation:
│       • userContent <= 5,000 characters
│       • systemInstruction <= 20,000 characters
│       • schemaOverride objects rejected; authorized schemaId (vimarsh_response, connection_probe) validated by purpose
├─► [4] Credential Isolation:
│       • BYOK Mode: Client key used exclusively; never falls back to server env key
│       • Server-Managed Key: Disabled by default; authorized only with explicit opt-in
├─► [5] Single-Owner Retry & Deadline Policy:
│       • Primary model: gemini-3.5-flash-lite
│       • At most ONE fallback model: gemini-3.1-flash-lite (only on transient 503/404 if budget >= 10s)
│       • Per-call timeout: 25s (PER_REQUEST_TIMEOUT_MS = 25_000)
│       • Server operation ceiling: 30s (SERVER_OPERATION_TIMEOUT_MS)
│       • Client abort propagation: res.on('close') terminates upstream Gemini calls
│
└─► Returns: { ok: true, rawText: string, finishReason: string, modelUsed: string }
   │
   ▼
[Layer 3] Strict JSON Parser & Response Validator (`src/engine/responseValidator.ts`)
   │
   ▼
[Layer 4] Round-3 Clarification Cap (`src/engine/sessionStore.ts`)
   │
   ▼
[Layer 5] 10-Step SQL Safety Engine (`src/engine/sqlValidator.ts`)
   │  1. Fail-closed AST parse
   │  2. Exactly 1 statement; terminal statement must be SELECT
   │  3. Reject wildcard (*) projections, recursive CTEs, and window functions
   │  4. Enforce explicit LIMIT in [1, 1000]
   │  5. Function allowlist (19 scalar/aggregate functions + CASE)
   │  6. Resolve all tables & columns against SchemaContext (max 6 joins)
   │  7. Reject sensitive column access (customers.email) in any clause or alias
   │  8. Token scan blocking write/DDL/admin keywords and sqlite_ system tables
   │
   ▼
[Layer 6] Web Worker Dry Run (Step 9: EXPLAIN QUERY PLAN) & Execution (Step 10: 1000-row cap, 5s timeout)
   │
   ▼
Interactive UI Results & Performance Timeline
```

---

## Explicit Credential Policy

Vimarsh supports two distinct, isolated credential modes:

### 1. Bring Your Own Key (BYOK) Mode (Default & Production)
- Users provide their own Google Gemini API key via the **Connect Gemini API Key** panel.
- The supplied key is used **strictly and exclusively** for that user's requests.
- The server **never** substitutes or falls back to an environment key if the user's key fails, expires, or lacks quota.
- Keys are sanitized, validated for printable ASCII headers, and kept in client memory state (with optional per-tab `sessionStorage`).
- Keys are **never** logged, stored in persistent databases, echoed in API responses, or embedded in client bundles.

### 2. Server-Managed Key Mode (Development & AI Studio Preview Only)
- In local development or AI Studio preview environments where `NODE_ENV !== 'production'`, a server-side `GEMINI_API_KEY` can be used without requiring visitors to enter their own key.
- In production (`NODE_ENV === 'production'`), server-managed key mode is **disabled by default (fails closed)**, returning HTTP 401 with `byokRequired: true` unless explicitly overridden via `ALLOW_SERVER_MANAGED_KEY=true` behind an authenticated upstream reverse proxy.
- The status endpoint (`/api/gemini/status`) returns `{ serverManagedKeyAvailable, byokRequired, model }` and **never** reveals keys, key prefixes, hashes, or last-4 characters.

---

## Model Selection & Timing Policy

### Models
- **Primary Model**: `gemini-3.5-flash-lite` — Official Google Gemini model offering low latency (~9.5s per question), full structured output (`responseSchema`) support, and `thinkingConfig: { thinkingLevel: 'MINIMAL' }`.
- **Fallback Model**: `gemini-3.1-flash-lite` — Exactly one fallback model, attempted only for temporary service unavailability (HTTP 503) or model unavailability (HTTP 404), and only when at least 10 seconds of request deadline budget remains.

### Timeouts & Deadlines
- **Connection Probe Timeout**: 25 seconds (`CONNECT_PROBE_TIMEOUT_MS = 25_000`).
- **Per-Request Timeout**: 25 seconds (`PER_REQUEST_TIMEOUT_MS = 25_000`).
- **Server Operation Ceiling**: 30 seconds (`SERVER_OPERATION_TIMEOUT_MS = 30_000`).
- **Per-Question Overall Deadline**: 60 seconds (`PER_QUESTION_DEADLINE_MS = 60_000`) encompassing all JSON retries and SQL repairs.

---

## Known Limitations

1. **In-Memory Rate Limiter & Concurrency State**: The server rate limiter (30 req/min/IP) and concurrency counter (max 5 active requests) are stored in Node.js process memory. In a multi-instance or auto-scaling cluster, an external distributed store (such as Redis) or reverse-proxy rate limiting would be required.
2. **Single-Browser Synthetic Database**: The SQLite database runs entirely in browser memory inside a Web Worker (~40 customers, 25 products, 300 orders, 700 order items) and resets on page reload or when clicking **Reset Database**.
3. **Typed-Text Continuation During Active Clarification**: While `pending_clarification` is active, clicking an option chip or typing free text is treated as a continuation of the active clarification thread. To ask an unrelated question, click **New question**.
4. **SQL Literals in the Audit Log**: The structured Audit Log (`src/engine/auditLog.ts`) never records keys, rows, or prompt templates; however, failed and final SQL strings (truncated to 2,000 characters) may contain query filter literals that the user typed.

---

## Development Scripts

- `npm run dev` — Start the full-stack Express + Vite development server on port 3000
- `npm run build` — Build production Vite bundle
- `npm run preview` — Run production Express server on port 3000 with pre-built assets
- `npm run typecheck` — TypeScript strict type checking (`tsc --noEmit`)
- `npm run lint` — ESLint strict codebase validation (`eslint .`)
- `npm test` — Run all Vitest suites (server security tests, SQL safety engine, golden evaluation, and fault scenarios)
