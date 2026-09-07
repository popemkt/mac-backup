import { useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, treemap } from "d3-hierarchy";
import type { LensNode } from "@/lib/graph-lens";
import { graphNodeAlpha } from "@/lib/graph-dim";
import { selectionFromNode } from "./graph-selection";
import type { GraphAdapterProps } from "./graph-renderers";

interface AreaNode {
  label: string;
  node?: LensNode;
  children?: AreaNode[];
}

/** Area is an encoding, not a second data model. Zero measures have no area. */
export function TreemapGraph({
  lensGraph,
  active,
  selection,
  setSelection,
  setControls,
  searchHighlight,
  filterIds,
  onNodeOpen,
}: GraphAdapterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    setControls(null);
    const root = rootRef.current;
    if (!root) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [setControls]);

  const layout = useMemo(() => {
    const groups = new Map<string, AreaNode & { children: AreaNode[] }>();
    for (const node of lensGraph.nodes) {
      if (!(Number.isFinite(node.weight) && (node.weight ?? 0) > 0)) continue;
      let group = groups.get(node.clusterKey);
      if (!group) {
        group = { label: node.clusterLabel ?? "All nodes", children: [] };
        groups.set(node.clusterKey, group);
      }
      group.children.push({ label: node.label, node });
    }
    const root = hierarchy<AreaNode>({ label: "", children: [...groups.values()] })
      .sum((d) => d.node?.weight ?? 0)
      // oxlint-disable-next-line unicorn/no-array-sort -- D3 hierarchy.sort orders hierarchy nodes; it is not Array.sort.
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.data.label.localeCompare(b.data.label));
    return treemap<AreaNode>()
      .size([Math.max(0, size.width), Math.max(0, size.height)])
      .paddingOuter(8)
      .paddingInner(3)
      .paddingTop((d) => (d.depth === 1 ? 26 : 8))
      .round(true)(root);
  }, [lensGraph.nodes, size]);
  const omitted = lensGraph.nodes.filter(
    (n) => !(Number.isFinite(n.weight) && (n.weight ?? 0) > 0),
  );

  return (
    <div className="absolute inset-0 flex flex-col px-3 pb-16 pt-16" data-testid="treemap-graph">
      <div ref={rootRef} className="relative min-h-0 flex-1" onClick={() => setSelection(null)}>
        {layout.children?.map((group) => (
          <div
            key={group.data.label + group.x0}
            className="pointer-events-none absolute overflow-hidden rounded-lg border border-foreground/10 bg-foreground/[0.02]"
            style={{
              left: group.x0,
              top: group.y0,
              width: group.x1 - group.x0,
              height: group.y1 - group.y0,
            }}
          >
            <p
              className="truncate px-2 pt-1 text-[11px] font-medium text-foreground/55"
              title={group.data.label}
            >
              {group.data.label}
            </p>
          </div>
        ))}
        {layout.leaves().map((cell) => {
          const node = cell.data.node;
          if (!node) return null;
          const width = cell.x1 - cell.x0,
            height = cell.y1 - cell.y0;
          const selected = node.id === selection?.nodeId;
          return (
            <button
              key={node.id}
              type="button"
              data-treemap-node={node.id}
              aria-label={node.label}
              aria-pressed={selected}
              title={`${node.label} · ${node.weight}`}
              className="absolute overflow-hidden rounded-md border border-foreground/10 p-2 text-left text-foreground transition-opacity hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-ring"
              style={{
                left: cell.x0,
                top: cell.y0,
                width,
                height,
                backgroundColor: `color-mix(in srgb, ${node.color} 22%, var(--background))`,
                boxShadow: selected ? `inset 0 0 0 2px ${node.color}` : undefined,
                opacity: graphNodeAlpha({
                  includedByFilter: !filterIds || filterIds.has(node.id),
                  includedBySearch: !searchHighlight || searchHighlight.has(node.id),
                  includedByFocus: true,
                }),
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSelection(selectionFromNode(node));
              }}
              onDoubleClick={() => onNodeOpen(node.id)}
            >
              {active.showLabels && width > 54 && height > 34 ? (
                <span className="block truncate text-xs font-medium">{node.label}</span>
              ) : null}
              {width > 70 && height > 60 ? (
                <span className="block text-[11px] tabular-nums text-foreground/50">
                  {node.weight}
                </span>
              ) : null}
            </button>
          );
        })}
        {(layout.value ?? 0) <= 0 ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-foreground/50">
            No positive values to map. Choose Uniform or another area source in Graph settings.
          </p>
        ) : null}
      </div>
      {omitted.length ? (
        <p className="px-2 text-[11px] text-foreground/45">
          {omitted.length} nodes have zero or missing area. Choose Uniform to show every node.
        </p>
      ) : null}
    </div>
  );
}
