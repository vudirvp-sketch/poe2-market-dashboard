// ============================================================================
// Price Alert Dialog — Browser Notifications with Price Alerts (Feature 3.2)
// Lets users set above/below price thresholds for favorited items and receive
// browser notifications when thresholds are crossed.
// ============================================================================
"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Bell,
  BellRing,
  Plus,
  Trash2,
  Power,
  PowerOff,
  Send,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/lib/types";
import type { PoeItem } from "@/lib/types";
import { useDashboardStore, type PriceAlert } from "@/lib/store";

interface PriceAlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  realm: string;
  league: string;
  allItems: PoeItem[] | undefined;
}

export function PriceAlertDialog({
  open,
  onOpenChange,
  realm,
  league,
  allItems,
}: PriceAlertDialogProps) {
  const { alerts, addAlert, removeAlert, updateAlert, favorites } =
    useDashboardStore();

  // ---- Notification permission state ----
  const [notiPermission, setNotiPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => {
    if (typeof window === "undefined" || !("Notification" in window))
      return "unsupported";
    return Notification.permission;
  });

  // ---- Add-alert form state ----
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [thresholdInput, setThresholdInput] = useState<string>("");
  const [adding, setAdding] = useState(false);

  // ---- Favorited items available for alert creation ----
  const favoritedItems = useMemo(() => {
    if (!allItems) return [];
    return allItems.filter((i) => favorites.includes(i.id));
  }, [allItems, favorites]);

  // ---- Request notification permission ----
  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setNotiPermission(result);
  }, []);

  // ---- Test notification ----
  const sendTestNotification = useCallback(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      new Notification("PoE2 Price Alert", {
        body: "This is a test notification — your alerts are working!",
        icon: "/logo.svg",
      });
    } catch {
      // Silently ignore
    }
  }, []);

  // ---- Add new alert ----
  const handleAddAlert = useCallback(() => {
    const threshold = parseFloat(thresholdInput);
    if (!selectedItemId || isNaN(threshold) || threshold <= 0) return;

    const item = favoritedItems.find((i) => i.id === selectedItemId);
    if (!item) return;

    setAdding(true);

    const newAlert: PriceAlert = {
      itemId: item.id,
      itemName: item.name,
      condition,
      threshold,
      enabled: true,
    };

    addAlert(newAlert);

    // Reset form
    setSelectedItemId("");
    setThresholdInput("");
    setAdding(false);
  }, [selectedItemId, condition, thresholdInput, favoritedItems, addAlert]);

  // ---- Toggle alert enabled/disabled ----
  const handleToggleAlert = useCallback(
    (alert: PriceAlert) => {
      updateAlert(alert.itemId, { enabled: !alert.enabled });
    },
    [updateAlert]
  );

  // ---- Delete alert ----
  const handleDeleteAlert = useCallback(
    (itemId: string) => {
      removeAlert(itemId);
    },
    [removeAlert]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-primary" />
            Price Alerts
          </DialogTitle>
          <DialogDescription>
            Set price thresholds on favorited items and get browser notifications
            when they are crossed.
          </DialogDescription>
        </DialogHeader>

        {/* Notification Permission */}
        {notiPermission !== "granted" && notiPermission !== "unsupported" && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-3">
            <Bell className="h-5 w-5 text-amber-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                Browser notifications are blocked
              </p>
              <p className="text-xs text-muted-foreground">
                You need to grant notification permission to receive price
                alerts.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={requestPermission}>
              Enable Notifications
            </Button>
          </div>
        )}

        {notiPermission === "unsupported" && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 flex items-center gap-3">
            <Bell className="h-5 w-5 text-red-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Browser notifications not supported
              </p>
              <p className="text-xs text-muted-foreground">
                Your browser does not support the Notification API.
              </p>
            </div>
          </div>
        )}

        {/* Current Alerts List */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Active Alerts
          </h4>

          {alerts.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No price alerts set</p>
              <p className="text-xs mt-1">
                Add an alert below to get notified when prices cross your
                thresholds
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {alerts.map((alert) => {
                // Find the current item to show live price
                const currentItem = allItems?.find(
                  (i) => i.id === alert.itemId
                );
                const currentPrice =
                  currentItem?.relativePrice ??
                  currentItem?.priceChaos ??
                  null;

                return (
                  <div
                    key={`${alert.itemId}_${alert.condition}`}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 transition-colors ${
                      alert.enabled
                        ? "border-border bg-card"
                        : "border-border/50 bg-muted/30 opacity-60"
                    }`}
                  >
                    {/* Item info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {currentItem?.iconUrl ? (
                          <img
                            src={currentItem.iconUrl}
                            alt=""
                            className="w-4 h-4 object-contain shrink-0"
                          />
                        ) : null}
                        <span className="text-sm font-medium truncate">
                          {alert.itemName}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge
                          variant={
                            alert.condition === "above" ? "default" : "secondary"
                          }
                          className="text-[10px] px-1.5 py-0 h-4"
                        >
                          {alert.condition === "above" ? "▲ Above" : "▼ Below"}
                        </Badge>
                        <span className="text-xs font-mono">
                          {fmt(alert.threshold)}
                        </span>
                        {currentPrice != null && (
                          <span className="text-xs text-muted-foreground">
                            (now: {fmt(currentPrice)})
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Toggle enable/disable */}
                    <button
                      onClick={() => handleToggleAlert(alert)}
                      className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
                      title={alert.enabled ? "Disable alert" : "Enable alert"}
                    >
                      {alert.enabled ? (
                        <Power className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <PowerOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => handleDeleteAlert(alert.itemId)}
                      className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
                      title="Remove alert"
                    >
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add Alert Form */}
        <div className="space-y-3 pt-2 border-t border-border">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" />
            Add Alert
          </h4>

          {favoritedItems.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              You need to favorite items first before setting alerts.
            </p>
          ) : (
            <div className="space-y-2">
              {/* Item select */}
              <Select
                value={selectedItemId}
                onValueChange={setSelectedItemId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a favorited item..." />
                </SelectTrigger>
                <SelectContent>
                  {favoritedItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      <span className="flex items-center gap-1.5">
                        {item.iconUrl ? (
                          <img
                            src={item.iconUrl}
                            alt=""
                            className="w-4 h-4 object-contain"
                          />
                        ) : null}
                        {item.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Condition + Threshold row */}
              <div className="flex gap-2">
                <Select
                  value={condition}
                  onValueChange={(v) => setCondition(v as "above" | "below")}
                >
                  <SelectTrigger className="w-[120px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="above">▲ Above</SelectItem>
                    <SelectItem value="below">▼ Below</SelectItem>
                  </SelectContent>
                </Select>

                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Threshold price"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  className="flex-1"
                />
              </div>

              {/* Add button */}
              <Button
                onClick={handleAddAlert}
                disabled={
                  !selectedItemId ||
                  !thresholdInput ||
                  isNaN(parseFloat(thresholdInput)) ||
                  parseFloat(thresholdInput) <= 0 ||
                  adding
                }
                size="sm"
                className="w-full"
              >
                {adding ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Plus className="h-4 w-4 mr-1" />
                )}
                Add Alert
              </Button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={sendTestNotification}
            disabled={notiPermission !== "granted"}
            className="text-xs"
          >
            <Send className="h-3.5 w-3.5 mr-1" />
            Test Notification
          </Button>

          {notiPermission === "default" && (
            <Button
              variant="outline"
              size="sm"
              onClick={requestPermission}
              className="text-xs"
            >
              <Bell className="h-3.5 w-3.5 mr-1" />
              Enable Notifications
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
