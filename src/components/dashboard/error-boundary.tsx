// ============================================================================
// Error Boundary — Catches render errors in child components and shows
// a fallback UI instead of crashing the entire dashboard.
// ============================================================================
"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { I18nContext } from "@/lib/i18n";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional label shown in the error UI to identify which section failed */
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console for debugging — could integrate Sentry/etc.
    console.error(
      `[ErrorBoundary${this.props.fallbackTitle ? ` (${this.props.fallbackTitle})` : ""}]`,
      error,
      errorInfo
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const i18n = this.context;
      const t = i18n?.t ?? ((key: string) => key);
      const title = this.props.fallbackTitle || "Component";
      return (
        <div
          className="flex flex-col items-center justify-center py-12 px-4 text-center"
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle className="h-10 w-10 text-amber-500 mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {t("encounteredError", { "0": title })}
          </h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            {t("errorBoundaryDesc")}
          </p>
          {this.state.error && (
            <details className="mb-4 text-left max-w-md w-full">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                {t("errorDetails")}
              </summary>
              <pre className="mt-2 text-xs bg-muted/50 rounded-lg p-3 overflow-auto max-h-[150px] text-red-400">
                {this.state.error.message}
              </pre>
            </details>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={this.handleRetry}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("retry")}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Convenience wrapper: wraps multiple sections with individual error boundaries.
 * Usage:
 * ```tsx
 * <ErrorBoundaryGroup>
 *   <ErrorBoundary fallbackTitle="Market Overview">
 *     <MarketOverview ... />
 *   </ErrorBoundary>
 *   <ErrorBoundary fallbackTitle="Currencies">
 *     <CurrenciesTab ... />
 *   </ErrorBoundary>
 * </ErrorBoundaryGroup>
 * ```
 */
export function ErrorBoundaryGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
