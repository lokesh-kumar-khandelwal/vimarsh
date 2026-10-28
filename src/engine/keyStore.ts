/**
 * BYOK Key Store (/src/engine/keyStore.ts)
 *
 * Spec requirements:
 * - /engine/keyStore.ts is the ONLY reader of the visitor's API key.
 * - Never embed or read any environment/platform key.
 * - Store the key only in memory and optionally sessionStorage (try/catch with in-memory fallback);
 *   never localStorage, cookies, URLs, logs, errors, trace, audit log, or CSV.
 * - Expose connection states: Connected (last 4 characters only), Invalid key (401/403),
 *   Quota exceeded (429), Model unavailable (names GEMINI_MODEL in /config.ts),
 *   Configuration rejected (names buildGenerationConfig in /config.ts), Network error.
 */

import type { ByokConnectionState, ByokStatus } from '../types';

const SESSION_STORAGE_KEY = 'vimarsh_byok_session_api_key';

let inMemoryKey: string | null = null;

function readFromSessionStorageSafe(): string | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const val = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      return val && val.trim().length > 0 ? val.trim() : null;
    }
  } catch {
    // sessionStorage unavailable (e.g., sandboxed iframe or Node/Vitest) -> fallback to in-memory
  }
  return null;
}

function writeToSessionStorageSafe(key: string | null): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (key && key.trim().length > 0) {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, key.trim());
      } else {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage errors; inMemoryKey remains authoritative
  }
}

let connectionState: ByokConnectionState = {
  status: 'disconnected',
  last4: null,
  message: 'Connect your API key to start',
};

type KeyStoreListener = (state: ByokConnectionState) => void;
const listeners = new Set<KeyStoreListener>();

function notifyListeners(): void {
  const snapshot: ByokConnectionState = { ...connectionState };
  for (const listener of listeners) {
    listener(snapshot);
  }
}

/**
 * Only reader of the visitor's Gemini API key.
 */
export function getApiKey(): string | null {
  if (inMemoryKey && inMemoryKey.length > 0) {
    return inMemoryKey;
  }
  const stored = readFromSessionStorageSafe();
  if (stored) {
    inMemoryKey = stored;
    return stored;
  }
  return null;
}

/**
 * Extracts at most the last 4 characters of a key for safe display.
 */
export function extractLast4(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 4) {
    return trimmed;
  }
  return trimmed.slice(-4);
}

/**
 * Stores a verified visitor API key and transitions state to 'connected'.
 */
export function setConnectedApiKey(rawKey: string): ByokConnectionState {
  const trimmed = rawKey.trim();
  inMemoryKey = trimmed;
  writeToSessionStorageSafe(trimmed);
  const last4 = extractLast4(trimmed);
  connectionState = {
    status: 'connected',
    last4,
    message: `Connected (••••${last4})`,
  };
  notifyListeners();
  return { ...connectionState };
}

/**
 * Updates the connection status (e.g. 'connecting', 'invalid_key', 'quota_exceeded', etc.).
 * When an error status occurs, clears any unverified stored key.
 */
export function setConnectionStatus(
  status: ByokStatus,
  message: string,
  last4: string | null = null
): ByokConnectionState {
  if (status !== 'connected' && status !== 'connecting') {
    inMemoryKey = null;
    writeToSessionStorageSafe(null);
  }
  connectionState = {
    status,
    last4: status === 'connected' ? last4 : null,
    message,
  };
  notifyListeners();
  return { ...connectionState };
}

/**
 * Disconnects and immediately clears the visitor's API key from memory and sessionStorage.
 */
export function disconnectApiKey(): ByokConnectionState {
  inMemoryKey = null;
  writeToSessionStorageSafe(null);
  connectionState = {
    status: 'disconnected',
    last4: null,
    message: 'Connect your API key to start',
  };
  notifyListeners();
  return { ...connectionState };
}

export function getConnectionState(): ByokConnectionState {
  return { ...connectionState };
}

export function isApiKeyConnected(): boolean {
  return connectionState.status === 'connected' && getApiKey() !== null;
}

export function subscribeKeyStore(listener: KeyStoreListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
