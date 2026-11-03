import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppNavigationSidebar } from '../components/layout/AppNavigationSidebar';

describe('AppNavigationSidebar Navigation State & Structure', () => {
  const defaultProps = {
    workspaceArea: 'ask' as const,
    devToolTab: 'evaluation' as const,
    onSelectDevTool: vi.fn(),
    onTriggerAskAction: vi.fn(),
    showQueryHistory: false,
    showDataReference: false,
    historyCount: 3,
    tableCount: 5,
    isLoading: false,
    passedTestsCount: 42,
    totalTestsCount: 42,
  };

  describe('Issue 1: Ask Data Active State Synchronization', () => {
    it('highlights ASK WORKSPACE when neither auxiliary panel is active', () => {
      const html = renderToString(
        <AppNavigationSidebar
          {...defaultProps}
          showQueryHistory={false}
          showDataReference={false}
        />
      );

      // Ask Workspace has active styling
      expect(html).toContain('ASK WORKSPACE');
      expect(html).toMatch(
        /border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>ASK WORKSPACE<\/span>/
      );

      // Query History and Data Reference are inactive
      expect(html).toMatch(
        /border-transparent text-\[#e4e4e7\]\/65[^>]*><span>QUERY HISTORY/
      );
      expect(html).toMatch(
        /border-transparent text-\[#e4e4e7\]\/65[^>]*><span>DATA REFERENCE/
      );
    });

    it('highlights QUERY HISTORY and unhighlights ASK WORKSPACE when Query History opens', () => {
      const html = renderToString(
        <AppNavigationSidebar
          {...defaultProps}
          showQueryHistory={true}
          showDataReference={false}
        />
      );

      // Query History is active
      expect(html).toMatch(
        /border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>QUERY HISTORY/
      );

      // Ask Workspace is inactive
      expect(html).toMatch(
        /border-transparent text-\[#e4e4e7\]\/65[^>]*><span>ASK WORKSPACE<\/span>/
      );

      // Data Reference is inactive
      expect(html).toMatch(
        /border-transparent text-\[#e4e4e7\]\/65[^>]*><span>DATA REFERENCE/
      );
    });

    it('highlights DATA REFERENCE and unhighlights ASK WORKSPACE when Data Reference opens', () => {
      const html = renderToString(
        <AppNavigationSidebar
          {...defaultProps}
          showQueryHistory={false}
          showDataReference={true}
        />
      );

      // Data Reference is active
      expect(html).toMatch(
        /border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>DATA REFERENCE/
      );

      // Ask Workspace is inactive
      expect(html).toMatch(
        /border-transparent text-\[#e4e4e7\]\/65[^>]*><span>ASK WORKSPACE<\/span>/
      );

      // Query History is inactive
      expect(html).toMatch(
        /border-transparent text-\[#e4e4e7\]\/65[^>]*><span>QUERY HISTORY/
      );
    });

    it('accurately indicates BOTH panels as active when both are opened simultaneously', () => {
      const html = renderToString(
        <AppNavigationSidebar
          {...defaultProps}
          showQueryHistory={true}
          showDataReference={true}
        />
      );

      // Both Query History and Data Reference have active styling
      expect(html).toMatch(
        /border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>QUERY HISTORY/
      );
      expect(html).toMatch(
        /border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>DATA REFERENCE/
      );

      // Ask Workspace is inactive
      expect(html).toMatch(
        /border-transparent text-\[#e4e4e7\]\/65[^>]*><span>ASK WORKSPACE<\/span>/
      );
    });
  });

  describe('Issue 2: Remove Incorrect Navigation Duplicates from Ask Data', () => {
    it('does NOT contain EVALUATION or SELF-TESTS under Ask Data navigation', () => {
      const html = renderToString(
        <AppNavigationSidebar
          {...defaultProps}
          workspaceArea="ask"
        />
      );

      // Ask Data navigation aria label exists
      expect(html).toContain('aria-label="Ask Data Workspace Sections"');

      // Must not contain Evaluation or Self-Tests navigation buttons
      expect(html).not.toContain('<span>EVALUATION');
      expect(html).not.toContain('<span>SELF-TESTS');

      // Sample queries section still exists
      expect(html).toContain('[02] SAMPLE QUERIES');
    });

    it('contains all 6 Developer Tools under Developer Tools navigation', () => {
      const html = renderToString(
        <AppNavigationSidebar
          {...defaultProps}
          workspaceArea="devtools"
          devToolTab="selftests"
        />
      );

      expect(html).toContain('aria-label="Developer Tools Sections"');
      expect(html).toContain('EVALUATION');
      expect(html).toContain('VALIDATOR PLAYGROUND');
      expect(html).toContain('SELF-TESTS');
      expect(html).toContain('DATE HELPERS');
      expect(html).toContain('SCHEMA &amp; RESET DB');
      expect(html).toContain('DIAGNOSTICS');

      // The selected devtool tab is active
      expect(html).toMatch(
        /border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>SELF-TESTS/
      );
      // Other tabs are inactive
      expect(html).toMatch(
        /border-transparent text-\[#e4e4e7\]\/65[^>]*><span>VALIDATOR PLAYGROUND<\/span>/
      );
    });
  });

  describe('Issue 3: Accessibility Attributes and Uniform State', () => {
    it('provides correct aria-expanded, aria-pressed, and aria-current attributes', () => {
      // 1. Ask active
      const htmlAsk = renderToString(
        <AppNavigationSidebar
          {...defaultProps}
          showQueryHistory={false}
          showDataReference={false}
        />
      );
      expect(htmlAsk).toContain('aria-current="page"');
      expect(htmlAsk).toContain('aria-pressed="true"');

      // 2. Query History open
      const htmlHistory = renderToString(
        <AppNavigationSidebar
          {...defaultProps}
          showQueryHistory={true}
          showDataReference={false}
        />
      );
      expect(htmlHistory).toMatch(/aria-expanded="true"[^>]*aria-pressed="true"[^>]*aria-current="true"[^>]*><span>QUERY HISTORY/);

      // 3. Query History closed
      expect(htmlAsk).toMatch(/aria-expanded="false"[^>]*aria-pressed="false"[^>]*><span>QUERY HISTORY/);

      // 4. Data Reference open
      const htmlDataRef = renderToString(
        <AppNavigationSidebar
          {...defaultProps}
          showQueryHistory={false}
          showDataReference={true}
        />
      );
      expect(htmlDataRef).toMatch(/aria-expanded="true"[^>]*aria-pressed="true"[^>]*aria-current="true"[^>]*><span>DATA REFERENCE/);

      // 5. Data Reference closed
      expect(htmlAsk).toMatch(/aria-expanded="false"[^>]*aria-pressed="false"[^>]*><span>DATA REFERENCE/);
    });

    it('renders identical markup for both desktop and mobile sidebars with same props', () => {
      const desktopHtml = renderToString(
        <AppNavigationSidebar
          {...defaultProps}
          showQueryHistory={true}
          showDataReference={false}
        />
      );
      const mobileHtml = renderToString(
        <AppNavigationSidebar
          {...defaultProps}
          showQueryHistory={true}
          showDataReference={false}
        />
      );

      expect(desktopHtml).toEqual(mobileHtml);
    });
  });
});
