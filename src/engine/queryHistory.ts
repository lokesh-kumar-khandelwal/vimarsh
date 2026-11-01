/**
 * Query History Store (/src/engine/queryHistory.ts)
 *
 * Stores and manages recent SQL queries executed by the user in the 'Ask Data' workspace.
 * Features:
 * - Persists to browser localStorage with try/catch fallback to in-memory storage (sandbox/iframe safe).
 * - Tracks natural language question, SQL statement, execution latency, row count, tables used, and timestamp.
 * - Reactive subscription model so UI components update automatically upon execution.
 * - Caps at MAX_QUERY_HISTORY_ENTRIES (50) to prevent unbounded memory growth.
 * - Provides search/filter utilities and entry removal.
 */

import type { QueryHistoryEntry } from '../types';

export const QUERY_HISTORY_STORAGE_KEY = 'vimarsh_query_history_v1';
export const MAX_QUERY_HISTORY_ENTRIES = 50;

let inMemoryHistory: QueryHistoryEntry[] | null = null;
type QueryHistoryListener = (history: QueryHistoryEntry[]) => void;
const listeners = new Set<QueryHistoryListener>();

function notifyListeners(): void {
  const current = getQueryHistory();
  for (const listener of listeners) {
    try {
      listener(current);
    } catch (err) {
      console.error('Error in query history listener:', err);
    }
  }
}

function readFromStorage(): QueryHistoryEntry[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(QUERY_HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item): item is QueryHistoryEntry =>
              item &&
              typeof item.id === 'string' &&
              typeof item.sql === 'string' &&
              typeof item.question === 'string' &&
              typeof item.timestamp === 'string'
          );
        }
      }
    }
  } catch {
    // Sandboxed iframe or quota exceeded; fallback to in-memory
  }
  return [];
}

function writeToStorage(entries: QueryHistoryEntry[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        QUERY_HISTORY_STORAGE_KEY,
        JSON.stringify(entries)
      );
    }
  } catch {
    // Storage unavailable or quota exceeded; inMemoryHistory remains authoritative
  }
}

/**
 * Returns the current list of executed queries, most recent first.
 */
export function getQueryHistory(): QueryHistoryEntry[] {
  if (inMemoryHistory === null) {
    inMemoryHistory = readFromStorage();
  }
  return [...inMemoryHistory];
}

/**
 * Records an executed SQL query into history.
 * If the exact same query was executed immediately prior, updates its timestamp and stats instead of creating duplicate clutter.
 */
export function recordQueryExecution(
  data: Omit<QueryHistoryEntry, 'id' | 'timestamp'> & {
    id?: string;
    timestamp?: string;
  }
): QueryHistoryEntry {
  const current = getQueryHistory();
  const trimmedSql = (data.sql ?? '').trim();
  const trimmedQuestion = (data.question ?? '').trim();

  // Deduplicate consecutive identical runs: update the latest entry
  if (
    current.length > 0 &&
    current[0].sql.trim() === trimmedSql &&
    current[0].question.trim() === trimmedQuestion
  ) {
    const updated: QueryHistoryEntry = {
      ...current[0],
      rowCount: data.rowCount,
      executionTimeMs: data.executionTimeMs,
      tablesUsed: data.tablesUsed ?? current[0].tablesUsed,
      timestamp: data.timestamp ?? new Date().toISOString(),
    };
    current[0] = updated;
    inMemoryHistory = current;
    writeToStorage(current);
    notifyListeners();
    return updated;
  }

  const newEntry: QueryHistoryEntry = {
    id: data.id ?? `qh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    question: trimmedQuestion,
    sql: trimmedSql,
    timestamp: data.timestamp ?? new Date().toISOString(),
    rowCount: data.rowCount,
    executionTimeMs: data.executionTimeMs,
    tablesUsed: Array.isArray(data.tablesUsed) ? [...data.tablesUsed] : [],
    status: 'SUCCESS',
  };

  const updatedHistory = [newEntry, ...current].slice(0, MAX_QUERY_HISTORY_ENTRIES);
  inMemoryHistory = updatedHistory;
  writeToStorage(updatedHistory);
  notifyListeners();
  return newEntry;
}

/**
 * Clears all query history.
 */
export function clearQueryHistory(): void {
  inMemoryHistory = [];
  writeToStorage([]);
  notifyListeners();
}

/**
 * Deletes a single query history entry by id.
 */
export function removeQueryHistoryEntry(id: string): void {
  const current = getQueryHistory();
  const filtered = current.filter((item) => item.id !== id);
  inMemoryHistory = filtered;
  writeToStorage(filtered);
  notifyListeners();
}

/**
 * Subscribes to query history changes. Returns unsubscribe function.
 */
export function subscribeQueryHistory(
  listener: QueryHistoryListener
): () => void {
  listeners.add(listener);
  // Immediate emission of current state
  try {
    listener(getQueryHistory());
  } catch (err) {
    console.error('Error during initial query history subscribe:', err);
  }
  return () => {
    listeners.delete(listener);
  };
}
