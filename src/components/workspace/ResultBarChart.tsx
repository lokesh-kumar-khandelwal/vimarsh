import React from 'react';
import { BarChart3 } from 'lucide-react';
import type { AutoChartModel } from './resultHelpers';

interface ResultBarChartProps {
  chart: AutoChartModel;
}

export const ResultBarChart: React.FC<ResultBarChartProps> = ({ chart }) => {
  return (
    <div
      aria-label={`Chart of ${chart.valueColumn} by ${chart.labelColumn}`}
      className="rounded-none border border-[#e4e4e7]/20 bg-[#0c0c0e] p-4 space-y-3"
    >
      <div className="flex items-center justify-between text-xs font-mono text-[#e4e4e7]">
        <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wider">
          <BarChart3 className="w-4 h-4 text-[#38bdf8]" />
          <span>
            {chart.valueColumn} by {chart.labelColumn}
          </span>
        </span>
        <span className="font-mono text-[#e4e4e7]/60 tabular-nums">
          {chart.items.length} items
        </span>
      </div>
      <div className="space-y-2">
        {chart.items.map((item, itemIdx) => {
          const widthPct = Math.max(
            2,
            Math.min(
              100,
              Math.round((Math.abs(item.value) / chart.maxValue) * 100)
            )
          );
          return (
            <div
              key={`${item.label}_${itemIdx}`}
              className="grid grid-cols-12 items-center gap-3 text-xs font-mono"
            >
              <div className="col-span-4 truncate text-[#e4e4e7]">
                {item.label}
              </div>
              <div className="col-span-6 bg-[#121216] border border-[#e4e4e7]/15 rounded-none h-3 overflow-hidden">
                <div
                  className="bg-[#38bdf8] h-full rounded-none transition-all duration-300"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <div className="col-span-2 text-right text-[#38bdf8] font-bold tabular-nums">
                {item.value.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
