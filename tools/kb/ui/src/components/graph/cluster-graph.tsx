import { useEffect, useRef } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { hashTagColor } from "@/lib/tag-color";
import { readTokenColor } from "@/lib/css-color";
import { convexHull } from "@/lib/convex-hull";

type CameraSnap = { x: number; y: number; angle: number; ratio: number };

export interface ClusterGraphProps {
  nodes: LensNode[];
  edges: LensEdge[];
  onNodeClick: (id: string) => void;
  layoutKey: string;
  themeKey: string;
}

function topologyKey(nodes: LensNode[], edges: LensEdge[]): string {
  const n = nodes
    .map((x) => `${x.id}:${x.clusterKey}`)
    .sort()
    .join(",");
  const e = edges
    .map((x) => `${x.kind}:${x.source}->${x.target}`)
    .sort()
    .join(",");
  return `${n}|${e}`;
}

function clusterColor(key: string): string {
  if (key === "none" || key === "untagged" || key === "root") {
    return hashTagColor(key);
  }
  return hashTagColor(key);
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const a = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0");
    return `${color}${a}`;
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(color);
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
  return color;
}

export function ClusterGraph({
  nodes,
  edges,
  onNodeClick,
  layoutKey,
  themeKey,
}: ClusterGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hullRef = useRef<HTMLCanvasElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const cameraRef = useRef<CameraSnap | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const topologyRef = useRef("");
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;

  useEffect(() => {
    const el = containerRef.current;
    const hullCanvas = hullRef.current;
    if (!el || !hullCanvas) return;

    sigmaRef.current?.kill();
    sigmaRef.current = null;

    const graph = new Graph({ multi: true, type: "directed" });
    const clusters = [...new Set(nodes.map((n) => n.clusterKey))].sort();
    const attractors = new Map<string, { x: number; y: number }>();
    const R = 80 + clusters.length * 12;
    clusters.forEach((key, i) => {
      const angle = (2 * Math.PI * i) / Math.max(clusters.length, 1);
      attractors.set(key, { x: Math.cos(angle) * R, y: Math.sin(angle) * R });
    });

    const prev = positionsRef.current;
    const nextPos = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      const attr = attractors.get(n.clusterKey) ?? { x: 0, y: 0 };
      const prior = prev.get(n.id);
      const x = prior?.x ?? attr.x + (Math.random() - 0.5) * 30;
      const y = prior?.y ?? attr.y + (Math.random() - 0.5) * 30;
      nextPos.set(n.id, { x, y });
      graph.addNode(n.id, {
        label: n.label,
        color: n.color,
        size: n.size,
        clusterKey: n.clusterKey,
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
        /* dup */
      }
    }

    const topo = topologyKey(nodes, edges);
    const topologyChanged = topo !== topologyRef.current;
    topologyRef.current = topo;

    if (graph.order > 0 && topologyChanged) {
      // Soft pull toward cluster attractors, then FA2.
      for (let iter = 0; iter < 40; iter++) {
        graph.forEachNode((id, attrs) => {
          const key = String(attrs.clusterKey ?? "none");
          const a = attractors.get(key);
          if (!a) return;
          const x = Number(attrs.x);
          const y = Number(attrs.y);
          graph.setNodeAttribute(id, "x", x + (a.x - x) * 0.08);
          graph.setNodeAttribute(id, "y", y + (a.y - y) * 0.08);
        });
      }
      forceAtlas2.assign(graph, {
        iterations: Math.min(100, 30 + graph.order),
        settings: forceAtlas2.inferSettings(graph),
      });
      graph.forEachNode((id, attrs) => {
        nextPos.set(id, { x: Number(attrs.x), y: Number(attrs.y) });
      });
    }
    positionsRef.current = nextPos;

    const background = readTokenColor("--background", {
      fallback: "rgb(255,255,255)",
    });
    const labelColor = readTokenColor("--foreground", {
      fallback: "rgb(34,34,34)",
    });
    const edgeColor = readTokenColor("--foreground", {
      alpha: 0.2,
      fallback: "rgba(128,128,128,0.2)",
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

    const drawHulls = () => {
      const ctx = hullCanvas.getContext("2d");
      if (!ctx) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (hullCanvas.width !== w || hullCanvas.height !== h) {
        hullCanvas.width = w;
        hullCanvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      for (const key of clusters) {
        const pts: Array<{ x: number; y: number }> = [];
        graph.forEachNode((id, attrs) => {
          if (String(attrs.clusterKey) !== key) return;
          const display = sigma.getNodeDisplayData(id);
          if (!display) return;
          const vp = sigma.graphToViewport({ x: display.x, y: display.y });
          pts.push(vp);
        });
        if (pts.length < 2) continue;
        // Expand slightly so single/dual points still show a blob.
        const hull =
          pts.length >= 3
            ? convexHull(pts)
            : pts.map((p) => ({ x: p.x, y: p.y }));
        const color = clusterColor(key);
        ctx.beginPath();
        if (hull.length === 2) {
          const [a, b] = hull;
          const mx = (a!.x + b!.x) / 2;
          const my = (a!.y + b!.y) / 2;
          const r =
            Math.hypot(a!.x - b!.x, a!.y - b!.y) / 2 + 18;
          ctx.arc(mx, my, r, 0, Math.PI * 2);
        } else {
          ctx.moveTo(hull[0]!.x, hull[0]!.y);
          for (let i = 1; i < hull.length; i++) {
            ctx.lineTo(hull[i]!.x, hull[i]!.y);
          }
          ctx.closePath();
        }
        ctx.fillStyle = withAlpha(color, 0.08);
        ctx.fill();
        // Cluster label at centroid
        let cx = 0;
        let cy = 0;
        for (const p of pts) {
          cx += p.x;
          cy += p.y;
        }
        cx /= pts.length;
        cy /= pts.length;
        ctx.fillStyle = labelColor;
        ctx.font =
          "11px Outfit Variable, ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(key, cx, cy - 14);
      }
    };

    sigma.on("afterRender", drawHulls);
    sigma.on("clickNode", ({ node }) => onClickRef.current(node));

    if (cameraRef.current && nodes.length > 0) {
      sigma.getCamera().setState(cameraRef.current);
    }
    drawHulls();
    sigmaRef.current = sigma;

    return () => {
      try {
        cameraRef.current = sigma.getCamera().getState();
      } catch {
        /* */
      }
      sigma.kill();
      if (sigmaRef.current === sigma) sigmaRef.current = null;
    };
  }, [nodes, edges, layoutKey, themeKey]);

  return (
    <div className="relative h-full w-full min-h-0" data-testid="cluster-graph">
      {/* Hull canvas under Sigma so fills/labels sit behind node glyphs. */}
      <canvas
        ref={hullRef}
        className="pointer-events-none absolute inset-0 z-0"
      />
      <div ref={containerRef} className="absolute inset-0 z-10" />
    </div>
  );
}
