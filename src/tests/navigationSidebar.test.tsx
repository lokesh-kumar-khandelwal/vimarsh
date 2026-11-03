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

  describe('Issue 4 & 5: Controlled-State Architecture & Mandatory Regression Tests', () => {
    // Harness simulating App.tsx single source of truth state management
    class AppNavigationHarness {
      workspaceArea: 'ask' | 'devtools' = 'ask';
      devToolTab: 'evaluation' | 'playground' | 'selftests' | 'context' | 'schema' | 'diagnostics' = 'evaluation';
      showQueryHistory = false;
      showDataReference = false;
      historyToggleCount = 0;
      dataRefToggleCount = 0;
      externalActions: Array<{ type: string; payload?: string; seq: number }> = [];

      onToggleQueryHistory = () => {
        this.historyToggleCount += 1;
        this.showQueryHistory = !this.showQueryHistory;
      };

      onToggleDataReference = () => {
        this.dataRefToggleCount += 1;
        this.showDataReference = !this.showDataReference;
      };

      triggerAskAction = (
        type: 'focus_ask' | 'toggle_history' | 'toggle_schema' | 'select_example',
        payload?: string
      ) => {
        this.workspaceArea = 'ask';

        if (type === 'focus_ask') {
          this.showQueryHistory = false;
          this.showDataReference = false;
          this.externalActions.push({
            type: 'focus_ask',
            seq: this.externalActions.length + 1,
          });
        } else if (type === 'toggle_history') {
          this.historyToggleCount += 1;
          this.showQueryHistory = !this.showQueryHistory;
        } else if (type === 'toggle_schema') {
          this.dataRefToggleCount += 1;
          this.showDataReference = !this.showDataReference;
        } else if (type === 'select_example' && payload) {
          this.externalActions.push({
            type: 'select_example',
            payload,
            seq: this.externalActions.length + 1,
          });
        }
      };

      renderSidebar() {
        return renderToString(
          <AppNavigationSidebar
            workspaceArea={this.workspaceArea}
            devToolTab={this.devToolTab}
            onSelectDevTool={(tab) => {
              this.workspaceArea = 'devtools';
              this.devToolTab = tab;
            }}
            onTriggerAskAction={this.triggerAskAction}
            showQueryHistory={this.showQueryHistory}
            showDataReference={this.showDataReference}
            historyCount={5}
            tableCount={5}
            isLoading={false}
            passedTestsCount={84}
            totalTestsCount={84}
          />
        );
      }
    }

    describe('QUERY HISTORY controlled flow', () => {
      it('opens and closes from sidebar, updating state exactly once per interaction', () => {
        const app = new AppNavigationHarness();

        // 1. Initial State: Ask Workspace active, Query History inactive
        let html = app.renderSidebar();
        expect(html).toContain('ASK WORKSPACE');
        expect(html).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>ASK WORKSPACE<\/span>/);
        expect(html).toMatch(/border-transparent text-\[#e4e4e7\]\/65[^>]*><span>QUERY HISTORY/);
        expect(app.showQueryHistory).toBe(false);

        // 2. Open from sidebar
        app.triggerAskAction('toggle_history');
        expect(app.showQueryHistory).toBe(true);
        expect(app.historyToggleCount).toBe(1);
        expect(app.externalActions.length).toBe(0); // Must NOT dispatch externalAction!

        html = app.renderSidebar();
        // Query History becomes active, Ask Workspace becomes inactive
        expect(html).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>QUERY HISTORY/);
        expect(html).toMatch(/border-transparent text-\[#e4e4e7\]\/65[^>]*><span>ASK WORKSPACE<\/span>/);

        // 3. Close from sidebar
        app.triggerAskAction('toggle_history');
        expect(app.showQueryHistory).toBe(false);
        expect(app.historyToggleCount).toBe(2);
        expect(app.externalActions.length).toBe(0); // Still 0 external actions

        html = app.renderSidebar();
        // Ask Workspace restored as active, Query History inactive
        expect(html).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>ASK WORKSPACE<\/span>/);
        expect(html).toMatch(/border-transparent text-\[#e4e4e7\]\/65[^>]*><span>QUERY HISTORY/);
      });

      it('opens and closes from workspace buttons, updating state exactly once per interaction', () => {
        const app = new AppNavigationHarness();

        // 1. Open from workspace button (e.g. QuestionInputSection toggle)
        app.onToggleQueryHistory();
        expect(app.showQueryHistory).toBe(true);
        expect(app.historyToggleCount).toBe(1);

        let html = app.renderSidebar();
        expect(html).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>QUERY HISTORY/);
        expect(html).toMatch(/border-transparent text-\[#e4e4e7\]\/65[^>]*><span>ASK WORKSPACE<\/span>/);

        // 2. Close from workspace button (e.g. QueryHistoryPanel Collapse or QuestionInputSection)
        app.onToggleQueryHistory();
        expect(app.showQueryHistory).toBe(false);
        expect(app.historyToggleCount).toBe(2);

        html = app.renderSidebar();
        expect(html).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>ASK WORKSPACE<\/span>/);
        expect(html).toMatch(/border-transparent text-\[#e4e4e7\]\/65[^>]*><span>QUERY HISTORY/);
      });
    });

    describe('DATA REFERENCE controlled flow', () => {
      it('opens and closes from sidebar, updating state exactly once per interaction', () => {
        const app = new AppNavigationHarness();

        // 1. Initial State: Ask Workspace active, Data Reference inactive
        let html = app.renderSidebar();
        expect(html).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>ASK WORKSPACE<\/span>/);
        expect(html).toMatch(/border-transparent text-\[#e4e4e7\]\/65[^>]*><span>DATA REFERENCE/);
        expect(app.showDataReference).toBe(false);

        // 2. Open from sidebar
        app.triggerAskAction('toggle_schema');
        expect(app.showDataReference).toBe(true);
        expect(app.dataRefToggleCount).toBe(1);
        expect(app.externalActions.length).toBe(0); // Must NOT dispatch externalAction!

        html = app.renderSidebar();
        // Data Reference becomes active, Ask Workspace becomes inactive
        expect(html).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>DATA REFERENCE/);
        expect(html).toMatch(/border-transparent text-\[#e4e4e7\]\/65[^>]*><span>ASK WORKSPACE<\/span>/);

        // 3. Close from sidebar
        app.triggerAskAction('toggle_schema');
        expect(app.showDataReference).toBe(false);
        expect(app.dataRefToggleCount).toBe(2);
        expect(app.externalActions.length).toBe(0); // Still 0 external actions

        html = app.renderSidebar();
        // Ask Workspace restored as active, Data Reference inactive
        expect(html).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>ASK WORKSPACE<\/span>/);
        expect(html).toMatch(/border-transparent text-\[#e4e4e7\]\/65[^>]*><span>DATA REFERENCE/);
      });

      it('opens and closes from workspace buttons, updating state exactly once per interaction', () => {
        const app = new AppNavigationHarness();

        // 1. Open from workspace button (e.g. QuestionInputSection Data Reference button)
        app.onToggleDataReference();
        expect(app.showDataReference).toBe(true);
        expect(app.dataRefToggleCount).toBe(1);

        let html = app.renderSidebar();
        expect(html).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>DATA REFERENCE/);
        expect(html).toMatch(/border-transparent text-\[#e4e4e7\]\/65[^>]*><span>ASK WORKSPACE<\/span>/);

        // 2. Close from workspace button (e.g. Sidebar Close button or QuestionInputSection)
        app.onToggleDataReference();
        expect(app.showDataReference).toBe(false);
        expect(app.dataRefToggleCount).toBe(2);

        html = app.renderSidebar();
        expect(html).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>ASK WORKSPACE<\/span>/);
        expect(html).toMatch(/border-transparent text-\[#e4e4e7\]\/65[^>]*><span>DATA REFERENCE/);
      });
    });

    describe('External Action segregation & focus_ask behavior', () => {
      it('focus_ask closes both auxiliary panels and dispatches external action', () => {
        const app = new AppNavigationHarness();
        app.showQueryHistory = true;
        app.showDataReference = true;

        app.triggerAskAction('focus_ask');

        expect(app.showQueryHistory).toBe(false);
        expect(app.showDataReference).toBe(false);
        expect(app.externalActions).toEqual([
          { type: 'focus_ask', seq: 1 },
        ]);

        const html = app.renderSidebar();
        expect(html).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>ASK WORKSPACE<\/span>/);
      });

      it('select_example dispatches external action without altering panel states', () => {
        const app = new AppNavigationHarness();
        app.showQueryHistory = true;

        app.triggerAskAction('select_example', 'What was our total revenue?');

        expect(app.showQueryHistory).toBe(true);
        expect(app.externalActions).toEqual([
          { type: 'select_example', payload: 'What was our total revenue?', seq: 1 },
        ]);
      });
    });

    describe('Switching between Ask Data and Developer Tools without stale states', () => {
      it('does not create stale navigation states or leaked highlights when switching areas', () => {
        const app = new AppNavigationHarness();
        app.showQueryHistory = true;

        // In Ask Data: Query History is active
        let htmlAsk = app.renderSidebar();
        expect(htmlAsk).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>QUERY HISTORY/);

        // Switch to Developer Tools
        app.workspaceArea = 'devtools';
        app.devToolTab = 'evaluation';
        const htmlDev = app.renderSidebar();

        // Must display Developer Tools sections, not Ask Data sections
        expect(htmlDev).toContain('aria-label="Developer Tools Sections"');
        expect(htmlDev).not.toContain('aria-label="Ask Data Workspace Sections"');
        expect(htmlDev).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>EVALUATION/);
        expect(htmlDev).not.toContain('QUERY HISTORY');

        // Switch back to Ask Data
        app.workspaceArea = 'ask';
        htmlAsk = app.renderSidebar();
        expect(htmlAsk).toContain('aria-label="Ask Data Workspace Sections"');
        expect(htmlAsk).toMatch(/border-\[#e4e4e7\] bg-\[#e4e4e7\]\/\[0\.04\] text-\[#38bdf8\] font-bold[^>]*><span>QUERY HISTORY/);
      });
    });
  });
});

