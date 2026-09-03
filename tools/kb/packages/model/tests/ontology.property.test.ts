import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { SYSTEM_IDS, type NodeId, type PropValue } from "../src/model.ts";
import {
  resolveOntology,
  ontologyClosureMode,
  type NodeLike,
  type OntologyResolution,
} from "../src/ontology.ts";

function ref(id: NodeId): PropValue {
  return { t: "ref", v: id };
}

function plainNode(id: NodeId, tagIds: NodeId[]): NodeLike {
  return {
    id,
    text: id,
    props: tagIds.length ? { [SYSTEM_IDS.typeField]: tagIds.map(ref) } : {},
    children: [],
  };
}

function tagNode(id: NodeId): NodeLike {
  return { id, text: id, props: {}, children: [] };
}

function ontologyNode(
  id: NodeId,
  opts: {
    include?: NodeId[];
    member?: NodeId[];
    exclude?: NodeId[];
    extends?: NodeId[];
    closure?: "descendants";
  } = {},
): NodeLike {
  const props: Record<string, PropValue[]> = {
    [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.ontologyTag)],
  };
  if (opts.include?.length) props[SYSTEM_IDS.ontoIncludeField] = opts.include.map(ref);
  if (opts.member?.length) props[SYSTEM_IDS.ontoMemberField] = opts.member.map(ref);
  if (opts.exclude?.length) props[SYSTEM_IDS.ontoExcludeField] = opts.exclude.map(ref);
  if (opts.extends?.length) props[SYSTEM_IDS.ontoExtendsField] = opts.extends.map(ref);
  if (opts.closure) {
    props[SYSTEM_IDS.ontoClosureField] = [{ t: "str", v: opts.closure }];
  }
  return { id, text: id, props, children: [] };
}

