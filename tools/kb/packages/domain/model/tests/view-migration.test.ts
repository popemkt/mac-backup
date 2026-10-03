/**
 * The move to view nodes (`migrateToViewNodes`): a store written before view
 * nodes, rewritten to them. Old shape in, new shape out, and a second run
 * changes nothing. The store contract runs the same migration through
 * `openKbEffect` over every backend.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { SYSTEM_IDS, type KbNode, type PropValue } from "../src/model.ts";
import {
  LEGACY_PERSPECTIVE_TAG,
  LEGACY_VIEW_MODE_FIELD,
  docsViewNodeId,
  frameViewNodeId,
  legacyViewShapes,
  migrateToViewNodes,
} from "../src/view-migration.ts";
import { defaultViewIdOf, docsViewProps, viewOptionId } from "../src/view-node.ts";
import { bundledSeed } from "@kb/bundled";

const AT = "2026-09-01T00:00:00.000Z";
/** No legacy docs views: what a store alone migrates with. */
const NONE = { docs: [], at: AT };
const ref = (v: string): PropValue => ({ t: "ref", v });
const str = (v: string): PropValue => ({ t: "str", v });

function node(id: string, over: Partial<KbNode> = {}): KbNode {
  return { id, text: id, props: {}, children: [], createdAt: AT, updatedAt: AT, ...over };
}

const RENDERERS = ["force2d", "tree", "cluster", "force3d", "treemap"] as const;
const legacyOption = (name: string) => `sys.graph.renderer.${name}`;

/** What a store seeded before view nodes held of the graph's vocabulary. */
function legacyVocabulary(): KbNode[] {
  return [
    node(LEGACY_PERSPECTIVE_TAG, {
      text: "graph-perspective",
      props: {
        [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.tag)],
        [SYSTEM_IDS.fieldsField]: [ref(SYSTEM_IDS.lensQueryField)],
      },
    }),
    node(SYSTEM_IDS.lensRendererField, {
      text: "lens.renderer",
      props: { [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.field)] },
      children: RENDERERS.map(legacyOption),
    }),
    ...RENDERERS.map((name) => node(legacyOption(name), { text: name })),
  ];
}

const perspective = (id: string, props: KbNode["props"]): KbNode =>
  node(id, {
    props: { [SYSTEM_IDS.typeField]: [ref(LEGACY_PERSPECTIVE_TAG)], ...props },
  });

const byId = (nodes: KbNode[]) => new Map(nodes.map((n) => [n.id, n]));

