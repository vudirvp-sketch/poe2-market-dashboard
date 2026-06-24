"use client";

/**
 * DashboardDialogs — extracted from dashboard-page.tsx (P2-1, iter 73, step 4b).
 *
 * Bundles the 8 dialog/sheet/banner primitives that live at the bottom of the
 * Dashboard render tree. Each one is opened/closed via a controlled `open`
 * prop, and most are wrapped in an `<ErrorBoundary>` so a render error in one
 * dialog doesn't blank out the whole page.
 *
 * The component owns NO state. Open/close flags and all data needed by the
 * dialogs are passed in as props from the parent `Dashboard`.
 *
 * Pattern: same props-passing convention as the iter 71-72 tab extractions
 * and the iter 73 step 4a `DashboardToolbar` extraction.
 */

import { DetailDialog } from "@/components/dashboard/detail-dialog";
import { PairDetailDialog } from "@/components/dashboard/pair-detail-dialog";
import { ComparisonDialog } from "@/components/dashboard/comparison-dialog";
import { PairComparisonDialog } from "@/components/dashboard/pair-comparison-dialog";
import { PriceAlertDialog } from "@/components/dashboard/price-alert-dialog";
import { EventsSidebar } from "@/components/dashboard/events-sidebar";
import { OfflineBanner } from "@/components/dashboard/offline-banner";
import { ShortcutsDialog } from "@/components/dashboard/shortcuts-dialog";
import { ErrorBoundary } from "@/components/dashboard/error-boundary";

import type { TranslationKeys } from "@/lib/i18n/locales/en";
import type { PoeItem, ExchangePair } from "@/lib/types";

export interface DashboardDialogsProps {
  // --- Item Detail dialog ---
  detailItem: PoeItem | null;
  detailOpen: boolean;
  setDetailOpen: (open: boolean) => void;

  // --- Pair Detail dialog ---
  detailPair: ExchangePair | null;
  pairDetailOpen: boolean;
  setPairDetailOpen: (open: boolean) => void;

  // --- Item Comparison dialog ---
  comparisonOpen: boolean;
  setComparisonOpen: (open: boolean) => void;

  // --- Pair Comparison dialog ---
  pairComparisonOpen: boolean;
  setPairComparisonOpen: (open: boolean) => void;

  // --- Price Alert dialog ---
  alertOpen: boolean;
  setAlertOpen: (open: boolean) => void;

  // --- Events sidebar (Sheet) ---
  eventsSidebarOpen: boolean;
  setEventsSidebarOpen: (open: boolean) => void;

  // --- Keyboard Shortcuts help dialog ---
  shortcutsHelpOpen: boolean;
  setShortcutsHelpOpen: (open: boolean) => void;

  // --- Shared context ---
  realm: string;
  league: string; // effectiveLeague
  referenceCurrency: string;
  allItems: PoeItem[] | undefined;
  backendOnline: boolean;

  // --- i18n (only used for ErrorBoundary fallback titles) ---
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
}

export function DashboardDialogs(props: DashboardDialogsProps) {
  const {
    detailItem,
    detailOpen,
    setDetailOpen,
    detailPair,
    pairDetailOpen,
    setPairDetailOpen,
    comparisonOpen,
    setComparisonOpen,
    pairComparisonOpen,
    setPairComparisonOpen,
    alertOpen,
    setAlertOpen,
    eventsSidebarOpen,
    setEventsSidebarOpen,
    shortcutsHelpOpen,
    setShortcutsHelpOpen,
    realm,
    league,
    referenceCurrency,
    allItems,
    backendOnline,
    t,
  } = props;

  return (
    <>
      {/* ============ ITEM DETAIL DIALOG ============ */}
      <ErrorBoundary fallbackTitle={t("fallbackItemDetails")}>
        <DetailDialog
          item={detailItem}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          realm={realm}
          league={league}
          referenceCurrency={referenceCurrency}
        />
      </ErrorBoundary>

      {/* ============ PAIR DETAIL DIALOG ============ */}
      <ErrorBoundary fallbackTitle={t("fallbackPairDetails")}>
        <PairDetailDialog
          pair={detailPair}
          open={pairDetailOpen}
          onOpenChange={setPairDetailOpen}
          realm={realm}
          league={league}
        />
      </ErrorBoundary>

      {/* ============ ITEM COMPARISON DIALOG ============ */}
      <ComparisonDialog
        open={comparisonOpen}
        onOpenChange={setComparisonOpen}
        realm={realm}
        league={league}
        referenceCurrency={referenceCurrency}
        allItems={allItems}
      />

      {/* ============ PAIR COMPARISON DIALOG ============ */}
      <PairComparisonDialog
        open={pairComparisonOpen}
        onOpenChange={setPairComparisonOpen}
        realm={realm}
        league={league}
      />

      {/* ============ PRICE ALERT DIALOG ============ */}
      <PriceAlertDialog
        open={alertOpen}
        onOpenChange={setAlertOpen}
        realm={realm}
        league={league}
        allItems={allItems}
      />

      {/* ============ EVENTS SIDEBAR (Sheet) ============ */}
      <EventsSidebar
        open={eventsSidebarOpen}
        onOpenChange={setEventsSidebarOpen}
        backendOnline={backendOnline}
      />

      {/* ============ OFFLINE BANNER (PWA) ============ */}
      <OfflineBanner />

      {/* ============ §3.2: KEYBOARD SHORTCUTS HELP DIALOG ============ */}
      <ShortcutsDialog
        open={shortcutsHelpOpen}
        onOpenChange={setShortcutsHelpOpen}
      />
    </>
  );
}
