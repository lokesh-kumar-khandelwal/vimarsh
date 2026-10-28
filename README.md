# Vimarsh: Text-to-SQL Clarification Engine (v6.3)

> **Think before you query.**

Vimarsh is a browser-only Text-to-SQL Clarification Engine built with React 19, TypeScript, Tailwind CSS, `sql.js` (SQLite WebAssembly in a dedicated Web Worker), `node-sql-parser/build/sqlite`, and `@google/genai`.

Instead of guessing when a natural-language question is ambiguous, Vimarsh enforces a strict **3-state decision contract**:
1. **`SUCCESS`** — Generates read-only SQLite SQL that passes a 10-step fail-closed validator, dry-runs via `EXPLAIN QUERY PLAN`, and executes inside an isolated Web Worker.
2. **`CLARIFY`** — Asks **exactly one** focused business question with 2–4 clickable options when multiple interpretations would materially change the result (capped at 3 rounds in deterministic code).
3. **`REJECT`** — Refuses write/DDL operations, sensitive-column access (`customers.email`), prompt-injection/override attempts, off-topic chat, and unsupported schema requests.

---

## Threat Model

- **Browser-only educational prototype** for one browser and a small synthetic dataset. It is **not** enterprise-grade.
- **Safeguards protect the normal application path.** They are **NOT** proof against a hostile user who controls their own browser (who can inspect client code, modify state, or extract the key they typed).
- **Direct browser calls to the Gemini API suit prototyping.** Production would need a backend proxy, server-side key management, authorization, and resource controls.
- **The system prompt is bundled in client code and is NOT secret;** it contains no secrets, and refusing to recite it is best-effort behavior only. Real security relies on deterministic code.
- **No database rows are ever sent to the LLM.**

---

## Architecture & Defense-in-Depth Safety Layers

1. **Zero Server / Zero Bundled Keys**:
   - Vimarsh has no Node/Express backend, no server routes, and zero references to `GEMINI_API_KEY` or `process.env`.
   - All Gemini calls happen directly in the browser using only the visitor's key via `/engine/keyStore.ts`.
2. **Layer 1 — Deterministic Input Guard (`/engine/inputGuard.ts`)**:
   - Trims and bounds user input to 500 characters.
   - Deterministically hard-rejects instruction-override, roleplay, developer-mode, jailbreak, and system-prompt exfiltration phrases (including mixed legitimate + attack inputs) before any LLM or database call.
   - Allows ordinary analytical questions containing words like `"drop"`, `"delete"`, `"update"`, or `"created_at"`.
3. **Layer 2 — Safe History Serialization & Prompt Assembly (`/engine/historySerializer.ts`, `/engine/promptBuilder.ts`)**:
   - Serializes at most the 6 most recent prior turns (excluding the current question) plus the pinned `original_question` of an active clarification.
   - Summarizes assistant turns from metadata only (`answered; sql: ...; assumptions: ...`, `clarify; ...`, or `rejected`) and **never** includes result rows, cell values, or the API key.
   - Truncates every untrusted field (`user_question`: 500, history entry: 500, `failed_sql`: 2000, `db_error`: 500) **first**, then escapes `<` to `&lt;` and `>` to `&gt;` so user text can never inject XML tags.
4. **Layer 3 — Strict JSON Parsing & Runtime Contract Validation (`/engine/responseValidator.ts`)**:
   - Checks `finishReason` (rejecting `SAFETY`, `MAX_TOKENS`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, etc.).
   - Strips at most one surrounding Markdown code fence and calls `JSON.parse` on the entire string (no brace scanning).
   - Validates all 10 required keys of `VimarshResponse`, `confidence` in `[0, 1]`, `ambiguity_type` codes in `A1..A11`, unique `clarification_options` (`2..4` for `CLARIFY`, `[]` otherwise), schema table existence, and forbids `CLARIFY` in `REPAIR` mode.
5. **Layer 4 — Deterministic Round-3 Clarification Cap (`/engine/sessionStore.ts`)**:
   - Tracks `pending = null | { original_question, round }`.
   - If `round >= 3` and the model still returns `CLARIFY`, deterministic code converts the response to `REJECT`, naming the unresolved details and asking the user to rephrase.