describe("graph perspectives become view nodes", () => {
  const before = [
    ...legacyVocabulary(),
    node("tag.todo", { props: { [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.tag)] } }),
    perspective("p.tree", {
      [SYSTEM_IDS.lensRendererField]: [ref(legacyOption("tree"))],
      [SYSTEM_IDS.lensMaxNodesField]: [{ t: "num", v: 40 }],
    }),
    perspective("p.text", { [SYSTEM_IDS.lensRendererField]: [str("force3d")] }),
    perspective("p.none", {}),
    perspective("p.odd", { [SYSTEM_IDS.lensRendererField]: [str("sankey")] }),
    node("p.tagged", {
      props: {
        [SYSTEM_IDS.typeField]: [ref(LEGACY_PERSPECTIVE_TAG), ref("tag.todo")],
        [SYSTEM_IDS.lensRendererField]: [ref(legacyOption("cluster"))],
      },
    }),
    node("n.neighbourhood", {
      props: {
        [SYSTEM_IDS.viewField]: [ref(viewOptionId("graph.neighbourhood"))],
        [SYSTEM_IDS.lensRendererField]: [ref(legacyOption("treemap"))],
      },
    }),
  ];
  const { nodes, changed } = migrateToViewNodes(before, NONE);
  const after = byId(nodes);

  test("the renderer a perspective named is its view, and its other lens props its params", () => {
    expect(changed).toBe(true);
    expect(after.get("p.tree")?.props).toEqual({
      [SYSTEM_IDS.viewField]: [ref(viewOptionId("graph.tree"))],
      [SYSTEM_IDS.lensMaxNodesField]: [{ t: "num", v: 40 }],
    });
    expect(after.get("p.text")?.props[SYSTEM_IDS.viewField]).toEqual([
      ref(viewOptionId("graph.force3d")),
    ]);
  });

  test("a perspective that named no renderer, or one kb does not know, was drawn in 2D and still is", () => {
    for (const id of ["p.none", "p.odd"])
      expect(after.get(id)?.props[SYSTEM_IDS.viewField], id).toEqual([
        ref(viewOptionId("graph.force2d")),
      ]);
  });

  test("a perspective's own renderer wins over the view the seed filled in beside it", () => {
    // The seed runs first on open, and fills `sys.f.view` onto an old
    // lens.all-mentions that lacked it; the tag says lens.renderer is the choice.
    const filled = perspective("p.filled", {
      [SYSTEM_IDS.viewField]: [ref(viewOptionId("graph.force2d"))],
      [SYSTEM_IDS.lensRendererField]: [ref(legacyOption("tree"))],
    });
    expect(migrateToViewNodes([filled], NONE).nodes[0]?.props[SYSTEM_IDS.viewField]).toEqual([
      ref(viewOptionId("graph.tree")),
    ]);
  });

  test("the tag goes, and only the tag: a perspective's other tags stay", () => {
    expect(after.get("p.tree")?.props[SYSTEM_IDS.typeField]).toBeUndefined();
    expect(after.get("p.tagged")?.props[SYSTEM_IDS.typeField]).toEqual([ref("tag.todo")]);
  });

  test("the tag and the old renderer options are retired, and lens.renderer lets go of them", () => {
    expect(after.has(LEGACY_PERSPECTIVE_TAG)).toBe(false);
    for (const name of RENDERERS) expect(after.has(legacyOption(name))).toBe(false);
    expect(after.get(SYSTEM_IDS.lensRendererField)?.children).toEqual([]);
  });

  test("elsewhere, a lens.renderer ref to an old option names that renderer's view", () => {
    expect(after.get("n.neighbourhood")?.props[SYSTEM_IDS.lensRendererField]).toEqual([
      ref(viewOptionId("graph.treemap")),
    ]);
  });

  test("a second run changes nothing", () => {
    const again = migrateToViewNodes(nodes, NONE);
    expect(again.changed).toBe(false);
    expect(again.nodes).toBe(nodes);
  });
});

describe("a frame's view settings become its default view node", () => {
  const MODE = LEGACY_VIEW_MODE_FIELD;
  const sort = {
    [SYSTEM_IDS.viewSortField]: [ref("f.a")],
    [SYSTEM_IDS.viewSortDirField]: [str("desc")],
  };
  const before = [
    node(MODE, { props: { [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.field)] } }),
    node(SYSTEM_IDS.viewsList, { text: "Views", children: ["v.kept"] }),
    node("v.kept", { props: { [SYSTEM_IDS.viewField]: [ref(viewOptionId("graph.tree"))] } }),
    node("f.table", {
      updatedAt: "2026-09-02T00:00:00.000Z",
      props: { [MODE]: [str("table")], ...sort, "f.other": [str("kept")] },
    }),
    node("f.list", { props: { [MODE]: [str("list")] } }),
    node("f.odd", { props: { [MODE]: [str("kanban")] } }),
    node("f.settings-only", { props: { [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: 5 }] } }),
    node("f.named", {
      props: { [MODE]: [str("cards")], [SYSTEM_IDS.viewsField]: [ref("v.kept")] },
    }),
    // A view node holds these props as its params: it is no frame to migrate.
    node("v.params", {
      props: { [SYSTEM_IDS.viewField]: [ref(viewOptionId("outline.table"))], ...sort },
    }),
  ];
  const { nodes, changed } = migrateToViewNodes(before, NONE);
  const after = byId(nodes);
  const shownAs = (frame: string) =>
    after.get(defaultViewIdOf(after.get(frame)) ?? "")?.props[SYSTEM_IDS.viewField];

  test("the view its mode named is its view node's, and its settings are that node's params", () => {
    expect(changed).toBe(true);
    const view = after.get(frameViewNodeId("f.table"));
    expect(view?.props).toEqual({
      [SYSTEM_IDS.viewField]: [ref(viewOptionId("outline.table"))],
      ...sort,
    });
    expect(view?.text).toBe("");
    // Dated as the frame was last written, so two stores migrate it alike.
    expect(view?.createdAt).toBe("2026-09-02T00:00:00.000Z");
    expect(after.get("f.table")?.props).toEqual({
      "f.other": [str("kept")],
      [SYSTEM_IDS.viewsField]: [ref(frameViewNodeId("f.table"))],
    });
  });

  test("a frame whose mode names no view kb knows, or that named none, is a list", () => {
    for (const frame of ["f.list", "f.odd", "f.settings-only"])
      expect(shownAs(frame), frame).toEqual([ref(viewOptionId("outline.list"))]);
    expect(
      after.get(frameViewNodeId("f.settings-only"))?.props[SYSTEM_IDS.viewPagesizeField],
    ).toEqual([{ t: "num", v: 5 }]);
  });

  test("the new view node is the frame's default: named first, before the views it named", () => {
    expect(after.get("f.named")?.props[SYSTEM_IDS.viewsField]).toEqual([
      ref(frameViewNodeId("f.named")),
      ref("v.kept"),
    ]);
  });

  test("each is filed at the end of the Views list, and the mode field is retired", () => {
    expect(after.get(SYSTEM_IDS.viewsList)?.children).toEqual([
      "v.kept",
      ...["f.table", "f.list", "f.odd", "f.settings-only", "f.named"].map(frameViewNodeId),
    ]);
    expect(after.has(MODE)).toBe(false);
    expect(after.get("v.params")).toBe(before.find((n) => n.id === "v.params"));
  });

  test("a second run changes nothing", () => {
    const again = migrateToViewNodes(nodes, NONE);
    expect(again.changed).toBe(false);
    expect(again.nodes).toBe(nodes);
  });

  test("without a Views list, a frame's view node is a root", () => {
    const alone = migrateToViewNodes(
      [node("f", { props: { [MODE]: [str("board")] } })],
      NONE,
    ).nodes;
    expect(alone.map((n) => n.id).toSorted()).toEqual(["f", frameViewNodeId("f")]);
    expect(alone.every((n) => n.children.length === 0)).toBe(true);
  });
});

