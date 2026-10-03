/**
 * The view catalog is the keys, described: one entry per key, each entry's
 * label, family and settings derived from the key, so an agent reading
 * `kb.manifest` reads exactly what a host decodes. That the seed names each
 * key's option is the seed fold's property (`@kb/bundled`'s tests).
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { viewOptionId } from "@kb/model";
import { VIEW_CATALOG, catalogKeyOf, paramsIssues, viewCatalog } from "@kb/views";

/** What names a view: its id, its label and its family. */
const named = (entry: { id: string; label: string; family?: string | undefined }) => [
  entry.id,
  entry.label,
  entry.family,
];

describe("view catalog", () => {
  test("lists one entry per key, under its own option, named by its key", () => {
    expect(viewCatalog().map(named)).toEqual(VIEW_CATALOG.map(named));
    for (const key of VIEW_CATALOG) expect(key.option).toBe(viewOptionId(key.id));
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
