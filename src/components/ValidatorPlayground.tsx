import React, { useState } from 'react';
import {
  CheckCircle2,
  MinusCircle,
  Play,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { DbClient } from '../engine/dbClient';
import { validateSqlWithDryRun } from '../engine/sqlValidator';
import type { SchemaContext, SqlFullValidationResult } from '../types';

interface ValidatorPlaygroundProps {
  schemaContext: SchemaContext | null;
  dbClient: DbClient;
}

const SAMPLE_QUERIES: ReadonlyArray<{
  label: string;
  sql: string;
}> = [
  {
    label: 'Valid Join + Aggregation',
    sql: "SELECT c.segment, COUNT(o.order_id) AS order_count, ROUND(SUM(oi.quantity * oi.unit_price * (1.0 - o.discount_pct / 100.0)), 2) AS revenue\nFROM customers c\nJOIN orders o ON c.customer_id = o.customer_id\nJOIN order_items oi ON oi.order_id = o.order_id\nWHERE o.status <> 'cancelled'\nGROUP BY c.segment\nORDER BY revenue DESC\nLIMIT 10;",
  },
  {
    label: 'Valid CTE Query',
    sql: "WITH delivered AS (\n  SELECT order_id, customer_id, created_at\n  FROM orders\n  WHERE status = 'delivered'\n)\nSELECT customer_id, COUNT(order_id) AS delivered_orders\nFROM delivered\nGROUP BY customer_id\nORDER BY delivered_orders DESC\nLIMIT 10;",
  },
  {
    label: 'Reject: SELECT * (Step 3)',
    sql: 'SELECT * FROM customers LIMIT 10;',
  },
  {
    label: 'Reject: Missing LIMIT (Step 4)',
    sql: "SELECT order_id, status, created_at FROM orders WHERE status = 'shipped';",
  },
  {
    label: "Reject: replace() Function (Step 5)",
    sql: "SELECT order_id, replace(status, 'pending', 'active') AS clean_status FROM orders LIMIT 10;",
  },
  {
    label: 'Reject: Sensitive Column (Step 7)',
    sql: 'SELECT customer_id, name, "EMAIL" FROM customers LIMIT 10;',
  },
  {
    label: 'Reject: WITH ... DELETE (Step 1/2)',
    sql: 'WITH target AS (SELECT order_id FROM orders) DELETE FROM orders WHERE order_id IN (SELECT order_id FROM target);',
  },
  {
    label: 'Reject: REPLACE INTO Write (Step 2)',
    sql: "REPLACE INTO orders (order_id, customer_id, status, created_at, discount_pct) VALUES (999, 1, 'pending', '2026-10-01', 0);",
  },
];

export const ValidatorPlayground: React.FC<ValidatorPlaygroundProps> = ({
  schemaContext,
  dbClient,
}) => {
  const [sqlInput, setSqlInput] = useState<string>(SAMPLE_QUERIES[0].sql);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [result, setResult] = useState<SqlFullValidationResult | null>(null);

  const handleValidate = async (sqlToTest: string = sqlInput) => {
    if (!schemaContext) return;
    setIsValidating(true);
    try {
      const res = await validateSqlWithDryRun(sqlToTest, schemaContext, dbClient);
      setResult(res);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSelectSample = (sampleSql: string) => {
    setSqlInput(sampleSql);
    if (schemaContext) {
      void handleValidate(sampleSql);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Safety Contract Notice */}
      <section
        aria-label="Validator Playground Controls"
        className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-5 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1.5">
            <span className="label-mono text-[#38bdf8] block">
              FAIL-CLOSED SQL SAFETY ENGINE
            </span>
            <h2 className="font-syne font-extrabold text-2xl uppercase tracking-tight text-[#e4e4e7]">
              VALIDATOR PLAYGROUND (STEPS 1–9 ONLY)
            </h2>
            <p className="text-xs text-[#e4e4e7]/65 leading-relaxed max-w-3xl">
              Paste any SQL statement to inspect deterministic validation across AST parsing, statement &amp; projection rules, LIMIT bounds, function allowlist, schema resolution, sensitive column blocking, token filters, and Worker{' '}
              <code className="font-mono text-[#38bdf8]">EXPLAIN QUERY PLAN</code>{' '}
              dry run.{' '}
              <strong className="text-[#e4e4e7]">
                Step 10 (Execution) is never run on pasted SQL.
              </strong>
            </p>
          </div>
        </div>

        {/* Sample Preset Buttons */}
        <div className="space-y-2">
          <div className="label-mono">LOAD PRESET TEST QUERY:</div>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_QUERIES.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => handleSelectSample(sample.sql)}
                className="px-2.5 py-1.5 text-[11px] font-mono rounded-none border border-[#e4e4e7]/25 bg-[#0c0c0e] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>

        {/* SQL Textarea */}
        <div className="space-y-2">
          <label
            htmlFor="validator-sql-input"
            className="block text-xs font-mono font-bold uppercase tracking-wider text-[#e4e4e7]"
          >
            SQL Statement to Validate (No LLM, Zero Execution)
          </label>
          <textarea
            id="validator-sql-input"
            rows={6}
            value={sqlInput}
            onChange={(e) => setSqlInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleValidate();
              }
            }}
            placeholder="Paste any SQL statement here..."
            className="w-full rounded-none border border-[#e4e4e7]/30 bg-[#0c0c0e] p-3.5 font-mono text-xs text-[#38bdf8] placeholder:text-[#e4e4e7]/35 focus:border-[#38bdf8] leading-relaxed"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="text-[11px] font-mono text-[#e4e4e7]/60">
            Tip: Press <kbd className="font-mono text-[#e4e4e7]">Ctrl+Enter</kbd> or click Validate SQL to run Steps 1–9.
          </span>
          <button
            type="button"
            onClick={() => void handleValidate()}
            disabled={!schemaContext || isValidating}
            className="inline-flex items-center gap-2 py-2 px-4 text-xs font-mono font-bold uppercase tracking-wider rounded-none bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>
              {isValidating ? 'Validating Steps 1–9...' : 'Validate SQL (Steps 1–9)'}
            </span>
          </button>
        </div>
      </section>

      {/* Validation Verdict & 9-Step Trace */}
      {result && (
        <section
          aria-label="Validation Verdict and Step Trace"
          className="rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] overflow-hidden"
        >
          {/* Verdict Banner */}
          <div
            className={`p-5 border-b ${
              result.valid
                ? 'border-[#4ade80]/50 bg-[#4ade80]/[0.06] text-[#4ade80]'
                : 'border-[#f87171]/50 bg-[#f87171]/[0.06] text-[#f87171]'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                {result.valid ? (
                  <ShieldCheck className="w-5 h-5 text-[#4ade80] shrink-0 mt-0.5" />
                ) : (
                  <ShieldAlert className="w-5 h-5 text-[#f87171] shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-sm font-bold uppercase ${
                        result.valid ? 'text-[#4ade80]' : 'text-[#f87171]'
                      }`}
                    >
                      {result.valid
                        ? 'ACCEPTED — Steps 1–9 Passed (ValidatedSql Branded)'
                        : `REJECTED — Failed at Step ${result.failedStep}`}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-[#e4e4e7] break-words">
                    {result.valid
                      ? `Statement passed static AST validation and SQLite EXPLAIN QUERY PLAN dry run (${result.dryRunDurationMs ?? 0} ms). Step 10 execution was skipped per Playground safety policy.`
                      : result.error}
                  </p>
                </div>
              </div>

              {result.valid && (
                <div className="flex items-center gap-4 text-xs font-mono text-[#38bdf8] tabular-nums shrink-0">
                  <span>
                    Tables: {result.tablesUsed.join(', ') || 'none'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>LIMIT: {result.limitValue}</span>
                </div>
              )}
            </div>
          </div>

          {/* 9-Step Pipeline Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e4e4e7]/15 text-[10px] font-mono uppercase tracking-widest text-[#e4e4e7]/60 bg-[#121216]">
                  <th className="py-2.5 px-4 w-28">STATUS</th>
                  <th className="py-2.5 px-4 w-88">SAFETY ENGINE STEP</th>
                  <th className="py-2.5 px-4">STEP OUTCOME &amp; REASON</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e4e4e7]/10 text-xs">
                {result.steps.map((st) => (
                  <tr
                    key={st.step}
                    className="hover:bg-[#e4e4e7]/[0.03] transition-colors"
                  >
                    <td className="py-2.5 px-4 whitespace-nowrap align-top">
                      {st.status === 'passed' ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-[#4ade80]">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          PASS
                        </span>
                      ) : st.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-[#f87171]">
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                          REJECT
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-[#e4e4e7]/50">
                          <MinusCircle className="w-3.5 h-3.5 shrink-0" />
                          SKIPPED
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-[#e4e4e7] align-top">
                      {st.name}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-[#e4e4e7]/65 align-top break-words">
                      {st.detail}
                    </td>
                  </tr>
                ))}
                {/* Step 10 explicit non-execution row in Playground */}
                <tr className="bg-[#121216]">
                  <td className="py-2.5 px-4 whitespace-nowrap align-top">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-[#fbbf24]">
                      <MinusCircle className="w-3.5 h-3.5 shrink-0" />
                      DISABLED
                    </span>
                  </td>
                  <td className="py-2.5 px-4 font-medium text-[#e4e4e7] align-top">
                    Step 10: Worker Query Execution
                  </td>
                  <td className="py-2.5 px-4 font-mono text-[11px] text-[#e4e4e7]/65 align-top">
                    Never executed in Validator Playground (validation-only mode runs Steps 1–9 only).
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
