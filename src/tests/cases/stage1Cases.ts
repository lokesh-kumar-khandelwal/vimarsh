/**
 * Pure Self-Test Cases for Stage 1 & 2 (/src/tests/cases/stage1Cases.ts)
 *
 * Written once as pure functions and executed identically from both:
 * 1. Vitest (`npm test`)
 * 2. The in-browser Self-Tests panel (no API key required; browser run is authoritative)
 */

import { buildGenerationConfig, GEMINI_MODEL, SQL_JS_VERSION } from '../../config';
import {
  ENUM_VALUES,
  FREE_FORM_TEXT_COLUMNS,
  GLOSSARY,
  isSensitiveIdentifier,
  JOIN_HINTS,
  SENSITIVE_COLUMNS,
} from '../../engine/context';
import { getDateHelpers } from '../../engine/dateHelpers';
import { runParserSmokeTest } from '../../engine/parserSmokeTest';
import { PROMPT_VERSION } from '../../engine/systemPrompt';
import type {
  SchemaContext,
  SeedReport,
  TestCaseResult,
} from '../../types';

function runCase(
  id: string,
  suite: TestCaseResult['suite'],
  name: string,
  fn: () => { passed: boolean; details: string }
): TestCaseResult {
  const t0 = performance.now();
  try {
    const res = fn();
    return {
      id,
      suite,
      name,
      passed: res.passed,
      details: res.details,
      durationMs: Math.max(0.1, Number((performance.now() - t0).toFixed(2))),
    };
  } catch (err) {
    return {
      id,
      suite,
      name,
      passed: false,
      details: err instanceof Error ? err.message : String(err),
      durationMs: Math.max(0.1, Number((performance.now() - t0).toFixed(2))),
    };
  }
}

/**
 * 1. DateHelpers pure test suite:
 * Tests month/year boundaries, leap-year February, local midnight vs end-of-day,
 * Monday week_start calculation, quarter boundaries, and 7/30/90-day offsets.
 */
