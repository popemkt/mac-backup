import { useCallback, useEffect, useRef, useState } from "react";
import Graph from "graphology";
import { nodePosition } from "./graph-attributes";
import Sigma from "sigma";
import { EdgeArrowProgram } from "sigma/rendering";
import type { LensEdge, LensNode, LensLayout } from "@/lib/graph-lens";
import { readTokenColor } from "@/lib/css-color";
import { graphNodeAlpha, withGraphAlpha } from "@/lib/graph-dim";
import { formatGraphLabel } from "@/lib/graph-label";
import { computeLayoutPositions } from "@/lib/graph-layouts";
import { asInstance } from "@/lib/dom";
import { createFA2Layout, type FA2Controller } from "./fa2-layout";
import { fitView } from "./graph-camera";
import { sigmaCameraControls, type GraphCameraControls } from "./graph-camera-controls";
import { selectionFromNode, type GraphSelection } from "./graph-selection";

export type { GraphSelection };

type CameraSnap = { x: number; y: number; angle: number; ratio: number };

export interface SigmaGraphProps {
  nodes: LensNode[];
  edges: LensEdge[];
  onNodeOpen: (id: string) => void;
  onSelectionChange?: (sel: GraphSelection | null) => void;
  /** Controlled selection id from the frame (null clears). */
  selectedNodeId?: string | null;
  /** Bump when a full remount is desired (perspective change). */
  layoutKey: string;
  /** Theme/rev signal so token colors refresh without topology churn. */
  themeKey: string;
  /** Persisted layout mode — non-force modes skip FA2. */
  layout?: LensLayout;
  /** External search highlight set. */
  highlightIds?: Set<string>;
  /** External filter dim set (ids to keep lit). */
  filterIds?: Set<string>;
  /** Register camera verbs with the shared frame. */
  onControlsReady?: (controls: GraphCameraControls | null) => void;
}

const LARGE_GRAPH_THRESHOLD = 1500;

const positionsCache = new Map<string, Map<string, { x: number; y: number }>>();

function topologyKey(nodes: LensNode[], edges: LensEdge[]): string {
  if (nodes.length > 200) return `${nodes.length}:${edges.length}`;
  const n = nodes
    .map((x) => x.id)
    .toSorted()
    .join(",");
  const e = edges
    .map((x) => `${x.kind}:${x.source}->${x.target}`)
    .toSorted()
    .join(",");
  return `${n}|${e}`;
}

