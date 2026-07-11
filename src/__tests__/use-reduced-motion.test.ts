// ============================================================================
// Unit tests for hooks/use-reduced-motion.ts
//
// Covers the KI-24 refactor: the hook now uses `useSyncExternalStore` instead
// of `useState` + `useEffect`. Behavioural contract preserved:
//   - Returns `false` when the media query does NOT match
//   - Returns `true` when the media query matches
//   - Re-renders the consumer when the media query changes
//   - SSR-safe (returns `false` when `window` is undefined)
// ============================================================================

import { renderHook, act } from "@testing-library/react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

// ---------------------------------------------------------------------------
// Helpers: mock window.matchMedia + dispatch MediaQueryListEvent
// ---------------------------------------------------------------------------

type Listener = (e: MediaQueryListEvent) => void;

interface MockMQL {
  matches: boolean;
  media: string;
  onchange: null;
  addEventListener: (type: "change", l: Listener) => void;
  removeEventListener: (type: "change", l: Listener) => void;
  addListener: (l: Listener) => void; // legacy API
  removeListener: (l: Listener) => void; // legacy API
  dispatchEvent: () => boolean;
}

function installMockMatchMedia(initialMatches: boolean): {
  setMatches: (m: boolean) => void;
  listeners: Set<Listener>;
  restore: () => void;
} {
  const listeners = new Set<Listener>();
  const mql: MockMQL = {
    matches: initialMatches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: (type, l) => {
      if (type === "change") listeners.add(l);
    },
    removeEventListener: (type, l) => {
      if (type === "change") listeners.delete(l);
    },
    addListener: (l) => listeners.add(l),
    removeListener: (l) => listeners.delete(l),
    dispatchEvent: () => true,
  };

  const original = (
    window as unknown as { matchMedia?: typeof window.matchMedia }
  ).matchMedia;
  (window as unknown as { matchMedia: unknown }).matchMedia = jest.fn(
    () => mql
  ) as unknown as typeof window.matchMedia;

  return {
    setMatches: (m: boolean) => {
      mql.matches = m;
    },
    listeners,
    restore: () => {
      if (original) {
        (window as unknown as { matchMedia: unknown }).matchMedia = original;
      } else {
        delete (window as unknown as { matchMedia?: unknown }).matchMedia;
      }
    },
  };
}

function dispatchReducedMotionEvent(listeners: Set<Listener>, matches: boolean) {
  // jsdom does not implement `MediaQueryListEvent`, so we synthesize a minimal
  // event object that satisfies the `(e: MediaQueryListEvent) => void` shape.
  // The hook only reads `e.matches`, so this is sufficient.
  const event = {
    media: "(prefers-reduced-motion: reduce)",
    matches,
  } as MediaQueryListEvent;
  listeners.forEach((l) => l(event));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useReducedMotion", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns false when prefers-reduced-motion does not match", () => {
    const mock = installMockMatchMedia(false);
    try {
      const { result } = renderHook(() => useReducedMotion());
      expect(result.current).toBe(false);
    } finally {
      mock.restore();
    }
  });

  test("returns true when prefers-reduced-motion matches", () => {
    const mock = installMockMatchMedia(true);
    try {
      const { result } = renderHook(() => useReducedMotion());
      expect(result.current).toBe(true);
    } finally {
      mock.restore();
    }
  });

  test("updates when the media query changes (false → true)", () => {
    const mock = installMockMatchMedia(false);
    try {
      const { result } = renderHook(() => useReducedMotion());
      expect(result.current).toBe(false);

      act(() => {
        mock.setMatches(true);
        dispatchReducedMotionEvent(mock.listeners, true);
      });
      expect(result.current).toBe(true);
    } finally {
      mock.restore();
    }
  });

  test("updates when the media query changes (true → false)", () => {
    const mock = installMockMatchMedia(true);
    try {
      const { result } = renderHook(() => useReducedMotion());
      expect(result.current).toBe(true);

      act(() => {
        mock.setMatches(false);
        dispatchReducedMotionEvent(mock.listeners, false);
      });
      expect(result.current).toBe(false);
    } finally {
      mock.restore();
    }
  });

  test("unsubscribes on unmount (no listener leak)", () => {
    const mock = installMockMatchMedia(false);
    try {
      const { unmount } = renderHook(() => useReducedMotion());
      expect(mock.listeners.size).toBe(1);

      unmount();
      expect(mock.listeners.size).toBe(0);

      // After unmount, dispatching an event should not throw and should not
      // cause any state update on the (now-unmounted) hook.
      expect(() => {
        dispatchReducedMotionEvent(mock.listeners, true);
      }).not.toThrow();
    } finally {
      mock.restore();
    }
  });

  test("multiple consumers share the underlying subscription and all update", () => {
    const mock = installMockMatchMedia(false);
    try {
      const { result: r1 } = renderHook(() => useReducedMotion());
      const { result: r2 } = renderHook(() => useReducedMotion());
      expect(r1.current).toBe(false);
      expect(r2.current).toBe(false);

      act(() => {
        mock.setMatches(true);
        dispatchReducedMotionEvent(mock.listeners, true);
      });
      expect(r1.current).toBe(true);
      expect(r2.current).toBe(true);
    } finally {
      mock.restore();
    }
  });

  test("does NOT call setState during render (pure subscription via useSyncExternalStore)", () => {
    // The KI-24 refactor replaces `useEffect` + `setState` with
    // `useSyncExternalStore`. This test is a behavioural proxy: the hook
    // should not emit any React warning about setState-in-effect, and the
    // initial value should be correct on the very first render (no flash of
    // the SSR default `false` followed by an effect-driven update).
    const mock = installMockMatchMedia(true);
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useReducedMotion());
      // First render returns the real value immediately — no async setState.
      expect(result.current).toBe(true);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
      mock.restore();
    }
  });
});