export function runDateHelpersTestCases(): TestCaseResult[] {
  const results: TestCaseResult[] = [];

  results.push(
    runCase(
      'dh_year_month_boundary',
      'date_helpers',
      'Year & month boundary rollover (Jan 1, 2026 local calendar)',
      () => {
        const jan1 = new Date(2026, 0, 1, 0, 0, 0, 0);
        const dh = getDateHelpers(jan1);
        const passed =
          dh.today === '2026-01-01' &&
          dh.yesterday === '2025-12-31' &&
          dh.month_start === '2026-01-01' &&
          dh.last_month_start === '2025-12-01' &&
          dh.last_month_end_exclusive === '2026-01-01' &&
          dh.quarter_start === '2026-01-01' &&
          dh.last_quarter_start === '2025-10-01' &&
          dh.last_quarter_end_exclusive === '2026-01-01' &&
          dh.year_start === '2026-01-01' &&
          dh.last_year_start === '2025-01-01';
        return {
          passed,
          details: `today=${dh.today}, yesterday=${dh.yesterday}, last_month=[${dh.last_month_start}, ${dh.last_month_end_exclusive}), last_quarter=[${dh.last_quarter_start}, ${dh.last_quarter_end_exclusive})`,
        };
      }
    )
  );

  results.push(
    runCase(
      'dh_leap_year_february',
      'date_helpers',
      'Leap-year February (Mar 1, 2024 vs Mar 1, 2025 local calendar)',
      () => {
        const mar2024 = getDateHelpers(new Date(2024, 2, 1, 0, 0, 0, 0));
        const mar2025 = getDateHelpers(new Date(2025, 2, 1, 0, 0, 0, 0));
        const feb29 = getDateHelpers(new Date(2024, 1, 29, 23, 59, 59, 0));
        const passed =
          mar2024.yesterday === '2024-02-29' &&
          mar2024.last_month_start === '2024-02-01' &&
          mar2024.last_month_end_exclusive === '2024-03-01' &&
          mar2025.yesterday === '2025-02-28' &&
          feb29.today === '2024-02-29' &&
          feb29.yesterday === '2024-02-28';
        return {
          passed,
          details: `2024-03-01 yesterday=${mar2024.yesterday}, 2025-03-01 yesterday=${mar2025.yesterday}, 2024-02-29 today=${feb29.today}`,
        };
      }
    )
  );

  results.push(
    runCase(
      'dh_local_midnight_invariance',
      'date_helpers',
      'Local midnight (00:00:00.000) and end-of-day (23:59:59.999) never drift via UTC conversion',
      () => {
        const midnight = getDateHelpers(new Date(2026, 9, 28, 0, 0, 0, 0));
        const lateNight = getDateHelpers(new Date(2026, 9, 28, 23, 59, 59, 999));
        const passed =
          midnight.today === '2026-10-28' &&
          lateNight.today === '2026-10-28' &&
          midnight.yesterday === '2026-10-27' &&
          lateNight.yesterday === '2026-10-27';
        return {
          passed,
          details: `00:00:00 -> ${midnight.today}; 23:59:59 -> ${lateNight.today}`,
        };
      }
    )
  );

  results.push(
    runCase(
      'dh_week_start_monday',
      'date_helpers',
      'week_start always resolves to Monday of the current week (including on Sunday)',
      () => {
        const sun = getDateHelpers(new Date(2026, 9, 25, 8, 0, 0));
        const mon = getDateHelpers(new Date(2026, 9, 26, 8, 0, 0));
        const wed = getDateHelpers(new Date(2026, 9, 28, 8, 0, 0));
        const passed =
          sun.week_start === '2026-10-19' &&
          mon.week_start === '2026-10-26' &&
          wed.week_start === '2026-10-26';
        return {
          passed,
          details: `Sun(10-25)->${sun.week_start}, Mon(10-26)->${mon.week_start}, Wed(10-28)->${wed.week_start}`,
        };
      }
    )
  );

  results.push(
    runCase(
      'dh_relative_offsets_7_30_90',
      'date_helpers',
      'Relative dates 7, 30, and 90 days ago compute accurately across month boundaries',
      () => {
        const oct28 = getDateHelpers(new Date(2026, 9, 28, 12, 0, 0));
        const passed =
          oct28.days_ago_7 === '2026-10-21' &&
          oct28.days_ago_30 === '2026-09-28' &&
          oct28.days_ago_90 === '2026-07-30' &&
          oct28.quarter_start === '2026-10-01' &&
          oct28.last_quarter_start === '2026-07-01' &&
          oct28.last_quarter_end_exclusive === '2026-10-01';
        return {
          passed,
          details: `for 2026-10-28: -7d=${oct28.days_ago_7}, -30d=${oct28.days_ago_30}, -90d=${oct28.days_ago_90}`,
        };
      }
    )
  );

  return results;
}

/**
 * 2. SchemaLoader & Static Context test suite:
 * Verifies tables, columns, PKs, FKs, JOIN_HINTS, ENUM_VALUES, GLOSSARY, and SENSITIVE_COLUMNS.
 */
