// ============================================================================
// Pagination Component (reusable)
// WCAG 2.1 AA: aria-labels on icon-only nav buttons
// ============================================================================
"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems?: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onPerPageChange?: (perPage: number) => void;
  perPageOptions?: number[];
}

export function Pagination({
  page,
  totalPages,
  totalItems,
  perPage,
  onPageChange,
  onPerPageChange,
  perPageOptions = [25, 50, 100],
}: PaginationProps) {
  const { t, tp } = useI18n();
  if (totalPages <= 1 && !onPerPageChange) return null;

  return (
    <div className="flex items-center justify-between gap-2 mt-4" role="navigation" aria-label="Pagination">
      <div className="flex items-center gap-2">
        {onPerPageChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t("perPage")}</span>
            <Select
              value={String(perPage)}
              onValueChange={(v) => onPerPageChange(Number(v))}
              aria-label={t("perPage")}
            >
              <SelectTrigger className="h-7 w-[70px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {perPageOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {totalItems != null && (
          <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {totalItems.toLocaleString()} {tp(t("_pl_items"), totalItems, {})}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          aria-label={t("pageOf", { "0": String(Math.max(1, page - 1)), "1": String(totalPages) })}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="text-sm text-muted-foreground min-w-[80px] text-center" aria-live="polite" role="status">
          {t("pageOf", { "0": page, "1": totalPages })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("pageOf", { "0": String(page + 1), "1": String(totalPages) })}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