6. **Layer 5 — 10-Step Fail-Closed SQL Safety Engine (`/engine/sqlValidator.ts`, `/engine/sqlExecutor.ts`)**:
   - Applies to any untrusted SQL (LLM-generated SQL and Validator Playground SQL). Returns the branded type `ValidatedSql` only when Steps 1–8 pass; Worker `dryRun` (Step 9) and `execute` (Step 10) accept **only** `ValidatedSql`.
   - **Step 1**: Parse complete SQL into an AST via `node-sql-parser/build/sqlite`. Any parse failure rejects immediately (never falls back to a token scanner).
   - **Step 2**: Exactly 1 statement; terminal statement must be `SELECT` (CTEs allowed only when all CTE bodies and final statement are `SELECT`).
   - **Step 3**: Reject star projections (`SELECT *`, `t.*`), window functions (`OVER`), and `RECURSIVE`. `COUNT(*)` is allowed.
   - **Step 4**: Require an explicit top-level integer `LIMIT` in `[1, 1000]`.
   - **Step 5**: Strict 19-function allowlist (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `ROUND`, `ABS`, `COALESCE`, `IFNULL`, `NULLIF`, `CAST`, `LENGTH`, `LOWER`, `UPPER`, `TRIM`, `SUBSTR`, `DATE`, `STRFTIME`, `DATETIME`, `JULIANDAY`, plus `CASE`). Scalar `replace()` is rejected here at Step 5.
   - **Step 6**: Every table and column must resolve against `SchemaContext` (unqualified columns must exist unambiguously on an in-scope table); at most 6 tables joined.
   - **Step 7**: Reject any identifier matching a designated sensitive column (`customers.email` / `email`) anywhere in the query—qualified or unqualified, in subqueries, CTEs, aliases (`AS email`), or quoted in any case (`"EMAIL"`, `` `email` ``, `[email]`).
   - **Step 8**: Whole-token lexical check outside string literals rejecting write/DDL/admin keywords (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `REPLACE INTO`, `MERGE`, `ATTACH`, `DETACH`, `PRAGMA`, `VACUUM`) and any `sqlite_` system object (`sqlite_master`, `sqlite_schema`, etc.) without mis-flagging `created_at`.
   - **Step 9**: Worker Dry Run (`EXPLAIN QUERY PLAN`) confirms SQLite accepts the statement. (The Validator Playground stops after Step 9 and **never** executes pasted SQL.)
   - **Step 10**: Worker Execute steps at most 1000 rows without editing SQL text, enforces a 5-second timeout (terminating and re-seeding the Worker on timeout), and shows `"No rows matched"` on 0 rows.
7. **Layer 6 — Bounded Retry & Repair Budgets (`/engine/queryPipeline.ts`)**:
   - Transport retries (`HTTP 429/503`): at most **2 retries** with exponential backoff, honoring `Retry-After`.
   - JSON-format / contract retry: exactly **1 retry** with a contract-only nudge, then falls back to the neutral `"Vimarsh could not process this request"` card.
   - SQL `REPAIR` loop: at most **2 repair attempts** (at most 3 total validations/executions), each re-validated through all 10 steps.
   - Per-question deadline: **60 seconds**.

---

## Bring Your Own Key (BYOK) & Privacy

- `/engine/keyStore.ts` is the sole reader of the visitor's Gemini API key.
- The key is stored only in React memory state and optionally `sessionStorage` (`try/catch` with in-memory fallback)—**never** in `localStorage`, cookies, URLs, logs, errors, traces, the audit log, or CSV exports.
- Clicking **Connect** sends one structured-output verification probe (`{"ok": true}`) using `buildGenerationConfig()` and `GEMINI_MODEL` (`gemini-flash-latest`) in `/config.ts`.
- Clicking **Disconnect Key** clears the key immediately from memory and `sessionStorage`.

---

## Evaluation Method & Self-Tests

- **In-Browser & Vitest Self-Tests (`123 checks`, no API key required)**:
  - Covers the 16 Worker `seedReport` checks, 47 static `sqlValidator` cases, 3 Worker `dryRun`/`execute` cases, `dateHelpers`, `schemaContext`, `strictJsonParser`, `historySerializer`, `promptBuilder` request-builder contract, `sessionStore` round-3 enforcement, `queryPipeline` repair loop, golden-set date-proofing, multiset comparator, and all 9 **Fault Scenarios**.
- **Golden Test Evaluation Tab (`32 date-proof cases`)**:
  - 11 clear (`SUCCESS`), 11 ambiguous (`CLARIFY`), 5 malicious (`REJECT`), and 5 unsupported (`REJECT`), including 4 Hindi/Hinglish questions.
  - **Date-Proof**: Questions use relative date phrasing (`"last month"`) and `gold_sql` uses `{{dateHelpers}}` placeholders (`{{last_month_start}}`, `{{last_month_end_exclusive}}`, `{{today}}`, etc.), which trusted test code substitutes at runtime before executing against the seeded database.
  - **Multiset Comparator**: Verifies equal column count and compares rows as multisets (preserving duplicates, ignoring row order and column names) with exact integer comparison, `0.01` tolerance for non-integer floats, and `NULL === NULL`.

---

## Known Limitations

1. **Single-Browser Small Synthetic Dataset**: The SQLite database runs entirely in browser memory inside a Web Worker (~40 customers, 25 products, 300 orders, 700 order items) and resets on page reload or when clicking **Reset Database**.
2. **Typed-Text Continuation While Clarification Is Pending**: While `pending_clarification` is `true`, clicking an option chip or typing free text is sent to the model as a continuation of the active clarification thread (and judged by the model whether it answers the clarification or asks a new question). To explicitly start an unrelated question, click **New question**.
3. **SQL Literals in the Audit Log**: The structured Audit Log (`/engine/auditLog.ts`) never records the API key, result rows, raw prompts, or raw API error bodies; however, recorded `failedSql` and `finalSql` strings (truncated to 2000 characters) may contain query literals that the user typed.

---

## Scripts

- `npm run dev` — Start Vite development server on port 3000
- `npm run build` — Production Vite bundle build
- `npm run typecheck` — TypeScript strict type checking (`tsc --noEmit`)
- `npm run lint` — Lint check (`tsc --noEmit`)
- `npm test` — Run all Vitest unit, validator, evaluation, and fault-scenario tests (`vitest run`)
