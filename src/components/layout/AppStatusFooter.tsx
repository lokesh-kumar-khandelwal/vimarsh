import React from 'react';
import { GEMINI_MODEL, SQL_JS_VERSION } from '../../config';
import { GOLDEN_TEST_SUITE } from '../../engine/goldenTests';
import { PROMPT_VERSION } from '../../engine/systemPrompt';

interface AppStatusFooterProps {
  isLoading: boolean;
  passedTestsCount: number;
  totalTestsCount: number;
}

export const AppStatusFooter: React.FC<AppStatusFooterProps> = ({
  isLoading,
  passedTestsCount,
  totalTestsCount,
}) => {
  const allTestsPassed =
    totalTestsCount > 0 && passedTestsCount === totalTestsCount;

  return (
    <footer className="border-t border-[#e4e4e7]/15 px-4 sm:px-8 py-2 bg-[#0c0c0e] flex flex-wrap items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-widest text-[#e4e4e7]/60 z-20">
      <div className="flex flex-wrap items-center gap-3">
        <span>PROMPT: {PROMPT_VERSION.toUpperCase()}</span>
        <span aria-hidden="true" className="text-[#e4e4e7]/25">
          ·
        </span>
        <span>SQL.JS: {SQL_JS_VERSION}</span>
        <span aria-hidden="true" className="text-[#e4e4e7]/25">
          ·
        </span>
        <span>MODEL: {GEMINI_MODEL}</span>
      </div>

      <div className="flex flex-wrap items-center gap-4 tabular-nums">
        <span
          className={
            isLoading
              ? 'text-[#38bdf8]'
              : totalTestsCount === 0
                ? 'text-[#e4e4e7]/50'
                : allTestsPassed
                  ? 'text-[#4ade80]'
                  : 'text-[#f87171]'
          }
        >
          SELF-TESTS:{' '}
          {isLoading
            ? 'RUNNING...'
            : totalTestsCount === 0
              ? '0/0 UNRUN'
              : `${passedTestsCount}/${totalTestsCount} PASSING`}
        </span>
        <span aria-hidden="true" className="text-[#e4e4e7]/25">
          ·
        </span>
        <span className="text-[#e4e4e7]/75">
          GOLDEN SUITE: {GOLDEN_TEST_SUITE.length} CASES
        </span>
      </div>
    </footer>
  );
};
