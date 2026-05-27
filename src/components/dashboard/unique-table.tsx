// ============================================================================
// Unique Items Table with sorting + Compare button + Prefetch on hover
// ============================================================================
"use client";

import { useMemo, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useState, memo } from "react";
import { Shield, Star, ArrowUpDown, ArrowUp, ArrowDown, GitCompare } from "lucide-react";
import { Sparkline } from "./sparkline";
import { fmt, fmtChange, fetchApi } from "@/lib/types";
import type { PoeItem, PoeItemHistoryPoint } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { useQueryClient } from "@tanstack/react-query";

interface UniqueTableProps {
  items: PoeItem[];
  onItemClick: (item: PoeItem) => void;
  realm?: string;
  league?: string;
  referenceCurrency?: string;
}

export function UniqueTable({ items, onItemClick, realm, league, referenceCurrency }: UniqueTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const { isFavorite, toggleFavorite, isInComparison, addToComparison, removeFromComparison } =
    useDashboardStore();
  const queryClient = useQueryClient();

  const columns = useMemo<ColumnDef<PoeItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <SortHeader column={column}>Item</SortHeader>
        ),
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex items-center gap-2">
              <button
                className="shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(item.id);
                }}
              >
                <Star
                  className={`h-3.5 w-3.5 ${
                    isFavorite(item.id)
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground hover:text-yellow-400"
                  }`}
                />
              </button>
              {item.iconUrl ? (
                <img
                  src={item.iconUrl}
                  alt=""
                  className="w-6 h-6 object-contain"
                />
              ) : (
                <Shield className="w-6 h-6 text-muted-foreground" />
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
            Price
          </SortHeader>
        ),
        cell: ({ row }) => (
          <span className="font-mono">
            {fmt(row.original.relativePrice ?? row.original.priceChaos)}
          </span>
        ),
      },
      {
        accessorKey: "changePercent",
        header: ({ column }) => (
          <SortHeader column={column} align="right">
            Change
          </SortHeader>
        ),
        cell: ({ row }) => {
          const chg = fmtChange(row.original.changePercent);
          return <span className={`font-mono ${chg.color}`}>{chg.text}</span>;
        },
      },
      {
        accessorKey: "sevenDayPriceChangePercent",
        header: ({ column }) => (
          <SortHeader column={column} align="right">
            7d
          </SortHeader>
        ),
        cell: ({ row }) => {
          const chg = fmtChange(row.original.sevenDayPriceChangePercent);
          return <span className={`font-mono ${chg.color}`}>{chg.text}</span>;
        },
      },
      {
        accessorKey: "volume",
        header: ({ column }) => (
          <SortHeader column={column} align="right">
            Volume
          </SortHeader>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-muted-foreground">
            {row.original.volume != null
              ? row.original.volume.toLocaleString()
              : "—"}
          </span>
        ),
      },
      {
        id: "trend",
        header: "Trend",
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
              height={20}
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
              title={inComp ? "Remove from comparison" : "Add to comparison"}
            >
              <GitCompare className="h-3.5 w-3.5" />
            </button>
          );
        },
        enableSorting: false,
      },
    ],
    [isFavorite, toggleFavorite, isInComparison, addToComparison, removeFromComparison]
  );

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

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
    <div className="rounded-md border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="border-b border-border bg-muted/30"
              >
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={`py-2 px-3 font-medium ${
                      header.column.getCanSort() ? "cursor-pointer select-none" : ""
                    } ${
                      header.id === "name"
                        ? "text-left"
                        : header.id === "trend"
                        ? "text-center w-[100px]"
                        : header.id === "compare"
                        ? "w-[40px]"
                        : "text-right"
                    }`}
                    onClick={header.column.getToggleSortingHandler()}
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
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                onClick={() => onItemClick(row.original)}
                onMouseEnter={() => handleRowMouseEnter(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={`py-2 px-3 ${
                      cell.column.id === "name"
                        ? ""
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
    </div>
  );
}

// Sortable column header
function SortHeader({
  column,
  children,
  align = "left",
}: {
  column: { getIsSorted: () => false | "asc" | "desc"; getCanSort: () => boolean; getToggleSortingHandler: () => (e: unknown) => void };
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
        <span className="inline-flex">
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
