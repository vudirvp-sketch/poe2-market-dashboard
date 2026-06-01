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
            {t("shortcutTitle") ?? "Keyboard Shortcuts"}
          </DialogTitle>
          <DialogDescription>
            {t("shortcutDescription") ?? "Use these shortcuts to navigate the dashboard faster."}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <table className="w-full text-sm" role="table">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4 text-left font-medium text-muted-foreground w-24">
                  {t("shortcutKey") ?? "Key"}
                </th>
                <th className="py-2 text-left font-medium text-muted-foreground">
                  {t("shortcutAction") ?? "Action"}
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
            {t("shortcutTabMapping") ?? "Tab shortcuts:"}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><kbd className="font-mono font-semibold">1</kbd> {t("tabOverview")}</span>
            <span><kbd className="font-mono font-semibold">2</kbd> {t("tabCurrencies")}</span>
            <span><kbd className="font-mono font-semibold">3</kbd> {t("tabUniques")}</span>
            <span><kbd className="font-mono font-semibold">4</kbd> {t("tabExchange")}</span>
            <span><kbd className="font-mono font-semibold">5</kbd> {t("tabArbitrage")}</span>
            <span><kbd className="font-mono font-semibold">6</kbd> {t("tabFlips")}</span>
            <span><kbd className="font-mono font-semibold">7</kbd> {t("tabForecast")}</span>
            <span><kbd className="font-mono font-semibold">8</kbd> {t("tabPortfolio")}</span>
            <span><kbd className="font-mono font-semibold">9</kbd> {t("tabGraph")}</span>
            <span><kbd className="font-mono font-semibold">0</kbd> {t("tabWatchlist")}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
