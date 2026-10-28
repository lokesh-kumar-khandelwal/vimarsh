/**
 * Vitest Test Runner for Stages 1, 2, 3 & 4 (/src/tests/stage1.test.ts)
 *
 * Runs the pure test cases from:
 * - /src/tests/cases/stage1Cases.ts (SeedReport, DateHelpers, SchemaContext, Parser smoke test)
 * - /src/tests/cases/sqlValidatorCases.ts (47 SQL Safety Engine cases + DryRun & Executor cases)
 * - /src/tests/cases/stage3Cases.ts (13 Stage 3 Engine cases)
 * - /src/tests/cases/stage4Cases.ts (22 Stage 4 cases: strictJsonParser, historySerializer,
 *   requestBuilder contract, sessionStore, and goldenSet date-proofing + multiset comparator)
 * against a real sql.js WebAssembly database instance.
 */

import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { createAndSeedDatabase } from '../engine/seedDatabase';
import {
  createDirectDbRunner,
  runExecutorAndDryRunTestCases,
  runSqlValidatorTestCases,
} from './cases/sqlValidatorCases';
import {
  runDateHelpersTestCases,
  runSchemaAndContextTestCases,
  runSeedReportTestCases,
  runStage1GuardAndParserTestCases,
} from './cases/stage1Cases';
import { runStage3EngineTestCases } from './cases/stage3Cases';
import {
  runGoldenSetAndComparatorTestCases,
  runHistorySerializerTestCases,
  runRequestBuilderContractTestCases,
  runSessionStoreTestCases,
  runStrictJsonParserTestCases,
} from './cases/stage4Cases';
import { runStage5FaultScenarioTestCases } from './cases/stage5FaultCases';