describe("a root's .kb/views specs become docs view nodes", () => {
  const spec = {
    output: "docs/kb/rules.md",
    query: "[:find ?id :where [?n :node/id ?id]]",
    template: "rules",
  };
  const list = node(SYSTEM_IDS.viewsList, { text: "Views" });

  test("each is a view node named by its name, its spec its params, filed in the Views list", () => {
    const { nodes, changed } = migrateToViewNodes([list], {
      docs: [{ name: "rules", spec }],
      at: AT,
    });
    const after = byId(nodes);
    expect(changed).toBe(true);
    expect(after.get(docsViewNodeId("rules"))).toMatchObject({
      text: "rules",
      props: docsViewProps(spec),
      createdAt: AT,
    });
    expect(after.get(SYSTEM_IDS.viewsList)?.children).toEqual([docsViewNodeId("rules")]);
  });

  test("a spec whose view node is already there is not imported again", () => {
    const once = migrateToViewNodes([list], { docs: [{ name: "rules", spec }], at: AT });
    const again = migrateToViewNodes(once.nodes, {
      docs: [{ name: "rules", spec: { ...spec, template: "other" } }],
      at: "2027-01-01T00:00:00.000Z",
    });
    expect(again.changed).toBe(false);
    expect(again.nodes).toBe(once.nodes);
  });
});

