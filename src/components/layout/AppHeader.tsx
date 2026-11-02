import React from 'react';
import { KeyRound, Menu, MessageSquareText, Wrench, X } from 'lucide-react';
import type { ByokConnectionState } from '../../types';

export type WorkspaceArea = 'ask' | 'devtools';
export type DevToolTab =
  | 'schema'
  | 'evaluation'
  | 'playground'
  | 'selftests'
  | 'context'
  | 'diagnostics';

interface AppHeaderProps {
  workspaceArea: WorkspaceArea;
  onSelectWorkspaceArea: (area: WorkspaceArea) => void;
  isMobileNavOpen: boolean;
  onToggleMobileNav: () => void;
  connectionState: ByokConnectionState;
  onTopBarKeyAction: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  workspaceArea,
  onSelectWorkspaceArea,
  isMobileNavOpen,
  onToggleMobileNav,
  connectionState,
  onTopBarKeyAction,
}) => {
  return (
    <header className="border-b-2 border-[#e4e4e7] px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4 bg-[#0c0c0e] z-30">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleMobileNav}
          aria-expanded={isMobileNavOpen}
          aria-label="Toggle navigation menu"
          className="md:hidden p-2 rounded-none border border-[#e4e4e7]/35 bg-[#121216] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] cursor-pointer"
        >
          {isMobileNavOpen ? (
            <X className="w-4 h-4" />
          ) : (
            <Menu className="w-4 h-4" />
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectWorkspaceArea('ask')}
          className="flex items-center gap-3 text-left rounded-none shrink-0 group cursor-pointer"
        >
          <div>
            <span className="label-mono block leading-none mb-1">
              SYSTEM v6.3
            </span>
            <span className="font-syne font-extrabold text-xl sm:text-2xl tracking-tight text-[#e4e4e7] group-hover:text-[#38bdf8] transition-colors">
              VIMARSH
            </span>
          </div>
        </button>
      </div>

      <div className="flex items-center gap-4 sm:gap-8">
        <nav
          aria-label="Main Navigation"
          className="flex items-center gap-4 sm:gap-6 font-mono text-xs uppercase tracking-wider"
        >
          <button
            type="button"
            onClick={() => onSelectWorkspaceArea('ask')}
            aria-current={workspaceArea === 'ask' ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 py-1 transition-colors whitespace-nowrap cursor-pointer ${
              workspaceArea === 'ask'
                ? 'text-[#38bdf8] font-bold border-b-2 border-[#38bdf8]'
                : 'text-[#e4e4e7]/65 hover:text-[#e4e4e7]'
            }`}
          >
            <MessageSquareText className="w-3.5 h-3.5 hidden sm:inline" />
            <span>Ask Data</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectWorkspaceArea('devtools')}
            aria-current={workspaceArea === 'devtools' ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 py-1 transition-colors whitespace-nowrap cursor-pointer ${
              workspaceArea === 'devtools'
                ? 'text-[#38bdf8] font-bold border-b-2 border-[#38bdf8]'
                : 'text-[#e4e4e7]/65 hover:text-[#e4e4e7]'
            }`}
          >
            <Wrench className="w-3.5 h-3.5 hidden sm:inline" />
            <span>Developer Tools</span>
          </button>
        </nav>

        <button
          type="button"
          onClick={onTopBarKeyAction}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider rounded-none transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            connectionState.status === 'connected'
              ? 'bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8]'
              : 'border border-[#e4e4e7] bg-[#121216] text-[#e4e4e7] hover:bg-[#e4e4e7] hover:text-[#0c0c0e]'
          }`}
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span>
            {connectionState.status === 'connected'
              ? `KEY ••••${connectionState.last4}`
              : 'Connect API Key'}
          </span>
        </button>
      </div>
    </header>
  );
};