export function runSchemaAndContextTestCases(schema: SchemaContext): TestCaseResult[] {
  const results: TestCaseResult[] = [];

  results.push(
    runCase(
      'schema_tables_and_no_sqlite_internal',
      'schema_context',
      'Schema contains exactly the 5 domain tables and excludes sqlite_* internal tables',
      () => {
        const names = schema.tables.map((t) => t.name);
        const expected = ['customers', 'products', 'orders', 'order_items', 'returns'];
        const hasSqliteInternal = names.some((n) => n.startsWith('sqlite_'));
        const passed =
          !hasSqliteInternal &&
          names.length === expected.length &&
          expected.every((e) => names.includes(e));
        return {
          passed,
          details: `tables=[${names.join(', ')}]`,
        };
      }
    )
  );

  results.push(
    runCase(
      'schema_foreign_keys_and_pks',
      'schema_context',
      'PRAGMA table_info PKs and PRAGMA foreign_key_list FKs match DDL specification',
      () => {
        const ordersTable = schema.tables.find((t) => t.name === 'orders');
        const itemsTable = schema.tables.find((t) => t.name === 'order_items');
        const returnsTable = schema.tables.find((t) => t.name === 'returns');

        const ordersFkOk =
          ordersTable?.foreignKeys.length === 1 &&
          ordersTable.foreignKeys[0].fromColumn === 'customer_id' &&
          ordersTable.foreignKeys[0].toTable === 'customers' &&
          ordersTable.foreignKeys[0].toColumn === 'customer_id';

        const itemsFkOk =
          itemsTable?.foreignKeys.length === 2 &&
          itemsTable.foreignKeys.some(
            (fk) => fk.fromColumn === 'order_id' && fk.toTable === 'orders'
          ) &&
          itemsTable.foreignKeys.some(
            (fk) => fk.fromColumn === 'product_id' && fk.toTable === 'products'
          );

        const returnsFkOk =
          returnsTable?.foreignKeys.length === 1 &&
          returnsTable.foreignKeys[0].fromColumn === 'order_id' &&
          returnsTable.foreignKeys[0].toTable === 'orders';

        const allHavePk = schema.tables.every((t) => t.columns.some((c) => c.isPrimaryKey));
        const passed = Boolean(ordersFkOk && itemsFkOk && returnsFkOk && allHavePk);

        return {
          passed,
          details: `orders_fk=${ordersFkOk}, order_items_fk=${itemsFkOk}, returns_fk=${returnsFkOk}, all_tables_have_pk=${allHavePk}`,
        };
      }
    )
  );

  results.push(
    runCase(
      'schema_join_hints',
      'schema_context',
      'JOIN_HINTS exposes all 4 canonical foreign-key join relationships',
      () => {
        const exprs = JOIN_HINTS.map((j) => j.expression);
        const expected = [
          'orders.customer_id = customers.customer_id',
          'order_items.order_id = orders.order_id',
          'order_items.product_id = products.product_id',
          'returns.order_id = orders.order_id',
        ];
        const passed = expected.every((e) => exprs.includes(e));
        return {
          passed,
          details: exprs.join(' | '),
        };
      }
    )
  );

  results.push(
    runCase(
      'schema_enums_and_freeform',
      'schema_context',
      "ENUM_VALUES defines controlled vocabularies (no 'returned' status) and FREE_FORM_TEXT_COLUMNS lists free-form columns",
      () => {
        const statuses = ENUM_VALUES['orders.status'] ?? [];
        const segments = ENUM_VALUES['customers.segment'] ?? [];
        const categories = ENUM_VALUES['products.category'] ?? [];
        const reasons = ENUM_VALUES['returns.reason'] ?? [];

        const passed =
          statuses.length === 4 &&
          !statuses.includes('returned') &&
          segments.length === 3 &&
          categories.length === 5 &&
          reasons.length === 4 &&
          FREE_FORM_TEXT_COLUMNS.includes('customers.name') &&
          FREE_FORM_TEXT_COLUMNS.includes('customers.city') &&
          FREE_FORM_TEXT_COLUMNS.includes('customers.state') &&
          FREE_FORM_TEXT_COLUMNS.includes('products.name');

        return {
          passed,
          details: `orders.status=[${statuses.join(', ')}]; free_form=[${FREE_FORM_TEXT_COLUMNS.join(', ')}]`,
        };
      }
    )
  );

  results.push(
    runCase(
      'schema_sensitive_columns',
      'schema_context',
      'SENSITIVE_COLUMNS designates customers.email and normalizes quoted/qualified identifiers',
      () => {
        const custTable = schema.tables.find((t) => t.name === 'customers');
        const emailCol = custTable?.columns.find((c) => c.name === 'email');
        const nameCol = custTable?.columns.find((c) => c.name === 'name');

        const passed =
          SENSITIVE_COLUMNS.length === 1 &&
          SENSITIVE_COLUMNS[0] === 'customers.email' &&
          Boolean(emailCol?.isSensitive) &&
          !nameCol?.isSensitive &&
          isSensitiveIdentifier('email') &&
          isSensitiveIdentifier('customers.email') &&
          isSensitiveIdentifier('"CUSTOMERS"."EMAIL"') &&
          isSensitiveIdentifier('`email`') &&
          isSensitiveIdentifier('[EMAIL]') &&
          !isSensitiveIdentifier('customer_id');

        return {
          passed,
          details: `SENSITIVE_COLUMNS=[${SENSITIVE_COLUMNS.join(', ')}], customers.email.isSensitive=${Boolean(emailCol?.isSensitive)}`,
        };
      }
    )
  );

  results.push(
    runCase(
      'schema_glossary_completeness',
      'schema_context',
      'GLOSSARY defines revenue, revenue before discounts, net revenue, returned order, active customer, and DATE BASIS rules 1-4',
      () => {
        const terms = GLOSSARY.map((g) => g.term);
        const requiredTerms = [
          'revenue',
          'revenue before discounts',
          'net revenue',
          'returned order',
          'active customer',
          'DATE BASIS (1): Status + Period',
          'DATE BASIS (2): Revenue Default',
          'DATE BASIS (3): Return Timing',
          'DATE BASIS (4): Ambiguous Order Dates',
          'Top N Default',
          'All-Time Default',
        ];
        const passed = requiredTerms.every((rt) => terms.includes(rt));
        return {
          passed,
          details: `${GLOSSARY.length} glossary rules verified`,
        };
      }
    )
  );

  return results;
}