describe("what the migration cannot do as asked, it says", () => {
  const MODE = LEGACY_VIEW_MODE_FIELD;
  const spec = {
    output: "docs/x.md",
    query: "[:find ?id :where [?n :node/id ?id]]",
    template: "t",
  };

  test("a frame whose view.<id> is taken gets the next free id, and a warning, not the old shape", () => {
    const taken = node(frameViewNodeId("f"), { text: "someone else's" });
    const taken2 = node(`${frameViewNodeId("f")}.2`);
    const result = migrateToViewNodes(
      [taken, taken2, node("f", { props: { [MODE]: [str("table")] } })],
      NONE,
    );
    const frame = byId(result.nodes).get("f");
    expect(defaultViewIdOf(frame)).toBe(`${frameViewNodeId("f")}.3`);
    expect(frame?.props[MODE]).toBeUndefined();
    expect(result.warnings).toEqual([
      `${frameViewNodeId("f")} is taken; frame f's view node is ${frameViewNodeId("f")}.3`,
    ]);
  });

  test("a docs view whose docs.<name> a node already holds is not imported, and not silently", () => {
    const other = node(docsViewNodeId("a"), { text: "a plain node" });
    const done = node(docsViewNodeId("b"), { text: "b", props: docsViewProps(spec) });
    const result = migrateToViewNodes([other, done], {
      docs: [
        { name: "a", spec },
        { name: "b", spec },
      ],
      at: AT,
    });
    expect(result.changed).toBe(false);
    expect(result.imported).toEqual([]);
    expect(result.warnings).toEqual([
      `${docsViewNodeId("a")} is a node that is no docs view; docs view a was not imported`,
      `docs view b is already ${docsViewNodeId("b")}; its spec file was not imported again`,
    ]);
  });

  test("a docs view whose name another docs view goes by is not imported: it would be a second", () => {
    const namesake = node("my.rules", { text: "rules", props: docsViewProps(spec) });
    const result = migrateToViewNodes([namesake], {
      docs: [
        { name: "rules", spec },
        { name: "todos", spec },
      ],
      at: AT,
    });
    expect(result.imported).toEqual(["todos"]);
    expect(result.warnings).toEqual([
      "docs view name rules is taken by my.rules; docs view rules was not imported",
    ]);
  });

  test("the withdrawn placement field and its options are retired", () => {
    const placement = node("sys.f.view.placement", { children: ["sys.view-placement.inline"] });
    const result = migrateToViewNodes([placement, node("sys.view-placement.inline")], NONE);
    expect(result.nodes).toEqual([]);
    expect(legacyViewShapes([placement])).toEqual(["retired node(s) sys.f.view.placement"]);
  });
});

describe("a store already in the new shape", () => {
  test("comes back as it was: the seed, and a view node", () => {
    const seeded = [
      ...bundledSeed(AT),
      node("v.1", { props: { [SYSTEM_IDS.viewField]: [ref(viewOptionId("graph.tree"))] } }),
    ];
    const result = migrateToViewNodes(seeded, NONE);
    expect(result.changed).toBe(false);
    expect(result.nodes).toBe(seeded);
  });
});

describe("the migration, over any mix of legacy perspectives", () => {
  const rendererValueArb: fc.Arbitrary<PropValue[]> = fc.oneof(
    fc.constant<PropValue[]>([]),
    fc.constantFrom(...RENDERERS).map((name) => [ref(legacyOption(name))]),
    fc.constantFrom(...RENDERERS, "sankey").map((name) => [str(name)]),
  );
  const perspectivesArb = fc.uniqueArray(
    fc.record({
      id: fc.stringMatching(/^p\.[a-z]{1,6}$/),
      renderer: rendererValueArb,
      alsoTodo: fc.boolean(),
    }),
    { selector: (p) => p.id, maxLength: 8 },
  );

  test("is idempotent, and leaves no tag, no old option and exactly one view per perspective", () => {
    fc.assert(
      fc.property(perspectivesArb, (specs) => {
        const input = [
          ...legacyVocabulary(),
          ...specs.map((spec) =>
            node(spec.id, {
              props: {
                [SYSTEM_IDS.typeField]: [
                  ref(LEGACY_PERSPECTIVE_TAG),
                  ...(spec.alsoTodo ? [ref("tag.todo")] : []),
                ],
                ...(spec.renderer.length > 0
                  ? { [SYSTEM_IDS.lensRendererField]: spec.renderer }
                  : {}),
              },
            }),
          ),
        ];
        const once = migrateToViewNodes(input, NONE);
        const twice = migrateToViewNodes(once.nodes, NONE);
        expect(twice.changed).toBe(false);
        const out = byId(once.nodes);
        for (const spec of specs) {
          const migrated = out.get(spec.id);
          expect(migrated?.props[SYSTEM_IDS.viewField]?.length).toBe(1);
          expect(migrated?.props[SYSTEM_IDS.lensRendererField]).toBeUndefined();
          expect(migrated?.props[SYSTEM_IDS.typeField] ?? []).toEqual(
            spec.alsoTodo ? [ref("tag.todo")] : [],
          );
        }
        for (const n of once.nodes) {
          expect(n.id).not.toBe(LEGACY_PERSPECTIVE_TAG);
          expect(n.id.startsWith("sys.graph.renderer.")).toBe(false);
          for (const values of Object.values(n.props))
            for (const v of values)
              expect(v.t === "ref" && v.v === LEGACY_PERSPECTIVE_TAG).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });
});
