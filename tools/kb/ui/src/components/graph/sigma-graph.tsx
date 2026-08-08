import { useEffect, useRef } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import type { LensEdge, LensNode } from "@/lib/graph-lens";

export interface SigmaGraphProps {
  nodes: LensNode[];
  edges: LensEdge[];
  /** CSS color strings (resolved from tokens). */
  background: string;
  labelColor: string;
  onNodeClick: (id: string) => void;
  /** Bump to force full rebuild while preserving camera when possible. */
  layoutKey: string;
}

function cssColor(value: string, fallback: string): string {
  const v = value.trim();
  return v || fallback;
}

export function SigmaGraph({
  nodes,
  edges,
  background,
  labelColor,
  onNodeClick,
  layoutKey,
}: SigmaGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const prevCamera = sigmaRef.current?.getCamera().getState();
    sigmaRef.current?.kill();
    sigmaRef.current = null;

    const graph = new Graph({ multi: true, type: "directed" });
    for (const n of nodes) {
      graph.addNode(n.id, {
        label: n.label,
        color: n.color,
        size: n.size,
        x: Math.random() * 100,
        y: Math.random() * 100,
      });
    }
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!;
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      try {
        graph.addEdgeWithKey(`${e.kind}:${e.source}->${e.target}:${i}`, e.source, e.target, {
          kind: e.kind,
          size: 1,
          color: "#88888855",
        });
      } catch {
        // ignore duplicate keys
      }
    }

    if (graph.order > 0) {
      const settings = forceAtlas2.inferSettings(graph);
      forceAtlas2.assign(graph, {
        iterations: Math.min(120, 40 + graph.order),
        settings,
      });
    }

    const sigma = new Sigma(graph, el, {
      allowInvalidContainer: true,
      renderLabels: true,
      labelFont: "Outfit Variable, ui-sans-serif, system-ui, sans-serif",
      labelSize: 11,
      labelColor: { color: cssColor(labelColor, "#222") },
      labelRenderedSizeThreshold: 8,
      defaultEdgeColor: "#88888855",
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
          color: dimColor(String(data.color ?? "#888"), 0.15),
          label: "",
          zIndex: 0,
        };
      });
      sigma.setSetting("edgeReducer", (edge, data) => {
        if (!hovered) return { ...data, hidden: false };
        const extremities = graph.extremities(edge);
        if (extremities.includes(hovered)) {
          return { ...data, hidden: false, color: "#888888aa", zIndex: 1 };
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

    el.style.background = cssColor(background, "#fff");

    if (prevCamera && nodes.length > 0) {
      sigma.getCamera().setState(prevCamera);
    }

    sigmaRef.current = sigma;
    return () => {
      sigma.kill();
      if (sigmaRef.current === sigma) sigmaRef.current = null;
    };
    // layoutKey intentionally drives rebuild; camera restored from prior instance.
  }, [nodes, edges, background, labelColor, layoutKey]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full min-h-0"
      data-testid="sigma-graph"
    />
  );
}

/** Approximate alpha blend toward transparent (15% opacity ≈ keep 15% of channel). */
function dimColor(color: string, opacity: number): string {
  const hex = color.trim();
  if (hex.startsWith("#") && (hex.length === 7 || hex.length === 4)) {
    const full =
      hex.length === 4
        ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
        : hex;
    const r = parseInt(full.slice(1, 3), 16);
    const g = parseInt(full.slice(3, 5), 16);
    const b = parseInt(full.slice(5, 7), 16);
    const a = Math.round(opacity * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${a}`;
  }
  return color;
}
