// ============================================================================
// API Error Fallback — Reusable error state component for failed API calls
// Shows a friendly error message with retry button instead of blank screen
// ============================================================================
"use client";

import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ApiErrorFallbackProps {
  /** Error message or object */
  error?: Error | string | null;
  /** Callback to retry the failed request */
  onRetry?: () => void;
  /** Is a retry currently in progress? */
  isRetrying?: boolean;
  /** Optional title override */
  title?: string;
  /** Compact mode (for inline errors) */
  compact?: boolean;
}

export function ApiErrorFallback({
  error,
  onRetry,
  isRetrying,
  title,
  compact,
}: ApiErrorFallbackProps) {
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : "An unexpected error occurred";

  // Detect network/offline errors
  const isOffline =
    errorMessage.toLowerCase().includes("failed to fetch") ||
    errorMessage.toLowerCase().includes("network") ||
    errorMessage.toLowerCase().includes("net::err");

  // Detect rate-limit
  const isRateLimited = errorMessage.includes("429");

  if (compact) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2"
        role="alert"
      >
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <span className="text-xs text-muted-foreground flex-1">
          {isOffline
            ? "Network error — check your connection"
            : isRateLimited
            ? "Rate limited — please wait a moment"
            : "Failed to load data"}
        </span>
        {onRetry && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1 px-2"
            onClick={onRetry}
            disabled={isRetrying}
          >
            <RefreshCw
              className={`h-3 w-3 ${isRetrying ? "animate-spin" : ""}`}
            />
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center py-16 px-4 text-center"
      role="alert"
    >
      {isOffline ? (
        <WifiOff className="h-12 w-12 text-amber-500 mb-4" />
      ) : (
        <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
      )}
      <h3 className="text-lg font-semibold mb-2">
        {title ||
          (isOffline
            ? "Connection lost"
            : isRateLimited
            ? "Too many requests"
            : "Failed to load data")}
      </h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        {isOffline
          ? "Unable to reach the server. Please check your internet connection and try again."
          : isRateLimited
          ? "The API is receiving too many requests. Please wait a moment before trying again."
          : "There was an error loading data from the server. This might be a temporary issue."}
      </p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={isRetrying}
          className="gap-1.5"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isRetrying ? "animate-spin" : ""}`}
          />
          {isRetrying ? "Retrying..." : "Try again"}
        </Button>
      )}
      {/* Show error details in development */}
      {errorMessage && (
        <details className="mt-4 text-left max-w-md w-full">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            Technical details
          </summary>
          <pre className="mt-2 text-xs bg-muted/50 rounded-lg p-3 overflow-auto max-h-[100px] text-red-400">
            {errorMessage}
          </pre>
        </details>
      )}
    </div>
  );
}
