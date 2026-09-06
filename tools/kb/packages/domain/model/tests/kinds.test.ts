/**
 * Kinds, roles and options — the seed side (DESIGN.md → Kinds, roles and
 * options).
 *
 * A supertag says what a node *is*; a behaviour is a field; an option set is
 * children. Two of those three are a judgement a reviewer makes with the strip
 * test ("remove the behaviour — is the node still that thing?"), and nothing
 * here pretends to decide them. The third clause is mechanical, and this is it:
 *
 *   an option set is expressed by parenting, so no supertag exists whose only
 *   job is to be something a `targetTag` can point at.
 *
 * Such a tag is recognisable: it templates no fields. A tag that templates
 * nothing is a label stuck on a set of siblings, and being siblings already
 * says it — which is what `sys.tag.field-type` was, and what a seeded
 * `sys.tag.pinned` would have been.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode } from "../src/model.ts";
import {
  FIELD_TYPES,
  FIELD_TYPE_OPTION_IDS,
  targetQueryOf,
  targetTagsOf,
} from "../src/field-type.ts";
import { refValuesOf, typeRefsOf } from "../src/ontology.ts";
import { systemSeedNodes } from "../src/seed.ts";

const seed: KbNode[] = systemSeedNodes();
const byId = new Map(seed.map((node) => [node.id, node]));
const supertags = seed.filter((node) => typeRefsOf(node).includes(SYSTEM_IDS.tag));

describe("kinds, roles and options", () => {
  test("the seed ships supertags at all — otherwise the rest is vacuous", () => {
    expect(supertags.map((node) => node.text).toSorted()).toEqual([
      "canvas",
      "graph-perspective",
      "ontology",
    ]);
  });

  test("every seeded supertag templates at least one field", () => {
    for (const tag of supertags) {
      expect(refValuesOf(tag, SYSTEM_IDS.fieldsField).length, tag.text).toBeGreaterThan(0);
    }
  });

  test("no seeded targetTag points at a supertag that templates nothing", () => {
    // The failure this states: minting a tag so a ref field has a referent.
    // Parenting the options is the way to say that, and it needs no tag.
    for (const field of seed) {
      for (const tagId of targetTagsOf(field)) {
        const tag = byId.get(tagId);
        expect(tag, `${field.text} → ${tagId}`).toBeDefined();
        expect(
          refValuesOf(tag, SYSTEM_IDS.fieldsField).length,
          `${field.text} → ${tag?.text ?? tagId}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  test("the type slot is the worked example: children, no tag, no targetTag", () => {
    const slot = byId.get(SYSTEM_IDS.fieldTypeField);
    expect(slot?.children).toEqual(FIELD_TYPES.map((type) => FIELD_TYPE_OPTION_IDS[type]));
    expect(targetTagsOf(slot)).toEqual([]);
    expect(targetQueryOf(slot)).toBeNull();
    for (const type of FIELD_TYPES) {
      expect(typeRefsOf(byId.get(FIELD_TYPE_OPTION_IDS[type])), type).toEqual([]);
    }
  });
});
