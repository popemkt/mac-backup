import { useCallback, useMemo, useRef, useState } from "react";
import {
  hierarchy,
  tree as d3Tree,
  type HierarchyPointLink,
  type HierarchyPointNode,
} from "d3-hierarchy";
import type { LensTreeNode } from "@/lib/graph-lens";
import { readTokenColor } from "@/lib/css-color";

interface TreeGraphProps {
  forest: LensTreeNode[];
  onNodeClick: (id: string) => void;
  themeKey: string;
}

interface HierDatum {
  id: string;
  label: string;
  color: string;
  size: number;
  children?: HierDatum[];
}

function filterCollapsed(
  n: LensTreeNode,
  collapsed: Set<string>,
): HierDatum {
  return {
    id: n.id,
    label: n.label,
    color: n.color,
    size: n.size,
    children: collapsed.has(n.id)
      ? undefined
      : n.children.length > 0
        ? n.children.map((c) => filterCollapsed(c, collapsed))
        : undefined,
  };
}

function forestFind(forest: LensTreeNode[], id: string): LensTreeNode | null {
  for (const n of forest) {
    if (n.id === id) return n;
    const hit = forestFind(n.children, id);
    if (hit) return hit;
  }
  return null;
}

export function TreeGraph({ forest, onNodeClick, themeKey }: TreeGraphProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const tokens = useMemo(() => {
    void themeKey;
    return {
      labelColor: readTokenColor("--foreground", {
        fallback: "rgb(34,34,34)",
      }),
      linkColor: readTokenColor("--foreground", {
        alpha: 0.2,
        fallback: "rgba(128,128,128,0.2)",
      }),
    };
  }, [themeKey]);

  const layout = useMemo(() => {
    if (forest.length === 0) {
      return {
        nodes: [] as HierarchyPointNode<HierDatum>[],
        links: [] as HierarchyPointLink<HierDatum>[],
        width: 400,
        height: 200,
        originX: 0,
        originY: 0,
      };
    }

    const rootData: HierDatum =
      forest.length === 1
        ? filterCollapsed(forest[0]!, collapsed)
        : {
            id: "__forest__",
            label: "",
            color: "transparent",
            size: 0,
            children: forest.map((n) => filterCollapsed(n, collapsed)),
          };

    const root = hierarchy(rootData);
    const treeLayout = d3Tree<HierDatum>().nodeSize([28, 160]);
    const laid = treeLayout(root);
    const pts = laid.descendants().filter((d) => d.data.id !== "__forest__");
    const edges = laid
      .links()
      .filter(
        (l) =>
          l.source.data.id !== "__forest__" &&
          l.target.data.id !== "__forest__",
      );

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const d of pts) {
      minX = Math.min(minX, d.y);
      maxX = Math.max(maxX, d.y);
      minY = Math.min(minY, d.x);
      maxY = Math.max(maxY, d.x);
    }
    const pad = 40;
    return {
      nodes: pts,
      links: edges,
      width: Math.max(400, maxX - minX + pad * 2),
      height: Math.max(200, maxY - minY + pad * 2),
      originX: (Number.isFinite(minX) ? minX : 0) - pad,
      originY: (Number.isFinite(minY) ? minY : 0) - pad,
    };
  }, [forest, collapsed]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.2, Math.min(3, z * delta)));
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setPan({ x: dragState.current.panX + dx, y: dragState.current.panY + dy });
  }, []);

  const handlePointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const fitTreeView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const collapseAll = useCallback(() => {
    const ids = new Set<string>();
    function collect(nodes: LensTreeNode[]) {
      for (const n of nodes) {
        if (n.children.length > 0) { ids.add(n.id); collect(n.children); }
      }
    }
    collect(forest);
    setCollapsed(ids);
  }, [forest]);

  const expandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full min-h-0 overflow-hidden select-none"
      data-testid="tree-graph"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-foreground/8 bg-popover/90 p-1 shadow-lg backdrop-blur-sm">
        <button type="button" className="px-2 py-0.5 text-[11px] text-foreground/60 hover:text-foreground/80" onClick={fitTreeView} title="Fit view">Fit</button>
        <button type="button" className="px-2 py-0.5 text-[11px] text-foreground/60 hover:text-foreground/80" onClick={collapseAll} title="Collapse all">−All</button>
        <button type="button" className="px-2 py-0.5 text-[11px] text-foreground/60 hover:text-foreground/80" onClick={expandAll} title="Expand all">+All</button>
      </div>
      <svg
        key={themeKey}
        width={layout.width}
        height={layout.height}
        className="block"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
      >
        <g transform={`translate(${-layout.originX},${-layout.originY})`}>
          {layout.links.map((l, i) => (
            <path
              key={i}
              d={`M${l.source.y},${l.source.x}C${(l.source.y + l.target.y) / 2},${l.source.x} ${(l.source.y + l.target.y) / 2},${l.target.x} ${l.target.y},${l.target.x}`}
              fill="none"
              stroke={tokens.linkColor}
              strokeWidth={1}
            />
          ))}
          {layout.nodes.map((d) => {
            const hasKids =
              (forestFind(forest, d.data.id)?.children.length ?? 0) > 0;
            const isCollapsed = collapsed.has(d.data.id);
            return (
              <g
                key={d.data.id}
                transform={`translate(${d.y},${d.x})`}
                className="cursor-pointer"
                onClick={() => onNodeClick(d.data.id)}
              >
                {hasKids ? (
                  <circle
                    r={7}
                    fill="transparent"
                    stroke={d.data.color}
                    strokeWidth={1.5}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.data.id)) next.delete(d.data.id);
                        else next.add(d.data.id);
                        return next;
                      });
                    }}
                  />
                ) : null}
                <circle
                  r={isCollapsed || !hasKids ? 4.5 : 3}
                  fill={d.data.color}
                />
                <text
                  x={10}
                  y={4}
                  fontSize={11}
                  fill={tokens.labelColor}
                  style={{
                    fontFamily:
                      "Outfit Variable, ui-sans-serif, system-ui, sans-serif",
                  }}
                >
                  {d.data.label || d.data.id}
                  {isCollapsed && hasKids ? " …" : ""}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
