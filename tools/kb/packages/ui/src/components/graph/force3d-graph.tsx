/**
 * V3 force3d renderer — lazy-loaded in its own chunk (must not join graph-page).
 * three stays in this chunk only (task 16a).
 */
import { useEffect, useRef } from "react";
import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import { CanvasTexture, type Object3D, Sprite, SpriteMaterial } from "./force3d-three";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { force3dColor, readTokenColor } from "@/lib/css-color";
import { graphNodeAlpha, withGraphAlpha } from "@/lib/graph-dim";
import { formatGraphLabel } from "@/lib/graph-label";
import { fibonacciSphere } from "@/lib/convex-hull";
import { force3dCameraControls, type GraphCameraControls } from "./graph-camera-controls";
import { selectionFromNode, type GraphSelection } from "./graph-selection";

export interface Force3dGraphProps {
  nodes: LensNode[];
  edges: LensEdge[];
  layoutKey: string;
  themeKey: string;
  onControlsReady?: (controls: GraphCameraControls | null) => void;
  onSelectionChange?: (sel: GraphSelection | null) => void;
  selectedNodeId?: string | null;
  curvedLinks?: boolean;
  autorotate?: boolean;
  showLabels?: boolean;
  /** Top-N sprite labels by size. */
  labelTopN?: number;
}

type FgNode = {
  id: string;
  name: string;
  color: string;
  val: number;
  clusterKey: string;
  tags: string[];
  degree: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
};

type FgLink = {
  source: string | FgNode;
  target: string | FgNode;
  kind: string;
  weight: number;
};

type Vec3 = { x: number; y: number; z: number };

function linkEndId(end: string | FgNode): string {
  return typeof end === "string" ? end : end.id;
}

function makeLabelSprite(text: string, color: string): Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const fontSize = 28;
  ctx.font = `600 ${fontSize}px Outfit Variable, ui-sans-serif, system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  canvas.width = w;
  canvas.height = fontSize + 12;
  ctx.font = `600 ${fontSize}px Outfit Variable, ui-sans-serif, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, canvas.height / 2);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(w / 40, canvas.height / 40, 1);
  return sprite;
}

