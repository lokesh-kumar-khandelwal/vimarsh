import React, { useRef, useState } from 'react';
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
  XCircle,
} from 'lucide-react';
import { disconnectApiKey } from '../engine/keyStore';
import { CONNECT_PROBE_TIMEOUT_MS } from '../config';
import {
  cancelActiveConnectProbe,
  connectAndVerifyApiKey,
  defaultGeminiTransport,
  getLastProbeTelemetry,
  isConnectProbeInFlight,
} from '../engine/llmClient';
import type { ByokConnectionState } from '../types';

interface ByokPanelProps {
  connectionState: ByokConnectionState;
  onStateChange: (next: ByokConnectionState) => void;
  compact?: boolean;
  inputId?: string;
}

export const ByokPanel: React.FC<ByokPanelProps> = ({
  connectionState,
  onStateChange,
  compact = false,
  inputId = 'byok-api-key-input',
}) => {
  const [keyInput, setKeyInput] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isChangingKey, setIsChangingKey] = useState<boolean>(false);
  const [localHint, setLocalHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isConnecting = connectionState.status === 'connecting';
  const isConnected = connectionState.status === 'connected';
  const isServiceUnavailable =
    connectionState.status === 'service_unavailable' ||
    (connectionState.status !== 'connected' &&
      connectionState.status !== 'connecting' &&
      /\b503\b|temporarily unavailable/i.test(connectionState.message));
  const hasErrorStatus =
    connectionState.status !== 'disconnected' &&
    connectionState.status !== 'connecting' &&
    connectionState.status !== 'connected';

  const lastProbe = getLastProbeTelemetry();

  const runVerification = async () => {
    if (isConnecting || isConnectProbeInFlight()) return;

    if (keyInput.trim().length === 0) {
      setLocalHint('Paste your Gemini API key below, then click Connect API Key.');
      inputRef.current?.focus();
      return;
    }

    setLocalHint(null);
    const next = await connectAndVerifyApiKey(
      keyInput,
      defaultGeminiTransport,
      {
        onStatusUpdate: onStateChange,
      }
    );
    onStateChange(next);
    if (next.status === 'connected') {
      setKeyInput('');
      setIsChangingKey(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    await runVerification();
  };

  const handleCancelProbe = () => {
    cancelActiveConnectProbe();
  };

  const handleDisconnect = () => {
    cancelActiveConnectProbe();
    const next = disconnectApiKey();
    setKeyInput('');
    setLocalHint(null);
    setIsChangingKey(false);
    onStateChange(next);
  };

  if (isConnected && !isChangingKey) {
    return (
      <section
        aria-label="Gemini API Key Connection Status"
        className="rounded-none border border-[#4ade80]/50 bg-[#4ade80]/[0.05] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-[#4ade80]"
      >
        <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
          <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#4ade80]" />
            <span>Gemini API Connected</span>
          </span>
          <span className="text-[#e4e4e7]/30" aria-hidden="true">
            ·
          </span>
          <span className="text-[#e4e4e7] font-mono tabular-nums">
            KEY ••••{connectionState.last4}
          </span>
          {lastProbe && lastProbe.status === 'connected' && (
            <>
              <span className="text-[#e4e4e7]/30 hidden sm:inline" aria-hidden="true">
                ·
              </span>
              <span className="font-mono tabular-nums text-[#e4e4e7]/70 hidden sm:inline">
                Verified in {lastProbe.durationMs} ms
              </span>
            </>
          )}
          <span className="text-[#e4e4e7]/30 hidden md:inline" aria-hidden="true">
            ·
          </span>
          <span className="text-[#e4e4e7]/60 hidden md:inline">
            Tab session only
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsChangingKey(true);
              setLocalHint(null);
              setTimeout(() => inputRef.current?.focus(), 20);
            }}
            className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/40 bg-[#0c0c0e] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Change Key
          </button>
          <button
            type="button"
            onClick={handleDisconnect}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/30 bg-[#0c0c0e] text-[#e4e4e7]/75 hover:border-[#f87171] hover:text-[#f87171] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Disconnect Key</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Connect Gemini API Key"
      className={`rounded-none border ${
        isServiceUnavailable
          ? 'border-[#fbbf24] bg-[#fbbf24]/[0.05]'
          : hasErrorStatus
            ? 'border-[#f87171] bg-[#f87171]/[0.05]'
            : 'border-[#e4e4e7]/20 bg-[#121216]'
      } ${compact ? 'p-4' : 'p-5'} space-y-3.5`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#38bdf8] shrink-0" />
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#e4e4e7]">
              {isConnected
                ? 'Replace your Gemini API key'
                : 'Connect your Gemini API key to start asking questions'}
            </h2>
          </div>
          <p className="text-xs text-[#e4e4e7]/65 leading-relaxed">
            Paste a Gemini API key from Google AI Studio to enable natural-language
            SQL generation and ambiguity checks.
          </p>
        </div>

        {isConnected && isChangingKey && (
          <button
            type="button"
            onClick={() => {
              setIsChangingKey(false);
              setKeyInput('');
              setLocalHint(null);
            }}
            className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/30 bg-[#0c0c0e] text-[#e4e4e7]/75 hover:border-[#e4e4e7] hover:text-[#e4e4e7] transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Status or validation message when connecting or errored */}
      {(isConnecting || hasErrorStatus || localHint) && (
        <div
          role={hasErrorStatus ? 'alert' : 'status'}
          className="text-xs"
        >
          {isConnecting ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[#38bdf8] font-mono">
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0 text-[#38bdf8]" />
                <span>
                  {connectionState.message ||
                    `Verifying your API key with Gemini (${Math.round(CONNECT_PROBE_TIMEOUT_MS / 1000)}s timeout)...`}
                </span>
              </span>
              <button
                type="button"
                onClick={handleCancelProbe}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/30 bg-[#0c0c0e] text-[#e4e4e7] hover:border-[#f87171] hover:text-[#f87171] transition-colors cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
            </div>
          ) : isServiceUnavailable ? (
            <div className="rounded-none border border-[#fbbf24]/60 bg-[#fbbf24]/[0.06] p-3.5 space-y-2.5">
              <div className="flex items-start gap-2 text-[#fbbf24] font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-mono text-xs uppercase tracking-wider">
                    Gemini Service Temporarily Unavailable (HTTP 503)
                  </div>
                  <p className="text-xs font-normal text-[#e4e4e7]/80 leading-relaxed">
                    {connectionState.message}
                  </p>
                  <p className="text-[11px] font-normal text-[#e4e4e7]/60 leading-relaxed">
                    Your key remains in the input field below — you can retry
                    verification immediately without reloading the application.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={isConnecting || keyInput.trim().length === 0}
                  onClick={() => void runVerification()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider rounded-none bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Verification</span>
                </button>
              </div>
            </div>
          ) : hasErrorStatus ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[#f87171] font-mono">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{connectionState.message}</span>
              </span>
              {keyInput.trim().length > 0 && (
                <button
                  type="button"
                  disabled={isConnecting}
                  onClick={() => void runVerification()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#f87171] bg-[#f87171]/10 text-[#f87171] hover:bg-[#f87171] hover:text-[#0c0c0e] transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
              )}
            </div>
          ) : (
            <span className="text-[#fbbf24] font-mono">{localHint}</span>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => void handleConnect(e)}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
      >
        <div className="relative flex-1">
          <label htmlFor={inputId} className="sr-only">
            Gemini API Key
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type={showPassword ? 'text' : 'password'}
            value={keyInput}
            onChange={(e) => {
              setKeyInput(e.target.value);
              if (localHint) setLocalHint(null);
            }}
            placeholder="Paste your Gemini API key (e.g. AIza...)"
            autoComplete="off"
            spellCheck={false}
            disabled={isConnecting}
            className="w-full pl-3.5 pr-9 py-2.5 text-xs font-mono rounded-none bg-[#0c0c0e] border border-[#e4e4e7]/30 text-[#e4e4e7] placeholder-[#e4e4e7]/40 focus:border-[#38bdf8] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? 'Hide API key' : 'Show API key'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#e4e4e7]/60 hover:text-[#38bdf8] rounded-none p-0.5 cursor-pointer"
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>

        <button
          type="submit"
          disabled={isConnecting}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-mono font-bold uppercase tracking-wider rounded-none bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {isConnecting ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Connecting...</span>
            </>
          ) : isServiceUnavailable ? (
            <>
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Connection</span>
            </>
          ) : (
            <span>Connect API Key</span>
          )}
        </button>
      </form>

      {/* Privacy & Free Key Link */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#e4e4e7]/15 text-[11px] text-[#e4e4e7]/60">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-[#4ade80] shrink-0" />
          <span>
            Kept in this tab only (memory / sessionStorage). Never saved in
            localStorage or sent to any server other than Google&apos;s Gemini API.
          </span>
        </span>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[#38bdf8] font-mono font-bold uppercase tracking-wider underline whitespace-nowrap shrink-0 hover:text-[#e4e4e7]"
        >
          <span>Get a Gemini API key</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </section>
  );
};
