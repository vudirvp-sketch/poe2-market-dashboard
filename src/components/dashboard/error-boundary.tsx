// ============================================================================
// Error Boundary — Catches render errors in child components and shows
// a fallback UI instead of crashing the entire dashboard.
// ============================================================================
"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { I18nContext, useI18n } from "@/lib/i18n";

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
      const title = this.props.fallbackTitle || t("errorBoundaryComponent");
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
 * ErrorBoundaryGroup — Wraps each direct child in its own ErrorBoundary so
 * that a crash in one section does NOT bring down sibling sections.
 *
 * Fix 5.1: Previous implementation was a no-op Fragment (<>{children}</>)
 * which provided ZERO isolation — a render error in any child would still
 * propagate and crash the entire parent tree. Now each child is automatically
 * wrapped in an individual ErrorBoundary.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundaryGroup>
 *   <MarketOverview ... />
 *   <CurrenciesTab ... />
 * </ErrorBoundaryGroup>
 * ```
 * If MarketOverview throws, CurrenciesTab keeps rendering — and vice versa.
 *
 * Optional: pass an array of titles to label each boundary's fallback:
 * ```tsx
 * <ErrorBoundaryGroup titles={["Market Overview", "Currencies"]}>
 *   <MarketOverview ... />
 *   <CurrenciesTab ... />
 * </ErrorBoundaryGroup>
 * ```
 */
interface ErrorBoundaryGroupProps {
  children: React.ReactNode;
  /** Optional per-child fallback titles (matched by index). Missing titles default to "Section N". */
  titles?: string[];
}

export function ErrorBoundaryGroup({ children, titles }: ErrorBoundaryGroupProps) {
  // React.Children.toArray flattens fragments and filters nulls, giving us
  // a stable array to iterate over. Each child gets its own ErrorBoundary.
  const childArray = React.Children.toArray(children);
  const { t } = useI18n();

  return (
    <>
      {childArray.map((child, index) => {
        const fallbackTitle = titles?.[index] ?? t("ariaSectionN", { "0": String(index + 1) });
        return (
          <ErrorBoundary key={index} fallbackTitle={fallbackTitle}>
            {child}
          </ErrorBoundary>
        );
      })}
    </>
  );
}
