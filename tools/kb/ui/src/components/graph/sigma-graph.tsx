import { useEffect, useRef } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { readTokenColor } from "@/lib/css-color";

type CameraSnap = { x: number; y: number; angle: number; ratio: number };

export interface SigmaGraphProps {
  nodes: LensNode[];
  edges: LensEdge[];
  onNodeClick: (id: string) => void;
  /** Bump when a full remount is desired (perspective change). */
  layoutKey: string;
  /** Theme/rev signal so token colors refresh without topology churn. */
  themeKey: string;
}

function topologyKey(nodes: LensNode[], edges: LensEdge[]): string {
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
  onNodeClick,
  layoutKey,
  themeKey,
}: SigmaGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const cameraRef = useRef<CameraSnap | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const topologyRef = useRef<string>("");
  const hoveredRef = useRef<string | null>(null);
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Kill any leftover instance (StrictMode / rapid deps) before rebuild.
    sigmaRef.current?.kill();
    sigmaRef.current = null;

    const graph = new Graph({ multi: true, type: "directed" });
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
          { kind: e.kind, size: 1 },
        );
      } catch {
        // ignore duplicate keys
      }
    }

    const topo = topologyKey(nodes, edges);
    const topologyChanged = topo !== topologyRef.current;
    topologyRef.current = topo;

    if (graph.order > 0 && topologyChanged) {
      const settings = forceAtlas2.inferSettings(graph);
      forceAtlas2.assign(graph, {
        iterations: Math.min(120, 40 + graph.order),
        settings,
      });
      graph.forEachNode((id, attrs) => {
        nextPositions.set(id, { x: Number(attrs.x), y: Number(attrs.y) });
      });
    }
    positionsRef.current = nextPositions;

    const background = readTokenColor("--background", {
      fallback: "rgb(255, 255, 255)",
    });
    const labelColor = readTokenColor("--foreground", {
      fallback: "rgb(34, 34, 34)",
    });
    const edgeColor = readTokenColor("--foreground", {
      alpha: 0.2,
      fallback: "rgba(128, 128, 128, 0.2)",
    });
    const edgeHoverColor = readTokenColor("--foreground", {
      alpha: 0.55,
      fallback: "rgba(128, 128, 128, 0.55)",
    });
    const dimFallback = readTokenColor("--foreground", {
      alpha: 0.15,
      fallback: "rgba(128, 128, 128, 0.15)",
    });

    el.style.background = background;

    const sigma = new Sigma(graph, el, {
      allowInvalidContainer: true,
      renderLabels: true,
      labelFont: "Outfit Variable, ui-sans-serif, system-ui, sans-serif",
      labelSize: 11,
      labelColor: { color: labelColor },
      labelRenderedSizeThreshold: 8,
      defaultEdgeColor: edgeColor,
      stagePadding: 40,
    });

    const applyHover = () => {
      const hovered = hoveredRef.current;
      sigma.setSetting("nodeReducer", (node, data) => {
        if (!hovered) return { ...data, highlighted: false };
        if (node === hovered || graph.areNeighbors(node, hovered)) {
          return { ...data, highlighted: true, zIndex: 1 };
        }
        return {
          ...data,
          color: dimFallback,
          label: "",
          zIndex: 0,
        };
      });
      sigma.setSetting("edgeReducer", (edge, data) => {
        if (!hovered) return { ...data, hidden: false, color: edgeColor };
        const extremities = graph.extremities(edge);
        if (extremities.includes(hovered)) {
          return {
            ...data,
            hidden: false,
            color: edgeHoverColor,
            zIndex: 1,
          };
        }
        return { ...data, hidden: true };
      });
      sigma.refresh();
    };

    sigma.on("enterNode", ({ node }) => {
      hoveredRef.current = node;
      applyHover();
    });
    sigma.on("leaveNode", () => {
      hoveredRef.current = null;
      applyHover();
    });
    sigma.on("clickNode", ({ node }) => {
      onClickRef.current(node);
    });

    if (cameraRef.current && nodes.length > 0) {
      sigma.getCamera().setState(cameraRef.current);
    }

    sigmaRef.current = sigma;
    return () => {
      // Stash camera BEFORE kill so the next effect can restore it.
      try {
        cameraRef.current = sigma.getCamera().getState();
      } catch {
        // already dead
      }
      sigma.kill();
      if (sigmaRef.current === sigma) sigmaRef.current = null;
    };
  }, [nodes, edges, layoutKey, themeKey]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full min-h-0"
      data-testid="sigma-graph"
    />
  );
}
