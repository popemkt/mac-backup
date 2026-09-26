import type { Appearance } from "@/stores/prefs.store";
import { asInstance } from "@/lib/dom";
import { useCallback, useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { EdgeCurvedArrowProgram } from "@sigma/edge-curve";
import { createNodeBorderProgram } from "@sigma/node-border";
import type { LensEdge, LensNode, LensLayout, LensLabelDensity } from "@/lib/graph-lens";
import { readTokenColor } from "@/lib/css-color";
import { graphLabelFont } from "@/lib/graph-label";
import type { GraphLabelBox } from "@/lib/graph-label-layout";
import { prefersReducedMotion } from "@/lib/motion";
import { readTiming } from "@/lib/timing";
import { graphEmphasisAlpha, graphNeighborhood, type GraphEmphasis } from "@/lib/graph-interaction";
import { computeLayoutPositions } from "@/lib/graph-layouts";
import { createFA2Layout, type FA2Controller } from "./fa2-layout";
import { fitView } from "./graph-camera";
import { sigmaCameraControls, type GraphCameraControls } from "./graph-camera-controls";
import { selectionFromNode, type GraphSelection } from "./graph-selection";
import { drawGraphLabel, drawGraphHover, resetGraphLabels, setGraphLabelInk } from "./sigma-labels";
import { clusterHulls } from "./cluster-hulls";
import { GraphTooltip } from "./graph-tooltip";
import { sigmaEmphasis, type SigmaEmphasis } from "./sigma-emphasis";
export type { GraphSelection };

export interface SigmaGraphProps extends GraphEmphasis {
  nodes: LensNode[];
  edges: LensEdge[];
  onNodeOpen: (id: string) => void;
  onSelectionChange?: (sel: GraphSelection | null) => void;
  layoutKey: string;
  appearance: Appearance;
  layout?: LensLayout;
  cluster?: boolean;
  showLabels?: boolean;
  labelDensity?: LensLabelDensity;
  onControlsReady?: (controls: GraphCameraControls | null) => void;
}

/**
 * Nodes are drawn with a ring: the ground colour at rest, so a node reads
 * clean against the links and neighbours behind it, and the ink for the node
 * in focus. `sigma-emphasis` picks the ring colour per node.
 */
const NodeRingProgram = createNodeBorderProgram({
  borders: [
    { size: { value: 0.16 }, color: { attribute: "ringColor" } },
    { size: { fill: true }, color: { attribute: "color" } },
  ],
  drawLabel: drawGraphLabel,
  drawHover: drawGraphHover,
});

/** Drawn nodes at least this big (CSS px radius) keep labels off themselves. */
const MIN_BLOCKING_RADIUS = 3;
/** Above this many nodes, label density thins with the square root of the count. */
const LABEL_CROWD = 400;

/** A single Sigma lifecycle owns both force and cluster interaction. */
export function SigmaGraph(props: SigmaGraphProps) {
  const {
    nodes,
    edges,
    layoutKey,
    appearance,
    layout = "force",
    cluster = false,
    selectedNodeId,
    highlightIds,
    filterIds,
    showLabels = true,
    labelDensity = "medium",
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const hullRef = useRef<HTMLCanvasElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const layoutRef = useRef<FA2Controller | null>(null);
  const live = useRef(props);
  live.current = props;
  const hovered = useRef<string | null>(null);
  const cameraIntent = useRef(false);
  const topology = useRef("");
  const [isolated, setIsolated] = useState<string | null>(null);
  const isolatedRef = useRef(isolated);
  isolatedRef.current = isolated;
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null);

  const emphasis = useRef<SigmaEmphasis | null>(null);
  const refresh = useCallback(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const state = live.current;
    const active = state.selectedNodeId ?? hovered.current;
    const neighborhood = graphNeighborhood(active, state.edges);
    const graph = sigma.getGraph();
    emphasis.current?.retarget({
      active,
      narrowed:
        active !== null || state.highlightIds !== undefined || state.filterIds !== undefined,
      presence: (id) => {
        const a = graphEmphasisAlpha(id, state, neighborhood);
        return isolatedRef.current !== null &&
          graph.getNodeAttribute(id, "clusterKey") !== isolatedRef.current
          ? a * 0.2
          : a;
      },
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const graph = new Graph({ multi: true, type: "directed" });
    const sigma = new Sigma(graph, el, {
      allowInvalidContainer: true,
      labelFont: graphLabelFont(),
      labelSize: 12,
      labelRenderedSizeThreshold: 0,
      labelDensity: 0.7,
      defaultDrawNodeLabel: drawGraphLabel,
      defaultDrawNodeHover: drawGraphHover,
      defaultNodeType: "ring",
      nodeProgramClasses: { ring: NodeRingProgram },
      defaultEdgeType: "arrow",
      edgeProgramClasses: { arrow: EdgeCurvedArrowProgram },
      stagePadding: 70,
      zIndex: true,
    });
    sigmaRef.current = sigma;
    emphasis.current = sigmaEmphasis(sigma, readTiming(), prefersReducedMotion);
    // The drawn nodes' boxes are what labels must not cover. They are sampled
    // when the frame's first label is placed (see resetGraphLabels), after
    // sigma has processed this frame's positions and camera.
    const sampleNodes = (out: GraphLabelBox[]) => {
      graph.forEachNode((id) => {
        const display = sigma.getNodeDisplayData(id);
        if (!display || display.hidden) return;
        const r = sigma.scaleSize(display.size);
        if (r < MIN_BLOCKING_RADIUS) return;
        const at = sigma.framedGraphToViewport(display);
        out.push({ x: at.x - r - 1, y: at.y - r - 1, width: 2 * r + 2, height: 2 * r + 2 });
      });
    };
    sigma.on("beforeRender", () => {
      resetGraphLabels(
        el.querySelectorAll<HTMLCanvasElement>("canvas.sigma-labels, canvas.sigma-hovers"),
        sampleNodes,
      );
    });
    topology.current = "";
    cameraIntent.current = false;
    const controls = sigmaCameraControls(() => sigmaRef.current);
    live.current.onControlsReady?.({
      ...controls,
      fit: () => {
        cameraIntent.current = true;
        controls.fit();
      },
      reset: () => {
        cameraIntent.current = true;
        controls.reset();
      },
      zoomIn: () => {
        cameraIntent.current = true;
        controls.zoomIn();
      },
      zoomOut: () => {
        cameraIntent.current = true;
        controls.zoomOut();
      },
      focusNode: (id) => {
        cameraIntent.current = true;
        controls.focusNode(id);
      },
    });
    const hulls = cluster && hullRef.current ? clusterHulls(sigma, hullRef.current) : null;
    let drag: { node: string; x: number; y: number; moved: boolean } | null = null;
    let suppressClick = false;
    const markCamera = () => {
      cameraIntent.current = true;
    };
    el.addEventListener("pointerdown", markCamera);
    el.addEventListener("wheel", markCamera, { passive: true });
    sigma.on("enterNode", ({ node }) => {
      hovered.current = node;
      el.style.cursor = "pointer";
      const display = sigma.getNodeDisplayData(node);
      if (display) setTooltip({ id: node, ...sigma.framedGraphToViewport(display) });
      refresh();
    });
    sigma.on("leaveNode", () => {
      hovered.current = null;
      el.style.cursor = "default";
      setTooltip(null);
      refresh();
    });
    sigma.on("clickNode", ({ node, event }) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const native = asInstance(event.original, MouseEvent);
      if (native?.metaKey === true || native?.ctrlKey === true) {
        live.current.onNodeOpen(node);
        return;
      }
      const meta = live.current.nodes.find((n) => n.id === node);
      if (meta) live.current.onSelectionChange?.(selectionFromNode(meta));
    });
    sigma.on("doubleClickNode", ({ node, event }) => {
      event.preventSigmaDefault();
      live.current.onNodeOpen(node);
    });
    sigma.on("clickStage", ({ event }) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      live.current.onSelectionChange?.(null);
      const key = hulls?.hit(event.x, event.y);
      if (key !== undefined && key !== "")
        setIsolated((previous) => (previous === key ? null : key));
    });
    sigma.on("downNode", ({ node, event }) => {
      event.preventSigmaDefault();
      drag = { node, x: event.x, y: event.y, moved: false };
      suppressClick = false;
      graph.setNodeAttribute(node, "fixed", true);
      sigma.getCamera().disable();
    });
    const move = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left,
        y = e.clientY - rect.top;
      if (hovered.current !== null) setTooltip({ id: hovered.current, x, y });
      if (e.target instanceof Node && el.contains(e.target)) hulls?.hover(x, y);
      if (!drag) return;
      if (Math.hypot(x - drag.x, y - drag.y) > 3) drag.moved = true;
      if (!drag.moved) return;
      const point = sigma.viewportToGraph({ x, y });
      graph.mergeNodeAttributes(drag.node, point);
    };
    const up = () => {
      suppressClick = drag?.moved === true;
      if (drag && graph.hasNode(drag.node)) graph.removeNodeAttribute(drag.node, "fixed");
      drag = null;
      sigma.getCamera().enable();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    if (import.meta.env.MODE === "test-render")
      (el as HTMLDivElement & { __kbSigma?: Sigma }).__kbSigma = sigma;
    return () => {
      el.removeEventListener("pointerdown", markCamera);
      el.removeEventListener("wheel", markCamera);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      hulls?.dispose();
      emphasis.current?.dispose();
      emphasis.current = null;
      layoutRef.current?.kill();
      layoutRef.current = null;
      sigma.kill();
      sigmaRef.current = null;
      live.current.onControlsReady?.(null);
      delete (el as HTMLDivElement & { __kbSigma?: Sigma }).__kbSigma;
    };
  }, [layoutKey, layout, cluster, refresh]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const graph = sigma.getGraph();
    const key =
      nodes
        .map((n) => `${n.id}:${cluster ? n.clusterKey : ""}`)
        .toSorted()
        .join("|") +
      "/" +
      edges
        .map((e) => `${e.kind}:${e.source}:${e.target}:${e.weight}`)
        .toSorted()
        .join("|");
    const changed = key !== topology.current;
    const initial = topology.current === "";
    if (changed) {
      layoutRef.current?.kill();
      layoutRef.current = null;
      graph.clearEdges();
    }
    const ids = new Set(nodes.map((n) => n.id));
    for (const id of graph.nodes()) if (!ids.has(id)) graph.dropNode(id);
    const assigned = computeLayoutPositions(layout, nodes, edges);
    const groups = [...new Set(nodes.map((n) => n.clusterKey))].toSorted();
    const members = new Map<string, number>();
    nodes.forEach((n, index) => {
      const exists = graph.hasNode(n.id);
      let point = assigned?.get(n.id);
      const count = members.get(n.clusterKey) ?? 0;
      members.set(n.clusterKey, count + 1);
      if (cluster && (!exists || graph.getNodeAttribute(n.id, "clusterKey") !== n.clusterKey)) {
        const group = groups.indexOf(n.clusterKey);
        const angle = (group * 2 * Math.PI) / Math.max(1, groups.length),
          r = 100 + groups.length * 30;
        point = {
          x: Math.cos(angle) * r + Math.cos(count * 2.4) * Math.sqrt(count) * 20,
          y: Math.sin(angle) * r + Math.sin(count * 2.4) * Math.sqrt(count) * 20,
        };
      }
      const attrs = {
        label: n.label,
        color: n.color,
        size: n.size,
        clusterKey: n.clusterKey,
        clusterLabel: n.clusterLabel ?? n.clusterKey,
      };
      if (exists) graph.mergeNodeAttributes(n.id, { ...attrs, ...(cluster ? point : undefined) });
      else
        graph.addNode(n.id, {
          ...attrs,
          ...(point ?? {
            x: Math.cos(index * 2.4) * Math.sqrt(index + 1) * 12,
            y: Math.sin(index * 2.4) * Math.sqrt(index + 1) * 12,
          }),
        });
    });
    if (changed)
      edges.forEach((e, i) => {
        if (ids.has(e.source) && ids.has(e.target))
          graph.addEdgeWithKey(String(i), e.source, e.target, {
            size: Math.max(1, Math.sqrt(e.weight)),
            kind: e.kind,
          });
      });
    topology.current = key;
    if (changed) emphasis.current?.reindex(initial);
    if (changed && graph.order && !cluster && layout === "force") {
      const fa = createFA2Layout(graph, {
        onConverged: () => {
          sigma.refresh();
          if (initial && !cameraIntent.current) fitView(sigma);
        },
      });
      layoutRef.current = fa;
      fa.start();
    }
    sigma.refresh();
    if (initial && graph.order) fitView(sigma, 0);
    refresh();
  }, [nodes, edges, layoutKey, layout, cluster, refresh]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    // Everything sigma copied out of the tokens is re-read on an appearance change.
    sigma.setSetting("labelFont", graphLabelFont());
    const edgeColor = readTokenColor("--graph-edge");
    sigma.setSetting("defaultEdgeColor", edgeColor);
    sigma
      .getGraph()
      .forEachEdge((edge) => sigma.getGraph().setEdgeAttribute(edge, "color", edgeColor));
    const ground = readTokenColor("--background");
    const ink = readTokenColor("--foreground");
    emphasis.current?.setRings(ground, ink);
    setGraphLabelInk(ink, ground);
    sigma.setSetting("renderLabels", showLabels);
    // Density-aware: the busier the graph, the fewer labels per grid cell.
    const crowd = Math.min(1, Math.sqrt(LABEL_CROWD / Math.max(1, nodes.length)));
    sigma.setSetting(
      "labelDensity",
      (labelDensity === "low" ? 0.25 : labelDensity === "high" ? 1 : 0.65) * crowd,
    );
    sigma.setSetting("hideEdgesOnMove", nodes.length > 1500);
    refresh();
  }, [appearance, showLabels, labelDensity, nodes, edges, layoutKey, layout, cluster, refresh]);
  useEffect(() => {
    refresh();
  }, [selectedNodeId, highlightIds, filterIds, isolated, refresh]);
  const meta = tooltip ? nodes.find((n) => n.id === tooltip.id) : null;
  return (
    <div
      className="relative h-full w-full min-h-0 kb-workspace-reveal"
      data-testid={cluster ? "cluster-graph" : undefined}
    >
      {cluster ? (
        <canvas ref={hullRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      ) : null}
      <div ref={containerRef} className="absolute inset-0" data-sigma-container="true" />
      {isolated !== null ? (
        <button
          type="button"
          className="absolute bottom-3 left-3 z-20 rounded-md bg-popover px-3 py-1 text-meta leading-4 shadow-raised"
          onClick={() => setIsolated(null)}
        >
          Clear cluster:{" "}
          {nodes.find((n) => n.clusterKey === isolated)?.clusterLabel ?? "Selected group"} ×
        </button>
      ) : null}
      {tooltip && meta && (selectedNodeId === null || selectedNodeId === undefined) ? (
        <GraphTooltip node={meta} x={tooltip.x} y={tooltip.y} />
      ) : null}
    </div>
  );
}
