import { useCallback, useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { EdgeArrowProgram } from "sigma/rendering";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { readTokenColor } from "@/lib/css-color";
import { createFA2Layout, type FA2Controller } from "./fa2-layout";
import { fitView } from "./graph-camera";

type CameraSnap = { x: number; y: number; angle: number; ratio: number };

export interface GraphSelection {
  nodeId: string;
  label: string;
  tags: string[];
  degree: number;
}

export interface SigmaGraphProps {
  nodes: LensNode[];
  edges: LensEdge[];
  onNodeOpen: (id: string) => void;
  onSelectionChange?: (sel: GraphSelection | null) => void;
  /** Bump when a full remount is desired (perspective change). */
  layoutKey: string;
  /** Theme/rev signal so token colors refresh without topology churn. */
  themeKey: string;
  /** External search highlight set. */
  highlightIds?: Set<string>;
  /** External filter dim set (ids to keep lit). */
  filterIds?: Set<string>;
  /** Sigma instance ref for toolbar/keyboard to drive camera. */
  sigmaRef?: React.MutableRefObject<Sigma | null>;
}

const LARGE_GRAPH_THRESHOLD = 1500;

const positionsCache = new Map<string, Map<string, { x: number; y: number }>>();

function topologyKey(nodes: LensNode[], edges: LensEdge[]): string {
  if (nodes.length > 200) return `${nodes.length}:${edges.length}`;
  const n = nodes.map((x) => x.id).sort().join(",");
  const e = edges
    .map((x) => `${x.kind}:${x.source}->${x.target}`)
    .sort()
    .join(",");
  return `${n}|${e}`;
}

export function SigmaGraph({
  nodes,
  edges,
  onNodeOpen,
  onSelectionChange,
  layoutKey,
  themeKey,
  highlightIds,
  filterIds,
  sigmaRef: externalSigmaRef,
}: SigmaGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const layoutRef = useRef<FA2Controller | null>(null);
  const cameraRef = useRef<CameraSnap | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const topologyRef = useRef<string>("");
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const dragRef = useRef<{
    node: string;
    dragging: boolean;
    startX: number;
    startY: number;
  } | null>(null);
  const onOpenRef = useRef(onNodeOpen);
  onOpenRef.current = onNodeOpen;
  const onSelRef = useRef(onSelectionChange);
  onSelRef.current = onSelectionChange;

  const [selected, setSelected] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  const refreshReducers = useCallback(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const graph = graphRef.current;
    if (!graph) return;

    const hovered = hoveredRef.current;
    const sel = selectedRef.current;
    const highlight = highlightIds;
    const filter = filterIds;
    const isLarge = graph.order > LARGE_GRAPH_THRESHOLD;

    const activeNode = sel ?? hovered;
    const neighborSet = new Set<string>();
    if (activeNode && graph.hasNode(activeNode)) {
      graph.forEachNeighbor(activeNode, (neighbor) => neighborSet.add(neighbor));
      neighborSet.add(activeNode);
    }

    sigma.setSetting("nodeReducer", (node, data) => {
      if (filter && !filter.has(node)) {
        return { ...data, color: "#444444", label: "", zIndex: 0 };
      }
      if (highlight && highlight.size > 0) {
        if (!highlight.has(node)) {
          return { ...data, color: "#666666", label: "", zIndex: 0 };
        }
      }
      if (activeNode) {
        if (neighborSet.has(node)) {
          return {
            ...data,
            highlighted: true,
            zIndex: 1,
            ...(node === activeNode ? { size: data.size * 1.3 } : {}),
          };
        }
        return {
          ...data,
          color: isLarge ? "#333333" : "rgba(128,128,128,0.15)",
          label: "",
          zIndex: 0,
        };
      }
      return { ...data, highlighted: false };
    });

    sigma.setSetting("edgeReducer", (edge, data) => {
      if (!activeNode) return { ...data, hidden: false };
      const extremities = graph.extremities(edge);
      if (extremities.includes(activeNode)) {
        return { ...data, hidden: false, zIndex: 1 };
      }
      return { ...data, hidden: true };
    });

    sigma.refresh();
  }, [highlightIds, filterIds]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    sigmaRef.current?.kill();
    sigmaRef.current = null;
    layoutRef.current?.kill();
    layoutRef.current = null;

    const graph = new Graph({ multi: true, type: "directed" });
    positionsRef.current = positionsCache.get(layoutKey) ?? positionsRef.current;
    const prevPositions = positionsRef.current;
    const nextPositions = new Map<string, { x: number; y: number }>();

    for (const n of nodes) {
      const prior = prevPositions.get(n.id);
      const x = prior?.x ?? Math.random() * 100;
      const y = prior?.y ?? Math.random() * 100;
      nextPositions.set(n.id, { x, y });
      graph.addNode(n.id, {
        label: n.label,
        color: n.color,
        size: n.size,
        x,
        y,
      });
    }

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!;
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      try {
        graph.addEdgeWithKey(
          `${e.kind}:${e.source}->${e.target}:${i}`,
          e.source,
          e.target,
          {
            kind: e.kind,
            size: Math.max(1, Math.sqrt(e.weight)),
            forceLabel: false,
          },
        );
      } catch {
        // ignore duplicate keys
      }
    }

    const topo = topologyKey(nodes, edges);
    const topologyChanged = topo !== topologyRef.current;
    topologyRef.current = topo;
    graphRef.current = graph;

    const background = readTokenColor("--background", {
      fallback: "rgb(255, 255, 255)",
    });
    const labelColor = readTokenColor("--foreground", {
      fallback: "rgb(34, 34, 34)",
    });
    const edgeColor = readTokenColor("--foreground", {
      alpha: 0.18,
      fallback: "rgba(128, 128, 128, 0.18)",
    });

    el.style.background = background;

    const isLarge = graph.order > LARGE_GRAPH_THRESHOLD;

    const sigma = new Sigma(graph, el, {
      allowInvalidContainer: true,
      renderLabels: true,
      labelFont: "Outfit Variable, ui-sans-serif, system-ui, sans-serif",
      labelSize: 12,
      labelColor: { color: labelColor },
      labelRenderedSizeThreshold: isLarge ? 12 : 7,
      labelDensity: isLarge ? 0.5 : 0.8,
      defaultEdgeColor: edgeColor,
      defaultEdgeType: "arrow",
      edgeProgramClasses: {
        arrow: EdgeArrowProgram,
      },
      stagePadding: 40,
      hideEdgesOnMove: isLarge,
      zIndex: true,
    });

    if (externalSigmaRef) externalSigmaRef.current = sigma;
    sigmaRef.current = sigma;

    // --- Hover ---
    sigma.on("enterNode", ({ node }) => {
      hoveredRef.current = node;
      el.style.cursor = "pointer";
      refreshReducers();
      const display = sigma.getNodeDisplayData(node);
      if (display) {
        const vp = sigma.framedGraphToViewport({ x: display.x, y: display.y });
        setTooltip({ id: node, x: vp.x, y: vp.y });
      }
    });
    sigma.on("leaveNode", () => {
      hoveredRef.current = null;
      el.style.cursor = "default";
      setTooltip(null);
      refreshReducers();
    });

    // --- Selection ---
    sigma.on("clickNode", ({ node, event }) => {
      if (dragRef.current?.dragging) return;
      const nativeEvent = event.original as MouseEvent;
      if (nativeEvent.metaKey || nativeEvent.ctrlKey) {
        onOpenRef.current(node);
        return;
      }
      selectedRef.current = node;
      setSelected(node);
      const meta = nodes.find((n) => n.id === node);
      onSelRef.current?.(
        meta
          ? { nodeId: node, label: meta.label, tags: meta.tags, degree: meta.degree }
          : { nodeId: node, label: node, tags: [], degree: 0 },
      );
      refreshReducers();
    });

    sigma.on("clickStage", () => {
      if (dragRef.current?.dragging) return;
      selectedRef.current = null;
      setSelected(null);
      onSelRef.current?.(null);
      refreshReducers();
    });

    sigma.on("doubleClickNode", ({ node }) => {
      onOpenRef.current(node);
    });

    // --- Node drag ---
    sigma.on("downNode", ({ node }) => {
      const pos = sigma.graphToViewport(
        graph.getNodeAttributes(node) as { x: number; y: number },
      );
      dragRef.current = {
        node,
        dragging: false,
        startX: pos.x,
        startY: pos.y,
      };
      sigma.getCamera().disable();
    });

    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = el.getBoundingClientRect();
      const viewX = e.clientX - rect.left;
      const viewY = e.clientY - rect.top;

      if (
        !drag.dragging &&
        Math.hypot(viewX - drag.startX, viewY - drag.startY) > 3
      ) {
        drag.dragging = true;
      }
      if (!drag.dragging) return;

      const pos = sigma.viewportToGraph({ x: viewX, y: viewY });
      graph.setNodeAttribute(drag.node, "x", pos.x);
      graph.setNodeAttribute(drag.node, "y", pos.y);
      nextPositions.set(drag.node, { x: pos.x, y: pos.y });
    };

    const onMouseUp = () => {
      if (dragRef.current?.dragging) {
        layoutRef.current?.reheat(600);
      }
      dragRef.current = null;
      sigma.getCamera().enable();
    };

    const onHoverMove = (e: MouseEvent) => {
      if (hoveredRef.current) {
        const rect = el.getBoundingClientRect();
        setTooltip({
          id: hoveredRef.current,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    };

    el.addEventListener("mousemove", onMouseMove);
    el.addEventListener("mousemove", onHoverMove);
    el.addEventListener("mouseup", onMouseUp);
    el.addEventListener("mouseleave", onMouseUp);

    // --- Layout ---
    if (graph.order > 0 && topologyChanged) {
      const fa2 = createFA2Layout(graph, {
        onConverged() {
          graph.forEachNode((id, attrs) => {
            nextPositions.set(id, { x: Number(attrs.x), y: Number(attrs.y) });
          });
        positionsRef.current = nextPositions;
        positionsCache.set(layoutKey, nextPositions);
        sigma.refresh();
        fitView(sigma, 400);
        },
      });
      layoutRef.current = fa2;
      fa2.start();
    } else {
      positionsRef.current = nextPositions;
      positionsCache.set(layoutKey, nextPositions);
    }

    if (cameraRef.current && nodes.length > 0) {
      sigma.getCamera().setState(cameraRef.current);
    } else if (nodes.length > 0) {
      fitView(sigma, 400);
    }

    refreshReducers();

    return () => {
      el.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("mousemove", onHoverMove);
      el.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("mouseleave", onMouseUp);
      try {
        cameraRef.current = sigma.getCamera().getState() as CameraSnap;
      } catch {
        // already dead
      }
      layoutRef.current?.kill();
      layoutRef.current = null;
      sigma.kill();
      if (sigmaRef.current === sigma) sigmaRef.current = null;
      if (externalSigmaRef?.current === sigma) externalSigmaRef.current = null;
    };
  }, [nodes, edges, layoutKey, themeKey]);

  useEffect(() => {
    refreshReducers();
  }, [refreshReducers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        selectedRef.current = null;
        setSelected(null);
        onSelRef.current?.(null);
        refreshReducers();
      }
      if (e.key === "Enter" && selectedRef.current) {
        onOpenRef.current(selectedRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshReducers]);

  return (
    <div className="relative h-full w-full min-h-0">
      <div
        ref={containerRef}
        className="h-full w-full min-h-0"
        data-sigma-container="true"
      />
      {tooltip && !selected && (
        <HoverTooltip
          nodeId={tooltip.id}
          nodes={nodes}
          x={tooltip.x}
          y={tooltip.y}
        />
      )}
      {selected && (
        <SelectionCard
          nodeId={selected}
          nodes={nodes}
          onOpen={onNodeOpen}
          onClose={() => {
            selectedRef.current = null;
            setSelected(null);
            onSelRef.current?.(null);
            refreshReducers();
          }}
          onFocus={() => {
            const sigma = sigmaRef.current;
            if (sigma && selected) {
              import("./graph-camera").then(({ focusNode }) =>
                focusNode(sigma, selected),
              );
            }
          }}
        />
      )}
    </div>
  );
}

interface SelectionCardProps {
  nodeId: string;
  nodes: LensNode[];
  onOpen: (id: string) => void;
  onClose: () => void;
  onFocus: () => void;
}

function SelectionCard({ nodeId, nodes, onOpen, onClose, onFocus }: SelectionCardProps) {
  const meta = nodes.find((n) => n.id === nodeId);
  if (!meta) return null;

  return (
    <div className="absolute bottom-4 left-4 z-30 flex max-w-xs flex-col gap-1.5 rounded-lg border border-foreground/10 bg-popover/95 p-3 shadow-xl backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground/90 leading-tight">
          {meta.label}
        </span>
        <button
          type="button"
          className="shrink-0 text-[11px] text-foreground/40 hover:text-foreground/70"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      {meta.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {meta.tags.slice(0, 5).map((t) => (
            <span
              key={t}
              className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-foreground/60"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <span className="text-[11px] text-foreground/40">
        {meta.degree} connection{meta.degree !== 1 ? "s" : ""}
      </span>
      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          className="rounded-md bg-foreground/[0.06] px-2.5 py-1 text-[11px] font-medium text-foreground/70 transition-colors hover:bg-foreground/[0.1] hover:text-foreground/90"
          onClick={() => onOpen(nodeId)}
        >
          Open
        </button>
        <button
          type="button"
          className="rounded-md px-2.5 py-1 text-[11px] font-medium text-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/70"
          onClick={onFocus}
        >
          Focus (f)
        </button>
      </div>
    </div>
  );
}


interface HoverTooltipProps {
  nodeId: string;
  nodes: LensNode[];
  x: number;
  y: number;
}

function HoverTooltip({ nodeId, nodes, x, y }: HoverTooltipProps) {
  const meta = nodes.find((n) => n.id === nodeId);
  if (!meta) return null;

  return (
    <div
      className="pointer-events-none absolute z-40 flex flex-col gap-0.5 rounded-md border border-foreground/10 bg-popover/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
      style={{ left: x + 12, top: y - 8, maxWidth: 220 }}
    >
      <span className="truncate text-[11px] font-medium text-foreground/80">
        {meta.label}
      </span>
      {meta.tags.length > 0 && (
        <span className="truncate text-[10px] text-foreground/50">
          {meta.tags.slice(0, 3).join(", ")}
        </span>
      )}
      <span className="text-[10px] text-foreground/40">
        {meta.degree} connection{meta.degree !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
