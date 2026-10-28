import React, { useState } from 'react';
import { Calendar, Code2, Eye, Layers } from 'lucide-react';
import { getDateHelpers, parseLocalYMD } from '../engine/dateHelpers';
import { PROMPT_VERSION, SYSTEM_PROMPT_TEMPLATE } from '../engine/systemPrompt';
import type { SchemaContext, SeedReport } from '../types';

interface ContextInspectorProps {
  schemaContext: SchemaContext | null;
  seedReport: SeedReport | null;
}

const DEFAULT_INSPECTOR_DATE = '2026-03-15';

export const ContextInspector: React.FC<ContextInspectorProps> = ({
  schemaContext,
  seedReport,
}) => {
  const [selectedDateStr, setSelectedDateStr] = useState<string>(
    seedReport?.generatedForDate ?? DEFAULT_INSPECTOR_DATE
  );

  const parsed = (() => {
    try {
      const { year, monthIndex, day } = parseLocalYMD(selectedDateStr);
      return new Date(year, monthIndex, day, 12, 0, 0, 0);
    } catch {
      return new Date(2026, 2, 15, 12, 0, 0, 0);
    }
  })();

  const dateHelpers = getDateHelpers(parsed);

  return (
    <div className="space-y-6">
      {/* Deterministic Date Helper Inspector */}
      <section
        aria-label="Deterministic Date Helper Inspector"
        className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Deterministic Date Helpers (/engine/dateHelpers.ts)
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="anchor-date-input"
              className="text-xs text-slate-400 font-medium"
            >
              Reference Date (Local YYYY-MM-DD):
            </label>
            <input
              id="anchor-date-input"
              type="date"
              value={selectedDateStr}
              onChange={(e) =>
                setSelectedDateStr(e.target.value || DEFAULT_INSPECTOR_DATE)
              }
              className="px-2.5 py-1 text-xs font-mono rounded-md bg-slate-950 border border-slate-700 text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-400"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(dateHelpers).map(([key, value]) => (
            <div
              key={key}
              className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-between gap-2"
            >
              <span className="font-mono text-xs text-slate-400">{key}</span>
              <span className="font-mono text-xs font-semibold text-slate-100 tabular-nums">
                {value}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Seeded Dataset Summary */}
      {seedReport && (
        <section
          aria-label="Seeded Dataset Invariants"
          className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                Seeded Dataset Summary (/engine/seedDatabase.ts)
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              WASM Source: {seedReport.wasmSource}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60">
              <div className="text-slate-400">Generated For Date</div>
              <div className="mt-1 font-mono text-slate-100 tabular-nums">
                {seedReport.generatedForDate}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60">
              <div className="text-slate-400">Earliest Order Date</div>
              <div className="mt-1 font-mono text-slate-100 tabular-nums">
                {seedReport.earliestOrderDate}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60">
              <div className="text-slate-400">Total Seed Checks</div>
              <div className="mt-1 font-mono text-emerald-400 tabular-nums">
                {seedReport.checks.filter((c) => c.passed).length}/
                {seedReport.checks.length} Passed
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60">
              <div className="text-slate-400">Setup Sequence</div>
              <div className="mt-1 font-mono text-slate-100 text-[11px] truncate">
                {seedReport.setupSequence.join(' → ')}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Schema Context & System Prompt Template Preview */}
      <section
        aria-label="Schema Context and System Prompt Inspector"
        className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Schema Context &amp; System Prompt Template ({PROMPT_VERSION})
            </h2>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
            <Eye className="w-3.5 h-3.5" />
            <span>
              PRAGMA query_only={' '}
              {schemaContext?.pragmaQueryOnly ? '1' : '0'} · foreign_keys={' '}
              {schemaContext?.pragmaForeignKeys ? '1' : '0'}
            </span>
          </span>
        </div>

        <pre className="p-4 rounded-lg border border-slate-800 bg-slate-950 text-xs font-mono text-slate-300 overflow-x-auto max-h-80 leading-relaxed">
          {SYSTEM_PROMPT_TEMPLATE}
        </pre>
      </section>
    </div>
  );
};
