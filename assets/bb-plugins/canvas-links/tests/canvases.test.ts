// The panel's rules over plain data. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, matches, threadIds, timeLabel } from "../../linked-items/rows.ts";
import { elsewhereHost, hostOfKey, otherHarnesses, parseListing, rowOf, type Canvas } from "../lib/canvases.ts";

function canvas(over: Partial<Canvas>): Canvas {
  return {
    key: "mac:doc-a",
    documentId: "doc-a",
    path: "/Users/p/Documents/canvas-links design.tldraw",
    host: "mac",
    name: "canvas-links design",
    folder: "~/Documents",
    local: true,
    exists: true,
    open: false,
    editedAt: null,
    linkedAt: 0,
    sessions: [],
    projects: [],
    ...over,
  };
}

test("a listing is parsed field by field; a broken row is dropped, not the listing", () => {
  const listing = parseListing(
    JSON.stringify({
      scope: "project",
      host: "mac",
      session: { harness: "bb", id: "thr_1" },
      project: { remote: "github.com/p/d", root: "/d" },
      central: "ok",
      canvases: [
        { key: "mac:doc-a", host: "mac", name: "A", sessions: [{ harness: "bb", id: "thr_1", ts: 5 }], linkedAt: 5, open: true, extra: 1 },
        { name: "no key" },
        "junk",
      ],
    }),
  );
  assert.equal(listing.scope, "project");
  assert.equal(listing.canvases.length, 1);
  assert.equal(listing.canvases[0].open, true);
  assert.deepEqual(listing.canvases[0].sessions, [{ harness: "bb", id: "thr_1", ts: 5 }]);
  assert.equal(parseListing("{}").scope, "session");
  assert.throws(() => parseListing("[]"));
});

test("search needs every word somewhere in name, folder, host or sessions", () => {
  const c = rowOf(canvas({ sessions: [{ harness: "codex", id: "x1", ts: 1 }] }));
  assert.ok(matches(c, ""));
  assert.ok(matches(c, "design documents"));
  assert.ok(matches(c, "CODEX"));
  assert.ok(!matches(c, "design kb"));
});

test("thread chips: bb sessions, newest first, once each; other harnesses counted", () => {
  const c = canvas({
    sessions: [
      { harness: "bb", id: "thr_old", ts: 1 },
      { harness: "bb", id: "thr_new", ts: 9 },
      { harness: "bb", id: "thr_old", ts: 5 },
      { harness: "claude-code", id: "c", ts: 2 },
      { harness: "codex", id: "x", ts: 3 },
      { harness: "codex", id: "y", ts: 4 },
    ],
  });
  assert.deepEqual(threadIds(rowOf(c)), ["thr_new", "thr_old"]);
  assert.deepEqual(otherHarnesses(c), ["claude-code", "codex · 2"]);
  assert.deepEqual(rowOf(c).tags, ["claude-code", "codex · 2"]);
});

test("a row: a missing local file is gone, a canvas elsewhere names its host, links are never claimed", () => {
  const gone = rowOf(canvas({ exists: false, open: true, sessions: [{ harness: "bb", id: "thr_1", ts: 1 }] }));
  assert.equal(gone.gone, "file gone");
  assert.equal(gone.open, "open now");
  assert.equal(gone.where, "~/Documents");
  assert.deepEqual(gone.threads, [{ id: "thr_1", at: 1, claimed: false }]);
  const away = rowOf(canvas({ local: false, host: "shared-server", exists: null }));
  assert.equal(away.where, "on shared-server");
  assert.equal(away.gone, null);
});

test("relative times", () => {
  const now = Date.UTC(2026, 9, 23, 12);
  assert.equal(ago(now - 10_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5m ago");
  assert.equal(ago(now - 3 * 3_600_000, now), "3h ago");
  assert.equal(ago(now - 2 * 86_400_000, now), "2d ago");
  assert.equal(ago(now - 14 * 86_400_000, now), "2w ago");
  assert.equal(ago(Date.UTC(2026, 0, 2), now), "2026-01-02");
  assert.equal(timeLabel(rowOf(canvas({ editedAt: now - 3_600_000, linkedAt: now })), now), "edited 1h ago");
  assert.equal(timeLabel(rowOf(canvas({ editedAt: null, linkedAt: now })), now), "linked just now");
});

test("open on another machine is exit 3 with 'on <host>'", () => {
  assert.equal(elsewhereHost(3, "on shared-server\n"), "shared-server");
  assert.equal(elsewhereHost(1, "on x"), null);
  assert.equal(elsewhereHost(3, "weird"), null);
});

test("an available listing keeps canvases nobody linked: no link time, no threads, no time line without an edit", () => {
  const listing = parseListing(
    JSON.stringify({
      scope: "available",
      canvases: [{ key: "mac:doc-z", host: "mac", name: "Z", linkedAt: null, sessions: [], editedAt: null }],
    }),
  );
  assert.equal(listing.scope, "available");
  const row = rowOf(listing.canvases[0]);
  assert.equal(row.linkedAt, null);
  assert.deepEqual(row.threads, []);
  assert.equal(timeLabel(row, Date.now()), "");
});

test("a key names its machine", () => {
  assert.equal(hostOfKey("popemkt-work:74Ilvgu5HMR6bt5AOgd4Y"), "popemkt-work");
  assert.equal(hostOfKey("mac:/Users/p/a.tldraw"), "mac");
  assert.equal(hostOfKey("no-host"), null);
});
