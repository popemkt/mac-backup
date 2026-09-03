import { describe, expect, it } from "vitest";
import { buildQueryDb } from "@/ds/db";
import { fixtureGraph } from "@/fixtures/graph";
import { wireToOutlineMap } from "@/lib/graph-view";
import { fuzzyNodeCandidates } from "@/lib/refs";
import {
  clearAllowedRefIdsCache,
  emptyValueForType,
  fieldTypeValue,
  isValueMismatch,
  resolveAllowedRefIds,
  resolveAllowedRefIdsCached,
  resolveFieldType,
  resolveFieldTypeById,
} from "@/lib/field-type";
import {
  SYSTEM_IDS,
  WORKSPACE_ROOT_ID,
  isSysPrefixed,
  type NodeMap,
  type OutlineNode,
} from "@/lib/types";
import { allowedRefIdsOf, typeRefsOf, type NodeLike } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { planAddFieldTargetTag, planSetFieldTargetQuery, planSetFieldType } from "@/actions/plan";

function outline(): Map<string, OutlineNode> {
  return wireToOutlineMap(fixtureGraph.nodes, new Set());
}

function fieldNode(partial: Partial<WireNode> & { id: string; text: string }): WireNode {
  return {
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] },
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...partial,
  };
}

describe("field types", () => {
  it("defaults to text when sys.f.fieldType is absent", () => {
    const nodes = outline();
    expect(resolveFieldTypeById("field.status", nodes)).toBe("text");
    expect(resolveFieldType(undefined)).toBe("text");
  });

  it("selects editors by declared type (mismatch detection)", () => {
    expect(isValueMismatch("text", { t: "str", v: "x" })).toBe(false);
    expect(isValueMismatch("number", { t: "num", v: 1 })).toBe(false);
    expect(isValueMismatch("number", { t: "str", v: "1" })).toBe(true);
    expect(isValueMismatch("checkbox", { t: "bool", v: true })).toBe(false);
    expect(isValueMismatch("ref", { t: "ref", v: "n.root-a" })).toBe(false);
    expect(isValueMismatch("ref", { t: "str", v: "n.root-a" })).toBe(true);
    expect(isValueMismatch("date", { t: "str", v: "2026-08-08" })).toBe(false);
    expect(isValueMismatch("date", { t: "date", v: "2026-08-08" })).toBe(false);
    expect(isValueMismatch("url", { t: "str", v: "https://x" })).toBe(false);
    expect(emptyValueForType("checkbox")).toEqual({ t: "bool", v: false });
    expect(emptyValueForType("ref")).toEqual({ t: "ref", v: "" });
  });

  it("filters ref suggestions by targetTag union", () => {
    const wire = [
      ...fixtureGraph.nodes,
      fieldNode({
        id: "field.assignee",
        text: "assignee",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
          [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: "tag.todo" }],
        },
      }),
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const field = nodes.get("field.assignee");
    const allowed = resolveAllowedRefIds(field, nodes, null);
    expect(allowed).not.toBeNull();
    expect([...allowed!].sort()).toEqual(["n.root-a", "n.root-b"]);
    expect(allowed!.has("n.root-c")).toBe(false);
  });

  it("filters ref suggestions by targetQuery result set", () => {
    const edn = `[:find ?id :where [?n :node/id ?id] [?n :node/text "Ship kb ui shell"]]`;
    const wire = [
      ...fixtureGraph.nodes,
      fieldNode({
        id: "field.pick",
        text: "pick",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
          [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: edn }],
        },
      }),
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const qdb = buildQueryDb(wire, 1);
    const allowed = resolveAllowedRefIds(nodes.get("field.pick"), nodes, qdb);
    expect([...allowed!]).toEqual(["n.root-a"]);
  });

  it("query wins over tag when both are set", () => {
    const edn = `[:find ?id :where [?n :node/id ?id] [?n :node/text "Read-only props panel resolves field names"]]`;
    const wire = [
      ...fixtureGraph.nodes,
      fieldNode({
        id: "field.both",
        text: "both",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
          [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: "tag.todo" }],
          [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: edn }],
        },
      }),
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const qdb = buildQueryDb(wire, 1);
    const allowed = resolveAllowedRefIds(nodes.get("field.both"), nodes, qdb);
    // Query matches n.root-c only; tag.todo would have included a/b — query wins.
    expect([...allowed!]).toEqual(["n.root-c"]);
  });

  it("resolveAllowedRefIdsCached reuses the set for the same fieldId+rev", () => {
    clearAllowedRefIdsCache();
    const wire = [
      ...fixtureGraph.nodes,
      fieldNode({
        id: "field.assignee",
        text: "assignee",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
          [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: "tag.todo" }],
        },
      }),
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const field = nodes.get("field.assignee");
    const a = resolveAllowedRefIdsCached("field.assignee", field, nodes, null, 1);
    const b = resolveAllowedRefIdsCached("field.assignee", field, nodes, null, 1);
    expect(a).toBe(b);
    const c = resolveAllowedRefIdsCached("field.assignee", field, nodes, null, 2);
    expect(c).not.toBe(a);
    expect([...c!].sort()).toEqual([...a!].sort());
  });

  it("plan helpers write fieldType / targetTag / targetQuery", () => {
    const wire = [...fixtureGraph.nodes, fieldNode({ id: "field.x", text: "x" })];
    // The declared type is a ref to its option node — field types are nodes.
    const typed = planSetFieldType(wire, "field.x", "ref");
    expect(typed.upserts[0]?.props[SYSTEM_IDS.fieldTypeField]).toEqual([fieldTypeValue("ref")]);
    // And the round trip still reads back as the declared type.
    expect(resolveFieldType(typed.upserts[0] as never)).toBe("ref");

    const withType: WireNode[] = [
      ...wire.filter((n) => n.id !== "field.x"),
      {
        ...fieldNode({ id: "field.x", text: "x" }),
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
        },
      },
    ];
    const tagged = planAddFieldTargetTag(withType, "field.x", "tag.todo");
    expect(tagged.upserts[0]?.props[SYSTEM_IDS.targetTagField]).toEqual([
      { t: "ref", v: "tag.todo" },
    ]);

    const queried = planSetFieldTargetQuery(
      withType,
      "field.x",
      "[:find ?id :where [?e :node/id ?id]]",
    );
    expect(queried.upserts[0]?.props[SYSTEM_IDS.targetQueryField]).toEqual([
      { t: "str", v: "[:find ?id :where [?e :node/id ?id]]" },
    ]);
  });
});

