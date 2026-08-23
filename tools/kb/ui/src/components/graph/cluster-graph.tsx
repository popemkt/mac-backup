import { useCallback, useEffect, useRef, useState } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { hashTagColor } from "@/lib/tag-color";
import { readTokenColor } from "@/lib/css-color";
import { withGraphAlpha } from "@/lib/graph-dim";
import { convexHull } from "@/lib/convex-hull";

type CameraSnap = { x: number; y: number; angle: number; ratio: number };

export interface ClusterGraphProps {
  nodes: LensNode[];
  edges: LensEdge[];
  onNodeClick: (id: string) => void;
  onClusterFilter?: (clusterKey: string | null) => void;
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

export function ClusterGraph({
  nodes,
  edges,
  onNodeClick,
  onClusterFilter,
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
  const dragRef = useRef<{ node: string; dragging: boolean; startX: number; startY: number } | null>(null);
  const [isolatedCluster, setIsolatedCluster] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    const hullCanvas = hullRef.current;
    if (!el || !hullCanvas) return;

    sigmaRef.current?.kill();
    sigmaRef.current = null;

    const graph = new Graph({ multi: true, type: "directed" });
    const allClusters = [...new Set(nodes.map((n) => n.clusterKey))].sort();
    const clusterSizes = new Map<string, number>();
    for (const n of nodes) clusterSizes.set(n.clusterKey, (clusterSizes.get(n.clusterKey) ?? 0) + 1);
    const clusters = allClusters
      .sort((a, b) => (clusterSizes.get(b) ?? 0) - (clusterSizes.get(a) ?? 0))
      .slice(0, 15);
    const clusterSet = new Set(clusters);
    const attractors = new Map<string, { x: number; y: number }>();
    const R = 80 + clusters.length * 12;
    clusters.forEach((key, i) => {
      const angle = (2 * Math.PI * i) / Math.max(clusters.length, 1);
      attractors.set(key, { x: Math.cos(angle) * R, y: Math.sin(angle) * R });
    });
    if (!attractors.has("other")) attractors.set("other", { x: 0, y: 0 });

    const prev = positionsRef.current;
    const nextPos = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      const effectiveCluster = clusterSet.has(n.clusterKey) ? n.clusterKey : "other";
      const attr = attractors.get(effectiveCluster) ?? attractors.get("other") ?? { x: 0, y: 0 };
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

    const labelColor = readTokenColor("--foreground", {
      fallback: "rgb(34,34,34)",
    });
    const edgeColor = readTokenColor("--foreground", {
      alpha: 0.2,
      fallback: "rgba(128,128,128,0.2)",
    });

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

    const clusterCounts = new Map<string, number>();
    for (const n of nodes) {
      clusterCounts.set(n.clusterKey, (clusterCounts.get(n.clusterKey) ?? 0) + 1);
    }

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
          const vp = sigma.framedGraphToViewport({ x: display.x, y: display.y });
          pts.push(vp);
        });
        if (pts.length < 2) continue;
        const pad = 24;
        const hull = convexHull(pts.flatMap((p) => [
          { x: p.x - pad, y: p.y - pad },
          { x: p.x + pad, y: p.y - pad },
          { x: p.x + pad, y: p.y + pad },
          { x: p.x - pad, y: p.y + pad },
        ]));
        const color = clusterColor(key);
        ctx.beginPath();
        if (hull.length === 2) {
          const [a, b] = hull;
          const mx = (a!.x + b!.x) / 2;
          const my = (a!.y + b!.y) / 2;
          const r = Math.hypot(a!.x - b!.x, a!.y - b!.y) / 2 + 22;
          ctx.arc(mx, my, r, 0, Math.PI * 2);
        } else {
          const PAD = 0;
          const padded = hull.map((p) => {
            let cx = 0, cy = 0;
            for (const q of hull) { cx += q.x; cy += q.y; }
            cx /= hull.length; cy /= hull.length;
            const dx = p.x - cx, dy = p.y - cy;
            const dist = Math.hypot(dx, dy) || 1;
            return { x: p.x + (dx / dist) * PAD, y: p.y + (dy / dist) * PAD };
          });
          if (padded.length >= 3) {
            ctx.moveTo(
              (padded[padded.length - 1]!.x + padded[0]!.x) / 2,
              (padded[padded.length - 1]!.y + padded[0]!.y) / 2,
            );
            for (let i = 0; i < padded.length; i++) {
              const next = padded[(i + 1) % padded.length]!;
              const curr = padded[i]!;
              ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
            }
          } else {
            ctx.moveTo(padded[0]!.x, padded[0]!.y);
            for (let i = 1; i < padded.length; i++) {
              ctx.lineTo(padded[i]!.x, padded[i]!.y);
            }
          }
          ctx.closePath();
        }
        ctx.fillStyle = withGraphAlpha(color, 0.04);
        ctx.fill();
        ctx.strokeStyle = withGraphAlpha(color, 0.25);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        let cx = 0, cy = 0;
        for (const p of pts) { cx += p.x; cy += p.y; }
        cx /= pts.length; cy /= pts.length;
        ctx.fillStyle = labelColor;
        ctx.font = "bold 11px Outfit Variable, ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        const count = clusterCounts.get(key) ?? pts.length;
        const minY = Math.min(...pts.map((p) => p.y));
        ctx.fillText(`${key} (${count})`, cx, minY - pad - 8);
      }
    };

    sigma.on("afterRender", drawHulls);
    sigma.on("clickNode", ({ node }) => {
      if (dragRef.current?.dragging) return;
      onClickRef.current(node);
    });

    // --- Node drag (MUST 7) ---
    sigma.on("downNode", ({ node, event }) => {
      const pos = sigma.graphToViewport(
        graph.getNodeAttributes(node) as { x: number; y: number },
      );
      dragRef.current = { node, dragging: false, startX: pos.x, startY: pos.y };
      sigma.getCamera().disable();
    });

    const onDragMove = (e: MouseEvent) => {
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
      nextPos.set(drag.node, { x: pos.x, y: pos.y });
    };
    const onDragUp = () => {
      dragRef.current = null;
      sigma.getCamera().enable();
    };
    el.addEventListener("mousemove", onDragMove);
    el.addEventListener("mouseup", onDragUp);
    el.addEventListener("mouseleave", onDragUp);

    // --- Hull click isolation (MUST 13) ---
    hullCanvas.style.pointerEvents = "auto";
    const onHullClick = (e: MouseEvent) => {
      const rect = hullCanvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const ctx = hullCanvas.getContext("2d");
      if (!ctx) return;
      for (const key of clusters) {
        const pts: Array<{ x: number; y: number }> = [];
        graph.forEachNode((id, attrs) => {
          if (String(attrs.clusterKey) !== key) return;
          const display = sigma.getNodeDisplayData(id);
          if (!display) return;
          pts.push(sigma.framedGraphToViewport({ x: display.x, y: display.y }));
        });
        if (pts.length < 3) continue;
        const pad = 24;
        const hull = convexHull(pts.flatMap((p) => [
          { x: p.x - pad, y: p.y - pad },
          { x: p.x + pad, y: p.y - pad },
          { x: p.x + pad, y: p.y + pad },
          { x: p.x - pad, y: p.y + pad },
        ]));
        const path2d = new Path2D();
        path2d.moveTo(hull[0]!.x, hull[0]!.y);
        for (let i = 1; i < hull.length; i++) path2d.lineTo(hull[i]!.x, hull[i]!.y);
        path2d.closePath();
        if (ctx.isPointInPath(path2d, cx, cy)) {
          setIsolatedCluster((prev) => prev === key ? null : key);
          return;
        }
      }
    };
    hullCanvas.addEventListener("click", onHullClick);

    if (cameraRef.current && nodes.length > 0) {
      sigma.getCamera().setState(cameraRef.current);
    }
    drawHulls();
    sigmaRef.current = sigma;

    return () => {
      el.removeEventListener("mousemove", onDragMove);
      el.removeEventListener("mouseup", onDragUp);
      el.removeEventListener("mouseleave", onDragUp);
      hullCanvas.removeEventListener("click", onHullClick);
      hullCanvas.style.pointerEvents = "none";
      try {
        cameraRef.current = sigma.getCamera().getState();
      } catch {
        /* */
      }
      sigma.kill();
      if (sigmaRef.current === sigma) sigmaRef.current = null;
    };
  }, [nodes, edges, layoutKey, themeKey]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const graph = sigma.getGraph();
    if (isolatedCluster) {
      sigma.setSetting("nodeReducer", (node, data) => {
        const key = String(graph.getNodeAttribute(node, "clusterKey") ?? "none");
        if (key === isolatedCluster) return { ...data, highlighted: true };
        return { ...data, color: withGraphAlpha(String(data.color), 0.2), label: "", zIndex: 0 };
      });
      sigma.setSetting("edgeReducer", (edge, data) => {
        const [src, tgt] = graph.extremities(edge);
        const srcKey = String(graph.getNodeAttribute(src, "clusterKey") ?? "none");
        const tgtKey = String(graph.getNodeAttribute(tgt, "clusterKey") ?? "none");
        if (srcKey === isolatedCluster || tgtKey === isolatedCluster) return data;
        return { ...data, hidden: true };
      });
    } else {
      sigma.setSetting("nodeReducer", (_node, data) => data);
      sigma.setSetting("edgeReducer", (_edge, data) => ({ ...data, hidden: false }));
    }
    sigma.refresh();
  }, [isolatedCluster]);

  return (
    <div className="relative h-full w-full min-h-0" data-testid="cluster-graph">
      {/* Hull canvas between Sigma layers for fills + click targets. */}
      <canvas
        ref={hullRef}
        className="absolute inset-0 z-20"
      />
      <div ref={containerRef} className="absolute inset-0 z-10" />
      {isolatedCluster && (
        <button
          type="button"
          className="absolute top-3 left-1/2 -translate-x-1/2 z-20 rounded-md border border-foreground/10 bg-popover/95 px-2.5 py-1 text-[11px] font-medium text-foreground/60 shadow-md backdrop-blur-sm hover:bg-foreground/[0.06]"
          onClick={() => setIsolatedCluster(null)}
        >
          clear filter: {isolatedCluster} ✕
        </button>
      )}
    </div>
  );
}
