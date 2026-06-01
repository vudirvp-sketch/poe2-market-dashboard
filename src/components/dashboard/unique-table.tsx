// ============================================================================
// Unique Items Table with Category Grouping + Density Toggle (§2.2)
// WCAG 2.1 AA: aria-hidden on decorative icons, keyboard row navigation
// ============================================================================
"use client";

import { useMemo, useCallback, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Shield, Star, ArrowUpDown, ArrowUp, ArrowDown, GitCompare, ChevronRight, ChevronDown, List, Rows3 } from "lucide-react";
import { Sparkline } from "./sparkline";
import { fmt, fmtChange, fetchApi } from "@/lib/types";
import type { PoeItem, PoeItemHistoryPoint } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

interface UniqueTableProps {
  items: PoeItem[];
  onItemClick: (item: PoeItem) => void;
  realm?: string;
  league?: string;
  referenceCurrency?: string;
}

type DensityMode = "comfortable" | "compact";

// Category group with its items
interface CategoryGroup {
  name: string;
  displayName: string;
  items: PoeItem[];
}

export function UniqueTable({ items, onItemClick, realm, league, referenceCurrency }: UniqueTableProps) {
  const { t } = useI18n();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [density, setDensity] = useState<DensityMode>("comfortable");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const { isFavorite, toggleFavorite, isInComparison, addToComparison, removeFromComparison, uiState } =
    useDashboardStore();
  const queryClient = useQueryClient();

  // §3.5: Global dense mode overrides local density
  const isGlobalDense = uiState.denseMode;
  const effectiveDensity: DensityMode = isGlobalDense ? "compact" : density;

  const isCompact = effectiveDensity === "compact";
  const rowHeight = isCompact ? 28 : 44;
  const fontSize = isCompact ? "text-xs" : "text-sm";
  const cellPadding = isCompact ? "py-1 px-2" : "py-2 px-3";

  // Group items by category
  const categoryGroups = useMemo<CategoryGroup[]>(() => {
    const groupMap = new Map<string, PoeItem[]>();
    for (const item of items) {
      const cat = item.category || "Other";
      if (!groupMap.has(cat)) groupMap.set(cat, []);
      groupMap.get(cat)!.push(item);
    }
    // Sort categories by item count descending
    const groups: CategoryGroup[] = [];
    for (const [name, catItems] of groupMap) {
      groups.push({
        name,
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
        items: catItems,
      });
    }
    groups.sort((a, b) => b.items.length - a.items.length);
    return groups;
  }, [items]);

  const toggleCategoryCollapse = useCallback((catName: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catName)) next.delete(catName);
      else next.add(catName);
      return next;
    });
  }, []);

  const columns = useMemo<ColumnDef<PoeItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <SortHeader column={column}>{t("item")}</SortHeader>
        ),
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className={`flex items-center gap-2 ${isCompact ? "gap-1" : ""}`}>
              <button
                className="shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(item.id);
                }}
                aria-label={isFavorite(item.id) ? t("removeFromFavorites") : t("addToFavorites")}
              >
                <Star
                  className={`${isCompact ? "h-3 w-3" : "h-3.5 w-3.5"} ${
                    isFavorite(item.id)
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground hover:text-yellow-400"
                  }`}
                  aria-hidden="true"
                />
              </button>
              {item.iconUrl ? (
                <img
                  src={item.iconUrl}
                  alt=""
                  className={`${isCompact ? "w-6 h-6" : "w-8 h-8"} object-contain`}
                />
              ) : (
                <Shield className={`${isCompact ? "w-6 h-6" : "w-8 h-8"} text-muted-foreground`} aria-hidden="true" />
              )}
              <div>
                <span className="font-medium">{item.name}</span>
                <span className="text-muted-foreground ml-1 text-xs">
                  {item.type}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "relativePrice",
        header: ({ column }) => (
          <SortHeader column={column} align="right">
            {t("price")}
          </SortHeader>
        ),
        cell: ({ row }) => (
          <span className={`font-mono ${isCompact ? "text-xs" : ""}`}>
            {formatPrice(row.original.relativePrice ?? row.original.priceChaos, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}
          </span>
        ),
      },
      {
        accessorKey: "changePercent",
        header: ({ column }) => (
          <SortHeader column={column} align="right">
            {t("change")}
          </SortHeader>
        ),
        cell: ({ row }) => {
          const chg = fmtChange(row.original.changePercent);
          return <span className={`font-mono ${chg.color} ${isCompact ? "text-xs" : ""}`}>{chg.text}</span>;
        },
      },
      {
        accessorKey: "sevenDayPriceChangePercent",
        header: ({ column }) => (
          <SortHeader column={column} align="right">
            {t("sevenDay")}
          </SortHeader>
        ),
        cell: ({ row }) => {
          const chg = fmtChange(row.original.sevenDayPriceChangePercent);
          return <span className={`font-mono ${chg.color} ${isCompact ? "text-xs" : ""}`}>{chg.text}</span>;
        },
      },
      {
        accessorKey: "volume",
        header: ({ column }) => (
          <SortHeader column={column} align="right">
            {t("volume")}
          </SortHeader>
        ),
        cell: ({ row }) => (
          <span className={`font-mono text-muted-foreground ${isCompact ? "text-xs" : ""}`}>
            {row.original.volume != null
              ? row.original.volume.toLocaleString()
              : "\u2014"}
          </span>
        ),
      },
      {
        id: "trend",
        header: t("trend"),
        cell: ({ row }) => {
          const item = row.original;
          const sparkData =
            item.history?.map((h) => h.relativePrice ?? h.priceChaos ?? 0) ||
            [];
          return (
            <Sparkline
              data={sparkData}
              color={
                item.changePercent && item.changePercent >= 0
                  ? "#34d399"
                  : "#f87171"
              }
              width={80}
              height={isCompact ? 16 : 20}
            />
          );
        },
        enableSorting: false,
      },
      {
        id: "compare",
        header: "",
        cell: ({ row }) => {
          const item = row.original;
          const inComp = isInComparison(item.id);
          return (
            <button
              className={`shrink-0 p-1 rounded transition-colors ${
                inComp
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-primary"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                if (inComp) removeFromComparison(item.id);
                else addToComparison(item.id);
              }}
              aria-label={inComp ? t("removeFromComparison") : t("addToComparison")}
            >
              <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          );
        },
        enableSorting: false,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isFavorite, toggleFavorite, isInComparison, addToComparison, removeFromComparison, t, density]
  );

  // Prefetch detail on row hover
  const handleRowMouseEnter = useCallback(
    (item: PoeItem) => {
      if (!realm || !league) return;
      queryClient.prefetchQuery({
        queryKey: ["itemHistory", realm, league, item.id, referenceCurrency],
        queryFn: () =>
          fetchApi<PoeItemHistoryPoint[]>("/api/poe2/items", {
            realm,
            league,
            action: "history",
            itemId: item.id,
            logCount: "168",
            referenceCurrency: referenceCurrency || "",
          }),
      });
    },
    [queryClient, realm, league, referenceCurrency]
  );

  return (
    <div className="space-y-2">
      {/* §2.2: Density toggle */}
      <div className="flex items-center justify-end gap-1" role="group" aria-label="Density toggle">
        <Button
          variant={density === "comfortable" ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs gap-1 px-2"
          onClick={() => setDensity("comfortable")}
          aria-pressed={density === "comfortable"}
          aria-label={t("comfortable") ?? "Comfortable"}
        >
          <List className="h-3.5 w-3.5" aria-hidden="true" />
          {t("comfortable") ?? "Comfortable"}
        </Button>
        <Button
          variant={density === "compact" ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs gap-1 px-2"
          onClick={() => setDensity("compact")}
          aria-pressed={density === "compact"}
          aria-label={t("compact") ?? "Compact"}
        >
          <Rows3 className="h-3.5 w-3.5" aria-hidden="true" />
          {t("compact") ?? "Compact"}
        </Button>
      </div>

      {/* Category groups */}
      {categoryGroups.map((group) => {
        const isCollapsed = collapsedCategories.has(group.name);
        const table = useReactTable({
          data: group.items,
          columns,
          state: { sorting },
          onSortingChange: setSorting,
          getCoreRowModel: getCoreRowModel(),
          getSortedRowModel: getSortedRowModel(),
        });
        const rows = table.getRowModel().rows;

        return (
          <div
            key={group.name}
            className="rounded-md border border-border overflow-hidden"
            role="region"
            aria-label={`${group.displayName} unique items`}
          >
            {/* §2.2: Collapsible category header */}
            <button
              className="w-full flex items-center gap-2 px-3 py-2 bg-muted/60 hover:bg-muted/80 transition-colors text-left"
              onClick={() => toggleCategoryCollapse(group.name)}
              aria-expanded={!isCollapsed}
              aria-controls={`category-${group.name}`}
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="font-medium text-sm">{group.displayName}</span>
              <Badge count={group.items.length} />
              <span className="text-xs text-muted-foreground">({group.items.length})</span>
            </button>

            {/* Table (hidden when collapsed) */}
            {!isCollapsed && (
              <div className="overflow-x-auto">
                <table className={`w-full ${fontSize}`} role="table" id={`category-${group.name}`}>
                  <thead className="sticky top-0 z-10">
                    {table.getHeaderGroups().map((headerGroup) => (
                      <tr
                        key={headerGroup.id}
                        className="border-b border-border bg-muted/80 backdrop-blur-sm"
                      >
                        {headerGroup.headers.map((header) => (
                          <th
                            key={header.id}
                            className={`${cellPadding} font-medium ${
                              header.column.getCanSort() ? "cursor-pointer select-none" : ""
                            } ${
                              header.id === "name"
                                ? "text-left sticky left-0 bg-muted/80 z-[5]"
                                : header.id === "trend"
                                ? "text-center w-[100px]"
                                : header.id === "compare"
                                ? "w-[40px]"
                                : "text-right"
                            }`}
                            onClick={header.column.getToggleSortingHandler()}
                            aria-sort={
                              header.column.getIsSorted() === "asc"
                                ? "ascending"
                                : header.column.getIsSorted() === "desc"
                                ? "descending"
                                : undefined
                            }
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                        style={{ height: `${rowHeight}px` }}
                        onClick={() => onItemClick(row.original)}
                        onMouseEnter={() => handleRowMouseEnter(row.original)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onItemClick(row.original);
                          }
                        }}
                        role="row"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className={`${cellPadding} ${
                              cell.column.id === "name"
                                ? "sticky left-0 bg-background z-[5]"
                                : cell.column.id === "trend"
                                ? "text-center"
                                : cell.column.id === "compare"
                                ? "text-center"
                                : "text-right"
                            }`}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Simple count badge */
function Badge({ count }: { count: number }) {
  return null; // Count is displayed inline next to category name
}

// Sortable column header
function SortHeader({
  column,
  children,
  align = "left",
}: {
  column: { getIsSorted: () => false | "asc" | "desc"; getCanSort: () => boolean; getToggleSortingHandler: () => ((e: unknown) => void) | undefined };
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const sorted = column.getIsSorted();
  return (
    <div
      className={`flex items-center gap-1 ${
        align === "right" ? "justify-end" : ""
      } ${column.getCanSort() ? "cursor-pointer select-none" : ""}`}
      onClick={column.getToggleSortingHandler()}
    >
      {children}
      {column.getCanSort() && (
        <span className="inline-flex" aria-hidden="true">
          {sorted === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : sorted === "desc" ? (
            <ArrowDown className="h-3.5 w-3.5" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
          )}
        </span>
      )}
    </div>
  );
}
