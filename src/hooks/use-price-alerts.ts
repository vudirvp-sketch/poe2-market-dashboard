// ============================================================================
// usePriceAlerts — Browser notification hook for price threshold alerts
// Checks alert conditions on a polling interval and fires browser notifications
//
// Fix: previously called fetchApi() directly inside a setInterval callback,
// bypassing React Query cache entirely. Now reads from the existing React
// Query cache (key ["allItems", realm, league]) which dashboard-page.tsx
// already populates, and triggers a background refetch on the interval.
// This eliminates duplicate network requests for the same data.
// ============================================================================
"use client";

import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboardStore } from "@/lib/store";
import type { PoeItem } from "@/lib/types";
import { QUERY_KEYS } from "@/components/providers";

/** Debounce map: alert key → timestamp of last notification */
const NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
// Poll interval for cache-based alert checking
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface UsePriceAlertsOptions {
  realm: string;
  league: string;
  /** Override polling interval in ms (default 5 min) */
  pollInterval?: number;
}

export function usePriceAlerts({ realm, league, pollInterval }: UsePriceAlertsOptions) {
  const alerts = useDashboardStore((s) => s.alerts);
  const lastNotifiedRef = useRef<Map<string, number>>(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queryClient = useQueryClient();

  // ---- Core alert-checking logic ----
  // Reads from React Query cache (populated by dashboard-page.tsx's
  // ["allItems", realm, league] query) instead of fetching directly.
  const checkAlerts = useCallback(() => {
    const enabledAlerts = alerts.filter((a) => a.enabled);
    if (
      enabledAlerts.length === 0 ||
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    if (!league || !realm) return;

    // Read from React Query cache — no network request
    const allItems = queryClient.getQueryData<PoeItem[]>(["allItems", realm, league]);
    if (!allItems) return;

    // Build a lookup by item id
    const itemMap = new Map<string, PoeItem>();
    for (const item of allItems) {
      itemMap.set(item.id, item);
    }

    const now = Date.now();

    for (const alert of enabledAlerts) {
      const item = itemMap.get(alert.itemId);
      if (!item) continue;

      const currentPrice = item.relativePrice ?? item.chaosEquivalentRate ?? item.price;
      if (currentPrice == null) continue;

      // Check condition
      const triggered =
        alert.condition === "above"
          ? currentPrice > alert.threshold
          : currentPrice < alert.threshold;

      if (!triggered) continue;

      // Debounce: skip if we notified for this alert key within the cooldown
      const alertKey = `${alert.itemId}_${alert.condition}`;
      const lastNotified = lastNotifiedRef.current.get(alertKey) ?? 0;
      if (now - lastNotified < NOTIFICATION_COOLDOWN_MS) continue;

      // Fire browser notification
      const direction = alert.condition === "above" ? "above" : "below";
      const body = `${alert.itemName} is now ${direction} ${alert.threshold.toFixed(2)} (current: ${currentPrice.toFixed(2)})`;

      try {
        new Notification("PoE2 Price Alert", {
          body,
          icon: item.iconUrl || "/logo.svg",
        });
      } catch {
        // Notification constructor may fail in some environments; ignore
      }

      // Record notification timestamp
      lastNotifiedRef.current.set(alertKey, now);
    }
  }, [alerts, realm, league, queryClient]);

  // ---- Polling interval ----
  // Instead of calling fetchApi on every tick, we:
  //   1. Trigger a background refetch of the cached query (stays in RQ cache)
  //   2. After a short delay (to let the refetch complete), check alerts from cache
  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Only set up polling if there are alerts and permission is granted
    if (
      alerts.length === 0 ||
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    const interval = pollInterval ?? POLL_INTERVAL_MS;

    // Initial check from cache (data likely already there from dashboard)
    checkAlerts();

    timerRef.current = setInterval(() => {
      // Trigger a background refetch via React Query — this populates the
      // cache and deduplicates with any other consumer of the same key.
      queryClient.refetchQueries({ queryKey: [QUERY_KEYS.allItems, realm, league] }).then(() => {
        // After refetch completes, check alerts from the updated cache
        checkAlerts();
      }).catch(() => {
        // If refetch fails, still check from stale cache
        checkAlerts();
      });
    }, interval);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [alerts, realm, league, pollInterval, checkAlerts, queryClient]);

  return { checkAlerts };
}
