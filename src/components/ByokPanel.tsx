import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { GEMINI_MODEL } from '../config';
import { disconnectApiKey } from '../engine/keyStore';
import { connectAndVerifyApiKey } from '../engine/llmClient';
import type { ByokConnectionState } from '../types';

interface ByokPanelProps {
  connectionState: ByokConnectionState;
  onStateChange: (next: ByokConnectionState) => void;
  compact?: boolean;
}

export const ByokPanel: React.FC<ByokPanelProps> = ({
  connectionState,
  onStateChange,
  compact = false,
}) => {
  const [keyInput, setKeyInput] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const isConnecting = connectionState.status === 'connecting';
  const isConnected = connectionState.status === 'connected';

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isConnecting) return;
    const next = await connectAndVerifyApiKey(keyInput);
    onStateChange(next);
    if (next.status === 'connected') {
      setKeyInput('');
    }
  };

  const handleDisconnect = () => {
    const next = disconnectApiKey();
    setKeyInput('');
    onStateChange(next);
  };

  return (
    <section
      aria-label="Bring Your Own Gemini API Key Panel"
      className={`rounded-xl border ${
        isConnected
          ? 'border-emerald-800/70 bg-slate-900/75'
          : connectionState.status !== 'disconnected' &&
              connectionState.status !== 'connecting'
            ? 'border-rose-800/80 bg-rose-950/20'
            : 'border-slate-800 bg-slate-900/75'
      } ${compact ? 'p-4' : 'p-5'} space-y-3`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-sky-400 shrink-0" />
          <h2 className="text-sm font-semibold text-slate-100">
            Bring Your Own Key (Gemini API)
          </h2>
          <span className="font-mono text-[11px] text-slate-400">
            Model: {GEMINI_MODEL}
          </span>
        </div>

        {/* Connection status indicator */}
        <div className="flex items-center gap-2 text-xs font-mono">
          {isConnected ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>Connected (••••{connectionState.last4})</span>
            </span>
          ) : isConnecting ? (
            <span className="inline-flex items-center gap-1.5 text-sky-400">
              <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>Verifying key &amp; config...</span>
            </span>
          ) : connectionState.status === 'disconnected' ? (
            <span className="text-slate-400">
              {connectionState.message}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-rose-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{connectionState.message}</span>
            </span>
          )}
        </div>
      </div>

      {!isConnected ? (
        <form
          onSubmit={(e) => void handleConnect(e)}
          className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
        >
          <div className="relative flex-1">
            <label htmlFor="byok-api-key-input" className="sr-only">
              Gemini API Key
            </label>
            <input
              id="byok-api-key-input"
              type={showPassword ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Paste your Gemini API key (AIza...)"
              autoComplete="off"
              spellCheck={false}
              disabled={isConnecting}
              className="w-full pl-3 pr-9 py-2 text-xs font-mono rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide API key' : 'Show API key'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-sky-400 rounded-xs"
            >
              {showPassword ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <button
            type="submit"
            disabled={isConnecting || keyInput.trim().length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            {isConnecting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Connecting...</span>
              </>
            ) : (
              <span>Connect</span>
            )}
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-slate-300">
            Verified structured JSON output via{' '}
            <code className="font-mono text-sky-300">
              buildGenerationConfig()
            </code>{' '}
            on model{' '}
            <code className="font-mono text-sky-300">{GEMINI_MODEL}</code>.
          </p>
          <button
            type="button"
            onClick={handleDisconnect}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Disconnect Key</span>
          </button>
        </div>
      )}

      {/* Privacy & Free Key Link */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>
            Your key stays in this browser tab and is sent only to Google&apos;s
            Gemini API.
          </span>
        </span>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 underline focus-visible:outline-2 focus-visible:outline-sky-400 rounded-xs"
        >
          <span>Get a free key at aistudio.google.com/apikey</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </section>
  );
};
