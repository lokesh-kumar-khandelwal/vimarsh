/**
 * Pure SQL Validator & Executor Test Cases (/src/tests/cases/sqlValidatorCases.ts)
 *
 * Covers 46 static validator cases (Steps 1–8) + dryRun (Step 9) + executor (Step 10) cases.
 * Executed identically in Vitest (`npm test`) and in the browser Self-Tests panel.
 */

import type { Database } from 'sql.js';
import { runDryRunOnDb, runExecuteOnDb } from '../../engine/sqlExecutor';
import { validateSqlStatic } from '../../engine/sqlValidator';
import type {
  SchemaContext,
  TestCaseResult,
  ValidationStepNumber,
} from '../../types';

export interface ValidatorTestSpec {
  id: string;
  name: string;
  sql: string;
  expectValid: boolean;
  expectedFailedStep?: ValidationStepNumber;
  expectedErrorSubstring?: string;
}

export const SQL_VALIDATOR_TEST_SPECS: ReadonlyArray<ValidatorTestSpec> = [
  {
    id: 'val_01_valid_select',
    name: 'Valid SELECT with explicit columns, WHERE filter, and LIMIT',
    sql: "SELECT customer_id, name, city, segment FROM customers WHERE segment = 'Corporate' LIMIT 10",
    expectValid: true,
  },
  {
    id: 'val_02_valid_cte_select',
    name: 'Valid CTE (WITH ... SELECT) followed by terminal SELECT and LIMIT',
    sql: "WITH delivered_orders AS (SELECT order_id, customer_id, created_at FROM orders WHERE status = 'delivered') SELECT customer_id, COUNT(order_id) AS delivered_count FROM delivered_orders GROUP BY customer_id ORDER BY delivered_count DESC LIMIT 10",
    expectValid: true,
  },
  {
    id: 'val_03_with_followed_by_delete',
    name: 'WITH CTE followed by DELETE is rejected (a WITH prefix alone never authorizes)',
    sql: 'WITH target AS (SELECT order_id FROM orders) DELETE FROM orders WHERE order_id IN (SELECT order_id FROM target)',
    expectValid: false,
    expectedErrorSubstring: 'DELETE',
  },
  {
    id: 'val_04_created_at_not_flagged',
    name: 'Column name created_at is NOT mis-flagged as CREATE keyword',
    sql: "SELECT order_id, customer_id, created_at, status FROM orders WHERE created_at >= '2026-01-01' ORDER BY created_at DESC LIMIT 25",
    expectValid: true,
  },
  {
    id: 'val_05_scalar_replace_disallowed_func',
    name: "Scalar function replace('a','b','c') in SELECT is rejected at Step 5 as a disallowed function (not write keyword)",
    sql: "SELECT order_id, replace('a', 'b', 'c') AS r FROM orders LIMIT 10",
    expectValid: false,
    expectedFailedStep: 5,
    expectedErrorSubstring: 'not on the function allowlist',
  },
  {
    id: 'val_06_replace_into_rejected_write',
    name: 'REPLACE INTO orders is rejected as a write operation',
    sql: "REPLACE INTO orders (order_id, customer_id, status, created_at, discount_pct) VALUES (999, 1, 'pending', '2026-10-01', 0)",
    expectValid: false,
    expectedErrorSubstring: 'REPLACE INTO',
  },
  {
    id: 'val_07_count_star_allowed',
    name: 'COUNT(*) is explicitly allowed',
    sql: 'SELECT status, COUNT(*) AS order_count FROM orders GROUP BY status LIMIT 10',
    expectValid: true,
  },
  {
    id: 'val_08_select_star_rejected',
    name: 'Unqualified star projection (SELECT *) is rejected at Step 3',
    sql: 'SELECT * FROM customers LIMIT 10',
    expectValid: false,
    expectedFailedStep: 3,
    expectedErrorSubstring: 'Star projection',
  },
  {
    id: 'val_09_select_qualified_star_rejected',
    name: 'Table-qualified star projection (SELECT o.*) is rejected at Step 3',
    sql: 'SELECT o.* FROM orders AS o LIMIT 10',
    expectValid: false,
    expectedFailedStep: 3,
    expectedErrorSubstring: 'Star projection',
  },
  {
    id: 'val_10_subquery_star_rejected',
    name: 'Star projection (SELECT *) inside a CTE or subquery is rejected at Step 3',
    sql: 'WITH all_orders AS (SELECT * FROM orders) SELECT order_id FROM all_orders LIMIT 10',
    expectValid: false,
    expectedFailedStep: 3,
    expectedErrorSubstring: 'Star projection',
  },
  {
    id: 'val_11_multiple_statements_rejected',
    name: 'Multiple semicolon-separated statements are rejected at Step 2',
    sql: 'SELECT order_id FROM orders LIMIT 5; SELECT customer_id FROM customers LIMIT 5',
    expectValid: false,
    expectedFailedStep: 2,
    expectedErrorSubstring: 'Exactly one statement',
  },
  {
    id: 'val_12_dml_insert_rejected',
    name: 'DML INSERT statement is rejected',
    sql: "INSERT INTO products (product_id, name, category, price, cost) VALUES (99, 'New', 'Books', 10.0, 5.0)",
    expectValid: false,
    expectedErrorSubstring: 'INSERT',
  },
  {
    id: 'val_13_dml_update_rejected',
    name: 'DML UPDATE statement is rejected',
    sql: "UPDATE orders SET status = 'cancelled' WHERE order_id = 1",
    expectValid: false,
    expectedErrorSubstring: 'UPDATE',
  },
  {
    id: 'val_14_dml_delete_rejected',
    name: 'DML DELETE statement is rejected',
    sql: 'DELETE FROM returns WHERE return_id = 1',
    expectValid: false,
    expectedErrorSubstring: 'DELETE',
  },
  {
    id: 'val_15_ddl_drop_rejected',
    name: 'DDL DROP TABLE statement is rejected',
    sql: 'DROP TABLE customers',
    expectValid: false,
    expectedErrorSubstring: 'DROP',
  },
  {
    id: 'val_16_ddl_alter_rejected',
    name: 'DDL ALTER TABLE statement is rejected',
    sql: 'ALTER TABLE customers ADD COLUMN phone TEXT',
    expectValid: false,
    expectedErrorSubstring: 'ALTER',
  },
  {
    id: 'val_17_ddl_create_rejected',
    name: 'DDL CREATE TABLE statement is rejected',
    sql: 'CREATE TABLE rogue_table (id INTEGER PRIMARY KEY)',
    expectValid: false,
    expectedErrorSubstring: 'CREATE',
  },
  {
    id: 'val_18_truncate_rejected',
    name: 'TRUNCATE TABLE statement is rejected',
    sql: 'TRUNCATE TABLE orders',
    expectValid: false,
    expectedErrorSubstring: 'TRUNCATE',
  },
  {
    id: 'val_19_merge_rejected',
    name: 'MERGE statement is rejected',
    sql: 'MERGE INTO orders USING customers ON orders.customer_id = customers.customer_id',
    expectValid: false,
    expectedErrorSubstring: 'MERGE',
  },
  {
    id: 'val_20_attach_detach_rejected',
    name: 'ATTACH / DETACH database statements are rejected',
    sql: "ATTACH DATABASE ':memory:' AS aux_db",
    expectValid: false,
    expectedErrorSubstring: 'ATTACH',
  },
  {
    id: 'val_21_pragma_rejected',
    name: 'PRAGMA statement is rejected',
    sql: 'PRAGMA table_info(customers)',
    expectValid: false,
    expectedErrorSubstring: 'PRAGMA',
  },
  {
    id: 'val_22_vacuum_rejected',
    name: 'VACUUM statement is rejected',
    sql: 'VACUUM',
    expectValid: false,
    expectedErrorSubstring: 'VACUUM',
  },
  {
    id: 'val_23_recursive_cte_rejected',
    name: 'WITH RECURSIVE CTE is rejected at Step 3',
    sql: 'WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq LIMIT 5) SELECT n FROM seq LIMIT 5',
    expectValid: false,
    expectedFailedStep: 3,
    expectedErrorSubstring: 'RECURSIVE',
  },
  {
    id: 'val_24_window_function_row_number_rejected',
    name: 'Window function ROW_NUMBER() OVER (...) is rejected at Step 3',
    sql: 'SELECT order_id, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at) AS rn FROM orders LIMIT 10',
    expectValid: false,
    expectedFailedStep: 3,
    expectedErrorSubstring: 'Window functions',
  },
  {
    id: 'val_25_window_function_sum_over_rejected',
    name: 'Aggregate window function SUM(...) OVER (...) is rejected at Step 3',
    sql: 'SELECT order_id, SUM(discount_pct) OVER (PARTITION BY customer_id) AS running_disc FROM orders LIMIT 10',
    expectValid: false,
    expectedFailedStep: 3,
    expectedErrorSubstring: 'Window functions',
  },
  {
    id: 'val_26_disallowed_function_random_rejected',
    name: 'Disallowed function RANDOM() is rejected at Step 5',
    sql: 'SELECT order_id, RANDOM() AS rnd FROM orders LIMIT 10',
    expectValid: false,
    expectedFailedStep: 5,
    expectedErrorSubstring: 'not on the function allowlist',
  },
  {
    id: 'val_27_disallowed_function_group_concat_rejected',
    name: 'Disallowed function GROUP_CONCAT() is rejected at Step 5',
    sql: 'SELECT customer_id, GROUP_CONCAT(status) AS statuses FROM orders GROUP BY customer_id LIMIT 10',
    expectValid: false,
    expectedFailedStep: 5,
    expectedErrorSubstring: 'not on the function allowlist',
  },
  {
    id: 'val_28_allowlisted_functions_accepted',
    name: 'All 19 allowlisted functions + CASE + CAST are accepted',
    sql: "SELECT COUNT(o.order_id) AS c, SUM(oi.quantity) AS s, AVG(oi.unit_price) AS a, MIN(oi.unit_price) AS mn, MAX(oi.unit_price) AS mx, ROUND(AVG(oi.unit_price), 2) AS r, ABS(o.discount_pct) AS ab, COALESCE(o.shipped_at, o.created_at) AS co, IFNULL(o.delivered_at, 'none') AS ifn, NULLIF(o.discount_pct, 0) AS nif, CAST(o.order_id AS TEXT) AS cst, LENGTH(c.name) AS len, LOWER(c.city) AS low, UPPER(c.state) AS up, TRIM(c.name) AS tr, SUBSTR(c.name, 1, 4) AS sub, DATE(o.created_at) AS dt, STRFTIME('%Y-%m', o.created_at) AS ym, JULIANDAY(o.created_at) AS jd, CASE WHEN o.discount_pct > 0 THEN 1 ELSE 0 END AS has_disc FROM orders o JOIN order_items oi ON oi.order_id = o.order_id JOIN customers c ON c.customer_id = o.customer_id GROUP BY o.order_id, c.name, c.city, c.state, o.discount_pct, o.shipped_at, o.created_at, o.delivered_at LIMIT 10",
    expectValid: true,
  },
  {
    id: 'val_29_missing_limit_rejected',
    name: 'Missing top-level LIMIT is rejected at Step 4',
    sql: "SELECT customer_id, name FROM customers WHERE state = 'CA'",
    expectValid: false,
    expectedFailedStep: 4,
    expectedErrorSubstring: 'LIMIT',
  },
  {
    id: 'val_30_subquery_limit_without_toplevel_limit_rejected',
    name: 'Subquery LIMIT without a top-level LIMIT is rejected at Step 4',
    sql: 'SELECT customer_id, name FROM customers WHERE customer_id IN (SELECT customer_id FROM orders LIMIT 5)',
    expectValid: false,
    expectedFailedStep: 4,
    expectedErrorSubstring: 'LIMIT',
  },
  {
    id: 'val_31_limit_over_1000_rejected',
    name: 'Top-level LIMIT > 1000 (LIMIT 1001) is rejected at Step 4',
    sql: 'SELECT order_id, status FROM orders LIMIT 1001',
    expectValid: false,
    expectedFailedStep: 4,
    expectedErrorSubstring: '1000',
  },
  {
    id: 'val_32_limit_zero_or_negative_rejected',
    name: 'Top-level LIMIT <= 0 (LIMIT 0) is rejected at Step 4',
    sql: 'SELECT order_id, status FROM orders LIMIT 0',
    expectValid: false,
    expectedFailedStep: 4,
    expectedErrorSubstring: 'at least 1',
  },
  {
    id: 'val_33_sensitive_unqualified_select_rejected',
    name: 'Sensitive column (email) unqualified in SELECT is rejected at Step 7',
    sql: 'SELECT customer_id, name, email FROM customers LIMIT 10',
    expectValid: false,
    expectedFailedStep: 7,
    expectedErrorSubstring: 'sensitive column',
  },
  {
    id: 'val_34_sensitive_qualified_where_rejected',
    name: 'Sensitive column (customers.email) in WHERE clause is rejected at Step 7',
    sql: "SELECT customer_id, name FROM customers WHERE customers.email LIKE '%@example%' LIMIT 10",
    expectValid: false,
    expectedFailedStep: 7,
    expectedErrorSubstring: 'sensitive column',
  },
  {
    id: 'val_35_sensitive_in_subquery_rejected',
    name: 'Sensitive column (email) inside a WHERE subquery is rejected at Step 7',
    sql: 'SELECT order_id, status FROM orders WHERE customer_id IN (SELECT customer_id FROM customers WHERE email IS NOT NULL) LIMIT 10',
    expectValid: false,
    expectedFailedStep: 7,
    expectedErrorSubstring: 'sensitive column',
  },
  {
    id: 'val_36_sensitive_in_cte_rejected',
    name: 'Sensitive column (email) inside a CTE is rejected at Step 7',
    sql: 'WITH cust_cte AS (SELECT customer_id, email FROM customers) SELECT customer_id FROM cust_cte LIMIT 10',
    expectValid: false,
    expectedFailedStep: 7,
    expectedErrorSubstring: 'sensitive column',
  },
  {
    id: 'val_37_sensitive_as_column_alias_rejected',
    name: 'Sensitive identifier used as a column alias (AS email) is rejected at Step 7',
    sql: 'SELECT name AS email FROM customers LIMIT 10',
    expectValid: false,
    expectedFailedStep: 7,
    expectedErrorSubstring: 'sensitive column',
  },
  {
    id: 'val_38_sensitive_double_quoted_uppercase_rejected',
    name: 'Double-quoted uppercase sensitive column ("CUSTOMERS"."EMAIL") is rejected at Step 7',
    sql: 'SELECT "CUSTOMERS"."EMAIL" FROM customers LIMIT 10',
    expectValid: false,
    expectedFailedStep: 7,
    expectedErrorSubstring: 'sensitive column',
  },
  {
    id: 'val_39_sensitive_unqualified_double_quoted_rejected',
    name: 'Unqualified double-quoted sensitive column ("EMAIL") is rejected at Step 7',
    sql: 'SELECT "EMAIL" FROM customers LIMIT 10',
    expectValid: false,
    expectedFailedStep: 7,
    expectedErrorSubstring: 'sensitive column',
  },
  {
    id: 'val_40_sensitive_backtick_and_bracket_quoted_rejected',
    name: 'Backtick (`email`) and bracket ([email]) quoted sensitive columns are rejected at Step 7',
    sql: 'SELECT [email] FROM customers LIMIT 10',
    expectValid: false,
    expectedFailedStep: 7,
    expectedErrorSubstring: 'sensitive column',
  },
  {
    id: 'val_41_sensitive_in_groupby_orderby_rejected',
    name: 'Sensitive column (email) in GROUP BY / ORDER BY is rejected at Step 7',
    sql: 'SELECT segment, COUNT(*) AS cnt FROM customers GROUP BY email ORDER BY email LIMIT 10',
    expectValid: false,
    expectedFailedStep: 7,
    expectedErrorSubstring: 'sensitive column',
  },
  {
    id: 'val_42_sqlite_master_rejected',
    name: 'Query referencing sqlite_master internal object is rejected',
    sql: "SELECT name, sql FROM sqlite_master WHERE type = 'table' LIMIT 10",
    expectValid: false,
    expectedErrorSubstring: 'sqlite_',
  },
  {
    id: 'val_43_unknown_table_rejected',
    name: 'Query referencing an unknown table (employees) is rejected at Step 6',
    sql: 'SELECT employee_id, salary FROM employees LIMIT 10',
    expectValid: false,
    expectedFailedStep: 6,
    expectedErrorSubstring: 'Unknown table',
  },
  {
    id: 'val_44_unknown_column_rejected',
    name: 'Query referencing an unknown column (phone_number) is rejected at Step 6',
    sql: 'SELECT customer_id, phone_number FROM customers LIMIT 10',
    expectValid: false,
    expectedFailedStep: 6,
    expectedErrorSubstring: 'Unknown column',
  },
  {
    id: 'val_45_ambiguous_unqualified_column_rejected',
    name: 'Unqualified column (order_id) present in multiple joined tables is rejected at Step 6',
    sql: 'SELECT order_id, quantity FROM orders JOIN order_items ON orders.order_id = order_items.order_id LIMIT 10',
    expectValid: false,
    expectedFailedStep: 6,
    expectedErrorSubstring: 'Ambiguous unqualified column',
  },
  {
    id: 'val_46_more_than_6_tables_joined_rejected',
    name: 'Joining more than 6 tables (7 tables joined) is rejected at Step 6',
    sql: 'SELECT o1.order_id FROM orders o1 JOIN orders o2 ON o1.order_id = o2.order_id JOIN orders o3 ON o1.order_id = o3.order_id JOIN orders o4 ON o1.order_id = o4.order_id JOIN orders o5 ON o1.order_id = o5.order_id JOIN orders o6 ON o1.order_id = o6.order_id JOIN orders o7 ON o1.order_id = o7.order_id LIMIT 10',
    expectValid: false,
    expectedFailedStep: 6,
    expectedErrorSubstring: 'exceeding the maximum of 6 tables',
  },
  {
    id: 'val_47_parser_throws_syntax_error_rejected',
    name: 'Malformed SQL causing parser exception is rejected (fails closed at Step 1)',
    sql: 'SELECT FROM WHERE (( INVALID SQL LIMIT 10',
    expectValid: false,
    expectedFailedStep: 1,
  },
];

