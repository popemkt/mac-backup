import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { SYSTEM_IDS, type NodeId, type PropValue } from "../src/foundation/model.ts";
import {
  resolveOntology,
  type NodeLike,
  type OntologyResolution,
} from "../src/foundation/ontology.ts";

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
  } = {},
): NodeLike {
  const props: Record<string, PropValue[]> = {
    [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.ontologyTag)],
  };
  if (opts.include?.length) props[SYSTEM_IDS.ontoIncludeField] = opts.include.map(ref);
  if (opts.member?.length) props[SYSTEM_IDS.ontoMemberField] = opts.member.map(ref);
  if (opts.exclude?.length) props[SYSTEM_IDS.ontoExcludeField] = opts.exclude.map(ref);
  if (opts.extends?.length) props[SYSTEM_IDS.ontoExtendsField] = opts.extends.map(ref);
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

          const exclude = [
            ...(excludeTagged ? taggedIds : []),
            ...(excludePinned ? pinIds : []),
          ];

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
      { numRuns: 200 },
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
          const excludeSet = new Set(
            excludeIndices.map((i) => parentIds[i % parentIds.length]!),
          );

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
      { numRuns: 200 },
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
      { numRuns: 100 },
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
          const tagged = taggedIds.map((id, i) =>
            plainNode(id, [tagIds[i % tagIds.length]!]),
          );
          const excludeIds = taggedIds.slice(0, Math.min(excludeCount, taggedIds.length));

          const baseline = ontologyNode("o", { include: tagIds, exclude: excludeIds });
          const baselineNodes = [...tags, ...tagged, baseline];
          const baselineRes = resolveOntology(baselineNodes, "o");

          // Same ontology, but its own ref lists are reversed...
          const shuffled = ontologyNode("o", {
            include: [...tagIds].reverse(),
            exclude: [...excludeIds].reverse(),
          });
          // ...and the node array itself is Fisher-Yates shuffled.
          const unshuffled = [...tags, ...tagged, shuffled];
          const shuffledNodes = [...unshuffled];
          for (let i = shuffledNodes.length - 1; i > 0; i--) {
            const j = shuffleSeed[i % shuffleSeed.length]! % (i + 1);
            [shuffledNodes[i], shuffledNodes[j]] = [shuffledNodes[j]!, shuffledNodes[i]!];
          }

          const shuffledRes = resolveOntology(shuffledNodes, "o");

          expect([...shuffledRes.members].sort()).toEqual([...baselineRes.members].sort());
          expect([...shuffledRes.excluded].sort()).toEqual([...baselineRes.excluded].sort());
        },
      ),
      { numRuns: 200 },
    );
  });
});
