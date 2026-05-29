// ============================================================================
// usePriceAlerts — Browser notification hook for price threshold alerts
// Checks alert conditions on a polling interval and fires browser notifications
// ============================================================================
"use client";

import { useEffect, useRef, useCallback } from "react";
import { useDashboardStore } from "@/lib/store";
import { fetchApi } from "@/lib/types";
import type { PoeItem } from "@/lib/types";

/** Debounce map: alert key → timestamp of last notification */
const NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
// Fix 4.5: Increased poll interval from 60s to 5min — loading all items
// every 60s for 1-2 alerts is wasteful (~500+ items per cycle)
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface UsePriceAlertsOptions {
  realm: string;
  league: string;
  /** Override polling interval in ms (default 60000) */
  pollInterval?: number;
}

export function usePriceAlerts({ realm, league, pollInterval }: UsePriceAlertsOptions) {
  const alerts = useDashboardStore((s) => s.alerts);
  const lastNotifiedRef = useRef<Map<string, number>>(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Core alert-checking logic ----
  const checkAlerts = useCallback(async () => {
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

    // Gather unique item IDs that have enabled alerts
    const itemIds = [...new Set(enabledAlerts.map((a) => a.itemId))];
    if (itemIds.length === 0) return;

    try {
      // Fetch current prices for all items with alerts
      const allItems = await fetchApi<PoeItem[]>("/api/poe2/items", {
        realm,
        league,
      });

      // Build a lookup by item id
      const itemMap = new Map<string, PoeItem>();
      for (const item of allItems) {
        itemMap.set(item.id, item);
      }

      const now = Date.now();

      for (const alert of enabledAlerts) {
        const item = itemMap.get(alert.itemId);
        if (!item) continue;

        const currentPrice = item.relativePrice ?? item.priceChaos ?? item.price;
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
    } catch {
      // Silently ignore fetch errors — will retry on next interval
    }
  }, [alerts, realm, league]);

  // ---- Polling interval ----
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

    // Initial check
    checkAlerts();

    timerRef.current = setInterval(checkAlerts, interval);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [alerts, realm, league, pollInterval, checkAlerts]);

  return { checkAlerts };
}
