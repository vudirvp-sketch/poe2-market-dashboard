// ============================================================================
// useReducedMotion — Detect prefers-reduced-motion media query
// Used to disable Recharts animations and other motion effects
// for users with vestibular disorders (WCAG 2.1 criterion 2.3.3)
//
// KI-24 (fixed iter 116): rewritten with `useSyncExternalStore` to eliminate
// the `react-hooks/set-state-in-effect` warning. The previous implementation
// used `useState` + `useEffect` (set initial value via `setReduced(mq.matches)`
// inside the effect — a setState-in-effect pattern). `useSyncExternalStore` is
// the React-recommended primitive for subscribing to an external store (the
// media query) and is semantically equivalent:
//   - getServerSnapshot returns `false` (SSR-safe default; no `window`)
//   - getSnapshot reads `window.matchMedia(...).matches` synchronously
//   - subscribe attaches/detaches the `change` listener and returns cleanup
// ----------------------------------------------------------------------------
// "use client" is still required because the hook is only called from client
// components (`market-overview.tsx`, `pair-detail-dialog.tsx`, etc.). Next.js
// still needs the boundary even though `useSyncExternalStore` itself is
// SSR-safe.
// ============================================================================
"use client";

import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Subscribe to the `prefers-reduced-motion` media query.
 * Returns a cleanup function that removes the listener.
 *
 * Guarded for SSR (no `window`) — returns a no-op unsubscribe. On the client,
 * Next.js will re-hydrate and `useSyncExternalStore` will resync to the real
 * value via `getSnapshot`.
 */
function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

/**
 * Read the current reduced-motion preference synchronously.
 * Called during render on the client. MUST be fast (no allocations).
 */
function getSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * SSR snapshot — `prefers-reduced-motion` cannot be known on the server.
 * Default to `false` (animations enabled) so the server-rendered HTML matches
 * the most common client state, minimizing hydration mismatch warnings.
 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Returns `true` if the user has `prefers-reduced-motion: reduce` set at the
 * OS / browser level. Use to disable animations (e.g. Recharts `isAnimationActive={false}`).
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
