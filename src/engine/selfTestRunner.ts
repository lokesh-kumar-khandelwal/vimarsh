import type { DbClient } from './dbClient';
import {
  runExecutorAndDryRunTestCases,
  runSqlValidatorTestCases,
} from '../tests/cases/sqlValidatorCases';
import {
  runDateHelpersTestCases,
  runSchemaAndContextTestCases,
  runSeedReportTestCases,
  runStage1GuardAndParserTestCases,
} from '../tests/cases/stage1Cases';
import { runStage3EngineTestCases } from '../tests/cases/stage3Cases';
import {
  runGoldenSetAndComparatorTestCases,
  runHistorySerializerTestCases,
  runRequestBuilderContractTestCases,
  runSessionStoreTestCases,
  runStrictJsonParserTestCases,
} from '../tests/cases/stage4Cases';
import { runStage5FaultScenarioTestCases } from '../tests/cases/stage5FaultCases';
import type {
  SchemaContext,
  SeedReport,
  TestCaseResult,
  ValidatedSql,
} from '../types';

/**
 * Orchestrates all deterministic in-app verification suites against the active
 * SQLite Web Worker (`DbClient`), `SeedReport`, and `SchemaContext`.
 */
export async function runAllInAppSelfTests(
  client: DbClient,
  report: SeedReport,
  schema: SchemaContext
): Promise<TestCaseResult[]> {
  const runner = {
    dryRun: (sql: ValidatedSql) => client.dryRun(sql),
    execute: (sql: ValidatedSql) => client.execute(sql),
  };

  const faultCases = await runStage5FaultScenarioTestCases(schema, {
    seedReport: report,
    schemaContext: schema,
  });
  const goldenCases = await runGoldenSetAndComparatorTestCases(schema, runner);
  const strictJsonCases = runStrictJsonParserTestCases();
  const historyCases = runHistorySerializerTestCases();
  const requestBuilderCases = runRequestBuilderContractTestCases(schema);
  const sessionCases = runSessionStoreTestCases();
  const stage3Cases = await runStage3EngineTestCases(schema, runner);
  const validatorCases = runSqlValidatorTestCases(schema);
  const execCases = await runExecutorAndDryRunTestCases(schema, runner);
  const seedCases = runSeedReportTestCases(report);
  const dateCases = runDateHelpersTestCases();
  const schemaCases = runSchemaAndContextTestCases(schema);
  const parserCases = await runStage1GuardAndParserTestCases();

  return [
    ...faultCases,
    ...goldenCases,
    ...strictJsonCases,
    ...historyCases,
    ...requestBuilderCases,
    ...sessionCases,
    ...stage3Cases,
    ...validatorCases,
    ...execCases,
    ...seedCases,
    ...dateCases,
    ...schemaCases,
    ...parserCases,
  ];
}