export default function Force3dGraph({
  nodes,
  edges,
  layoutKey,
  themeKey,
  onControlsReady,
  onSelectionChange,
  selectedNodeId = null,
  curvedLinks = false,
  autorotate = false,
  showLabels = true,
  labelTopN = 24,
}: Force3dGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const positionsRef = useRef<Map<string, Vec3>>(new Map());
  const cameraRef = useRef<Vec3 | null>(null);
  const layoutKeyRef = useRef(layoutKey);
  const nodeSetRef = useRef("");
  const selectedRef = useRef(selectedNodeId);
  selectedRef.current = selectedNodeId;
  const onSelRef = useRef(onSelectionChange);
  onSelRef.current = onSelectionChange;
  const onControlsReadyRef = useRef(onControlsReady);
  onControlsReadyRef.current = onControlsReady;
  const neighborsRef = useRef<Map<string, Set<string>>>(new Map());

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    try {
      graphRef.current?._destructor();
    } catch {
      /* */
    }
    graphRef.current = null;

    const nodeSetKey = nodes
      .map((node) => node.id)
      .toSorted()
      .join("|");
    if (layoutKeyRef.current !== layoutKey || nodeSetRef.current !== nodeSetKey) {
      positionsRef.current = new Map();
      cameraRef.current = null;
      layoutKeyRef.current = layoutKey;
      nodeSetRef.current = nodeSetKey;
    }

    const background = force3dColor(readTokenColor("--background", { fallback: "rgb(20,20,20)" }));
    const linkBase = force3dColor(
      readTokenColor("--foreground", {
        alpha: 0.35,
        fallback: "rgba(200,200,200,0.35)",
      }),
    );
    const labelColor = force3dColor(readTokenColor("--foreground", { fallback: "rgb(34,34,34)" }));

    const clusters = [...new Set(nodes.map((n) => n.clusterKey))].toSorted();
    const attractors = new Map<string, Vec3>();
    const radius = 120 + clusters.length * 20;
    clusters.forEach((key, i) => {
      attractors.set(key, fibonacciSphere(i, Math.max(clusters.length, 1), radius));
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
        color: force3dColor(n.color),
        val: n.size,
        clusterKey: n.clusterKey,
        tags: n.tags,
        degree: n.degree,
        x: pos.x,
        y: pos.y,
        z: pos.z,
      };
    });
    positionsRef.current = nextPositions;

    const idSet = new Set(nodes.map((n) => n.id));
    const fgLinks: FgLink[] = edges
      .filter((e) => idSet.has(e.source) && idSet.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        kind: e.kind,
        weight: e.weight,
      }));

    const neighbors = new Map<string, Set<string>>();
    for (const n of fgNodes) neighbors.set(n.id, new Set());
    for (const e of fgLinks) {
      const source = e.source as string;
      const target = e.target as string;
      neighbors.get(source)?.add(target);
      neighbors.get(target)?.add(source);
    }
    neighborsRef.current = neighbors;

    const labelIds = new Set(
      [...nodes]
        .toSorted((a, b) => b.size - a.size || a.id.localeCompare(b.id))
        .slice(0, showLabels ? labelTopN : 0)
        .map((n) => n.id),
    );

    const alphaFor = (id: string): number => {
      const sel = selectedRef.current;
      if (!sel) return 1;
      const ring = neighborsRef.current.get(sel) ?? new Set();
      return graphNodeAlpha({
        includedByFilter: true,
        includedBySearch: true,
        includedByFocus: id === sel || ring.has(id),
      });
    };

    const Graph = new ForceGraph3D(el)
      .backgroundColor(background)
      .showNavInfo(false)
      .nodeResolution(24)
      .graphData({ nodes: fgNodes, links: fgLinks })
      .nodeId("id")
      .nodeLabel((n: object) => {
        const node = n as FgNode;
        const tags = node.tags.slice(0, 3).join(", ");
        return `<div style="font:12px Outfit Variable,sans-serif"><b>${node.name}</b><br/>${tags ? `${tags}<br/>` : ""}${node.degree} connections</div>`;
      })
      .nodeColor((n: object) => {
        const node = n as FgNode;
        return withGraphAlpha(node.color, alphaFor(node.id));
      })
      .nodeVal((n: object) => (n as FgNode).val);

    if (showLabels) {
      Graph.nodeThreeObject((n: object) => {
        const node = n as FgNode;
        if (!labelIds.has(node.id)) return undefined as unknown as Object3D;
        return makeLabelSprite(formatGraphLabel(node.name, node.val), labelColor);
      }).nodeThreeObjectExtend(true);
    }

    Graph.linkWidth((l: object) => {
      const link = l as FgLink;
      const base = Math.max(0.8, Math.min(3, Math.sqrt(link.weight) * 0.4));
      const sel = selectedRef.current;
      if (!sel) return base;
      const s = linkEndId(link.source);
      const t = linkEndId(link.target);
      return s === sel || t === sel ? base * 2 : base * 0.3;
    })
      .linkColor((l: object) => {
        const link = l as FgLink;
        const sel = selectedRef.current;
        if (!sel) return withGraphAlpha(linkBase, 1);
        const s = linkEndId(link.source);
        const t = linkEndId(link.target);
        return s === sel || t === sel
          ? withGraphAlpha(linkBase, 1)
          : withGraphAlpha(linkBase, 0.08);
      })
      .linkDirectionalArrowLength(3.5)
      .linkDirectionalArrowRelPos(1)
      .linkCurvature(curvedLinks ? 0.25 : 0)
      .linkDirectionalParticles((l: object) => {
        const link = l as FgLink;
        const sel = selectedRef.current;
        if (!sel) return 1;
        const s = linkEndId(link.source);
        const t = linkEndId(link.target);
        return s === sel || t === sel ? 4 : 0;
      })
      .linkDirectionalParticleSpeed((l: object) => {
        const link = l as FgLink;
        const sel = selectedRef.current;
        if (!sel) return 0.004;
        const s = linkEndId(link.source);
        const t = linkEndId(link.target);
        return s === sel || t === sel ? 0.015 : 0.004;
      })
      .linkDirectionalParticleWidth((l: object) => {
        const link = l as FgLink;
        const sel = selectedRef.current;
        if (!sel) return 1.2;
        const s = linkEndId(link.source);
        const t = linkEndId(link.target);
        return s === sel || t === sel ? 2.5 : 1.2;
      })
      .onEngineStop(() => {
        try {
          Graph.zoomToFit(600, 40);
        } catch {
          /* torn down */
        }
      })
      .onNodeClick((n: object) => {
        const node = n as FgNode;
        if (!node.id) return;
        const meta = nodes.find((x) => x.id === node.id);
        onSelRef.current?.(
          meta
            ? selectionFromNode(meta)
            : {
                nodeId: node.id,
                label: node.name,
                tags: node.tags,
                degree: node.degree,
              },
        );
        selectedRef.current = node.id;
        try {
          const dist = Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0) || 1;
          const offset = 120;
          const lookAt = { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 };
          Graph.cameraPosition(
            {
              x: lookAt.x + (lookAt.x / dist) * offset,
              y: lookAt.y + (lookAt.y / dist) * offset,
              z: lookAt.z + (lookAt.z / dist) * offset,
            },
            lookAt,
            1200,
          );
        } catch {
          /* */
        }
      })
      .onBackgroundClick(() => {
        selectedRef.current = null;
        onSelRef.current?.(null);
      });

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

    try {
      const controls = Graph.controls() as {
        autoRotate?: boolean;
        autoRotateSpeed?: number;
      } | null;
      if (controls) {
        controls.autoRotate = autorotate;
        controls.autoRotateSpeed = 1.0;
      }
    } catch {
      /* */
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
    onControlsReadyRef.current?.(force3dCameraControls(() => graphRef.current));
    // Browser render harness only: 3d-force-graph keeps simulation state private.
    if (import.meta.env.MODE === "test-render") {
      (el as HTMLDivElement & { __kbForceGraph?: ForceGraph3DInstance }).__kbForceGraph = Graph;
    }

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
      onControlsReadyRef.current?.(null);
      delete (el as HTMLDivElement & { __kbForceGraph?: ForceGraph3DInstance }).__kbForceGraph;
      el.replaceChildren();
    };
  }, [nodes, edges, layoutKey, themeKey, curvedLinks, autorotate, showLabels, labelTopN]);

  // Sync external clear — accessors read selectedRef each frame.
  useEffect(() => {
    selectedRef.current = selectedNodeId;
  }, [selectedNodeId]);

  return <div ref={containerRef} className="h-full w-full min-h-0" data-testid="force3d-graph" />;
}
