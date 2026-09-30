/**
 * The move to view nodes (`migrateToViewNodes`): a store written before view
 * nodes, rewritten to them. Old shape in, new shape out, and a second run
 * changes nothing. The store contract runs the same migration through
 * `openKbEffect` over every backend.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { SYSTEM_IDS, type KbNode, type PropValue } from "../src/model.ts";
import { systemSeedNodes } from "../src/seed.ts";
import { LEGACY_PERSPECTIVE_TAG, migrateToViewNodes } from "../src/view-migration.ts";
import { viewOptionId } from "../src/view-node.ts";

const AT = "2026-09-01T00:00:00.000Z";
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
  const { nodes, changed } = migrateToViewNodes(before);
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
    const again = migrateToViewNodes(nodes);
    expect(again.changed).toBe(false);
    expect(again.nodes).toBe(nodes);
  });
});

describe("a store already in the new shape", () => {
  test("comes back as it was: the seed, and a view node", () => {
    const seeded = [
      ...systemSeedNodes(AT),
      node("v.1", { props: { [SYSTEM_IDS.viewField]: [ref(viewOptionId("graph.tree"))] } }),
    ];
    const result = migrateToViewNodes(seeded);
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
        const once = migrateToViewNodes(input);
        const twice = migrateToViewNodes(once.nodes);
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