/**
 * Runs all 47 static SQL Validator test cases against `schemaContext`.
 */
export function runSqlValidatorTestCases(schemaContext: SchemaContext): TestCaseResult[] {
  return SQL_VALIDATOR_TEST_SPECS.map((spec) => {
    const t0 = performance.now();
    const res = validateSqlStatic(spec.sql, schemaContext);
    const durationMs = Math.max(0.1, Number((performance.now() - t0).toFixed(2)));

    if (spec.expectValid) {
      if (res.valid) {
        return {
          id: spec.id,
          suite: 'sql_validator',
          name: spec.name,
          passed: true,
          details: `ACCEPTED (tables=[${res.tablesUsed.join(', ')}], LIMIT=${res.limitValue})`,
          durationMs,
        };
      }
      return {
        id: spec.id,
        suite: 'sql_validator',
        name: spec.name,
        passed: false,
        details: `UNEXPECTED REJECT at Step ${res.failedStep}: ${res.error}`,
        durationMs,
      };
    } else {
      if (res.valid) {
        return {
          id: spec.id,
          suite: 'sql_validator',
          name: spec.name,
          passed: false,
          details: `UNEXPECTED ACCEPT: query should have been rejected!`,
          durationMs,
        };
      }
      let passed = true;
      if (spec.expectedFailedStep !== undefined) {
        passed = res.failedStep === spec.expectedFailedStep;
      }
      if (passed && spec.expectedErrorSubstring) {
        passed = res.error
          .toLowerCase()
          .includes(spec.expectedErrorSubstring.toLowerCase());
      }
      return {
        id: spec.id,
        suite: 'sql_validator',
        name: spec.name,
        passed,
        details: `REJECTED at Step ${res.failedStep}: ${res.error}`,
        durationMs,
      };
    }
  });
}

