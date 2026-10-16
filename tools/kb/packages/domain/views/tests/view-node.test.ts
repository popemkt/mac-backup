/**
 * `viewNodeFor` is the one check of a proposed view (DESIGN.md → View
 * nodes): legal params, nothing the view does not declare, and props that
 * read back as the params proposed. The first property runs over every view
 * of the catalog, so a key whose write and read disagree turns it red.
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import {
  issueText,
  OntologyScopeView,
  OutlineSnippetView,
  paramsFromProps,
  viewCatalogOf,
  type ViewKey,
  viewNodeFor,
} from "@kb/views";

function problems(key: ViewKey<unknown>, input: unknown, host: string | null = null): string[] {
  const result = viewNodeFor(key, input, host);
  return Result.isFailure(result) ? result.failure.map(issueText) : [];
}

/** The catalog a server holding every bundled family lists. */
const catalog = viewCatalogOf(
  BUNDLED_DECLARATIONS.flatMap((declaration) => declaration.views ?? []),
);

describe("viewNodeFor", () => {
  test("every view that reads its defaults from an empty view node holds them", () => {
    for (const entry of catalog.entries()) {
      if (entry.defaults === undefined) continue;
      const key = catalog.keyOf(entry.id);
      if (key === null) throw new Error(`${entry.id} has no key`);
      const proposed = viewNodeFor(key, entry.defaults, "n.host");
      expect({
        view: entry.id,
        issues: Result.isFailure(proposed) ? proposed.failure : [],
      }).toEqual({ view: entry.id, issues: [] });
      if (Result.isSuccess(proposed)) {
        // It reads back as an empty view node reads for that host: a setting
        // the view takes from its host when none is stored stays the host's.
        const back = paramsFromProps(key, proposed.success.props, "n.host", () => {});
        expect(back).toEqual(paramsFromProps(key, {}, "n.host", () => {}));
      }
    }
  });

  test("a setting a view node cannot hold is named by its path", () => {
    expect(problems(OutlineSnippetView, { root: "n.a", depth: 2, maxRows: 6 })).toEqual([
      "depth: a view node of outline.snippet cannot hold this setting; it reads back as: 1",
    ]);
    expect(problems(OntologyScopeView, { id: "n.onto", view: "outline" })).toEqual([
      "id: a view node of ontology.scope cannot hold this setting; it reads back as: Missing key",
      "view: a view node of ontology.scope cannot hold this setting; it reads back as: Missing key",
    ]);
  });

  test("a view shown for its host reads its root back from what it stores", () => {
    expect(problems(OutlineSnippetView, { root: "n.a", depth: 1, maxRows: 6 }, "n.other")).toEqual(
      [],
    );
  });
});
