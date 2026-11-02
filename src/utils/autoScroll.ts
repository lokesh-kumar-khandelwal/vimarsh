/**
 * Production Auto-Scroll Utilities for Vimarsh Clarification Workspace.
 *
 * Respects user accessibility preferences (`prefers-reduced-motion: reduce`),
 * safely handles SSR / test environments without `window.matchMedia`,
 * and falls back gracefully if options-based `scrollIntoView` throws.
 */

export function getScrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined') return 'auto';
  if (typeof window.matchMedia !== 'function') return 'smooth';
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

export function scrollToTarget(
  el: HTMLElement | null,
  block: ScrollLogicalPosition = 'start'
): void {
  if (!el || typeof el.scrollIntoView !== 'function') return;
  const behavior = getScrollBehavior();
  try {
    el.scrollIntoView({ behavior, block });
  } catch {
    el.scrollIntoView();
  }
}
