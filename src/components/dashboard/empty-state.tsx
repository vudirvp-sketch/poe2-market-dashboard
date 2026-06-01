// ============================================================================
// Empty State — Reusable component for empty data states
// §1.5: Shows icon + message + actionable suggestion instead of blank screens
// ============================================================================
"use client";

import type { LucideIcon } from "lucide-react";
import { Inbox, SearchX, StarOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export type EmptyStateKind = "generic" | "noResults" | "noFavorites";

interface EmptyStateProps {
  /** Icon to display (overrides kind default) */
  icon?: LucideIcon;
  /** Primary message */
  message: string;
  /** Actionable suggestion / secondary text */
  suggestion?: string;
  /** Predefined kind for default icon */
  kind?: EmptyStateKind;
}

const KIND_ICONS: Record<EmptyStateKind, LucideIcon> = {
  generic: Inbox,
  noResults: SearchX,
  noFavorites: StarOff,
};

/**
 * Centered empty state with icon, message, and actionable suggestion.
 * Use wherever data is absent (empty arrays, no favorites, filtered out).
 */
export function EmptyState({ icon, message, suggestion, kind = "generic" }: EmptyStateProps) {
  const Icon = icon ?? KIND_ICONS[kind];

  return (
    <div
      className="flex flex-col items-center justify-center py-20 px-4 text-center"
      role="status"
    >
      <Icon className="h-12 w-12 mb-4 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-lg font-medium mb-1">{message}</p>
      {suggestion && (
        <p className="text-sm text-muted-foreground max-w-sm">{suggestion}</p>
      )}
    </div>
  );
}