/**
 * 3. Converts the Worker's trusted SeedReport into TestCaseResult entries
 * and verifies the 8-step connection setup sequence.
 */
export function runSeedReportTestCases(seedReport: SeedReport): TestCaseResult[] {
  const results: TestCaseResult[] = seedReport.checks.map((chk) => ({
    id: `seed_${chk.id}`,
    suite: 'seed_report',
    name: chk.name,
    passed: chk.passed,
    details: chk.details,
    durationMs: 0.5,
  }));

  results.push(
    runCase(
      'seed_setup_order_contract',
      'seed_report',
      'Worker connection setup followed exact 8-step sequence (foreign_keys -> DDL -> seed -> fk_check -> seed_validation -> schema -> query_only)',
      () => {
        const seq = seedReport.setupSequence;
        const passed =
          seq.length === 8 &&
          seq[0].includes('create database') &&
          seq[1].includes('PRAGMA foreign_keys = ON') &&
          seq[2].includes('create tables') &&
          seq[3].includes('seed') &&
          seq[4].includes('PRAGMA foreign_key_check') &&
          seq[5].includes('TRUSTED SEED VALIDATION') &&
          seq[6].includes('load schema context') &&
          seq[7].includes('PRAGMA query_only = ON');
        return {
          passed,
          details: seq.join(' -> '),
        };
      }
    )
  );

  return results;
}

/**
 * 4. Parser smoke test & configuration contract tests.
 */
export async function runStage1GuardAndParserTestCases(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  results.push(
    runCase(
      'parser_sqlite_smoke_test',
      'parser_smoke',
      'node-sql-parser/build/sqlite ES import parses SELECT AST, tables, and columns',
      () => {
        const smoke = runParserSmokeTest();
        return {
          passed: smoke.compatible,
          details: smoke.compatible
            ? `statementType=${smoke.statementType}, tables=[${smoke.tables.join(', ')}], columns=[${smoke.columns.join(', ')}]`
            : `FAILED: ${smoke.error ?? 'Unknown parser error'}`,
        };
      }
    )
  );

  results.push(
    runCase(
      'config_contract_check',
      'parser_smoke',
      'Config exports GEMINI_MODEL, pinned SQL_JS_VERSION, PROMPT_VERSION, and single buildGenerationConfig()',
      () => {
        const cfg = buildGenerationConfig('test instruction');
        const passed =
          typeof GEMINI_MODEL === 'string' &&
          GEMINI_MODEL.length > 0 &&
          SQL_JS_VERSION === '1.15.2' &&
          PROMPT_VERSION.length > 0 &&
          cfg.responseMimeType === 'application/json' &&
          Boolean(cfg.responseSchema);
        return {
          passed,
          details: `GEMINI_MODEL=${GEMINI_MODEL}, SQL_JS_VERSION=${SQL_JS_VERSION}, responseMimeType=${cfg.responseMimeType}`,
        };
      }
    )
  );

  return results;
}
