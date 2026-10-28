// The shared panel's rules over plain data: what search shows, and which selected rows each action acts on.
// Run from either plugin: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { linkedBy, searchSections, targets, timeLabel, type LinkRow } from "../rows.ts";

function row(key: string, over: Partial<LinkRow> = {}): LinkRow {
  return { key, name: key, title: key, where: "", notes: [], gone: null, open: null, editedAt: null, linkedAt: 1, threads: [], tags: [], search: [], ...over };
}

const mine = row("mine", { threads: [{ id: "thr_me", at: 1, claimed: false }] });
const theirs = row("theirs", { threads: [{ id: "thr_other", at: 2, claimed: true }] });
const loose = row("loose", { linkedAt: null });
const gone = row("gone", { gone: "file gone", threads: [{ id: "thr_me", at: 3, claimed: true }] });

test("no query: the scope's rows and nothing else; a query: matching scope rows, then every other match once", () => {
  assert.deepEqual(searchSections([mine], [mine, theirs, loose], ""), { linked: [mine], more: [] });
  const both = searchSections([mine, theirs], [mine, theirs, loose], "loose");
  assert.deepEqual(both.linked.map(r => r.key), []);
  assert.deepEqual(both.more.map(r => r.key), ["loose"]);
  const wide = searchSections([mine], [mine, theirs, loose], "e");
  assert.deepEqual(wide.linked.map(r => r.key), ["mine"]);
  assert.deepEqual(wide.more.map(r => r.key), ["theirs", "loose"]);
});

test("Link takes rows the thread does not link; Unlink only its own links; Open whatever is still there", () => {
  const all = [mine, theirs, loose, gone];
  assert.ok(linkedBy(mine, "thr_me") && !linkedBy(theirs, "thr_me"));
  assert.deepEqual(targets("link", all, "thr_me").map(r => r.key), ["theirs", "loose"]);
  assert.deepEqual(targets("unlink", all, "thr_me").map(r => r.key), ["mine", "gone"]);
  assert.deepEqual(targets("open", all, "thr_me").map(r => r.key), ["mine", "theirs", "loose"]);
});

test("a row nobody linked and nobody edited has no time line", () => {
  assert.equal(timeLabel(loose, 10), "");
  assert.equal(timeLabel(mine, 10), "linked just now");
});
