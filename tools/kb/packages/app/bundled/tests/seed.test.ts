/**
 * The bundled seed fold (DESIGN.md → Extension families → the seed is the
 * bundled fold): each declared view's option is derived from its key, in
 * declaration order, and an id two declarations claim is refused.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, VIEW_FAMILY_VALUES, foldSeed, viewOptionId } from "@kb/model";
import { BUNDLED_DECLARATIONS, bundledSeed } from "@kb/bundled";

const AT = "2026-01-01T00:00:00.000Z";
const declaredKeys = BUNDLED_DECLARATIONS.flatMap((declaration) =>
  (declaration.views ?? []).map((view) => view.key),
);

describe("bundled seed", () => {
  test("sys.views lists one option per declared view, in declaration order", () => {
    const seed = new Map(bundledSeed(AT).map((node) => [node.id, node]));
    expect(seed.get(SYSTEM_IDS.viewsRoot)?.children).toEqual(
      declaredKeys.map((key) => viewOptionId(key.id)),
    );
  });

  test("each option carries its key's label and its key's family", () => {
    const seed = new Map(bundledSeed(AT).map((node) => [node.id, node]));
    for (const key of declaredKeys) {
      const option = seed.get(key.option);
      expect(option?.text).toBe(key.label);
      const family = option?.props[SYSTEM_IDS.viewFamilyField]?.[0];
      expect(family?.v).toBe(
        key.family === undefined ? undefined : VIEW_FAMILY_VALUES[key.family].id,
      );
    }
  });

  test("an id two declarations claim is refused", () => {
    expect(() => foldSeed([...BUNDLED_DECLARATIONS, ...BUNDLED_DECLARATIONS], AT)).toThrow(
      /declared twice/,
    );
  });

  test("it is pure data: the same nodes every time", () => {
    expect(bundledSeed(AT)).toEqual(bundledSeed(AT));
  });
});
