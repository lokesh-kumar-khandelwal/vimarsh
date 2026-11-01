import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearQueryHistory,
  getQueryHistory,
  MAX_QUERY_HISTORY_ENTRIES,
  QUERY_HISTORY_STORAGE_KEY,
  recordQueryExecution,
  removeQueryHistoryEntry,
  subscribeQueryHistory,
} from '../engine/queryHistory';

describe('Query History Store (/src/engine/queryHistory.ts)', () => {
  beforeEach(() => {
    clearQueryHistory();
    try {
      window.localStorage.removeItem(QUERY_HISTORY_STORAGE_KEY);
    } catch {
      // Ignored in headless/sandbox
    }
  });

  it('records an executed query with all metadata and retrieves it most recent first', () => {
    const entry1 = recordQueryExecution({
      question: 'What was our total revenue last month?',
      sql: "SELECT SUM(oi.unit_price * oi.quantity) AS total_revenue FROM orders o JOIN order_items oi ON o.order_id = oi.order_id WHERE o.order_date >= '2026-09-01' LIMIT 1000;",
      rowCount: 1,
      executionTimeMs: 1.4,
      tablesUsed: ['orders', 'order_items'],
      status: 'SUCCESS',
    });

    expect(entry1.id).toBeDefined();
    expect(entry1.status).toBe('SUCCESS');
    expect(entry1.rowCount).toBe(1);

    const history = getQueryHistory();
    expect(history.length).toBe(1);
    expect(history[0].question).toBe('What was our total revenue last month?');
    expect(history[0].tablesUsed).toEqual(['orders', 'order_items']);

    // Record a second query
    const entry2 = recordQueryExecution({
      question: 'How many customers do we have?',
      sql: 'SELECT COUNT(*) AS total_customers FROM customers LIMIT 1000;',
      rowCount: 1,
      executionTimeMs: 0.8,
      tablesUsed: ['customers'],
      status: 'SUCCESS',
    });

    const updatedHistory = getQueryHistory();
    expect(updatedHistory.length).toBe(2);
    // Most recent must be first
    expect(updatedHistory[0].id).toBe(entry2.id);
    expect(updatedHistory[1].id).toBe(entry1.id);
  });

  it('updates the existing entry on consecutive identical executions without duplicating', () => {
    const entryA = recordQueryExecution({
      question: 'List top 5 products',
      sql: 'SELECT * FROM products LIMIT 5;',
      rowCount: 5,
      executionTimeMs: 2.1,
      tablesUsed: ['products'],
      status: 'SUCCESS',
    });

    expect(getQueryHistory().length).toBe(1);

    // Consecutive exact same query re-run
    recordQueryExecution({
      question: 'List top 5 products',
      sql: 'SELECT * FROM products LIMIT 5;',
      rowCount: 5,
      executionTimeMs: 1.2,
      tablesUsed: ['products'],
      status: 'SUCCESS',
    });

    const history = getQueryHistory();
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(entryA.id);
    expect(history[0].executionTimeMs).toBe(1.2);
  });

  it('enforces MAX_QUERY_HISTORY_ENTRIES cap by discarding oldest entries', () => {
    for (let i = 0; i < MAX_QUERY_HISTORY_ENTRIES + 10; i++) {
      recordQueryExecution({
        question: `Question #${i}`,
        sql: `SELECT ${i} AS num LIMIT 1;`,
        rowCount: 1,
        executionTimeMs: 1,
        tablesUsed: [],
        status: 'SUCCESS',
      });
    }

    const history = getQueryHistory();
    expect(history.length).toBe(MAX_QUERY_HISTORY_ENTRIES);
    // The most recent query is Question #59
    expect(history[0].question).toBe(`Question #${MAX_QUERY_HISTORY_ENTRIES + 9}`);
  });

  it('removes a specific entry by id', () => {
    const e1 = recordQueryExecution({
      question: 'Q1',
      sql: 'SELECT 1;',
      rowCount: 1,
      executionTimeMs: 1,
      tablesUsed: [],
      status: 'SUCCESS',
    });
    const e2 = recordQueryExecution({
      question: 'Q2',
      sql: 'SELECT 2;',
      rowCount: 1,
      executionTimeMs: 1,
      tablesUsed: [],
      status: 'SUCCESS',
    });

    expect(getQueryHistory().length).toBe(2);
    removeQueryHistoryEntry(e1.id);

    const history = getQueryHistory();
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(e2.id);
  });

  it('clears all history entries with clearQueryHistory', () => {
    recordQueryExecution({
      question: 'Q1',
      sql: 'SELECT 1;',
      rowCount: 1,
      executionTimeMs: 1,
      tablesUsed: [],
      status: 'SUCCESS',
    });
    expect(getQueryHistory().length).toBe(1);

    clearQueryHistory();
    expect(getQueryHistory().length).toBe(0);
  });

  it('notifies subscribers reactively upon execution and clear', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeQueryHistory(listener);

    // Initial call
    expect(listener).toHaveBeenCalledWith([]);

    recordQueryExecution({
      question: 'Reactive Q',
      sql: 'SELECT 100;',
      rowCount: 1,
      executionTimeMs: 1,
      tablesUsed: [],
      status: 'SUCCESS',
    });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0][0].question).toBe('Reactive Q');

    unsubscribe();
    recordQueryExecution({
      question: 'Ignored after unsub',
      sql: 'SELECT 200;',
      rowCount: 1,
      executionTimeMs: 1,
      tablesUsed: [],
      status: 'SUCCESS',
    });

    // Should not receive further updates
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
