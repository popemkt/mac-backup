import { useMemo, useState } from "react";
import { Funnel, X } from "@phosphor-icons/react";
import type { LensNode } from "@/lib/graph-lens";
import { cn } from "@/lib/cn";

interface GraphLegendProps {
  nodes: LensNode[];
  onFilterChange: (ids: Set<string> | null) => void;
}

interface TagBucket {
  tag: string;
  color: string;
  nodeIds: string[];
}

export function GraphLegend({ nodes, onFilterChange }: GraphLegendProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const buckets = useMemo(() => {
    const map = new Map<string, { color: string; ids: string[] }>();
    for (const node of nodes) {
      const tag = node.tags[0] ?? "untagged";
      let entry = map.get(tag);
      if (!entry) {
        entry = { color: node.color, ids: [] };
        map.set(tag, entry);
      }
      entry.ids.push(node.id);
    }
    const result: TagBucket[] = [];
    for (const [tag, { color, ids }] of map) {
      result.push({ tag, color, nodeIds: ids });
    }
    result.sort((a, b) => b.nodeIds.length - a.nodeIds.length);
    return result.slice(0, 20);
  }, [nodes]);

  const toggleFilter = (tag: string) => {
    const next = new Set(activeFilters);
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    setActiveFilters(next);

    if (next.size === 0) {
      onFilterChange(null);
    } else {
      const ids = new Set<string>();
      for (const bucket of buckets) {
        if (next.has(bucket.tag)) {
          for (const id of bucket.nodeIds) ids.add(id);
        }
      }
      onFilterChange(ids);
    }
  };

  const clearFilters = () => {
    setActiveFilters(new Set());
    onFilterChange(null);
  };

  if (buckets.length <= 1) return null;

  return (
    <div className="absolute left-3 top-3 z-20 flex flex-col rounded-lg border border-foreground/8 bg-popover/90 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-foreground/60 hover:text-foreground/80"
        onClick={() => setCollapsed((v) => !v)}
        aria-label={collapsed ? "Expand legend" : "Collapse legend"}
      >
        <Funnel size={12} />
        <span>Legend</span>
        {activeFilters.size > 0 && (
          <span className="rounded bg-foreground/[0.08] px-1 text-[10px]">
            {activeFilters.size}
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto px-1 pb-1.5">
          {activeFilters.size > 0 && (
            <button
              type="button"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-foreground/50 hover:bg-foreground/5"
              onClick={clearFilters}
            >
              <X size={10} /> Clear filters
            </button>
          )}
          {buckets.map((b) => (
            <button
              key={b.tag}
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] transition-colors hover:bg-foreground/5",
                activeFilters.size > 0 && !activeFilters.has(b.tag)
                  ? "text-foreground/30"
                  : "text-foreground/70",
              )}
              onClick={() => toggleFilter(b.tag)}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: b.color }}
              />
              <span className="truncate max-w-[120px]">{b.tag}</span>
              <span className="ml-auto text-[10px] text-foreground/30">{b.nodeIds.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
