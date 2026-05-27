// ============================================================================
// Pagination Component (reusable)
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
  const { t } = useI18n();
  if (totalPages <= 1 && !onPerPageChange) return null;

  return (
    <div className="flex items-center justify-between gap-2 mt-4">
      <div className="flex items-center gap-2">
        {onPerPageChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t("perPage")}</span>
            <Select
              value={String(perPage)}
              onValueChange={(v) => onPerPageChange(Number(v))}
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
          <span className="text-xs text-muted-foreground">
            {totalItems.toLocaleString()} {t("items")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground min-w-[80px] text-center">
          {t("pageOf", { "0": page, "1": totalPages })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
