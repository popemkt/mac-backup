/**
 * V3 force3d renderer — lazy-loaded in its own chunk (must not join graph-page).
 */
import { useEffect, useRef } from "react";
import ForceGraph3D, {
  type ForceGraph3DInstance,
} from "3d-force-graph";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { readTokenColor } from "@/lib/css-color";
import { fibonacciSphere } from "@/lib/convex-hull";

export interface Force3dGraphProps {
  nodes: LensNode[];
  edges: LensEdge[];
  onNodeClick: (id: string) => void;
  layoutKey: string;
  themeKey: string;
}

type FgNode = {
  id: string;
  name: string;
  color: string;
  val: number;
  clusterKey: string;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
};

type FgLink = { source: string; target: string; kind: string };

type Vec3 = { x: number; y: number; z: number };

export default function Force3dGraph({
  nodes,
  edges,
  onNodeClick,
  layoutKey,
  themeKey,
}: Force3dGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const positionsRef = useRef<Map<string, Vec3>>(new Map());
  const cameraRef = useRef<Vec3 | null>(null);
  const layoutKeyRef = useRef(layoutKey);
  const nodeSetRef = useRef("");
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    try {
      graphRef.current?._destructor();
    } catch {
      /* */
    }
    graphRef.current = null;

    const nodeSetKey = nodes.map((node) => node.id).sort().join("|");
    if (layoutKeyRef.current !== layoutKey || nodeSetRef.current !== nodeSetKey) {
      positionsRef.current = new Map();
      cameraRef.current = null;
      layoutKeyRef.current = layoutKey;
      nodeSetRef.current = nodeSetKey;
    }

    const background = readTokenColor("--background", {
      fallback: "rgb(20,20,20)",
    });
    const linkColor = readTokenColor("--foreground", {
      alpha: 0.25,
      fallback: "rgba(200,200,200,0.25)",
    });

    const clusters = [...new Set(nodes.map((n) => n.clusterKey))].sort();
    const attractors = new Map<string, Vec3>();
    const radius = 120 + clusters.length * 20;
    clusters.forEach((key, i) => {
      attractors.set(
        key,
        fibonacciSphere(i, Math.max(clusters.length, 1), radius),
      );
    });

    const prev = positionsRef.current;
    const nextPositions = new Map<string, Vec3>();

    const fgNodes: FgNode[] = nodes.map((n) => {
      const a = attractors.get(n.clusterKey) ?? { x: 0, y: 0, z: 0 };
      const prior = prev.get(n.id);
      const pos = prior ?? {
        x: a.x + (Math.random() - 0.5) * 20,
        y: a.y + (Math.random() - 0.5) * 20,
        z: a.z + (Math.random() - 0.5) * 20,
      };
      nextPositions.set(n.id, pos);
      return {
        id: n.id,
        name: n.label,
        color: n.color,
        val: n.size,
        clusterKey: n.clusterKey,
        x: pos.x,
        y: pos.y,
        z: pos.z,
      };
    });
    positionsRef.current = nextPositions;

    const idSet = new Set(nodes.map((n) => n.id));
    const fgLinks: FgLink[] = edges
      .filter((e) => idSet.has(e.source) && idSet.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, kind: e.kind }));

    const Graph = new ForceGraph3D(el)
      .backgroundColor(background)
      .showNavInfo(false)
      .graphData({ nodes: fgNodes, links: fgLinks })
      .nodeId("id")
      .nodeLabel("name")
      .nodeColor((n: object) => (n as FgNode).color)
      .nodeVal((n: object) => (n as FgNode).val)
      .linkColor(() => linkColor)
      .onEngineStop(() => {
        try {
          Graph.zoomToFit(600, 40);
        } catch {
          // The renderer may have been torn down while the engine was stopping.
        }
      })
      .onNodeClick((n: object) => {
        const id = (n as FgNode).id;
        if (id) onClickRef.current(id);
      });

    // Cluster gravity must cool with simulation alpha. A permanent pull to a
    // single attractor beats charge repulsion and collapses the whole scene.
    const clusterForce = (axis: "x" | "y" | "z") => (alpha: number) => {
      for (const node of fgNodes) {
        const attractor = attractors.get(node.clusterKey);
        if (!attractor) continue;
        const pull = (attractor[axis] - (node[axis] ?? 0)) * 0.15 * alpha;
        if (axis === "x") node.vx = (node.vx ?? 0) + pull;
        if (axis === "y") node.vy = (node.vy ?? 0) + pull;
        if (axis === "z") node.vz = (node.vz ?? 0) + pull;
      }
    };
    if (clusters.length >= 2) {
      Graph.d3Force("x", clusterForce("x"));
      Graph.d3Force("y", clusterForce("y"));
      Graph.d3Force("z", clusterForce("z"));
    } else {
      Graph.d3Force("x", null);
      Graph.d3Force("y", null);
      Graph.d3Force("z", null);
    }

    if (cameraRef.current) {
      const c = cameraRef.current;
      try {
        Graph.cameraPosition({ x: c.x, y: c.y, z: c.z });
      } catch {
        /* */
      }
    }

    graphRef.current = Graph;

    const ro = new ResizeObserver(() => {
      Graph.width(el.clientWidth).height(el.clientHeight);
    });
    ro.observe(el);
    Graph.width(el.clientWidth).height(el.clientHeight);

    return () => {
      ro.disconnect();
      try {
        const cam = Graph.cameraPosition();
        if (
          cam &&
          typeof cam.x === "number" &&
          typeof cam.y === "number" &&
          typeof cam.z === "number"
        ) {
          cameraRef.current = { x: cam.x, y: cam.y, z: cam.z };
        }
      } catch {
        /* */
      }
      try {
        const data = Graph.graphData() as unknown as { nodes?: FgNode[] };
        const snap = new Map<string, Vec3>();
        for (const n of data.nodes ?? fgNodes) {
          if (
            n.id &&
            typeof n.x === "number" &&
            typeof n.y === "number" &&
            typeof n.z === "number"
          ) {
            snap.set(n.id, { x: n.x, y: n.y, z: n.z });
          }
        }
        if (snap.size > 0) positionsRef.current = snap;
      } catch {
        /* */
      }
      try {
        Graph._destructor();
      } catch {
        /* */
      }
      graphRef.current = null;
      el.replaceChildren();
    };
  }, [nodes, edges, layoutKey, themeKey]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full min-h-0"
      data-testid="force3d-graph"
    />
  );
}