/**
 * Runs Step 9 (Dry Run) and Step 10 (Executor, 1000-row cap, and "No rows matched" empty state)
 * against a live sql.js Database (in Vitest) or DbClient (in Browser).
 */
export async function runExecutorAndDryRunTestCases(
  schemaContext: SchemaContext,
  runner: {
    dryRun: (sql: import('../../types').ValidatedSql) => Promise<import('../../types').DryRunResult>;
    execute: (sql: import('../../types').ValidatedSql) => Promise<import('../../types').QueryExecutionResult>;
  }
): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  // 1. Valid query dryRun (Step 9) and execute (Step 10)
  {
    const t0 = performance.now();
    const sql =
      "SELECT c.segment, COUNT(o.order_id) AS total_orders FROM customers c JOIN orders o ON c.customer_id = o.customer_id WHERE o.status <> 'cancelled' GROUP BY c.segment ORDER BY total_orders DESC LIMIT 10";
    const v = validateSqlStatic(sql, schemaContext);
    if (!v.valid) {
      results.push({
        id: 'exec_01_valid_dryrun_and_execute',
        suite: 'worker_executor',
        name: 'Step 9 Dry Run (EXPLAIN QUERY PLAN) & Step 10 Execute return accurate rows',
        passed: false,
        details: v.error,
        durationMs: 1,
      });
    } else {
      const dry = await runner.dryRun(v.validatedSql);
      const exec = await runner.execute(v.validatedSql);
      const passed =
        dry.ok &&
        exec.columns.length === 2 &&
        exec.rowCount === 3 &&
        !exec.isEmpty &&
        !exec.truncated;
      results.push({
        id: 'exec_01_valid_dryrun_and_execute',
        suite: 'worker_executor',
        name: 'Step 9 Dry Run (EXPLAIN QUERY PLAN) & Step 10 Execute return accurate rows',
        passed,
        details: `columns=[${exec.columns.join(', ')}], rowCount=${exec.rowCount}, truncated=${exec.truncated}`,
        durationMs: Math.max(0.1, Number((performance.now() - t0).toFixed(2))),
      });
    }
  }

  // 2. Truthful Empty Result State ("No rows matched")
  {
    const t0 = performance.now();
    const sql =
      "SELECT order_id, status FROM orders WHERE created_at < '1990-01-01' LIMIT 10";
    const v = validateSqlStatic(sql, schemaContext);
    if (!v.valid) {
      results.push({
        id: 'exec_02_empty_result_state',
        suite: 'worker_executor',
        name: 'Zero matching rows returns valid result with emptyMessage = "No rows matched"',
        passed: false,
        details: v.error,
        durationMs: 1,
      });
    } else {
      const exec = await runner.execute(v.validatedSql);
      const passed =
        exec.rowCount === 0 &&
        exec.isEmpty === true &&
        exec.emptyMessage === 'No rows matched' &&
        exec.truncated === false;
      results.push({
        id: 'exec_02_empty_result_state',
        suite: 'worker_executor',
        name: 'Zero matching rows returns valid result with emptyMessage = "No rows matched"',
        passed,
        details: `rowCount=${exec.rowCount}, isEmpty=${exec.isEmpty}, emptyMessage="${exec.emptyMessage}"`,
        durationMs: Math.max(0.1, Number((performance.now() - t0).toFixed(2))),
      });
    }
  }

  // 3. 1000-row cap while stepping (cross-join producing >1000 rows with LIMIT 1000)
  {
    const t0 = performance.now();
    // 40 customers x 25 products = 1000 rows; 40 customers x 300 orders = 12,000 rows -> with LIMIT 1000 returns 1000 rows
    const sql =
      'SELECT c.customer_id, o.order_id FROM customers c JOIN orders o ON c.customer_id <> o.customer_id LIMIT 1000';
    const v = validateSqlStatic(sql, schemaContext);
    if (!v.valid) {
      results.push({
        id: 'exec_03_row_cap_1000',
        suite: 'worker_executor',
        name: 'Step 10 reads at most 1000 rows while stepping without editing SQL text',
        passed: false,
        details: v.error,
        durationMs: 1,
      });
    } else {
      const exec = await runner.execute(v.validatedSql);
      const passed = exec.rowCount === 1000 && exec.rows.length === 1000;
      results.push({
        id: 'exec_03_row_cap_1000',
        suite: 'worker_executor',
        name: 'Step 10 reads at most 1000 rows while stepping without editing SQL text',
        passed,
        details: `rowCount=${exec.rowCount}, columns=[${exec.columns.join(', ')}]`,
        durationMs: Math.max(0.1, Number((performance.now() - t0).toFixed(2))),
      });
    }
  }

  return results;
}

/**
 * Helper to create a direct runner from an sql.js Database instance (used in Vitest).
 */
export function createDirectDbRunner(db: Database) {
  return {
    dryRun: async (sql: import('../../types').ValidatedSql) => runDryRunOnDb(db, sql),
    execute: async (sql: import('../../types').ValidatedSql) => runExecuteOnDb(db, sql),
  };
}
