"use client";

import { useEffect, useCallback } from "react";

export interface KeyboardShortcutActions {
  onToggleView?: () => void;
  onFocusSearch?: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  onEnter?: () => void;
  onEscape?: () => void;
  onSwitchTab?: (tabIndex: number) => void;
  onShowHelp?: () => void;
}

function isInputElement(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = (el as HTMLElement).tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    !!(el as HTMLElement).isContentEditable
  );
}

export function useKeyboardShortcuts(actions: KeyboardShortcutActions) {
  // Stabilize the actions ref so the effect doesn't re-attach on every render.
  // We use a ref-like pattern: the callback reads from the latest `actions`
  // reference via a closure, but the event listener identity is stable.
  const handler = useCallback(
    (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in input fields
      if (isInputElement()) return;

      // Don't fire shortcuts with Ctrl/Alt/Meta modifiers
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      switch (e.key) {
        case "t":
        case "T":
          e.preventDefault();
          actions.onToggleView?.();
          break;
        case "f":
        case "F":
          e.preventDefault();
          actions.onFocusSearch?.();
          break;
        case "ArrowUp":
          e.preventDefault();
          actions.onNavigateUp?.();
          break;
        case "ArrowDown":
          e.preventDefault();
          actions.onNavigateDown?.();
          break;
        case "Enter":
          e.preventDefault();
          actions.onEnter?.();
          break;
        case "Escape":
          e.preventDefault();
          actions.onEscape?.();
          break;
        case "1":
          e.preventDefault();
          actions.onSwitchTab?.(0);
          break;
        case "2":
          e.preventDefault();
          actions.onSwitchTab?.(1);
          break;
        case "3":
          e.preventDefault();
          actions.onSwitchTab?.(2);
          break;
        case "4":
          e.preventDefault();
          actions.onSwitchTab?.(3);
          break;
        case "5":
          e.preventDefault();
          actions.onSwitchTab?.(4);
          break;
        case "?":
          // Shift+/ = ?
          e.preventDefault();
          actions.onShowHelp?.();
          break;
      }
    },
    [actions]
  );

  useEffect(() => {
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handler]);
}
