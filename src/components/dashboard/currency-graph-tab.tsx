// ============================================================================
// Currency Graph Tab — Network visualization of currency trade pairs.
//
// Reference: frontend/components/graph_tab.py (Streamlit)
// Data: GET /api/flipper/prices + GET /api/flipper/triangular
//
// Uses D3-force for layout (via dynamic import for SSR bypass).
// Nodes = currencies, edges = trade pairs.
// Cycle highlighting for triangular arbitrage paths.
// ============================================================================
"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Network,
  AlertTriangle,
  RefreshCw,
  Circle,
  Server,
  Info,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { fetchApi, fmt } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PriceRate {
  pair: string;
  currency_from: string;
  currency_to: string;
  raw_rate: number;
  volume_traded: number;
  fee_fraction: number;
  gold_fee_actual: number;
  volatility: number;
  momentum: number;
}

interface PricesResponse {
  league: string;
  phase: string;
  rates: PriceRate[];
  gold_to_chaos_rate: number;
  base_currency: string;
  fetched_at: string;
}

interface TriangularCycle {
  cycle: string[];
  net_profit_pct: number;
  step_rates: number[];
  step_fees_fraction: number[];
}

interface TriangularResponse {
  cycles: TriangularCycle[];
  total: number;
}

interface CurrencyMetadata {
  api_id: string;
  text: string;
  icon_url: string | null;
}

interface CurrenciesResponse {
  currencies: CurrencyMetadata[];
}

interface HealthResponse {
  status: string;
  timestamp: string;
  league?: string;
  active_events?: number;
}

// Graph node/edge internal types
interface GraphNode {
  id: string;
  label: string;
  volume: number;
  degree: number;
  cluster: string;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
  iconUrl?: string | null;
}

interface GraphEdge {
  source: string;
  target: string;
  rawRate: number;
  effectiveRate: number;
  volume: number;
  feeFraction: number;
  isCycleEdge: boolean;
}

interface CurrencyDetail {
  id: string;
  label: string;
  volume: number;
  degree: number;
  cluster: string;
  iconUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MIN_NODE_SIZE = 12;
const MAX_NODE_SIZE = 36;
const MIN_EDGE_WIDTH = 1;
const MAX_EDGE_WIDTH = 5;

const CLUSTER_COLORS: Record<string, string> = {
  stable: "#22c55e",
  moderate: "#3b82f6",
  volatile_illiquid: "#ef4444",
};

// ---------------------------------------------------------------------------
// Simple force-directed layout (no D3 dependency)
// We implement a basic spring-electric model to avoid needing d3-force
// as a runtime dependency, which simplifies bundling and SSR handling.
// ---------------------------------------------------------------------------

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function runForceLayout(
  nodes: SimNode[],
  edges: { source: string; target: string }[],
  width: number,
  height: number,
  iterations: number = 150,
): Map<string, { x: number; y: number }> {
  const nodeMap = new Map<string, SimNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  // Initialize positions randomly within the canvas
  for (const n of nodes) {
    n.x = width * 0.1 + Math.random() * width * 0.8;
    n.y = height * 0.1 + Math.random() * height * 0.8;
    n.vx = 0;
    n.vy = 0;
  }

  const repulsion = 3000;
  const attraction = 0.005;
  const damping = 0.85;
  const centerForce = 0.01;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const force = repulsion / distSq;
        const dist = Math.sqrt(distSq);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(Math.max(dx * dx + dy * dy, 1));
      const force = attraction * dist;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Center gravity
    const cx = width / 2;
    const cy = height / 2;
    for (const n of nodes) {
      n.vx += (cx - n.x) * centerForce;
      n.vy += (cy - n.y) * centerForce;
    }

    // Apply velocities with damping
    for (const n of nodes) {
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;
      // Keep within bounds
      n.x = Math.max(40, Math.min(width - 40, n.x));
      n.y = Math.max(40, Math.min(height - 40, n.y));
    }
  }

