// The basic view: artifacts by source, heaviest first, each with its weight, its lever on the target, and a toggle.
import { useMemo, useState } from "react";
import { isIncluded, isRemovable, KIND_LABELS, type Artifact } from "../core/model.ts";
import { weightTree, type Grouping } from "../core/views.ts";
import type { ViewProps } from "./types.ts";
import { LeverBadge, tokensLabel } from "./parts.tsx";

export function ListView(p: ViewProps) {
  const [by, setBy] = useState<Grouping>("source");
  const [query, setQuery] = useState("");
  const root = useMemo(() => weightTree(p.composition, p.manifest, by), [p.composition, p.manifest, by]);
  const q = query.trim().toLowerCase();
  const matches = (a: Artifact) => q === "" || `${a.name} ${a.description ?? ""} ${a.kind}`.toLowerCase().includes(q);
  const sources = new Map(p.composition.sources.map(s => [s.id, s]));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs">
        <input
          className="h-7 flex-1 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Filter artifacts"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <span className="text-muted-foreground">Group by</span>
        {(["source", "kind"] as const).map(g => (
          <button key={g} type="button" aria-pressed={by === g} onClick={() => setBy(g)} className="rounded px-2 py-1 hover:bg-state-hover aria-pressed:bg-state-active">
            {g}
          </button>
        ))}
      </div>
      {root.children.map(g => {
        const items = g.children.filter(n => n.artifact !== undefined && matches(n.artifact));
        if (items.length === 0) return null;
        const source = g.source ?? undefined;
        const removable = items.some(n => n.artifact !== undefined && isRemovable(n.artifact));
        return (
          <section key={g.id} className="rounded-md border border-border">
            <header className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              {source !== undefined && removable ? (
                <input type="checkbox" checked={g.included} onChange={() => p.toggleSource(source)} title="Keep or drop this whole source" />
              ) : null}
              <span className="font-medium">{g.label}</span>
              {source !== undefined ? <span className="text-muted-foreground">{source.injector === "host" ? "added by bb" : "loaded by the provider"}</span> : null}
              <span className="ml-auto tabular-nums text-muted-foreground">{g.tokens.toLocaleString("en-US")} tok</span>
            </header>
            <ul>
              {items.map(n => {
                const a = n.artifact!;
                const kept = isIncluded(a, p.manifest);
                return (
                  <li key={a.id} className={`flex items-center gap-2 px-3 py-1 text-xs ${kept ? "" : "opacity-55"}`}>
                    <input type="checkbox" checked={kept} disabled={!isRemovable(a)} onChange={() => p.toggle(a)} aria-label={`Keep ${a.name}`} />
                    <span className={`truncate ${kept ? "" : "line-through"}`} title={a.description ?? a.path ?? a.name}>
                      {a.name}
                    </span>
                    {by === "source" ? <span className="shrink-0 text-muted-foreground">{KIND_LABELS[a.kind]}</span> : <span className="shrink-0 truncate text-muted-foreground">{sources.get(a.sourceId)?.label}</span>}
                    {a.detail !== undefined ? <span className="truncate text-muted-foreground">{a.detail}</span> : null}
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{tokensLabel(a)}</span>
                    <LeverBadge lever={p.leverOf(a)} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