describe("ontology resolver properties (fast-check)", () => {
  test("exclude is absolute: an excluded id is never a member, regardless of tag/pin/extends/closure", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }), // plain nodes tagged into the include set
        fc.integer({ min: 0, max: 3 }), // extra explicit pins
        fc.boolean(), // exclude the whole tag-derived set?
        fc.boolean(), // exclude the pinned set?
        fc.boolean(), // route B's members through extends instead of directly on A
        (tagCount, pinCount, excludeTagged, excludePinned, viaExtends) => {
          const tag = tagNode("tag");
          const taggedIds = Array.from({ length: tagCount }, (_, i) => `tagged${i}`);
          const tagged = taggedIds.map((id) => plainNode(id, ["tag"]));
          const pinIds = Array.from({ length: pinCount }, (_, i) => `pin${i}`);
          const pins = pinIds.map((id) => plainNode(id, []));

          const exclude = [...(excludeTagged ? taggedIds : []), ...(excludePinned ? pinIds : [])];

          const b = ontologyNode("b", { include: ["tag"], member: pinIds });
          const a = viaExtends
            ? ontologyNode("a", { extends: ["b"], exclude })
            : ontologyNode("a", { include: ["tag"], member: pinIds, exclude });

          const nodes = [tag, ...tagged, ...pins, b, a];
          const resolution = resolveOntology(nodes, "a");

          for (const id of exclude) {
            expect(resolution.members.has(id)).toBe(false);
            expect(resolution.excluded.has(id)).toBe(true);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("extends is monotone modulo excludes: members(parent) minus child's own exclude are all in members(child)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 0, maxLength: 3 }),
        (parentMemberCount, excludeIndices) => {
          const parentIds = Array.from({ length: parentMemberCount }, (_, i) => `pm${i}`);
          const parentNodes = parentIds.map((id) => plainNode(id, []));
          const excludeSet = new Set(excludeIndices.map((i) => parentIds[i % parentIds.length]!));

          const parent = ontologyNode("parent", { member: parentIds });
          const child = ontologyNode("child", {
            extends: ["parent"],
            exclude: [...excludeSet],
          });

          const nodes = [...parentNodes, parent, child];
          const parentRes = resolveOntology(nodes, "parent");
          const childRes = resolveOntology(nodes, "child");

          for (const id of parentRes.members) {
            if (excludeSet.has(id)) {
              expect(childRes.members.has(id)).toBe(false);
            } else {
              expect(childRes.members.has(id)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("a cyclic extends chain never throws or hangs, and is reported as a warning", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }), // chain length before it loops back
        (length) => {
          const ids = Array.from({ length }, (_, i) => `cy${i}`);
          const nodes = ids.map((id, i) =>
            ontologyNode(id, { extends: [ids[(i + 1) % ids.length]!] }),
          );

          let resolution: OntologyResolution | undefined;
          expect(() => {
            resolution = resolveOntology(nodes, ids[0]!);
          }).not.toThrow();

          expect(resolution!.warnings.some((w) => w.includes("cycle"))).toBe(true);
          // The ontology never lists itself, even transitively through the loop.
          expect(resolution!.members.has(ids[0]!)).toBe(false);
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("resolution is order-independent: shuffling nodes and ref-list entries never changes the member/excluded sets", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 3 }),
        fc.array(fc.nat(), { minLength: 20, maxLength: 20 }), // Fisher-Yates entropy
        (taggedCount, tagCount, excludeCount, shuffleSeed) => {
          const tagIds = Array.from({ length: tagCount }, (_, i) => `t${i}`);
          const tags = tagIds.map((id) => tagNode(id));
          const taggedIds = Array.from({ length: taggedCount }, (_, i) => `p${i}`);
          const tagged = taggedIds.map((id, i) => plainNode(id, [tagIds[i % tagIds.length]!]));
          const excludeIds = taggedIds.slice(0, Math.min(excludeCount, taggedIds.length));

          const baseline = ontologyNode("o", { include: tagIds, exclude: excludeIds });
          const baselineNodes = [...tags, ...tagged, baseline];
          const baselineRes = resolveOntology(baselineNodes, "o");

          // Same ontology, but its own ref lists are reversed...
          const shuffled = ontologyNode("o", {
            include: [...tagIds].toReversed(),
            exclude: [...excludeIds].toReversed(),
          });
          // ...and the node array itself is Fisher-Yates shuffled.
          const unshuffled = [...tags, ...tagged, shuffled];
          const shuffledNodes = [...unshuffled];
          for (let i = shuffledNodes.length - 1; i > 0; i--) {
            const j = shuffleSeed[i % shuffleSeed.length]! % (i + 1);
            [shuffledNodes[i], shuffledNodes[j]] = [shuffledNodes[j]!, shuffledNodes[i]!];
          }

          const shuffledRes = resolveOntology(shuffledNodes, "o");

          expect([...shuffledRes.members].toSorted()).toEqual([...baselineRes.members].toSorted());
          expect([...shuffledRes.excluded].toSorted()).toEqual(
            [...baselineRes.excluded].toSorted(),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("closure descendants pulls exactly the structural descendants of every member, no more and no less", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.array(fc.nat(), { minLength: 12, maxLength: 12 }), // children-edge entropy
        fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), // seed-selection entropy
        (nodeCount, edgeSeed, seedFlags) => {
          const ids = Array.from({ length: nodeCount }, (_, i) => `f${i}`);
          // Forest: node i's children are drawn only from indices > i, so the
          // structure is acyclic by construction.
          const childrenOf = new Map<NodeId, NodeId[]>();
          for (let i = 0; i < ids.length; i++) {
            const laterCount = ids.length - i - 1;
            const childCount =
              laterCount === 0 ? 0 : edgeSeed[i % edgeSeed.length]! % (laterCount + 1);
            childrenOf.set(ids[i]!, ids.slice(i + 1, i + 1 + childCount));
          }
          const nodes: NodeLike[] = ids.map((id) => ({
            id,
            text: id,
            props: {},
            children: childrenOf.get(id) ?? [],
          }));

          const seedIds = ids.filter((_, i) => seedFlags[i % seedFlags.length]!);
          if (seedIds.length === 0) return; // need at least one seed to say anything

          // Reference: transitive closure over the same children edges.
          const expected = new Set(seedIds);
          const stack = [...seedIds];
          while (stack.length > 0) {
            const current = stack.pop()!;
            for (const childId of childrenOf.get(current) ?? []) {
              if (expected.has(childId)) continue;
              expected.add(childId);
              stack.push(childId);
            }
          }

          const onto = ontologyNode("o", { member: seedIds, closure: "descendants" });
          const resolution = resolveOntology([...nodes, onto], "o");

          expect([...resolution.members].toSorted()).toEqual([...expected].toSorted());
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("a non-ref value sitting in a ref-list field is never treated as a member id, even when its stringified value collides with a real node", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.constantFrom(
          { t: "str", v: "bystander" } as PropValue,
          { t: "num", v: 42 } as PropValue,
          { t: "bool", v: true } as PropValue,
        ),
        (memberCount, noise) => {
          const memberIds = Array.from({ length: memberCount }, (_, i) => `m${i}`);
          const members = memberIds.map((id) => plainNode(id, []));
          // A real node whose id equals every noise value's stringified `v`
          // ("bystander", "42", "true") — present in the graph, but never
          // named as a real ref, so it must never become a member.
          const bystander = plainNode(String(noise.v), []);
          const onto: NodeLike = {
            id: "o",
            text: "o",
            props: {
              [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.ontologyTag)],
              // A real onto.member list with one non-ref value spliced in.
              [SYSTEM_IDS.ontoMemberField]: [...memberIds.map(ref), noise],
            },
            children: [],
          };

          const resolution = resolveOntology([...members, bystander, onto], "o");

          expect([...resolution.members].toSorted()).toEqual([...memberIds].toSorted());
          expect(resolution.members.has(String(noise.v))).toBe(false);
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("closure mode reads a malformed onto.closure value as 'none', and 'descendants' round-trips through arbitrary whitespace", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({ t: fc.constant("str" as const), v: fc.constant(" descendants ") }),
          fc.record({
            t: fc.constant("str" as const),
            v: fc.string().filter((s) => s.trim() !== "descendants"),
          }),
          fc.record({ t: fc.constant("num" as const), v: fc.double({ noNaN: true }) }),
          fc.record({ t: fc.constant("bool" as const), v: fc.boolean() }),
        ),
        (raw) => {
          const node: NodeLike = {
            id: "o",
            text: "o",
            props: { [SYSTEM_IDS.ontoClosureField]: [raw] },
            children: [],
          };
          const expectDescendants = raw.t === "str" && raw.v.trim() === "descendants";
          expect(ontologyClosureMode(node)).toBe(expectDescendants ? "descendants" : "none");
        },
      ),
      { numRuns: 500 },
    );
  });
});
