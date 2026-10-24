// Linked items over plain data: the via a thread's writes carry, reading kb's change log, which changes link
// what, the canvas a tab shows, and how rows are searched and dated.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  ago,
  matches,
  openCanvasOf,
  parseChangePage,
  threadIds,
  threadOfVia,
  timeLabel,
  touches,
  viaOfThread,
  type LinkedItem,
} from "../lib/links.ts";

const item = (over: Partial<LinkedItem> = {}): LinkedItem => ({
  key: "c1",
  kind: "canvas",
  id: "c1",
  name: "Roadmap",
  store: "home",
  editedAt: null,
  linkedAt: 0,
  gone: false,
  open: false,
  threads: [],
  ...over,
});

describe("the via a thread's writes carry", () => {
  test("names the thread, and reads back only when it is ours", () => {
    assert.equal(viaOfThread("thr_a"), "bb:thr_a");
    assert.equal(threadOfVia("bb:thr_a"), "thr_a");
    assert.equal(threadOfVia("bb:"), null);
    assert.equal(threadOfVia("cron:nightly"), null);
    assert.equal(threadOfVia(undefined), null);
  });
});

describe("kb's change log", () => {
  test("parses field by field, skipping what it cannot read", () => {
    const page = parseChangePage({
      head: 9,
      complete: true,
      changes: [
        { rev: 8, at: "2026-10-25T00:00:00.000Z", via: "bb:thr_a", wrote: [{ id: "c1", text: "Roadmap", tags: ["sys.tag.canvas"] }], deleted: [] },
        { rev: "x" },
        { rev: 9, at: "nope", wrote: [{ text: "no id" }], deleted: ["c2", 3] },
      ],
    });
    assert.ok(page !== null);
    assert.equal(page.head, 9);
    assert.deepEqual(page.changes.map(c => c.rev), [8, 9]);
    assert.equal(page.changes[0].at, Date.parse("2026-10-25T00:00:00.000Z"));
    assert.equal(page.changes[1].at, 0);
    assert.deepEqual(page.changes[1].wrote, []);
    assert.deepEqual(page.changes[1].deleted, ["c2"]);
    assert.equal(parseChangePage({ changes: [] }), null);
    assert.equal(parseChangePage({ head: 1, complete: false, changes: [] })?.complete, false);
  });

  test("a canvas written links its writer's thread; anyone else's write only dates it; a deletion marks it gone", () => {
    const page = parseChangePage({
      head: 3,
      complete: true,
      changes: [
        { rev: 1, at: "2026-10-25T00:00:00.000Z", via: "bb:thr_a", wrote: [{ id: "c1", text: "Roadmap", tags: ["sys.tag.canvas"] }, { id: "n1", text: "a note", tags: [] }], deleted: [] },
        { rev: 2, at: "2026-10-25T00:01:00.000Z", wrote: [{ id: "c1", text: "Roadmap v2", tags: ["sys.tag.canvas"] }], deleted: [] },
        { rev: 3, at: "2026-10-25T00:02:00.000Z", via: "bb:thr_b", wrote: [], deleted: ["c1"] },
      ],
    });
    assert.ok(page !== null);
    const t = touches(page.changes);
    assert.deepEqual(
      t.map(x => [x.id, x.name, x.thread, x.gone]),
      [
        ["c1", "Roadmap", "thr_a", false],
        ["c1", "Roadmap v2", null, false],
        ["c1", "", null, true],
      ],
    );
  });
});

describe("the canvas a kb tab shows", () => {
  test("is the active pane's canvas view subject, else its /canvas/ route", () => {
    const pane = (id: string, view: unknown, route = "/") => ({ id, route, view, focused: null, selection: [] });
    assert.equal(openCanvasOf({ tabs: [{ activePane: "b", panes: [pane("a", { key: "canvas", subject: "x" }), pane("b", { key: "canvas", subject: "c1" })] }] }), "c1");
    assert.equal(openCanvasOf({ tabs: [{ activePane: "a", panes: [pane("a", null, "/canvas/c%202")] }] }), "c 2");
    assert.equal(openCanvasOf({ tabs: [{ activePane: "a", panes: [pane("a", { key: "outline.main" }, "/node/n1")] }] }), null);
    assert.equal(openCanvasOf({ tabs: [] }), null);
    assert.equal(openCanvasOf(null), null);
  });
});

describe("a row", () => {
  test("matches every word against its name, store and linking threads, titles included", () => {
    const row = item({ threads: [{ id: "thr_a", how: "wrote", at: 1, host: null }] });
    assert.equal(matches(row, ""), true);
    assert.equal(matches(row, "road home"), true);
    assert.equal(matches(row, "thr_a"), true);
    assert.equal(matches(row, "deploy", { thr_a: "Deploy plan" }), true);
    assert.equal(matches(row, "missing"), false);
  });

  test("lists its threads newest first, once each", () => {
    const row = item({
      threads: [
        { id: "thr_a", how: "wrote", at: 1, host: null },
        { id: "thr_b", how: "linked", at: 5, host: null },
        { id: "thr_a", how: "wrote", at: 3, host: null },
      ],
    });
    assert.deepEqual(threadIds(row), ["thr_b", "thr_a"]);
  });

  test("dates itself by its last write, else by its link", () => {
    const now = Date.parse("2026-10-25T12:00:00.000Z");
    assert.equal(timeLabel(item({ editedAt: now - 3 * 3600_000 }), now), "edited 3h ago");
    assert.equal(timeLabel(item({ linkedAt: now - 30_000 }), now), "linked just now");
    assert.equal(ago(now - 40 * 86400_000, now), "2026-09-15");
  });
});
