import { useMemo } from "react";
import { mutations } from "@/actions/mutations";
import { useOutlineStore } from "@/stores/outline.store";
import { SYSTEM_IDS } from "@/lib/types";
import { graphBindingOptions, type GraphBindingOption } from "@/lib/graph-bindings";
import { sourceValue, type LensPerspective } from "@/lib/graph-lens";
import { GRAPH_SOURCE_FIELD_KINDS, type GraphSourceField, type GraphSourceKind } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { GRAPH_RENDERERS, type GraphChannel } from "./graph-renderers";

/**
 * "Which options does this lens field accept?" — asked by field, because that
 * is the question every call site here actually has.
 *
 * The answer is `GRAPH_SOURCE_FIELD_KINDS`, the same map the seed turns into
 * that field's `targetQuery`. Naming the four kinds in this panel instead
 * would be its own copy of that map, free to disagree with the picker's.
 * Memoized per kind because two channels (color, group) select the same one.
 */
function sourceOptionsByField(
  nodes: WireNode[],
): (field: GraphSourceField) => GraphBindingOption[] {
  const byKind = new Map<GraphSourceKind, GraphBindingOption[]>();
  return (field) => {
    const kind = GRAPH_SOURCE_FIELD_KINDS[field];
    const cached = byKind.get(kind);
    if (cached !== undefined) return cached;
    const computed = graphBindingOptions(nodes, kind);
    byKind.set(kind, computed);
    return computed;
  };
}

/** A channel is a lens field plus how this panel presents it — nothing more. */
const CHANNELS: Record<
  Exclude<GraphChannel, "relationships">,
  {
    label: string;
    field: GraphSourceField;
    key: "colorBy" | "sizeBy" | "clusterBy" | "labelBy";
  }
> = {
  color: { label: "Color by", field: SYSTEM_IDS.lensColorByField, key: "colorBy" },
  size: { label: "Size by", field: SYSTEM_IDS.lensSizeByField, key: "sizeBy" },
  group: { label: "Group by", field: SYSTEM_IDS.lensClusterByField, key: "clusterBy" },
  label: { label: "Label from", field: SYSTEM_IDS.lensLabelByField, key: "labelBy" },
};

export function GraphMappings({ perspective }: { perspective: LensPerspective }) {
  const nodes = useOutlineStore((s) => s.wireNodes);
  const optionsFor = useMemo(() => sourceOptionsByField(nodes), [nodes]);
  const channels = GRAPH_RENDERERS[perspective.renderer]?.channels ?? [];
  return (
    <div className="mb-3 space-y-3 border-b border-foreground/10 pb-3">
      <p className="text-[11px] text-foreground/45">
        Map the same graph through different relationships and fields.
      </p>
      {channels.map((channel) => {
        if (channel === "relationships")
          return (
            <fieldset key={channel} className="space-y-1">
              <legend className="mb-1 text-[11px] text-foreground/55">Relationships</legend>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {optionsFor(SYSTEM_IDS.lensEdgeKindsField).map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={perspective.edgeKinds.some((k) => k === option.value)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...perspective.edgeKinds, option.value]
                          : perspective.edgeKinds.filter((k) => k !== option.value);
                        void mutations.replaceField(
                          perspective.id,
                          SYSTEM_IDS.lensEdgeKindsField,
                          (next.length ? next : ["none"]).map(sourceValue),
                        );
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              {perspective.renderer === "tree" ? (
                <p className="text-[10px] text-foreground/45">
                  A spanning tree shows each node once, including cyclic relationships.
                </p>
              ) : null}
            </fieldset>
          );
        const config = CHANNELS[channel];
        const current = perspective[config.key] ?? "text";
        return (
          <label key={channel} className="block text-[11px] text-foreground/55">
            {channel === "size" && perspective.renderer === "treemap" ? "Area by" : config.label}
            <select
              aria-label={
                channel === "size" && perspective.renderer === "treemap" ? "Area by" : config.label
              }
              className="mt-1 block w-full rounded border border-foreground/10 bg-popover px-1.5 py-1 text-xs text-foreground"
              value={current}
              onChange={(e) =>
                void mutations.setLensProp(
                  perspective.id,
                  config.field,
                  sourceValue(e.target.value),
                )
              }
            >
              {optionsFor(config.field).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {!optionsFor(config.field).some((o) => o.value === current) ? (
                <option value={current}>Current: {current}</option>
              ) : null}
            </select>
          </label>
        );
      })}
      <label className="block text-[11px] text-foreground/55">
        Node query (Datalog)
        <textarea
          key={perspective.id + perspective.query}
          aria-label="Node query"
          defaultValue={perspective.query}
          placeholder="All nodes"
          className="mt-1 block w-full rounded border border-foreground/10 bg-transparent p-1.5 font-mono text-[11px] text-foreground"
          onBlur={(e) => {
            if (e.target.value !== perspective.query)
              void mutations.setLensProp(perspective.id, SYSTEM_IDS.lensQueryField, {
                t: "str",
                v: e.target.value,
              });
          }}
        />
      </label>
      <label className="flex items-center justify-between text-[11px] text-foreground/55">
        Node limit
        <input
          key={perspective.id + perspective.maxNodes}
          type="number"
          aria-label="Node limit"
          min={1}
          defaultValue={perspective.maxNodes}
          className="w-20 rounded border border-foreground/10 bg-transparent px-1.5 py-1 text-xs text-foreground"
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 1 && v !== perspective.maxNodes)
              void mutations.setLensProp(perspective.id, SYSTEM_IDS.lensMaxNodesField, {
                t: "num",
                v: Math.floor(v),
              });
          }}
        />
      </label>
    </div>
  );
}
