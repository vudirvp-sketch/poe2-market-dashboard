"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useI18n, type TranslationKeys } from "@/lib/i18n";
import { Keyboard } from "lucide-react";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Shortcut entries: key label and i18n key for description
const SHORTCUTS: { key: string; i18nKey: TranslationKeys }[] = [
  { key: "T", i18nKey: "shortcutToggleView" },
  { key: "F", i18nKey: "shortcutFocusSearch" },
  { key: "↑ / ↓", i18nKey: "shortcutNavigateRows" },
  { key: "Enter", i18nKey: "shortcutOpenDetail" },
  { key: "Escape", i18nKey: "shortcutClose" },
  { key: "1–0", i18nKey: "shortcutSwitchTab" },
  { key: "?", i18nKey: "shortcutHelp" },
];

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" aria-hidden="true" />
            {t("shortcutTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("shortcutDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <table className="w-full text-sm" role="table">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4 text-left font-medium text-muted-foreground w-24">
                  {t("shortcutKey")}
                </th>
                <th className="py-2 text-left font-medium text-muted-foreground">
                  {t("shortcutAction")}
                </th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map(({ key, i18nKey }) => (
                <tr key={key} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 pr-4">
                    <kbd className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded border border-border bg-muted font-mono text-xs font-semibold shadow-sm">
                      {key}
                    </kbd>
                  </td>
                  <td className="py-2.5 text-foreground">
                    {t(i18nKey) ?? i18nKey}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Tab mapping reference */}
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground mb-1.5">
            {t("shortcutTabMapping")}
          </p>
          {/* iter 92 (KI-7): Mapping updated after removing dead "arbitrage" and "graph" from TAB_MAP.
              iter 97 (F7): "circuit-patterns" inserted at idx 9 (shortcut 0).
              iter 98 (P4): "intraday-patterns" inserted at idx 10 (click-only — only 10 shortcut slots).
              Now all 10 shortcuts (1–9 + 0) map to live tabs.
              "5" → Flips, "0" → Circuits (was Liquid Chain in iter 92).
              Intraday Patterns (idx 10) + Liquid Chain (idx 11) + Watchlist (idx 12)
              NOT keyboard-reachable — only 10 shortcut slots. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><kbd className="font-mono font-semibold">1</kbd> {t("tabOverview")}</span>
            <span><kbd className="font-mono font-semibold">2</kbd> {t("tabCurrencies")}</span>
            <span><kbd className="font-mono font-semibold">3</kbd> {t("tabUniques")}</span>
            <span><kbd className="font-mono font-semibold">4</kbd> {t("tabExchange")}</span>
            <span><kbd className="font-mono font-semibold">5</kbd> {t("tabFlips")}</span>
            <span><kbd className="font-mono font-semibold">6</kbd> {t("tabOptimizer")}</span>
            <span><kbd className="font-mono font-semibold">7</kbd> {t("tabAnalyst")}</span>
            <span><kbd className="font-mono font-semibold">8</kbd> {t("tabStorageValue")}</span>
            <span><kbd className="font-mono font-semibold">9</kbd> {t("tabSpeculation")}</span>
            <span><kbd className="font-mono font-semibold">0</kbd> {t("tabCircuitPatterns")}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