/**
 * Display and resolution are two layers, and only one of them is allowed to
 * hide things.
 *
 * `OutlineNode.tags` is the *badge* list `wireToOutlineMap` builds for chips.
 * It drops the kind refs on purpose — `sys.f.type → sys.tag` means "this node
 * IS a supertag", and a chip reading "#tag" on a tag's own page is nonsense.
 * Reading that list back as membership therefore reports every supertag as
 * untagged, which is exactly how `sys.f.onto.include` (`targetTag → sys.tag`,
 * seeded in src/foundation/seed.ts) ended up with an empty allowed set and an
 * unfillable ref picker.
 */
describe("allowed ref targets: resolution vs display", () => {
  /** The seeded `sys.f.onto.include` definition, on the fixture graph. */
  function withIncludeField(): NodeMap {
    return wireToOutlineMap(
      [
        ...fixtureGraph.nodes,
        fieldNode({
          id: SYSTEM_IDS.ontoIncludeField,
          text: "onto.include",
          props: {
            [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
            [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")],
            [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
          },
        }),
      ],
      new Set(),
    );
  }

  /**
   * Every fixture node whose kind slot names sys.tag — i.e. every supertag,
   * read the same way resolution reads it rather than restated as a list that
   * goes stale the next time the fixture grows a tag.
   */
  const TAG_NODES = fixtureGraph.nodes
    .filter((n) => typeRefsOf(n).includes(SYSTEM_IDS.tag))
    .map((n) => n.id)
    .sort();

  it("offers every supertag for targetTag → sys.tag", () => {
    const nodes = withIncludeField();
    const allowed = resolveAllowedRefIds(nodes.get(SYSTEM_IDS.ontoIncludeField), nodes, null);
    expect(allowed).not.toBeNull();
    expect(allowed!.size).toBeGreaterThan(0);
    expect([...allowed!].sort()).toEqual(TAG_NODES);
    // Both kinds are present, and resolution hides neither: seeded supertags
    // are exactly the ones a sys.-skipping resolver used to drop.
    expect(TAG_NODES.some(isSysPrefixed)).toBe(true);
    expect(TAG_NODES.some((id) => !isSysPrefixed(id))).toBe(true);
  });

  it("does not read the badge list — those very nodes show no chips", () => {
    const nodes = withIncludeField();
    for (const id of TAG_NODES) {
      expect(nodes.get(id)!.tags.map((t) => t.id)).not.toContain(SYSTEM_IDS.tag);
    }
    expect(nodes.get("tag.todo")!.tags).toEqual([]);
  });

  it("ignores badges even when they are wrong", () => {
    const nodes = withIncludeField();
    const truth = resolveAllowedRefIds(nodes.get(SYSTEM_IDS.ontoIncludeField), nodes, null);
    // Guard the comparison below against being vacuously true.
    expect(truth!.size).toBeGreaterThan(0);
    // Strip every badge, and forge one on a node that is not a tag at all.
    const forged: NodeMap = new Map(
      [...nodes].map(([id, n]) => [
        id,
        {
          ...n,
          tags: id === "n.root-c" ? [{ id: SYSTEM_IDS.tag, name: "tag", color: "#fff" }] : [],
        },
      ]),
    );
    const afterForgery = resolveAllowedRefIds(
      forged.get(SYSTEM_IDS.ontoIncludeField),
      forged,
      null,
    );
    expect([...afterForgery!].sort()).toEqual([...truth!].sort());
    expect(afterForgery!.has("n.root-c")).toBe(false);
  });

  it("resolves from a badge-free node shape (structural pin)", () => {
    // `NodeLike` is `{id, text, props, children}` — no `tags` field exists on
    // it. The shared resolver in `@kb/field-type` declares its input as this
    // shape, so this call only compiles while resolution stays badge-free:
    // widening it back to the outline's node type to read `n.tags` fails the
    // typecheck instead of quietly emptying a picker again.
    const nodes = withIncludeField();
    const bare: ReadonlyMap<string, NodeLike> = new Map<string, NodeLike>(
      [...nodes]
        .filter(([id]) => id !== WORKSPACE_ROOT_ID)
        .map(([id, n]) => [id, { id, text: n.text, props: n.props, children: n.children }]),
    );
    const allowed = allowedRefIdsOf(bare.get(SYSTEM_IDS.ontoIncludeField), bare);
    expect([...allowed!].sort()).toEqual(TAG_NODES);
  });

  it("still hides infrastructure where nothing is declared (display)", () => {
    // The over-correction guard: the hide-sys heuristic is load-bearing for an
    // unconstrained picker — offering ~70 seeded sys nodes makes it useless.
    const nodes = withIncludeField();
    const open = fuzzyNodeCandidates(nodes, "").map((c) => c.id);
    expect(open.some(isSysPrefixed)).toBe(false);
    expect(open).not.toContain(WORKSPACE_ROOT_ID);
    expect(open).toContain("n.root-c");

    // …and yields to the declaration when there is one.
    const allowed = resolveAllowedRefIds(nodes.get(SYSTEM_IDS.ontoIncludeField), nodes, null);
    const offered = fuzzyNodeCandidates(nodes, "", { allowed }).map((c) => c.id);
    expect(offered.slice().sort()).toEqual(TAG_NODES);
  });

  it("lets targetQuery win over targetTag, sys ids included", () => {
    const edn = `[:find ?id :where [?n :node/id ?id] [?n :node/id "${SYSTEM_IDS.typeField}"]]`;
    const wire = [
      ...fixtureGraph.nodes,
      fieldNode({
        id: "field.onto-ish",
        text: "onto-ish",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")],
          [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
          [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: edn }],
        },
      }),
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const allowed = resolveAllowedRefIds(nodes.get("field.onto-ish"), nodes, buildQueryDb(wire, 1));
    expect([...allowed!]).toEqual([SYSTEM_IDS.typeField]);
    expect(allowed!.has("tag.todo")).toBe(false);
  });
});
