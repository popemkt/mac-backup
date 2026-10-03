/**
 * `viewNodeFor` is the one check of a proposed view (DESIGN.md → View
 * nodes): legal params, nothing the view does not declare, and props that
 * read back as the params proposed. The first property runs over every view
 * of the catalog, so a key whose write and read disagree turns it red.
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { SYSTEM_IDS } from "@kb/model";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import {
  CanvasView,
  NeighbourhoodView,
  OutlineBoardView,
  OutlineSnippetView,
  issueText,
  paramsFromProps,
  viewCatalogOf,
  viewNodeFor,
  type ViewKey,
} from "@kb/views";

function problems(key: ViewKey<unknown>, input: unknown, host: string | null = null): string[] {
  const result = viewNodeFor(key, input, host);
  return Result.isFailure(result) ? result.failure.map(issueText) : [];
}

/** The catalog a server holding every bundled family lists. */
const catalog = viewCatalogOf(
  BUNDLED_DECLARATIONS.flatMap((declaration) => declaration.views ?? []),
);

const BOARD = { filters: [], sort: [], display: [], groupFieldId: "f.status" };

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

  test("a proposal's props name its view, then hold its settings", () => {
    const proposed = Result.getOrThrow(viewNodeFor(OutlineBoardView, BOARD, "n.frame"));
    expect(proposed.props[SYSTEM_IDS.viewField]).toEqual([
      { t: "ref", v: OutlineBoardView.option },
    ]);
    expect(proposed.props[SYSTEM_IDS.viewGroupField]).toEqual([{ t: "ref", v: "f.status" }]);
  });

  test("an illegal setting, a missing one and one the view does not declare are each named", () => {
    expect(problems(OutlineBoardView, { ...BOARD, groupFieldId: 7 })).toEqual([
      "groupFieldId: Expected string | null",
    ]);
    const { sort: _sort, ...unsorted } = BOARD;
    expect(problems(OutlineBoardView, unsorted)).toEqual(["sort: Missing key"]);
    expect(problems(OutlineBoardView, { ...BOARD, colour: "red" })).toEqual([
      "colour: Expected no excess property",
    ]);
  });

  test("a setting a view node cannot hold is named by its path", () => {
    expect(problems(OutlineSnippetView, { root: "n.a", depth: 2, maxRows: 6 })).toEqual([
      "depth: a view node of outline.snippet cannot hold this setting; it reads back as: 1",
    ]);
    expect(problems(CanvasView, { id: "n.canvas" })).toEqual([
      "id: a view node of canvas.page cannot hold this setting; it reads back as: Missing key",
    ]);
  });

  test("a view shown for its host reads its root back from what it stores", () => {
    const settings = {
      layout: "force",
      spread: 150,
      linkDistance: 60,
      showLabels: true,
      autorotate: false,
      labelDensity: "medium",
      theme: "matte",
      linkStyle: "straight",
    };
    const params = {
      root: "n.a",
      hops: 2,
      edges: ["mention"],
      renderer: "sys.view.graph.tree",
      settings,
    };
    expect(problems(NeighbourhoodView, params, "n.other")).toEqual([]);
  });
});
