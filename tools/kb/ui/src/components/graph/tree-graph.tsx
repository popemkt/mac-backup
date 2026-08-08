import { useMemo, useState } from "react";
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
  void themeKey;

  const labelColor = readTokenColor("--foreground", {
    fallback: "rgb(34,34,34)",
  });
  const linkColor = readTokenColor("--foreground", {
    alpha: 0.2,
    fallback: "rgba(128,128,128,0.2)",
  });

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

  return (
    <div
      className="h-full w-full min-h-0 overflow-auto"
      data-testid="tree-graph"
    >
      <svg width={layout.width} height={layout.height} className="block">
        <g transform={`translate(${-layout.originX},${-layout.originY})`}>
          {layout.links.map((l, i) => (
            <path
              key={i}
              d={`M${l.source.y},${l.source.x}C${(l.source.y + l.target.y) / 2},${l.source.x} ${(l.source.y + l.target.y) / 2},${l.target.x} ${l.target.y},${l.target.x}`}
              fill="none"
              stroke={linkColor}
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
                  fill={labelColor}
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
