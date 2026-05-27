// ============================================================================
// useReducedMotion — Detect prefers-reduced-motion media query
// Used to disable Recharts animations and other motion effects
// for users with vestibular disorders (WCAG 2.1 criterion 2.3.3)
// ============================================================================
"use client";

import { useState, useEffect } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);

    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}
