// ============================================================================
// Events Sidebar — Sheet component for manual event flagging and management.
//
// Reference: frontend/components/events_sidebar.py (Streamlit)
// Data: GET /api/flipper/events, POST /api/flipper/events
//
// Uses a shadcn/ui Sheet (slide-in panel from the right) triggered by the
// Events button in the header. Shows active events, create form, and
// event impact summary.
// ============================================================================
"use client";

import { useState, useCallback, memo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Plus,
  Trash2,
  AlertTriangle,
  Info,
  Calendar,
  Tag,
  Type,
  Server,
  Circle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useI18n, type TranslationKeys } from "@/lib/i18n";
import { fetchApi } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveEvent {
  eventId: string;
  eventType: string;
  description: string;
  affectedCurrencies: string[];
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
}

interface EventsListResponse {
  events: ActiveEvent[];
  total: number;
}

interface CreateEventPayload {
  eventType: string;
  description: string;
  affectedCurrencies: string[];
  expiryHours: number;
}

interface CreateEventResponse {
  event: ActiveEvent;
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventTypeDisplay(type: string, t: (key: TranslationKeys) => string): { label: string; color: string } {
  switch (type) {
    case "major_patch":
      return { label: t("eventsTypeMajorPatch"), color: "border-red-500 text-red-600 dark:text-red-400 bg-red-500/10" };
    case "minor_patch":
      return { label: t("eventsTypeMinorPatch"), color: "border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-500/10" };
    case "league_start":
      return { label: t("eventsTypeLeagueStart"), color: "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" };
    case "economy_shift":
      return { label: t("eventsTypeEconomyShift"), color: "border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-500/10" };
    case "streamer_hype":
      return { label: t("eventsTypeStreamerHype"), color: "border-purple-500 text-purple-600 dark:text-purple-400 bg-purple-500/10" };
    default:
      return { label: t("eventsTypeOther"), color: "border-muted-foreground text-muted-foreground bg-muted" };
  }
}

function formatExpiry(expiresAt: string | null, t: (key: TranslationKeys) => string): string {
  if (!expiresAt) return t("eventsNever");
  const expiry = new Date(expiresAt);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  if (diffMs <= 0) return t("eventsExpired");
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (diffHours > 24) {
    const days = Math.floor(diffHours / 24);
    return `${days}d ${diffHours % 24}h`;
  }
  if (diffHours > 0) return `${diffHours}h ${diffMins}m`;
  return `${diffMins}m`;
}

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

interface EventsSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the flipper backend is online (checked at dashboard level) */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const EventsSidebar = memo(function EventsSidebar({ open, onOpenChange, backendOnline }: EventsSidebarProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // Create event form state
  const [eventType, setEventType] = useState("minor_patch");
  const [description, setDescription] = useState("");
  const [affectedCurrencies, setAffectedCurrencies] = useState("");
  const [expiryHours, setExpiryHours] = useState(48);
  const [createError, setCreateError] = useState<string | null>(null);

  // ---- Fetch active events ----
  const {
    data: eventsData,
    isLoading: eventsLoading,
    refetch: refetchEvents,
  } = useQuery<EventsListResponse>({
    queryKey: ["flipperEvents"],
    queryFn: () => fetchApi<EventsListResponse>("/api/flipper/events", { active_only: "true" }),
    enabled: backendOnline && open,
    staleTime: 30_000,
    refetchInterval: open ? 30_000 : false,
    retry: 1,
  });

  // ---- Create event mutation ----
  const createMutation = useMutation({
    mutationFn: (payload: CreateEventPayload) =>
      // Use fetch directly for POST — fetchApi only supports GET
      fetch("/api/flipper/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text);
        }
        return res.json() as Promise<CreateEventResponse>;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flipperEvents"] });
      queryClient.invalidateQueries({ queryKey: ["flipperHealth"] });
      // Reset form
      setDescription("");
      setAffectedCurrencies("");
      setExpiryHours(48);
      setCreateError(null);
    },
    onError: (err: Error) => {
      setCreateError(err.message);
    },
  });

  // ---- Delete event mutation ----
  const deleteMutation = useMutation({
    mutationFn: (eventId: string) =>
      fetch(`/api/flipper/events/${eventId}`, { method: "DELETE" }).then(
        async (res) => {
          if (!res.ok) {
            const text = await res.text();
            throw new Error(text);
          }
          return res.json();
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flipperEvents"] });
      queryClient.invalidateQueries({ queryKey: ["flipperHealth"] });
    },
  });

  // ---- Deactivate event mutation ----
  const deactivateMutation = useMutation({
    mutationFn: (eventId: string) =>
      fetch(`/api/flipper/events/${eventId}/deactivate`, { method: "POST" }).then(
        async (res) => {
          if (!res.ok) {
            const text = await res.text();
            throw new Error(text);
          }
          return res.json();
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flipperEvents"] });
      queryClient.invalidateQueries({ queryKey: ["flipperHealth"] });
    },
  });

  // ---- Handle create event ----
  const handleCreateEvent = useCallback(() => {
    if (!description.trim()) {
      setCreateError(t("eventsDescriptionRequired"));
      return;
    }

    const currencies = affectedCurrencies.trim()
      ? affectedCurrencies
          .split(",")
          .map((c) => c.trim().toLowerCase())
          .filter(Boolean)
      : [];

    createMutation.mutate({
      eventType: eventType,
      description: description.trim(),
      affectedCurrencies: currencies,
      expiryHours: expiryHours,
    });
  }, [description, affectedCurrencies, eventType, expiryHours, createMutation, t]);

  // ---- Compute impact summary ----
  const allAffectedCurrencies = eventsData?.events?.flatMap(
    (e) => e.affectedCurrencies,
  ) ?? [];
  const uniqueAffected = [...new Set(allAffectedCurrencies)];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" aria-hidden="true" />
            {t("eventsTitle")}
          </SheetTitle>
          <SheetDescription>{t("eventsDescription")}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* ---- Backend status ---- */}
          {!backendOnline && (
            <Card className="border-red-500/30 bg-red-500/5">
              <CardContent className="flex items-start gap-3 p-4">
                <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-sm">
                  <p className="font-medium text-red-600 dark:text-red-400">
                    {t("flipperBackendOfflineTitle")}
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {t("flipperBackendOfflineDesc")}
                  </p>
                  <code className="text-xs mt-2 block bg-muted px-2 py-1 rounded">
                    uvicorn backend.main:app --reload --port 8000
                  </code>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---- Backend online indicator ---- */}
          {backendOnline && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Circle
                className="h-2.5 w-2.5 fill-emerald-500 text-emerald-500"
                aria-hidden="true"
              />
              <Server className="h-3 w-3" aria-hidden="true" />
              {t("flipperBackendOnline")}
            </div>
          )}

          {/* ---- Impact summary ---- */}
          {backendOnline && eventsData && eventsData.total > 0 && (
            <Card className="border-orange-500/30 bg-orange-500/5">
              <CardContent className="p-4 space-y-1">
                <p className="text-sm font-medium text-orange-600 dark:text-orange-400">
                  {t("eventsImpactSummary", { "0": eventsData.total })}
                </p>
                {uniqueAffected.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("eventsAffectedCurrencies")}: {uniqueAffected.join(", ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t("eventsScoringPenalty")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* ---- Active events list ---- */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <Info className="h-4 w-4" aria-hidden="true" />
              {t("eventsActiveTitle")}
            </h3>

            {eventsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : !eventsData?.events?.length ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t("eventsNoActive")}
              </p>
            ) : (
              <div className="space-y-3">
                {eventsData.events.map((event) => {
                  const display = eventTypeDisplay(event.eventType, t);
                  return (
                    <Card
                      key={event.eventId}
                      className={`border-l-4 ${display.color}`}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <Badge
                            variant="outline"
                            className={`text-xs px-2 py-0.5 font-semibold ${display.color}`}
                          >
                            {display.label}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap flex items-center gap-1">
                            <Calendar className="h-3 w-3" aria-hidden="true" />
                            {formatExpiry(event.expiresAt, t)}
                          </span>
                        </div>
                        <p className="text-sm leading-snug">
                          {event.description}
                        </p>
                        {event.affectedCurrencies.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {t("eventsAffects")}:{" "}
                            {event.affectedCurrencies.slice(0, 5).join(", ")}
                            {event.affectedCurrencies.length > 5 &&
                              ` +${event.affectedCurrencies.length - 5}`}
                          </p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => deactivateMutation.mutate(event.eventId)}
                            disabled={deactivateMutation.isPending}
                            aria-label={t("eventsDeactivate")}
                          >
                            <Circle className="h-3 w-3" aria-hidden="true" />
                            {t("eventsDeactivate")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                            onClick={() => deleteMutation.mutate(event.eventId)}
                            disabled={deleteMutation.isPending}
                            aria-label={t("eventsDelete")}
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                            {t("eventsDelete")}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* ---- Create event form ---- */}
          {backendOnline && (
            <div className="border-t border-border pt-4 space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("eventsCreateTitle")}
              </h3>

              {/* Event type */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1" htmlFor="event-type">
                  <Tag className="h-3 w-3" aria-hidden="true" />
                  {t("eventsEventType")}
                </label>
                <Select value={eventType} onValueChange={setEventType}>
                  <SelectTrigger id="event-type" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="major_patch">{t("eventsTypeMajorPatch")}</SelectItem>
                    <SelectItem value="minor_patch">{t("eventsTypeMinorPatch")}</SelectItem>
                    <SelectItem value="league_start">{t("eventsTypeLeagueStart")}</SelectItem>
                    <SelectItem value="economy_shift">{t("eventsTypeEconomyShift")}</SelectItem>
                    <SelectItem value="streamer_hype">{t("eventsTypeStreamerHype")}</SelectItem>
                    <SelectItem value="other">{t("eventsTypeOther")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1" htmlFor="event-desc">
                  <Type className="h-3 w-3" aria-hidden="true" />
                  {t("eventsDescriptionLabel")}
                </label>
                <Input
                  id="event-desc"
                  placeholder={t("eventsDescriptionPlaceholder")}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setCreateError(null);
                  }}
                  className="h-9 text-sm"
                  maxLength={500}
                />
              </div>

              {/* Affected currencies */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="event-currencies">
                  {t("eventsAffectedLabel")}
                </label>
                <Input
                  id="event-currencies"
                  placeholder={t("eventsAffectedPlaceholder")}
                  value={affectedCurrencies}
                  onChange={(e) => setAffectedCurrencies(e.target.value)}
                  className="h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                  {t("eventsAffectedHint")}
                </p>
              </div>

              {/* Expiry hours */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1" htmlFor="event-expiry">
                  <Calendar className="h-3 w-3" aria-hidden="true" />
                  {t("eventsExpiryLabel")}
                </label>
                <Input
                  id="event-expiry"
                  type="number"
                  min={1}
                  max={168}
                  value={expiryHours}
                  onChange={(e) => setExpiryHours(Number(e.target.value) || 48)}
                  className="h-9 text-sm w-24"
                />
                <p className="text-[10px] text-muted-foreground">
                  {t("eventsExpiryHint")}
                </p>
              </div>

              {/* Error message */}
              {createError && (
                <p className="text-xs text-red-500">{createError}</p>
              )}

              {/* Submit */}
              <Button
                className="w-full h-9 gap-1.5"
                onClick={handleCreateEvent}
                disabled={createMutation.isPending || !description.trim()}
                aria-label={t("eventsCreateButton")}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {createMutation.isPending ? t("eventsCreating") : t("eventsCreateButton")}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
});
