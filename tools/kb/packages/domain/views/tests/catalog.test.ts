/**
 * The view catalog is the keys, described: one entry per view the seed names
 * an option for, each entry's settings derived from its key's params, so an
 * agent reading `kb.manifest` reads exactly what a host decodes.
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { viewOptionId, viewValueEntries } from "@kb/model";
import { VIEW_CATALOG, catalogKeyOf, paramsIssues, viewCatalog } from "@kb/views";

describe("view catalog", () => {
  test("lists one key per view the seed names, in its order, each under its own option", () => {
    const ids: string[] = VIEW_CATALOG.map((key) => key.id);
    expect(ids).toEqual(viewValueEntries().map(([id]) => id));
    for (const key of VIEW_CATALOG) expect(key.option).toBe(viewOptionId(key.id));
  });

  test("a key's family is the family its option is seeded in", () => {
    const values = new Map(viewValueEntries());
    for (const key of VIEW_CATALOG) expect(key.family).toBe(values.get(key.id)?.family);
  });

  test("every entry states its settings as a JSON Schema with a description", () => {
    for (const entry of viewCatalog()) {
      expect(entry.settings).toMatchObject({ description: expect.any(String) });
    }
  });

  test("an entry's defaults are legal settings of its view", () => {
    const withDefaults = viewCatalog().filter((entry) => entry.defaults !== undefined);
    expect(withDefaults.length).toBeGreaterThan(0);
    for (const entry of withDefaults) {
      const key = catalogKeyOf(entry.id);
      expect(key).not.toBeNull();
      if (key !== null)
        expect(Result.isSuccess(paramsIssues(key, entry.defaults, true))).toBe(true);
    }
  });

  test("a view is found by its id or by its option, and nothing else", () => {
    expect(catalogKeyOf("outline.board")?.id).toBe("outline.board");
    expect(catalogKeyOf("sys.view.outline.board")?.id).toBe("outline.board");
    expect(catalogKeyOf("outline.nope")).toBeNull();
  });
});
