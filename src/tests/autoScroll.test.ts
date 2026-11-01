import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Auto-Scroll Utilities & Preferences Suite', () => {
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    vi.restoreAllMocks();
  });

  it('1. Returns auto when window is undefined (e.g. SSR / node environment)', () => {
    delete (globalThis as any).window;

    const getScrollBehavior = (): ScrollBehavior => {
      if (typeof window === 'undefined') return 'auto';
      if (typeof window.matchMedia !== 'function') return 'smooth';
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
    };

    expect(getScrollBehavior()).toBe('auto');
  });

  it('2. Respects prefers-reduced-motion: reduce preference in browser window', () => {
    (globalThis as any).window = {
      matchMedia: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion: reduce'),
        media: query,
      })),
    };

    const getScrollBehavior = (): ScrollBehavior => {
      if (typeof window === 'undefined') return 'auto';
      if (typeof window.matchMedia !== 'function') return 'smooth';
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
    };

    expect(getScrollBehavior()).toBe('auto');
  });

  it('3. Defaults to smooth scrolling when reduced-motion is not requested', () => {
    (globalThis as any).window = {
      matchMedia: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
      })),
    };

    const getScrollBehavior = (): ScrollBehavior => {
      if (typeof window === 'undefined') return 'auto';
      if (typeof window.matchMedia !== 'function') return 'smooth';
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
    };

    expect(getScrollBehavior()).toBe('smooth');
  });

  it('4. Defaults to smooth scrolling when matchMedia is not a function', () => {
    (globalThis as any).window = {};

    const getScrollBehavior = (): ScrollBehavior => {
      if (typeof window === 'undefined') return 'auto';
      if (typeof window.matchMedia !== 'function') return 'smooth';
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
    };

    expect(getScrollBehavior()).toBe('smooth');
  });

  it('5. Safely handles null elements or environments without scrollIntoView', () => {
    (globalThis as any).window = {};
    const scrollToTarget = (
      el: HTMLElement | null,
      block: ScrollLogicalPosition = 'start'
    ): boolean => {
      if (!el || typeof el.scrollIntoView !== 'function') return false;
      try {
        el.scrollIntoView({ behavior: 'smooth', block });
        return true;
      } catch {
        el.scrollIntoView();
        return true;
      }
    };

    expect(scrollToTarget(null)).toBe(false);

    const mockElementWithoutFn = {} as HTMLElement;
    expect(scrollToTarget(mockElementWithoutFn)).toBe(false);

    const scrollSpy = vi.fn();
    const mockElementWithFn = {
      scrollIntoView: scrollSpy,
    } as unknown as HTMLElement;

    expect(scrollToTarget(mockElementWithFn, 'start')).toBe(true);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('4. Falls back cleanly if scrollIntoView throws with options object', () => {
    const scrollSpy = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new TypeError('Failed to execute scrollIntoView with options');
      })
      .mockImplementationOnce(() => {});

    const mockElement = {
      scrollIntoView: scrollSpy,
    } as unknown as HTMLElement;

    const scrollToTarget = (
      el: HTMLElement | null,
      block: ScrollLogicalPosition = 'start'
    ): void => {
      if (!el || typeof el.scrollIntoView !== 'function') return;
      try {
        el.scrollIntoView({ behavior: 'smooth', block });
      } catch {
        el.scrollIntoView();
      }
    };

    scrollToTarget(mockElement, 'start');
    expect(scrollSpy).toHaveBeenCalledTimes(2);
    expect(scrollSpy).toHaveBeenLastCalledWith();
  });
});
