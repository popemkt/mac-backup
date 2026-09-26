import { describe, expect, it } from "vitest";
import { graphViewKey } from "./graph-renderers";

const view = { id: "lens.a", query: "", focus: null as string | null };
const scope = { includeSystemNodes: false, ontologyId: null as string | null };

describe("a graph view's identity", () => {
  it("is the same for the same view, whatever else changed", () => {
    expect(graphViewKey(view, scope)).toBe(graphViewKey({ ...view }, { ...scope }));
  });

  it("changes with the perspective, its query, its focus, the sys switch and the ontology", () => {
    const base = graphViewKey(view, scope);
    for (const other of [
      graphViewKey({ ...view, id: "lens.b" }, scope),
      graphViewKey({ ...view, query: "[:find ?e]" }, scope),
      graphViewKey({ ...view, focus: "n.root" }, scope),
      graphViewKey({ ...view, focus: "n.other" }, scope),
      graphViewKey(view, { ...scope, includeSystemNodes: true }),
      graphViewKey(view, { ...scope, ontologyId: "onto.a" }),
    ])
      expect(other).not.toBe(base);
    expect(graphViewKey({ ...view, focus: "n.root" }, scope)).not.toBe(
      graphViewKey({ ...view, focus: "n.other" }, scope),
    );
  });
});
