// ============================================================================
// API Error Fallback — Reusable error state component for failed API calls
// Shows a friendly error message with retry button instead of blank screen
// v3: Three-state error differentiation:
//   1. backend_offline    — backend process not running (connection refused)
//   2. upstream_unreachable — backend running but upstream API unreachable
//   3. insufficient_data  — backend running but not enough data yet
//   Plus: network offline, rate-limited, generic server error
// ============================================================================
"use client";

import { AlertTriangle, RefreshCw, WifiOff, ShieldAlert, Server, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/** Error type discriminant matching FlipperApiError.errorType */
export type ApiErrorKind =
  | "backend_offline"
  | "backend_checking"
  | "backend_timeout"
  | "backend_connection_reset"
  | "backend_insufficient_data"
  | "insufficient_data"
  | "upstream_unreachable"
  | "upstream_error"
  | "server_error"
  | "network_offline"
  | "rate_limited"
  | "unknown";

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
  /** Explicit error kind — overrides auto-detection from error message */
  errorKind?: ApiErrorKind;
}

/**
 * Classify an error into a specific ApiErrorKind for differentiated UI.
 */
export function classifyApiError(error: Error | string | null | undefined): ApiErrorKind {
  if (!error) return "unknown";
  const msg = error instanceof Error ? error.message : error;
  const lower = msg.toLowerCase();

  // FlipperApiError carries structured error_type info
  if (msg.includes("backend_offline") || msg.includes("ECONNREFUSED")) return "backend_offline";
  if (msg.includes("backend_timeout") || msg.includes("ETIMEDOUT")) return "backend_timeout";
  if (msg.includes("backend_connection_reset") || msg.includes("ECONNRESET")) return "backend_connection_reset";
  if (msg.includes("backend_insufficient_data")) return "backend_insufficient_data";
  if (msg.includes("insufficient_data")) return "insufficient_data";
  if (msg.includes("upstream_unreachable") || msg.includes("upstream_error")) return "upstream_unreachable";

  // Fallback: status-based
  if (msg.includes("429")) return "rate_limited";
  if (msg.includes("502")) return "upstream_unreachable";
  if (msg.includes("503")) return "backend_offline";
  if (msg.includes("422")) return "insufficient_data";
  if (msg.includes("500") || msg.includes("5xx")) return "server_error";

  // Network-level
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("net::err")) return "network_offline";

  return "unknown";
}

export function ApiErrorFallback({
  error,
  onRetry,
  isRetrying,
  title,
  compact,
  errorKind: explicitKind,
}: ApiErrorFallbackProps) {
  const { t } = useI18n();
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : t("failedToLoadData");

  const kind = explicitKind ?? classifyApiError(error);

  // Icon and color per error kind
  const iconMap: Record<ApiErrorKind, { Icon: typeof WifiOff; color: string }> = {
    backend_offline: { Icon: Server, color: "text-red-500" },
    backend_checking: { Icon: Server, color: "text-blue-500" },
    backend_timeout: { Icon: Server, color: "text-amber-500" },
    backend_connection_reset: { Icon: Server, color: "text-amber-500" },
    backend_insufficient_data: { Icon: Database, color: "text-amber-500" },
    insufficient_data: { Icon: Database, color: "text-amber-500" },
    upstream_unreachable: { Icon: ShieldAlert, color: "text-amber-500" },
    upstream_error: { Icon: ShieldAlert, color: "text-amber-500" },
    server_error: { Icon: AlertTriangle, color: "text-red-500" },
    network_offline: { Icon: WifiOff, color: "text-amber-500" },
    rate_limited: { Icon: AlertTriangle, color: "text-amber-500" },
    unknown: { Icon: AlertTriangle, color: "text-amber-500" },
  };

  const { Icon, color: iconColor } = iconMap[kind] ?? iconMap.unknown;

  // Title and description per error kind
  const titleMap: Record<ApiErrorKind, string> = {
    backend_offline: t("flipperBackendOfflineTitle"),
    backend_checking: t("flipperBackendCheckingTitle"),
    backend_timeout: t("flipperBackendOfflineTitle"),
    backend_connection_reset: t("flipperBackendOfflineTitle"),
    backend_insufficient_data: t("flipperBackendInsufficientDataTitle"),
    insufficient_data: t("flipperBackendInsufficientDataTitle"),
    upstream_unreachable: t("flipperBackendDegradedTitle"),
    upstream_error: t("flipperBackendDegradedTitle"),
    server_error: t("failedToLoadData"),
    network_offline: t("connectionLost"),
    rate_limited: t("tooManyRequests"),
    unknown: t("failedToLoadData"),
  };

  const descMap: Record<ApiErrorKind, string> = {
    backend_offline: t("flipperBackendOfflineDesc"),
    backend_checking: t("flipperBackendCheckingDesc"),
    backend_timeout: t("flipperBackendOfflineDesc"),
    backend_connection_reset: t("flipperBackendOfflineDesc"),
    backend_insufficient_data: t("flipperBackendInsufficientDataDesc"),
    insufficient_data: t("flipperBackendInsufficientDataDesc"),
    upstream_unreachable: t("flipperBackendDegradedDesc"),
    upstream_error: t("flipperBackendDegradedDesc"),
    server_error: t("failedToLoadDataDesc"),
    network_offline: t("connectionLostDesc"),
    rate_limited: t("tooManyRequestsDesc"),
    unknown: t("failedToLoadDataDesc"),
  };

  const displayTitle = title ?? titleMap[kind];
  const displayDesc = descMap[kind];

  if (compact) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2"
        role="alert"
      >
        <Icon className={`h-4 w-4 ${iconColor} shrink-0`} />
        <span className="text-xs text-muted-foreground flex-1">
          {displayTitle}
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
            {t("retry")}
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
      <Icon className={`h-12 w-12 ${iconColor} mb-4`} />
      <h3 className="text-lg font-semibold mb-2">
        {displayTitle}
      </h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        {displayDesc}
      </p>
      {/* Actionable hints per error kind */}
      {kind === "backend_offline" && (
        <code className="text-xs mb-4 block bg-muted px-2 py-1 rounded">
          uvicorn backend.main:app --reload --port 8000
        </code>
      )}
      {kind === "upstream_unreachable" && (
        <div className="text-xs text-muted-foreground mb-4 max-w-md space-y-1">
          <p><b>{t("upstreamBlockedTitle")}</b></p>
          <p>{t("upstreamBlockedStep1")}</p>
          <p>{t("upstreamBlockedStep2")}</p>
          <code className="block bg-muted px-2 py-1 rounded text-xs">
            POE2_API_BASE_URL=https://your-proxy.example.com/api
          </code>
          <p>{t("upstreamBlockedStep3")}</p>
          <p>{t("upstreamBlockedStep4")}</p>
        </div>
      )}
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
          {isRetrying ? t("retrying") : t("tryAgain")}
        </Button>
      )}
      {/* Show error details */}
      {errorMessage && (
        <details className="mt-4 text-left max-w-md w-full">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            {t("technicalDetails")}
          </summary>
          <pre className="mt-2 text-xs bg-muted/50 rounded-lg p-3 overflow-auto max-h-[100px] text-red-400">
            {errorMessage}
          </pre>
        </details>
      )}
    </div>
  );
}
