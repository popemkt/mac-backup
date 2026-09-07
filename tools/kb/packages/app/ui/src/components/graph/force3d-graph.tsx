/** Three.js stays behind the lazy force3d boundary. */
import { useCallback, useEffect, useRef } from "react";
import {
  createForceGraph,
  linkEndId as endId,
  type KbForceGraph,
  type FgNode,
} from "./force3d-instance";
import { CanvasTexture, Object3D, Sprite, SpriteMaterial } from "./force3d-three";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { force3dColor, readTokenColor } from "@/lib/css-color";
import { withGraphAlpha } from "@/lib/graph-dim";
import { graphEmphasisAlpha, graphNeighborhood, type GraphEmphasis } from "@/lib/graph-interaction";
import { fitGraphLabel, GRAPH_LABEL_FONT } from "@/lib/graph-label";
import { reserveGraphLabel, type GraphLabelBox } from "@/lib/graph-label-layout";
import { force3dCameraControls, type GraphCameraControls } from "./graph-camera-controls";
import { motionDuration } from "./graph-camera";
import { selectionFromNode, type GraphSelection } from "./graph-selection";

export interface Force3dGraphProps extends GraphEmphasis {
  nodes: LensNode[];
  edges: LensEdge[];
  layoutKey: string;
  themeKey: string;
  onControlsReady?: (controls: GraphCameraControls | null) => void;
  onSelectionChange?: (sel: GraphSelection | null) => void;
  curvedLinks?: boolean;
  autorotate?: boolean;
  showLabels?: boolean;
  labelTopN?: number;
  spread?: number;
  linkDistance?: number;
}

function labelSprite(text: string, color: string, viewportHeight: number, fov: number) {
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = 2 * dpr,
    fontSize = 12;
  ctx.font = "500 " + fontSize + "px " + GRAPH_LABEL_FONT;
  const label = fitGraphLabel(text, (t) => ctx.measureText(t).width);
  const width = Math.ceil(ctx.measureText(label).width) + 12,
    height = 24;
  canvas.width = width * scale;
  canvas.height = height * scale;
  ctx.scale(scale, scale);
  ctx.font = "500 " + fontSize + "px " + GRAPH_LABEL_FONT;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(label, 6, height / 2);
  const texture = new CanvasTexture(canvas);
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    sizeAttenuation: false,
  });
  const sprite = new Sprite(material);
  const pixelsToScale = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, viewportHeight);
  sprite.scale.set(width * pixelsToScale, height * pixelsToScale, 1);
  sprite.center.set(0.5, -0.35);
  return {
    sprite,
    width,
    height,
    dispose: () => {
      texture.dispose();
      material.dispose();
    },
  };
}