  const result = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    result.set(n.id, { x: n.x, y: n.y });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CurrencyGraphTab() {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ width: 900, height: 600 });
  const [selectedNode, setSelectedNode] = useState<CurrencyDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [focusCurrency, setFocusCurrency] = useState<string>("all");
  const [zoom, setZoom] = useState(1);

  // ---- Backend health check ----
  const { data: healthData, isError: healthError } = useQuery<HealthResponse>({
    queryKey: ["flipper-health-graph"],
    queryFn: () => fetchApi<HealthResponse>("/api/flipper/health"),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  const backendOnline = !healthError && healthData?.status === "ok";

  // ---- Fetch prices ----
  const {
    data: pricesData,
    isLoading: pricesLoading,
    isError: pricesError,
    refetch: refetchPrices,
  } = useQuery<PricesResponse>({
    queryKey: ["flipper-prices-graph"],
    queryFn: () => fetchApi<PricesResponse>("/api/flipper/prices"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Fetch triangular cycles ----
  const { data: triangularData } = useQuery<TriangularResponse>({
    queryKey: ["flipper-triangular-graph"],
    queryFn: () => fetchApi<TriangularResponse>("/api/flipper/triangular"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Fetch currency metadata ----
  const { data: currenciesData } = useQuery<CurrenciesResponse>({
    queryKey: ["flipper-currencies-graph"],
    queryFn: () => fetchApi<CurrenciesResponse>("/api/flipper/currencies"),
    enabled: backendOnline,
    staleTime: 120_000,
    retry: 1,
  });

  // ---- Build icon URL lookup ----
  const iconLookup = useMemo(() => {
    const map = new Map<string, string | null>();
    if (currenciesData?.currencies) {
      for (const c of currenciesData.currencies) {
        map.set(c.api_id, c.icon_url);
      }
    }
    return map;
  }, [currenciesData]);

  // ---- Compute cycle edges for highlighting ----
  const cycleEdges = useMemo(() => {
    const edges = new Set<string>();
    if (triangularData?.cycles) {
      for (const cycle of triangularData.cycles) {
        for (let i = 0; i < cycle.cycle.length - 1; i++) {
          edges.add(`${cycle.cycle[i]}->${cycle.cycle[i + 1]}`);
        }
      }
    }
    return edges;
  }, [triangularData]);

  // ---- Build graph data ----
  const graphData = useMemo(() => {
    if (!pricesData?.rates) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };

    const currencyVolumes = new Map<string, number>();
    const currencyDegree = new Map<string, number>();

    // Accumulate volume and degree per currency
    for (const rate of pricesData.rates) {
      if (!rate.currency_from || !rate.currency_to || rate.raw_rate <= 0) continue;
      currencyVolumes.set(rate.currency_from, (currencyVolumes.get(rate.currency_from) ?? 0) + rate.volume_traded);
      currencyVolumes.set(rate.currency_to, (currencyVolumes.get(rate.currency_to) ?? 0) + rate.volume_traded);
      currencyDegree.set(rate.currency_from, (currencyDegree.get(rate.currency_from) ?? 0) + 1);
      currencyDegree.set(rate.currency_to, (currencyDegree.get(rate.currency_to) ?? 0) + 1);
    }

    const nodes: GraphNode[] = [];
    const maxVol = Math.max(...Array.from(currencyVolumes.values()), 1);

    for (const [id, vol] of currencyVolumes) {
      const normalized = vol / maxVol;
      const size = MIN_NODE_SIZE + normalized * (MAX_NODE_SIZE - MIN_NODE_SIZE);
      nodes.push({
        id,
        label: id,
        volume: vol,
        degree: currencyDegree.get(id) ?? 0,
        cluster: "moderate", // default, clustering info not available from prices endpoint
        x: 0,
        y: 0,
        iconUrl: iconLookup.get(id) ?? null,
        // Store size for rendering
        ...( { _size: size } as Record<string, unknown> ),
      });
    }

    const edges: GraphEdge[] = [];
    for (const rate of pricesData.rates) {
      if (!rate.currency_from || !rate.currency_to || rate.raw_rate <= 0) continue;
      const effectiveRate = rate.raw_rate * (1 - rate.fee_fraction);
      const isCycleEdge = cycleEdges.has(`${rate.currency_from}->${rate.currency_to}`);
      edges.push({
        source: rate.currency_from,
        target: rate.currency_to,
        rawRate: rate.raw_rate,
        effectiveRate,
        volume: rate.volume_traded,
        feeFraction: rate.fee_fraction,
        isCycleEdge,
      });
    }

    return { nodes, edges };
  }, [pricesData, cycleEdges, iconLookup]);

  // ---- Focus filter ----
  const filteredGraphData = useMemo(() => {
    if (focusCurrency === "all") return graphData;

    // Find the node and its neighbors
    const neighbors = new Set<string>();
    neighbors.add(focusCurrency);
    for (const edge of graphData.edges) {
      if (edge.source === focusCurrency) neighbors.add(edge.target);
      if (edge.target === focusCurrency) neighbors.add(edge.source);
    }

    const MAX_DISPLAY = 30;
    let selectedIds = neighbors;
    if (neighbors.size > MAX_DISPLAY) {
      // Keep the most connected
      const degrees = new Map<string, number>();
      for (const id of neighbors) {
        degrees.set(id, graphData.nodes.find((n) => n.id === id)?.degree ?? 0);
      }
      const sorted = [...neighbors].sort((a, b) => (degrees.get(b) ?? 0) - (degrees.get(a) ?? 0));
      selectedIds = new Set(sorted.slice(0, MAX_DISPLAY));
    }

    return {
      nodes: graphData.nodes.filter((n) => selectedIds.has(n.id)),
      edges: graphData.edges.filter(
        (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
      ),
    };
  }, [graphData, focusCurrency]);

  // ---- Run force layout ----
  const layoutPositions = useMemo(() => {
    if (filteredGraphData.nodes.length === 0) return new Map<string, { x: number; y: number }>();
    if (filteredGraphData.nodes.length === 1) {
      const pos = new Map<string, { x: number; y: number }>();
      pos.set(filteredGraphData.nodes[0].id, { x: svgSize.width / 2, y: svgSize.height / 2 });
      return pos;
    }

    const simNodes: SimNode[] = filteredGraphData.nodes.map((n) => ({
      id: n.id,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    }));

    const simEdges = filteredGraphData.edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    return runForceLayout(simNodes, simEdges, svgSize.width, svgSize.height, 200);
  }, [filteredGraphData, svgSize]);

  // ---- Resize observer ----
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setSvgSize({ width: Math.max(width, 400), height: Math.max(Math.min(width * 0.66, 600), 400) });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // ---- Node click handler ----
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const gNode = filteredGraphData.nodes.find((n) => n.id === nodeId);
      if (!gNode) return;
      setSelectedNode({
        id: gNode.id,
        label: gNode.label,
        volume: gNode.volume,
        degree: gNode.degree,
        cluster: gNode.cluster,
        iconUrl: gNode.iconUrl,
      });
      setDetailOpen(true);
    },
    [filteredGraphData],
  );

  // ---- Compute node sizes ----
  const nodeSizes = useMemo(() => {
    const maxVol = Math.max(...filteredGraphData.nodes.map((n) => n.volume), 1);
    const sizes = new Map<string, number>();
    for (const n of filteredGraphData.nodes) {
      const normalized = n.volume / maxVol;
      sizes.set(n.id, MIN_NODE_SIZE + normalized * (MAX_NODE_SIZE - MIN_NODE_SIZE));
    }
    return sizes;
  }, [filteredGraphData]);

  // ---- Edge width computation ----
  const maxEdgeVolume = useMemo(
    () => Math.max(...filteredGraphData.edges.map((e) => e.volume), 1),
    [filteredGraphData],
  );

  // ---- Graph statistics ----
  const graphStats = useMemo(() => {
    const nodeCount = filteredGraphData.nodes.length;
    const edgeCount = filteredGraphData.edges.length;
    const density = nodeCount > 1 ? (2 * edgeCount) / (nodeCount * (nodeCount - 1)) : 0;
    const cycleCount = triangularData?.cycles?.length ?? 0;
    return { nodeCount, edgeCount, density, cycleCount };
  }, [filteredGraphData, triangularData]);

  // ---- Sorted node list for focus selector ----
  const sortedNodeIds = useMemo(
    () => [...filteredGraphData.nodes.map((n) => n.id)].sort(),
    [filteredGraphData],
  );

  // ---- Loading ----
  if (pricesLoading && backendOnline) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Backend status + Refresh ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Circle
            className={`h-2.5 w-2.5 ${
              backendOnline
                ? "fill-emerald-500 text-emerald-500"
                : "fill-red-500 text-red-500"
            }`}
            aria-hidden="true"
          />
          <Server className="h-3 w-3" aria-hidden="true" />
          {backendOnline
            ? t("flipperBackendOnline")
            : t("flipperBackendOffline")}
        </div>

        {backendOnline && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => refetchPrices()}
            aria-label={t("refreshData")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* ---- Backend unavailable ---- */}
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

      {backendOnline && (
        <>
          {/* ---- Error state ---- */}
          {pricesError && (
            <Card className="border-red-500/30 bg-red-500/5">
              <CardContent className="text-center py-10">
                <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="font-medium">{t("graphNoData")}</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  {t("graphNoDataDesc")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* ---- Graph statistics ---- */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {t("graphCurrencies")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-2xl font-bold">{graphStats.nodeCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {t("graphTradePairs")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-2xl font-bold">{graphStats.edgeCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {t("graphDensity")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-2xl font-bold">{graphStats.density.toFixed(3)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {t("graphArbCycles")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-2xl font-bold">{graphStats.cycleCount}</p>
              </CardContent>
            </Card>
          </div>

          {/* ---- Focus selector + zoom controls ---- */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="graph-focus">
                {t("graphFocusOn")}:
              </label>
              <Select value={focusCurrency} onValueChange={setFocusCurrency}>
                <SelectTrigger id="graph-focus" className="w-[180px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("graphAllCurrencies")}</SelectItem>
                  {sortedNodeIds.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1 ml-auto">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}
                aria-label={t("graphZoomOut")}
              >
                <ZoomOut className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="text-xs text-muted-foreground w-12 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
                aria-label={t("graphZoomIn")}
              >
                <ZoomIn className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setZoom(1)}
                aria-label={t("graphResetZoom")}
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          {/* ---- SVG Graph ---- */}
          <Card>
            <CardContent className="p-2" ref={containerRef}>
              {filteredGraphData.nodes.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                  <Network className="h-12 w-12 mx-auto mb-3 opacity-50" aria-hidden="true" />
                  <p>{t("graphNoNodes")}</p>
                </div>
              ) : (
                <svg
                  ref={svgRef}
                  width="100%"
                  viewBox={`0 0 ${svgSize.width} ${svgSize.height}`}
                  className="border border-border rounded-lg bg-background"
                  role="img"
                  aria-label={t("graphAriaLabel")}
                  style={{ maxHeight: "600px" }}
                >
                  <g transform={`scale(${zoom}) translate(${(svgSize.width * (1 - zoom)) / 2 / zoom}, ${(svgSize.height * (1 - zoom)) / 2 / zoom})`}>
                    {/* Edges */}
                    {filteredGraphData.edges.map((edge, idx) => {
                      const src = layoutPositions.get(edge.source);
                      const tgt = layoutPositions.get(edge.target);
                      if (!src || !tgt) return null;

                      const edgeWidth = MIN_EDGE_WIDTH + (edge.volume / Math.max(maxEdgeVolume, 1)) * (MAX_EDGE_WIDTH - MIN_EDGE_WIDTH);
                      const color = edge.isCycleEdge ? "#22c55e" : "#475569";
                      const width = edge.isCycleEdge ? Math.max(edgeWidth, 3) : edgeWidth;

                      return (
                        <line
                          key={`edge-${idx}`}
                          x1={src.x}
                          y1={src.y}
                          x2={tgt.x}
                          y2={tgt.y}
                          stroke={color}
                          strokeWidth={width}
                          opacity={edge.isCycleEdge ? 0.9 : 0.4}
                        >
                          <title>
                            {edge.source} → {edge.target}
                            {"\n"}Rate: {fmt(edge.rawRate)}
                            {"\n"}Effective: {fmt(edge.effectiveRate)}
                            {"\n"}Fee: {(edge.feeFraction * 100).toFixed(2)}%
                            {"\n"}Volume: {edge.volume.toLocaleString()}
                            {edge.isCycleEdge ? "\n🔄 ARB CYCLE" : ""}
                          </title>
                        </line>
                      );
                    })}

                    {/* Cycle annotations */}
                    {triangularData?.cycles?.slice(0, 5).map((cycle, idx) => {
                      const cycleNodesInGraph = cycle.cycle.filter(
                        (id) => layoutPositions.has(id),
                      );
                      if (cycleNodesInGraph.length < 2) return null;

                      const avgX =
                        cycleNodesInGraph.reduce((sum, id) => sum + (layoutPositions.get(id)?.x ?? 0), 0) /
                        cycleNodesInGraph.length;
                      const avgY =
                        cycleNodesInGraph.reduce((sum, id) => sum + (layoutPositions.get(id)?.y ?? 0), 0) /
                        cycleNodesInGraph.length;

                      return (
                        <g key={`cycle-label-${idx}`}>
                          <rect
                            x={avgX - 30}
                            y={avgY - 10}
                            width={60}
                            height={16}
                            rx={3}
                            fill="rgba(15, 23, 42, 0.8)"
                            stroke="#22c55e"
                            strokeWidth={0.5}
                          />
                          <text
                            x={avgX}
                            y={avgY + 2}
                            textAnchor="middle"
                            fill="#22c55e"
                            fontSize={8}
                            fontFamily="monospace"
                          >
                            Arb: +{cycle.net_profit_pct.toFixed(1)}%
                          </text>
                        </g>
                      );
                    })}

                    {/* Nodes */}
                    {filteredGraphData.nodes.map((node) => {
                      const pos = layoutPositions.get(node.id);
                      if (!pos) return null;
                      const size = nodeSizes.get(node.id) ?? MIN_NODE_SIZE;
                      const color = CLUSTER_COLORS[node.cluster] ?? "#94a3b8";

                      return (
                        <g
                          key={node.id}
                          className="cursor-pointer"
                          onClick={() => handleNodeClick(node.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleNodeClick(node.id);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-label={`${node.label}: volume ${node.volume.toLocaleString()}, ${node.degree} connections`}
                        >
                          <circle
                            cx={pos.x}
                            cy={pos.y}
                            r={size / 2}
                            fill={color}
                            stroke="#1e293b"
                            strokeWidth={2}
                            opacity={0.9}
                          />
                          <text
                            x={pos.x}
                            y={pos.y - size / 2 - 4}
                            textAnchor="middle"
                            fill="var(--foreground)"
                            fontSize={9}
                            fontFamily="sans-serif"
                          >
                            {node.label}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              )}
            </CardContent>
          </Card>

          {/* ---- Cluster legend ---- */}
          <div className="flex flex-wrap gap-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ backgroundColor: CLUSTER_COLORS.stable }}
              />
              <span>{t("graphLegendStable")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ backgroundColor: CLUSTER_COLORS.moderate }}
              />
              <span>{t("graphLegendModerate")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ backgroundColor: CLUSTER_COLORS.volatile_illiquid }}
              />
              <span>{t("graphLegendVolatile")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-0.5 bg-emerald-500" />
              <span>{t("graphLegendArbCycle")}</span>
            </div>
          </div>

          {/* ---- Detected Arbitrage Cycles ---- */}
          {triangularData?.cycles && triangularData.cycles.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Network className="h-4 w-4" aria-hidden="true" />
                  {t("graphDetectedCycles")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0 space-y-2">
                {triangularData.cycles.slice(0, 5).map((cycle, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg border border-border/50 hover:bg-muted/20 transition-colors"
                  >
                    <Badge
                      variant="outline"
                      className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-xs font-semibold shrink-0"
                    >
                      +{cycle.net_profit_pct.toFixed(2)}%
                    </Badge>
                    <span className="text-sm font-mono truncate">
                      {cycle.cycle.join(" → ")}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ---- Currency Detail Dialog ---- */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" aria-hidden="true" />
              {t("graphNodeDetail", { "0": selectedNode?.label ?? "" })}
            </DialogTitle>
          </DialogHeader>

          {selectedNode && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("graphNodeVolume")}</p>
                  <p className="text-lg font-bold font-mono">
                    {selectedNode.volume.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("graphNodeConnections")}</p>
                  <p className="text-lg font-bold font-mono">
                    {selectedNode.degree}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("graphNodeCluster")}</p>
                <Badge
                  variant="outline"
                  className={`mt-1 text-xs font-semibold ${
                    selectedNode.cluster === "stable"
                      ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                      : selectedNode.cluster === "volatile_illiquid"
                        ? "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                        : "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                  }`}
                >
                  {selectedNode.cluster === "volatile_illiquid"
                    ? t("flipsClusterVolatile")
                    : selectedNode.cluster === "stable"
                      ? t("flipsClusterStable")
                      : t("flipsClusterModerate")}
                </Badge>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
