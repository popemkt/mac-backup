import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { hierarchy, tree as d3Tree } from "d3-hierarchy";
import type { LensTreeNode, LensEdge } from "@/lib/graph-lens";
import { readTokenColor } from "@/lib/css-color";
import { GRAPH_LABEL_FONT, GRAPH_LABEL_WIDTH, wrapGraphLabel } from "@/lib/graph-label";
import { graphEmphasisAlpha, graphNeighborhood, type GraphEmphasis } from "@/lib/graph-interaction";
import {
  treeCameraControls,
  type GraphCameraControls,
  type TreeViewHandle,
} from "./graph-camera-controls";
import type { GraphSelection } from "./graph-selection";

interface TreeGraphProps extends GraphEmphasis {
  forest: LensTreeNode[];
  edges?: LensEdge[];
  themeKey: string;
  showLabels?: boolean;
  onSelectionChange?: (sel: GraphSelection | null) => void;
  onControlsReady?: (controls: GraphCameraControls | null) => void;
}
interface Datum {
  id: string;
  label: string;
  color: string;
  lines: string[];
  width: number;
  height: number;
  children?: Datum[];
}
const EMPTY_EDGES: LensEdge[] = [];

function forestFind(forest: LensTreeNode[], id: string): LensTreeNode | null {
  for (const node of forest) {
    if (node.id === id) return node;
    const found = forestFind(node.children, id);
    if (found) return found;
  }
  return null;
}
export function TreeGraph({
  forest,
  edges = EMPTY_EDGES,
  themeKey,
  showLabels = true,
  selectedNodeId = null,
  highlightIds,
  filterIds,
  onSelectionChange,
  onControlsReady,
}: TreeGraphProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) setFontRevision((v) => v + 1);
      return undefined;
    });
    return () => {
      active = false;
    };
  }, []);
  const layout = useMemo(() => {
    void fontRevision;
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) ctx.font = "11px " + GRAPH_LABEL_FONT;
    const measure = (text: string) => (ctx ? ctx.measureText(text).width : text.length * 6.5);
    const datum = (n: LensTreeNode): Datum => {
      const lines = showLabels ? wrapGraphLabel(n.label, measure) : [];
      return {
        id: n.id,
        label: n.label,
        color: n.color,
        lines,
        width: Math.max(18, ...lines.map(measure)) + 18,
        height: Math.max(16, lines.length * 15),
        children: collapsed.has(n.id) ? undefined : n.children.map(datum),
      };
    };
    const root = hierarchy<Datum>({
      id: "__forest__",
      label: "",
      color: "transparent",
      lines: [],
      width: 0,
      height: 0,
      children: forest.map(datum),
    });
    const laid = d3Tree<Datum>()
      .nodeSize([1, GRAPH_LABEL_WIDTH + 56])
      .separation((a, b) => (a.data.height + b.data.height) / 2 + 18)(root);
    const nodes = laid.descendants().filter((n) => n.data.id !== "__forest__");
    const links = laid.links().filter((l) => l.source.data.id !== "__forest__");
    const minX = nodes.length ? Math.min(...nodes.map((n) => n.y - 24)) : 0;
    const maxX = Math.max(100, ...nodes.map((n) => n.y + n.data.width));
    const minY = nodes.length ? Math.min(...nodes.map((n) => n.x - n.data.height / 2)) : 0;
    const maxY = Math.max(100, ...nodes.map((n) => n.x + n.data.height / 2));
    return {
      nodes,
      links,
      originX: minX - 20,
      originY: minY - 20,
      width: maxX - minX + 40,
      height: maxY - minY + 40,
    };
  }, [forest, collapsed, showLabels, fontRevision]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [focusId, setFocusId] = useState<string | null>(null);
  const cameraIntent = useRef(false);
  const collapseAnchor = useRef<{ id: string; x: number; y: number } | null>(null);
  const changeCollapsed = (next: Set<string>, anchorId?: string) => {
    const anchor =
      layout.nodes.find((n) => n.data.id === (anchorId ?? selectedNodeId)) ?? layout.nodes[0];
    collapseAnchor.current = anchor
      ? {
          id: anchor.data.id,
          x: view.x + (anchor.y - layout.originX) * view.zoom,
          y: view.y + (anchor.x - layout.originY) * view.zoom,
        }
      : null;
    cameraIntent.current = true;
    setCollapsed(next);
  };
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !el.clientWidth || !el.clientHeight) return;
    const width = Math.max(1, el.clientWidth - 48),
      height = Math.max(1, el.clientHeight - 100);
    const zoom = Math.max(0.01, Math.min(1, width / layout.width, height / layout.height));
    setView({
      zoom,
      x: (el.clientWidth - layout.width * zoom) / 2,
      y: 64 + (height - layout.height * zoom) / 2,
    });
  }, [layout]);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useLayoutEffect(() => {
    const anchor = collapseAnchor.current;
    collapseAnchor.current = null;
    const node = anchor && layout.nodes.find((n) => n.data.id === anchor.id);
    if (anchor && node) {
      setView((v) => ({
        ...v,
        x: anchor.x - (node.y - layout.originX) * v.zoom,
        y: anchor.y - (node.x - layout.originY) * v.zoom,
      }));
    } else if (!cameraIntent.current) fit();
  }, [fit, layout]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    let width = el.clientWidth,
      height = el.clientHeight;
    const observer = new ResizeObserver(() => {
      if (!cameraIntent.current) fitRef.current();
      else
        setView((v) => ({
          ...v,
          x: v.x + (el.clientWidth - width) / 2,
          y: v.y + (el.clientHeight - height) / 2,
        }));
      width = el.clientWidth;
      height = el.clientHeight;
    });
    observer.observe(el);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraIntent.current = true;
      setView((v) => ({
        ...v,
        zoom: Math.max(0.02, Math.min(3, v.zoom * (e.deltaY > 0 ? 0.9 : 1.1))),
      }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  const focus = useCallback(
    (id: string) => {
      if (!forestFind(forest, id)) return;
      // Search can reveal a node behind a collapsed branch without changing the query.
      const ancestors = new Set<string>();
      const visit = (nodes: LensTreeNode[], path: string[]): boolean =>
        nodes.some((n) => {
          if (n.id === id) {
            path.forEach((a) => ancestors.add(a));
            return true;
          }
          return visit(n.children, [...path, n.id]);
        });
      visit(forest, []);
      setCollapsed(
        (previous) => new Set([...previous].filter((candidate) => !ancestors.has(candidate))),
      );
      cameraIntent.current = true;
      setFocusId(id);
    },
    [forest],
  );
  useEffect(() => {
    if (focusId === null) return;
    const node = layout.nodes.find((n) => n.data.id === focusId),
      el = containerRef.current;
    if (!node || !el) return;
    setView({
      zoom: 1,
      x: el.clientWidth / 2 - (node.y - layout.originX) - node.data.width / 2,
      y: el.clientHeight / 2 - (node.x - layout.originY),
    });
    setFocusId(null);
  }, [focusId, layout]);
  const expandAll = () => {
    changeCollapsed(new Set());
  };
  const collapseAll = () => {
    const ids = new Set<string>();
    const visit = (nodes: LensTreeNode[]) => {
      for (const n of nodes) {
        if (n.children.length) ids.add(n.id);
        visit(n.children);
      }
    };
    visit(forest);
    changeCollapsed(ids);
  };
  const handle = useRef<TreeViewHandle | null>(null);
  handle.current = {
    fit: () => {
      cameraIntent.current = false;
      fit();
    },
    reset: () => {
      cameraIntent.current = false;
      fit();
    },
    zoomIn: () => {
      cameraIntent.current = true;
      setView((v) => ({ ...v, zoom: Math.min(3, v.zoom * 1.25) }));
    },
    zoomOut: () => {
      cameraIntent.current = true;
      setView((v) => ({ ...v, zoom: Math.max(0.02, v.zoom / 1.25) }));
    },
    focusNode: focus,
    expandAll,
    collapseAll,
  };
  const ready = useRef(onControlsReady);
  ready.current = onControlsReady;
  useEffect(() => {
    ready.current?.(treeCameraControls(() => handle.current));
    return () => ready.current?.(null);
  }, []);
  const neighborhood = useMemo(
    () => graphNeighborhood(selectedNodeId, edges),
    [selectedNodeId, edges],
  );
  const alpha = (id: string) => graphEmphasisAlpha(id, { highlightIds, filterIds }, neighborhood);
  const tokens = useMemo(() => {
    void themeKey;
    return {
      text: readTokenColor("--foreground", { fallback: "#222" }),
      line: readTokenColor("--foreground", { alpha: 0.22, fallback: "rgba(128,128,128,.22)" }),
    };
  }, [themeKey]);
  return (
    <div
      ref={containerRef}
      className="relative h-full w-full min-h-0 overflow-hidden select-none kb-workspace-reveal"
      data-testid="tree-graph"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        cameraIntent.current = true;
        suppressClick.current = false;
        drag.current = { x: e.clientX, y: e.clientY, panX: view.x, panY: view.y, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x,
          dy = e.clientY - d.y;
        if (Math.hypot(dx, dy) > 3) d.moved = true;
        if (d.moved) e.currentTarget.setPointerCapture(e.pointerId);
        if (d.moved) setView((v) => ({ ...v, x: d.panX + dx, y: d.panY + dy }));
      }}
      onPointerUp={() => {
        suppressClick.current = drag.current?.moved === true;
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onClick={() => {
        if (!suppressClick.current) onSelectionChange?.(null);
      }}
    >
      <svg
        width={layout.width}
        height={layout.height}
        className="block"
        style={{
          transform: "translate(" + view.x + "px, " + view.y + "px) scale(" + view.zoom + ")",
          transformOrigin: "0 0",
        }}
      >
        <g transform={"translate(" + -layout.originX + "," + -layout.originY + ")"}>
          {layout.links.map((l) => (
            <path
              key={l.target.data.id}
              d={
                "M" +
                l.source.y +
                "," +
                l.source.x +
                "C" +
                (l.source.y + l.target.y) / 2 +
                "," +
                l.source.x +
                " " +
                (l.source.y + l.target.y) / 2 +
                "," +
                l.target.x +
                " " +
                l.target.y +
                "," +
                l.target.x
              }
              fill="none"
              stroke={tokens.line}
              opacity={Math.min(alpha(l.source.data.id), alpha(l.target.data.id))}
              strokeWidth={
                selectedNodeId !== null &&
                (l.source.data.id === selectedNodeId || l.target.data.id === selectedNodeId)
                  ? 2
                  : 1
              }
            />
          ))}
          {layout.nodes.map((n) => {
            const original = forestFind(forest, n.data.id);
            if (!original) return null;
            const selected = n.data.id === selectedNodeId;
            return (
              <g
                key={n.data.id}
                data-node-id={n.data.id}
                transform={"translate(" + n.y + "," + n.x + ")"}
                opacity={alpha(n.data.id)}
                className="cursor-pointer"
                style={{ transition: "opacity 160ms ease" }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!suppressClick.current)
                    onSelectionChange?.({
                      nodeId: n.data.id,
                      label: n.data.label,
                      tags: [],
                      degree: original.children.length,
                    });
                }}
              >
                <title>{n.data.label}</title>
                {selected ? (
                  <circle r={10} fill="none" stroke={tokens.text} strokeWidth={1.5} />
                ) : null}
                <circle r={4.5} fill={n.data.color} />
                <text
                  x={12}
                  y={-(n.data.lines.length - 1) * 7.5 + 4}
                  fontSize={11}
                  fill={tokens.text}
                  fontWeight={selected ? 600 : 400}
                  style={{ fontFamily: GRAPH_LABEL_FONT }}
                >
                  {n.data.lines.map((line, index) => (
                    <tspan
                      key={n.data.lines.slice(0, index + 1).join("\n")}
                      x={12}
                      dy={index ? 15 : 0}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
                {original.children.length ? (
                  <g
                    role="button"
                    aria-label={(collapsed.has(n.data.id) ? "Expand " : "Collapse ") + n.data.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (suppressClick.current) return;
                      const next = new Set(collapsed);
                      if (next.has(n.data.id)) next.delete(n.data.id);
                      else next.add(n.data.id);
                      changeCollapsed(next, n.data.id);
                    }}
                  >
                    <circle cx={-17} r={7} fill="var(--background)" stroke={tokens.line} />
                    <text x={-17} y={3.5} fontSize={11} textAnchor="middle" fill={tokens.text}>
                      {collapsed.has(n.data.id) ? "+" : "−"}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
