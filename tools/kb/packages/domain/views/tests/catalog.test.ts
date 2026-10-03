/**
 * The view catalog is the keys, described: one entry per key, each entry's
 * label, family and settings derived from the key, so an agent reading
 * `kb.manifest` reads exactly what a host decodes. That the seed names each
 * key's option is the seed fold's property (`@kb/bundled`'s tests).
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { viewOptionId } from "@kb/model";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import { OutlineBoardView, paramsIssues, viewCatalogOf } from "@kb/views";

/** The catalog a server holding every bundled family lists. */
const catalog = viewCatalogOf(
  BUNDLED_DECLARATIONS.flatMap((declaration) => declaration.views ?? []),
);

/** What names a view: its id, its label and its family. */
const named = (entry: { id: string; label: string; family?: string | undefined }) => [
  entry.id,
  entry.label,
  entry.family,
];

describe("view catalog", () => {
  test("lists one entry per key, in order, under its own option, named by its key", () => {
    const keys = catalog.items.map((item) => item.key);
    expect(catalog.entries().map(named)).toEqual(keys.map(named));
    for (const key of keys) expect(key.option).toBe(viewOptionId(key.id));
  });

  test("every entry states its settings as a JSON Schema with a description", () => {
    for (const entry of catalog.entries()) {
      expect(entry.settings).toMatchObject({ description: expect.any(String) });
    }
  });

  test("an entry's defaults are legal settings of its view", () => {
    const withDefaults = catalog.entries().filter((entry) => entry.defaults !== undefined);
    expect(withDefaults.length).toBeGreaterThan(0);
    for (const entry of withDefaults) {
      const key = catalog.keyOf(entry.id);
      expect(key).not.toBeNull();
      if (key !== null)
        expect(Result.isSuccess(paramsIssues(key, entry.defaults, true))).toBe(true);
    }
  });

  test("a view is found by its id or by its option, and nothing else", () => {
    const board = viewCatalogOf([{ key: OutlineBoardView }]);
    expect(board.keyOf("outline.board")).toBe(OutlineBoardView);
    expect(board.keyOf("sys.view.outline.board")).toBe(OutlineBoardView);
    expect(board.keyOf("outline.nope")).toBeNull();
    expect(board.itemOf("outline.board")?.key).toBe(OutlineBoardView);
  });
});
