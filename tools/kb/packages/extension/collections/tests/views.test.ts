/**
 * The collection views' keys over the view mechanism (`@kb/views`): a
 * proposal names its view and holds its settings, each bad setting is named,
 * and a key reads its settings from a frame's view node. The mechanism's own
 * properties, over every key of the catalog, are `@kb/views`' tests.
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { SYSTEM_IDS } from "@kb/model";
import { issueText, paramsFromProps, type ViewKey, viewNodeFor } from "@kb/views";
import { CollectionBoardView, CollectionTableView } from "@kb/collections";

function problems(key: ViewKey<unknown>, input: unknown, host: string | null = null): string[] {
  const result = viewNodeFor(key, input, host);
  return Result.isFailure(result) ? result.failure.map(issueText) : [];
}

const BOARD = { filters: [], sort: [], display: [], groupFieldId: "f.status" };

describe("the collection views' keys", () => {
  test("a proposal's props name its view, then hold its settings", () => {
    const proposed = Result.getOrThrow(viewNodeFor(CollectionBoardView, BOARD, "n.frame"));
    expect(proposed.props[SYSTEM_IDS.viewField]).toEqual([
      { t: "ref", v: CollectionBoardView.option },
    ]);
    expect(proposed.props[SYSTEM_IDS.viewGroupField]).toEqual([{ t: "ref", v: "f.status" }]);
  });

  test("an illegal setting, a missing one and one the view does not declare are each named", () => {
    expect(problems(CollectionBoardView, { ...BOARD, groupFieldId: 7 })).toEqual([
      "groupFieldId: Expected string | null",
    ]);
    const { sort: _sort, ...unsorted } = BOARD;
    expect(problems(CollectionBoardView, unsorted)).toEqual(["sort: Missing key"]);
    expect(problems(CollectionBoardView, { ...BOARD, colour: "red" })).toEqual([
      "colour: Expected no excess property",
    ]);
  });

  test("a key reads its params from a frame's view node", () => {
    const table = paramsFromProps(
      CollectionTableView,
      { [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: 25 }] },
      "n.frame",
      () => {},
    );
    expect(Result.getOrThrow(table).pagesize).toBe(25);
  });

  test("their ids are the frozen ids they were first stored under", () => {
    expect([CollectionTableView, CollectionBoardView].map((key) => key.option)).toEqual([
      "sys.view.outline.table",
      "sys.view.outline.board",
    ]);
  });
});
