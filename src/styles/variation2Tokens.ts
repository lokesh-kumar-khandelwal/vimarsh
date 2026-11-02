/**
 * Centralized Variation 2 Dark Technical Design Tokens.
 *
 * Preserves the exact Variation 2 visual identity:
 * - Background: #0c0c0e (primary), #121216 (elevated surface)
 * - Ink: #e4e4e7 (zinc white)
 * - Accent: #38bdf8 (cyan)
 * - Semantic statuses: #4ade80 (success), #fbbf24 (warning), #f87171 (danger)
 * - Geometry: 0px sharp rectangular corners and 1px/2px technical borders
 */

export const VARIATION_2_COLORS = {
  bg: '#0c0c0e',
  bgElevated: '#121216',
  ink: '#e4e4e7',
  accent: '#38bdf8',
  success: '#4ade80',
  warning: '#fbbf24',
  danger: '#f87171',
} as const;

export const V2_CLASSES = {
  panel: 'rounded-none border border-[#e4e4e7]/15 bg-[#121216]',
  cardInset: 'rounded-none border border-[#e4e4e7]/20 bg-[#0c0c0e]',
  input:
    'rounded-none bg-[#0c0c0e] border border-[#e4e4e7]/30 text-[#e4e4e7] placeholder-[#e4e4e7]/40 focus:border-[#38bdf8] disabled:opacity-50 font-mono',
  buttonPrimary:
    'inline-flex items-center justify-center gap-2 text-xs font-mono font-bold uppercase tracking-wider rounded-none bg-[#e4e4e7] text-[#0c0c0e] hover:bg-[#38bdf8] disabled:opacity-40 transition-colors cursor-pointer',
  buttonSecondary:
    'inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider rounded-none border border-[#e4e4e7]/35 bg-[#0c0c0e] text-[#e4e4e7] hover:border-[#38bdf8] hover:text-[#38bdf8] disabled:opacity-50 transition-colors cursor-pointer',
  badgeSuccess:
    'inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-none bg-[#4ade80] text-[#0c0c0e]',
  badgeWarning:
    'inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-none bg-[#fbbf24] text-[#0c0c0e]',
  badgeDanger:
    'inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-none bg-[#f87171] text-[#0c0c0e]',
  tableHeaderRow:
    'border-b-2 border-[#e4e4e7] bg-[#121216] text-[#e4e4e7] font-mono text-[11px] uppercase tracking-wider',
} as const;
