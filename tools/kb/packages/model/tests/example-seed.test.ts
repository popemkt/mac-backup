/**
 * Example content for a fresh store (`kb init`).
 *
 * The point of these nodes is that a new kb is immediately usable, so the test
 * is not "23 nodes exist" — it is that each mechanism they demonstrate actually
 * resolves: supertag field templates, an option list behind a ref field, a
 * `[[ref]]` edge, a runnable query, and ontology union/inheritance/veto.
 */
import { describe, expect, test } from "bun:test";
import { fieldTypeOf } from "../src/field-type.ts";
import {
  EXAMPLE_IDS,
  exampleSeedNodes,
  isPristine,
} from "../src/example.ts";
import { SYSTEM_IDS, type KbNode } from "../src/model.ts";
import { resolveOntology } from "../src/ontology.ts";
import { systemSeedNodes } from "../src/seed.ts";

const byId = () => new Map(exampleSeedNodes().map((n) => [n.id, n]));

function refs(node: KbNode, field: string): string[] {
  return (node.props[field] ?? [])
    .filter((v) => v.t === "ref")
    .map((v) => String(v.v));
}

describe("example content", () => {
  test("is entirely ordinary, deletable nodes — nothing write-guarded", () => {
    for (const node of exampleSeedNodes()) {
      expect(node.id.startsWith("sys."), node.id).toBe(false);
      expect(node.id.startsWith("ex."), node.id).toBe(true);
    }
  });

  test("only ever lands in a store nobody has used yet", () => {
    // Pristine = system seed only. Once anything else is present — including
    // example nodes already added, or a note the owner wrote — init must not
    // add them again, so deleting them makes them stay deleted.
    expect(isPristine(systemSeedNodes())).toBe(true);
    expect(isPristine([...systemSeedNodes(), ...exampleSeedNodes()])).toBe(false);
    expect(
      isPristine([
        ...systemSeedNodes(),
        { id: "01SOMETHINGTHEOWNERWROTE" },
      ]),
    ).toBe(false);
  });

  test("#task templates a field of every type, and status is an option list", () => {
    const nodes = byId();
    const task = nodes.get(EXAMPLE_IDS.taskTag)!;
    expect(refs(task, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.tag]);

    const templated = refs(task, SYSTEM_IDS.fieldsField);
    const types = templated.map((id) => fieldTypeOf(nodes.get(id)!.props));
    expect(new Set(types)).toEqual(
      new Set(["ref", "date", "number", "checkbox"]),
    );

    // status is a ref field constrained to the option tag, and the options are
    // just nodes carrying that tag — the pattern any user list follows.
    const status = nodes.get(EXAMPLE_IDS.statusField)!;
    expect(fieldTypeOf(status.props)).toBe("ref");
    expect(refs(status, SYSTEM_IDS.targetTagField)).toEqual([
      EXAMPLE_IDS.statusOptionTag,
    ]);
    for (const option of [
      EXAMPLE_IDS.statusTodo,
      EXAMPLE_IDS.statusDoing,
      EXAMPLE_IDS.statusDone,
    ]) {
      expect(refs(nodes.get(option)!, SYSTEM_IDS.typeField)).toEqual([
        EXAMPLE_IDS.statusOptionTag,
      ]);
    }
  });

  test("a task carries a value for its templated fields, including a ref", () => {
    const task = byId().get(EXAMPLE_IDS.task1)!;
    expect(refs(task, EXAMPLE_IDS.statusField)).toEqual([
      EXAMPLE_IDS.statusDoing,
    ]);
    expect(refs(task, EXAMPLE_IDS.ownerField)).toEqual([EXAMPLE_IDS.ada]);
    expect(task.props[EXAMPLE_IDS.estimateField]).toEqual([{ t: "num", v: 3 }]);
  });

  test("text carries a [[ref]] so the graph and backlinks have something in them", () => {
    const review = byId().get(EXAMPLE_IDS.task2)!;
    expect(review.text).toContain(`[[${EXAMPLE_IDS.task1}|`);
  });

  test("Work unions two supertags plus an explicit pin", () => {
    const nodes = exampleSeedNodes();
    const work = resolveOntology(nodes, EXAMPLE_IDS.ontoWork);
    expect(work.warnings).toEqual([]);
    expect([...work.members].sort()).toEqual(
      [
        EXAMPLE_IDS.ada,
        EXAMPLE_IDS.linus,
        EXAMPLE_IDS.note,
        EXAMPLE_IDS.task1,
        EXAMPLE_IDS.task2,
        EXAMPLE_IDS.task3,
      ].sort(),
    );
    expect(work.reasons.get(EXAMPLE_IDS.task1)).toEqual([
      { kind: "tag", via: EXAMPLE_IDS.taskTag },
    ]);
    expect(work.reasons.get(EXAMPLE_IDS.note)).toEqual([{ kind: "member" }]);
  });

  test("Active work inherits Work, then its veto beats the inherited membership", () => {
    const nodes = exampleSeedNodes();
    const active = resolveOntology(nodes, EXAMPLE_IDS.ontoActive);
    expect(active.warnings).toEqual([]);
    // Ship it is a #task, so extends pulls it in; exclude is absolute.
    expect(active.members.has(EXAMPLE_IDS.task3)).toBe(false);
    expect(active.excluded.has(EXAMPLE_IDS.task3)).toBe(true);
    expect(active.members.has(EXAMPLE_IDS.task1)).toBe(true);
    expect(active.members.size).toBe(
      resolveOntology(nodes, EXAMPLE_IDS.ontoWork).members.size - 1,
    );
  });

  test("every ref in the example content points at something that exists", () => {
    // A dangling ref in demo content teaches the wrong thing about the model.
    const nodes = exampleSeedNodes();
    const known = new Set([
      ...nodes.map((n) => n.id),
      ...systemSeedNodes().map((n) => n.id),
    ]);
    for (const node of nodes) {
      for (const [field, values] of Object.entries(node.props)) {
        for (const value of values) {
          if (value.t !== "ref") continue;
          expect(known.has(String(value.v)), `${node.id}.${field}`).toBe(true);
        }
      }
      for (const child of node.children) {
        expect(known.has(child), `${node.id} child ${child}`).toBe(true);
      }
    }
  });
});
