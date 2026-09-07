import { asInstance } from "@/lib/dom";
import { useCallback, useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { EdgeArrowProgram } from "sigma/rendering";
import type { LensEdge, LensNode, LensLayout, LensLabelDensity } from "@/lib/graph-lens";
import { readTokenColor } from "@/lib/css-color";
import { withGraphAlpha } from "@/lib/graph-dim";
import { graphEmphasisAlpha, graphNeighborhood, type GraphEmphasis } from "@/lib/graph-interaction";
import { computeLayoutPositions } from "@/lib/graph-layouts";
import { createFA2Layout, type FA2Controller } from "./fa2-layout";
import { fitView } from "./graph-camera";
import { sigmaCameraControls, type GraphCameraControls } from "./graph-camera-controls";
import { selectionFromNode, type GraphSelection } from "./graph-selection";
import { drawGraphLabel, drawGraphHover, resetGraphLabels } from "./sigma-labels";
import { clusterHulls } from "./cluster-hulls";
export type { GraphSelection };

export interface SigmaGraphProps extends GraphEmphasis {
  nodes: LensNode[];
  edges: LensEdge[];
  onNodeOpen: (id: string) => void;
  onSelectionChange?: (sel: GraphSelection | null) => void;
  layoutKey: string;
  themeKey: string;
  layout?: LensLayout;
  cluster?: boolean;
  showLabels?: boolean;
  labelDensity?: LensLabelDensity;
  onControlsReady?: (controls: GraphCameraControls | null) => void;
}

/** A single Sigma lifecycle owns both force and cluster interaction. */
export function SigmaGraph(props: SigmaGraphProps) {
  const {
    nodes,
    edges,
    layoutKey,
    themeKey,
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

  const refresh = useCallback(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const state = live.current;
    const active = state.selectedNodeId ?? hovered.current;
    const neighborhood = graphNeighborhood(active, state.edges);
    const graph = sigma.getGraph();
    const alphaFor = (id: string) => {
      const a = graphEmphasisAlpha(id, state, neighborhood);
      return isolatedRef.current !== null &&
        graph.getNodeAttribute(id, "clusterKey") !== isolatedRef.current
        ? a * 0.2
        : a;
    };
    sigma.setSetting("nodeReducer", (id, data) => {
      const alpha = alphaFor(id);
      const focused = id === active;
      return {
        ...data,
        color: withGraphAlpha(String(data.color), alpha),
        label: alpha === 1 ? data.label : "",
        forceLabel:
          alpha === 1 &&
          (active !== null || state.highlightIds !== undefined || state.filterIds !== undefined),
        highlighted: focused,
        zIndex: focused ? 2 : alpha === 1 ? 1 : 0,
        size: focused ? data.size * 1.2 : data.size,
      };
    });
    sigma.setSetting("edgeReducer", (edge, data) => {
      const [a, b] = graph.extremities(edge);
      const connected = active === null || a === active || b === active;
      return {
        ...data,
        color: withGraphAlpha(
          String(data.color),
          connected ? Math.min(alphaFor(a), alphaFor(b)) : 0.08,
        ),
        size: connected && active !== null ? Number(data.size) * 1.6 : data.size,
        zIndex: connected ? 1 : 0,
      };
    });
    sigma.refresh();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const graph = new Graph({ multi: true, type: "directed" });
    const sigma = new Sigma(graph, el, {
      allowInvalidContainer: true,
      labelFont: "Outfit Variable, ui-sans-serif, system-ui, sans-serif",
      labelSize: 12,
      labelRenderedSizeThreshold: 0,
      labelDensity: 0.7,
      defaultDrawNodeLabel: drawGraphLabel,
      defaultDrawNodeHover: drawGraphHover,
      defaultEdgeType: "arrow",
      edgeProgramClasses: { arrow: EdgeArrowProgram },
      stagePadding: 70,
      zIndex: true,
    });
    sigmaRef.current = sigma;
    sigma.on("beforeRender", () => {
      for (const canvas of el.querySelectorAll<HTMLCanvasElement>(
        "canvas.sigma-labels, canvas.sigma-hovers",
      ))
        resetGraphLabels(canvas);
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
    if (changed && graph.order && !cluster && layout === "force") {
      const fa = createFA2Layout(graph, {
        onConverged: () => {
          sigma.refresh();
          if (initial && !cameraIntent.current) fitView(sigma, 400);
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
    const edgeColor = readTokenColor("--foreground", {
      alpha: 0.22,
      fallback: "rgba(128,128,128,.22)",
    });
    sigma.setSetting("defaultEdgeColor", edgeColor);
    sigma
      .getGraph()
      .forEachEdge((edge) => sigma.getGraph().setEdgeAttribute(edge, "color", edgeColor));
    sigma.setSetting("renderLabels", showLabels);
    sigma.setSetting(
      "labelDensity",
      labelDensity === "low" ? 0.25 : labelDensity === "high" ? 1 : 0.65,
    );
    sigma.setSetting("hideEdgesOnMove", nodes.length > 1500);
    refresh();
  }, [themeKey, showLabels, labelDensity, nodes, edges, layoutKey, layout, cluster, refresh]);
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
          className="absolute bottom-3 left-3 z-20 rounded-md bg-popover px-3 py-1 text-xs shadow"
          onClick={() => setIsolated(null)}
        >
          Clear cluster:{" "}
          {nodes.find((n) => n.clusterKey === isolated)?.clusterLabel ?? "Selected group"} ×
        </button>
      ) : null}
      {tooltip && meta && (selectedNodeId === null || selectedNodeId === undefined) ? (
        <div
          className="pointer-events-none absolute z-40 max-w-72 whitespace-normal break-words rounded-md border border-foreground/10 bg-popover px-3 py-2 text-xs text-foreground shadow-lg"
          style={{
            left: Math.max(
              8,
              Math.min(tooltip.x + 12, (containerRef.current?.clientWidth ?? 400) - 280),
            ),
            top: Math.max(8, tooltip.y - 48),
          }}
        >
          {meta.label}
          <div className="mt-1 text-foreground/50">{meta.degree} connections</div>
        </div>
      ) : null}
    </div>
  );
}
