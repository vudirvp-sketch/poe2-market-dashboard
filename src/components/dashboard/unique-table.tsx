// ============================================================================
// Unique Items Table with sorting (@tanstack/react-table)
// ============================================================================
"use client";

import { useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import { Shield, Star, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Sparkline } from "./sparkline";
import { fmt, fmtChange } from "@/lib/types";
import type { PoeItem } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";

interface UniqueTableProps {
  items: PoeItem[];
  onItemClick: (item: PoeItem) => void;
}

export function UniqueTable({ items, onItemClick }: UniqueTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const { isFavorite, toggleFavorite } = useDashboardStore();

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
    ],
    [isFavorite, toggleFavorite]
  );

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

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
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={`py-2 px-3 ${
                      cell.column.id === "name"
                        ? ""
                        : cell.column.id === "trend"
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
