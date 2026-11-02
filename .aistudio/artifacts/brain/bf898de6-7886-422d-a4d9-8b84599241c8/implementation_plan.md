# Vimarsh UI Restoration — Final Approved Implementation Plan (Variation 2 Technical Dark)

## 1. Verified Repository Constants & Test Counts
- **In-App Self-Test Suite (`executeAllSelfTests` in `src/App.tsx`)**: **130 runtime assertions** across 13 suites (`seed`: 16, `dates`: 5, `schema`: 6, `parser_smoke`: 2, `validator`: 47, `executor`: 3, `stage3_engine`: 19, `stage4_json_parser`: 8, `stage4_history_serializer`: 4, `stage4_request_builder`: 4, `stage4_session_store`: 3, `stage4_golden_set`: 4, `stage5_faults`: 9).
  - **Strict Dynamic Rule**: Never hardcode `138/138` or `130/130`. Always compute `passedCount = testResults.filter(r => r.passed).length` and `totalCount = testResults.length` dynamically, rendering explicit states for:
    - **Loading / Running**: `Running...` (`#38bdf8`)
    - **Unrun (`totalCount === 0`)**: `0/0 Unrun` (`rgba(228,228,231,0.6)`)
    - **All Passing (`totalCount > 0 && passedCount === totalCount`)**: `${passedCount}/${totalCount} Passing` (`#4ade80`)
    - **Failed (`totalCount > 0 && passedCount < totalCount`)**: `${passedCount}/${totalCount} Passing (${totalCount - passedCount} Failed)` (`#f87171`)
- **Golden Evaluation Suite (`GOLDEN_TEST_SUITE` in `src/engine/goldenTests.ts`)**: **32 date-proof cases** (`GOLDEN_TEST_SUITE.length`: 11 clear, 11 ambiguous, 5 malicious, 5 unsupported).
  - **Strict Separation Rule**: Self-test results (`testResults`) and Golden Evaluation results (`evalResults` / `GOLDEN_TEST_SUITE.length`) remain strictly separate in both state and UI badges.
- **Automated Vitest Suite (`npx vitest run`)**: **70 tests across 8 test files** (`server.test.ts`, `stage1.test.ts`, `browserProxyTransport.test.ts`, `dbClientInit.test.ts`, `csvExport.test.ts`, `queryHistory.test.ts`, `autoScroll.test.ts`, `sqlFormatter.test.ts`).
- **Engine & Runtime Constants**:
  - `GEMINI_MODEL = 'gemini-3.5-flash-lite'`, `FALLBACK_GEMINI_MODELS = ['gemini-3.1-flash-lite']` (`src/config.ts`)
  - `SQL_JS_VERSION = '1.15.2'` (`src/config.ts`)
  - `PROMPT_VERSION = 'vimarsh-prompt-v6.0'` (`src/engine/systemPrompt.ts`)

---

## 2. Final Files to be Modified (11 Frontend Files Only)
1. `/index.html` — Load `Syne` (700, 800), `Space Mono` (400, 700), and `Inter` (400, 500, 600, 700) from Google Fonts; set `#0c0c0e` background and `#e4e4e7` text on `<body>`.
2. `/src/index.css` — Configure Variation 2 CSS variables, font families (`--font-display`, `--font-sans`, `--font-mono`), `#0c0c0e` dark technical scrollbars, `:focus-visible` `2px solid #38bdf8` outline, and `0px` sharp corner utility defaults.
3. `/src/App.tsx` — Implement the Variation 2 full-height shell (`lg:h-screen lg:overflow-hidden grid grid-rows-[auto_1fr_auto]`), top header with `ASK DATA` / `DEVELOPER TOOLS` navigation + compact `ByokPanel` + `Reset DB` button, responsive left sidebar (`md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]` on tablet/desktop + collapsible mobile navigation drawer), and bottom status bar with dynamic runtime status.
4. `/src/components/ByokPanel.tsx` — Restyle into a crisp technical status trigger (`ENV / BYOK` badge + expandable configuration modal/popover with `#byok-api-key-input` and all security controls preserved).
5. `/src/components/ClarificationEngineWorkspace.tsx` — Restyle into Variation 2 dark technical aesthetic while preserving all auto-scroll refs, submission guards, `prefers-reduced-motion` handling, clarification chips, SQL formatter toggle, CSV export, and Recharts visualizations (`#38bdf8`, `#4ade80`, `#fbbf24`, `#f87171`).
6. `/src/components/QueryHistoryPanel.tsx` — Restyle filter pills, search input, status badges, and replay cards to sharp `0px` technical cards.
7. `/src/components/Sidebar.tsx` — Restyle Database Diagnostics & Schema Inspector into the Variation 2 technical panel with crisp borders and monospace metadata.
8. `/src/components/EvaluationPanel.tsx` — Restyle into the Variation 2 `VERIFICATION SUITE` header, separate dynamic self-test status badge (optional prop from `App.tsx`) vs Golden Evaluation status, preserve all 7 evaluation KPIs (`Status Accuracy`, `Attack Block Rate`, `Clarify Recall`, `Average Latency`, `Clarify Precision`, `Ambiguity-Code Match`, `Execution Accuracy`), and restyle the Golden Test Cases table.
9. `/src/components/SelfTestsPanel.tsx` — Restyle the 13 self-test suites and filter controls with dynamic `passedCount/totalCount` badges and sharp `0px` borders.
10. `/src/components/ValidatorPlayground.tsx` — Restyle the 10-step SQL Safety Engine playground, preset selector, AST step pipeline cards, and execution results table.
11. `/src/components/ContextInspector.tsx` — Restyle Date Helpers (`#anchor-date-input`) and Prompt/Schema JSON payload inspector.

*Zero modifications will be made to `server.ts`, `src/config.ts`, `src/engine/**`, or `src/tests/**`.*

---

## 3. Potential Regression Risks & Mitigations
1. **Hardcoded Test Counts**: Mitigated by computing all counts from `testResults.length`, `testResults.filter(r => r.passed).length`, `GOLDEN_TEST_SUITE.length`, and `evalResults.length`, with explicit `isLoading`, `Unrun`, `Passing`, and `Failed` states.
2. **Nested Scroll Container & Auto-Scroll Regressions**: Mitigated by applying `overflow-y-auto overscroll-contain` to the `<main>` workspace container on tablet/desktop while keeping all existing refs (`loadingBannerRef`, `latestTurnRef`, `latestResponseRef`, `prevTurnsLengthRef`, `prevLastTurnStatusRef`, `shouldAutoScrollRef`) and `scrollToElement` untouched in `ClarificationEngineWorkspace.tsx`.
3. **Mobile Sidebar Pushing Main Workspace Down**: Mitigated by hiding the full sidebar behind a compact mobile navigation toggle (`md:grid` for tablet/desktop, collapsible drawer on `< 768px`) so the active workspace is immediately visible at the top of mobile viewports.
4. **DOM ID & Accessibility Selector Breakage**: Mitigated by preserving `#byok-api-key-input`, `#vimarsh-question-input`, `#anchor-date-input`, and all `aria-label` / `role` attributes.
