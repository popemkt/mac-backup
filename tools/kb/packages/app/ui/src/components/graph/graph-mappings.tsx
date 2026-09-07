import { useMemo } from "react";
import { mutations } from "@/actions/mutations";
import { useOutlineStore } from "@/stores/outline.store";
import { SYSTEM_IDS } from "@/lib/types";
import { graphBindingOptions } from "@/lib/graph-bindings";
import { sourceValue, type LensPerspective } from "@/lib/graph-lens";
import type { GraphSourceKind } from "@kb/model";
import { GRAPH_RENDERERS, type GraphChannel } from "./graph-renderers";

const CHANNELS: Record<
  Exclude<GraphChannel, "relationships">,
  {
    label: string;
    kind: GraphSourceKind;
    field: string;
    key: "colorBy" | "sizeBy" | "clusterBy" | "labelBy";
  }
> = {
  color: {
    label: "Color by",
    kind: "category",
    field: SYSTEM_IDS.lensColorByField,
    key: "colorBy",
  },
  size: { label: "Size by", kind: "number", field: SYSTEM_IDS.lensSizeByField, key: "sizeBy" },
  group: {
    label: "Group by",
    kind: "category",
    field: SYSTEM_IDS.lensClusterByField,
    key: "clusterBy",
  },
  label: { label: "Label from", kind: "label", field: SYSTEM_IDS.lensLabelByField, key: "labelBy" },
};

export function GraphMappings({ perspective }: { perspective: LensPerspective }) {
  const nodes = useOutlineStore((s) => s.wireNodes);
  const options = useMemo(
    () => ({
      category: graphBindingOptions(nodes, "category"),
      number: graphBindingOptions(nodes, "number"),
      label: graphBindingOptions(nodes, "label"),
      relationship: graphBindingOptions(nodes, "relationship"),
    }),
    [nodes],
  );
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
                {options.relationship.map((option) => (
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
              {options[config.kind].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {!options[config.kind].some((o) => o.value === current) ? (
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