export default function Force3dGraph(props: Force3dGraphProps) {
  const {
    nodes,
    edges,
    layoutKey,
    themeKey,
    selectedNodeId,
    highlightIds,
    filterIds,
    curvedLinks = false,
    autorotate = false,
    showLabels = true,
    labelTopN = 24,
    spread = 150,
    linkDistance = 60,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<KbForceGraph | null>(null);
  const live = useRef(props);
  live.current = props;
  const hovered = useRef<string | null>(null);
  const cameraIntent = useRef(false);
  const fitted = useRef(false);
  const simulationReady = useRef(false);
  const labelCleanup = useRef<Array<() => void>>([]);
  const labelCandidates = useRef<
    Array<{
      node: FgNode;
      sprite: Sprite;
      width: number;
      height: number;
    }>
  >([]);
  const refresh = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const p = live.current;
    const active = p.selectedNodeId ?? hovered.current;
    const neighborhood = graphNeighborhood(active, p.edges);
    const alpha = (id: string) => graphEmphasisAlpha(id, p, neighborhood);
    const foreground = force3dColor(readTokenColor("--foreground", { fallback: "#222" }));
    graph.backgroundColor(force3dColor(readTokenColor("--background", { fallback: "#fff" })));
    graph.nodeColor((n) => withGraphAlpha(n.color, alpha(n.id)));
    graph.nodeVal((n) => n.val * (n.id === active ? 1.5 : 1));
    graph.linkColor((l) => {
      const a = endId(l.source),
        b = endId(l.target);
      const near = active === null || a === active || b === active;
      return withGraphAlpha(foreground, near ? 0.35 * Math.min(alpha(a), alpha(b)) : 0.025);
    });
    graph.linkWidth((l) => {
      const near = active !== null && (endId(l.source) === active || endId(l.target) === active);
      return Math.max(0.6, Math.min(2, Math.sqrt(l.weight) * 0.4)) * (near ? 2 : 1);
    });
    const labels = new Set(
      [...p.nodes]
        .toSorted((a, b) => b.size - a.size || a.id.localeCompare(b.id))
        .slice(0, p.labelTopN ?? 24)
        .map((n) => n.id),
    );
    const previous = labelCleanup.current;
    const next: Array<() => void> = [];
    labelCandidates.current = [];
    graph
      .nodeThreeObject((node: FgNode) => {
        const emphatic = alpha(node.id) === 1;
        const labelVisible =
          (p.showLabels ?? true) &&
          emphatic &&
          (labels.has(node.id) || node.id === active || p.highlightIds?.has(node.id) === true);
        if (!labelVisible) return new Object3D();
        const label = labelSprite(node.name, foreground, graph.height(), graph.camera().fov);
        next.push(label.dispose);
        labelCandidates.current.push({
          node,
          sprite: label.sprite,
          width: label.width,
          height: label.height,
        });
        return label.sprite;
      })
      .nodeThreeObjectExtend(true);
    labelCleanup.current = next;
    for (const dispose of previous) dispose();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    fitted.current = false;
    simulationReady.current = false;
    cameraIntent.current = false;
    const graph = createForceGraph(el)
      .showNavInfo(false)
      .nodeId("id")
      .nodeResolution(32)
      .enableNodeDrag(false)
      .linkDirectionalArrowLength(3)
      .linkDirectionalArrowRelPos(1)
      .cooldownTicks(160)
      .onEngineTick(() => {
        simulationReady.current = true;
      })
      .nodeLabel((node) => {
        const content = document.createElement("div");
        content.textContent = node.name;
        content.style.maxWidth = "320px";
        content.style.whiteSpace = "normal";
        return content;
      })
      .onNodeClick((value) => {
        const id = value.id,
          meta = live.current.nodes.find((n) => n.id === id);
        if (meta) live.current.onSelectionChange?.(selectionFromNode(meta));
      })
      .onBackgroundClick(() => live.current.onSelectionChange?.(null))
      .onNodeHover((value) => {
        hovered.current = value?.id ?? null;
        refresh();
      })
      .onEngineStop(() => {
        if (!fitted.current && !cameraIntent.current) {
          graph.zoomToFit(motionDuration(500), 80);
          fitted.current = true;
        }
      });
    graphRef.current = graph;
    const scene = graph.scene();
    const previousBeforeRender = scene.onBeforeRender;
    scene.onBeforeRender = () => {
      const occupied: GraphLabelBox[] = [];
      const active = live.current.selectedNodeId ?? hovered.current;
      const candidates = [...labelCandidates.current].toSorted(
        (a, b) =>
          Number(b.node.id === active) - Number(a.node.id === active) ||
          b.node.val - a.node.val ||
          a.node.id.localeCompare(b.node.id),
      );
      const matrix = graph.camera().matrixWorldInverse.elements;
      for (const { node, sprite, width, height } of candidates) {
        const { x = 0, y = 0, z = 0 } = node;
        const point = graph.graph2ScreenCoords(x, y, z);
        const box = {
          x: point.x - width / 2 - 3,
          y: point.y - height * 1.35 - 2,
          width: width + 6,
          height: height + 4,
        };
        const inFront = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] < 0;
        sprite.visible =
          inFront &&
          Number.isFinite(box.x + box.y) &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= graph.width() &&
          box.y + box.height <= graph.height() &&
          reserveGraphLabel(box, occupied);
      }
    };
    graph.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const mark = () => {
      cameraIntent.current = true;
    };
    el.addEventListener("pointerdown", mark);
    el.addEventListener("wheel", mark, { passive: true });
    const controls = force3dCameraControls(() => graphRef.current);
    live.current.onControlsReady?.({
      ...controls,
      fit: () => {
        mark();
        controls.fit();
      },
      reset: () => {
        mark();
        controls.reset();
      },
      focusNode: (id) => {
        mark();
        controls.focusNode(id);
      },
      zoomIn: () => {
        mark();
        controls.zoomIn();
      },
      zoomOut: () => {
        mark();
        controls.zoomOut();
      },
    });
    const resize = new ResizeObserver(() => {
      graph.width(el.clientWidth).height(el.clientHeight);
      refresh();
    });
    resize.observe(el);
    graph.width(el.clientWidth).height(el.clientHeight);
    if (import.meta.env.MODE === "test-render")
      (el as HTMLDivElement & { __kbForceGraph?: KbForceGraph }).__kbForceGraph = graph;
    return () => {
      resize.disconnect();
      el.removeEventListener("pointerdown", mark);
      el.removeEventListener("wheel", mark);
      for (const dispose of labelCleanup.current) dispose();
      labelCleanup.current = [];
      labelCandidates.current = [];
      scene.onBeforeRender = previousBeforeRender;
      graph._destructor();
      graphRef.current = null;
      el.replaceChildren();
      live.current.onControlsReady?.(null);
      delete (el as HTMLDivElement & { __kbForceGraph?: KbForceGraph }).__kbForceGraph;
    };
  }, [layoutKey, refresh]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const previous = new Map(graph.graphData().nodes.map((n) => [n.id, n]));
    const ids = new Set(nodes.map((n) => n.id));
    graph.graphData({
      nodes: nodes.map((n, index) =>
        Object.assign(
          previous.get(n.id) ?? {
            x: Math.cos(index * 2.4) * Math.sqrt(index + 1) * 12,
            y: Math.sin(index * 2.4) * Math.sqrt(index + 1) * 12,
            z: Math.sin(index) * 30,
          },
          {
            id: n.id,
            name: n.label,
            color: force3dColor(n.color),
            val: n.size,
            clusterKey: n.clusterKey,
            tags: n.tags,
            degree: n.degree,
          },
        ),
      ),
      links: edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({ source: e.source, target: e.target, weight: e.weight, kind: e.kind })),
    });
    refresh();
  }, [nodes, edges, layoutKey, refresh]);
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.linkCurvature(curvedLinks ? 0.25 : 0);
    const controls = graph.controls() as { autoRotate?: boolean; autoRotateSpeed?: number };
    controls.autoRotate = autorotate && motionDuration(1) > 0;
    controls.autoRotateSpeed = 1;
    const link = graph.d3Force("link");
    if (link && "distance" in link && typeof link.distance === "function")
      link.distance(linkDistance);
    const charge = graph.d3Force("charge");
    if (charge && "strength" in charge && typeof charge.strength === "function")
      charge.strength(-spread);
    // Initial graphData sets up and starts the layout asynchronously. Reheating
    // before its first tick starts an engine whose layout does not exist yet.
    if (simulationReady.current) graph.d3ReheatSimulation();
  }, [curvedLinks, autorotate, spread, linkDistance, layoutKey]);
  useEffect(() => {
    refresh();
  }, [themeKey, selectedNodeId, highlightIds, filterIds, showLabels, labelTopN, refresh]);
  return <div ref={containerRef} className="h-full w-full min-h-0" data-testid="force3d-graph" />;
}