export function SigmaGraph({
  nodes,
  edges,
  onNodeOpen,
  onSelectionChange,
  selectedNodeId = null,
  layoutKey,
  themeKey,
  layout = "force",
  highlightIds,
  filterIds,
  onControlsReady,
}: SigmaGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const layoutRef = useRef<FA2Controller | null>(null);
  const cameraRef = useRef<CameraSnap | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const topologyRef = useRef<string>("");
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(selectedNodeId);
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
  const onControlsReadyRef = useRef(onControlsReady);
  onControlsReadyRef.current = onControlsReady;

  const [selected, setSelected] = useState<string | null>(selectedNodeId);
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

    const activeNode = sel ?? hovered;
    const neighborSet = new Set<string>();
    if (activeNode !== null && graph.hasNode(activeNode)) {
      graph.forEachNeighbor(activeNode, (neighbor) => neighborSet.add(neighbor));
      neighborSet.add(activeNode);
    }

    sigma.setSetting("nodeReducer", (node, data) => {
      const filterMatch = !filter || filter.has(node);
      const searchMatch = !highlight || highlight.size === 0 || highlight.has(node);
      const focusMatch = activeNode === null || neighborSet.has(node);
      const alpha = graphNodeAlpha({
        includedByFilter: filterMatch,
        includedBySearch: searchMatch,
        includedByFocus: focusMatch,
      });
      const emphatic = alpha === 1;
      return {
        ...data,
        color: withGraphAlpha(String(data.color), alpha),
        label: emphatic ? formatGraphLabel(String(data.label), data.size) : "",
        forceLabel: emphatic && (!!filter || !!highlight),
        highlighted: emphatic,
        zIndex: emphatic ? 1 : 0,
        ...(activeNode === node ? { size: data.size * 1.3 } : {}),
      };
    });

    sigma.setSetting("edgeReducer", (edge, data) => {
      if (activeNode === null) return { ...data, hidden: false };
      const extremities = graph.extremities(edge);
      if (extremities.includes(activeNode)) {
        return { ...data, hidden: false, zIndex: 1 };
      }
      return { ...data, hidden: true };
    });

    sigma.refresh();
  }, [highlightIds, filterIds]);

  useEffect(() => {
    selectedRef.current = selectedNodeId;
    setSelected(selectedNodeId);
    refreshReducers();
  }, [selectedNodeId, refreshReducers]);

  // oxlint-disable-next-line complexity -- GAP [[01M1MGCPJTV66QSFCR44XG29YM]]
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    sigmaRef.current?.kill();
    sigmaRef.current = null;
    layoutRef.current?.kill();
    layoutRef.current = null;

    const graph = new Graph({ multi: true, type: "directed" });
    positionsRef.current = positionsCache.get(layoutKey) ?? positionsRef.current;
    const prevPositions = positionsRef.current;
    const nextPositions = new Map<string, { x: number; y: number }>();

    const assigned = computeLayoutPositions(layout, nodes, edges);
    for (const n of nodes) {
      const prior = prevPositions.get(n.id);
      const laid = assigned?.get(n.id);
      const x = laid?.x ?? prior?.x ?? Math.random() * 100;
      const y = laid?.y ?? prior?.y ?? Math.random() * 100;
      nextPositions.set(n.id, { x, y });
      graph.addNode(n.id, {
        label: n.label,
        color: n.color,
        size: n.size,
        x,
        y,
        ...(assigned ? { fixed: true } : {}),
      });
    }

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!;
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      try {
        graph.addEdgeWithKey(`${e.kind}:${e.source}->${e.target}:${i}`, e.source, e.target, {
          kind: e.kind,
          size: Math.max(1, Math.sqrt(e.weight)),
          forceLabel: false,
        });
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
    // Second adaptive tier: step label density down before the 1500-node edge hide.
    const isMedium = graph.order > 300;

    const sigma = new Sigma(graph, el, {
      allowInvalidContainer: true,
      renderLabels: true,
      labelFont: "Outfit Variable, ui-sans-serif, system-ui, sans-serif",
      labelSize: 12,
      labelColor: { color: labelColor },
      labelRenderedSizeThreshold: isLarge ? 12 : isMedium ? 9 : 7,
      labelDensity: isLarge ? 0.5 : isMedium ? 0.65 : 0.8,
      defaultEdgeColor: edgeColor,
      defaultEdgeType: "arrow",
      edgeProgramClasses: {
        arrow: EdgeArrowProgram,
      },
      stagePadding: 40,
      hideEdgesOnMove: isLarge,
      zIndex: true,
    });

    sigmaRef.current = sigma;
    onControlsReadyRef.current?.(sigmaCameraControls(() => sigmaRef.current));
    // Browser render harness only: display positions are internal to Sigma.
    if (import.meta.env.MODE === "test-render") {
      (el as HTMLDivElement & { __kbSigma?: Sigma }).__kbSigma = sigma;
    }

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
      if (dragRef.current?.dragging === true) return;
      const nativeEvent = asInstance(event.original, MouseEvent);
      if (nativeEvent?.metaKey === true || nativeEvent?.ctrlKey === true) {
        onOpenRef.current(node);
        return;
      }
      selectedRef.current = node;
      setSelected(node);
      const meta = nodes.find((n) => n.id === node);
      onSelRef.current?.(
        meta
          ? selectionFromNode(meta)
          : {
              nodeId: node,
              label: node,
              tags: [],
              degree: 0,
            },
      );
      refreshReducers();
    });

    sigma.on("clickStage", () => {
      if (dragRef.current?.dragging === true) return;
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
      const pos = sigma.graphToViewport(nodePosition(graph, node));
      dragRef.current = {
        node,
        dragging: false,
        startX: pos.x,
        startY: pos.y,
      };
      graph.setNodeAttribute(node, "fixed", true);
      sigma.getCamera().disable();
    });

    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = el.getBoundingClientRect();
      const viewX = e.clientX - rect.left;
      const viewY = e.clientY - rect.top;

      if (!drag.dragging && Math.hypot(viewX - drag.startX, viewY - drag.startY) > 3) {
        drag.dragging = true;
      }
      if (!drag.dragging) return;

      const pos = sigma.viewportToGraph({ x: viewX, y: viewY });
      graph.setNodeAttribute(drag.node, "x", pos.x);
      graph.setNodeAttribute(drag.node, "y", pos.y);
      nextPositions.set(drag.node, { x: pos.x, y: pos.y });
    };

    const onMouseUp = (event: MouseEvent) => {
      if (dragRef.current?.dragging === true) {
        layoutRef.current?.reheat(600);
      }
      if (dragRef.current && !event.altKey) {
        graph.removeNodeAttribute(dragRef.current.node, "fixed");
      }
      dragRef.current = null;
      sigma.getCamera().enable();
    };

    const onHoverMove = (e: MouseEvent) => {
      if (hoveredRef.current !== null) {
        const rect = el.getBoundingClientRect();
        setTooltip({
          id: hoveredRef.current,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mousemove", onHoverMove);
    document.addEventListener("mouseup", onMouseUp);

    // --- Layout ---
    if (graph.order > 0 && topologyChanged && layout === "force") {
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
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mousemove", onHoverMove);
      document.removeEventListener("mouseup", onMouseUp);
      try {
        cameraRef.current = sigma.getCamera().getState();
      } catch {
        // already dead
      }
      layoutRef.current?.kill();
      layoutRef.current = null;
      sigma.kill();
      delete (el as HTMLDivElement & { __kbSigma?: Sigma }).__kbSigma;
      if (sigmaRef.current === sigma) sigmaRef.current = null;
      onControlsReadyRef.current?.(null);
    };
  }, [nodes, edges, layoutKey, themeKey, layout]); // oxlint-disable-line react-hooks/exhaustive-deps -- the sigma lifecycle handlers read refreshReducers via mutable refs; refreshReducers is not a stable dep (it derives from highlightIds) and re-running this effect on its change would re-init sigma

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
      if (e.key === "Enter" && selectedRef.current !== null) {
        onOpenRef.current(selectedRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshReducers]);

  return (
    <div className="relative h-full w-full min-h-0">
      <div ref={containerRef} className="h-full w-full min-h-0" data-sigma-container="true" />
      {tooltip && selected === null && (
        <HoverTooltip nodeId={tooltip.id} nodes={nodes} x={tooltip.x} y={tooltip.y} />
      )}
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
      <span className="truncate text-[11px] font-medium text-foreground/80">{meta.label}</span>
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
