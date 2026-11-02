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
        className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="label-mono text-[#38bdf8] block">
              LOCAL CALENDAR TIME ANCHOR
            </span>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#38bdf8]" />
              <h2 className="font-syne font-extrabold text-xl uppercase tracking-tight text-[#e4e4e7]">
                DETERMINISTIC DATE HELPERS (/ENGINE/DATEHELPERS.TS)
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="anchor-date-input"
              className="text-xs font-mono text-[#e4e4e7]/70"
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
              className="px-2.5 py-1.5 text-xs font-mono rounded-none bg-[#0c0c0e] border border-[#e4e4e7]/30 text-[#38bdf8] focus:border-[#38bdf8]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(dateHelpers).map(([key, value]) => (
            <div
              key={key}
              className="p-3 rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] flex items-center justify-between gap-2"
            >
              <span className="font-mono text-xs text-[#e4e4e7]/65">{key}</span>
              <span className="font-mono text-xs font-bold text-[#38bdf8] tabular-nums">
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
          className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#38bdf8]" />
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#e4e4e7]">
                Seeded Dataset Summary (/engine/seedDatabase.ts)
              </h2>
            </div>
            <span className="font-mono text-xs text-[#38bdf8] tabular-nums">
              WASM Source: {seedReport.wasmSource}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#e4e4e7]/15 border border-[#e4e4e7]/15 bg-[#0c0c0e] text-xs">
            <div className="p-3.5">
              <div className="label-mono">Generated For Date</div>
              <div className="mt-1 font-mono font-bold text-[#e4e4e7] tabular-nums">
                {seedReport.generatedForDate}
              </div>
            </div>
            <div className="p-3.5">
              <div className="label-mono">Earliest Order Date</div>
              <div className="mt-1 font-mono font-bold text-[#e4e4e7] tabular-nums">
                {seedReport.earliestOrderDate}
              </div>
            </div>
            <div className="p-3.5">
              <div className="label-mono">Total Seed Checks</div>
              <div className="mt-1 font-mono text-[#4ade80] font-bold tabular-nums">
                {seedReport.checks.filter((c) => c.passed).length}/
                {seedReport.checks.length} Passed
              </div>
            </div>
            <div className="p-3.5">
              <div className="label-mono">Setup Sequence</div>
              <div className="mt-1 font-mono text-[#38bdf8] text-[11px] truncate">
                {seedReport.setupSequence.join(' → ')}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Schema Context & System Prompt Template Preview */}
      <section
        aria-label="Schema Context and System Prompt Inspector"
        className="rounded-none border border-[#e4e4e7]/15 bg-[#121216] p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-[#38bdf8]" />
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#e4e4e7]">
              Schema Context &amp; System Prompt Template ({PROMPT_VERSION})
            </h2>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-[#4ade80] font-mono font-bold">
            <Eye className="w-3.5 h-3.5" />
            <span>
              PRAGMA query_only={' '}
              {schemaContext?.pragmaQueryOnly ? '1' : '0'} · foreign_keys={' '}
              {schemaContext?.pragmaForeignKeys ? '1' : '0'}
            </span>
          </span>
        </div>

        <pre className="p-4 rounded-none border border-[#e4e4e7]/15 bg-[#0c0c0e] text-[#38bdf8] text-xs font-mono overflow-x-auto max-h-80 leading-relaxed">
          {SYSTEM_PROMPT_TEMPLATE}
        </pre>
      </section>
    </div>
  );
};
