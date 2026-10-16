/** A graph view node read as its perspective, and which perspective a graph opens on. */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS } from "@kb/model";
import { perspectiveProps } from "@kb/graph";
import { decodePerspective, resolvePerspective } from "../src/index.ts";
import { node, perspective } from "./fixtures.ts";

const quiet = (warning: string) => {
  throw new Error(`unexpected report: ${warning}`);
};

describe("decodePerspective", () => {
  test("roundtrips a saved perspective through ordinary reference-valued node fields", () => {
    const configured = perspective({
      renderer: "sys.view.graph.treemap",
      colorBy: "prop:field.team",
      labelBy: "prop:field.title",
      sizeBy: "prop:field.hours",
      clusterBy: "prop:field.team",
      edgeKinds: ["prop:field.depends"],
      query: "",
      focus: "n.a",
    });
    const saved = node({
      id: configured.id,
      text: configured.label,
      props: perspectiveProps(configured),
    });
    expect(saved.props[SYSTEM_IDS.viewField]).toEqual([{ t: "ref", v: "sys.view.graph.treemap" }]);
    expect(saved.props[SYSTEM_IDS.lensRendererField]).toBeUndefined();
    expect(decodePerspective(saved, quiet)).toEqual(configured);
    expect(
      decodePerspective(
        node({ ...saved, props: perspectiveProps({ ...configured, edgeKinds: [] }) }),
        quiet,
      ).edgeKinds,
    ).toEqual([]);
  });

  test("a node with no text is Untitled, and its text is trimmed", () => {
    expect(decodePerspective(node({ id: "p", text: "   " }), quiet).label).toBe("Untitled");
    expect(decodePerspective(node({ id: "p", text: "  Spaced  " }), quiet).label).toBe("Spaced");
  });

  test("a malformed lens prop is reported and falls back, never failing the perspective", () => {
    const reported: string[] = [];
    const parsed = decodePerspective(
      node({
        id: "p",
        text: "P",
        props: { [SYSTEM_IDS.lensMaxNodesField]: [{ t: "str", v: "x" }] },
      }),
      (warning) => reported.push(warning),
    );
    expect(parsed.maxNodes).toBe(perspective().maxNodes);
    expect(reported).toHaveLength(1);
  });
});

describe("resolvePerspective", () => {
  const other = perspective({ id: "p.other", label: "Other" });
  const all = perspective();

  test("takes the asked-for perspective, else all-mentions, else the first", () => {
    expect(resolvePerspective([other, all], "p.other")).toBe(other);
    expect(resolvePerspective([other, all], "p.gone")).toBe(all);
    expect(resolvePerspective([other, all], null)).toBe(all);
    expect(resolvePerspective([other], null)).toBe(other);
    expect(resolvePerspective([], "p.other")).toBeNull();
  });
});
