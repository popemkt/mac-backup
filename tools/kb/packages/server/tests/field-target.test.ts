/**
 * Ref-target constraint resolution, over the REAL seed.
 *
 * A ref field says which nodes may fill it: `sys.f.targetTag` (sugar — union of
 * the listed tags' instances) or `sys.f.targetQuery` (general form — EDN, wins
 * over the tag). Resolving that declaration is a question about the graph, so
 * it lives in core next to the field-type mapping and is shared verbatim with
 * the browser through `@kb/field-type`.
 *
 * These tests exist because it used to live only in the browser, where it read
 * the outline's `#tag` BADGE array instead of the kind slot. Badges deliberately
 * omit `sys.f.type → sys.tag` (a chip reading "#tag" on a tag's own page is
 * nonsense), so `sys.f.onto.include`, which declares `targetTag → sys.tag`,
 * resolved to the empty set: the ontology `include` field could not be filled
 * from the outliner at all. Hiding infrastructure is a display rule; it has no
 * business in resolution. The seeded fields are asserted directly so the
 * regression is pinned to real data, not to a lookalike fixture.
 */
import { describe, expect, test } from "bun:test";
import {
  SYSTEM_IDS,
  type KbNode,
  type PropValue,
  ONTOLOGY_TARGET_QUERY,
  typeRefsOf,
  type NodeLike,
  systemSeedNodes,
  FIELD_TYPE_OPTION_IDS,
  allowedRefIdsOf,
  fieldTypeValue,
  targetQueryOf,
  targetTagsOf,
} from "@kb/model";
import { buildQueryDb, query } from "@kb/query";
import { normalizeRows } from "../src/session.ts";

const AT = "2026-08-24T00:00:00.000Z";

const seed = systemSeedNodes(AT);
const seedMap = new Map<string, KbNode>(seed.map((n) => [n.id, n]));

/** The EDN runner core asks for, bound to the backend datalog engine. */
function runnerFor(nodes: KbNode[]): (edn: string) => unknown[][] {
  const db = buildQueryDb(nodes);
  return (edn) => normalizeRows(query(db, edn));
}

function node(id: string, text: string, props: Record<string, PropValue[]> = {}): KbNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}

/** Every seeded supertag — read from the kind slot, which is the truth. */
const seededTagIds = seed
  .filter((n) => typeRefsOf(n).includes(SYSTEM_IDS.tag))
  .map((n) => n.id)
  .toSorted();

describe("sys.f.onto.include — targetTag → sys.tag", () => {
  test("the seed really declares sys.tag as the target, via targetTag", () => {
    const field = seedMap.get(SYSTEM_IDS.ontoIncludeField);
    expect(field).toBeDefined();
    expect(targetTagsOf(field)).toEqual([SYSTEM_IDS.tag]);
    expect(targetQueryOf(field)).toBeNull();
    expect(field!.props[SYSTEM_IDS.fieldTypeField]).toEqual([fieldTypeValue("ref")]);
  });

  test("resolves to every supertag in the graph — never the empty set", () => {
    const allowed = allowedRefIdsOf(seedMap.get(SYSTEM_IDS.ontoIncludeField), seedMap);
    expect(allowed).not.toBeNull();
    expect(allowed!.size).toBeGreaterThan(0);
    expect([...allowed!].toSorted()).toEqual(seededTagIds);
  });

  test("and every one of those is sys.-prefixed, which is the whole point", () => {
    // The seed ships supertags and no user tags, so a resolution path that
    // skipped `sys.` ids — or read a badge list that omits the kind ref —
    // emptied this set completely. Resolution is not entitled to hide data.
    expect(seededTagIds.length).toBeGreaterThan(0);
    expect(seededTagIds.every((id) => id.startsWith("sys."))).toBe(true);
    expect(seededTagIds).toContain(SYSTEM_IDS.ontologyTag);
    expect(seededTagIds).toContain(SYSTEM_IDS.queryTag);
    expect(seededTagIds).toContain(SYSTEM_IDS.fieldTypeTag);
  });

  test("a kind is not an instance of itself, and fields are not tags", () => {
    const allowed = allowedRefIdsOf(seedMap.get(SYSTEM_IDS.ontoIncludeField), seedMap)!;
    // `sys.tag` is the kind named by the constraint; it carries no kind ref of
    // its own (seed comment: deliberately NOT self-typed), so it is correctly
    // absent rather than specially excluded.
    expect(allowed.has(SYSTEM_IDS.tag)).toBe(false);
    expect(allowed.has(SYSTEM_IDS.field)).toBe(false);
    expect(allowed.has(SYSTEM_IDS.typeField)).toBe(false);
    expect(allowed.has(SYSTEM_IDS.cmdNewOntology)).toBe(false);
  });

  test("a user's own supertag joins the same set with no extra rule", () => {
    const mine = node("t.service", "service", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    });
    const nodes = new Map<string, KbNode>([...seedMap, [mine.id, mine]]);
    const allowed = allowedRefIdsOf(seedMap.get(SYSTEM_IDS.ontoIncludeField), nodes)!;
    expect(allowed.has("t.service")).toBe(true);
    expect([...allowed].toSorted()).toEqual([...seededTagIds, "t.service"].toSorted());
  });
});

