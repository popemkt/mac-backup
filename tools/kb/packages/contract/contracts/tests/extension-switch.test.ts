/**
 * How a store says a family is on (DESIGN.md → Extension families → the
 * switch is a node): an optional family by its switch node, or by the
 * default its declaration states where no switch is written; a required
 * family always, whatever a node says.
 */
import { describe, expect, test } from "bun:test";
import type { KbNode } from "@kb/model";
import {
  EXTENSION_ENABLED_FIELD,
  NO_SWITCHES,
  defineExtension,
  extensionNodeId,
  familyOn,
  switchWrites,
  type NodeLookup,
} from "../src/index.ts";

const AT = "2026-10-04T00:00:00.000Z";

const OFF_BY_DEFAULT = defineExtension({ name: "a", label: "A", optional: { byDefault: "off" } });
const ON_BY_DEFAULT = defineExtension({ name: "b", label: "B", optional: { byDefault: "on" } });
const REQUIRED = defineExtension({ name: "c", label: "C" });

/** A store holding exactly `nodes`. */
function store(nodes: readonly KbNode[]): NodeLookup {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (id) => byId.get(id);
}

/** A store with `family`'s switch written to `on`. */
function switched(family: Parameters<typeof switchWrites>[0], on: boolean): NodeLookup {
  return store(switchWrites(family, on, NO_SWITCHES, AT));
}

/** A report nobody reads. */
const silent = (): void => {};

describe("a family's switch", () => {
  test("a store with no switch written has each optional family as it is by default", () => {
    expect(familyOn(OFF_BY_DEFAULT, NO_SWITCHES, silent)).toBe(false);
    expect(familyOn(ON_BY_DEFAULT, NO_SWITCHES, silent)).toBe(true);
  });

  test("a written switch wins over the default, either way", () => {
    expect(familyOn(OFF_BY_DEFAULT, switched(OFF_BY_DEFAULT, true), silent)).toBe(true);
    expect(familyOn(ON_BY_DEFAULT, switched(ON_BY_DEFAULT, false), silent)).toBe(false);
  });

  test("a switch that does not read as a checkbox reads as the default, and says why", () => {
    const warnings: string[] = [];
    const garbled = store([
      {
        id: extensionNodeId(ON_BY_DEFAULT.name),
        text: "B",
        props: { [EXTENSION_ENABLED_FIELD]: [{ t: "str", v: "yes" }] },
        children: [],
        createdAt: AT,
        updatedAt: AT,
      },
    ]);
    expect(familyOn(ON_BY_DEFAULT, garbled, (warning) => warnings.push(warning))).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("a required family is on whatever its node says, so nothing that depends on it can be switched away", () => {
    expect(familyOn(REQUIRED, NO_SWITCHES, silent)).toBe(true);
    expect(familyOn(REQUIRED, switched(REQUIRED, false), silent)).toBe(true);
  });
});