describe('Vimarsh Stages 1, 2, 3, 4 & 5 — Full Self-Tests, SQL Safety Engine, Clarification Pipeline, Golden Evaluation & Fault Scenarios', () => {
  it('passes all dateHelpers local-calendar boundary, leap-year, and midnight tests', () => {
    const results = runDateHelpersTestCases();
    for (const r of results) {
      expect(r.passed, `${r.name}: ${r.details}`).toBe(true);
    }
  });

  it('passes node-sql-parser/build/sqlite smoke test and config contract check', async () => {
    const results = await runStage1GuardAndParserTestCases();
    for (const r of results) {
      expect(r.passed, `${r.name}: ${r.details}`).toBe(true);
    }
  });

  it('creates, seeds, validates, and loads schemaContext in sql.js with 100% seedReport checks passing', async () => {
    const SQL = await initSqlJs();
    const { db, initPayload } = createAndSeedDatabase(
      SQL,
      new Date(2026, 9, 28, 12, 0, 0),
      'node-local'
    );

    try {
      const seedResults = runSeedReportTestCases(initPayload.seedReport);
      for (const r of seedResults) {
        expect(r.passed, `${r.name}: ${r.details}`).toBe(true);
      }
      expect(initPayload.seedReport.allPassed).toBe(true);

      const schemaResults = runSchemaAndContextTestCases(
        initPayload.schemaContext
      );
      for (const r of schemaResults) {
        expect(r.passed, `${r.name}: ${r.details}`).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('passes all 47 SQL Safety Engine validator cases (Steps 1-8)', async () => {
    const SQL = await initSqlJs();
    const { db, initPayload } = createAndSeedDatabase(
      SQL,
      new Date(2026, 9, 28, 12, 0, 0),
      'node-local'
    );

    try {
      const validatorResults = runSqlValidatorTestCases(
        initPayload.schemaContext
      );
      expect(validatorResults.length).toBeGreaterThanOrEqual(35);
      for (const r of validatorResults) {
        expect(r.passed, `[${r.id}] ${r.name} -> ${r.details}`).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('passes Step 9 Dry Run (EXPLAIN QUERY PLAN) and Step 10 Execute (1000-row cap & empty-result state)', async () => {
    const SQL = await initSqlJs();
    const { db, initPayload } = createAndSeedDatabase(
      SQL,
      new Date(2026, 9, 28, 12, 0, 0),
      'node-local'
    );

    try {
      const runner = createDirectDbRunner(db);
      const execResults = await runExecutorAndDryRunTestCases(
        initPayload.schemaContext,
        runner
      );
      for (const r of execResults) {
        expect(r.passed, `[${r.id}] ${r.name} -> ${r.details}`).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('passes all Stage 3 Engine tests (systemPrompt v6.0, inputGuard, strictJsonParser, responseValidator, historySerializer, promptBuilder, sessionStore round-3 enforcement, and queryPipeline repair loop)', async () => {
    const SQL = await initSqlJs();
    const { db, initPayload } = createAndSeedDatabase(
      SQL,
      new Date(2026, 9, 28, 12, 0, 0),
      'node-local'
    );

    try {
      const runner = createDirectDbRunner(db);
      const stage3Results = await runStage3EngineTestCases(
        initPayload.schemaContext,
        runner
      );
      expect(stage3Results.length).toBeGreaterThanOrEqual(13);
      for (const r of stage3Results) {
        expect(r.passed, `[${r.id}] ${r.name} -> ${r.details}`).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('passes all Stage 4 Self-Test suites (strictJsonParser, historySerializer, requestBuilder contract, sessionStore, and goldenSet date-proofing + multiset comparator)', async () => {
    const SQL = await initSqlJs();
    const { db, initPayload } = createAndSeedDatabase(
      SQL,
      new Date(2026, 9, 28, 12, 0, 0),
      'node-local'
    );

    try {
      const runner = createDirectDbRunner(db);
      const strictJsonResults = runStrictJsonParserTestCases();
      const historyResults = runHistorySerializerTestCases();
      const reqBuilderResults = runRequestBuilderContractTestCases(
        initPayload.schemaContext
      );
      const sessionResults = runSessionStoreTestCases();
      const goldenResults = await runGoldenSetAndComparatorTestCases(
        initPayload.schemaContext,
        runner
      );

      const allStage4 = [
        ...strictJsonResults,
        ...historyResults,
        ...reqBuilderResults,
        ...sessionResults,
        ...goldenResults,
      ];

      expect(allStage4.length).toBeGreaterThanOrEqual(20);
      for (const r of allStage4) {
        expect(r.passed, `[${r.id}] ${r.name} -> ${r.details}`).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('passes all 9 Stage 5 Fault Scenarios (Worker init failure, WASM load failure, model timeout, malformed JSON, quota exhaustion 429, cancellation, stale response, parser exception, failed repair)', async () => {
    const SQL = await initSqlJs();
    const { db, initPayload } = createAndSeedDatabase(
      SQL,
      new Date(2026, 9, 28, 12, 0, 0),
      'node-local'
    );

    try {
      const faultResults = await runStage5FaultScenarioTestCases(
        initPayload.schemaContext,
        initPayload
      );
      expect(faultResults.length).toBe(9);
      for (const r of faultResults) {
        expect(r.passed, `[${r.id}] ${r.name} -> ${r.details}`).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('satisfies all coverage, date-integrity, and distinguishability guarantees on the 1st of a month and Jan 1', async () => {
    const SQL = await initSqlJs();
    const boundaryDates = [
      new Date(2026, 0, 1, 0, 0, 0), // Jan 1 at local midnight
      new Date(2024, 2, 1, 12, 0, 0), // Mar 1 in leap year 2024
      new Date(2026, 9, 1, 23, 59, 59), // Oct 1 at 23:59:59
    ];

    for (const dt of boundaryDates) {
      const { db, initPayload } = createAndSeedDatabase(SQL, dt, 'node-local');
      try {
        for (const chk of initPayload.seedReport.checks) {
          expect(
            chk.passed,
            `Date ${initPayload.seedReport.generatedForDate} check ${chk.id}: ${chk.details}`
          ).toBe(true);
        }
        expect(initPayload.seedReport.allPassed).toBe(true);
      } finally {
        db.close();
      }
    }
  });
});
