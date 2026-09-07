import { GRAPH_SOURCE_VALUES, type GraphSourceKind, fieldTypeOf } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "./types";
import { graphDisplayText } from "./graph-label";

export interface GraphBindingOption {
  value: string;
  label: string;
}

/** Field discovery includes declared fields and properties present on graph nodes. */
export function graphBindingOptions(
  nodes: WireNode[],
  kind: GraphSourceKind,
): GraphBindingOption[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fields = new Map<string, Set<string>>();
  for (const node of nodes) {
    if (
      node.props[SYSTEM_IDS.typeField]?.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.field) ===
      true
    )
      fields.set(node.id, fields.get(node.id) ?? new Set());
    for (const [field, values] of Object.entries(node.props)) {
      const types = fields.get(field) ?? new Set<string>();
      for (const value of values) types.add(value.t);
      fields.set(field, types);
    }
  }
  const options = Object.entries(GRAPH_SOURCE_VALUES)
    .filter(([, v]) => v.kind === kind)
    .map(([value, v]) => ({ value, label: v.label as string }));
  const fieldOptions = [...fields]
    .filter(([id, types]) => {
      const declared = fieldTypeOf(byId.get(id)?.props);
      return kind === "number"
        ? declared === "number" || types.has("num")
        : kind === "relationship"
          ? declared === "ref" || types.has("ref")
          : true;
    })
    .map(([id]) => ({
      value: `prop:${id}`,
      label: graphDisplayText(byId.get(id)?.text ?? "") || "Unnamed field",
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  return [...options, ...fieldOptions];
}
