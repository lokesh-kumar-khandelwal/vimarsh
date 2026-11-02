import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getScrollBehavior, scrollToTarget } from '../utils/autoScroll';

/**
 * Unit tests for production auto-scroll utilities in `src/utils/autoScroll.ts`.
 * Imports real production functions directly rather than duplicating logic.
 */
describe('Auto-scroll behavior on question submission', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it('uses smooth scroll behavior when prefers-reduced-motion is not enabled', () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal('window', { matchMedia: matchMediaMock });

    expect(getScrollBehavior()).toBe('smooth');
    expect(matchMediaMock).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('falls back to auto scroll behavior when prefers-reduced-motion is enabled', () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('window', { matchMedia: matchMediaMock });

    expect(getScrollBehavior()).toBe('auto');
  });

  it('defaults to smooth when window.matchMedia is not a function', () => {
    vi.stubGlobal('window', {});

    expect(getScrollBehavior()).toBe('smooth');
  });

  it('invokes scrollIntoView on the target element with computed behavior and block position', () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal('window', { matchMedia: matchMediaMock });

    const scrollIntoViewMock = vi.fn();
    const fakeElement = {
      scrollIntoView: scrollIntoViewMock,
    } as unknown as HTMLElement;

    scrollToTarget(fakeElement, 'start');

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });

  it('safely handles null target elements without throwing', () => {
    expect(() => scrollToTarget(null, 'start')).not.toThrow();
  });

  it('falls back to no-arg scrollIntoView if options-based scrollIntoView throws', () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal('window', { matchMedia: matchMediaMock });

    const scrollIntoViewMock = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Options not supported in legacy browser');
      })
      .mockImplementationOnce(() => undefined);

    const fakeElement = {
      scrollIntoView: scrollIntoViewMock,
    } as unknown as HTMLElement;

    scrollToTarget(fakeElement, 'start');
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    expect(scrollIntoViewMock).toHaveBeenNthCalledWith(2);
  });
});
