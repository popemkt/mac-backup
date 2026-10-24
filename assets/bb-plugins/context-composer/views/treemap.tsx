// Token weight as area: each source a block, its artifacts tiles inside it. Click a tile to keep or drop it.
import { useMemo, useState } from "react";
import { isIncluded, isRemovable, KIND_LABELS, type ArtifactKind } from "../core/model.ts";
import { treemap, weightTree, type Grouping } from "../core/views.ts";
import type { ViewProps } from "./types.ts";

const W = 960;
const H = 560;

const HUE: Record<ArtifactKind, number> = {
  instruction: 210,
  memory: 190,
  skill: 140,
  "mcp-server": 30,
  tool: 280,
  hook: 330,
  subagent: 260,
  "output-style": 170,
  system: 0,
  conversation: 50,
};

export function TreemapView(p: ViewProps) {
  const [by, setBy] = useState<Grouping>("source");
  const [onDemand, setOnDemand] = useState(false);
  const tiles = useMemo(() => treemap(weightTree(p.composition, p.manifest, by, { onDemand }), { x: 0, y: 0, w: W, h: H }), [p.composition, p.manifest, by, onDemand]);
  const unknown = p.composition.artifacts.filter(a => a.active && a.tokens.value === null).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Area is tokens{onDemand ? ", including what loads only when used" : " at session start"}. Faded tiles are dropped.</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={onDemand} onChange={e => setOnDemand(e.target.checked)} />
          on-demand weight (MCP tools behind tool search)
        </label>
        {unknown > 0 ? <span>{unknown} artifacts have no weight and are not drawn.</span> : null}
        <span className="ml-auto">Group by</span>
        {(["source", "kind"] as const).map(g => (
          <button key={g} type="button" aria-pressed={by === g} onClick={() => setBy(g)} className="rounded px-2 py-1 hover:bg-state-hover aria-pressed:bg-state-active">
            {g}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-md border border-border" role="img" aria-label="Token weight by source">
        {tiles.map(t => {
          const a = t.node.artifact;
          if (t.depth === 1) {
            return (
              <g key={`g:${t.node.id}`}>
                <rect x={t.x} y={t.y} width={t.w} height={t.h} fill="none" stroke="currentColor" strokeOpacity={0.35} />
                {t.w > 60 ? (
                  <text x={t.x + 4} y={t.y + 12} fontSize={10} fill="currentColor" opacity={0.8}>
                    {`${t.node.label} · ${t.node.tokens.toLocaleString("en-US")}`.slice(0, Math.floor(t.w / 6))}
                  </text>
                ) : null}
              </g>
            );
          }
          if (a === undefined) return null;
          const kept = isIncluded(a, p.manifest);
          const removable = isRemovable(a);
          const lever = p.leverOf(a);
          return (
            <g key={a.id} onClick={removable ? () => p.toggle(a) : undefined} style={{ cursor: removable ? "pointer" : "default" }}>
              <title>{`${a.name} (${KIND_LABELS[a.kind]}), ${t.node.tokens.toLocaleString("en-US")} tokens, ${kept ? "kept" : "dropped"}; removal ${lever.enforcement}: ${lever.via}`}</title>
              <rect
                x={t.x}
                y={t.y}
                width={Math.max(0, t.w - 1)}
                height={Math.max(0, t.h - 1)}
                fill={`hsl(${HUE[a.kind]} 55% 50%)`}
                fillOpacity={kept ? 0.55 : 0.12}
                stroke={lever.enforcement === "advisory" && !kept ? "hsl(40 90% 50%)" : "none"}
                strokeDasharray="3 2"
              />
              {t.w > 40 && t.h > 14 ? (
                <text x={t.x + 3} y={t.y + 11} fontSize={9} fill="currentColor" opacity={kept ? 0.95 : 0.45}>
                  {a.name.slice(0, Math.floor(t.w / 5.5))}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        {(Object.keys(HUE) as ArtifactKind[]).map(k => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm" style={{ background: `hsl(${HUE[k]} 55% 50%)` }} />
            {KIND_LABELS[k]}
          </span>
        ))}
        <span>Dashed outline: dropped, but only advisory on this target.</span>
      </div>
    </div>
  );
}