describe("sys.f.fieldType — targetTag → #field-type", () => {
  test("resolves to the six seeded option nodes", () => {
    const allowed = allowedRefIdsOf(seedMap.get(SYSTEM_IDS.fieldTypeField), seedMap);
    expect([...allowed!].toSorted()).toEqual(
      Object.values(FIELD_TYPE_OPTION_IDS).slice().toSorted(),
    );
  });
});

describe("sys.f.targetQuery — the general form", () => {
  test("sys.f.onto.extends resolves #ontology nodes through its seeded query", () => {
    const field = seedMap.get(SYSTEM_IDS.ontoExtendsField);
    expect(targetQueryOf(field)).toBe(ONTOLOGY_TARGET_QUERY);
    expect(targetTagsOf(field)).toEqual([]);

    const onto = node("o.infra", "Infrastructure", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
    });
    const nodes = [...seed, onto];
    const allowed = allowedRefIdsOf(field, new Map(nodes.map((n) => [n.id, n])), runnerFor(nodes));
    expect([...allowed!]).toEqual(["o.infra"]);
  });

  test("wins over targetTag when a field declares both", () => {
    // targetTag would allow every supertag; the query names one field node.
    const both = node("f.both", "both", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")],
      [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      [SYSTEM_IDS.targetQueryField]: [
        {
          t: "str",
          v: `[:find ?id :where [?n :node/id ?id] [?n :node/id "${SYSTEM_IDS.typeField}"]]`,
        },
      ],
    });
    const nodes = [...seed, both];
    const allowed = allowedRefIdsOf(both, new Map(nodes.map((n) => [n.id, n])), runnerFor(nodes));
    expect([...allowed!]).toEqual([SYSTEM_IDS.typeField]);
    expect(allowed!.has(SYSTEM_IDS.ontologyTag)).toBe(false);
  });

  test("honours rows naming sys.* ids", () => {
    const field = node("f.q", "q", {
      [SYSTEM_IDS.targetQueryField]: [
        {
          t: "str",
          v: `[:find ?id :where [?n :node/id ?id] [?n :f/${SYSTEM_IDS.typeField} ?t] [?t :node/id "${SYSTEM_IDS.fieldTypeTag}"]]`,
        },
      ],
    });
    const nodes = [...seed, field];
    const allowed = allowedRefIdsOf(field, new Map(nodes.map((n) => [n.id, n])), runnerFor(nodes));
    expect([...allowed!].toSorted()).toEqual(
      Object.values(FIELD_TYPE_OPTION_IDS).slice().toSorted(),
    );
  });

  test("no runner, or broken EDN, yields empty — never 'unrestricted'", () => {
    const field = node("f.q", "q", {
      [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: "[:find ?id :where" }],
    });
    expect(allowedRefIdsOf(field, seedMap)).toEqual(new Set());
    expect(allowedRefIdsOf(field, seedMap, runnerFor(seed))).toEqual(new Set());
  });

  test("a blank query is no query at all, so targetTag still applies", () => {
    const field = node("f.blank", "blank", {
      [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: "   " }],
    });
    expect(targetQueryOf(field)).toBeNull();
    const allowed = allowedRefIdsOf(field, seedMap, runnerFor(seed));
    expect([...allowed!].toSorted()).toEqual(seededTagIds);
  });
});

describe("no declared constraint", () => {
  test("resolves to null — unrestricted, not empty", () => {
    expect(allowedRefIdsOf(seedMap.get(SYSTEM_IDS.ontoMemberField), seedMap)).toBeNull();
    expect(allowedRefIdsOf(undefined, seedMap)).toBeNull();
  });
});

describe("resolution reads the graph, not a rendered view of it", () => {
  test("a node shape with no badge list at all still resolves (structural pin)", () => {
    // `NodeLike` has `id`/`text`/`props`/`children` and nothing else — no
    // `tags`. This call compiles only while the resolver's declared input stays
    // badge-free, so widening it back to the outline's badge-carrying node type
    // in order to read `n.tags` breaks the typecheck rather than the feature.
    const bare: ReadonlyMap<string, NodeLike> = new Map<string, NodeLike>(
      seed.map((n) => [n.id, { id: n.id, text: n.text, props: n.props, children: n.children }]),
    );
    const allowed = allowedRefIdsOf(bare.get(SYSTEM_IDS.ontoIncludeField), bare);
    expect([...allowed!].toSorted()).toEqual(seededTagIds);
  });
});
